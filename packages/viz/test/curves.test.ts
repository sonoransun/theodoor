import { describe, expect, it } from 'vitest'
import { TWO_PI, hashPhase, starAlpha } from '../src/render/curves.js'

describe('starAlpha', () => {
  it('is exactly 0 at u = 1 and beyond (no NaN from the fractional power)', () => {
    for (const t of [0, 0.37, 12.9]) {
      for (const [f, phi] of [[6, 0], [14, 2.1], [9.5, 5.9]] as const) {
        expect(starAlpha(1, t, f, phi)).toBe(0)
        expect(starAlpha(1.5, t, f, phi)).toBe(0)
        expect(starAlpha(100, t, f, phi)).toBe(0)
      }
    }
  })

  it('has a strictly decreasing fade envelope pow(1-u, 1.8)', () => {
    const t = 0.37
    const f = 8
    const phi = 1.2
    const base = starAlpha(0, t, f, phi)
    expect(base).toBeGreaterThan(0)
    let prev = Infinity
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const a = starAlpha(u, t, f, phi)
      // Same (t, f, phi) → the twinkle factor divides out exactly.
      expect(a / base).toBeCloseTo(Math.pow(Math.max(0, 1 - u), 1.8), 12)
      expect(a).toBeLessThan(prev)
      prev = a
    }
  })

  it('twinkles within [0.5, 1.0] × envelope and hits the modulation', () => {
    const u = 0.25
    const env = Math.pow(1 - u, 1.8)
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < 500; i++) {
      const a = starAlpha(u, i * 0.013, 7.3, 0.4)
      expect(a).toBeGreaterThanOrEqual(0.5 * env - 1e-12)
      expect(a).toBeLessThanOrEqual(1.0 * env + 1e-12)
      lo = Math.min(lo, a)
      hi = Math.max(hi, a)
    }
    // The sine actually modulates (not a constant).
    expect(hi - lo).toBeGreaterThan(0.3 * env)
  })

  it('is deterministic', () => {
    expect(starAlpha(0.3, 4.56, 11.2, 2.34)).toBe(starAlpha(0.3, 4.56, 11.2, 2.34))
  })
})

describe('hashPhase', () => {
  it('is deterministic for the same (seed, index)', () => {
    for (let i = 0; i < 50; i++) {
      expect(hashPhase(12345, i)).toBe(hashPhase(12345, i))
    }
  })

  it('stays in [0, 2π)', () => {
    for (let i = 0; i < 500; i++) {
      const p = hashPhase(0xdecafbad, i)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(TWO_PI)
    }
  })

  it('spreads phases across indices and seeds', () => {
    const phases = new Set<number>()
    for (let i = 0; i < 200; i++) phases.add(hashPhase(777, i))
    expect(phases.size).toBeGreaterThan(195)
    expect(hashPhase(1, 0)).not.toBe(hashPhase(2, 0))
  })
})
