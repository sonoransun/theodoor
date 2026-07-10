/**
 * Alignment-solver coverage for the crowd + beam media: phase-1 anticipation
 * (mast p95 latency / acoustic time-of-flight), the phase-2d2/2d3 repair
 * passes (crowd bandwidth, beam slew), sourceCueId linkage, and the
 * carrier-exposure hook in compile().
 */

import { describe, expect, it } from 'vitest'
import type {
  BeamEffect,
  CompiledCue,
  CompiledShow,
  CrowdEffect,
  Cue,
  MusicalTimeline,
  Show,
  SitePlan,
  Track,
} from '../src/contracts.js'
import { SPEED_OF_SOUND_MPS } from '../src/contracts.js'
import {
  Catalog,
  STARTER_CATALOG_ID,
  STARTER_EFFECTS,
  getEffectFrom,
  starterCatalog,
} from '../src/catalog/index.js'
import { lakesidePark } from '../src/site/index.js'
import { crowdGridFor, crowdMastFor } from '../src/site/crowdGrid.js'
import { beamAimAt, beamLandingTofSec } from '../src/acoustics/beams.js'
import { buildCrowdCues } from '../src/sim/crowd.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import {
  DEFAULT_CROWD_LATENCY_SEC,
  beamAnticipationSec,
  crowdLatencyFor,
  solve,
} from '../src/show/solve.js'
import { compile } from '../src/show/compile.js'

const catalog = starterCatalog()
// lakesidePark with the masts pinned to a 30 frames/s budget — the bandwidth
// repair fixtures hand-stack mask rates against that cap (the venue's real
// masts carry 1500 frames/s of broadcast headroom).
const stock = lakesidePark()
const site = {
  ...stock,
  assets: stock.assets.map((a) =>
    a.crowdMast ? { ...a, crowdMast: { ...a.crowdMast, framesPerSec: 30 } } : a,
  ),
}
const odeTl = buildTimelineFromScore(getScore('odeToJoy')!)

/** Sparse analysis grid (20 s beats) so a ±1-beat repair shift can clear the
 *  long crowd/beam windows (durations 12–16 s dwarf odeToJoy's 0.5 s beats). */
