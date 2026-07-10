import { describe, expect, it } from 'vitest'
import { assign, cost, greedyAssign } from '../src/choreo/index.js'
import { mulberry32 } from '../src/math/index.js'
import type { Vec3 } from '../src/contracts.js'

const p = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z })

describe('assign', () => {
  it('identity sets map each point to itself at zero cost', () => {
    const pts = [p(0), p(5), p(10), p(0, 0, 5), p(5, 0, 5)]
    const a = assign(pts, pts)
    expect(a).toEqual([0, 1, 2, 3, 4])
    expect(cost(pts, pts, a)).toBe(0)
  })

  it('fixes a crossing pair via 2-opt (cost strictly drops below greedy)', () => {
    // Greedy grabs (from1 -> to0) first (d^2 = 0.01), forcing from0 -> to1.
    const from = [p(0), p(1)]
    const to = [p(1.1), p(3)]
    const greedy = greedyAssign(from, to)
    expect(greedy).toEqual([1, 0])
    const refined = assign(from, to)
    expect(refined).toEqual([0, 1])
    expect(cost(from, to, refined)).toBeLessThan(cost(from, to, greedy))
    expect(cost(from, to, refined)).toBeCloseTo(1.1 ** 2 + 2 ** 2, 9)
  })

  it('always returns a valid permutation no costlier than greedy (seeded random)', () => {
    const rng = mulberry32(99)
    const rnd = (): Vec3 => p(rng() * 100 - 50, 0, rng() * 100 - 50)
    for (let trial = 0; trial < 5; trial++) {
      const n = 40
      const from = Array.from({ length: n }, rnd)
      const to = Array.from({ length: n }, rnd)
      const a = assign(from, to)
      expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i))
      expect(cost(from, to, a)).toBeLessThanOrEqual(cost(from, to, greedyAssign(from, to)) + 1e-9)
    }
  })

  it('is deterministic across runs', () => {
    const rng = mulberry32(4)
    const from = Array.from({ length: 25 }, () => p(rng() * 60, 0, rng() * 60))
    const to = Array.from({ length: 25 }, () => p(rng() * 60, 0, rng() * 60))
    expect(assign(from, to)).toEqual(assign(from, to))
  })

  it('throws on length mismatch', () => {
    expect(() => assign([p(0)], [p(0), p(1)])).toThrow(/lengths differ/)
    expect(() => cost([p(0)], [p(0)], [])).toThrow(/lengths differ/)
  })
})
