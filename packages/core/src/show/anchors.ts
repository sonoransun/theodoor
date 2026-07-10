/**
 * show/anchors.ts — MusicAnchor → show-seconds resolution against a
 * MusicalTimeline.
 *
 * The timeline's `beats`/`downbeats` ARRAYS are authoritative (for
 * analysis-sourced timelines the serialized tempo map is only a fit); anchors
 * resolve by interpolating the beats array at fractional beat indices.
 * Out-of-range beat indices extrapolate through the tempo map ONLY for
 * score-sourced timelines (where the map reproduces the array exactly);
 * analysis timelines return `undefined` instead of guessing.
 *
 * `undefined` always means "unresolvable" — the solver turns it into an
 * ANCHOR_UNRESOLVED diagnostic; this module never throws on bad anchors.
 */

import type { Beats, MusicAnchor, MusicalTimeline, Seconds } from '../contracts.js'
import { lowerIndex, tempoMapsFrom } from '../time/index.js'

/**
 * Seconds at a fractional index into `tl.beats` (beat index 4.5 is the
 * midpoint of beats[4] and beats[5]). Indices outside [0, beats.length − 1]
 * extrapolate via the tempo map for score-sourced timelines and are
 * `undefined` for analysis-sourced ones.
 */
export function beatIndexToSec(tl: MusicalTimeline, beatIdx: Beats): Seconds | undefined {
  if (!Number.isFinite(beatIdx)) return undefined
  const beats = tl.beats
  const n = beats.length
  if (n > 0 && beatIdx >= 0 && beatIdx <= n - 1) {
    const i = Math.floor(beatIdx)
    const frac = beatIdx - i
    if (frac === 0) return beats[i]!
    return beats[i]! + (beats[i + 1]! - beats[i]!) * frac
  }
  if (tl.source === 'score') {
    try {
      return tempoMapsFrom(tl.tempo).tempo.beatToSec(beatIdx)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Inverse of {@link beatIndexToSec}: the fractional beats-array index of a
 * time. Out-of-range times fall back to the tempo map for score-sourced
 * timelines only.
 */
export function secToBeatIndex(tl: MusicalTimeline, t: Seconds): Beats | undefined {
  if (!Number.isFinite(t)) return undefined
  const beats = tl.beats
  const n = beats.length
  if (n > 0 && t >= beats[0]! && t <= beats[n - 1]!) {
    const i = lowerIndex(beats, t)
    if (i >= n - 1) return n - 1
    const a = beats[i]!
    const b = beats[i + 1]!
    return b === a ? i : i + (t - a) / (b - a)
  }
  if (tl.source === 'score') {
    try {
      return tempoMapsFrom(tl.tempo).tempo.secToBeat(t)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Resolve a MusicAnchor to show seconds, or `undefined` when unresolvable:
 * - 'sec'        → t verbatim. A (type-invalid) offsetBeats smuggled onto a
 *                  seconds anchor is an error → undefined (beat offsets need
 *                  a beat grid).
 * - 'beat'       → beats-array interpolation at `beat + offsetBeats`.
 * - 'barBeat'    → MeterMap bar:beat → absolute beats, then the array path.
 * - 'annotation' → annotations filtered by type (and label when given),
 *                  entry [index]'s time; offsetBeats applied in beat space
 *                  (via the annotation's own `beat` when present, else the
 *                  inverse array lookup) before converting back to seconds.
 */
export function resolveAnchor(anchor: MusicAnchor, tl: MusicalTimeline): Seconds | undefined {
  switch (anchor.kind) {
    case 'sec': {
      if ((anchor as { offsetBeats?: Beats }).offsetBeats !== undefined) return undefined
      return Number.isFinite(anchor.t) ? anchor.t : undefined
    }
    case 'beat':
      return beatIndexToSec(tl, anchor.beat + (anchor.offsetBeats ?? 0))
    case 'barBeat': {
      let absBeat: Beats
      try {
        const { meter } = tempoMapsFrom(tl.tempo)
        absBeat = meter.barBeatToBeat(anchor.bar, anchor.beat)
      } catch {
        return undefined
      }
      return beatIndexToSec(tl, absBeat + (anchor.offsetBeats ?? 0))
    }
    case 'annotation': {
      if (!Number.isInteger(anchor.index) || anchor.index < 0) return undefined
      const matches = tl.annotations.filter(
        (a) => a.kind === anchor.type && (anchor.label === undefined || a.label === anchor.label),
      )
      const hit = matches[anchor.index]
      if (hit === undefined) return undefined
      const off = anchor.offsetBeats ?? 0
      if (off === 0) return hit.time
      const baseIdx = hit.beat !== undefined ? hit.beat : secToBeatIndex(tl, hit.time)
      if (baseIdx === undefined) return undefined
      return beatIndexToSec(tl, baseIdx + off)
    }
  }
}
