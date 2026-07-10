/**
 * gallery/timeline.ts — the seven-lane show timeline poster.
 *
 * Lanes top to bottom: Music, Pyro (incl. fabrication), Drones, Lasers,
 * Panels, Crowd, Beams. The music lane charts downbeat ticks, hit diamonds,
 * and climax diamonds (a strength-1 climax also gets a full-height rule).
 * Every compiled cue renders as a hatched lead-in rect over
 * [fireSec, targetSec] (the anticipation window) plus a solid body over
 * [targetSec, targetSec + durationSec]; dense lanes stack cues round-robin
 * across three sub-rows. Optional act bands sit behind the lanes and an
 * optional SMIL playhead sweeps the span.
 *
 * All colors come from GALLERY_THEME (never currentColor: GitHub renders repo
 * SVGs inside <img>, where currentColor resolves to black).
 */

import type { CompiledShow, Medium, Seconds } from '../contracts.js'
import { el, escapeText, fmtMm } from '../fab/svg.js'
import { animateTransform, translateValues } from './anim.js'
import { galleryDoc, label } from './scene.js'
import { GALLERY_THEME } from './theme.js'

export interface TimelineBand {
  label: string
  fromSec: number
  toSec: number
}

export interface TimelineOpts {
  /** Document width, px (default 960). */
  widthPx?: number
  /** Labeled translucent act bands rendered behind the lanes. */
  bands?: readonly TimelineBand[]
  /** When set, a SMIL playhead sweeps the span in this many seconds. */
  sweepDurSec?: number
}

/** Left gutter reserved for lane labels, px. */
export const TIMELINE_GUTTER_PX = 88
/** Right padding after the plot area, px. */
export const TIMELINE_PAD_RIGHT_PX = 16

const TITLE_H = 30
const LANE_H = 44
const AXIS_H = 26
const SUBROW_H = 10
const SUBROW_GAP = 2
const SUBROWS = 3

const LANES = [
  { key: 'music', name: 'Music', color: GALLERY_THEME.lanes.music },
  { key: 'pyro', name: 'Pyro', color: GALLERY_THEME.lanes.pyro },
  { key: 'drones', name: 'Drones', color: GALLERY_THEME.lanes.drones },
  { key: 'lasers', name: 'Lasers', color: GALLERY_THEME.lanes.lasers },
  { key: 'panels', name: 'Panels', color: GALLERY_THEME.lanes.panels },
  { key: 'crowd', name: 'Crowd', color: GALLERY_THEME.lanes.crowd },
  { key: 'beams', name: 'Beams', color: GALLERY_THEME.lanes.beams },
] as const

/** Cue lane index (fabrication charts on the pyro lane, per laneColorFor). */
function laneIndexFor(medium: Medium): number {
  switch (medium) {
    case 'pyro':
    case 'fabrication':
      return 1
    case 'drone':
      return 2
    case 'laser':
      return 3
    case 'panel':
      return 4
    case 'crowd':
      return 5
    case 'beam':
      return 6
  }
}

export interface TimelineScale {
  /** Axis start: min cue fireSec (pre-roll included), never above 0. */
  t0: Seconds
  /** Axis end: max of the music duration and the last cue's fade-out. */
  t1: Seconds
  x(t: Seconds): number
}

/** The linear time→x mapping timelineSvg uses (exported so tests share it). */
export function timelineScale(compiled: CompiledShow, widthPx = 960): TimelineScale {
  let t0 = 0
  let t1 = compiled.show.music.duration
  for (const c of compiled.cues) {
    if (c.fireSec < t0) t0 = c.fireSec
    const end = c.targetSec + c.durationSec
    if (end > t1) t1 = end
  }
  if (!(t1 > t0)) t1 = t0 + 1
  const xL = TIMELINE_GUTTER_PX
  const k = (widthPx - TIMELINE_PAD_RIGHT_PX - xL) / (t1 - t0)
  return { t0, t1, x: (t) => xL + (t - t0) * k }
}

