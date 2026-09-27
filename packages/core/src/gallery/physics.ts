/**
 * gallery/physics.ts — explainer diagrams for the two newest anticipations,
 * computed from the SAME single-owner helpers the solver and the sim use:
 *
 * - fountainRiseSvg: the water column's height against show time — the valve
 *   opens at fireSec, first water appears after the bank's valve latency, the
 *   column rises on the ballistic parabola h = v₀τ − gτ²/2 and CRESTS exactly
 *   on the beat (sim/fountains jetHeightAt); the anticipation bracket shows
 *   the two terms (latency + sqrt(2h/g)).
 * - searchlightSlewSvg: a head's tilt against show time — parked straight up,
 *   it departs at fireSec, slews at the bank's rate (with the same margin the
 *   chain uses) and ARRIVES on its opening aim on the beat; a second figure
 *   later shows the slew starting from the previous aim, not from park.
 *
 * All colors come from GALLERY_THEME (never currentColor: GitHub renders repo
 * SVGs inside <img>, where currentColor resolves to black).
 */

import type { FountainBankSpec, FountainEffect, SearchlightBankSpec } from '../contracts.js'
import { GRAVITY_MPS2 } from '../contracts.js'
import { fountainRiseSec } from '../catalog/catalog.js'
import { el, fmtMm } from '../fab/svg.js'
import { LIGHT_SLEW_MARGIN } from '../sim/lights.js'
import { jetHeightAt } from '../sim/fountains.js'
import { galleryDoc, label } from './scene.js'
import { GALLERY_THEME } from './theme.js'

const TITLE_H = 30
const PAD_L = 58
const PAD_R = 24
const PAD_B = 34

function axis(x0: number, y0: number, x1: number, y1: number): string {
  return el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: GALLERY_THEME.inkDim, 'stroke-width': 1 })
}

function polyline(points: readonly { x: number; y: number }[], attrs: Record<string, string | number>): string {
  return el('polyline', {
    points: points.map((p) => `${fmtMm(p.x)},${fmtMm(p.y)}`).join(' '),
    fill: 'none',
    ...attrs,
  })
}

export interface FountainRiseOpts {
  /** Document width, px (default 880). */
  widthPx?: number
  /** Crest height charted, meters (default the effect's heightM). */
  crestM?: number
  title?: string
}

/**
 * Column height vs show time for one fountain cue landing at t = 0 (the beat).
 * The chart spans from the valve opening to the column falling dry.
 */
