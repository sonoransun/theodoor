/**
 * show/builderLights.ts — the `b.lights` facade: sky-beam figures on the
 * searchlight banks. Every spec names the anchor the heads ARRIVE on their
 * opening aims; the solver commands the slew early (sim/lights), so the
 * light lands on the beat like everything else in Theodoor.
 *
 *   b.lights.figure({ effect: 'light-fan-gold', position: 'lights-west', land: m.downbeat(4) })
 *   b.lights.sweep({ effect: 'light-sweep-slow', position: 'lights-east', land: …, sweepDeg: 30, periodBeats: 8 })
 *   b.lights.chase({ effect: 'light-chase-beat', position: 'lights-west', land: …, periodBeats: 4 })
 *   b.lights.mirror({ effect: 'light-cross-violet', positions: ['lights-west', 'lights-east'], land: … })
 *   b.lights.converge({ effect: 'light-converge-spire', positions: [W, E], at: { x: 0, z: 160 }, land: m.climax() })
 *
 * Params carried (see contracts CueParams): tiltDeg (lean toward the bank
 * heading), spreadDeg (fan spread / cross lean; negative mirrors), sweepDeg
 * (negative mirrors), periodBeats, rgb, aimX/aimY/aimZ (converge).
 */

import type { Beats, CueParams, MusicAnchor } from '../contracts.js'
import { TrackBuilder, type RawCue } from './trackBuilder.js'

const pad3 = (k: number): string => String(k).padStart(3, '0')

export interface LightFigureSpec {
  id?: string
  /** Catalog id of a searchlight figure. */
  effect: string
  /** Searchlight-bank asset id. */
  position: string
  /** Anchor the heads reach the figure's opening aims on. */
  land: MusicAnchor
  /** Head lean from vertical toward the bank heading, degrees (params.tiltDeg). */
  tiltDeg?: number
  /** Fan spread / cross lean, degrees (params.spreadDeg; negative mirrors). */
  spreadDeg?: number
  /** Sweep amplitude, degrees (params.sweepDeg; negative mirrors). */
  sweepDeg?: number
  /** Sweep / chase period, beats (params.periodBeats). */
  periodBeats?: Beats
  /** Lamp color override 0..1 [r, g, b] (params.rgb). */
  rgb?: readonly number[]
  params?: CueParams
  priority?: number
}

export interface LightSweepSpec {
  id?: string
  /** Catalog id of a 'sweep' figure. */
  effect: string
  position: string
  land: MusicAnchor
  /** Sweep amplitude along the row, degrees (params.sweepDeg). */
  sweepDeg?: number
  /** Beats per full back-and-forth (params.periodBeats). */
  periodBeats?: Beats
  tiltDeg?: number
  rgb?: readonly number[]
  priority?: number
}

export interface LightChaseSpec {
  id?: string
  /** Catalog id of a 'chase' figure. */
  effect: string
  position: string
  land: MusicAnchor
  /** Beats for the lit head to run the whole row once (params.periodBeats). */
  periodBeats?: Beats
  tiltDeg?: number
  rgb?: readonly number[]
  priority?: number
}

export interface LightMirrorSpec {
  /** Catalog id of any figure; row figures (fan, cross, sweep) mirror. */
  effect: string
  /** [first, mirrored] bank ids; the second bank's spreadDeg and sweepDeg are negated. */
  positions: readonly [string, string]
  land: MusicAnchor
  tiltDeg?: number
  spreadDeg?: number
  sweepDeg?: number
  periodBeats?: Beats
  rgb?: readonly number[]
  idPrefix?: string
  priority?: number
}

export interface LightConvergeSpec {
  /** Catalog id of a 'converge' figure. */
  effect: string
  /** Every bank aims at the same point — one cue per bank. */
  positions: readonly string[]
  /** World point the beams meet at (y defaults to each bank's own y). */
  at: { x: number; y?: number; z: number }
  land: MusicAnchor
  rgb?: readonly number[]
  idPrefix?: string
  priority?: number
}

