/**
 * Panel cue-spec generators — pure factories emitting Cue[] whose params
 * carry the pattern spec (text, speedPxPerBeat, rgb, rgb2, periodBeats).
 * Frame SAMPLING lives in sim; nothing here rasterizes pixels.
 */

import type { Beats, Cue, CueParams, MusicAnchor } from '../../contracts.js'
import { offsetAnchor } from './pyro.js'

const pad3 = (k: number): string => String(k).padStart(3, '0')

export interface PanelCueSpec {
  /** Catalog id of a panel pattern. */
  effectId: string
  /** SitePlan panel asset the cue plays on. */
  positionId: string
  anchor: MusicAnchor
  /** Primary color 0..1 [r, g, b]. */
  rgb?: readonly number[]
  priority?: number
  idPrefix?: string
  /** Emit `count` copies stepped by stepBeats (default one cue). */
  repeat?: { count: number; stepBeats: Beats }
}

function series(spec: PanelCueSpec, defaultPrefix: string, extra: CueParams): Cue[] {
  const count = Math.max(1, spec.repeat?.count ?? 1)
  const step = spec.repeat?.stepBeats ?? 0
  const prefix = spec.idPrefix ?? defaultPrefix
  const cues: Cue[] = []
  for (let i = 0; i < count; i++) {
    const params: CueParams = { ...extra }
    if (spec.rgb !== undefined) params.rgb = spec.rgb
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

export interface PanelWashSpec extends PanelCueSpec {
  /** Secondary color for two-tone washes. */
  rgb2?: readonly number[]
  /** Wash cycle length, beats (sim default applies when omitted). */
  periodBeats?: Beats
}

/** Full-panel color wash (optionally two-tone, cycling on the beat grid). */
export function panelWash(spec: PanelWashSpec): Cue[] {
  const extra: CueParams = {}
  if (spec.rgb2 !== undefined) extra.rgb2 = spec.rgb2
  if (spec.periodBeats !== undefined) extra.periodBeats = spec.periodBeats
  return series(spec, 'wash', extra)
}

export interface PanelChaseSpec extends PanelCueSpec {
  /** One full pulse traversal per periodBeats (pulse position = beat phase). */
  periodBeats: Beats
}

/** Beat-phase pulse chase across the panel. */
export function panelChase(spec: PanelChaseSpec): Cue[] {
  return series(spec, 'pchase', { periodBeats: spec.periodBeats })
}

export interface PanelTickerSpec extends PanelCueSpec {
  /** Message rendered with the shared 5×7 font (sim rasterizes). */
  text: string
  /** Scroll speed in pixels per beat (tempo-robust). */
  speedPxPerBeat: number
}

/** Scrolling text ticker. */
export function panelTicker(spec: PanelTickerSpec): Cue[] {
  return series(spec, 'ticker', { text: spec.text, speedPxPerBeat: spec.speedPxPerBeat })
}