export function fountainRiseSvg(
  effect: FountainEffect,
  spec: FountainBankSpec,
  opts: FountainRiseOpts = {},
): string {
  const t = GALLERY_THEME
  const w = opts.widthPx ?? 880
  const h = 300
  const crest = opts.crestM ?? effect.heightM
  const rise = fountainRiseSec(crest)
  const latency = spec.valveLatencySec
  const anticipation = latency + rise
  const fireSec = -anticipation
  const endSec = effect.durationSec
  const t0 = fireSec - 1.4
  const t1 = endSec + 0.4

  const plotL = PAD_L
  const plotR = w - PAD_R
  const plotT = TITLE_H + 14
  const plotB = h - PAD_B
  const x = (sec: number): number => plotL + ((sec - t0) / (t1 - t0)) * (plotR - plotL)
  const y = (m: number): number => plotB - (m / (crest * 1.15)) * (plotB - plotT)

  // Sample the SAME closed form the sim evaluates (crestSec = 0, endSec = duration).
  const pts: { x: number; y: number }[] = []
  const N = 240
  for (let i = 0; i <= N; i++) {
    const sec = fireSec + latency + ((endSec - (fireSec + latency)) * i) / N
    const hM = jetHeightAt(sec, crest, rise, 0, endSec).heightM
    pts.push({ x: x(sec), y: y(hM) })
  }

  const children: string[] = []
  children.push(label(12, 19, opts.title ?? `${effect.name} — the column crests on the beat`, { 'font-size': 13 }))
  // Axes + gridlines
  children.push(axis(plotL, plotB, plotR, plotB), axis(plotL, plotT, plotL, plotB))
  for (const m of [crest / 2, crest]) {
    children.push(
      el('line', { x1: plotL, y1: y(m), x2: plotR, y2: y(m), stroke: t.grid, 'stroke-width': 1 }),
      label(plotL - 6, y(m) + 4, `${fmtMm(m)} m`, { 'font-size': 10, 'text-anchor': 'end' }),
    )
  }
  for (let sec = Math.ceil(t0); sec <= t1; sec += 1) {
    children.push(
      el('line', { x1: x(sec), y1: plotB, x2: x(sec), y2: plotB + 4, stroke: t.inkDim, 'stroke-width': 1 }),
      label(x(sec), plotB + 15, `${sec > 0 ? '+' : ''}${sec}s`, { 'font-size': 9, 'text-anchor': 'middle', fill: t.inkDim }),
    )
  }
  // The beat: a climax-color rule at t = 0.
  children.push(
    el('line', { x1: x(0), y1: plotT, x2: x(0), y2: plotB, stroke: t.climax, 'stroke-width': 1.2, 'stroke-opacity': '0.9' }),
    label(x(0) + 5, plotT + 10, 'the beat (targetSec)', { 'font-size': 10, fill: t.climax }),
  )
  // Water filled under the curve + the curve itself.
  children.push(
    el('polygon', {
      points: [`${fmtMm(x(fireSec + latency))},${fmtMm(plotB)}`, ...pts.map((p) => `${fmtMm(p.x)},${fmtMm(p.y)}`), `${fmtMm(x(endSec))},${fmtMm(plotB)}`].join(' '),
      fill: t.lanes.fountains,
      'fill-opacity': '0.18',
    }),
    polyline(pts, { stroke: t.lanes.fountains, 'stroke-width': 2 }),
  )
  // Fire marker + anticipation bracket split into latency and rise.
  const by = plotB - 14
  children.push(
    el('circle', { cx: x(fireSec), cy: plotB, r: 4, fill: 'none', stroke: t.lanes.fountains, 'stroke-width': 1.5 }),
    label(x(fireSec), plotB - 22, 'valve opens (fireSec)', { 'font-size': 10, 'text-anchor': 'middle' }),
    el('rect', { x: x(fireSec), y: by - 3, width: x(fireSec + latency) - x(fireSec), height: 6, fill: t.inkDim }),
    el('rect', { x: x(fireSec + latency), y: by - 3, width: x(0) - x(fireSec + latency), height: 6, fill: t.lanes.fountains, 'fill-opacity': '0.8' }),
    label((x(fireSec + latency) + x(0)) / 2, by - 8, `rise √(2h/g) = ${rise.toFixed(2)} s`, { 'font-size': 10, 'text-anchor': 'middle' }),
    label(x(fireSec) - 8, by + 3, `latency ${latency.toFixed(2)} s →`, { 'font-size': 9, 'text-anchor': 'end', fill: t.inkDim }),
    label(plotR, plotT + 10, `anticipation ${anticipation.toFixed(2)} s · g = ${GRAVITY_MPS2} m/s²`, { 'font-size': 10, 'text-anchor': 'end' }),
    label(x(endSec) - 4, y(0) - 16, 'dry', { 'font-size': 9, 'text-anchor': 'end', fill: t.inkDim }),
  )
  return galleryDoc(
    w,
    h,
    {
      title: opts.title ?? `${effect.name} — column rise`,
      desc: 'Water column height against show time from the fountain sim: valve latency, ballistic rise, crest on the beat, hold, and fall.',
    },
    children,
  )
}

export interface SearchlightSlewOpts {
  /** Document width, px (default 880). */
  widthPx?: number
  /** Opening tilt of the first figure from park, degrees (default 30). */
  firstTiltDeg?: number
  /** Opening tilt of a second figure, degrees (default −40, i.e. through vertical). */
  secondTiltDeg?: number
  /** Landing instant of the second figure, seconds after the first (default 6). */
  secondLandSec?: number
  /** Hold of the first figure, seconds (default 4). */
  firstHoldSec?: number
  title?: string
}

/**
 * Head tilt vs show time for two consecutive figures on one bank: the first
 * slews from park (0°) to firstTiltDeg, arriving on beat 1 at t = 0; the
 * second departs the first figure's aim (not park) and arrives on its own
 * beat. Slew durations use the bank's rate with the chain's margin.
 */
