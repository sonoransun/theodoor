import { describe, expect, it } from 'vitest'
import type {
  CompiledCue,
  CompiledShow,
  EffectDef,
  MusicalTimeline,
  PyroCategory,
  PyroEffect,
  SitePlan,
  Vec2,
} from '../src/contracts.js'
import { SPL_REF_DISTANCE_M } from '../src/contracts.js'
import { v2 } from '../src/math/index.js'
import { quietReport } from '../src/acoustics/index.js'

// ---------------------------------------------------------------------------
// Tiny inline fixtures (listener at (0,0) is 100 m from rackA at (0,100))
// ---------------------------------------------------------------------------

function pyroEffect(
  id: string,
  category: PyroCategory,
  noiseDbAt15m: number,
  durationSec: number,
): PyroEffect {
  return {
    id,
    name: id,
    medium: 'pyro',
    tags: [],
    noiseDbAt15m,
    durationSec,
    category,
    caliberMm: 75,
    riseTimeSec: 2.2,
    burstHeightM: 90,
    burstRadiusM: 30,
    starCount: 60,
    colors: ['#ff8040'],
    dragK: 0.4,
    gravityBias: 0.2,
    minAudienceDistanceM: 70,
  }
}

const SALUTE = pyroEffect('fx-salute', 'salute', 120, 1.5)
const PEONY = pyroEffect('fx-peony', 'peony', 105, 2)
const LOUD_PEONY = pyroEffect('fx-loud-peony', 'peony', 118, 2)
const EFFECTS = new Map<string, EffectDef>([
  [SALUTE.id, SALUTE],
  [PEONY.id, PEONY],
  [LOUD_PEONY.id, LOUD_PEONY],
])
const getEffect = (id: string): EffectDef | undefined => EFFECTS.get(id)

function makeCue(id: string, effectId: string, targetSec: number): CompiledCue {
  return {
    id,
    trackId: 'pyro-main',
    medium: 'pyro',
    effectId,
    positionId: 'rackA',
    targetSec,
    fireSec: targetSec - 2.2,
    anticipationSec: 2.2,
    durationSec: EFFECTS.get(effectId)?.durationSec ?? 0,
    seed: 1,
  }
}

function makeShow(
  cues: CompiledCue[],
  listeners: readonly Vec2[] = [v2(0, 0)],
): CompiledShow {
  const site: SitePlan = {
    id: 'site-1',
    assets: [
      {
        id: 'rackA',
        kind: 'mortarRack',
        pos: v2(0, 100),
        headingDeg: 0,
        elevationM: 0,
      },
    ],
    audience: [v2(-50, 0), v2(50, 0)],
    audienceZone: [v2(-50, 0), v2(50, 0), v2(50, -30), v2(-50, -30)],
    exclusionZones: [],
    geofence: [v2(-200, -50), v2(200, -50), v2(200, 300), v2(-200, 300)],
    maxAltitudeM: 200,
    wind: { dirDegFrom: 0, speedMps: 0, limitMps: 10 },
    refListenerPos: listeners,
  }
  const music: MusicalTimeline = {
    source: 'analysis',
    id: 'music-1',
    title: 'Fixture',
    duration: 30,
    tempo: {
      segments: [{ beat: 0, bpm: 120 }],
      meters: [{ bar: 1, beatsPerBar: 4 }],
    },
    beats: [],
    downbeats: [],
    annotations: [],
    energy: [],
    tempoConfidence: 1,
  }
  return {
    show: {
      meta: { id: 'show-1', title: 'Fixture Show', variant: 'quiet', seed: 7 },
      music,
      site,
      catalogId: 'catalog-1',
      tracks: [],
      preRollSec: 0,
      noiseBudget: { maxSplDb: 100 },
    },
    cues,
    diagnostics: [],
  }
}

const levelAt = (dbAtRef: number, distM: number): number =>
  dbAtRef - 20 * Math.log10(Math.max(1, distM) / SPL_REF_DISTANCE_M)

// salute at 100 m ⇒ ~103.52 dB at the default listener
const SALUTE_AT_100M = levelAt(120, 100)

// ---------------------------------------------------------------------------

