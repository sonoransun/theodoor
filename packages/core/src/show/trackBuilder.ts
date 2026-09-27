/**
 * show/trackBuilder.ts — the base track facade every `b.<medium>` surface
 * extends, plus the raw-cue input shape. Lives apart from builder.ts so the
 * per-medium facade files (builderFountains.ts, builderLights.ts) can extend
 * it without an import cycle against the show builder itself.
 */

import type { Cue, CueParams, MusicAnchor, MusicalTimeline } from '../contracts.js'
import type { Catalog } from '../catalog/index.js'

/** Raw cue input for TrackBuilder.cue(): id optional, everything else as contracts.Cue. */
export interface RawCue {
  id?: string
  effectId: string
  anchor: MusicAnchor
  positionId?: string
  params?: CueParams
  priority?: number
}

/** The owner surface a track facade needs (structural, so facades can live in sibling files). */
export interface TrackOwner {
  readonly catalog: Catalog
  addCue(trackId: string, cue: Cue): void
  requireMusic(what: string): MusicalTimeline
}

export class TrackBuilder {
  protected readonly owner: TrackOwner
  readonly trackId: string
  private counter = 0

  constructor(owner: TrackOwner, trackId: string) {
    this.owner = owner
    this.trackId = trackId
  }

  /** Next deterministic auto id / group prefix: '<trackId>-<n>'. */
  protected nextId(): string {
    return `${this.trackId}-${this.counter++}`
  }

  protected push(cue: Cue): void {
    this.owner.addCue(this.trackId, cue)
  }

  protected pushRaw(raw: RawCue): void {
    const cue: Cue = { id: raw.id ?? this.nextId(), effectId: raw.effectId, anchor: raw.anchor }
    if (raw.positionId !== undefined) cue.positionId = raw.positionId
    if (raw.params !== undefined) cue.params = raw.params
    if (raw.priority !== undefined) cue.priority = raw.priority
    this.push(cue)
  }

  /** Append a raw cue (id auto-assigned when omitted). */
  cue(raw: RawCue): this {
    this.pushRaw(raw)
    return this
  }
}