function fmtClock(sec: number): string {
  const sign = sec < 0 ? '-' : ''
  const abs = Math.abs(sec)
  const m = Math.floor(abs / 60)
  const s = Math.round(abs - m * 60)
  return `${sign}${m}:${String(s).padStart(2, '0')}`
}

function diamond(cx: number, cy: number, rx: number, ry: number, fill: string): string {
  const f = fmtMm
  return el('path', {
    d: `M${f(cx)} ${f(cy - ry)}L${f(cx + rx)} ${f(cy)}L${f(cx)} ${f(cy + ry)}L${f(cx - rx)} ${f(cy)}Z`,
    fill,
  })
}

/** 45° hatch tile in one lane color, referenced by cue lead-in rects. */
function hatchPattern(key: string, color: string): string {
  return el(
    'pattern',
    {
      id: `hatch-${key}`,
      patternUnits: 'userSpaceOnUse',
      width: 6,
      height: 6,
      patternTransform: 'rotate(45)',
    },
    el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: color, 'stroke-width': 2 }),
  )
}

/** Render the seven-lane timeline poster for a compiled show. */
export function timelineSvg(compiled: CompiledShow, opts: TimelineOpts = {}): string {
  const t = GALLERY_THEME
  const w = opts.widthPx ?? 960
  const h = TITLE_H + LANES.length * LANE_H + AXIS_H
  const lanesTop = TITLE_H
  const lanesBottom = TITLE_H + LANES.length * LANE_H
  const scale = timelineScale(compiled, w)
  const laneTop = (i: number): number => lanesTop + i * LANE_H
  const laneCenter = (i: number): number => laneTop(i) + LANE_H / 2
  const subRowY = (i: number, r: number): number =>
    laneTop(i) + (LANE_H - SUBROWS * SUBROW_H - (SUBROWS - 1) * SUBROW_GAP) / 2 + r * (SUBROW_H + SUBROW_GAP)

  const children: string[] = []
  children.push(label(12, 19, `${compiled.show.meta.title} — timeline`, { 'font-size': 13 }))

  // Hatch pattern defs for the lanes that actually carry cues.
  const usedLanes = new Set<number>()
  for (const c of compiled.cues) usedLanes.add(laneIndexFor(c.medium))
  const defs: string[] = []
  for (let i = 1; i < LANES.length; i++) {
    if (usedLanes.has(i)) defs.push(hatchPattern(LANES[i]!.key, LANES[i]!.color))
  }
  if (defs.length > 0) children.push(el('defs', {}, defs.join('')))

  // Act bands behind everything else in the plot.
  const bands = opts.bands ?? []
  bands.forEach((band, i) => {
    const x1 = scale.x(Math.max(band.fromSec, scale.t0))
    const x2 = scale.x(Math.min(band.toSec, scale.t1))
    if (!(x2 > x1)) return
    children.push(
      el('rect', {
        x: x1,
        y: lanesTop,
        width: x2 - x1,
        height: lanesBottom - lanesTop,
        fill: t.accents[i % t.accents.length]!,
        'fill-opacity': '0.08',
      }),
      el(
        'text',
        { x: x1 + 5, y: lanesTop + 12, 'font-family': 'monospace', 'font-size': 10, fill: t.inkDim },
        escapeText(band.label),
      ),
    )
  })

  // Lane separators, labels, and the gutter rule.
  for (let i = 0; i <= LANES.length; i++) {
    children.push(
      el('line', { x1: TIMELINE_GUTTER_PX, y1: laneTop(i), x2: w - TIMELINE_PAD_RIGHT_PX, y2: laneTop(i), stroke: t.grid, 'stroke-width': 1 }),
    )
  }
  children.push(
    el('line', { x1: TIMELINE_GUTTER_PX, y1: lanesTop, x2: TIMELINE_GUTTER_PX, y2: lanesBottom, stroke: t.grid, 'stroke-width': 1 }),
  )
  LANES.forEach((lane, i) => {
    children.push(
      el(
        'text',
        {
          x: TIMELINE_GUTTER_PX - 10,
          y: laneCenter(i) + 4,
          'font-family': 'monospace',
          'font-size': 11,
          fill: lane.color,
          'text-anchor': 'end',
        },
        lane.name,
      ),
    )
  })

  // Time axis: ticks every 30 s, labeled m:ss.
  for (let s = Math.ceil(scale.t0 / 30) * 30; s <= scale.t1 + 1e-9; s += 30) {
    const x = scale.x(s)
    children.push(
      el('line', { x1: x, y1: lanesBottom, x2: x, y2: lanesBottom + 5, stroke: t.inkDim, 'stroke-width': 1 }),
      el(
        'text',
        {
          x,
          y: lanesBottom + 17,
          'font-family': 'monospace',
          'font-size': 10,
          fill: t.inkDim,
          'text-anchor': 'middle',
        },
        fmtClock(s),
      ),
    )
  }

  // Music lane: downbeat ticks, hit diamonds, climax diamonds/rules.
  const music = compiled.show.music
  const musicMid = laneCenter(0)
  for (const d of music.downbeats) {
    const x = scale.x(d)
    children.push(
      el('line', {
        x1: x,
        y1: laneTop(0) + 6,
        x2: x,
        y2: laneTop(1) - 6,
        stroke: t.lanes.music,
        'stroke-width': 1,
        'stroke-opacity': '0.3',
      }),
    )
  }
  for (const a of music.annotations) {
    if (a.kind === 'hit' && a.label !== undefined) {
      children.push(diamond(scale.x(a.time), musicMid, 4, 4, t.hit))
    } else if (a.kind === 'climax') {
      children.push(diamond(scale.x(a.time), musicMid, 4.5, 7, t.climax))
      if (a.strength >= 1) {
        children.push(
          el('line', {
            x1: scale.x(a.time),
            y1: lanesTop,
            x2: scale.x(a.time),
            y2: lanesBottom,
            stroke: t.climax,
            'stroke-width': 1,
            'stroke-opacity': '0.55',
          }),
        )
      }
    }
  }

  // Cues: hatched lead-in [fireSec, targetSec] + solid body, 3 sub-rows.
  const laneCounts = new Map<number, number>()
  for (const c of compiled.cues) {
    const li = laneIndexFor(c.medium)
    const n = laneCounts.get(li) ?? 0
    laneCounts.set(li, n + 1)
    const y = subRowY(li, n % SUBROWS)
    const x1 = scale.x(c.fireSec)
    const x2 = scale.x(c.targetSec)
    const x3 = scale.x(c.targetSec + c.durationSec)
    const lane = LANES[li]!
    if (x2 - x1 > 0.05) {
      children.push(
        el('rect', {
          x: x1,
          y,
          width: x2 - x1,
          height: SUBROW_H,
          fill: `url(#hatch-${lane.key})`,
          'fill-opacity': '0.45',
        }),
      )
    }
    children.push(
      el('rect', {
        x: x2,
        y,
        width: Math.max(x3 - x2, 1),
        height: SUBROW_H,
        fill: lane.color,
        'fill-opacity': '0.85',
      }),
    )
  }

  // SMIL playhead sweeping the full span.
  if (opts.sweepDurSec !== undefined) {
    children.push(
      el(
        'g',
        {},
        el('line', {
          x1: 0,
          y1: lanesTop,
          x2: 0,
          y2: lanesBottom,
          stroke: t.ink,
          'stroke-width': 1,
          'stroke-opacity': '0.8',
        }) +
          animateTransform('translate', {
            values: translateValues([
              { x: scale.x(scale.t0), y: 0 },
              { x: scale.x(scale.t1), y: 0 },
            ]),
            durSec: opts.sweepDurSec,
          }),
      ),
    )
  }

  return galleryDoc(
    w,
    h,
    {
      title: `Timeline — ${compiled.show.meta.title}`,
      desc: 'Seven-lane show timeline: music marks plus per-cue lead-in and body windows.',
    },
    children,
  )
}
