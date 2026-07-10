/**
 * Morph planning: formation → formation transitions for the drone fleet.
 *
 * planMorph resamples both formations to a common count, assigns drones to
 * targets (greedy + 2-opt), lays a straight path per drone, and evaluates
 * trapezoidal-profile feasibility plus pairwise collision risk.
 *
 * DELAYED-START CONVENTION (consumed by sim and the waypoint exporter):
 * a path whose first two waypoints are IDENTICAL — [start, start, end] —
 * means the drone holds at `start` for MORPH_DELAY_FRACTION × transitionSec
 * and then flies start → end over the remaining (1 − MORPH_DELAY_FRACTION)
 * × transitionSec. Paths are never mutated vertically (z-bump replanning is
 * cut for v1); conflicts that one delay round cannot clear are *reported*:
 * pairs still closer than rMinM/2 make the plan infeasible, milder residual
 * pairs are tallied in `softConflicts` for downstream diagnostics.
 */

import type { Formation, MorphPlan, Seconds, Vec3 } from '../../contracts.js'
import { dist3, fnv1a32, forkSeed } from '../../math/index.js'
import { assign } from './assignment.js'
import { resampleTo } from './formations.js'

/** Fraction of transitionSec a delayed drone holds at its start point. */
export const MORPH_DELAY_FRACTION = 0.1

/** Uniform u-samples per path pair when checking separation. */
export const MORPH_COLLISION_SAMPLES = 20

export interface MorphLimits {
  vMaxMps: number
  aMaxMps2: number
  /** Minimum pairwise separation. */
  rMinM: number
}

export interface MorphResult extends MorphPlan {
  /**
   * Pairs still within rMinM (but no closer than rMinM/2) after the single
   * delay round — reported, not fixed (z-bump replanning is cut for v1).
   */
  softConflicts: number
}

function posAt(s: Vec3, e: Vec3, isDelayed: boolean, u: number): Vec3 {
  let v = u
  if (isDelayed) {
    v = u <= MORPH_DELAY_FRACTION ? 0 : (u - MORPH_DELAY_FRACTION) / (1 - MORPH_DELAY_FRACTION)
  }
  return { x: s.x + (e.x - s.x) * v, y: s.y + (e.y - s.y) * v, z: s.z + (e.z - s.z) * v }
}

function minSeparation(
  starts: readonly Vec3[],
  ends: readonly Vec3[],
  delayed: readonly boolean[],
  i: number,
  j: number,
): number {
  let best = Infinity
  for (let k = 0; k < MORPH_COLLISION_SAMPLES; k++) {
    const u = k / (MORPH_COLLISION_SAMPLES - 1)
    const a = posAt(starts[i]!, ends[i]!, delayed[i]!, u)
    const b = posAt(starts[j]!, ends[j]!, delayed[j]!, u)
    const d = dist3(a, b)
    if (d < best) best = d
  }
  return best
}

/**
 * Candidate close pairs via a spatial hash of path-segment AABBs (each
 * inflated by rMinM so any pair that could come within rMinM shares a cell).
 * Returned sorted by (i, j) for determinism.
 */
function candidatePairs(
  starts: readonly Vec3[],
  ends: readonly Vec3[],
  rMin: number,
  maxLen: number,
): Array<readonly [number, number]> {
  const n = starts.length
  const cell = Math.max(2 * rMin, maxLen / 8, 1)
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const s = starts[i]!
    const e = ends[i]!
    const x0 = Math.floor((Math.min(s.x, e.x) - rMin) / cell)
    const x1 = Math.floor((Math.max(s.x, e.x) + rMin) / cell)
    const y0 = Math.floor((Math.min(s.y, e.y) - rMin) / cell)
    const y1 = Math.floor((Math.max(s.y, e.y) + rMin) / cell)
    const z0 = Math.floor((Math.min(s.z, e.z) - rMin) / cell)
    const z1 = Math.floor((Math.max(s.z, e.z) + rMin) / cell)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = `${ix},${iy},${iz}`
          const b = buckets.get(key)
          if (b) b.push(i)
          else buckets.set(key, [i])
        }
      }
    }
  }
  const seen = new Set<number>()
  const out: Array<readonly [number, number]> = []
  for (const ids of buckets.values()) {
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const i = Math.min(ids[a]!, ids[b]!)
        const j = Math.max(ids[a]!, ids[b]!)
        const key = i * n + j
        if (!seen.has(key)) {
          seen.add(key)
          out.push([i, j])
        }
      }
    }
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1])
  return out
}

