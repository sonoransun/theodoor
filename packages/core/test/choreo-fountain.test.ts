/**
 * choreo-fountain.test.ts — the fountain geometry single owner: nozzle rows,
 * engaged-nozzle selection, fan lean symmetry, beat-grid cascade stagger.
 */
import { describe, expect, it } from 'vitest'
import type { CompiledCue, FountainBankSpec, FountainEffect, PositionedAsset } from '../src/contracts.js'
import { starterCatalog } from '../src/catalog/index.js'
import {
  DEFAULT_FOUNTAIN_BANK,
  FOUNTAIN_CASCADE_STEP_BEATS,
  FOUNTAIN_FAN_MAX_LEAN_DEG,
  bankNozzleBases,
  bankRowDir,
  beatOffsetSec,
  beatsToSecAt,
  cascadeStepBeats,
  engagedNozzles,
  fountainBankSpecOf,
  fountainCrestM,
  jetEnvelopes,
  wavePeriodBeats,
} from '../src/choreo/generators/fountain.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'

const cat = starterCatalog()
const fx = (id: string): FountainEffect => {
  const e = cat.get(id)
  if (e.medium !== 'fountain') throw new Error(`${id} is not a fountain`)
  return e
}
const plume = fx('fountain-plume-30m')
const fan = fx('fountain-fan-20m')
const cascade = fx('fountain-cascade-25m')
const wave = fx('fountain-wave-15m')
const mist = fx('fountain-mist-screen')

const site = lakesidePark()
const west = site.assets.find((a) => a.id === 'fount-west')!
const spec = west.fountainBank!

const cue = (targetSec: number, params?: CompiledCue['params']): CompiledCue => ({
  id: 'f',
  trackId: 'fountains',
  medium: 'fountain',
  effectId: plume.id,
  positionId: west.id,
  targetSec,
  fireSec: targetSec,
  anticipationSec: 0,
  durationSec: 6,
  seed: 1,
  ...(params ? { params } : {}),
})

describe('bank nozzle row', () => {
  it('spaces nine nozzles 4 m apart along east–west for a north-facing bank, centered on pos', () => {
    const bases = bankNozzleBases(west, spec)
    expect(bases).toHaveLength(9)
    expect(bases.map((b) => b.x)).toEqual([-64, -60, -56, -52, -48, -44, -40, -36, -32])
    for (const b of bases) {
      expect(b.y).toBe(14)
      expect(b.z).toBe(0)
    }
    const mean = bases.reduce((s, b) => s + b.x, 0) / bases.length
    expect(mean).toBeCloseTo(west.pos.x, 12)
    expect(bankRowDir(west)).toEqual({ x: 1, y: 0 }) // float noise snapped: exact coordinates
    expect(bankRowDir({ headingDeg: 90 })).toEqual({ x: 0, y: -1 })
  })

  it('runs north–south for a heading-90 bank and collapses a single nozzle onto pos', () => {
    const turned: PositionedAsset = { ...west, headingDeg: 90, pos: { x: 10, y: 20 } }
    const bases = bankNozzleBases(turned, spec)
    for (const b of bases) expect(b.x).toBeCloseTo(10, 9)
    expect(bases[0]!.y).toBeCloseTo(36, 9) // az 180 → row dir (0, −1): nozzle 0 at +16
    expect(bases[8]!.y).toBeCloseTo(4, 9)
    const single = bankNozzleBases(turned, { ...spec, nozzles: 1 })
    expect(single).toEqual([{ x: 10, y: 20, z: 0 }])
  })

  it('falls back to the default bank spec for assets without one', () => {
    expect(fountainBankSpecOf(undefined)).toBe(DEFAULT_FOUNTAIN_BANK)
    expect(fountainBankSpecOf({ ...west, fountainBank: undefined })).toBe(DEFAULT_FOUNTAIN_BANK)
    expect(fountainBankSpecOf(west)).toBe(spec)
  })
})