const slowTl: MusicalTimeline = {
  source: 'analysis',
  id: 'slow-grid',
  title: 'Slow Grid',
  duration: 140,
  tempo: { segments: [{ beat: 0, bpm: 3 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
  beats: [0, 20, 40, 60, 80, 100, 120],
  downbeats: [0, 80],
  annotations: [],
  energy: [],
  tempoConfidence: 1,
}

function mkShow(tracks: Track[], extra: Partial<Show> = {}, tl: MusicalTimeline = odeTl): Show {
  return {
    meta: { id: 'cb-show', title: 'Crowd Beam Show', variant: 'standard', seed: 7 },
    music: tl,
    site,
    catalogId: STARTER_CATALOG_ID,
    tracks,
    ...extra,
  }
}

const crowdTrack = (cues: Cue[]): Track => ({ id: 'crowd', medium: 'crowd', name: 'Crowd', cues })
const beamTrack = (cues: Cue[]): Track => ({ id: 'beams', medium: 'beam', name: 'Beams', cues })
const droneTrack = (cues: Cue[]): Track => ({ id: 'drones', medium: 'drone', name: 'Drones', cues })

// Shared geometry: the derived lawn grid and the south-west array head.
const grid = crowdGridFor(site)!
const swArray = site.assets.find((a) => a.id === 'beam-south-west')!
const cellAt = (row: number, col: number) =>
  grid.cells.find((c) => c.row === row && c.col === col)!
const nearCell = cellAt(8, 0) // front-west corner, ~12 m slant from beam-south-west
const farCell = cellAt(8, 37) // front-east corner, ~290 m across the lawn

describe('phase 1 — crowd anticipation is the mast p95 latency', () => {
  it('wristband 0.08 s / phone 1.2 s on mast-west, fireSec = targetSec − latency', () => {
    const show = mkShow([
      crowdTrack([
        { id: 'w', effectId: 'crowd-wave-lateral', anchor: { kind: 'sec', t: 20 }, positionId: 'mast-west' },
        { id: 'p', effectId: 'crowd-starfield-phone', anchor: { kind: 'sec', t: 40 }, positionId: 'mast-west' },
      ]),
    ])
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const w = cues.find((c) => c.id === 'w')!
    const p = cues.find((c) => c.id === 'p')!
    expect(w.anticipationSec).toBe(0.08) // wristband p95Ms 80
    expect(w.fireSec).toBeCloseTo(20 - 0.08, 12)
    expect(p.anticipationSec).toBe(1.2) // phone p95Ms 1200
    expect(p.fireSec).toBeCloseTo(40 - 1.2, 12)
  })

  it('crowdLatencyFor: the crowdMastFor mast p95/1000, defaults only without any mast', () => {
    expect(crowdLatencyFor(site, 'mast-west', 'wristband')).toBe(0.08)
    expect(crowdLatencyFor(site, 'mast-east', 'phone')).toBe(1.2)
    // No positionId / a non-mast positionId ride the site's FIRST spec-bearing
    // mast (mast-west) — the mast the sim ramps and the broadcast rides — not
    // the hardcoded defaults.
    expect(crowdLatencyFor(site, undefined, 'wristband')).toBe(0.08)
    expect(crowdLatencyFor(site, 'rack-1', 'phone')).toBe(1.2)
    // Only a site with no spec-bearing mast at all uses the defaults.
    const noMasts: SitePlan = {
      ...site,
      assets: site.assets.filter((a) => a.kind !== 'crowdMast'),
    }
    expect(crowdLatencyFor(noMasts, undefined, 'wristband')).toBe(
      DEFAULT_CROWD_LATENCY_SEC.wristband,
    )
    expect(crowdLatencyFor(noMasts, 'mast-west', 'phone')).toBe(DEFAULT_CROWD_LATENCY_SEC.phone)
    expect(DEFAULT_CROWD_LATENCY_SEC.wristband).toBe(0.05)
    expect(DEFAULT_CROWD_LATENCY_SEC.phone).toBe(1.0)
  })
})

describe('crowd mast unification — the solver anticipates the mast the sim ramps with', () => {
  /** The LatencySpec buildCrowdCues resolves for one compiled crowd cue. */
  function simMastSpec(show: Show, cues: readonly CompiledCue[], cueId: string) {
    const compiled: CompiledShow = { show, cues: [...cues], diagnostics: [] }
    const sim = buildCrowdCues(compiled, getEffectFrom(catalog)).find((s) => s.cue.id === cueId)
    expect(sim).toBeDefined()
    return sim!.mast
  }

  it('no positionId: anticipation = p95 of the first spec-bearing mast, not the default', () => {
    const show = mkShow([
      crowdTrack([{ id: 'c', effectId: 'crowd-flood-rgb', anchor: { kind: 'sec', t: 20 } }]),
    ])
    const { cues } = solve(show, catalog)
    const c = cues.find((x) => x.id === 'c')!
    const mast = simMastSpec(show, cues, 'c')!
    expect(c.anticipationSec).toBe(mast.wristband.p95Ms / 1000)
    expect(c.anticipationSec).toBe(0.08) // mast-west, NOT DEFAULT_CROWD_LATENCY_SEC (0.05)
    expect(c.fireSec).toBeCloseTo(20 - 0.08, 12)
  })

  it('positionId naming a spec-less crowdMast asset: both fall back to the first spec-bearing mast', () => {
    const base = lakesidePark()
    const siteWithBare: SitePlan = {
      ...base,
      assets: [
        ...base.assets,
        {
          id: 'mast-bare',
          kind: 'crowdMast',
          pos: { x: 0, y: -185 },
          headingDeg: 180,
          elevationM: 8,
          // deliberately NO crowdMast spec (legal: PositionedAsset.crowdMast is optional)
        },
      ],
    }
    const show = mkShow(
      [
        crowdTrack([
          {
            id: 'p',
            effectId: 'crowd-starfield-phone',
            anchor: { kind: 'sec', t: 40 },
            positionId: 'mast-bare',
          },
        ]),
      ],
      { site: siteWithBare },
    )
    const { cues } = solve(show, catalog)
    const p = cues.find((x) => x.id === 'p')!
    const mast = simMastSpec(show, cues, 'p')!
    expect(crowdMastFor(siteWithBare, 'mast-bare')!.id).toBe('mast-west')
    expect(p.anticipationSec).toBe(mast.phone.p95Ms / 1000)
    expect(p.anticipationSec).toBe(1.2) // mast-west phone p95, NOT the 1.0 default
    expect(p.fireSec).toBeCloseTo(40 - 1.2, 12)
  })

  it('a site with no spec-bearing mast: solver uses the defaults, sim ramps instantly', () => {
    const bareSite: SitePlan = {
      ...lakesidePark(),
      assets: lakesidePark().assets.filter((a) => a.kind !== 'crowdMast'),
    }
    const show = mkShow(
      [crowdTrack([{ id: 'c', effectId: 'crowd-flood-rgb', anchor: { kind: 'sec', t: 20 } }])],
      { site: bareSite },
    )
    const { cues } = solve(show, catalog)
    const c = cues.find((x) => x.id === 'c')!
    expect(c.anticipationSec).toBe(DEFAULT_CROWD_LATENCY_SEC.wristband)
    expect(simMastSpec(show, cues, 'c')).toBeUndefined()
  })
})

describe('phase 1 — beam anticipation is the acoustic time-of-flight', () => {
  it('whisper at a near cell: anticipation = slant/343 and fireSec = targetSec − ToF', () => {
    const show = mkShow([
      beamTrack([
        {
          id: 'wh',
          effectId: 'beam-whisper-narration',
          anchor: { kind: 'sec', t: 20 },
          positionId: 'beam-south-west',
          params: { targetCellId: nearCell.index },
        },
      ]),
    ])
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const wh = cues.find((c) => c.id === 'wh')!
    const expected = beamAimAt(swArray, nearCell.centroid).slantM / SPEED_OF_SOUND_MPS
    expect(Math.abs(wh.anticipationSec - expected)).toBeLessThan(1e-9)
    expect(Math.abs(wh.fireSec - (20 - expected))).toBeLessThan(1e-9)
  })

  it("cells:'all' toll fires early enough for the FARTHEST grid cell", () => {
    const show = mkShow([
      beamTrack([
        {
          id: 'toll',
          effectId: 'beam-toll-bell',
          anchor: { kind: 'sec', t: 30 },
          positionId: 'beam-south-west',
          params: { cells: 'all' },
        },
      ]),
    ])
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    let maxSlantM = 0
    for (const cell of grid.cells) {
      maxSlantM = Math.max(maxSlantM, beamAimAt(swArray, cell.centroid).slantM)
    }
    const expected = maxSlantM / SPEED_OF_SOUND_MPS
    const toll = cues.find((c) => c.id === 'toll')!
    expect(Math.abs(toll.anticipationSec - expected)).toBeLessThan(1e-9)
    expect(Math.abs(toll.fireSec - (30 - expected))).toBeLessThan(1e-9)
    // The exported helper agrees with what the solver stamped.
    const standIn: CompiledCue = {
      id: 'x',
      trackId: 'beams',
      medium: 'beam',
      effectId: 'beam-toll-bell',
      positionId: 'beam-south-west',
      targetSec: 30,
      fireSec: 30,
      anticipationSec: 0,
      durationSec: 3,
      seed: 0,
      params: { cells: 'all' },
    }
    const effect = catalog.find('beam-toll-bell') as BeamEffect
    expect(beamAnticipationSec(site, standIn, effect)).toBeCloseTo(expected, 12)
  })
})

describe('phase 2d2 — crowd mast bandwidth repair', () => {
  // Two 20 Hz text marquees (16 s) on one 30 frames/s mast: 40 Hz while
  // overlapped. A +1-beat shift on the slow grid (20 s) separates them.
  const marquees: Cue[] = [
    { id: 'ta', effectId: 'crowd-text-marquee', anchor: { kind: 'sec', t: 40 }, positionId: 'mast-west' },
    { id: 'tb', effectId: 'crowd-text-marquee', anchor: { kind: 'sec', t: 40 }, positionId: 'mast-west' },
  ]

  it('shifts the over-cap cue one beat later and the error clears', () => {
    const show = mkShow([crowdTrack(marquees)], {}, slowTl)
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.code === 'CROWD_BANDWIDTH')).toEqual([])
    expect(cues.find((c) => c.id === 'ta')!.targetSec).toBe(40)
    expect(cues.find((c) => c.id === 'tb')!.targetSec).toBeCloseTo(60, 12)
    expect(cues.find((c) => c.id === 'tb')!.fireSec).toBeCloseTo(60 - 0.08, 12)
  })

  it('maxShiftBeats 0 leaves the CROWD_BANDWIDTH error in place', () => {
    const show = mkShow([crowdTrack(marquees)], {}, slowTl)
    const { diagnostics } = solve(show, catalog, { maxShiftBeats: 0 })
    const bw = diagnostics.filter((d) => d.code === 'CROWD_BANDWIDTH')
    expect(bw.length).toBe(1)
    expect(bw[0]!.severity).toBe('error')
    expect(bw[0]!.cueIds).toEqual(['tb'])
    expect(bw[0]!.assetId).toBe('mast-west')
  })
})

describe('phase 2d3 — beam slew repair', () => {
  // Two whispers on beam-south-west retargeting front-west → front-east
  // (~120° of pan) with a ~0.15 s idle gap: hopeless at 45°/s × 1.1 margin.
  const whispers: Cue[] = [
    {
      id: 'w1',
      effectId: 'beam-whisper-narration',
      anchor: { kind: 'sec', t: 40 },
      positionId: 'beam-south-west',
      params: { targetCellId: nearCell.index },
    },
    {
      id: 'w2',
      effectId: 'beam-whisper-narration',
      anchor: { kind: 'sec', t: 53 },
      positionId: 'beam-south-west',
      params: { targetCellId: farCell.index },
    },
  ]

  it('shifts the later cue one beat out and the error clears', () => {
    const show = mkShow([beamTrack(whispers)], {}, slowTl)
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.code === 'BEAM_SLEW')).toEqual([])
    expect(cues.find((c) => c.id === 'w1')!.targetSec).toBe(40)
    // 53 is nearest beat 60; +1 beat preserves the −7 s offset → 73.
    expect(cues.find((c) => c.id === 'w2')!.targetSec).toBeCloseTo(73, 12)
  })

  it('maxShiftBeats 0 leaves the BEAM_SLEW error in place', () => {
    const show = mkShow([beamTrack(whispers)], {}, slowTl)
    const { diagnostics } = solve(show, catalog, { maxShiftBeats: 0 })
    const slew = diagnostics.filter((d) => d.code === 'BEAM_SLEW')
    expect(slew.length).toBe(1)
    expect(slew[0]!.severity).toBe('error')
    expect(slew[0]!.cueIds).toEqual(['w1', 'w2'])
    expect(slew[0]!.assetId).toBe('beam-south-west')
  })
})

