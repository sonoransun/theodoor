/**
 * Pure 2D orthographic camera for the visualizer.
 *
 * World frame: meters, x = east, z = up (the viewer looks north across the
 * x–z plane; world y / depth is ignored in v1 — `project(x, z)` only).
 *
 * The camera fits the fixed world rect x ∈ [-160, 160], z ∈ [-5, 250] into
 * the canvas with letterboxing (uniform scale, centered both axes), leaving
 * a 5% margin (FIT_MARGIN = 0.95).
 *
 * Spaces:
 *  - clip:   WebGL clip space, x/y ∈ [-1, 1], +y up.
 *  - screen: pixels, origin top-left, +y down (for the 2D backdrop & tests).
 */

export const WORLD_X_MIN = -160
export const WORLD_X_MAX = 160
export const WORLD_Z_MIN = -5
export const WORLD_Z_MAX = 250
export const FIT_MARGIN = 0.95

const WORLD_W = WORLD_X_MAX - WORLD_X_MIN // 320
const WORLD_H = WORLD_Z_MAX - WORLD_Z_MIN // 255
const CENTER_X = (WORLD_X_MIN + WORLD_X_MAX) / 2 // 0
const CENTER_Z = (WORLD_Z_MIN + WORLD_Z_MAX) / 2 // 122.5

export interface Camera {
  readonly widthPx: number
  readonly heightPx: number
  /** Uniform letterbox scale, pixels per world meter. */
  pxPerMeter(): number
  /**
   * Column-major 3×3 affine mapping [worldX, worldZ, 1] → [clipX, clipY, 1]:
   * [ m0 m3 m6 ]   m0 = 2s/w   m6 = -cx·2s/w
   * [ m1 m4 m7 ]   m4 = 2s/h   m7 = -cz·2s/h
   * [ m2 m5 m8 ]   everything else 0 except m8 = 1
   */
  worldToClipMatrix(): number[]
  /** World (x, z) → clip space. World y (depth) is ignored in v1. */
  project(x: number, z: number): { x: number; y: number }
  /** World (x, z) → screen pixels (y down). */
  worldToScreen(x: number, z: number): { x: number; y: number }
  /** Screen pixels (y down) → world (x, z). Inverse of worldToScreen. */
  screenToWorld(sx: number, sy: number): { x: number; z: number }
}

export function makeCamera(widthPx: number, heightPx: number): Camera {
  const w = Math.max(1, widthPx)
  const h = Math.max(1, heightPx)
  const s = FIT_MARGIN * Math.min(w / WORLD_W, h / WORLD_H)

  return {
    widthPx: w,
    heightPx: h,
    pxPerMeter: () => s,
    worldToClipMatrix: () => [
      (2 * s) / w, 0, 0,
      0, (2 * s) / h, 0,
      (-CENTER_X * 2 * s) / w, (-CENTER_Z * 2 * s) / h, 1,
    ],
    project: (x, z) => ({
      x: ((x - CENTER_X) * s * 2) / w,
      y: ((z - CENTER_Z) * s * 2) / h,
    }),
    worldToScreen: (x, z) => ({
      x: w / 2 + (x - CENTER_X) * s,
      y: h / 2 - (z - CENTER_Z) * s,
    }),
    screenToWorld: (sx, sy) => ({
      x: CENTER_X + (sx - w / 2) / s,
      z: CENTER_Z + (h / 2 - sy) / s,
    }),
  }
}
