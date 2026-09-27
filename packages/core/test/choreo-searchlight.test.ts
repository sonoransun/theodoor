/**
 * Searchlight figure geometry — the single owner of head aims. Covers the
 * gimbal model (exact lean-then-tilt rotation order), the unit-vector
 * guarantee, slerp edge cases, fractional beats on a real grid, every figure
 * kind, and the chase / sweep-extreme helpers.
 */
import { describe, expect, it } from 'vitest'
import type { CompiledCue, PositionedAsset, SearchlightEffect } from '../src/contracts.js'
import { starterCatalog } from '../src/catalog/index.js'
import {
  LIGHT_CHASE_IDLE,
  LIGHT_FAN_SPREAD_DEG,
  LIGHT_PARK_DIR,
  angleBetweenDeg,
  azimuthDegOf,
  bankHeadBases,
  beatIndexAt,
  chaseLitHead,
  dirFromTilt,
  elevationDegOf,
  figureAimsAt,
  figureIntensityAt,
  fractionalBeatsSince,
  leanAndTilt,
  slerpDir,
  sweepExtremeTimes,
  tiltDegOf,
} from '../src/choreo/generators/searchlight.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'

const catalog = starterCatalog()
const fx = (id: string): SearchlightEffect => {
  const e = catalog.get(id)
  if (e.medium !== 'searchlight') throw new Error(`${id} is not a searchlight`)
  return e
}
const site = lakesidePark()
const west = site.assets.find((a) => a.id === 'lights-west')!
const tl = buildTimelineFromScore(getScore('odeToJoy')!)

const len3 = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z)

/** A compiled-cue stand-in landing at `targetSec` with the given params. */
function cue(effectId: string, targetSec: number, params?: CompiledCue['params']): CompiledCue {
  const c: CompiledCue = {
    id: `c-${effectId}`,
    trackId: 'lights',
    medium: 'searchlight',
    effectId,
    positionId: west.id,
    targetSec,
    fireSec: targetSec,
    anticipationSec: 0,
    durationSec: 12,
    seed: 1,
  }
  if (params) c.params = params
  return c
}

describe('bank head bases', () => {
  it('spaces lakesidePark lights-west heads 6 m apart along the east–west row', () => {
    const bases = bankHeadBases(west, west.searchlightBank!)
    expect(bases.map((b) => b.x)).toEqual([-139, -133, -127, -121])
    for (const b of bases) {
      expect(b.y).toBe(-4)
      expect(b.z).toBe(1.5)
    }
  })

  it('a single head sits at the asset position; a heading-90 bank runs north–south', () => {
    const one: PositionedAsset = { ...west, searchlightBank: { ...west.searchlightBank!, heads: 1 } }
    expect(bankHeadBases(one, one.searchlightBank!)).toEqual([{ x: -130, y: -4, z: 1.5 }])
    const turned: PositionedAsset = { ...west, headingDeg: 90 }
    const bases = bankHeadBases(turned, turned.searchlightBank!)
    for (const b of bases) expect(b.x).toBeCloseTo(-130, 9)
    expect(bases.map((b) => b.y).sort((a, b) => b - a)).toEqual(bases.map((b) => b.y))
    expect(bases[0]!.y - bases[3]!.y).toBeCloseTo(18, 9)
  })
})

