/**
 * Crowd cue generators — pure factories emitting Cue[] addressed to a crowd
 * mast (positionId) whose params carry the pattern spec over the audience
 * cell grid (periodBeats, originCell, sections, text, rgb, …). Mask
 * rendering lives in sim; nothing here derives or touches the grid itself.
 */

import type { Beats, Cue, CueParams, MusicAnchor } from '../../contracts.js'
import { offsetAnchor } from './pyro.js'

const pad3 = (k: number): string => String(k).padStart(3, '0')

/** Fields shared by every crowd cue spec. */
export interface CrowdCueBase {
  /** Catalog id of a crowd pattern. */
  effect: string
  /** SitePlan crowd-mast asset the broadcast rides. */
  mastId: string
  /** Device color 0..1 [r, g, b]. */
  rgb?: readonly number[]
  idPrefix?: string
  priority?: number
}

function mkCrowdCue(
  spec: CrowdCueBase,
  defaultPrefix: string,
  anchor: MusicAnchor,
  extra: CueParams,
  seq = 0,
): Cue {
  const params: CueParams = { ...extra }
  if (spec.rgb !== undefined) params.rgb = spec.rgb
  const cue: Cue = {
    id: `${spec.idPrefix ?? defaultPrefix}-${pad3(seq)}`,
    effectId: spec.effect,
    anchor,
    positionId: spec.mastId,
    params,
  }
  if (spec.priority !== undefined) cue.priority = spec.priority
  return cue
}

// ---------------------------------------------------------------------------
// crowdWave
// ---------------------------------------------------------------------------

export interface CrowdWaveSpec extends CrowdCueBase {
  /** Anchor the wavefront crosses the first cells on. */
  from: MusicAnchor
  /** Beats for one full traversal of the lawn. */
  periodBeats: Beats
  /** Travel azimuth, degrees clockwise from north (sim default when omitted). */
  dirDeg?: number
}

/** One traveling wavefront across the crowd canvas. */
export function crowdWave(spec: CrowdWaveSpec): Cue[] {
  const extra: CueParams = { periodBeats: spec.periodBeats }
  if (spec.dirDeg !== undefined) extra.dirDeg = spec.dirDeg
  return [mkCrowdCue(spec, 'cwave', spec.from, extra)]
}

// ---------------------------------------------------------------------------
// crowdRadial
// ---------------------------------------------------------------------------

export interface CrowdRadialSpec extends CrowdCueBase {
  land: MusicAnchor
  /** Crowd-grid cell index the pulse radiates from. */
  originCell: number
  /** Beats per pulse ring (sim default when omitted). */
  periodBeats?: Beats
}

/** Rings pulsing outward from originCell. */
export function crowdRadial(spec: CrowdRadialSpec): Cue[] {
  const extra: CueParams = { originCell: spec.originCell }
  if (spec.periodBeats !== undefined) extra.periodBeats = spec.periodBeats
  return [mkCrowdCue(spec, 'cradial', spec.land, extra)]
}

// ---------------------------------------------------------------------------
// crowdSectionChase
// ---------------------------------------------------------------------------

export interface CrowdSectionChaseSpec extends CrowdCueBase {
  /** Landing anchor of the first section. */
  startLand: MusicAnchor
  /** Beats between successive sections. */
  stepBeats: Beats
  /** Number of lawn sections chased across. */
  sections: number
}

/** One cue per section: section i lands at startLand + i·stepBeats. */
export function crowdSectionChase(spec: CrowdSectionChaseSpec): Cue[] {
  if (!Number.isInteger(spec.sections) || spec.sections < 1) {
    throw new Error('crowdSectionChase: sections must be a positive integer')
  }
  const cues: Cue[] = []
  for (let i = 0; i < spec.sections; i++) {
    cues.push(
      mkCrowdCue(
        spec,
        'cchase',
        offsetAnchor(spec.startLand, i * spec.stepBeats),
        { sections: spec.sections },
        i,
      ),
    )
  }
  return cues
}

// ---------------------------------------------------------------------------
// crowdText
// ---------------------------------------------------------------------------

export interface CrowdTextSpec extends CrowdCueBase {
  land: MusicAnchor
}

/** Marquee `text` rendered across the crowd canvas (params.text). */
export function crowdText(text: string, spec: CrowdTextSpec): Cue[] {
  return [mkCrowdCue(spec, 'ctext', spec.land, { text })]
}

// ---------------------------------------------------------------------------
// crowdHeartbeat
// ---------------------------------------------------------------------------

export interface CrowdHeartbeatSpec extends CrowdCueBase {
  land: MusicAnchor
  /** Cell the beat radiates from (zone center when omitted). */
  originCell?: number
}

/** Slow double-thump swell over the whole lawn. */
export function crowdHeartbeat(spec: CrowdHeartbeatSpec): Cue[] {
  const extra: CueParams = {}
  if (spec.originCell !== undefined) extra.originCell = spec.originCell
  return [mkCrowdCue(spec, 'cheart', spec.land, extra)]
}
