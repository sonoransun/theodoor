import { describe, expect, it } from 'vitest'
import type {
  BeamEffect,
  CompiledCue,
  CompiledShow,
  MusicalTimeline,
  Show,
} from '../src/contracts.js'
import {
  DEFAULT_EXPOSURE_BUDGET,
  EXPOSURE_DT_SEC,
  exposureReport,
} from '../src/acoustics/exposure.js'
import { crowdGridFor, lakesidePark } from '../src/site/index.js'

function makeEffect(over: Partial<BeamEffect>): BeamEffect {
  return {
    id: 'b-test',
    name: 'Test Beam',
    medium: 'beam',
    tags: ['low-noise', 'beam'],
    noiseDbAt15m: 66,
    durationSec: 12,
    program: 'whisperZone',
    beamWidthDeg: 6,
    carrierBandLabel: 'u-band-40',
    maxCarrierDbAtFocus: 104,
    contentTag: 'narration',
    ...over,
  }
}

let cueCounter = 0
function beamCue(
  effect: BeamEffect,
  positionId: string,
  params: CompiledCue['params'],
): CompiledCue {
  return {
    id: `xcue-${++cueCounter}`,
    trackId: 'beams',
    medium: 'beam',
    effectId: effect.id,
    positionId,
    targetSec: 10,
    fireSec: 9.5,
    anticipationSec: 0.5,
    durationSec: effect.durationSec,
    seed: 7,
    params,
  }
}

function makeCompiled(
  cues: readonly CompiledCue[],
  beats: readonly number[] = [],
): CompiledShow {
  const music: MusicalTimeline = {
    source: 'score',
    id: 'm-1',
    title: 'Test',
    duration: 120,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats,
    downbeats: [],
    annotations: [],
    energy: [],
    tempoConfidence: 1,
  }
  const show: Show = {
    meta: { id: 's-1', title: 'Exposure Test', variant: 'standard', seed: 7 },
    music,
    site: lakesidePark(),
    catalogId: 'test',
    tracks: [],
  }
  return { show, cues, diagnostics: [] }
}

const site = lakesidePark()
const grid = crowdGridFor(site)!
// A cell ~10 m downrange of beam-south-west (−140, −182): row 8, col 1.
const nearIndex = grid.cells.find((c) => c.row === 8 && c.col === 1)!.index

