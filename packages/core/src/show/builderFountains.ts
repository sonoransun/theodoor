/**
 * show/builderFountains.ts — the `b.fountains` facade: illuminated water-jet
 * cues on the fountain banks. Every spec names the anchor the column CRESTS
 * on; the solver fires the valve early by the bank's latency plus the
 * ballistic rise (sim/fountains fountainAnticipationSec), so the water
 * arrives at its crest on the musical moment.
 *
 *   b.fountains.jet({ effect: 'fountain-plume-30m', position: 'fount-west', crest: m.downbeat(4) })
 *   b.fountains.cascade({ effect: 'fountain-cascade-25m', position: 'fount-east', crest: m.beat(8), stepBeats: 0.5 })
 *   b.fountains.wave({ effect: 'fountain-wave-15m', position: 'fount-west', crest: m.beat(16), periodBeats: 4 })
 *   b.fountains.mirror({ effect: 'fountain-cascade-25m', positions: ['fount-west', 'fount-east'], crest: m.climax() })
 *   b.fountains.mist({ position: 'fount-east', from: m.time(0) })
 *
 * Cue ids follow the house rule: '<trackId>-<n>' for singles, '<prefix>-NNN'
 * for generated pairs.
 */

import type { Beats, CueParams, MusicAnchor } from '../contracts.js'
import { TrackBuilder, type RawCue } from './trackBuilder.js'

const pad3 = (k: number): string => String(k).padStart(3, '0')

export interface FountainJetSpec {
  id?: string
  /** Catalog id of a fountain program. */
  effect: string
  /** Fountain-bank asset id. */
  position: string
  /** Anchor the column crests on. */
  crest: MusicAnchor
  /** Crest height override, meters (params.heightM; must not exceed the bank max). */
  heightM?: number
  /** Nozzles engaged, centered on the row (params.nozzles; 0 = whole row). */
  nozzles?: number
  /** Underwater lighting color 0..1 [r, g, b] (params.rgb) and a second color (rgb2). */
  rgb?: readonly number[]
  rgb2?: readonly number[]
  params?: CueParams
  priority?: number
}

export interface FountainCascadeSpec {
  id?: string
  effect: string
  position: string
  /** Anchor the FIRST column crests on; each next nozzle crests stepBeats later. */
  crest: MusicAnchor
  /** Beats between successive columns (params.stepBeats). */
  stepBeats?: Beats
  /** Run the row the other way (params.reverse). */
  reverse?: boolean
  heightM?: number
  rgb?: readonly number[]
  rgb2?: readonly number[]
  priority?: number
}

export interface FountainWaveSpec {
  id?: string
  effect: string
  position: string
  crest: MusicAnchor
  /** Beats per traveling-wave period (params.periodBeats). */
  periodBeats?: Beats
  /** Travel from the row's high-index end (params.reverse). */
  reverse?: boolean
  heightM?: number
  rgb?: readonly number[]
  rgb2?: readonly number[]
  priority?: number
}

export interface FountainMirrorSpec {
  /** Catalog id of any fountain program (jet, fan, cascade, wave, mist). */
  effect: string
  /**
   * Exactly two bank asset ids in ASCENDING row order (west then east for a
   * north-facing site). Both cues land on `crest`.
   */
  positions: readonly [string, string]
  crest: MusicAnchor
  /**
   * Cascades / waves run AWAY from the center of the display when true (the
   * default): the first bank plays reversed (from its high-index, inner end)
   * and the second forward. False runs both toward the center.
   */
  outward?: boolean
  heightM?: number
  nozzles?: number
  stepBeats?: Beats
  periodBeats?: Beats
  rgb?: readonly number[]
  rgb2?: readonly number[]
  idPrefix?: string
  priority?: number
}

