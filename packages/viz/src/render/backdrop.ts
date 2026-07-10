/**
 * Static scene backdrop, drawn once (per resize / asset change) into an
 * offscreen 2D canvas that the GL renderer uploads as a texture:
 *   - vertical night gradient (#02030f top → #0a1230 bottom)
 *   - ground line at world z = 0
 *   - seeded audience-head silhouettes along the bottom edge
 *   - small tick marks at the provided launch x positions
 * Fully deterministic for a given (camera size, seed, launchXs).
 */
import { mulberry32 } from '@theodoor/core'
import type { Camera } from './camera.js'

export const BACKDROP_TOP_COLOR = '#02030f'
export const BACKDROP_BOTTOM_COLOR = '#0a1230'

export interface BackdropOptions {
  seed: number
  /** World x of launch positions (mortar racks) to tick-mark on the ground. */
  launchXs: readonly number[]
}

export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  opts: BackdropOptions,
): void {
  const w = camera.widthPx
  const h = camera.heightPx
  const ppm = camera.pxPerMeter()

  // Night-sky gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, BACKDROP_TOP_COLOR)
  grad.addColorStop(1, BACKDROP_BOTTOM_COLOR)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // Ground line at world z = 0.
  const groundY = camera.worldToScreen(0, 0).y
  ctx.strokeStyle = 'rgba(96, 116, 168, 0.45)'
  ctx.lineWidth = Math.max(1, ppm * 0.25)
  ctx.beginPath()
  ctx.moveTo(0, groundY)
  ctx.lineTo(w, groundY)
  ctx.stroke()

  // Launch position tick marks (short vertical dashes crossing the ground).
  ctx.strokeStyle = 'rgba(196, 156, 88, 0.85)'
  ctx.lineWidth = Math.max(1, ppm * 0.4)
  const tick = Math.max(4, ppm * 2.5)
  for (const x of opts.launchXs) {
    const s = camera.worldToScreen(x, 0)
    ctx.beginPath()
    ctx.moveTo(s.x, s.y - tick)
    ctx.lineTo(s.x, s.y + tick * 0.4)
    ctx.stroke()
  }

  // Audience-head silhouettes along the bottom edge (seeded, deterministic).
  const rng = mulberry32(opts.seed >>> 0)
  ctx.fillStyle = '#03040a'
  const heads = Math.max(48, Math.floor(w / 14))
  for (let i = 0; i < heads; i++) {
    const x = rng() * w
    const r = 3 + rng() * 5
    const cy = h + r * (0.15 + rng() * 0.45)
    ctx.beginPath()
    ctx.arc(x, cy - r, r, 0, Math.PI * 2)
    ctx.fill()
  }
}
