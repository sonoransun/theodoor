/**
 * gallery/keystone.ts — the anticipation ("fire early, land together") chart.
 *
 * One row per hand-picked cue: a hollow circle marks fireSec, a bar spans the
 * anticipation window to targetSec (the musical landing, a filled diamond),
 * and a faint continuation shows the effect's duration. The right gutter
 * prints each cue's solved anticipationSec, which is the whole point of the
 * chart. A beat grid, an optional climax-color rule, and an optional bracket
 * callout tie the rows back to the music.
 *
 * All colors come from GALLERY_THEME (never currentColor: GitHub renders repo
 * SVGs inside <img>, where currentColor resolves to black).
 */

import type { CompiledCue, CompiledShow, Seconds } from '../contracts.js'
import { el, escapeText, fmtMm } from '../fab/svg.js'
import { galleryDoc, label } from './scene.js'
import { GALLERY_THEME, laneColorFor } from './theme.js'

export interface KeystoneRow {
  cueId: string
  /** Optional annotation rendered under the cue id in the left gutter. */
  note?: string
}

export interface KeystoneOpts {
  /** Cues to chart, top to bottom (order preserved). */
  rows: readonly KeystoneRow[]
  fromSec: Seconds
  toSec: Seconds
  /** Document width, px (default 880). */
  widthPx?: number
  /** Thin music-color beat lines from the show's beat grid (default true). */
  beatTicks?: boolean
  /** Climax-color vertical rule with a label. */
  ruleAt?: { tSec: Seconds; label: string }
  /** Bracket + text above the named row's anticipation bar. */
  callout?: { text: string; atRowOfCueId: string }
  /** Document title (defaults to the compiled show's title). */
  title?: string
}

const GUTTER_L = 140
const GUTTER_R = 64
const TITLE_H = 30
const ROW_H = 34
const BOTTOM_PAD = 12

function diamond(cx: number, cy: number, rx: number, ry: number, fill: string): string {
  const f = fmtMm
  return el('path', {
    d: `M${f(cx)} ${f(cy - ry)}L${f(cx + rx)} ${f(cy)}L${f(cx)} ${f(cy + ry)}L${f(cx - rx)} ${f(cy)}Z`,
    fill,
  })
}