/**
 * Plan a from → to morph for the fleet within transitionSec under the given
 * kinematic limits. Both formations are resampled to max(|from|, |to|)
 * points (deterministic seed derived from the formation names and count).
 *
 * minTransitionSec is the trapezoidal-profile minimum for the longest path:
 * T*(L) = L / vMax + vMax / aMax. The plan is feasible when transitionSec ≥
 * T* AND no pair remains closer than rMinM/2 after one departure-delay round
 * (see DELAYED-START CONVENTION in the module doc).
 */
export function planMorph(
  from: Formation,
  to: Formation,
  transitionSec: Seconds,
  limits: MorphLimits,
): MorphResult {
  if (!(limits.vMaxMps > 0) || !(limits.aMaxMps2 > 0)) {
    throw new Error('planMorph: vMaxMps and aMaxMps2 must be > 0')
  }
  if (!(limits.rMinM >= 0)) throw new Error('planMorph: rMinM must be >= 0')
  const n = Math.max(from.points.length, to.points.length)
  if (n === 0) {
    return {
      assignment: [],
      maxPathLenM: 0,
      minTransitionSec: 0,
      feasible: true,
      waypoints: [],
      softConflicts: 0,
    }
  }
  const seed = fnv1a32(`morph:${from.name}->${to.name}:${n}`)
  const src = resampleTo(from.points, n, forkSeed(seed, 'from'))
  const dst = resampleTo(to.points, n, forkSeed(seed, 'to'))
  const assignment = assign(src, dst)
  const starts: Vec3[] = src.map((p) => ({ x: p.x, y: p.y, z: p.z }))
  const ends: Vec3[] = assignment.map((j) => {
    const p = dst[j]!
    return { x: p.x, y: p.y, z: p.z }
  })

  let maxPathLenM = 0
  for (let i = 0; i < n; i++) {
    const l = dist3(starts[i]!, ends[i]!)
    if (l > maxPathLenM) maxPathLenM = l
  }
  const minTransitionSec = maxPathLenM / limits.vMaxMps + limits.vMaxMps / limits.aMaxMps2
  let feasible = transitionSec >= minTransitionSec

  const delayed: boolean[] = new Array(n).fill(false)
  let softConflicts = 0
  if (limits.rMinM > 0 && n > 1) {
    const pairs = candidatePairs(starts, ends, limits.rMinM, maxPathLenM)
    const conflicting: Array<readonly [number, number]> = []
    for (const [i, j] of pairs) {
      if (minSeparation(starts, ends, delayed, i, j) < limits.rMinM) conflicting.push([i, j])
    }
    if (conflicting.length > 0) {
      // One mitigation round: delay one drone per conflicting pair (the
      // higher index), unless either member is already delayed — delaying
      // both would re-synchronize them.
      for (const [i, j] of conflicting) {
        if (!delayed[i] && !delayed[j]) delayed[j] = true
      }
      // Single re-check of every candidate pair with the delays applied.
      for (const [i, j] of pairs) {
        const sep = minSeparation(starts, ends, delayed, i, j)
        if (sep < limits.rMinM) {
          if (sep < limits.rMinM / 2) feasible = false
          else softConflicts++
        }
      }
    }
  }

  const waypoints = starts.map((s, i) => ({
    droneId: i,
    path: delayed[i]
      ? [{ ...s }, { ...s }, { ...ends[i]! }]
      : [{ ...s }, { ...ends[i]! }],
  }))
  return { assignment, maxPathLenM, minTransitionSec, feasible, waypoints, softConflicts }
}