describe('phase 2e — substitution recomputes anticipation per medium (keystone identity)', () => {
  it('beam: the substituted cue still fires early by the acoustic time-of-flight', () => {
    // A 76 dB toll aimed 2.8 m from refListenerPos[0] under a 55 dB budget is
    // substituted to the 64 dB whisper count-in; the substituted cue must keep
    // fireSec = targetSec − ToF (not collapse to the catalog's 0 placeholder).
    const listenerCell = cellAt(8, 6) // centroid (−98, −192), next to listener (−100, −190)
    const show = mkShow(
      [
        beamTrack([
          {
            id: 'bell',
            effectId: 'beam-toll-bell',
            anchor: { kind: 'sec', t: 30 },
            positionId: 'beam-delay-west',
            params: { targetCellId: listenerCell.index },
          },
        ]),
      ],
      { noiseBudget: { maxSplDb: 55 } },
    )
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(
      diagnostics.some((d) => d.code === 'SPL_BUDGET' && d.severity === 'warning'),
    ).toBe(true)
    const bell = cues.find((c) => c.id === 'bell')!
    expect(bell.effectId).toBe('beam-whisper-count') // substitution happened
    const sub = catalog.find('beam-whisper-count') as BeamEffect
    const tof = beamLandingTofSec(bell, sub, show.site)
    expect(tof).toBeGreaterThan(0.1) // a real time-of-flight, not a rounding hair
    expect(bell.anticipationSec).toBeCloseTo(tof, 9)
    // The keystone identity survives substitution: the wavefront lands ON the moment.
    expect(bell.fireSec + tof).toBeCloseTo(bell.targetSec, 9)
    expect(bell.durationSec).toBe(sub.durationSec)
  })

  it('crowd: the substituted cue re-derives the mast p95 lead for the NEW channel', () => {
    // Custom loud crowd entry (60 dB) so the budget flags it; a custom
    // substitute swaps it for the 40 dB phone starfield, which passes.
    const loudCrowd: CrowdEffect = {
      id: 'crowd-loud-test',
      name: 'Loud Crowd (test only)',
      medium: 'crowd',
      tags: ['crowd'],
      noiseDbAt15m: 60,
      durationSec: 8,
      pattern: 'flood',
      channel: 'wristband',
      maskUpdateHz: 2,
      colors: ['#ffffff'],
    }
    const loudCatalog = new Catalog([...STARTER_EFFECTS, loudCrowd])
    const show = mkShow(
      [
        crowdTrack([
          {
            id: 'cf',
            effectId: 'crowd-loud-test',
            anchor: { kind: 'sec', t: 20 },
            positionId: 'mast-west',
          },
        ]),
      ],
      { noiseBudget: { maxSplDb: 45 } },
    )
    const { cues, diagnostics } = solve(show, loudCatalog, {
      substitute: (id) => (id === 'crowd-loud-test' ? 'crowd-starfield-phone' : undefined),
    })
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(
      diagnostics.some((d) => d.code === 'SPL_BUDGET' && d.severity === 'warning'),
    ).toBe(true)
    const cf = cues.find((c) => c.id === 'cf')!
    expect(cf.effectId).toBe('crowd-starfield-phone')
    // wristband (80 ms) → phone: anticipation is the NEW channel's mast p95.
    expect(cf.anticipationSec).toBe(crowdLatencyFor(show.site, 'mast-west', 'phone'))
    expect(cf.anticipationSec).toBe(1.2)
    expect(cf.fireSec).toBeCloseTo(20 - 1.2, 12)
  })
})

