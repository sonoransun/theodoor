/**
 * gallery/sitePlan.ts — top-down venue map (north up) for the docs gallery.
 *
 * One uniform px/m scale fitted to the site extents (geofence ∪ audienceZone
 * ∪ assets, padded), so distances read true anywhere on the map. Every asset
 * kind gets a small glyph in its lane color with a monospace id label; beam
 * arrays additionally show their feasible ground-throw radius — the
 * horizon-margin rule (depression must clear halfAngle + 2°) turned into a
 * circle of radius (elevationM − earHeight) / tan(halfAngle + 2°).
 *
 * All colors come from GALLERY_THEME (never currentColor: GitHub renders repo
 * SVGs inside <img>, where currentColor resolves to black).
 */

import type { PositionedAsset, SitePlan, Vec2 } from '../contracts.js'
import { el, escapeText, fmtMm } from '../fab/svg.js'
import { crowdGridFor } from '../site/crowdGrid.js'
import { galleryDoc, label } from './scene.js'
import { GALLERY_THEME } from './theme.js'

export interface SitePlanOpts {
  /** Document width, px (default 900). */
  widthPx?: number
  /** Full beam program width, degrees, for the throw-arc rule (default 6). */
  beamWidthDeg?: number
}

/** Listener ear height the beam horizon-margin rule measures against, m. */
const EAR_HEIGHT_M = 1.6
const MARGIN_PX = 34
const TITLE_H_PX = 30
const PAD_M = 15

interface MapProj {
  x(wx: number): number
  y(wy: number): number
  /** Uniform scale, px per meter. */
  s: number
}

function polyPoints(pts: readonly Vec2[], proj: MapProj): string {
  return pts.map((p) => `${fmtMm(proj.x(p.x))},${fmtMm(proj.y(p.y))}`).join(' ')
}

function beamDot(px: number, py: number, color: string): string {
  return el('circle', { cx: px, cy: py, r: 3.5, fill: color })
}

/** Glyph for one asset (id label included; throw arcs are drawn separately). */
function assetGlyph(a: PositionedAsset, proj: MapProj): string {
  const t = GALLERY_THEME
  const px = proj.x(a.pos.x)
  const py = proj.y(a.pos.y)
  const parts: string[] = []
  let labelDy = -5
  switch (a.kind) {
    case 'mortarRack':
      parts.push(el('rect', { x: px - 4, y: py - 4, width: 8, height: 8, fill: t.lanes.pyro }))
      break
    case 'dronePad':
      parts.push(el('circle', { cx: px, cy: py, r: 5, fill: t.lanes.drones }))
      break
    case 'laserTower':
      parts.push(
        el('polygon', {
          points: `${fmtMm(px)},${fmtMm(py - 5.5)} ${fmtMm(px + 5)},${fmtMm(py + 4)} ${fmtMm(px - 5)},${fmtMm(py + 4)}`,
          fill: t.lanes.lasers,
        }),
      )
      break
    case 'panel':
      parts.push(el('rect', { x: px - 7, y: py - 2, width: 14, height: 4, fill: t.lanes.panels }))
      break
    case 'crowdMast':
      parts.push(
        el('circle', { cx: px, cy: py, r: 5, fill: 'none', stroke: t.lanes.crowd, 'stroke-width': 1.2 }),
        el('line', { x1: px - 5, y1: py, x2: px + 5, y2: py, stroke: t.lanes.crowd, 'stroke-width': 1.2 }),
        el('line', { x1: px, y1: py - 5, x2: px, y2: py + 5, stroke: t.lanes.crowd, 'stroke-width': 1.2 }),
      )
      break
    case 'beamArray':
      parts.push(beamDot(px, py, t.lanes.beams))
      parts.push(
        el(
          'text',
          {
            x: px + 6,
            y: py + 4,
            'font-family': 'monospace',
            'font-size': 9,
            fill: t.lanes.beams,
          },
          `${fmtMm(a.elevationM)}m`,
        ),
      )
      labelDy = 13
      break
  }
  parts.push(
    el(
      'text',
      { x: px + 6, y: py + labelDy, 'font-family': 'monospace', 'font-size': 9, fill: t.inkDim },
      escapeText(a.id),
    ),
  )
  return parts.join('')
}

