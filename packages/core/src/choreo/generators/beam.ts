/**
 * Beam cue generators — pure factories emitting Cue[] for the steerable
 * directional-audio arrays. Params carry targeting/timing metadata only
 * (crowd-grid cell ids, pairId/role, gainDb); aim geometry is owned by
 * acoustics/beams.ts and audible rendering by sim.
 */

import type { Beats, Cue, CueParams, MusicAnchor } from '../../contracts.js'

const pad3 = (k: number): string => String(k).padStart(3, '0')

/** Fields shared by every beam cue spec. */
export interface BeamCueBase {
  /** Catalog id of a beam program. */
  effect: string
  /** SitePlan beam-array asset that steers the cue. */
  arrayId: string
  /** Landing anchor — when the audio ARRIVES at the listener. */
  land: MusicAnchor
  /** Level trim on the effect's in-beam reference, dB. */
  gainDb?: number
  idPrefix?: string
  priority?: number
}

function mkBeamCue(
  spec: Pick<BeamCueBase, 'effect' | 'gainDb' | 'idPrefix' | 'priority'>,
  defaultPrefix: string,
  anchor: MusicAnchor,
  positionId: string,
  extra: CueParams,
  seq = 0,
): Cue {
  const params: CueParams = { ...extra }
  if (spec.gainDb !== undefined) params.gainDb = spec.gainDb
  const cue: Cue = {
    id: `${spec.idPrefix ?? defaultPrefix}-${pad3(seq)}`,
    effectId: spec.effect,
    anchor,
    positionId,
    params,
  }
  if (spec.priority !== undefined) cue.priority = spec.priority
  return cue
}

// ---------------------------------------------------------------------------
// beamWhisper
// ---------------------------------------------------------------------------

export interface BeamWhisperSpec extends BeamCueBase {
  /** Crowd-grid cell the whisper zone sits on. */
  targetCellId: number
}

/** Hold a narrow audible zone on one cell. */
export function beamWhisper(spec: BeamWhisperSpec): Cue[] {
  return [mkBeamCue(spec, 'whisper', spec.land, spec.arrayId, { targetCellId: spec.targetCellId })]
}

// ---------------------------------------------------------------------------
// beamFlyover
// ---------------------------------------------------------------------------

export interface BeamFlyoverSpec extends BeamCueBase {
  /** Cell centroids swept in order over the cue's active window. */
  pathCellIds: readonly number[]
}

/** Sweep the footprint along a cell path — sound "flies over" the lawn. */
export function beamFlyover(spec: BeamFlyoverSpec): Cue[] {
  if (spec.pathCellIds.length === 0) throw new Error('beamFlyover: pathCellIds must be non-empty')
  return [mkBeamCue(spec, 'flyover', spec.land, spec.arrayId, { pathCellIds: spec.pathCellIds })]
}

// ---------------------------------------------------------------------------
// beamStereoPair
// ---------------------------------------------------------------------------

export interface BeamStereoPairSpec extends Omit<BeamCueBase, 'arrayId'> {
  /** [left, right] beam-array asset ids. */
  arrayIds: readonly [string, string]
  /** Crowd-grid cell both footprints converge on. */
  targetCellId: number
  /** Correlates the two cues into one stereo image for the sim. */
  pairId: string
  /** Extra arrival delay applied to the R channel, milliseconds. */
  extraDelayMs?: number
}

/**
 * Exactly two cues (roles 'L' and 'R', one per array) crossed on one cell,
 * sharing pairId and the same landing anchor. extraDelayMs, when given, rides
 * the R cue: the sim offsets that channel to steer the phantom image.
 */
export function beamStereoPair(spec: BeamStereoPairSpec): Cue[] {
  return (['L', 'R'] as const).map((role, i) => {
    const extra: CueParams = { targetCellId: spec.targetCellId, pairId: spec.pairId, role }
    if (role === 'R' && spec.extraDelayMs !== undefined) extra.extraDelayMs = spec.extraDelayMs
    return mkBeamCue(spec, 'stereo', spec.land, spec.arrayIds[i]!, extra, i)
  })
}

// ---------------------------------------------------------------------------
// beamPingPong
// ---------------------------------------------------------------------------

export interface BeamPingPongSpec extends BeamCueBase {
  /** Cells bounced between (first ↔ last of the path). */
  cellIds: readonly number[]
  /** Beats per bounce. */
  periodBeats: Beats
}

/** Bounce the footprint between the path's end cells every periodBeats. */
export function beamPingPong(spec: BeamPingPongSpec): Cue[] {
  if (spec.cellIds.length === 0) throw new Error('beamPingPong: cellIds must be non-empty')
  return [
    mkBeamCue(spec, 'pingpong', spec.land, spec.arrayId, {
      pathCellIds: spec.cellIds,
      periodBeats: spec.periodBeats,
    }),
  ]
}

// ---------------------------------------------------------------------------
// beamTag
// ---------------------------------------------------------------------------

export interface BeamTagSpec extends BeamCueBase {
  /** Cue whose ground position this beam narrates/tags. */
  sourceCueId: string
  /** Fallback cell when the source cue has no ground position. */
  targetCellId?: number
}

/** Point the audible tag at another cue's ground position. */
export function beamTag(spec: BeamTagSpec): Cue[] {
  const extra: CueParams = { sourceCueId: spec.sourceCueId }
  if (spec.targetCellId !== undefined) extra.targetCellId = spec.targetCellId
  return [mkBeamCue(spec, 'btag', spec.land, spec.arrayId, extra)]
}

// ---------------------------------------------------------------------------
// beamToll
// ---------------------------------------------------------------------------

export type BeamTollSpec = BeamCueBase

/** The everywhere-at-once bell: params.cells = 'all' (whole audience zone). */
export function beamToll(spec: BeamTollSpec): Cue[] {
  return [mkBeamCue(spec, 'toll', spec.land, spec.arrayId, { cells: 'all' })]
}
