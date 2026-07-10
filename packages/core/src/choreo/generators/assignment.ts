/**
 * Drone → target assignment: greedy nearest-pair seeding followed by 2-opt
 * swap passes to a fixpoint. Deterministic (full tie-breaking, no RNG).
 *
 * Optimal-enough versus Hungarian for show-scale fleets (n ≤ 500), and 2-opt
 * removes crossings in the plane (a crossing pair always has a cheaper
 * uncrossed swap under squared distance).
 */

import type { Vec3 } from '../../contracts.js'

/** 2-opt improvement passes are capped at this many sweeps. */
export const MAX_TWO_OPT_PASSES = 5

const d2 = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/**
 * Greedy seeding: all n² (i, j) pairs sorted by squared distance (ties by i,
 * then j), assigned first-come-first-served. Returns a[i] = target index.
 */
export function greedyAssign(from: readonly Vec3[], to: readonly Vec3[]): number[] {
  if (from.length !== to.length) {
    throw new Error(`assign: from/to lengths differ (${from.length} vs ${to.length})`)
  }
  const n = from.length
  const pairs: Array<[number, number, number]> = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) pairs.push([d2(from[i]!, to[j]!), i, j])
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  const a: number[] = new Array(n).fill(-1)
  const used: boolean[] = new Array(n).fill(false)
  let assigned = 0
  for (const [, i, j] of pairs) {
    if (assigned === n) break
    if (a[i] !== -1 || used[j]) continue
    a[i] = j
    used[j] = true
    assigned++
  }
  return a
}

/**
 * Greedy assignment refined by 2-opt: swap targets of any pair (i, j) when it
 * strictly lowers the summed squared distance; sweep until no swap improves
 * or MAX_TWO_OPT_PASSES sweeps have run. Returns a[i] = index into `to`.
 */
export function assign(from: readonly Vec3[], to: readonly Vec3[]): number[] {
  const a = greedyAssign(from, to)
  const n = a.length
  for (let pass = 0; pass < MAX_TWO_OPT_PASSES; pass++) {
    let improved = false
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const cur = d2(from[i]!, to[a[i]!]!) + d2(from[j]!, to[a[j]!]!)
        const swp = d2(from[i]!, to[a[j]!]!) + d2(from[j]!, to[a[i]!]!)
        if (swp < cur - 1e-12) {
          const t = a[i]!
          a[i] = a[j]!
          a[j] = t
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return a
}

/** Total squared distance of an assignment (the quantity 2-opt minimizes). */
export function cost(
  from: readonly Vec3[],
  to: readonly Vec3[],
  assignment: readonly number[],
): number {
  if (from.length !== assignment.length) {
    throw new Error(`cost: from/assignment lengths differ (${from.length} vs ${assignment.length})`)
  }
  let sum = 0
  for (let i = 0; i < from.length; i++) sum += d2(from[i]!, to[assignment[i]!]!)
  return sum
}