describe('engagedNozzles', () => {
  it('centers the effect count on the row; 0 means the whole row', () => {
    expect(engagedNozzles(plume, undefined, spec)).toEqual([3, 4, 5])
    expect(engagedNozzles(plume, { nozzles: 0 }, spec)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(engagedNozzles(plume, { nozzles: 1 }, spec)).toEqual([4])
    expect(engagedNozzles(plume, { nozzles: 4 }, spec)).toEqual([2, 3, 4, 5])
    expect(engagedNozzles(plume, { nozzles: 99 }, spec)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(engagedNozzles(fan, undefined, spec)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('cascades, waves, and mist always take the whole row regardless of params', () => {
    for (const e of [cascade, wave, mist]) {
      expect(engagedNozzles(e, { nozzles: 2 }, spec)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    }
  })
})

describe('fountainCrestM and param readers', () => {
  it('honors a positive params.heightM and ignores junk', () => {
    expect(fountainCrestM(plume, undefined)).toBe(30)
    expect(fountainCrestM(plume, { heightM: 40 })).toBe(40)
    expect(fountainCrestM(plume, { heightM: 0 })).toBe(30)
    expect(fountainCrestM(plume, { heightM: -5 })).toBe(30)
    expect(fountainCrestM(plume, { heightM: Number.NaN })).toBe(30)
  })

  it('reads stepBeats / periodBeats with defaults', () => {
    expect(cascadeStepBeats(undefined)).toBe(FOUNTAIN_CASCADE_STEP_BEATS)
    expect(cascadeStepBeats({ stepBeats: 1.5 })).toBe(1.5)
    expect(cascadeStepBeats({ stepBeats: 0 })).toBe(FOUNTAIN_CASCADE_STEP_BEATS)
    expect(wavePeriodBeats(undefined)).toBe(4)
    expect(wavePeriodBeats({ periodBeats: 8 })).toBe(8)
  })
})

describe('beat-grid offsets', () => {
  // A grid that halves its beat length at t = 3: [0,1,2,3] then [3.5, 4, 4.5].
  const beats = [0, 1, 2, 3, 3.5, 4, 4.5]

  it('walks exactly N beats along a tempo-changing grid', () => {
    expect(beatOffsetSec(beats, 2, 2)).toBe(3.5)
    expect(beatOffsetSec(beats, 3.25, 1)).toBeCloseTo(3.75, 12)
    expect(beatOffsetSec(beats, 0, 0.5)).toBe(0.5)
  })

  it('extrapolates with the edge interval and falls back to 1 s/beat without a grid', () => {
    expect(beatOffsetSec(beats, 4.5, 2)).toBeCloseTo(5.5, 12)
    expect(beatOffsetSec(beats, -1, 1)).toBeCloseTo(0, 12)
    expect(beatOffsetSec(undefined, 10, 3)).toBe(13)
    expect(beatOffsetSec([7], 10, 3)).toBe(13)
  })

  it('beatsToSecAt is the duration form (0 for non-positive counts)', () => {
    expect(beatsToSecAt(beats, 2, 2)).toBe(1.5)
    expect(beatsToSecAt(undefined, 10, 3)).toBe(3)
    expect(beatsToSecAt(beats, 2, 0)).toBe(0)
    expect(beatsToSecAt(beats, 2, -1)).toBe(0)
  })
})

describe('jetEnvelopes', () => {
  const tl = buildTimelineFromScore(getScore('odeToJoy')!) // 120 bpm → 0.5 s/beat

  it('plume: vertical, no stagger, crest from the effect', () => {
    const env = jetEnvelopes(cue(4), plume, west, { beats: tl.beats })
    expect(env.map((e) => e.nozzle)).toEqual([3, 4, 5])
    for (const e of env) {
      expect(e.crestM).toBe(30)
      expect(e.tipDx).toBe(0)
      expect(e.tipDy).toBe(0)
      expect(e.delaySec).toBe(0)
    }
    expect(env[1]!.base).toEqual({ x: -48, y: 14, z: 0 })
  })

  it('fan: antisymmetric lean along the row, ±crest·tan(35°) at the ends, vertical center', () => {
    const env = jetEnvelopes(cue(4), fan, west, { beats: tl.beats })
    expect(env).toHaveLength(7)
    const maxOff = 20 * Math.tan((FOUNTAIN_FAN_MAX_LEAN_DEG * Math.PI) / 180)
    expect(env[0]!.tipDx).toBeCloseTo(-maxOff, 9)
    expect(env[6]!.tipDx).toBeCloseTo(maxOff, 9)
    expect(env[3]!.tipDx).toBeCloseTo(0, 12)
    for (let k = 0; k < 7; k++) {
      expect(env[k]!.tipDx).toBeCloseTo(-env[6 - k]!.tipDx, 9)
      expect(env[k]!.tipDy).toBeCloseTo(0, 12)
      expect(env[k]!.delaySec).toBe(0)
    }
    // A single engaged fan nozzle stays vertical.
    const one = jetEnvelopes(cue(4, { nozzles: 1 }), fan, west, { beats: tl.beats })
    expect(one).toHaveLength(1)
    expect(one[0]!.tipDx).toBe(0)
  })

  it('cascade: column k crests k·stepBeats later ON the beat grid; reverse walks back', () => {
    const fwd = jetEnvelopes(cue(12), cascade, west, { beats: tl.beats })
    expect(fwd.map((e) => e.delaySec)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])
    const one = jetEnvelopes(cue(12, { stepBeats: 1 }), cascade, west, { beats: tl.beats })
    expect(one.map((e) => e.delaySec)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
    const rev = jetEnvelopes(cue(12, { reverse: true }), cascade, west, { beats: tl.beats })
    expect(rev.map((e) => e.delaySec)).toEqual([2, 1.75, 1.5, 1.25, 1, 0.75, 0.5, 0.25, 0])
    // Without a grid: 1 s per beat.
    const noGrid = jetEnvelopes(cue(12), cascade, west)
    expect(noGrid[8]!.delaySec).toBe(4)
  })

  it('cascade stagger slows with a ritardando (uses the tempo map, not a fixed beat length)', () => {
    const asset: PositionedAsset = { ...west, fountainBank: { ...spec, nozzles: 3 } }
    const slowing = [10, 11, 12, 13.5, 15, 16.5]
    const env = jetEnvelopes(cue(12, { stepBeats: 1 }), cascade, asset, { beats: slowing })
    expect(env.map((e) => e.delaySec)).toEqual([0, 1.5, 3])
  })

  it('wave and mist: whole row, no static stagger', () => {
    for (const e of [wave, mist]) {
      const env = jetEnvelopes(cue(20), e, west, { beats: tl.beats })
      expect(env).toHaveLength(9)
      expect(env.every((j) => j.delaySec === 0 && j.tipDx === 0)).toBe(true)
    }
  })

  it('uses the default bank when the asset carries no spec', () => {
    const bare: PositionedAsset = { id: 'x', kind: 'fountainBank', pos: { x: 5, y: 5 }, headingDeg: 0, elevationM: 0 }
    const env = jetEnvelopes(cue(4), plume, bare)
    expect(env).toHaveLength(1)
    expect(env[0]!.base).toEqual({ x: 5, y: 5, z: 0 })
    const bankSpec: FountainBankSpec = fountainBankSpecOf(bare)
    expect(bankSpec.maxHeightM).toBe(60)
  })
})
