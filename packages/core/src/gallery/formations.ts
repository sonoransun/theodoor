/**
 * gallery/formations.ts -- formation point clouds as gallery imagery: single
 * stills, multi-tile contact sheets, and SMIL morph loops.
 *
 * View mapping: formations live in the world x-z plane (z up), so view x is
 * world x and view y is world z FLIPPED, auto-fit (uniform scale, centered)
 * to the formation's x/z bounding box. Volumetric clouds (world y varies,
 * e.g. scatter/bloom) encode depth as opacity 0.35..1 -- points nearer the
 * audience (smaller world y) render brighter.
 *
 * Colors are always explicit (never currentColor): points carrying r/g/b use
 * rgbToHex, everything else takes the fallback (theme drone lane). Sheets
 * hoist a shared fill onto the per-tile <g> when a tile is single-color so
 * per-point fill attributes only appear where colors actually vary.
 */

import type { Formation, FormationPoint } from '../contracts.js'
import { resampleTo } from '../choreo/generators/formations.js'
import { el, escapeText, type SvgAttrValue } from '../fab/svg.js'
import { rgbToHex } from '../math/color.js'
import { animate, animateTransform, holdLoopKeyTimes, translateValues } from './anim.js'
import { galleryDoc, label } from './scene.js'
import { GALLERY_THEME } from './theme.js'

/** World x/z -> view px mapping produced by fitFormation(). */
interface FormationFit {
  toX(xM: number): number
  toY(zM: number): number
}

/**
 * Uniform-scale fit of a point cloud's x/z bounding box into the view box
 * [x0, x0+w] x [y0, y0+h] with padPx padding on every side, centered; world
 * z is up so view y is flipped. Degenerate spans (single point, straight
 * vertical/horizontal outlines) fall back to a span of 1 m on that axis.
 */
function fitFormation(
  points: readonly FormationPoint[],
  x0: number,
  y0: number,
  w: number,
  h: number,
  padPx: number,
): FormationFit {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  if (points.length === 0) {
    minX = maxX = minZ = maxZ = 0
  }
  const spanX = maxX - minX || 1
  const spanZ = maxZ - minZ || 1
  const scale = Math.min((w - 2 * padPx) / spanX, (h - 2 * padPx) / spanZ)
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  return {
    toX: (xM) => x0 + w / 2 + (xM - cx) * scale,
    toY: (zM) => y0 + h / 2 - (zM - cz) * scale,
  }
}

/** Hex for a point carrying color, else undefined (caller picks the fallback). */
function pointHex(p: FormationPoint): string | undefined {
  return p.r !== undefined && p.g !== undefined && p.b !== undefined
    ? rgbToHex(p.r, p.g, p.b)
    : undefined
}

/**
 * Depth (world y) -> opacity: nearer to the audience (smaller y) = brighter.
 * Returns undefined for planar clouds or near-full opacity so the attribute
 * is omitted (keeps bytes down).
 */
function depthOpacity(y: number, yMin: number, ySpan: number): number | undefined {
  if (ySpan < 1e-6) return undefined
  const op = 1 - 0.65 * ((y - yMin) / ySpan)
  return op > 0.95 ? undefined : op
}

/**
 * Circles for one formation fitted into a box. When every point resolves to
 * the same fill the circles omit their fill attribute and `uniformFill`
 * carries it (the caller hoists it onto a wrapping <g>).
 */
