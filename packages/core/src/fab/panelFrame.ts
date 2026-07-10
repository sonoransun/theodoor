/**
 * fab/panelFrame.ts — pixel-panel mounting frame shop drawing (front view).
 *
 * The frame is the staging structure a `panel` asset's LED matrix bolts to:
 * an outer frame with a 60 mm border around the pixel field, the pixel grid
 * itself (major lines every 8 px), and 8 mm mounting holes at the corners
 * and edge mid-spans.
 */

import type { PositionedAsset } from '../contracts.js'
import { circle, dim, fmtMm, line, rect, svgDoc, text } from './svg.js'

/** Frame border added around the pixel field on every side. */
export const PANEL_MARGIN_MM = 60
/** Mounting hole diameter. */
export const MOUNT_HOLE_DIAMETER_MM = 8
/** Mounting hole center inset from the outer frame edge. */
export const MOUNT_HOLE_INSET_MM = 30
/** Every Nth pixel grid line is drawn heavier. */
export const PANEL_MAJOR_EVERY_PX = 8

/**
 * Dimensioned front-view drawing of the mounting frame for a `panel` asset.
 * Throws if the asset carries no PanelSpec.
 */
export function panelFrameSvg(asset: PositionedAsset): string {
  const spec = asset.panel
  if (asset.kind !== 'panel' || !spec) {
    throw new Error(`panelFrameSvg: asset '${asset.id}' is not a panel with a PanelSpec`)
  }
  const { wPx, hPx, pitchMm } = spec
  const gridW = wPx * pitchMm
  const gridH = hPx * pitchMm
  const w = gridW + 2 * PANEL_MARGIN_MM
  const h = gridH + 2 * PANEL_MARGIN_MM

  const children: string[] = []
  children.push(rect(0, 0, w, h, { 'stroke-width': 1 }))
  children.push(rect(PANEL_MARGIN_MM, PANEL_MARGIN_MM, gridW, gridH, { 'stroke-width': 0.8 }))
  children.push(text(4, 10, `panel ${asset.id} ${wPx}x${hPx}px (front view)`, { 'font-size': 6 }))

  // Interior pixel grid lines (field boundary is drawn by the inner rect).
  for (let i = 1; i < wPx; i++) {
    const x = PANEL_MARGIN_MM + i * pitchMm
    children.push(
      line(x, PANEL_MARGIN_MM, x, PANEL_MARGIN_MM + gridH, {
        'stroke-width': i % PANEL_MAJOR_EVERY_PX === 0 ? 0.6 : 0.2,
      }),
    )
  }
  for (let j = 1; j < hPx; j++) {
    const y = PANEL_MARGIN_MM + j * pitchMm
    children.push(
      line(PANEL_MARGIN_MM, y, PANEL_MARGIN_MM + gridW, y, {
        'stroke-width': j % PANEL_MAJOR_EVERY_PX === 0 ? 0.6 : 0.2,
      }),
    )
  }

  // Mounting holes: 4 corners + 4 edge mid-spans, ⌀8 mm.
  const inset = MOUNT_HOLE_INSET_MM
  const holes: readonly { x: number; y: number }[] = [
    { x: inset, y: inset },
    { x: w - inset, y: inset },
    { x: inset, y: h - inset },
    { x: w - inset, y: h - inset },
    { x: w / 2, y: inset },
    { x: w / 2, y: h - inset },
    { x: inset, y: h / 2 },
    { x: w - inset, y: h / 2 },
  ]
  for (const hole of holes) {
    children.push(circle(hole.x, hole.y, MOUNT_HOLE_DIAMETER_MM / 2, { class: 'mount-hole' }))
  }

  children.push(
    dim(PANEL_MARGIN_MM, PANEL_MARGIN_MM - 6, PANEL_MARGIN_MM + pitchMm, PANEL_MARGIN_MM - 6, `pitch ${fmtMm(pitchMm)} mm`),
  )
  children.push(dim(0, h + 12, w, h + 12, `${fmtMm(w)} mm`))
  children.push(dim(w + 12, 0, w + 12, h, `${fmtMm(h)} mm`))

  return svgDoc(w + 30, h + 30, children)
}
