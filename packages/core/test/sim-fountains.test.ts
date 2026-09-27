/**
 * sim-fountains.test.ts — closed-form water columns: the ballistic rise
 * (h(T/2) = 0.75 H), fire-anchored crests exactly on targetSec for solved
 * cues, hold, fall to zero at the visible end, wave continuity, color
 * alternation, the engine channel, determinism, and the DMX blob.
 */
import { describe, expect, it } from 'vitest'
import type { BuildResult, CompiledCue, JetState } from '../src/contracts.js'
import { GRAVITY_MPS2 } from '../src/contracts.js'
import { fountainRiseSec, getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { FOUNTAIN_WAVE_DEPTH } from '../src/choreo/generators/fountain.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { SimEngine, runHeadless } from '../src/sim/index.js'
import {
  MIST_RISE_FACTOR,
  WAVE_RAMP_PERIODS,
  buildFountainCues,
  fountainAnticipationSec,
  fountainChannelsAt,
  fountainCrestErrorSecMax,
  fountainRiseSecFor,
  jetCrestSec,
  jetHeightAt,
  jetStatesAt,
  waveFactor,
} from '../src/sim/fountains.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)

/** Five-cue fountain show over lakesidePark + odeToJoy (0.5 s/beat). */
function buildShow(seed = 5): BuildResult {
  const tl = buildTimelineFromScore(getScore('odeToJoy')!)
  const m = musicRefs(tl)
  const b = showBuilder({ id: 'sim-fountains', title: 'Sim Fountains', seed, site: lakesidePark(), catalog })
    .music(tl)
    .preRoll(6)
  b.fountains.jet({ id: 'plume', effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(3, 1) }) // 4 s
  b.fountains.cascade({ id: 'casc', effect: 'fountain-cascade-25m', position: 'fount-east', crest: m.barBeat(7, 1) }) // 12 s
  b.fountains.wave({ id: 'wave', effect: 'fountain-wave-15m', position: 'fount-west', crest: m.beat(40) }) // 20 s
  b.fountains.jet({
    id: 'fan',
    effect: 'fountain-fan-20m',
    position: 'fount-east',
    crest: m.beat(56), // 28 s
    rgb: [1, 0, 0],
    rgb2: [0, 0, 1],
  })
  b.fountains.mist({ id: 'mist', position: 'fount-west', from: m.beat(72) }) // 36 s
  return b.build()
}

const built = buildShow()
const cueOf = (id: string): CompiledCue => built.compiled.cues.find((c) => c.id === id)!
const idxOf = (id: string): number => built.compiled.cues.findIndex((c) => c.id === id)
const jetsOf = (states: readonly JetState[], id: string): JetState[] =>
  states.filter((s) => s.cueIdx === idxOf(id)).sort((a, b) => a.nozzle - b.nozzle)

describe('jetHeightAt (pure)', () => {
  const H = 30
  const T = 2
  const crest = 10
  const end = 16

  it('rises on the normalized ballistic arc and crests exactly at crestSec', () => {
    expect(jetHeightAt(7, H, T, crest, end)).toEqual({ heightM: 0, phase: 'falling' })
    expect(jetHeightAt(8, H, T, crest, end)).toEqual({ heightM: 0, phase: 'rising' })
    expect(jetHeightAt(9, H, T, crest, end).heightM).toBeCloseTo(0.75 * H, 12)
    expect(jetHeightAt(9, H, T, crest, end).phase).toBe('rising')
    expect(jetHeightAt(9.999, H, T, crest, end).heightM).toBeLessThan(H)
    expect(jetHeightAt(10, H, T, crest, end)).toEqual({ heightM: H, phase: 'holding' })
  })

  it('matches v₀τ − gτ²/2 with v₀ = sqrt(2gH) when T is the ballistic rise', () => {
    const Tb = fountainRiseSec(H)
    const v0 = Math.sqrt(2 * GRAVITY_MPS2 * H)
    for (const tau of [0.3, 1, 1.9]) {
      const expected = v0 * tau - (GRAVITY_MPS2 * tau * tau) / 2
      expect(jetHeightAt(crest - Tb + tau, H, Tb, crest, end).heightM).toBeCloseTo(expected, 9)
    }
  })

  it('holds, then falls over the last rise time to exactly 0 at the end', () => {
    expect(jetHeightAt(13, H, T, crest, end)).toEqual({ heightM: H, phase: 'holding' })
    expect(jetHeightAt(14, H, T, crest, end)).toEqual({ heightM: H, phase: 'falling' })
    expect(jetHeightAt(15, H, T, crest, end).heightM).toBeCloseTo(0.75 * H, 12)
    expect(jetHeightAt(15.999, H, T, crest, end).heightM).toBeGreaterThan(0)
    expect(jetHeightAt(15.999, H, T, crest, end).heightM).toBeLessThan(0.05)
    expect(jetHeightAt(16, H, T, crest, end)).toEqual({ heightM: 0, phase: 'falling' })
  })

  it('a window shorter than the rise falls straight from the crest', () => {
    expect(jetHeightAt(10, H, T, crest, 11)).toEqual({ heightM: H, phase: 'falling' })
    expect(jetHeightAt(10.5, H, T, crest, 11).heightM).toBeCloseTo(0.75 * H, 12)
    expect(jetHeightAt(11, H, T, crest, 11).heightM).toBe(0)
  })
})

describe('waveFactor (pure)', () => {
  it('is exactly 1 at the crest for every column (continuous with the rise)', () => {
    for (let k = 0; k < 9; k++) expect(waveFactor(k, 9, 0, 2)).toBe(1)
    expect(waveFactor(4, 9, -1, 2)).toBe(1)
  })

  it('dips to 1 − depth half a period after the crest for column 0 once the ramp is in', () => {
    const P = 2
    expect(waveFactor(0, 9, P / 2, P)).toBeCloseTo(1 - FOUNTAIN_WAVE_DEPTH, 12)
    expect(waveFactor(0, 9, P, P)).toBeCloseTo(1, 12)
    expect(WAVE_RAMP_PERIODS).toBe(0.5)
  })

  it('travels down the row: column k is deepest at phase k/n + 1/2, and stays within [1 − depth, 1]', () => {
    const P = 4
    const n = 9
    for (let k = 0; k < n; k++) {
      const deepestT = P * (k / n + 0.5) + P // one extra period so the ramp is complete
      expect(waveFactor(k, n, deepestT, P)).toBeCloseTo(1 - FOUNTAIN_WAVE_DEPTH, 9)
      for (let t = 0; t <= 3 * P; t += 0.05) {
        const f = waveFactor(k, n, t, P)
        expect(f).toBeGreaterThanOrEqual(1 - FOUNTAIN_WAVE_DEPTH - 1e-12)
        expect(f).toBeLessThanOrEqual(1 + 1e-12)
      }
    }
    expect(waveFactor(0, 9, 1, 0)).toBe(1)
    expect(waveFactor(0, 0, 1, 2)).toBe(1)
  })
})

describe('buildFountainCues over a solved show', () => {
  const cues = buildFountainCues(built.compiled, getEffect)

  it('collects the five fountain cues with fire-anchored windows', () => {
    expect(cues.map((c) => c.cue.id).sort()).toEqual(['casc', 'fan', 'mist', 'plume', 'wave'])
    for (const c of cues) {
      expect(c.startSec).toBeCloseTo(c.cue.fireSec + 0.15, 12)
      expect(c.endSec).toBeGreaterThan(c.cue.targetSec + c.cue.durationSec - 1e-9)
    }
  })

  it('a solved cue crests exactly on targetSec: fire + valve + rise = target', () => {
    for (const c of cues) {
      const first = c.jets.reduce((a, j) => (j.delaySec < a.delaySec ? j : a))
      expect(jetCrestSec(c, first)).toBeCloseTo(c.cue.targetSec, 9)
    }
    expect(fountainCrestErrorSecMax(cues, built.show.site)).toBeLessThan(1e-9)
  })

  it('mist stretches its rise by MIST_RISE_FACTOR in both the anticipation and the sim window', () => {
    const mist = cues.find((c) => c.cue.id === 'mist')!
    const rise = fountainRiseSec(4) * MIST_RISE_FACTOR
    expect(MIST_RISE_FACTOR).toBe(2.5)
    expect(mist.riseSec).toBeCloseTo(rise, 12)
    expect(fountainRiseSecFor(mist.effect, 4)).toBeCloseTo(rise, 12)
    expect(fountainAnticipationSec(built.show.site, mist.cue, mist.effect)).toBeCloseTo(0.15 + rise, 12)
    expect(mist.cue.anticipationSec).toBeCloseTo(0.15 + rise, 9)
  })

  it('a mis-solved fixture crests off the beat and the cross-check reports it', () => {
    const wrong = {
      ...built.compiled,
      cues: built.compiled.cues.map((c) => (c.id === 'plume' ? { ...c, fireSec: c.fireSec - 1 } : c)),
    }
    const fixture = buildFountainCues(wrong, getEffect)
    expect(fountainCrestErrorSecMax(fixture, built.show.site)).toBeCloseTo(1, 9)
    const plume = fixture.find((c) => c.cue.id === 'plume')!
    expect(jetCrestSec(plume, plume.jets[0]!)).toBeCloseTo(plume.cue.targetSec - 1, 9)
  })
})

describe('jetStatesAt', () => {
  const cues = buildFountainCues(built.compiled, getEffect)
  const plume = cueOf('plume')
  const T = fountainRiseSec(30)

  it('plume: three centered nozzles at full height, crested, right on the landing', () => {
    const jets = jetsOf(jetStatesAt(cues, plume.targetSec), 'plume')
    expect(jets.map((j) => j.nozzle)).toEqual([3, 4, 5])
    for (const j of jets) {
      expect(j.heightM).toBeCloseTo(30, 9)
      expect(j.crestM).toBe(30)
      expect(j.crested).toBe(true)
      expect(j.phase).toBe('holding')
      expect(j.assetId).toBe('fount-west')
      expect(j.widthM).toBe(1.2)
      expect(j.base.y).toBe(14)
    }
    expect(jets.map((j) => j.base.x)).toEqual([-52, -48, -44])
  })

  it('plume: three-quarter height half a rise before the landing, not yet crested', () => {
    const jets = jetsOf(jetStatesAt(cues, plume.targetSec - T / 2), 'plume')
    expect(jets).toHaveLength(3)
    for (const j of jets) {
      expect(j.heightM).toBeCloseTo(22.5, 9)
      expect(j.crested).toBe(false)
      expect(j.phase).toBe('rising')
    }
  })

  it('plume: dry before first water and at the visible end; falling just before it', () => {
    expect(jetsOf(jetStatesAt(cues, plume.fireSec + 0.1), 'plume')).toHaveLength(0)
    expect(jetsOf(jetStatesAt(cues, plume.targetSec + plume.durationSec), 'plume')).toHaveLength(0)
    const late = jetsOf(jetStatesAt(cues, plume.targetSec + plume.durationSec - 0.01), 'plume')
    expect(late).toHaveLength(3)
    for (const j of late) {
      expect(j.phase).toBe('falling')
      expect(j.heightM).toBeLessThan(0.5)
    }
  })

  it('plume: the effect palette alternates across the engaged nozzles', () => {
    const jets = jetsOf(jetStatesAt(cues, plume.targetSec), 'plume')
    // '#7fd4ff' then '#ffffff' then '#7fd4ff'
    expect([jets[0]!.r, jets[0]!.g, jets[0]!.b].map((v) => Math.round(v * 255))).toEqual([0x7f, 0xd4, 0xff])
    expect([jets[1]!.r, jets[1]!.g, jets[1]!.b]).toEqual([1, 1, 1])
    expect(Math.round(jets[2]!.r * 255)).toBe(0x7f)
  })

  it('fan: rgb/rgb2 params alternate and tips lean antisymmetrically, scaling with height', () => {
    const fan = cueOf('fan')
    const atCrest = jetsOf(jetStatesAt(cues, fan.targetSec), 'fan')
    expect(atCrest).toHaveLength(7)
    expect([atCrest[0]!.r, atCrest[0]!.g, atCrest[0]!.b]).toEqual([1, 0, 0])
    expect([atCrest[1]!.r, atCrest[1]!.g, atCrest[1]!.b]).toEqual([0, 0, 1])
    expect([atCrest[2]!.r, atCrest[2]!.g, atCrest[2]!.b]).toEqual([1, 0, 0])
    const maxOff = 20 * Math.tan((35 * Math.PI) / 180)
    expect(atCrest[0]!.tipDx).toBeCloseTo(-maxOff, 9)
    expect(atCrest[6]!.tipDx).toBeCloseTo(maxOff, 9)
    expect(atCrest[3]!.tipDx).toBeCloseTo(0, 9)
    const halfway = jetsOf(jetStatesAt(cues, fan.targetSec - fountainRiseSec(20) / 2), 'fan')
    expect(halfway[6]!.heightM).toBeCloseTo(15, 9)
    expect(halfway[6]!.tipDx).toBeCloseTo(maxOff * 0.75, 9)
  })

  it('cascade: each column crests 0.25 s (half a beat) after the previous, whole row engaged', () => {
    const casc = cueOf('casc')
    const at0 = jetsOf(jetStatesAt(cues, casc.targetSec), 'casc')
    expect(at0.find((j) => j.nozzle === 0)!.crested).toBe(true)
    expect(at0.find((j) => j.nozzle === 0)!.heightM).toBeCloseTo(25, 9)
    expect(at0.find((j) => j.nozzle === 1)!.crested).toBe(false)
    const at1 = jetsOf(jetStatesAt(cues, casc.targetSec + 0.25), 'casc')
    expect(at1.find((j) => j.nozzle === 1)!.crested).toBe(true)
    expect(at1.find((j) => j.nozzle === 1)!.heightM).toBeCloseTo(25, 9)
    expect(at1.find((j) => j.nozzle === 2)!.crested).toBe(false)
    const at8 = jetsOf(jetStatesAt(cues, casc.targetSec + 2), 'casc')
    expect(at8.find((j) => j.nozzle === 8)!.crested).toBe(true)
    // The last column is dry durationSec after ITS crest, not the cue's.
    expect(jetsOf(jetStatesAt(cues, casc.targetSec + casc.durationSec + 1.9), 'casc')).toHaveLength(1)
    expect(jetsOf(jetStatesAt(cues, casc.targetSec + casc.durationSec + 2), 'casc')).toHaveLength(0)
  })

  it('wave: every column is at the full crest at the landing (continuity), then rolls within bounds', () => {
    const wave = cueOf('wave')
    const atCrest = jetsOf(jetStatesAt(cues, wave.targetSec), 'wave')
    expect(atCrest).toHaveLength(9)
    for (const j of atCrest) expect(j.heightM).toBeCloseTo(15, 9)
    const later = jetsOf(jetStatesAt(cues, wave.targetSec + 3), 'wave')
    const heights = later.map((j) => j.heightM)
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(15 * (1 - FOUNTAIN_WAVE_DEPTH) - 1e-9)
    expect(Math.max(...heights)).toBeLessThanOrEqual(15 + 1e-9)
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(1) // it really undulates
  })

  it('mist: a low wide screen, up 4 m on its landing', () => {
    const mist = cueOf('mist')
    const jets = jetsOf(jetStatesAt(cues, mist.targetSec), 'mist')
    expect(jets).toHaveLength(9)
    for (const j of jets) {
      expect(j.heightM).toBeCloseTo(4, 9)
      expect(j.widthM).toBe(6)
    }
  })
})

describe('engine channel + stats', () => {
  it('runHeadless packs jets into the snapshot and reports the crest cross-check', () => {
    const plume = cueOf('plume')
    const { stats, engine } = runHeadless(built.compiled, { toSec: plume.targetSec })
    const snap = engine.snapshot()
    expect(snap.t).toBeCloseTo(plume.targetSec, 6)
    expect(snap.jets).toHaveLength(3)
    expect(snap.jets.every((j) => j.crested)).toBe(true)
    expect(stats.peakActiveJets).toBe(3)
    expect(stats.fountainCrestErrorSecMax).toBeLessThan(1e-9)
  })

  it('peak jets across the whole show counts both banks: the cascade tail overlaps the wave', () => {
    // casc (east row, 9 columns) is still falling at 20–22 s when the wave
    // (west row, 9 columns) crests at 20 s → 18 concurrent water columns.
    const { stats } = runHeadless(built.compiled)
    expect(stats.peakActiveJets).toBe(18)
    // Before the wave's first water (fire + valve ≈ 18.25 s) only one row is wet.
    const { stats: early } = runHeadless(built.compiled, { toSec: 18 })
    expect(early.peakActiveJets).toBe(9)
  })

  it('seek/chunked advance is step-identical', () => {
    const a = new SimEngine(built.compiled)
    a.advanceTo(21)
    const b = new SimEngine(built.compiled)
    b.advanceTo(12.3)
    b.advanceTo(21)
    expect(JSON.stringify(a.snapshot().jets)).toBe(JSON.stringify(b.snapshot().jets))
    b.advanceTo(4)
    a.advanceTo(4)
    expect(JSON.stringify(a.snapshot().jets)).toBe(JSON.stringify(b.snapshot().jets))
  })
})

describe('determinism', () => {
  it('two builds from scratch produce identical jet states at several instants', () => {
    const other = buildShow()
    const a = buildFountainCues(built.compiled, getEffect)
    const b = buildFountainCues(other.compiled, getEffect)
    for (const t of [3.5, 4, 12.3, 13.7, 21, 28.2, 37]) {
      expect(JSON.stringify(jetStatesAt(a, t))).toBe(JSON.stringify(jetStatesAt(b, t)))
    }
    expect(JSON.stringify(built.compiled)).toBe(JSON.stringify(other.compiled))
  })
})

describe('fountainChannelsAt (DMX blob)', () => {
  const bank = built.show.site.assets.find((a) => a.id === 'fount-west')!
  const spec = bank.fountainBank!

  it('writes [level, r, g, b] per nozzle at the crest and leaves dry nozzles zero', () => {
    const cues = buildFountainCues(built.compiled, getEffect)
    const jets = jetStatesAt(cues, cueOf('plume').targetSec)
    const blob = fountainChannelsAt(jets, bank, spec)
    expect(blob.length).toBe(36)
    const level = Math.round((255 * 30) / 45)
    expect(level).toBe(170)
    expect([...blob.subarray(3 * 4, 4 * 4)]).toEqual([170, 0x7f, 0xd4, 0xff])
    expect([...blob.subarray(4 * 4, 5 * 4)]).toEqual([170, 255, 255, 255])
    expect([...blob.subarray(0, 12)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect([...blob.subarray(24)]).toEqual(new Array(12).fill(0))
  })

  it('MAX-blends concurrent states on one nozzle and ignores other banks', () => {
    const mk = (nozzle: number, heightM: number, rgb: [number, number, number], assetId = 'fount-west'): JetState => ({
      cueIdx: 0,
      assetId,
      nozzle,
      base: { x: 0, y: 0, z: 0 },
      heightM,
      crestM: 45,
      tipDx: 0,
      tipDy: 0,
      widthM: 1,
      r: rgb[0],
      g: rgb[1],
      b: rgb[2],
      phase: 'holding',
      crested: true,
    })
    const blob = fountainChannelsAt(
      [mk(2, 10, [1, 0, 0]), mk(2, 30, [0, 0.5, 0]), mk(2, 5, [0, 0, 1], 'fount-east'), mk(40, 45, [1, 1, 1])],
      bank,
      spec,
    )
    expect([...blob.subarray(8, 12)]).toEqual([170, 255, 128, 0])
    expect(blob.reduce((s, v) => s + v, 0)).toBe(170 + 255 + 128)
    // Reversed order → identical bytes.
    const rev = fountainChannelsAt([mk(2, 30, [0, 0.5, 0]), mk(2, 10, [1, 0, 0])], bank, spec)
    expect([...rev.subarray(8, 12)]).toEqual([170, 255, 128, 0])
  })
})
