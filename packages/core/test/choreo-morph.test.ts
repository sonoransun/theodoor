import { describe, expect, it } from 'vitest'
import { MORPH_DELAY_FRACTION, cost, planMorph, ring } from '../src/choreo/index.js'
import type { Formation } from '../src/contracts.js'

const LIMITS = { vMaxMps: 8, aMaxMps2: 4, rMinM: 3 }

const form = (name: string, pts: readonly [number, number, number][]): Formation => ({
  name,
  points: pts.map(([x, y, z]) => ({ x, y, z })),
})

describe('planMorph', () => {
  it('identity morph: zero cost, zero path length, feasible', () => {
    const f = ring(12, 20) // adjacent spacing ~10.35 m > rMin
    const plan = planMorph(f, f, 5, LIMITS)
    expect(plan.assignment).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect(cost(f.points, f.points, plan.assignment)).toBe(0)
    expect(plan.maxPathLenM).toBe(0)
    expect(plan.minTransitionSec).toBeCloseTo(LIMITS.vMaxMps / LIMITS.aMaxMps2, 12)
    expect(plan.feasible).toBe(true)
    expect(plan.softConflicts).toBe(0)
    expect(plan.waypoints.length).toBe(12)
    for (const w of plan.waypoints) expect(w.path.length).toBe(2)
  })

  it('feasibility flips exactly at T* = L/vMax + vMax/aMax', () => {
    const from = form('a', [[-10, 0, 0]])
    const to = form('b', [[10, 0, 0]])
    const limits = { vMaxMps: 5, aMaxMps2: 5, rMinM: 2 }
    const tStar = 20 / 5 + 5 / 5 // 5 s
    expect(planMorph(from, to, tStar - 1e-6, limits).feasible).toBe(false)
    expect(planMorph(from, to, tStar, limits).feasible).toBe(true)
    expect(planMorph(from, to, tStar + 1e-6, limits).feasible).toBe(true)
    const plan = planMorph(from, to, tStar, limits)
    expect(plan.maxPathLenM).toBeCloseTo(20, 12)
    expect(plan.minTransitionSec).toBeCloseTo(tStar, 12)
  })

  it('close parallel lanes: one drone delayed ([start, start, end]), soft conflict reported', () => {
    // Two lanes 2 m apart (< rMin 3, >= rMin/2 1.5): the delay cannot fully
    // separate them, so the residual is a SOFT conflict; plan stays feasible.
    const from = form('lanes-from', [[0, 0, 0], [0, 0, 2]])
    const to = form('lanes-to', [[20, 0, 0], [20, 0, 2]])
    const plan = planMorph(from, to, 10, LIMITS)
    expect(plan.feasible).toBe(true)
    expect(plan.softConflicts).toBe(1)
    // Drone 0 keeps a plain 2-waypoint path; drone 1 encodes the delayed start.
    expect(plan.waypoints[0]!.path.length).toBe(2)
    const path1 = plan.waypoints[1]!.path
    expect(path1.length).toBe(3)
    expect(path1[0]).toEqual(path1[1])
    expect(path1[2]).toEqual({ x: 20, y: 0, z: 2 })
    expect(MORPH_DELAY_FRACTION).toBe(0.1)
  })

  it('lanes closer than rMin/2 make the plan infeasible (no z-bump replanning)', () => {
    const from = form('tight-from', [[0, 0, 0], [0, 0, 1]])
    const to = form('tight-to', [[20, 0, 0], [20, 0, 1]])
    const plan = planMorph(from, to, 10, LIMITS)
    expect(plan.feasible).toBe(false)
    // Paths remain straight in z: nothing was bumped vertically.
    for (const w of plan.waypoints) {
      const zs = new Set(w.path.map((p) => p.z))
      expect(zs.size).toBe(1)
    }
  })

  it('well-separated crossing paths raise no conflicts', () => {
    const from = form('x-from', [[-30, 0, 0], [0, 0, -30]])
    const to = form('x-to', [[0, 0, 30], [30, 0, 0]])
    const plan = planMorph(from, to, 20, LIMITS)
    expect(plan.feasible).toBe(true)
    expect(plan.softConflicts).toBe(0)
    for (const w of plan.waypoints) expect(w.path.length).toBe(2)
  })

  it('resamples mismatched formation sizes to max(|from|, |to|)', () => {
    const plan = planMorph(ring(10, 40), ring(20, 40), 30, LIMITS)
    expect(plan.waypoints.length).toBe(20)
    expect(plan.assignment.length).toBe(20)
    expect([...plan.assignment].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    )
  })

  it('empty morph yields an empty feasible plan', () => {
    const empty = form('empty', [])
    const plan = planMorph(empty, empty, 1, LIMITS)
    expect(plan.waypoints).toEqual([])
    expect(plan.assignment).toEqual([])
    expect(plan.minTransitionSec).toBe(0)
    expect(plan.feasible).toBe(true)
    expect(plan.softConflicts).toBe(0)
  })

  it('is deterministic across runs', () => {
    const a = planMorph(ring(15, 25), ring(30, 35), 25, LIMITS)
    const b = planMorph(ring(15, 25), ring(30, 35), 25, LIMITS)
    expect(a).toEqual(b)
  })

  it('rejects non-positive kinematic limits', () => {
    const f = ring(4, 10)
    expect(() => planMorph(f, f, 5, { vMaxMps: 0, aMaxMps2: 4, rMinM: 3 })).toThrow()
    expect(() => planMorph(f, f, 5, { vMaxMps: 8, aMaxMps2: -1, rMinM: 3 })).toThrow()
  })
})
