/**
 * gallery/anim.ts — deterministic SMIL emitters for animated gallery SVGs.
 *
 * GitHub renders repo SVGs inside <img>, where SMIL animates but scripts,
 * CSS imports, and external references do not — so every gallery animation
 * is plain <animate>/<animateTransform> markup built through the same
 * escaped/rounded `el()` path the fab drawings use.
 *
 * House conventions (builders follow these; tests pin them):
 * - Sample point-cloud positions at 4–8 fps with calcMode "linear" (SMIL
 *   interpolates between samples); colors and crowd cells at 2–4 fps with
 *   calcMode "discrete". Always sample on the 120 Hz sim step grid (120 is
 *   divisible by 2/4/8), so chunked advances are step-identical.
 * - Loops are repeatCount="indefinite". A non-looping excerpt uses the
 *   hold-and-restart convention: duplicate the final value and pin its
 *   keyTime to 1 via holdLoopKeyTimes(), so the last frame holds briefly
 *   before the loop snaps back to frame 0.
 * - Numbers: attribute values round through fmtMm (0.1); durations/begins
 *   through fmtSmilSec (0.01 s); keyTimes through fmtKeyTime (4 dp with
 *   exact '0'/'1' endpoints). Fixed precision keeps goldens byte-stable.
 */

import { el, fmtMm } from '../fab/svg.js'

/** Seconds → SMIL clock value without unit ('12.5', never '-0'); ≤ 2 dp. */
export function fmtSmilSec(s: number): string {
  const r = Math.round(s * 100) / 100
  return (r === 0 ? 0 : r).toString()
}

/** keyTimes entry → ≤ 4 dp, trimmed, with exact '0'/'1' for the endpoints. */
export function fmtKeyTime(t: number): string {
  if (t <= 0) return '0'
  if (t >= 1) return '1'
  const r = Math.round(t * 10000) / 10000
  return r.toString()
}

export interface AnimOpts {
  /** One pre-formatted entry per keyframe (joined with ';'). */
  values: readonly string[]
  durSec: number
  /** 0..1 per value; omit for SMIL's default even spacing. */
  keyTimes?: readonly number[]
  /** Default 'linear'. */
  calcMode?: 'linear' | 'discrete'
  /** Default 0. */
  beginSec?: number
  /** Default 'indefinite'. */
  repeat?: number | 'indefinite'
  fill?: 'freeze'
}

function animAttrs(o: AnimOpts): Record<string, string | undefined> {
  if (o.values.length === 0) throw new Error('gallery anim: values must be non-empty')
  if (o.keyTimes !== undefined) {
    if (o.keyTimes.length !== o.values.length) {
      throw new Error(
        `gallery anim: keyTimes length ${o.keyTimes.length} != values length ${o.values.length}`,
      )
    }
    for (let i = 1; i < o.keyTimes.length; i++) {
      if (!(o.keyTimes[i]! >= o.keyTimes[i - 1]!)) {
        throw new Error('gallery anim: keyTimes must be non-decreasing')
      }
    }
    if (o.keyTimes[0]! !== 0 || o.keyTimes[o.keyTimes.length - 1]! !== 1) {
      throw new Error('gallery anim: keyTimes must start at 0 and end at 1')
    }
  }
  return {
    values: o.values.join(';'),
    keyTimes: o.keyTimes?.map(fmtKeyTime).join(';'),
    calcMode: o.calcMode,
    dur: `${fmtSmilSec(o.durSec)}s`,
    begin: o.beginSec !== undefined && o.beginSec !== 0 ? `${fmtSmilSec(o.beginSec)}s` : undefined,
    repeatCount: String(o.repeat ?? 'indefinite'),
    fill: o.fill,
  }
}

/** <animate attributeName="…" values="…;…" dur="…s" repeatCount="…"/> */
export function animate(attributeName: string, o: AnimOpts): string {
  return el('animate', { attributeName, ...animAttrs(o) })
}

/** <animateTransform attributeName="transform" type="…" …/> */
export function animateTransform(
  type: 'translate' | 'scale' | 'rotate',
  o: AnimOpts,
): string {
  return el('animateTransform', { attributeName: 'transform', type, ...animAttrs(o) })
}

/** Frame positions → per-keyframe 'x y' entries (0.1 rounding via fmtMm). */
export function translateValues(pts: readonly { x: number; y: number }[]): string[] {
  return pts.map((p) => `${fmtMm(p.x)} ${fmtMm(p.y)}`)
}

/**
 * keyTimes for an n-VALUE hold-and-restart loop, where the caller has already
 * duplicated the final frame as the nth value: entries 0..n−2 spread evenly
 * over [0, 1 − holdFrac], the duplicate pinned to 1 — the last frame holds
 * for holdFrac of the loop, then the repeat snaps back to frame 0.
 */
export function holdLoopKeyTimes(n: number, holdFrac: number): number[] {
  if (n < 2) throw new Error('gallery anim: hold loop needs at least 2 values')
  if (!(holdFrac > 0 && holdFrac < 1)) throw new Error('gallery anim: holdFrac must be in (0, 1)')
  const times: number[] = []
  const span = 1 - holdFrac
  for (let i = 0; i < n - 1; i++) times.push((i / (n - 2 || 1)) * span)
  times.push(1)
  return times
}
