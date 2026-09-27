/**
 * Star motion streaks — pure packing (no GL here; unit-tested in Node).
 *
 * Fast stars (comet heads, crossette shards, shell tracers) read as short
 * trails: for every star whose closed-form speed exceeds STREAK_MIN_SPEED_MPS
 * we emit one quad from the star's position STREAK_TAU_SEC ago (pos − vel·τ,
 * the sim's own velocity from SimSnapshot.stars.vel) to its current position.
 * Trail length is clamped to STREAK_MAX_LEN_M so a fresh burst does not
 * paint the whole sky with lines. Half-width follows the star's glare size
 * (curves.STAR_GLARE) with a pixel floor.
 *
 * Layout per vertex (STREAK_STRIDE floats): [clipX, clipY, u, v, r, g, b, a]
 *   u: 0 at the tail (dim) → 1 at the head; v: −1..1 across the streak.
 */
import type { SimSnapshot } from '@theodoor/core'
import type { Camera } from './camera.js'
import { STAR_GLARE } from './curves.js'
import { FloatSink, pushQuad } from './glStream.js'

/** Streak time constant: the trail spans this much of the star's recent path. */
export const STREAK_TAU_SEC = 1 / 30
/** Stars slower than this get no streak (they twinkle in place). */
export const STREAK_MIN_SPEED_MPS = 12
/** Longest trail, world meters. */
export const STREAK_MAX_LEN_M = 14
/** Streak half-width relative to the star's glare radius. */
export const STREAK_HALF_W_FACTOR = 0.45
/** Streak alpha relative to the star's own brightness. */
export const STREAK_ALPHA = 0.55
export const STREAK_STRIDE = 8

export interface PackedStreaks {
  data: Float32Array
  /** Valid floats in `data`. */
  floats: number
  /** Quads emitted. */
  count: number
}

/** Trail length for a star of speed v: min(|v|·τ, max), 0 below the speed floor. */
export function streakLengthM(speedMps: number): number {
  if (!(speedMps > STREAK_MIN_SPEED_MPS)) return 0
  return Math.min(STREAK_MAX_LEN_M, speedMps * STREAK_TAU_SEC)
}

/**
 * Pack streak quads for every fast star. Pass the previous result's sink to
 * reuse its buffer. Screen-space geometry: the quad follows the projected
 * velocity in the camera's x–z plane (world y/depth ignored, like the camera).
 */
export function packStreaks(
  snapshot: SimSnapshot,
  camera: Camera,
  sink: FloatSink = new FloatSink(),
): PackedStreaks {
  sink.reset()
  const { stars } = snapshot
  const ppm = camera.pxPerMeter()
  const minHalfW = 0.75 / Math.max(1e-6, ppm) // ≥ 0.75 px half-width in world meters
  let count = 0
  for (let i = 0; i < stars.count; i++) {
    const vx = stars.vel[3 * i]!
    const vz = stars.vel[3 * i + 2]!
    const speed = Math.hypot(stars.vel[3 * i]!, stars.vel[3 * i + 1]!, vz)
    const len = streakLengthM(speed)
    if (len <= 0) continue
    const planar = Math.hypot(vx, vz)
    if (planar < 1e-6) continue
    const brightness = stars.brightness[i]!
    if (brightness <= 0.02) continue
    const x = stars.pos[3 * i]!
    const z = stars.pos[3 * i + 2]!
    // Unit direction of motion in the x–z view plane, scaled to the trail length.
    const ux = vx / planar
    const uz = vz / planar
    const tx = x - ux * len
    const tz = z - uz * len
    const halfW = Math.max(minHalfW, stars.sizeM[i]! * STAR_GLARE * STREAK_HALF_W_FACTOR)
    const nx = -uz * halfW
    const nz = ux * halfW
    const aN = camera.project(tx - nx, tz - nz)
    const aP = camera.project(tx + nx, tz + nz)
    const bN = camera.project(x - nx, z - nz)
    const bP = camera.project(x + nx, z + nz)
    pushQuad(sink, aN, aP, bN, bP, 0, 1, [
      stars.rgb[3 * i]!,
      stars.rgb[3 * i + 1]!,
      stars.rgb[3 * i + 2]!,
      brightness * STREAK_ALPHA,
    ])
    count++
  }
  return { data: sink.data, floats: sink.length, count }
}
