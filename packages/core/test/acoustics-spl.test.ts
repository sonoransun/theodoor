import { describe, expect, it } from 'vitest'
import type {
  CompiledCue,
  CompiledShow,
  EffectDef,
  MusicalTimeline,
  PyroCategory,
  PyroEffect,
  SitePlan,
} from '../src/contracts.js'
import { IMPULSE_WINDOW_SEC, SPL_REF_DISTANCE_M } from '../src/contracts.js'
import { mulberry32, v2 } from '../src/math/index.js'
import {
  cueNoiseWindow,
  cueSourcePos,
  isImpulseEffect,
  splAtDistance,
  splAtInstant,
  splTimeline,
  sumSpl,
} from '../src/acoustics/index.js'

// ---------------------------------------------------------------------------
// Tiny inline fixtures
// ---------------------------------------------------------------------------

function pyroEffect(
  id: string,
  category: PyroCategory,
  noiseDbAt15m: number,
  durationSec: number,
  tags: readonly string[] = [],
): PyroEffect {
  return {
    id,
    name: id,
    medium: 'pyro',
    tags,
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
const PEONY = pyroEffect('fx-peony', 'peony', 110, 2)
const EFFECTS = new Map<string, EffectDef>([
  [SALUTE.id, SALUTE],
  [PEONY.id, PEONY],
])
const getEffect = (id: string): EffectDef | undefined => EFFECTS.get(id)

function makeSite(): SitePlan {
  return {
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
    refListenerPos: [v2(0, 0)],
  }
}

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

function makeShow(cues: CompiledCue[], preRollSec = 0, duration = 30): CompiledShow {
  const music: MusicalTimeline = {
    source: 'analysis',
    id: 'music-1',
    title: 'Fixture',
    duration,
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
      meta: { id: 'show-1', title: 'Fixture Show', variant: 'standard', seed: 7 },
      music,
      site: makeSite(),
      catalogId: 'catalog-1',
      tracks: [],
      preRollSec,
    },
    cues,
    diagnostics: [],
  }
}

/** Expected propagated level: listener at (0,0), rackA at (0,100) ⇒ 100 m. */
const levelAt = (dbAtRef: number, distM: number): number =>
  dbAtRef - 20 * Math.log10(Math.max(1, distM) / SPL_REF_DISTANCE_M)

// ---------------------------------------------------------------------------
// splAtDistance
// ---------------------------------------------------------------------------

describe('splAtDistance', () => {
  it('loses 6.02 dB per distance doubling (property over random distances)', () => {
    const rand = mulberry32(0xacc0)
    const drop = 20 * Math.log10(2)
    for (let i = 0; i < 300; i++) {
      const d = 1 + rand() * 800 // ≥ 1 m so the clamp never engages
      const dbAtRef = 60 + rand() * 80
      const near = splAtDistance(dbAtRef, SPL_REF_DISTANCE_M, d)
      const far = splAtDistance(dbAtRef, SPL_REF_DISTANCE_M, 2 * d)
      expect(near - far).toBeCloseTo(drop, 9)
    }
  })

  it('returns the reference level at the reference distance', () => {
    expect(splAtDistance(114, 15, 15)).toBeCloseTo(114, 12)
  })

  it('clamps distance to 1 m (no +Infinity inside the source)', () => {
    const atOne = splAtDistance(120, 15, 1)
    expect(splAtDistance(120, 15, 0.25)).toBe(atOne)
    expect(splAtDistance(120, 15, 0)).toBe(atOne)
    expect(Number.isFinite(atOne)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// sumSpl
// ---------------------------------------------------------------------------

describe('sumSpl', () => {
  it('sums two equal 90 dB sources to ~93.0103 dB', () => {
    expect(Math.abs(sumSpl([90, 90]) - 93.0103)).toBeLessThan(0.01)
  })

  it('is the identity for a single level', () => {
    expect(sumSpl([87.3])).toBeCloseTo(87.3, 9)
  })

  it('returns -Infinity (not NaN) for an empty set', () => {
    expect(sumSpl([])).toBe(-Infinity)
    expect(Number.isNaN(sumSpl([]))).toBe(false)
  })

  it('treats -Infinity members as silent', () => {
    expect(sumSpl([-Infinity])).toBe(-Infinity)
    expect(sumSpl([90, -Infinity])).toBeCloseTo(90, 9)
  })
})

// ---------------------------------------------------------------------------
// cueNoiseWindow / cueSourcePos
// ---------------------------------------------------------------------------

describe('cueNoiseWindow', () => {
  it('salute clamps to the impulse window; peony keeps its full duration', () => {
    const salute = makeCue('c1', SALUTE.id, 10)
    const peony = makeCue('c2', PEONY.id, 10)
    expect(cueNoiseWindow(salute, SALUTE)).toEqual({
      start: 10,
      end: 10 + IMPULSE_WINDOW_SEC,
    })
    expect(cueNoiseWindow(peony, PEONY)).toEqual({ start: 10, end: 12 })
  })

  it('starts at targetSec, not fireSec (the rise is quiet)', () => {
    const cue = makeCue('c1', PEONY.id, 10)
    expect(cue.fireSec).toBeLessThan(10)
    expect(cueNoiseWindow(cue, PEONY).start).toBe(10)
  })

  it("an 'impulse'-tagged non-salute effect also clamps", () => {
    const tagged = pyroEffect('fx-imp', 'mine', 115, 3, ['impulse'])
    expect(isImpulseEffect(tagged)).toBe(true)
    const w = cueNoiseWindow(makeCue('c1', 'fx-imp', 4), tagged)
    expect(w.end - w.start).toBe(IMPULSE_WINDOW_SEC)
  })

  it('an impulse shorter than the window keeps its own duration', () => {
    const shortSalute = pyroEffect('fx-short', 'salute', 118, 0.3)
    const w = cueNoiseWindow(makeCue('c1', 'fx-short', 4), shortSalute)
    expect(w.end - w.start).toBeCloseTo(0.3, 12)
  })
})

describe('cueSourcePos', () => {
  const site = makeSite()

  it('resolves the positionId asset', () => {
    expect(cueSourcePos(makeCue('c1', PEONY.id, 0), site)).toEqual(v2(0, 100))
  })

  it('falls back to the site origin without throwing', () => {
    const dangling = { ...makeCue('c1', PEONY.id, 0), positionId: 'nope' }
    const none = { ...makeCue('c2', PEONY.id, 0), positionId: undefined }
    expect(cueSourcePos(dangling, site)).toEqual(v2(0, 0))
    expect(cueSourcePos(none, site)).toEqual(v2(0, 0))
  })
})

// ---------------------------------------------------------------------------
// splAtInstant
// ---------------------------------------------------------------------------

describe('splAtInstant', () => {
  const listener = v2(0, 0) // 100 m from rackA

  it('is silent during the rise, audible from the burst, half-open at the end', () => {
    const compiled = makeShow([makeCue('boom', SALUTE.id, 10)])
    const expected = levelAt(120, 100)
    expect(splAtInstant(compiled, getEffect, listener, 9.9)).toBe(-Infinity)
    expect(splAtInstant(compiled, getEffect, listener, 10)).toBeCloseTo(expected, 9)
    expect(splAtInstant(compiled, getEffect, listener, 10.49)).toBeCloseTo(expected, 9)
    // exactly at the window end: excluded (half-open)
    expect(splAtInstant(compiled, getEffect, listener, 10.5)).toBe(-Infinity)
  })

  it('returns -Infinity, never NaN, with no active cues', () => {
    const compiled = makeShow([])
    const dB = splAtInstant(compiled, getEffect, listener, 5)
    expect(dB).toBe(-Infinity)
    expect(Number.isNaN(dB)).toBe(false)
  })

  it('skips cues whose effect the lookup does not know', () => {
    const compiled = makeShow([makeCue('ghost', 'fx-unknown', 10)])
    expect(splAtInstant(compiled, getEffect, listener, 10)).toBe(-Infinity)
  })
})

// ---------------------------------------------------------------------------
// splTimeline
// ---------------------------------------------------------------------------

describe('splTimeline', () => {
  const listener = v2(0, 0)
  const solo = levelAt(120, 100)
  const both = solo + 10 * Math.log10(2)

  it('two overlapping salutes: the sum appears only inside the overlap', () => {
    const compiled = makeShow([
      makeCue('a', SALUTE.id, 10),
      makeCue('b', SALUTE.id, 10.25),
    ])
    const tl = splTimeline(compiled, getEffect, listener)
    const overlap = tl.filter((s) => s.contributors.length === 2)
    const single = tl.filter((s) => s.contributors.length === 1)
    const quiet = tl.filter((s) => s.contributors.length === 0)

    expect(overlap.length).toBeGreaterThan(0)
    for (const s of overlap) {
      expect(s.tSec).toBeGreaterThanOrEqual(10.25 - 1e-9)
      expect(s.tSec).toBeLessThan(10.5)
      expect(s.dB).toBeCloseTo(both, 6)
      expect(s.contributors).toEqual(['a', 'b'])
    }
    for (const s of single) expect(s.dB).toBeCloseTo(solo, 6)
    for (const s of quiet) expect(s.dB).toBe(-Infinity)
  })

  it('offset salutes never sum', () => {
    const compiled = makeShow([
      makeCue('a', SALUTE.id, 10),
      makeCue('b', SALUTE.id, 12),
    ])
    const tl = splTimeline(compiled, getEffect, listener)
    expect(tl.every((s) => s.contributors.length <= 1)).toBe(true)
    const peak = Math.max(...tl.map((s) => s.dB))
    expect(peak).toBeCloseTo(solo, 6)
  })

  it('sweeps from -preRoll to the show duration', () => {
    const compiled = makeShow([makeCue('a', PEONY.id, 5)], 3, 20)
    const tl = splTimeline(compiled, getEffect, listener, 0.5)
    expect(tl[0]!.tSec).toBe(-3)
    expect(tl[tl.length - 1]!.tSec).toBeCloseTo(20, 9)
    // step count: (20 - -3) / 0.5 + 1 samples
    expect(tl.length).toBe(47)
  })

  it('silent samples report -Infinity, never NaN', () => {
    const compiled = makeShow([])
    const tl = splTimeline(compiled, getEffect, listener)
    expect(tl.length).toBeGreaterThan(0)
    for (const s of tl) {
      expect(s.dB).toBe(-Infinity)
      expect(Number.isNaN(s.dB)).toBe(false)
      expect(s.contributors).toEqual([])
    }
  })
})