describe('angles and directions', () => {
  it('dirFromTilt / tiltDegOf / elevationDegOf / azimuthDegOf round-trip', () => {
    expect(dirFromTilt(0, 123)).toEqual({ x: 0, y: 0, z: 1 })
    const d = dirFromTilt(30, 90)
    expect(d.x).toBeCloseTo(Math.sin(Math.PI / 6), 12)
    expect(d.y).toBeCloseTo(0, 12)
    expect(d.z).toBeCloseTo(Math.cos(Math.PI / 6), 12)
    expect(tiltDegOf(d)).toBeCloseTo(30, 9)
    expect(elevationDegOf(d)).toBeCloseTo(60, 9)
    expect(azimuthDegOf(d)).toBeCloseTo(90, 9)
    expect(azimuthDegOf(dirFromTilt(30, 135))).toBeCloseTo(135, 9)
    expect(azimuthDegOf(dirFromTilt(30, -135))).toBeCloseTo(-135, 9)
    // A vertical direction has no ground projection: azimuth 0 by convention.
    expect(azimuthDegOf(LIGHT_PARK_DIR)).toBe(0)
    // Negative tilt leans the opposite way.
    const s = dirFromTilt(-40, 0)
    expect(s.y).toBeLessThan(0)
    expect(tiltDegOf(s)).toBeCloseTo(40, 9)
  })

  it('leanAndTilt is an exact two-axis gimbal: unit, and reduces to plain tilts', () => {
    const rowAz = 90
    const headAz = 0
    for (const [lean, tilt] of [[0, 25], [35, 0], [30, 20], [-60, 45], [70, -30]] as const) {
      const d = leanAndTilt(lean, rowAz, tilt, headAz)
      expect(len3(d)).toBeCloseTo(1, 12)
      // z = cos λ · cos θ ⇒ tilt-from-vertical = acos(cos λ cos θ).
      const expectTilt =
        Math.acos(Math.cos((lean * Math.PI) / 180) * Math.cos((tilt * Math.PI) / 180)) / (Math.PI / 180)
      expect(tiltDegOf(d)).toBeCloseTo(expectTilt, 9)
    }
    const plainLean = leanAndTilt(33, rowAz, 0, headAz)
    const plainTilt = leanAndTilt(0, rowAz, 27, headAz)
    for (const k of ['x', 'y', 'z'] as const) {
      expect(plainLean[k]).toBeCloseTo(dirFromTilt(33, rowAz)[k], 12)
      expect(plainTilt[k]).toBeCloseTo(dirFromTilt(27, headAz)[k], 12)
    }
    // A lean toward the row plus a tilt toward the heading: the row component
    // is sin λ (the tilt rotates about the row axis and leaves it alone).
    const both = leanAndTilt(30, rowAz, 20, headAz)
    expect(both.x).toBeCloseTo(Math.sin(Math.PI / 6), 12)
    expect(both.y).toBeCloseTo(Math.cos(Math.PI / 6) * Math.sin(Math.PI / 9), 12)
  })

  it('angleBetweenDeg measures the great-circle arc', () => {
    expect(angleBetweenDeg(LIGHT_PARK_DIR, dirFromTilt(40, 90))).toBeCloseTo(40, 9)
    expect(angleBetweenDeg(dirFromTilt(30, 90), dirFromTilt(30, 270))).toBeCloseTo(60, 9)
    expect(angleBetweenDeg(LIGHT_PARK_DIR, LIGHT_PARK_DIR)).toBe(0)
  })

  it('slerpDir hits both endpoints, the exact midpoint, and survives identical/antipodal inputs', () => {
    const a = LIGHT_PARK_DIR
    const b = dirFromTilt(60, 90)
    expect(slerpDir(a, b, 0)).toEqual(a)
    const end = slerpDir(a, b, 1)
    expect(angleBetweenDeg(end, b)).toBeLessThan(1e-9)
    const mid = slerpDir(a, b, 0.5)
    expect(tiltDegOf(mid)).toBeCloseTo(30, 9)
    expect(azimuthDegOf(mid)).toBeCloseTo(90, 9)
    expect(len3(mid)).toBeCloseTo(1, 12)
    // Clamped outside [0, 1].
    expect(slerpDir(a, b, 2)).toEqual(end)
    expect(slerpDir(a, b, -1)).toEqual(a)
    // Identical endpoints: a, no NaN.
    expect(slerpDir(b, b, 0.37)).toEqual(b)
    // Antipodal: unit at every step, perpendicular halfway, never NaN.
    const down = { x: 0, y: 0, z: -1 }
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const v = slerpDir(a, down, u)
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
      expect(len3(v)).toBeCloseTo(1, 9)
    }
    expect(Math.abs(slerpDir(a, down, 0.5).z)).toBeLessThan(1e-9)
    expect(slerpDir(a, down, 1).z).toBeCloseTo(-1, 9)
  })
})

describe('fractional beats', () => {
  it('beatIndexAt maps grid instants to their index, interpolates between, and extrapolates past the ends', () => {
    const beats = tl.beats
    expect(beatIndexAt(beats, beats[0]!)).toBe(0)
    expect(beatIndexAt(beats, beats[7]!)).toBe(7)
    expect(beatIndexAt(beats, (beats[3]! + beats[4]!) / 2)).toBeCloseTo(3.5, 9)
    const n = beats.length
    const last = beats[n - 1]!
    const edge = last - beats[n - 2]!
    expect(beatIndexAt(beats, last + 3 * edge)).toBeCloseTo(n - 1 + 3, 9)
    expect(beatIndexAt(beats, beats[0]! - edge)).toBeCloseTo(-1, 9)
    // Continuous across a beat boundary.
    const t = beats[10]!
    expect(beatIndexAt(beats, t - 1e-7) - beatIndexAt(beats, t + 1e-7)).toBeCloseTo(0, 5)
  })

  it('fractionalBeatsSince is seconds without a grid and grid beats with one (odeToJoy: 0.5 s/beat)', () => {
    expect(fractionalBeatsSince(undefined, 3, 7.25)).toBe(4.25)
    expect(fractionalBeatsSince([], 3, 7.25)).toBe(4.25)
    expect(fractionalBeatsSince([1], 3, 7.25)).toBe(4.25)
    expect(fractionalBeatsSince(tl.beats, 4, 6)).toBeCloseTo(4, 9)
    expect(fractionalBeatsSince(tl.beats, 4, 3)).toBeCloseTo(-2, 9)
  })
})

