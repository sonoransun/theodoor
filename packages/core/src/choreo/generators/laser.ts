/**
 * Laser cue-spec generators — pure factories emitting Cue[] whose params
 * carry the pattern spec (periodBeats, spreadDeg, rgb, headId, …). Frame
 * SAMPLING lives in sim; nothing here produces LaserPoint frames.
 */

import type { Beats, Cue, CueParams, MusicAnchor } from '../../contracts.js'
import { offsetAnchor } from './pyro.js'

const pad3 = (k: number): string => String(k).padStart(3, '0')

export interface LaserCueSpec {
  /** Catalog id of a laser primitive. */
  effectId: string
  /** SitePlan laser-tower asset the cue plays on. */
  positionId: string
  anchor: MusicAnchor
  /** Pattern cycle length, beats (tempo-robust parameterization). */
  periodBeats: Beats
  /** Beam color 0..1 [r, g, b]. */
  rgb?: readonly number[]
  /** Head selector when the tower carries several. */
  headId?: string
  priority?: number
  idPrefix?: string
  /** Emit `count` copies stepped by stepBeats (default one cue). */
  repeat?: { count: number; stepBeats: Beats }
}

function series(spec: LaserCueSpec, defaultPrefix: string, extra: CueParams): Cue[] {
  const count = Math.max(1, spec.repeat?.count ?? 1)
  const step = spec.repeat?.stepBeats ?? 0
  const prefix = spec.idPrefix ?? defaultPrefix
  const cues: Cue[] = []
  for (let i = 0; i < count; i++) {
    const params: CueParams = { periodBeats: spec.periodBeats, ...extra }
    if (spec.rgb !== undefined) params.rgb = spec.rgb
    if (spec.headId !== undefined) params.headId = spec.headId
    const cue: Cue = {
      id: `${prefix}-${pad3(i)}`,
      effectId: spec.effectId,
      anchor: offsetAnchor(spec.anchor, i * step),
      positionId: spec.positionId,
      params,
    }
    if (spec.priority !== undefined) cue.priority = spec.priority
    cues.push(cue)
  }
  return cues
}

export interface LaserFanSpec extends LaserCueSpec {
  /** Total angular spread of the fan, degrees. */
  spreadDeg: number
  /** Number of beams (sim default applies when omitted). */
  beamCount?: number
}

/** Beam fan opening/closing over periodBeats across spreadDeg. */
export function laserFan(spec: LaserFanSpec): Cue[] {
  const extra: CueParams = { spreadDeg: spec.spreadDeg }
  if (spec.beamCount !== undefined) extra.beamCount = spec.beamCount
  return series(spec, 'lfan', extra)
}

export interface LaserLissajousSpec extends LaserCueSpec {
  /** Horizontal frequency ratio (default 3). */
  ratioA?: number
  /** Vertical frequency ratio (default 2). */
  ratioB?: number
  /** Phase offset δ, degrees (default 90). */
  phaseDeg?: number
}

/** Lissajous figure (sin(a·θ+δ), sin(b·θ)) breathing on the beat grid. */
export function laserLissajous(spec: LaserLissajousSpec): Cue[] {
  return series(spec, 'liss', {
    ratioA: spec.ratioA ?? 3,
    ratioB: spec.ratioB ?? 2,
    phaseDeg: spec.phaseDeg ?? 90,
  })
}

export interface LaserSweepSpec extends LaserCueSpec {
  /** Total sweep arc, degrees. */
  spreadDeg: number
}

/** Beat-locked triangle-wave sweep across spreadDeg every periodBeats. */
export function laserSweep(spec: LaserSweepSpec): Cue[] {
  return series(spec, 'lsweep', { spreadDeg: spec.spreadDeg })
}