/** Feasible ground-throw radius for a beam array, meters (0 when too low). */
export function beamThrowRadiusM(elevationM: number, beamWidthDeg: number): number {
  const h = elevationM - EAR_HEIGHT_M
  if (!(h > 0)) return 0
  return h / Math.tan(((beamWidthDeg / 2 + 2) * Math.PI) / 180)
}

/** Small ear glyph (dot + two sound arcs) at a reference listener position. */
function earArcs(px: number, py: number): string {
  const t = GALLERY_THEME
  const f = fmtMm
  const arc = (dx: number, dy: number, r: number, h: number): string =>
    el('path', {
      d: `M${f(px + dx)} ${f(py + dy)}a${f(r)} ${f(r)} 0 0 1 0 ${f(h)}`,
      fill: 'none',
      stroke: t.ink,
      'stroke-width': 1,
      'stroke-opacity': '0.8',
    })
  return (
    el('circle', { cx: px, cy: py, r: 1.3, fill: t.ink }) + arc(2.5, -3, 4, 6) + arc(5, -5, 7, 10)
  )
}

/** Wind arrow pointing DOWNWIND (dirDegFrom is where the wind comes FROM). */
function windArrow(cx: number, cy: number, dirDegFrom: number, speedMps: number): string {
  const t = GALLERY_THEME
  const rad = (dirDegFrom * Math.PI) / 180
  // Downwind world unit = (−sin, −cos); screen y grows southward (−world y).
  const ux = -Math.sin(rad)
  const uy = Math.cos(rad)
  const len = 34
  const x1 = cx - (ux * len) / 2
  const y1 = cy - (uy * len) / 2
  const x2 = cx + (ux * len) / 2
  const y2 = cy + (uy * len) / 2
  const bx = x2 - ux * 7
  const by = y2 - uy * 7
  const p1x = bx - uy * 3.5
  const p1y = by + ux * 3.5
  const p2x = bx + uy * 3.5
  const p2y = by - ux * 3.5
  return (
    el('line', { x1, y1, x2, y2, stroke: t.ink, 'stroke-width': 1.5 }) +
    el('polygon', {
      points: `${fmtMm(x2)},${fmtMm(y2)} ${fmtMm(p1x)},${fmtMm(p1y)} ${fmtMm(p2x)},${fmtMm(p2y)}`,
      fill: t.ink,
    }) +
    el(
      'text',
      {
        x: cx,
        y: cy + len / 2 + 14,
        'font-family': 'monospace',
        'font-size': 10,
        fill: t.inkDim,
        'text-anchor': 'middle',
      },
      `wind ${fmtMm(speedMps)} m/s`,
    )
  )
}

/**
 * Render a top-down site map: dashed geofence, audience lawn with its crowd
 * grid ('front' row annotated), per-asset glyphs with beam throw arcs, ear
 * marks at refListenerPos, wind arrow, 50 m scale bar.
 */