export interface FountainMistSpec {
  id?: string
  /** Catalog id of a 'mist' program; default: the catalog's first mist jet. */
  effect?: string
  position: string
  /** Anchor the screen is fully up on. */
  from: MusicAnchor
  rgb?: readonly number[]
  rgb2?: readonly number[]
  priority?: number
}

/** Copy the optional color/height/nozzle fields shared by every spec into params. */
function commonParams(
  spec: {
    heightM?: number
    nozzles?: number
    rgb?: readonly number[]
    rgb2?: readonly number[]
  },
  into: CueParams,
): void {
  if (spec.heightM !== undefined) into['heightM'] = spec.heightM
  if (spec.nozzles !== undefined) into['nozzles'] = spec.nozzles
  if (spec.rgb !== undefined) into['rgb'] = spec.rgb
  if (spec.rgb2 !== undefined) into['rgb2'] = spec.rgb2
}

export class FountainTrackBuilder extends TrackBuilder {
  /** One lit column (or centered subset of the row) cresting on `crest`. */
  jet(spec: FountainJetSpec): this {
    const params: CueParams = { ...(spec.params ?? {}) }
    commonParams(spec, params)
    this.emit(spec.effect, spec.position, spec.crest, params, spec.id, spec.priority)
    return this
  }

  /** Columns running along the row, the first cresting on `crest`. */
  cascade(spec: FountainCascadeSpec): this {
    const params: CueParams = {}
    if (spec.stepBeats !== undefined) params['stepBeats'] = spec.stepBeats
    if (spec.reverse !== undefined) params['reverse'] = spec.reverse
    commonParams(spec, params)
    this.emit(spec.effect, spec.position, spec.crest, params, spec.id, spec.priority)
    return this
  }

  /** The whole row up, heights rolling along it every periodBeats. */
  wave(spec: FountainWaveSpec): this {
    const params: CueParams = {}
    if (spec.periodBeats !== undefined) params['periodBeats'] = spec.periodBeats
    if (spec.reverse !== undefined) params['reverse'] = spec.reverse
    commonParams(spec, params)
    this.emit(spec.effect, spec.position, spec.crest, params, spec.id, spec.priority)
    return this
  }

  /**
   * The same program on two banks at once, cresting together: ids
   * '<prefix>-000' (first bank) and '<prefix>-001' (second). Cascades and
   * waves flow outward from the center by default (see FountainMirrorSpec).
   */
  mirror(spec: FountainMirrorSpec): this {
    const prefix = spec.idPrefix ?? this.nextId()
    const outward = spec.outward ?? true
    spec.positions.forEach((position, i) => {
      const params: CueParams = {}
      if (spec.stepBeats !== undefined) params['stepBeats'] = spec.stepBeats
      if (spec.periodBeats !== undefined) params['periodBeats'] = spec.periodBeats
      params['reverse'] = i === 0 ? outward : !outward
      commonParams(spec, params)
      this.emit(spec.effect, position, spec.crest, params, `${prefix}-${pad3(i)}`, spec.priority)
    })
    return this
  }

  /** A low mist screen (the catalog's first 'mist' jet unless named), up by `from`. */
  mist(spec: FountainMistSpec): this {
    const effectId =
      spec.effect ??
      this.owner.catalog.effects.find((e) => e.medium === 'fountain' && e.jet === 'mist')?.id
    if (effectId === undefined) throw new Error("mist: catalog has no 'mist' fountain program")
    const params: CueParams = {}
    commonParams(spec, params)
    this.emit(effectId, spec.position, spec.from, params, spec.id, spec.priority)
    return this
  }

  private emit(
    effectId: string,
    positionId: string,
    anchor: MusicAnchor,
    params: CueParams,
    id: string | undefined,
    priority: number | undefined,
  ): void {
    const raw: RawCue = { effectId, anchor, positionId }
    if (Object.keys(params).length > 0) raw.params = params
    if (id !== undefined) raw.id = id
    if (priority !== undefined) raw.priority = priority
    this.pushRaw(raw)
  }
}
