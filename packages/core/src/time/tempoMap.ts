import type { Beats, MeterSegment, Seconds, TempoMapData, TempoSegment } from '../contracts.js'

/**
 * Piecewise-constant tempo: beats ↔ seconds, both strictly monotonic and
 * exact inverses within float error. Beats before 0 and after the last
 * segment extrapolate with the nearest segment's bpm (pre-roll support).
 */
export class TempoMap {
  private readonly startBeats: number[] = []
  private readonly bpms: number[] = []
  private readonly startSecs: number[] = []

  constructor(segments: readonly TempoSegment[]) {
    if (segments.length === 0) throw new Error('TempoMap: no segments')
    if (segments[0]!.beat !== 0) throw new Error('TempoMap: first segment must start at beat 0')
    let sec = 0
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!
      if (!Number.isFinite(s.bpm) || s.bpm <= 0) throw new Error(`TempoMap: bpm must be > 0 (segment ${i})`)
      if (i > 0) {
        const prev = segments[i - 1]!
        if (s.beat <= prev.beat) throw new Error(`TempoMap: segment beats must ascend (segment ${i})`)
        sec += ((s.beat - prev.beat) * 60) / prev.bpm
      }
      this.startBeats.push(s.beat)
      this.bpms.push(s.bpm)
      this.startSecs.push(sec)
    }
  }

  /** Index of the segment containing beat b (right-closed on boundaries). */
  private segAtBeat(b: Beats): number {
    let lo = 0
    let hi = this.startBeats.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.startBeats[mid]! <= b) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  private segAtSec(s: Seconds): number {
    let lo = 0
    let hi = this.startSecs.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.startSecs[mid]! <= s) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  beatToSec(b: Beats): Seconds {
    const i = b <= 0 ? 0 : this.segAtBeat(b)
    return this.startSecs[i]! + ((b - this.startBeats[i]!) * 60) / this.bpms[i]!
  }

  secToBeat(s: Seconds): Beats {
    const i = s <= 0 ? 0 : this.segAtSec(s)
    return this.startBeats[i]! + ((s - this.startSecs[i]!) * this.bpms[i]!) / 60
  }

  bpmAtBeat(b: Beats): number {
    return this.bpms[b <= 0 ? 0 : this.segAtBeat(b)]!
  }

  bpmAtSec(s: Seconds): number {
    return this.bpms[s <= 0 ? 0 : this.segAtSec(s)]!
  }
}

/**
 * Bar:beat ↔ absolute beats. Bars and in-bar beats are 1-indexed (beat 1 is
 * the downbeat); `pickupBeats` occupy "bar 0" before bar 1.
 */
export class MeterMap {
  private readonly startBars: number[] = []
  private readonly beatsPerBar: number[] = []
  private readonly startBeats: number[] = []
  readonly pickupBeats: Beats

  constructor(meters: readonly MeterSegment[], pickupBeats: Beats = 0) {
    if (meters.length === 0) throw new Error('MeterMap: no meter segments')
    if (meters[0]!.bar !== 1) throw new Error('MeterMap: first meter segment must start at bar 1')
    if (pickupBeats < 0) throw new Error('MeterMap: pickupBeats must be >= 0')
    this.pickupBeats = pickupBeats
    let beat = pickupBeats
    for (let i = 0; i < meters.length; i++) {
      const m = meters[i]!
      if (!Number.isFinite(m.beatsPerBar) || m.beatsPerBar <= 0) {
        throw new Error(`MeterMap: beatsPerBar must be > 0 (segment ${i})`)
      }
      if (i > 0) {
        const prev = meters[i - 1]!
        if (m.bar <= prev.bar) throw new Error(`MeterMap: meter bars must ascend (segment ${i})`)
        beat += (m.bar - prev.bar) * prev.beatsPerBar
      }
      this.startBars.push(m.bar)
      this.beatsPerBar.push(m.beatsPerBar)
      this.startBeats.push(beat)
    }
  }

  private segAtBar(bar: number): number {
    let lo = 0
    let hi = this.startBars.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.startBars[mid]! <= bar) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  beatsPerBarAt(bar: number): number {
    return this.beatsPerBar[bar <= 1 ? 0 : this.segAtBar(bar)]!
  }

  barBeatToBeat(bar: number, beat: number): Beats {
    if (bar < 1) throw new Error(`MeterMap: bar must be >= 1 (got ${bar})`)
    const i = this.segAtBar(bar)
    return this.startBeats[i]! + (bar - this.startBars[i]!) * this.beatsPerBar[i]! + (beat - 1)
  }

  beatToBarBeat(b: Beats): { bar: number; beat: number } {
    if (b < this.startBeats[0]!) {
      // Pickup region: "bar 0".
      return { bar: 0, beat: b - this.startBeats[0]! + 1 }
    }
    let i = this.startBeats.length - 1
    while (i > 0 && this.startBeats[i]! > b) i--
    const offset = b - this.startBeats[i]!
    const bpb = this.beatsPerBar[i]!
    const barDelta = Math.floor(offset / bpb + 1e-9)
    return { bar: this.startBars[i]! + barDelta, beat: 1 + (offset - barDelta * bpb) }
  }
}

const MAX_GRID_BEATS = 200_000

/**
 * All integer-beat instants (seconds) from beat 0 up to durationSec, and the
 * subset that are downbeats (in-bar beat 1 of bars >= 1).
 */
export function gridTimes(
  tempo: TempoMap,
  meter: MeterMap,
  durationSec: Seconds,
): { beats: number[]; downbeats: number[] } {
  const beats: number[] = []
  const downbeats: number[] = []
  for (let b = 0; b <= MAX_GRID_BEATS; b++) {
    const t = tempo.beatToSec(b)
    if (t > durationSec + 1e-9) return { beats, downbeats }
    beats.push(t)
    const pos = meter.beatToBarBeat(b)
    if (pos.bar >= 1 && Math.abs(pos.beat - 1) < 1e-9) downbeats.push(t)
  }
  throw new Error('gridTimes: exceeded beat cap — check tempo map and duration')
}

/** Convenience: build both maps from serialized TempoMapData. */
export function tempoMapsFrom(data: TempoMapData): { tempo: TempoMap; meter: MeterMap } {
  return {
    tempo: new TempoMap(data.segments),
    meter: new MeterMap(data.meters, data.pickupBeats ?? 0),
  }
}