export function sitePlanSvg(site: SitePlan, opts: SitePlanOpts = {}): string {
  const t = GALLERY_THEME
  const w = opts.widthPx ?? 900
  const beamWidthDeg = opts.beamWidthDeg ?? 6

  // World bbox over geofence ∪ audienceZone ∪ asset positions ∪ listeners.
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  const grow = (p: Vec2): void => {
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  for (const p of site.geofence) grow(p)
  for (const p of site.audienceZone) grow(p)
  for (const a of site.assets) grow(a.pos)
  for (const p of site.refListenerPos) grow(p)
  if (!(xMax > xMin) || !(yMax > yMin)) throw new Error(`sitePlanSvg: site '${site.id}' has degenerate extents`)
  xMin -= PAD_M
  xMax += PAD_M
  yMin -= PAD_M
  yMax += PAD_M

  const s = (w - 2 * MARGIN_PX) / (xMax - xMin)
  const mapTop = TITLE_H_PX + MARGIN_PX
  const h = Math.round(mapTop + (yMax - yMin) * s + MARGIN_PX)
  const proj: MapProj = {
    x: (wx) => MARGIN_PX + (wx - xMin) * s,
    y: (wy) => mapTop + (yMax - wy) * s,
    s,
  }

  const children: string[] = []
  children.push(label(MARGIN_PX, 19, `${site.id} — site plan`, { 'font-size': 13 }))

  // Geofence: dashed outline in the grid color.
  children.push(
    el('polygon', {
      points: polyPoints(site.geofence, proj),
      fill: 'none',
      stroke: t.grid,
      'stroke-width': 1.5,
      'stroke-dasharray': '6 4',
    }),
  )

  // Audience lawn + crowd-canvas cells (1 px gaps), 'front' row annotated.
  children.push(el('polygon', { points: polyPoints(site.audienceZone, proj), fill: t.panelBg }))
  const grid = crowdGridFor(site)
  if (grid) {
    const side = grid.cellSizeM * s - 1
    const cells: string[] = []
    for (const c of grid.cells) {
      cells.push(
        el('rect', {
          x: proj.x(c.centroid.x) - side / 2,
          y: proj.y(c.centroid.y) - side / 2,
          width: side,
          height: side,
          fill: t.lanes.crowd,
          'fill-opacity': '0.16',
        }),
      )
    }
    children.push(el('g', {}, cells.join('')))

    // Row nearest the stage: least mean distance to the audience front line.
    let fx = 0
    let fy = 0
    for (const p of site.audience) {
      fx += p.x / site.audience.length
      fy += p.y / site.audience.length
    }
    const rows = new Map<number, { n: number; sx: number; sy: number; minX: number }>()
    for (const c of grid.cells) {
      const r = rows.get(c.row) ?? { n: 0, sx: 0, sy: 0, minX: Infinity }
      r.n++
      r.sx += c.centroid.x
      r.sy += c.centroid.y
      if (c.centroid.x < r.minX) r.minX = c.centroid.x
      rows.set(c.row, r)
    }
    let frontRow: { d2: number; y: number; minX: number } | undefined
    for (const r of rows.values()) {
      const cx = r.sx / r.n
      const cy = r.sy / r.n
      const d2 = (cx - fx) ** 2 + (cy - fy) ** 2
      if (!frontRow || d2 < frontRow.d2) frontRow = { d2, y: cy, minX: r.minX }
    }
    if (frontRow) {
      children.push(
        el(
          'text',
          {
            x: proj.x(frontRow.minX) - side / 2 - 5,
            y: proj.y(frontRow.y) + 3,
            'font-family': 'monospace',
            'font-size': 9,
            fill: t.lanes.crowd,
            'text-anchor': 'end',
          },
          'front',
        ),
      )
    }
  }

  // Beam throw arcs under the glyph layer.
  for (const a of site.assets) {
    if (a.kind !== 'beamArray') continue
    const rM = beamThrowRadiusM(a.elevationM, beamWidthDeg)
    if (!(rM > 0)) continue
    children.push(
      el('circle', {
        class: 'throw-arc',
        cx: proj.x(a.pos.x),
        cy: proj.y(a.pos.y),
        r: rM * s,
        fill: t.lanes.beams,
        'fill-opacity': '0.05',
        stroke: t.lanes.beams,
        'stroke-opacity': '0.3',
        'stroke-width': 1,
      }),
    )
  }

  for (const a of site.assets) children.push(assetGlyph(a, proj))
  for (const p of site.refListenerPos) children.push(earArcs(proj.x(p.x), proj.y(p.y)))

  children.push(windArrow(w - MARGIN_PX - 40, mapTop + 16, site.wind.dirDegFrom, site.wind.speedMps))

  // 50 m scale bar in the bottom margin strip.
  const barY = h - 14
  const barX = MARGIN_PX
  const barW = 50 * s
  children.push(
    el('line', { x1: barX, y1: barY, x2: barX + barW, y2: barY, stroke: t.ink, 'stroke-width': 1.5 }),
    el('line', { x1: barX, y1: barY - 4, x2: barX, y2: barY + 4, stroke: t.ink, 'stroke-width': 1.5 }),
    el('line', { x1: barX + barW, y1: barY - 4, x2: barX + barW, y2: barY + 4, stroke: t.ink, 'stroke-width': 1.5 }),
    el(
      'text',
      {
        x: barX + barW / 2,
        y: barY - 7,
        'font-family': 'monospace',
        'font-size': 10,
        fill: t.ink,
        'text-anchor': 'middle',
      },
      '50 m',
    ),
  )

  return galleryDoc(
    w,
    h,
    { title: `Site plan — ${site.id}`, desc: 'Top-down venue map, north up, uniform scale.' },
    children,
  )
}
