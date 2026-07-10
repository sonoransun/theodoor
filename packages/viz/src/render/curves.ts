/**
 * Pure brightness/twinkle curves + particle packing for the GL renderer.
 * No DOM/WebGL here — everything in this file is unit-testable in Node.
 */
import { fnv1a32 } from '@theodoor/core'
import type { SimSnapshot } from '@theodoor/core'
import type { Camera } from './camera.js'

export const TWO_PI = Math.PI * 2

/**
 * Star brightness: fade envelope × twinkle.
 *   u   normalized age (0 = born, 1 = dead; clamped so u ≥ 1 → 0)
 *   t   show seconds (twinkle clock)
 *   f   per-star twinkle frequency, Hz
 *   phi per-star phase, radians
 */
export function starAlpha(u: number, t: number, f: number, phi: number): number {
  const env = Math.pow(Math.max(0, 1 - u), 1.8)
  return env * (0.75 + 0.25 * Math.sin(TWO_PI * f * t + phi))
}

/** Deterministic per-star phase in [0, 2π), derived only from (seed, index). */
export function hashPhase(seed: number, i: number): number {
  return (fnv1a32(`${seed >>> 0}:${i}`) / 0x100000000) * TWO_PI
}

// ---------------------------------------------------------------------------
// Snapshot packing: SimSnapshot (SoA, world meters) → one interleaved
// Float32Array consumed by glParticles in a single upload + draw.
//
// Layout per particle, PACK_STRIDE floats:
//   [clipX, clipY, sizePx, r, g, b, alpha]
//
// Stars are packed first, then drones. sizePx is the world size already
// multiplied by camera.pxPerMeter() (the shader clamps it to [1.5, 64] px).
//
// DRONE HALO FLAG (negative-size convention): drones are packed with a
// NEGATIVE sizePx. The particle vertex shader takes abs(sizePx) for the
// point size and uses the sign to select the halo strength (0.35 for
// drones, 0.1 for stars). Zero-sized particles are stars by definition.
// ---------------------------------------------------------------------------

export const PACK_STRIDE = 7
export const PACK_OFF_CLIP_X = 0
export const PACK_OFF_CLIP_Y = 1
export const PACK_OFF_SIZE = 2
export const PACK_OFF_R = 3
export const PACK_OFF_G = 4
export const PACK_OFF_B = 5
export const PACK_OFF_ALPHA = 6

/** Apparent drone body size, world meters (snapshot drones carry no sizeM). */
export const DRONE_SIZE_M = 1.2
/** Drones have no per-drone brightness channel; they pack at full alpha. */
export const DRONE_ALPHA = 1
/**
 * Star glare factor: physical star sizes are sub-meter, but burning stars
 * read several times larger to the eye. Applied at pack time (rendering
 * concern — the sim's sizeM stays physical).
 */
export const STAR_GLARE = 3.5

export interface PackedParticles {
  /** Interleaved attributes; only the first count*PACK_STRIDE floats are valid. */
  data: Float32Array
  count: number
}

/**
 * Pack stars then drones into one interleaved buffer. Star alpha comes from
 * snapshot.stars.brightness (the sim/demo already applied fade + twinkle).
 * Pass the previous frame's `data` as `out` to avoid reallocating.
 */
export function packSnapshot(
  snapshot: SimSnapshot,
  camera: Camera,
  out?: Float32Array,
): PackedParticles {
  const { stars, drones } = snapshot
  const count = stars.count + drones.count
  const needed = count * PACK_STRIDE
  const data =
    out !== undefined && out.length >= needed
      ? out
      : new Float32Array(Math.max(needed, 64 * PACK_STRIDE))
  const ppm = camera.pxPerMeter()

  let o = 0
  for (let i = 0; i < stars.count; i++) {
    const c = camera.project(stars.pos[3 * i], stars.pos[3 * i + 2])
    data[o + PACK_OFF_CLIP_X] = c.x
    data[o + PACK_OFF_CLIP_Y] = c.y
    data[o + PACK_OFF_SIZE] = stars.sizeM[i] * STAR_GLARE * ppm
    data[o + PACK_OFF_R] = stars.rgb[3 * i]
    data[o + PACK_OFF_G] = stars.rgb[3 * i + 1]
    data[o + PACK_OFF_B] = stars.rgb[3 * i + 2]
    data[o + PACK_OFF_ALPHA] = stars.brightness[i]
    o += PACK_STRIDE
  }
  for (let i = 0; i < drones.count; i++) {
    const c = camera.project(drones.pos[3 * i], drones.pos[3 * i + 2])
    data[o + PACK_OFF_CLIP_X] = c.x
    data[o + PACK_OFF_CLIP_Y] = c.y
    // Negative size ⇒ drone halo flag (see layout comment above).
    data[o + PACK_OFF_SIZE] = -(DRONE_SIZE_M * ppm)
    data[o + PACK_OFF_R] = drones.rgb[3 * i]
    data[o + PACK_OFF_G] = drones.rgb[3 * i + 1]
    data[o + PACK_OFF_B] = drones.rgb[3 * i + 2]
    data[o + PACK_OFF_ALPHA] = DRONE_ALPHA
    o += PACK_STRIDE
  }
  return { data, count }
}
