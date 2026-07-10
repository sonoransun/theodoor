/**
 * gallery/scene.ts — document scaffolding shared by every gallery builder.
 *
 * galleryDoc() is the pixel-unit counterpart of fab's svgDoc(): a viewBox-only
 * <svg> (GitHub scales it to the column width) carrying <title>/<desc> for
 * accessibility, a provenance comment, and an opaque page-background rect —
 * gallery images are self-contained dark artwork that reads identically on
 * light and dark GitHub themes. Nothing here (or in any builder) may rely on
 * `currentColor`: inside GitHub's <img> it resolves to black.
 */

import { el, escapeText, fmtMm } from '../fab/svg.js'
import { GALLERY_THEME } from './theme.js'

export interface GalleryDocOpts {
  title: string
  desc?: string
}

/** Provenance note stamped into every generated gallery file (no clocks). */
export const GALLERY_PROVENANCE =
  '<!-- generated deterministically by `theodoor gallery`; regenerate with `npm run gallery` -->'

/**
 * Wrap children in a complete pixel-unit SVG document: viewBox 0 0 w h,
 * <title>/<desc>, provenance comment, and the opaque page background.
 */
export function galleryDoc(
  w: number,
  h: number,
  opts: GalleryDocOpts,
  children: readonly string[],
): string {
  const head =
    el('title', {}, escapeText(opts.title)) +
    (opts.desc !== undefined ? el('desc', {}, escapeText(opts.desc)) : '')
  const bg = el('rect', { x: 0, y: 0, width: w, height: h, fill: GALLERY_THEME.pageBg })
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${fmtMm(w)} ${fmtMm(h)}`,
      role: 'img',
    },
    GALLERY_PROVENANCE + head + bg + children.join(''),
  )
}

/**
 * Night-sky panel: vertical gradient from GALLERY_THEME.bgTop to bgBottom
 * over [0, groundY], plus the ground line. Gradient ids are namespaced by
 * `idSuffix` so a document can hold more than one panel.
 */
export function nightBackdrop(
  x: number,
  y: number,
  w: number,
  groundY: number,
  idSuffix = '',
): string {
  const id = `nightSky${idSuffix}`
  const grad = el(
    'linearGradient',
    { id, x1: 0, y1: 0, x2: 0, y2: 1, gradientTransform: undefined },
    el('stop', { offset: '0', 'stop-color': GALLERY_THEME.bgTop }) +
      el('stop', { offset: '1', 'stop-color': GALLERY_THEME.bgBottom }),
  )
  return (
    el('defs', {}, grad) +
    el('rect', { x, y, width: w, height: groundY - y, fill: `url(#${id})` }) +
    el('line', {
      x1: x,
      y1: groundY,
      x2: x + w,
      y2: groundY,
      stroke: GALLERY_THEME.ground,
      'stroke-width': 1,
    })
  )
}

/** Front-view world→view mapping: world x (east) → px x, world z (up) → px y. */
export interface SkyProjection {
  toX(xM: number): number
  toY(zM: number): number
  readonly groundY: number
  readonly pxPerMx: number
  readonly pxPerMz: number
}

/**
 * Build a sky projection for a panel of width `w` px whose ground line sits
 * at `groundY` px: world x ∈ [−worldHalfWidthM, +worldHalfWidthM] spans the
 * panel, world z ∈ [0, maxAltM] spans [groundY, topPadPx].
 */
export function skyProject(
  w: number,
  groundY: number,
  worldHalfWidthM: number,
  maxAltM: number,
  topPadPx = 12,
): SkyProjection {
  const pxPerMx = w / (2 * worldHalfWidthM)
  const pxPerMz = (groundY - topPadPx) / maxAltM
  return {
    toX: (xM) => w / 2 + xM * pxPerMx,
    toY: (zM) => groundY - zM * pxPerMz,
    groundY,
    pxPerMx,
    pxPerMz,
  }
}

/** Small monospace label in the gallery ink color. */
export function label(x: number, y: number, content: string, attrs: Record<string, string | number | undefined> = {}): string {
  return el(
    'text',
    {
      x,
      y,
      'font-family': 'monospace',
      'font-size': 11,
      fill: GALLERY_THEME.ink,
      ...attrs,
    },
    escapeText(content),
  )
}
