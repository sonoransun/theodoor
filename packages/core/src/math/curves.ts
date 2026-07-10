export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t)

/** Serializable sampled curve over uniform or arbitrary sorted times. */
export interface SampledCurve {
  times: readonly number[]
  values: readonly number[]
}

/** Linear-interpolated lookup; clamps outside the domain. */
export function sampleCurve(curve: SampledCurve, t: number): number {
  const { times, values } = curve
  const n = times.length
  if (n === 0) return 0
  if (t <= times[0]!) return values[0]!
  if (t >= times[n - 1]!) return values[n - 1]!
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= t) lo = mid
    else hi = mid
  }
  const t0 = times[lo]!
  const t1 = times[hi]!
  const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
  return lerp(values[lo]!, values[hi]!, u)
}