export function searchlightSlewSvg(spec: SearchlightBankSpec, opts: SearchlightSlewOpts = {}): string {
  const t = GALLERY_THEME
  const w = opts.widthPx ?? 880
  const h = 300
  const tilt1 = opts.firstTiltDeg ?? 30
  const tilt2 = opts.secondTiltDeg ?? -40
  const land2 = opts.secondLandSec ?? 6
  const hold1 = opts.firstHoldSec ?? 4
  const rate = spec.slewRateDegPerSec
  const slew1 = (Math.abs(tilt1 - 0) / rate) * LIGHT_SLEW_MARGIN
  const slew2 = (Math.abs(tilt2 - tilt1) / rate) * LIGHT_SLEW_MARGIN
  const fire1 = -slew1
  const fire2 = Math.max(hold1, land2 - slew2)
  const t0 = fire1 - 1.4
  const t1 = land2 + 2.5
  const tiltMax = Math.max(Math.abs(tilt1), Math.abs(tilt2), spec.maxTiltDeg) * 1.1

  const plotL = PAD_L
  const plotR = w - PAD_R
  const plotT = TITLE_H + 14
  const plotB = h - PAD_B
  const midY = (plotT + plotB) / 2
  const x = (sec: number): number => plotL + ((sec - t0) / (t1 - t0)) * (plotR - plotL)
  const y = (deg: number): number => midY - (deg / tiltMax) * ((plotB - plotT) / 2)

  const path: { x: number; y: number }[] = [
    { x: x(t0), y: y(0) },
    { x: x(fire1), y: y(0) },
    { x: x(0), y: y(tilt1) },
    { x: x(fire2), y: y(tilt1) },
    { x: x(land2), y: y(tilt2) },
    { x: x(t1), y: y(tilt2) },
  ]

  const children: string[] = []
  children.push(label(12, 19, opts.title ?? 'Searchlight slew — the light arrives on the beat', { 'font-size': 13 }))
  children.push(axis(plotL, midY, plotR, midY), axis(plotL, plotT, plotL, plotB))
  for (const deg of [-spec.maxTiltDeg, -45, 0, 45, spec.maxTiltDeg]) {
    if (Math.abs(deg) > tiltMax) continue
    children.push(
      el('line', { x1: plotL, y1: y(deg), x2: plotR, y2: y(deg), stroke: t.grid, 'stroke-width': 1 }),
      label(plotL - 6, y(deg) + 4, `${deg}°`, { 'font-size': 10, 'text-anchor': 'end' }),
    )
  }
  children.push(
    el('line', { x1: plotL, y1: y(spec.maxTiltDeg), x2: plotR, y2: y(spec.maxTiltDeg), stroke: t.climax, 'stroke-width': 1, 'stroke-dasharray': '4 4', 'stroke-opacity': '0.7' }),
    el('line', { x1: plotL, y1: y(-spec.maxTiltDeg), x2: plotR, y2: y(-spec.maxTiltDeg), stroke: t.climax, 'stroke-width': 1, 'stroke-dasharray': '4 4', 'stroke-opacity': '0.7' }),
    label(plotR, y(spec.maxTiltDeg) - 4, `max tilt ${spec.maxTiltDeg}°`, { 'font-size': 9, 'text-anchor': 'end', fill: t.climax }),
  )
  for (let sec = Math.ceil(t0); sec <= t1; sec += 1) {
    children.push(
      el('line', { x1: x(sec), y1: plotB, x2: x(sec), y2: plotB + 4, stroke: t.inkDim, 'stroke-width': 1 }),
      label(x(sec), plotB + 15, `${sec > 0 ? '+' : ''}${sec}s`, { 'font-size': 9, 'text-anchor': 'middle', fill: t.inkDim }),
    )
  }
  // Beats.
  for (const [sec, name] of [[0, 'beat 1'], [land2, 'beat 2']] as const) {
    children.push(
      el('line', { x1: x(sec), y1: plotT, x2: x(sec), y2: plotB, stroke: t.climax, 'stroke-width': 1.2, 'stroke-opacity': '0.9' }),
      label(x(sec) + 5, plotT + 10, name, { 'font-size': 10, fill: t.climax }),
    )
  }
  // The tilt trace.
  children.push(polyline(path, { stroke: t.lanes.lights, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }))
  // Fire markers + slew brackets.
  for (const [fire, land, slew, from, to] of [
    [fire1, 0, slew1, 0, tilt1],
    [fire2, land2, slew2, tilt1, tilt2],
  ] as const) {
    const by = Math.min(y(from), y(to)) - 12
    children.push(
      el('circle', { cx: x(fire), cy: y(from), r: 4, fill: 'none', stroke: t.lanes.lights, 'stroke-width': 1.5 }),
      el('rect', { x: x(fire), y: by - 3, width: Math.max(1, x(land) - x(fire)), height: 6, rx: 2, fill: t.lanes.lights, 'fill-opacity': '0.8' }),
      label((x(fire) + x(land)) / 2, by - 8, `slew ${Math.abs(to - from)}° / ${rate}°·s⁻¹ × ${LIGHT_SLEW_MARGIN} = ${slew.toFixed(2)} s`, {
        'font-size': 10,
        'text-anchor': 'middle',
      }),
    )
  }
  children.push(
    label(x(t0) + 6, y(0) + 14, 'parked (straight up)', { 'font-size': 9, fill: t.inkDim }),
    label(x(fire2) - 8, y(tilt1) + 14, 'departs the previous aim, not park', { 'font-size': 9, 'text-anchor': 'end', fill: t.inkDim }),
  )
  return galleryDoc(
    w,
    h,
    {
      title: opts.title ?? 'Searchlight slew',
      desc: 'Head tilt against show time for two consecutive figures: slew from park, arrival on the beat, then a second slew from the previous aim.',
    },
    children,
  )
}