function tilePoints(
  points: readonly FormationPoint[],
  x0: number,
  y0: number,
  w: number,
  h: number,
  padPx: number,
  pointR: number,
  fallback: string,
): { markup: string; uniformFill: string | undefined } {
  const fit = fitFormation(points, x0, y0, w, h, padPx)
  let yMin = Infinity
  let yMax = -Infinity
  for (const p of points) {
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  const ySpan = points.length > 0 ? yMax - yMin : 0
  const fills = points.map((p) => pointHex(p) ?? fallback)
  const uniform =
    fills.length === 0 || fills.every((c) => c === fills[0]) ? (fills[0] ?? fallback) : undefined
  const parts: string[] = []
  points.forEach((p, i) => {
    const attrs: Record<string, SvgAttrValue> = { cx: fit.toX(p.x), cy: fit.toY(p.z), r: pointR }
    if (uniform === undefined) attrs['fill'] = fills[i]
    const op = depthOpacity(p.y, yMin, ySpan)
    if (op !== undefined) attrs['opacity'] = op
    parts.push(el('circle', attrs))
  })
  return { markup: parts.join(''), uniformFill: uniform }
}

export interface FormationSvgOpts {
  /** Default 240. */
  widthPx?: number
  /** Default 200. */
  heightPx?: number
  /** Optional monospace caption centered under the cloud. */
  label?: string
  /** Point radius in px, default 1.6. */
  pointR?: number
  /** Fill for colorless points, default the theme drone lane. */
  fallbackColor?: string
}

/** One formation as a self-contained still. */
export function formationSvg(f: Formation, opts: FormationSvgOpts = {}): string {
  const w = opts.widthPx ?? 240
  const h = opts.heightPx ?? 200
  const capH = opts.label !== undefined ? 18 : 0
  const tile = tilePoints(
    f.points,
    0,
    0,
    w,
    h - capH,
    12,
    opts.pointR ?? 1.6,
    opts.fallbackColor ?? GALLERY_THEME.lanes.drones,
  )
  const children: string[] = [
    el('g', tile.uniformFill !== undefined ? { fill: tile.uniformFill } : {}, tile.markup),
  ]
  if (opts.label !== undefined) {
    children.push(label(w / 2, h - 6, opts.label, { 'text-anchor': 'middle' }))
  }
  return galleryDoc(
    w,
    h,
    { title: opts.label ?? f.name, desc: `formation ${f.name} (${f.points.length} points)` },
    children,
  )
}

export interface FormationSheetOpts {
  /** Tile width px, default 150. */
  tileW?: number
  /** Tile height px, default 140. */
  tileH?: number
}

/** Contact sheet: a cols-wide grid of labeled formation tiles in one document. */
export function formationSheetSvg(
  entries: readonly { f: Formation; label: string }[],
  cols: number,
  opts: FormationSheetOpts = {},
): string {
  if (!(cols >= 1)) throw new Error('formationSheetSvg: cols must be >= 1')
  const tileW = opts.tileW ?? 150
  const tileH = opts.tileH ?? 140
  const rows = Math.ceil(entries.length / cols)
  const w = cols * tileW
  const h = Math.max(rows, 1) * tileH
  const capH = 16
  const children: string[] = []
  entries.forEach((e, i) => {
    const x0 = (i % cols) * tileW
    const y0 = Math.floor(i / cols) * tileH
    const tile = tilePoints(
      e.f.points,
      x0,
      y0,
      tileW,
      tileH - capH,
      10,
      1.6,
      GALLERY_THEME.lanes.drones,
    )
    children.push(
      el('g', tile.uniformFill !== undefined ? { fill: tile.uniformFill } : {}, tile.markup),
    )
    children.push(
      label(x0 + tileW / 2, y0 + tileH - 5, e.label, { 'text-anchor': 'middle', 'font-size': 10 }),
    )
  })
  return galleryDoc(
    w,
    h,
    {
      title: `formation sheet (${entries.length} kinds)`,
      desc: 'contact sheet of formation generators, one labeled tile each',
    },
    children,
  )
}

export interface FormationMorphOpts {
  /** One full loop (all keyframes plus the hold), seconds. */
  durSec: number
  /** Fraction of the loop the final keyframe holds before restarting; default 0.08. */
  holdFrac?: number
  /** Default 480. */
  widthPx?: number
  /** Default 360. */
  heightPx?: number
  /** Caption per keyframe, cross-faded in sync with keyframe arrival. */
  labels?: readonly string[]
}

/**
 * SMIL morph loop: keyframes are resampled to a common count (the largest
 * keyframe, seed 1) and paired BY INDEX; each point is one <circle> carrying
 * one animateTransform translate through every keyframe position (linear)
 * with the final value duplicated and pinned via holdLoopKeyTimes, so the
 * last shape holds briefly before the loop snaps back to the first.
 */
export function formationMorphSvg(
  keyframes: readonly Formation[],
  opts: FormationMorphOpts,
): string {
  const K = keyframes.length
  if (K < 2) throw new Error('formationMorphSvg: need at least 2 keyframes')
  if (opts.labels !== undefined && opts.labels.length !== K) {
    throw new Error('formationMorphSvg: labels length must match keyframes length')
  }
  if (!(opts.durSec > 0)) throw new Error('formationMorphSvg: durSec must be > 0')
  const w = opts.widthPx ?? 480
  const h = opts.heightPx ?? 360
  const holdFrac = opts.holdFrac ?? 0.08
  const count = Math.max(...keyframes.map((f) => f.points.length))
  const kfs = keyframes.map((f) => resampleTo(f.points, count, 1))
  const capH = opts.labels !== undefined ? 20 : 0
  const fit = fitFormation(kfs.flat(), 0, 0, w, h - capH, 16)
  const keyTimes = holdLoopKeyTimes(K + 1, holdFrac)
  const fallback = GALLERY_THEME.lanes.drones

  const circles: string[] = []
  for (let i = 0; i < count; i++) {
    const viewPts = kfs.map((pts) => ({ x: fit.toX(pts[i]!.x), y: fit.toY(pts[i]!.z) }))
    const values = translateValues([...viewPts, viewPts[K - 1]!])
    let fill: string = fallback
    for (const pts of kfs) {
      const hex = pointHex(pts[i]!)
      if (hex !== undefined) {
        fill = hex
        break
      }
    }
    circles.push(
      el(
        'circle',
        { cx: 0, cy: 0, r: 2, fill },
        animateTransform('translate', { values, durSec: opts.durSec, keyTimes }),
      ),
    )
  }

  const children: string[] = [el('g', {}, circles.join(''))]
  if (opts.labels !== undefined) {
    opts.labels.forEach((s, j) => {
      const vals = keyframes.map((_, k) => (k === j ? '1' : '0'))
      vals.push(vals[K - 1]!)
      children.push(
        el(
          'text',
          {
            x: w / 2,
            y: h - 7,
            'font-family': 'monospace',
            'font-size': 11,
            fill: GALLERY_THEME.ink,
            'text-anchor': 'middle',
            opacity: 0,
          },
          escapeText(s) +
            animate('opacity', {
              values: vals,
              durSec: opts.durSec,
              keyTimes,
              calcMode: 'discrete',
            }),
        ),
      )
    })
  }
  return galleryDoc(
    w,
    h,
    {
      title: `morph ${keyframes.map((f) => f.name).join(' -> ')}`,
      desc: `index-paired morph loop through ${K} keyframes, ${count} points`,
    },
    children,
  )
}