describe('sourceCueId linkage (sourceTag program)', () => {
  const tagCue = (t: number, sourceCueId: string): Cue => ({
    id: 'tag',
    effectId: 'beam-tag-drone',
    anchor: { kind: 'sec', t },
    positionId: 'beam-south-west',
    params: { sourceCueId, targetCellId: nearCell.index },
  })
  const d1: Cue = {
    id: 'd1',
    effectId: 'ring-formation-60',
    anchor: { kind: 'sec', t: 20 },
    positionId: 'pad-1',
    params: { count: 40, scaleM: 24 },
  }

  it('a dangling sourceCueId is a BEAM_SOURCE_UNRESOLVED error', () => {
    const show = mkShow([beamTrack([tagCue(25, 'ghost')])])
    const { diagnostics } = solve(show, catalog)
    const diag = diagnostics.find((d) => d.code === 'BEAM_SOURCE_UNRESOLVED')!
    expect(diag.severity).toBe('error')
    expect(diag.cueIds).toEqual(['tag'])
    expect(diagnostics.filter((d) => d.code === 'BEAM_SOURCE_NOT_CONCURRENT')).toEqual([])
  })

  it('disjoint active windows only warn BEAM_SOURCE_NOT_CONCURRENT', () => {
    // d1 active [20, 32); the 12 s tag lands at 50 → [50, 62): no overlap.
    const show = mkShow([droneTrack([d1]), beamTrack([tagCue(50, 'd1')])])
    const { diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.code === 'BEAM_SOURCE_UNRESOLVED')).toEqual([])
    const warn = diagnostics.find((d) => d.code === 'BEAM_SOURCE_NOT_CONCURRENT')!
    expect(warn.severity).toBe('warning')
    expect(warn.cueIds).toEqual(['tag', 'd1'])
  })

  it('a concurrent drone source raises neither diagnostic', () => {
    // d1 active [20, 32); tag [25, 37): overlap.
    const show = mkShow([droneTrack([d1]), beamTrack([tagCue(25, 'd1')])])
    const { diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.code === 'BEAM_SOURCE_UNRESOLVED')).toEqual([])
    expect(diagnostics.filter((d) => d.code === 'BEAM_SOURCE_NOT_CONCURRENT')).toEqual([])
  })
})

