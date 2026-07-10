/**
 * Pure floor-band mapping for the audience layers (crowd points, audio-beam
 * footprints). No DOM/WebGL here — everything is unit-testable in Node.
 *
 * THE FLOOR BAND: the camera projects world x–z and ignores world y (depth),
 * so ground features on the lawn (crowd cells, beam footprints) have no
 * natural screen position. We map them into a thin horizontal band sitting
 * just above the backdrop's audience silhouettes:
 *
 *   screenX = camera.project(worldX, 0).x            (real x projection)
 *   screenY = groundY − lerp(FAR, NEAR, frac(worldY))
 *
 * where groundY is the screen y of the world ground line (z = 0), frac is 0
 * at the BACK row's centroid y and 1 at the FRONT row's (row rows−1, nearest
 * the stage), clamped outside. Front rows sit LOWER on screen (offset
 * BAND_NEAR_OFFSET_PX above the ground line), back rows HIGHER (offset
 * BAND_FAR_OFFSET_PX) — a cheap depth cue matching the viewer standing
 * behind the lawn looking north at the stage.
 */
import type { BeamFootprint, Vec2 } from '@theodoor/core'
import type { Camera } from './camera.js'

/** Band offset above the ground line for the FRONT row (rows−1), px. */
export const BAND_NEAR_OFFSET_PX = 4
/** Band offset above the ground line for the BACK row (row 0), px. */
export const BAND_FAR_OFFSET_PX = 36

const DEG = Math.PI / 180

/** Structural subset of core's CrowdGrid the band mapping needs. */
export interface BandGridLike {
  cellSizeM: number
  rows: number
  cells: readonly { row: number; centroid: Vec2 }[]
}

/**
 * Depth fraction of a world y (north) coordinate within the grid's row span:
 * 0 at the back row's centroid y, 1 at the front row's, clamped outside.
 */
export function bandFrac(grid: BandGridLike, worldY: number): number {
  const c0 = grid.cells[0]
  if (!c0) return 1
  // Recover the bbox origin from any cell: centroid.y = yMin + (row+0.5)·s.
  const yMin = c0.centroid.y - (c0.row + 0.5) * grid.cellSizeM
  const yBack = yMin + 0.5 * grid.cellSizeM
  const span = (grid.rows - 1) * grid.cellSizeM
  if (!(span > 0)) return 1
  const f = (worldY - yBack) / span
  return f < 0 ? 0 : f > 1 ? 1 : f
}

/** Screen y (px, y down) of a ground point at world y, given the ground line. */
export function bandScreenY(grid: BandGridLike, worldY: number, groundY: number): number {
  const f = bandFrac(grid, worldY)
  return groundY - (BAND_FAR_OFFSET_PX + (BAND_NEAR_OFFSET_PX - BAND_FAR_OFFSET_PX) * f)
}

/** Screen y (px, y down) → WebGL clip y (+1 top, −1 bottom). */
export function screenYToClipY(screenY: number, heightPx: number): number {
  return 1 - (2 * screenY) / Math.max(1, heightPx)
}

/**
 * Static clip-space positions for every grid cell, [x0, y0, x1, y1, …] in
 * cell order: x from the camera's real x projection at z = 0, y from the
 * floor band. Recomputed only when the grid or camera changes.
 */
export function crowdCellClipPositions(grid: BandGridLike, camera: Camera): Float32Array {
  const groundY = camera.worldToScreen(0, 0).y
  const out = new Float32Array(grid.cells.length * 2)
  for (let i = 0; i < grid.cells.length; i++) {
    const cell = grid.cells[i]!
    out[2 * i] = camera.project(cell.centroid.x, 0).x
    out[2 * i + 1] = screenYToClipY(bandScreenY(grid, cell.centroid.y, groundY), camera.heightPx)
  }
  return out
}

/**
 * `n` world ground points around a footprint ellipse boundary (closed via
 * index wrap-around, not repetition). Degenerate ellipses (a or b ≤ 0)
 * collapse onto the center.
 */
export function footprintPoints(fp: BeamFootprint, n: number): Vec2[] {
  const az = fp.azimuthDeg * DEG
  const ux = Math.sin(az)
  const uy = Math.cos(az)
  const a = fp.a > 0 ? fp.a : 0
  const b = fp.b > 0 ? fp.b : 0
  const pts: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI
    const along = a * Math.cos(t)
    const cross = b * Math.sin(t)
    pts.push({
      x: fp.cx + along * ux + cross * uy,
      y: fp.cy + along * uy - cross * ux,
    })
  }
  return pts
}

/** Half-extent of the footprint ellipse along world x (east), meters. */
export function footprintXExtentM(fp: BeamFootprint): number {
  const az = fp.azimuthDeg * DEG
  const a = fp.a > 0 ? fp.a : 0
  const b = fp.b > 0 ? fp.b : 0
  return Math.hypot(a * Math.sin(az), b * Math.cos(az))
}

/** In-flight beams render at this fraction of the landed alpha. */
export const BEAM_FLIGHT_ALPHA = 0.4
/** Footprint pulse length after the wavefront lands, show seconds. */
export const BEAM_LANDING_PULSE_SEC = 0.35

/** Cone alpha factor: dim while the wavefront is in flight, full on landing. */
export function beamConeAlpha(landed: boolean): number {
  return landed ? 1 : BEAM_FLIGHT_ALPHA
}

/**
 * Footprint landing pulse, 1 → 0 over BEAM_LANDING_PULSE_SEC from the landing
 * instant (0 before landing or for NaN/negative elapsed).
 */
export function landingPulse(sinceLandedSec: number): number {
  if (!(sinceLandedSec >= 0)) return 0
  return Math.max(0, 1 - sinceLandedSec / BEAM_LANDING_PULSE_SEC)
}