/** Collect the optional figure params shared by every spec here. */
function figureParams(spec: {
  tiltDeg?: number
  spreadDeg?: number
  sweepDeg?: number
  periodBeats?: Beats
  rgb?: readonly number[]
  params?: CueParams
}): CueParams {
  const params: CueParams = { ...(spec.params ?? {}) }
  if (spec.tiltDeg !== undefined) params['tiltDeg'] = spec.tiltDeg
  if (spec.spreadDeg !== undefined) params['spreadDeg'] = spec.spreadDeg
  if (spec.sweepDeg !== undefined) params['sweepDeg'] = spec.sweepDeg
  if (spec.periodBeats !== undefined) params['periodBeats'] = spec.periodBeats
  if (spec.rgb !== undefined) params['rgb'] = spec.rgb
  return params
}

export class LightsTrackBuilder extends TrackBuilder {
  /** One figure on one bank, heads arriving on `land`. */
  figure(spec: LightFigureSpec): this {
    const params = figureParams(spec)
    const raw: RawCue = { effectId: spec.effect, anchor: spec.land, positionId: spec.position }
    if (Object.keys(params).length > 0) raw.params = params
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }

  /** A beat-locked sweep along the row (sugar over figure() for 'sweep' effects). */
  sweep(spec: LightSweepSpec): this {
    const s: LightFigureSpec = { effect: spec.effect, position: spec.position, land: spec.land }
    if (spec.id !== undefined) s.id = spec.id
    if (spec.sweepDeg !== undefined) s.sweepDeg = spec.sweepDeg
    if (spec.periodBeats !== undefined) s.periodBeats = spec.periodBeats
    if (spec.tiltDeg !== undefined) s.tiltDeg = spec.tiltDeg
    if (spec.rgb !== undefined) s.rgb = spec.rgb
    if (spec.priority !== undefined) s.priority = spec.priority
    return this.figure(s)
  }

  /** The lit head running the row once per period (sugar over figure() for 'chase' effects). */
  chase(spec: LightChaseSpec): this {
    const s: LightFigureSpec = { effect: spec.effect, position: spec.position, land: spec.land }
    if (spec.id !== undefined) s.id = spec.id
    if (spec.periodBeats !== undefined) s.periodBeats = spec.periodBeats
    if (spec.tiltDeg !== undefined) s.tiltDeg = spec.tiltDeg
    if (spec.rgb !== undefined) s.rgb = spec.rgb
    if (spec.priority !== undefined) s.priority = spec.priority
    return this.figure(s)
  }

  /**
   * The same figure on two banks, the second one mirrored: its spreadDeg and
   * sweepDeg are negated, so a fan or cross reflects about the venue center
   * and two sweeps swing toward and away from each other in step. Ids are
   * '<prefix>-000' / '<prefix>-001'. (Banks with an odd head count keep
   * their center head unmirrored — it has no partner.)
   */
  mirror(spec: LightMirrorSpec): this {
    const prefix = spec.idPrefix ?? this.nextId()
    spec.positions.forEach((position, i) => {
      const sign = i === 0 ? 1 : -1
      const s: LightFigureSpec = {
        id: `${prefix}-${pad3(i)}`,
        effect: spec.effect,
        position,
        land: spec.land,
      }
      if (spec.tiltDeg !== undefined) s.tiltDeg = spec.tiltDeg
      if (spec.spreadDeg !== undefined) s.spreadDeg = sign * spec.spreadDeg
      if (spec.sweepDeg !== undefined) s.sweepDeg = sign * spec.sweepDeg
      if (spec.periodBeats !== undefined) s.periodBeats = spec.periodBeats
      if (spec.rgb !== undefined) s.rgb = spec.rgb
      if (spec.priority !== undefined) s.priority = spec.priority
      this.figure(s)
    })
    return this
  }

  /**
   * Converging spire: one cue per bank, every head aiming at `at`, all
   * landing together. Ids are '<prefix>-NNN' in bank order.
   */
  converge(spec: LightConvergeSpec): this {
    const prefix = spec.idPrefix ?? this.nextId()
    spec.positions.forEach((position, i) => {
      const params: CueParams = { aimX: spec.at.x, aimZ: spec.at.z }
      if (spec.at.y !== undefined) params['aimY'] = spec.at.y
      if (spec.rgb !== undefined) params['rgb'] = spec.rgb
      const raw: RawCue = {
        id: `${prefix}-${pad3(i)}`,
        effectId: spec.effect,
        anchor: spec.land,
        positionId: position,
        params,
      }
      if (spec.priority !== undefined) raw.priority = spec.priority
      this.pushRaw(raw)
    })
    return this
  }
}