/** Render the keystone chart for the listed cues over [fromSec, toSec]. */
export function keystoneChartSvg(compiled: CompiledShow, opts: KeystoneOpts): string {
  const t = GALLERY_THEME
  const w = opts.widthPx ?? 880
  if (!(opts.toSec > opts.fromSec)) {
    throw new Error('keystoneChartSvg: toSec must be greater than fromSec')
  }
  const byId = new Map(compiled.cues.map((c) => [c.id, c]))
  const rows: { spec: KeystoneRow; cue: CompiledCue }[] = opts.rows.map((spec) => {
    const cue = byId.get(spec.cueId)
    if (!cue) throw new Error(`keystoneChartSvg: unknown cueId '${spec.cueId}'`)
    return { spec, cue }
  })

  const h = TITLE_H + rows.length * ROW_H + BOTTOM_PAD
  const rowsBottom = TITLE_H + rows.length * ROW_H
  const xR = w - GUTTER_R
  const k = (xR - GUTTER_L) / (opts.toSec - opts.fromSec)
  const x = (sec: Seconds): number => GUTTER_L + (sec - opts.fromSec) * k
  const cx = (sec: Seconds): number => Math.min(Math.max(x(sec), GUTTER_L), xR)
  const rowTop = (i: number): number => TITLE_H + i * ROW_H
  const barY = (i: number): number => rowTop(i) + 20

  const title = opts.title ?? `${compiled.show.meta.title} — keystone`
  const children: string[] = []
  children.push(label(12, 19, title, { 'font-size': 13 }))

  // Beat grid behind the rows.
  if (opts.beatTicks !== false) {
    for (const b of compiled.show.music.beats) {
      if (b < opts.fromSec || b > opts.toSec) continue
      children.push(
        el('line', {
          x1: x(b),
          y1: TITLE_H,
          x2: x(b),
          y2: rowsBottom,
          stroke: t.lanes.music,
          'stroke-width': 1,
          'stroke-opacity': '0.18',
        }),
      )
    }
  }

  // Row separators.
  for (let i = 0; i <= rows.length; i++) {
    children.push(
      el('line', {
        x1: GUTTER_L,
        y1: rowTop(i),
        x2: xR,
        y2: rowTop(i),
        stroke: t.grid,
        'stroke-width': 1,
      }),
    )
  }

  rows.forEach(({ spec, cue }, i) => {
    const color = laneColorFor(cue.medium)
    const yc = barY(i)
    const xf = cx(cue.fireSec)
    const xt = cx(cue.targetSec)
    const xe = cx(cue.targetSec + cue.durationSec)

    // Faint continuation to the end of the effect, then the anticipation bar.
    if (xe - xt > 0.05) {
      children.push(
        el('rect', { x: xt, y: yc - 3, width: xe - xt, height: 6, fill: color, 'fill-opacity': '0.25' }),
      )
    }
    if (xt - xf > 0.05) {
      children.push(
        el('rect', { x: xf, y: yc - 4, width: xt - xf, height: 8, rx: 2, fill: color, 'fill-opacity': '0.8' }),
      )
    }
    children.push(
      el('circle', { cx: xf, cy: yc, r: 4, fill: 'none', stroke: color, 'stroke-width': 1.5 }),
      diamond(xt, yc, 4.5, 5.5, color),
    )

    // Left gutter: cue id (+ optional note); right gutter: anticipation.
    if (spec.note !== undefined) {
      children.push(
        el(
          'text',
          { x: 12, y: yc, 'font-family': 'monospace', 'font-size': 11, fill: t.ink },
          escapeText(spec.cueId),
        ),
        el(
          'text',
          { x: 12, y: yc + 11, 'font-family': 'monospace', 'font-size': 9, fill: t.inkDim },
          escapeText(spec.note),
        ),
      )
    } else {
      children.push(
        el(
          'text',
          { x: 12, y: yc + 4, 'font-family': 'monospace', 'font-size': 11, fill: t.ink },
          escapeText(spec.cueId),
        ),
      )
    }
    children.push(
      el(
        'text',
        { x: xR + 8, y: yc + 4, 'font-family': 'monospace', 'font-size': 10, fill: t.ink },
        `${cue.anticipationSec.toFixed(2)}s`,
      ),
    )
  })

  // Climax-color rule + label.
  if (opts.ruleAt !== undefined) {
    const rx = cx(opts.ruleAt.tSec)
    children.push(
      el('line', {
        x1: rx,
        y1: TITLE_H,
        x2: rx,
        y2: rowsBottom,
        stroke: t.climax,
        'stroke-width': 1.2,
        'stroke-opacity': '0.9',
      }),
      el(
        'text',
        { x: rx + 5, y: TITLE_H + 10, 'font-family': 'monospace', 'font-size': 10, fill: t.climax },
        escapeText(opts.ruleAt.label),
      ),
    )
  }

  // Bracket callout above the named row's anticipation bar.
  if (opts.callout !== undefined) {
    const j = rows.findIndex((r) => r.spec.cueId === opts.callout!.atRowOfCueId)
    if (j < 0) {
      throw new Error(`keystoneChartSvg: callout cueId '${opts.callout.atRowOfCueId}' is not a row`)
    }
    const cue = rows[j]!.cue
    const x1 = cx(cue.fireSec)
    const x2 = cx(cue.targetSec)
    const by = rowTop(j) + 9
    const f = fmtMm
    children.push(
      el('path', {
        d: `M${f(x1)} ${f(by + 3)}L${f(x1)} ${f(by)}L${f(x2)} ${f(by)}L${f(x2)} ${f(by + 3)}`,
        fill: 'none',
        stroke: t.ink,
        'stroke-width': 1,
      }),
      el(
        'text',
        {
          x: (x1 + x2) / 2,
          y: by - 3,
          'font-family': 'monospace',
          'font-size': 10,
          fill: t.ink,
          'text-anchor': 'middle',
        },
        escapeText(opts.callout.text),
      ),
    )
  }

  return galleryDoc(
    w,
    h,
    { title, desc: 'Per-cue anticipation: fire marker, landing diamond, solved lead time.' },
    children,
  )
}
