import { describe, expect, it } from 'vitest'
import {
  circleIntersectsPolygon,
  cueSeed,
  distPointToPolyline,
  distPointToSegment,
  fnv1a32,
  mulberry32,
  pointInPolygon,
  sampleCurve,
  segmentsIntersect,
  smoothstep,
  v2,
} from '../src/math/index.js'

describe('rng', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('different seeds diverge', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 8 }, a)
    const seqB = Array.from({ length: 8 }, b)
    expect(seqA).not.toEqual(seqB)
  })

  it('fnv1a32 matches known vectors', () => {
    // Standard FNV-1a 32-bit test vectors.
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })

  it('cueSeed depends only on showSeed and cueId', () => {
    expect(cueSeed(7, 'cue-1')).toBe(cueSeed(7, 'cue-1'))
    expect(cueSeed(7, 'cue-1')).not.toBe(cueSeed(8, 'cue-1'))
    expect(cueSeed(7, 'cue-1')).not.toBe(cueSeed(7, 'cue-2'))
  })
})

describe('vec2 geometry', () => {
  const square = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)]

  it('pointInPolygon', () => {
    expect(pointInPolygon(v2(5, 5), square)).toBe(true)
    expect(pointInPolygon(v2(15, 5), square)).toBe(false)
    expect(pointInPolygon(v2(0, 5), square)).toBe(true) // boundary counts
  })

  it('distPointToSegment', () => {
    expect(distPointToSegment(v2(5, 5), v2(0, 0), v2(10, 0))).toBeCloseTo(5)
    expect(distPointToSegment(v2(-3, 4), v2(0, 0), v2(10, 0))).toBeCloseTo(5)
  })

  it('distPointToPolyline picks the nearest segment', () => {
    const line = [v2(0, 0), v2(10, 0), v2(10, 10)]
    expect(distPointToPolyline(v2(12, 5), line)).toBeCloseTo(2)
  })

  it('circleIntersectsPolygon', () => {
    expect(circleIntersectsPolygon(v2(15, 5), 4, square)).toBe(false)
    expect(circleIntersectsPolygon(v2(15, 5), 6, square)).toBe(true)
    expect(circleIntersectsPolygon(v2(5, 5), 0.1, square)).toBe(true) // inside
  })

  it('segmentsIntersect', () => {
    expect(segmentsIntersect(v2(0, 0), v2(10, 10), v2(0, 10), v2(10, 0))).toBe(true)
    expect(segmentsIntersect(v2(0, 0), v2(1, 1), v2(5, 5), v2(6, 6))).toBe(false)
  })
})

describe('curves', () => {
  it('smoothstep clamps and eases', () => {
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 2)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5)
  })

  it('sampleCurve interpolates and clamps', () => {
    const c = { times: [0, 1, 3], values: [0, 10, 30] }
    expect(sampleCurve(c, -1)).toBe(0)
    expect(sampleCurve(c, 0.5)).toBeCloseTo(5)
    expect(sampleCurve(c, 2)).toBeCloseTo(20)
    expect(sampleCurve(c, 99)).toBe(30)
  })
})