describe('figureAimsAt', () => {
  const heads = west.searchlightBank!.heads

  it('every figure returns one unit direction per head', () => {
    for (const id of catalog.query({ medium: 'searchlight' }).map((e) => e.id)) {
      const aims = figureAimsAt(cue(id, 4), fx(id), west, 6.3, { beats: tl.beats })
      expect(aims).toHaveLength(heads)
      for (const d of aims) expect(len3(d)).toBeCloseTo(1, 12)
    }
  })

  it('pillar: every head tilted tiltDeg toward the bank heading (up by default)', () => {
    const up = figureAimsAt(cue('light-pillar-white', 4), fx('light-pillar-white'), west, 4)
    for (const d of up) expect(d).toEqual({ x: 0, y: 0, z: 1 })
    const leaned = figureAimsAt(cue('light-pillar-white', 4, { tiltDeg: 20 }), fx('light-pillar-white'), west, 4)
    for (const d of leaned) {
      expect(tiltDegOf(d)).toBeCloseTo(20, 9)
      expect(azimuthDegOf(d)).toBeCloseTo(west.headingDeg, 9) // north — away from the crowd
    }
  })

  it('converge: every head points exactly at the target point', () => {
    const target = { x: 12, y: -4, z: 160 }
    const c = cue('light-converge-spire', 4, { aimX: target.x, aimZ: target.z })
    const aims = figureAimsAt(c, fx('light-converge-spire'), west, 4)
    const bases = bankHeadBases(west, west.searchlightBank!)
    aims.forEach((d, i) => {
      const b = bases[i]!
      const s = (target.z - b.z) / d.z
      expect(b.x + d.x * s).toBeCloseTo(target.x, 6)
      expect(b.y + d.y * s).toBeCloseTo(target.y, 6)
    })
    // Defaults: x = 0, the bank's own y, LIGHT_CONVERGE_ALT_M.
    const def = figureAimsAt(cue('light-converge-spire', 4), fx('light-converge-spire'), west, 4)
    const far = def[0]!
    expect(tiltDegOf(far)).toBeCloseTo((Math.atan2(139, 160 - 1.5) * 180) / Math.PI, 6)
    expect(far.y).toBeCloseTo(0, 12)
    // aimY moves the point off the row.
    const north = figureAimsAt(cue('light-converge-spire', 4, { aimY: 60 }), fx('light-converge-spire'), west, 4)
    for (const d of north) expect(d.y).toBeGreaterThan(0)
  })

  it('fan: symmetric leans along the row to ±spread/2; a negative spread mirrors', () => {
    const aims = figureAimsAt(cue('light-fan-gold', 4), fx('light-fan-gold'), west, 4)
    expect(tiltDegOf(aims[0]!)).toBeCloseTo(LIGHT_FAN_SPREAD_DEG / 2, 9)
    expect(tiltDegOf(aims[3]!)).toBeCloseTo(LIGHT_FAN_SPREAD_DEG / 2, 9)
    expect(aims[0]!.x).toBeCloseTo(-aims[3]!.x, 12) // west end leans west, east end leans east
    expect(aims[1]!.x).toBeCloseTo(-aims[2]!.x, 12)
    expect(aims[0]!.x).toBeLessThan(0)
    expect(tiltDegOf(aims[1]!)).toBeCloseTo(LIGHT_FAN_SPREAD_DEG / 6, 9)
    const wide = figureAimsAt(cue('light-fan-gold', 4, { spreadDeg: 100 }), fx('light-fan-gold'), west, 4)
    expect(tiltDegOf(wide[0]!)).toBeCloseTo(50, 9)
    const mirrored = figureAimsAt(cue('light-fan-gold', 4, { spreadDeg: -60 }), fx('light-fan-gold'), west, 4)
    aims.forEach((d, i) => {
      expect(mirrored[i]!.x).toBeCloseTo(-d.x, 12)
      expect(mirrored[i]!.z).toBeCloseTo(d.z, 12)
    })
    // With tiltDeg the fan tips north as a whole; the row leans keep their sign.
    const tipped = figureAimsAt(cue('light-fan-gold', 4, { tiltDeg: 15 }), fx('light-fan-gold'), west, 4)
    for (const d of tipped) expect(d.y).toBeGreaterThan(0)
    expect(tipped[0]!.x).toBeLessThan(0)
  })

  it('cross: neighbouring heads alternate ±lean so their beams cross', () => {
    const aims = figureAimsAt(cue('light-cross-violet', 4), fx('light-cross-violet'), west, 4)
    expect(aims.map((d) => Math.sign(d.x))).toEqual([1, -1, 1, -1])
    for (const d of aims) expect(tiltDegOf(d)).toBeCloseTo(40, 9)
    const flipped = figureAimsAt(cue('light-cross-violet', 4, { spreadDeg: -40 }), fx('light-cross-violet'), west, 4)
    expect(flipped.map((d) => Math.sign(d.x))).toEqual([-1, 1, -1, 1])
  })

  it('sweep: lean = amp·sin(2π·phase) on the real grid, periodic and continuous, mirrored by a negative amp', () => {
    const c = cue('light-sweep-slow', 4, { sweepDeg: 30, periodBeats: 8 })
    const e = fx('light-sweep-slow')
    const at = (t: number) => figureAimsAt(c, e, west, t, { beats: tl.beats })[0]!
    // 8 beats = 4 s at 120 bpm: quarter period → +amp (east), three quarters → −amp.
    expect(tiltDegOf(at(4))).toBeCloseTo(0, 9)
    expect(tiltDegOf(at(5))).toBeCloseTo(30, 6)
    expect(at(5).x).toBeGreaterThan(0)
    expect(tiltDegOf(at(7))).toBeCloseTo(30, 6)
    expect(at(7).x).toBeLessThan(0)
    // Periodic: same aim one period later; continuous across a beat boundary.
    expect(angleBetweenDeg(at(5.3), at(9.3))).toBeLessThan(1e-6)
    expect(angleBetweenDeg(at(6.5 - 1e-6), at(6.5 + 1e-6))).toBeLessThan(1e-3)
    const m = cue('light-sweep-slow', 4, { sweepDeg: -30, periodBeats: 8 })
    expect(figureAimsAt(m, e, west, 5, { beats: tl.beats })[0]!.x).toBeLessThan(0)
    // Without a grid one beat is one second: the quarter period is 2 s out.
    expect(tiltDegOf(figureAimsAt(c, e, west, 6)[0]!)).toBeCloseTo(30, 6)
  })

  it('chase: aims like a pillar, the lit head advances one per period/heads, deterministically', () => {
    const c = cue('light-chase-beat', 4, { periodBeats: 8 })
    const e = fx('light-chase-beat')
    for (const d of figureAimsAt(c, e, west, 6)) expect(d).toEqual({ x: 0, y: 0, z: 1 })
    // 8 beats = 4 s over 4 heads: one head per second.
    expect([4, 5, 6, 7, 8, 9.99].map((t) => chaseLitHead(c, heads, t, { beats: tl.beats }))).toEqual([
      0, 1, 2, 3, 0, 1,
    ])
    expect(figureIntensityAt(c, e, west, 1, 5, { beats: tl.beats })).toBe(1)
    expect(figureIntensityAt(c, e, west, 0, 5, { beats: tl.beats })).toBe(LIGHT_CHASE_IDLE)
    expect(figureIntensityAt(c, fx('light-pillar-white'), west, 0, 5)).toBe(1)
    // Same inputs, same head — twice.
    expect(chaseLitHead(c, heads, 7.37, { beats: tl.beats })).toBe(chaseLitHead(c, heads, 7.37, { beats: tl.beats }))
  })

  it('sweepExtremeTimes lists every lean peak inside the window (and nothing for other figures)', () => {
    const c = cue('light-sweep-slow', 4, { periodBeats: 8 })
    const times = sweepExtremeTimes(c, fx('light-sweep-slow'), 4, 20, { beats: tl.beats })
    // Peaks at quarter periods: 5, 7, 9, …, 19.
    expect(times.map((t) => Math.round(t * 1000) / 1000)).toEqual([5, 7, 9, 11, 13, 15, 17, 19])
    expect(sweepExtremeTimes(c, fx('light-fan-gold'), 4, 20)).toEqual([])
    expect(sweepExtremeTimes(c, fx('light-sweep-slow'), 4, 4)).toEqual([])
  })
})