describe('compile — carrier-exposure hook', () => {
  const hotEffect: BeamEffect = {
    id: 'beam-test-hot',
    name: 'Hot Carrier (test only)',
    medium: 'beam',
    tags: ['low-noise', 'beam'],
    noiseDbAt15m: 80,
    durationSec: 6,
    program: 'whisperZone',
    beamWidthDeg: 6,
    carrierBandLabel: 'u-band-40',
    maxCarrierDbAtFocus: 120,
    contentTag: 'test',
  }
  const hotCatalog = new Catalog([...STARTER_EFFECTS, hotEffect])
  const beamShow = (effectId: string): Show =>
    mkShow([
      beamTrack([
        {
          id: 'b1',
          effectId,
          anchor: { kind: 'sec', t: 30 },
          positionId: 'beam-south-west',
          params: { targetCellId: nearCell.index },
        },
      ]),
    ])

  it('a 120 dB carrier at a ~12 m cell breaks the default 110 dB ceiling', () => {
    const compiled = compile(beamShow('beam-test-hot'), hotCatalog)
    const hits = compiled.diagnostics.filter((d) => d.code === 'EXPOSURE_BUDGET')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.cueIds).toContain('b1')
  })

  it('show.exposureBudget overrides the default (never disables the gate)', () => {
    const show = beamShow('beam-test-hot')
    show.exposureBudget = { maxCarrierDb: 130, dwellDb: 125, dwellWindowSec: 60, dwellMaxSec: 30 }
    const compiled = compile(show, hotCatalog)
    expect(compiled.diagnostics.filter((d) => d.code === 'EXPOSURE_BUDGET')).toEqual([])
    expect(compiled.diagnostics.filter((d) => d.code === 'EXPOSURE_DWELL')).toEqual([])
  })

  it('the standard starter entries stay inside the default budget', () => {
    const compiled = compile(beamShow('beam-whisper-narration'), catalog)
    expect(compiled.diagnostics.filter((d) => d.code === 'EXPOSURE_BUDGET')).toEqual([])
    expect(compiled.diagnostics.filter((d) => d.code === 'EXPOSURE_DWELL')).toEqual([])
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('shows without beam cues add no exposure diagnostics', () => {
    const show = mkShow([
      crowdTrack([
        { id: 'w', effectId: 'crowd-flood-rgb', anchor: { kind: 'sec', t: 20 }, positionId: 'mast-east' },
      ]),
    ])
    const compiled = compile(show, catalog)
    expect(
      compiled.diagnostics.filter((d) => d.code === 'EXPOSURE_BUDGET' || d.code === 'EXPOSURE_DWELL'),
    ).toEqual([])
  })
})

describe('determinism', () => {
  it('two identical crowd+beam solves are JSON-identical', () => {
    const show = mkShow([
      crowdTrack([
        { id: 'w', effectId: 'crowd-wave-lateral', anchor: { kind: 'sec', t: 20 }, positionId: 'mast-west' },
      ]),
      beamTrack([
        {
          id: 'toll',
          effectId: 'beam-toll-bell',
          anchor: { kind: 'sec', t: 30 },
          positionId: 'beam-south-west',
          params: { cells: 'all' },
        },
      ]),
    ])
    expect(JSON.stringify(solve(show, catalog))).toBe(JSON.stringify(solve(show, catalog)))
  })
})