describe('exposureReport', () => {
  it('passes trivially with zero beam cues', () => {
    const report = exposureReport(makeCompiled([]), () => undefined)
    expect(report.pass).toBe(true)
    expect(report.peakDb).toBe(-Infinity)
    expect(report.worstCellIndex).toBe(-1)
    expect(report.cells).toEqual([])
    expect(report.violations).toEqual([])
  })

  it('a modest short-throw whisper passes the default budget', () => {
    const effect = makeEffect({})
    const cue = beamCue(effect, 'beam-south-west', { targetCellId: nearIndex })
    const report = exposureReport(makeCompiled([cue]), (id) => (id === effect.id ? effect : undefined))
    expect(report.pass).toBe(true)
    expect(report.violations).toEqual([])
    // Evaluated at every derived cell; the worst cell is under the footprint.
    expect(report.cells.length).toBe(grid.cells.length)
    expect(report.peakDb).toBeGreaterThan(100) // 104 carrier ~10 m out
    expect(report.peakDb).toBeLessThanOrEqual(DEFAULT_EXPOSURE_BUDGET.maxCarrierDb)
    expect(report.peakTSec).toBeGreaterThanOrEqual(10)
  })

  it('a hot carrier at short throw trips the instant ceiling', () => {
    const effect = makeEffect({ id: 'b-hot', maxCarrierDbAtFocus: 120 })
    const cue = beamCue(effect, 'beam-south-west', { targetCellId: nearIndex })
    const report = exposureReport(makeCompiled([cue]), (id) => (id === effect.id ? effect : undefined))
    expect(report.pass).toBe(false)
    const ceiling = report.violations.filter((v) => v.code === 'EXPOSURE_BUDGET')
    expect(ceiling.length).toBeGreaterThan(0)
    expect(ceiling[0]!.severity).toBe('error')
    expect(ceiling[0]!.cueIds).toContain(cue.id)
    expect(report.peakDb).toBeGreaterThan(DEFAULT_EXPOSURE_BUDGET.maxCarrierDb)
  })

  it('a long park on one cell trips the dwell rule without touching the ceiling', () => {
    const effect = makeEffect({ id: 'b-long', durationSec: 40 })
    const cue = beamCue(effect, 'beam-south-west', { targetCellId: nearIndex })
    const report = exposureReport(makeCompiled([cue]), (id) => (id === effect.id ? effect : undefined))
    expect(report.pass).toBe(false)
    expect(report.violations.some((v) => v.code === 'EXPOSURE_DWELL')).toBe(true)
    expect(report.violations.some((v) => v.code === 'EXPOSURE_BUDGET')).toBe(false)
    // The worst cell dwells for the full 40 s window occupancy.
    const worst = report.cells.find((c) => c.cellIndex === report.worstCellIndex)!
    expect(worst.dwellSec).toBeGreaterThan(DEFAULT_EXPOSURE_BUDGET.dwellMaxSec)
  })

  it('an overridden budget is honored', () => {
    const effect = makeEffect({})
    const cue = beamCue(effect, 'beam-south-west', { targetCellId: nearIndex })
    const strict = { maxCarrierDb: 90, dwellDb: 80, dwellWindowSec: 60, dwellMaxSec: 5 }
    const report = exposureReport(
      makeCompiled([cue]),
      (id) => (id === effect.id ? effect : undefined),
      strict,
    )
    expect(report.pass).toBe(false)
    expect(report.budget).toEqual(strict)
    expect(report.violations.some((v) => v.code === 'EXPOSURE_BUDGET')).toBe(true)
  })

  it('is deterministic across runs', () => {
    const effect = makeEffect({})
    const cue = beamCue(effect, 'beam-south-west', { targetCellId: nearIndex })
    const lookup = (id: string): BeamEffect | undefined => (id === effect.id ? effect : undefined)
    const a = exposureReport(makeCompiled([cue]), lookup, undefined, EXPOSURE_DT_SEC)
    const b = exposureReport(makeCompiled([cue]), lookup, undefined, EXPOSURE_DT_SEC)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('a sub-dtSec window between grid samples still trips the ceiling (breakpoints)', () => {
    // An innocuous anchor at t=1 pins tMin so the 0.1 s grid runs 1.0, 1.1, …
    // and never lands inside the hot click's window [10.03, 10.09).
    const anchor = makeEffect({ id: 'b-anchor', durationSec: 2 })
    const click = makeEffect({ id: 'b-click', durationSec: 0.06, maxCarrierDbAtFocus: 118 })
    const lookup = (id: string): BeamEffect | undefined =>
      id === anchor.id ? anchor : id === click.id ? click : undefined
    const anchorCue = {
      ...beamCue(anchor, 'beam-south-west', { targetCellId: nearIndex }),
      targetSec: 1,
    }
    const offGrid = {
      ...beamCue(click, 'beam-south-west', { targetCellId: nearIndex }),
      targetSec: 10.03,
    }
    const report = exposureReport(makeCompiled([anchorCue, offGrid]), lookup)
    expect(report.pass).toBe(false)
    const ceiling = report.violations.filter((v) => v.code === 'EXPOSURE_BUDGET')
    expect(ceiling.length).toBeGreaterThan(0)
    expect(ceiling[0]!.cueIds).toContain(offGrid.id)
    expect(report.peakDb).toBeGreaterThan(DEFAULT_EXPOSURE_BUDGET.maxCarrierDb)
    // The grid-aligned variant has always tripped; both must now agree.
    const aligned = { ...offGrid, targetSec: 10 }
    expect(exposureReport(makeCompiled([anchorCue, aligned]), lookup).pass).toBe(false)
  })

  it('pingPong aims sweep on the show beat grid, not the 1 s/beat fallback', () => {
    // periodBeats=1 at 240 bpm: the aim flips far→near at t=10.25, inside the
    // 0.5 s window — the 1 s/beat fallback clock would park the whole window
    // on the far (over-horizon, leakage-suppressed) end and miss the breach.
    const farIndex = grid.cells.find((c) => c.row === 0 && c.col === 36)!.index
    const pp = makeEffect({
      id: 'b-pp-hot',
      program: 'pingPong',
      durationSec: 0.5,
      maxCarrierDbAtFocus: 118,
    })
    const lookup = (id: string): BeamEffect | undefined => (id === pp.id ? pp : undefined)
    const cue = beamCue(pp, 'beam-south-west', {
      pathCellIds: [farIndex, nearIndex],
      periodBeats: 1,
    })
    const beats: number[] = []
    for (let t = 0; t <= 120; t += 0.25) beats.push(t)
    const report = exposureReport(makeCompiled([cue], beats), lookup)
    expect(report.pass).toBe(false)
    expect(report.violations.some((v) => v.code === 'EXPOSURE_BUDGET')).toBe(true)
    // Same show WITHOUT a beat grid: the fallback clock never reaches the
    // near end inside the window, so nothing trips (the pre-fix behavior).
    expect(exposureReport(makeCompiled([cue]), lookup).pass).toBe(true)
  })

  it('sourceTag aims resolve through the tagged source track, not the fallback cell', () => {
    // Hot sourceTag beam whose FALLBACK cell would breach the ceiling; the
    // tagged pyro source on rack-4 (over the horizon from the array) covers
    // the whole beam window, so the true aim never touches the near cell.
    const tagFx = makeEffect({ id: 'b-hot-tag', program: 'sourceTag', maxCarrierDbAtFocus: 118 })
    const lookup = (id: string): BeamEffect | undefined => (id === tagFx.id ? tagFx : undefined)
    const pyroSource: CompiledCue = {
      id: 'src-1',
      trackId: 'pyro',
      medium: 'pyro',
      effectId: 'shell-x',
      positionId: 'rack-4',
      targetSec: 9,
      fireSec: 7,
      anticipationSec: 2,
      durationSec: 14, // [9, 23) covers the beam window [10, 22)
      seed: 1,
    }
    const tagged = beamCue(tagFx, 'beam-south-west', {
      sourceCueId: 'src-1',
      targetCellId: nearIndex,
    })
    const control = beamCue(tagFx, 'beam-south-west', { targetCellId: nearIndex })
    // Fallback aim (no source tag): in-footprint at the near cell → breach.
    expect(exposureReport(makeCompiled([pyroSource, control]), lookup).pass).toBe(false)
    // Tagged: the gate sweeps the rack-track aim the sim/export follow → pass.
    expect(exposureReport(makeCompiled([pyroSource, tagged]), lookup).pass).toBe(true)
  })
})
