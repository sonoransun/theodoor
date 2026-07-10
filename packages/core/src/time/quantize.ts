import type { Seconds } from '../contracts.js'

export type QuantizeGrid = 'none' | 'halfBeat' | 'beat' | 'bar'

/** Index of the largest element <= t (or 0 when t precedes everything). */
export function lowerIndex(sorted: readonly number[], t: number): number {
  let lo = 0
  let hi = sorted.length - 1
  if (hi < 0) return -1
  if (t < sorted[0]!) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (sorted[mid]! <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Nearest element of a sorted array (undefined for empty input). */
export function nearestInSorted(sorted: readonly number[], t: number): number | undefined {
  const n = sorted.length
  if (n === 0) return undefined
  const i = lowerIndex(sorted, t)
  if (i < 0) return sorted[0]
  if (i >= n - 1) return sorted[n - 1]
  const a = sorted[i]!
  const b = sorted[i + 1]!
  return t - a <= b - t ? a : b
}

/**
 * Snap a time to the requested musical grid. `beats`/`downbeats` are the
 * timeline's instant arrays; half-beat points are the midpoints between
 * consecutive beats.
 */
export function quantizeTime(
  beats: readonly number[],
  downbeats: readonly number[],
  t: Seconds,
  grid: QuantizeGrid,
): Seconds {
  switch (grid) {
    case 'none':
      return t
    case 'beat':
      return nearestInSorted(beats, t) ?? t
    case 'bar':
      return nearestInSorted(downbeats, t) ?? t
    case 'halfBeat': {
      const beat = nearestInSorted(beats, t)
      if (beat === undefined) return t
      const i = lowerIndex(beats, t)
      let best = beat
      let bestDist = Math.abs(t - beat)
      for (const j of [i, i + 1 <= beats.length - 2 ? i + 1 : -1]) {
        if (j < 0 || j + 1 >= beats.length) continue
        const mid = (beats[j]! + beats[j + 1]!) / 2
        const d = Math.abs(t - mid)
        if (d < bestDist) {
          best = mid
          bestDist = d
        }
      }
      return best
    }
  }
}
