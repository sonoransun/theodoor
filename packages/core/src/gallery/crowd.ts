/**
 * gallery/crowd.ts -- top-down crowd-canvas imagery: the animated cell-grid
 * loop and the latency-ramp explainer.
 *
 * Grid layout: both builders take a plain { cols, rows } and address cell
 * index = row * cols + col, matching crowdGridFor()'s row-major scan on
 * sites whose audience zone keeps every bbox cell (lakesidePark's 38x9 lawn
 * keeps all 342). The map renders north-up: the highest row index (the lawn
 * edge nearest the stage) sits at the TOP of the image.
 *
 * SMIL looping note (crowdRampSvg): a repeating animation's period IS its
 * dur, so each cell's animate spans the whole loop (dur = loopDurSec) and
 * encodes its send offset as a `begin` -- the rise happens `delaySec` into
 * every loop, holds, and joins the shared fade-out window at the end of the
 * loop (expressed in cycle-local keyTimes because the cycle itself is offset
 * by the begin).
 */

import type { GalleryFrame } from './sample.js'
import { el } from '../fab/svg.js'
import { rgbToHex } from '../math/color.js'
import { animate, animateTransform, holdLoopKeyTimes, translateValues } from './anim.js'
import { galleryDoc, label } from './scene.js'
import { GALLERY_THEME } from './theme.js'

/**
 * Quantized display color of one crowd cell in one frame: wristband rgb with
 * the phone-flashlight white channel added into every channel (rgbToHex
 * clamps). Shared with the sky builders' lawn band.
 */
export function crowdCellHex(frame: GalleryFrame, index: number): string {
  const white = frame.crowd.white[index] ?? 0
  return rgbToHex(
    (frame.crowd.rgb[3 * index] ?? 0) + white,
    (frame.crowd.rgb[3 * index + 1] ?? 0) + white,
    (frame.crowd.rgb[3 * index + 2] ?? 0) + white,
  )
}

/** Hold fraction shared by the crowd loops (house hold-and-restart style). */
const CROWD_HOLD_FRAC = 0.06

export interface CrowdLoopOpts {
  loopDurSec: number
  /** Default 880. */
  widthPx?: number
  /** Default 1. */
  cellGapPx?: number
  title?: string
}

/**
 * Top-down crowd-canvas loop: one rect per cell that ever lights, stepping
 * through its quantized per-frame colors with a discrete fill animate; cells
 * whose color never changes render once (their constant color, or the dim
 * panel base when they never light) with no animate at all.
 */
export function crowdLoopSvg(
  frames: readonly GalleryFrame[],
  grid: { cols: number; rows: number },
  opts: CrowdLoopOpts,
): string {
  const F = frames.length
  if (F < 2) throw new Error('crowdLoopSvg: need at least 2 frames')
  if (!(opts.loopDurSec > 0)) throw new Error('crowdLoopSvg: loopDurSec must be > 0')
  if (!(grid.cols >= 1) || !(grid.rows >= 1)) throw new Error('crowdLoopSvg: bad grid')
  const w = opts.widthPx ?? 880
  const gap = opts.cellGapPx ?? 1
  const cellPx = w / grid.cols
  const h = cellPx * grid.rows
  const keyTimes = holdLoopKeyTimes(F + 1, CROWD_HOLD_FRAC)
  const n = Math.min(frames[0]!.crowd.cellCount, grid.cols * grid.rows)

  const parts: string[] = []
  for (let idx = 0; idx < n; idx++) {
    const col = idx % grid.cols
    const row = Math.floor(idx / grid.cols)
    const attrs = {
      x: col * cellPx + gap / 2,
      y: (grid.rows - 1 - row) * cellPx + gap / 2,
      width: cellPx - gap,
      height: cellPx - gap,
    }
    const hexes = frames.map((f) => crowdCellHex(f, idx))
    if (hexes.every((x) => x === hexes[0])) {
      // Never changes: constant color, or the dim base when it never lights.
      const fill = hexes[0] === '#000000' ? GALLERY_THEME.panelBg : hexes[0]!
      parts.push(el('rect', { ...attrs, fill }))
      continue
    }
    parts.push(
      el(
        'rect',
        { ...attrs, fill: hexes[0]! },
        animate('fill', {
          values: [...hexes, hexes[F - 1]!],
          durSec: opts.loopDurSec,
          keyTimes,
          calcMode: 'discrete',
        }),
      ),
    )
  }
  return galleryDoc(
    w,
    h,
    {
      title: opts.title ?? 'crowd canvas loop',
      desc: `top-down ${grid.cols}x${grid.rows} crowd grid over ${F} frames`,
    },
    parts,
  )
}

export interface CrowdRampCell {
  col: number
  row: number
  /** Send offset into the loop, seconds (its rect lights this late). */
  delaySec: number
}

