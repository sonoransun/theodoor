/**
 * fab/svg.ts — tiny deterministic SVG string builder for fabrication drawings.
 *
 * All fab output is staging hardware only (racks, frames, mounting plates).
 * Units are millimeters: svgDoc() maps 1 user unit = 1 mm by pairing mm
 * width/height with an equal-sized viewBox. Every numeric attribute is
 * rounded to 0.1 mm so output is stable and byte-identical across runs.
 */

export type SvgAttrValue = string | number | undefined
export type SvgAttrs = Readonly<Record<string, SvgAttrValue>>

/** Marker id used by dim(); svgDoc() always emits the matching <defs>. */
export const DIM_ARROW_ID = 'dimArrow'

/** Round to 0.1 mm and render without float noise ('-0' normalizes to '0'). */
export function fmtMm(n: number): string {
  const r = Math.round(n * 10) / 10
  return (r === 0 ? 0 : r).toString()
}

/** Escape a string for use inside a double-quoted attribute value. */
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Escape a string for use as element text content. */
export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Build one element. Numeric attribute values are rounded to 0.1 mm, string
 * values are attribute-escaped, undefined values are omitted. Children are
 * raw markup (already-built elements); omit for a self-closing element.
 */
export function el(tag: string, attrs: SvgAttrs = {}, children?: string): string {
  let out = `<${tag}`
  for (const key of Object.keys(attrs)) {
    const v = attrs[key]
    if (v === undefined) continue
    out += ` ${key}="${typeof v === 'number' ? fmtMm(v) : escapeAttr(v)}"`
  }
  return children === undefined ? `${out}/>` : `${out}>${children}</${tag}>`
}

export function rect(x: number, y: number, w: number, h: number, attrs: SvgAttrs = {}): string {
  return el('rect', {
    x,
    y,
    width: w,
    height: h,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 0.6,
    ...attrs,
  })
}

export function line(x1: number, y1: number, x2: number, y2: number, attrs: SvgAttrs = {}): string {
  return el('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 0.4, ...attrs })
}

export function circle(cx: number, cy: number, r: number, attrs: SvgAttrs = {}): string {
  return el('circle', { cx, cy, r, fill: 'none', stroke: 'currentColor', 'stroke-width': 0.4, ...attrs })
}

export function text(x: number, y: number, content: string, attrs: SvgAttrs = {}): string {
  return el(
    'text',
    { x, y, 'font-family': 'monospace', 'font-size': 5, fill: 'currentColor', ...attrs },
    escapeText(content),
  )
}

export function group(children: readonly string[], attrs: SvgAttrs = {}): string {
  return el('g', attrs, children.join(''))
}

/**
 * Dimension annotation: a line with arrowhead markers at both ends and a
 * centered label offset 2.5 mm to the line's left-hand side (above, for a
 * left-to-right line).
 */
export function dim(x1: number, y1: number, x2: number, y2: number, label: string): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const nx = len > 0 ? dy / len : 0
  const ny = len > 0 ? -dx / len : -1
  const mx = (x1 + x2) / 2 + nx * 2.5
  const my = (y1 + y2) / 2 + ny * 2.5
  return group(
    [
      line(x1, y1, x2, y2, {
        'marker-start': `url(#${DIM_ARROW_ID})`,
        'marker-end': `url(#${DIM_ARROW_ID})`,
      }),
      text(mx, my, label, { 'text-anchor': 'middle' }),
    ],
    { class: 'dim' },
  )
}

/**
 * Wrap children in a complete SVG document sized in millimeters, with a
 * matching viewBox (1 unit = 1 mm) and the dimension-arrow marker defs.
 */
export function svgDoc(widthMm: number, heightMm: number, children: readonly string[]): string {
  const marker = el(
    'marker',
    {
      id: DIM_ARROW_ID,
      markerWidth: 8,
      markerHeight: 8,
      refX: 7,
      refY: 3,
      orient: 'auto-start-reverse',
      markerUnits: 'userSpaceOnUse',
    },
    el('path', { d: 'M0,0 L7,3 L0,6 Z', fill: 'currentColor' }),
  )
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: `${fmtMm(widthMm)}mm`,
      height: `${fmtMm(heightMm)}mm`,
      viewBox: `0 0 ${fmtMm(widthMm)} ${fmtMm(heightMm)}`,
    },
    el('defs', {}, marker) + children.join(''),
  )
}