describe('quietReport', () => {
  it('passes when the budget sits above the peak', () => {
    const compiled = makeShow([makeCue('boom', SALUTE.id, 10)])
    const report = quietReport(compiled, getEffect, 110)
    expect(report.pass).toBe(true)
    expect(report.peakDb).toBeCloseTo(SALUTE_AT_100M, 6)
    expect(report.violations).toEqual([])
    expect(report.substitutionHints).toEqual([])
    expect(report.budgetDb).toBe(110)
  })

  it('passes exactly at the budget (peak <= budget)', () => {
    const compiled = makeShow([makeCue('boom', SALUTE.id, 10)])
    const report = quietReport(compiled, getEffect, SALUTE_AT_100M)
    expect(report.pass).toBe(true)
  })

  it('fails below the peak and reports one contiguous violation window', () => {
    const compiled = makeShow([makeCue('boom', SALUTE.id, 10)])
    const report = quietReport(compiled, getEffect, 95)
    expect(report.pass).toBe(false)
    expect(report.peakDb).toBeCloseTo(SALUTE_AT_100M, 6)
    expect(report.peakTSec).toBeGreaterThanOrEqual(10)
    expect(report.peakTSec).toBeLessThan(10.5)
    expect(report.worstListenerIndex).toBe(0)
    expect(report.violations).toHaveLength(1)
    const w = report.violations[0]!
    expect(w.tStart).toBeCloseTo(10, 6)
    expect(w.tEnd).toBeGreaterThanOrEqual(10.4)
    expect(w.tEnd).toBeLessThanOrEqual(10.7)
    expect(w.peakDb).toBeCloseTo(SALUTE_AT_100M, 6)
    expect(w.cueIds).toEqual(['boom'])
  })

  it('names the loudest contributing cue in the substitution hint', () => {
    const compiled = makeShow([
      makeCue('boom', SALUTE.id, 10), // 120 dB @ ref — the loud one
      makeCue('bloom', PEONY.id, 10), // 105 dB @ ref
    ])
    const report = quietReport(compiled, getEffect, 95)
    expect(report.pass).toBe(false)
    expect(report.violations.length).toBeGreaterThan(0)
    expect(report.violations[0]!.cueIds).toContain('boom')
    expect(report.violations[0]!.cueIds).toContain('bloom')
    expect(report.substitutionHints[0]!.cueId).toBe('boom')
    expect(report.substitutionHints[0]!.reason).toMatch(/quieter/)
  })

  it('coalesces separated bursts into separate windows, impulse hints first', () => {
    const compiled = makeShow([
      makeCue('bloom', LOUD_PEONY.id, 5), // window [5,7): loudest is a peony
      makeCue('boom', SALUTE.id, 20), // window [20,20.5): a salute
    ])
    const report = quietReport(compiled, getEffect, 95)
    expect(report.violations).toHaveLength(2)
    expect(report.violations[0]!.cueIds).toEqual(['bloom'])
    expect(report.violations[1]!.cueIds).toEqual(['boom'])
    // one hint per window, deduped, salutes (impulse sources) sorted first
    expect(report.substitutionHints.map((h) => h.cueId)).toEqual(['boom', 'bloom'])
  })

  it('takes the worst listener over ALL listeners for pass/fail', () => {
    const far = v2(0, 0) // 100 m ⇒ ~103.5 dB
    const near = v2(0, 70) // 30 m  ⇒ ~114.0 dB
    const compiled = makeShow([makeCue('boom', SALUTE.id, 10)], [far, near])
    const report = quietReport(compiled, getEffect, 108)
    // The far listener alone would pass; the near one must fail the show.
    expect(report.pass).toBe(false)
    expect(report.worstListenerIndex).toBe(1)
    expect(report.peakDb).toBeCloseTo(levelAt(120, 30), 6)
  })

  it('a silent show passes with -Infinity peak (never NaN)', () => {
    const compiled = makeShow([])
    const report = quietReport(compiled, getEffect, 90)
    expect(report.pass).toBe(true)
    expect(report.peakDb).toBe(-Infinity)
    expect(Number.isNaN(report.peakDb)).toBe(false)
    expect(report.violations).toEqual([])
    expect(report.substitutionHints).toEqual([])
  })

  it('uses the site refListenerPos by default', () => {
    const near = v2(0, 70)
    const compiled = makeShow([makeCue('boom', SALUTE.id, 10)], [near])
    const report = quietReport(compiled, getEffect, 90)
    expect(report.worstListenerIndex).toBe(0)
    expect(report.peakDb).toBeCloseTo(levelAt(120, 30), 6)
  })
})

describe('sweep coverage (post-review regressions)', () => {
  it('a cue landing after the music duration cannot escape the gate', () => {
    // makeShow's music.duration is far shorter than t=200; before the sweep
    // extension the timeline stopped at the music tail and this salute was
    // never sampled — the gate passed a show that is far over budget.
    const compiled = makeShow([makeCue('late', 'fx-salute', 200)])
    const report = quietReport(compiled, getEffect, 85)
    expect(report.pass).toBe(false)
    expect(report.peakTSec).toBeGreaterThanOrEqual(200)
  })

  it('sub-dtSec overlap slivers are sampled exactly (window breakpoints)', () => {
    // Two salutes overlapping for 0.04 s — narrower than the 0.1 s grid.
    // Breakpoint sampling must see the summed level (+3 dB) in the sliver.
    const a = makeCue('a', 'fx-salute', 10)
    const b = makeCue('b', 'fx-salute', 10.46) // impulse windows: [10,10.5) and [10.46,10.96)
    const compiled = makeShow([a, b])
    const solo = quietReport(makeShow([a]), getEffect, 999).peakDb
    const both = quietReport(compiled, getEffect, 999).peakDb
    expect(both).toBeCloseTo(solo + 10 * Math.log10(2), 1)
  })
})