export interface CrowdRampOpts {
  /** When the shared beat lands, seconds into the loop (the hit-color tick). */
  fireToLandSec: number
  loopDurSec: number
  /** Default 880. */
  widthPx?: number
  /** Cell color, default the theme crowd lane. */
  color?: string
  title?: string
}

/** Cell rise time and shared end-of-loop fade (seconds). */
const RAMP_RISE_SEC = 0.12
const RAMP_FADE_SEC = 0.6

/**
 * Latency-ramp explainer: each cell rect carries a single opacity animate
 * rising 0 -> 0.9 at `delaySec` into the loop (begin offset), holding, then
 * joining the shared fade-out in the last RAMP_FADE_SEC of the loop. Below
 * the grid, a time ruler marks t=0 ('fire', hollow circle), the landing beat
 * ('land (beat)', hit-color tick), and a playhead sweeping once per loop.
 */
export function crowdRampSvg(
  cells: readonly CrowdRampCell[],
  grid: { cols: number; rows: number },
  opts: CrowdRampOpts,
): string {
  const L = opts.loopDurSec
  if (!(L > 0)) throw new Error('crowdRampSvg: loopDurSec must be > 0')
  if (!(grid.cols >= 1) || !(grid.rows >= 1)) throw new Error('crowdRampSvg: bad grid')
  const w = opts.widthPx ?? 880
  const color = opts.color ?? GALLERY_THEME.lanes.crowd
  const gap = 1
  const cellPx = w / grid.cols
  const gridH = cellPx * grid.rows
  const RULER_H = 44
  const h = gridH + RULER_H

  const parts: string[] = [
    el('rect', { x: 0, y: 0, width: w, height: gridH, fill: GALLERY_THEME.panelBg }),
  ]
  for (const c of cells) {
    const d = Math.max(0, Math.min(c.delaySec, L - 1e-3))
    const rise = Math.min(RAMP_RISE_SEC / L, 0.5)
    // Cycle-local keyTimes: this animate's cycle is [d, d + L], so the shared
    // absolute fade window [L - RAMP_FADE_SEC, L] lands at (t - d) / L.
    const fadeStart = Math.min(Math.max((L - RAMP_FADE_SEC - d) / L, rise), 1)
    const fadeEnd = Math.min(Math.max((L - d) / L, fadeStart), 1)
    parts.push(
      el(
        'rect',
        {
          x: c.col * cellPx + gap / 2,
          y: (grid.rows - 1 - c.row) * cellPx + gap / 2,
          width: cellPx - gap,
          height: cellPx - gap,
          fill: color,
          opacity: 0,
        },
        animate('opacity', {
          values: ['0', '0.9', '0.9', '0', '0'],
          durSec: L,
          keyTimes: [0, rise, fadeStart, fadeEnd, 1],
          beginSec: d,
        }),
      ),
    )
  }

  // Time ruler: 0..loopDurSec across the grid width.
  const ry = gridH + 26
  const rx0 = 18
  const rx1 = w - 18
  const xAt = (t: number): number => rx0 + (Math.max(0, Math.min(t, L)) / L) * (rx1 - rx0)
  parts.push(
    el('line', { x1: rx0, y1: ry, x2: rx1, y2: ry, stroke: GALLERY_THEME.grid, 'stroke-width': 1 }),
    el('circle', {
      cx: xAt(0),
      cy: ry,
      r: 4,
      fill: 'none',
      stroke: GALLERY_THEME.ink,
      'stroke-width': 1.2,
    }),
    label(xAt(0), ry + 14, 'fire', { 'text-anchor': 'middle', 'font-size': 10 }),
    el('line', {
      x1: xAt(opts.fireToLandSec),
      y1: ry - 7,
      x2: xAt(opts.fireToLandSec),
      y2: ry + 7,
      stroke: GALLERY_THEME.hit,
      'stroke-width': 2,
    }),
    label(xAt(opts.fireToLandSec), ry + 14, 'land (beat)', {
      'text-anchor': 'middle',
      'font-size': 10,
      fill: GALLERY_THEME.hit,
    }),
    el(
      'line',
      {
        x1: 0,
        y1: gridH + 4,
        x2: 0,
        y2: gridH + RULER_H - 4,
        stroke: GALLERY_THEME.inkDim,
        'stroke-width': 1,
      },
      animateTransform('translate', {
        values: translateValues([
          { x: rx0, y: 0 },
          { x: rx1, y: 0 },
        ]),
        durSec: L,
      }),
    ),
  )
  return galleryDoc(
    w,
    h,
    {
      title: opts.title ?? 'crowd latency ramp',
      desc: `staggered sends over a ${grid.cols}x${grid.rows} grid landing together on the beat`,
    },
    parts,
  )
}
