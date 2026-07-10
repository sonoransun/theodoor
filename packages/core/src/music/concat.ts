import type {
  Annotation,
  MeterSegment,
  NoteEvent,
  Score,
  TempoSegment,
  Voice,
} from '../contracts.js'
import { MeterMap, TempoMap } from '../time/tempoMap.js'

/**
 * Concatenate two scores into one continuous Score: b starts on the bar line
 * after a's last full bar. Voices are matched by (name, program) and merged;
 * unmatched voices are appended. Annotation times are recomputed for the
 * combined tempo map, so `buildTimelineFromScore` on the result is exact.
 *
 * b's pickup beats (if any) are honored: its bar-1 downbeat lands on the
 * joint bar line and the pickup spills into a's final bar.
 */
export function concatScores(a: Score, b: Score, opts?: { id?: string; title?: string }): Score {
  const aTempo = new TempoMap(a.tempo.segments)
  const aMeter = new MeterMap(a.tempo.meters, a.tempo.pickupBeats ?? 0)
  const bMeter = new MeterMap(b.tempo.meters, b.tempo.pickupBeats ?? 0)

  // a's musical extent in beats and bars (last note end, rounded up to a bar).
  let aEndBeat = 0
  for (const n of a.notes) aEndBeat = Math.max(aEndBeat, n.startBeat + n.durBeats)
  const endPos = aMeter.beatToBarBeat(Math.max(aEndBeat - 1e-9, 0))
  const joinBar = Math.max(1, endPos.bar) + 1
  /** Beat of the joint bar line = b's bar-1 downbeat position. */
  const joinBeat = aMeter.barBeatToBeat(joinBar, 1)
  const bPickup = b.tempo.pickupBeats ?? 0
  /** b's beat 0 mapped into the combined grid. */
  const bOffset = joinBeat - bPickup

  // Tempo segments: a's up to the join, then b's shifted.
  const segments: TempoSegment[] = []
  for (const s of a.tempo.segments) {
    if (s.beat < joinBeat) segments.push({ beat: s.beat, bpm: s.bpm })
  }
  const bFirst = b.tempo.segments[0]!
  if (bOffset + bFirst.beat > (segments[segments.length - 1]?.beat ?? 0)) {
    segments.push({ beat: bOffset + bFirst.beat, bpm: bFirst.bpm })
  } else {
    segments[segments.length - 1] = { beat: bOffset + bFirst.beat, bpm: bFirst.bpm }
  }
  for (const s of b.tempo.segments.slice(1)) {
    segments.push({ beat: bOffset + s.beat, bpm: s.bpm })
  }

  // Meters: a's up to the join bar, then b's shifted by (joinBar - 1) bars.
  const meters: MeterSegment[] = []
  for (const m of a.tempo.meters) {
    if (m.bar < joinBar) meters.push({ bar: m.bar, beatsPerBar: m.beatsPerBar })
  }
  for (const m of b.tempo.meters) {
    const bar = joinBar + (m.bar - 1)
    const last = meters[meters.length - 1]
    if (last && last.bar === bar) last.beatsPerBar = m.beatsPerBar
    else meters.push({ bar, beatsPerBar: m.beatsPerBar })
  }

  // Voices merged by (name, program).
  const voices: Voice[] = [...a.voices]
  const bVoiceMap: number[] = b.voices.map((v) => {
    const i = voices.findIndex((av) => av.name === v.name && av.program === v.program)
    if (i >= 0) return i
    voices.push(v)
    return voices.length - 1
  })

  const notes: NoteEvent[] = [
    ...a.notes,
    ...b.notes.map((n) => ({
      ...n,
      voice: bVoiceMap[n.voice] ?? n.voice,
      startBeat: n.startBeat + bOffset,
    })),
  ]
  notes.sort((x, y) => x.startBeat - y.startBeat || x.voice - y.voice || x.midi - y.midi)

  // Annotations: recompute both sides' times against the combined tempo map.
  const tempoData = { segments, meters, ...(a.tempo.pickupBeats !== undefined ? { pickupBeats: a.tempo.pickupBeats } : {}) }
  const combined = new TempoMap(segments)
  const bTempo = new TempoMap(b.tempo.segments)
  const reBeatA = (t: number): number => aTempo.secToBeat(t)
  const reBeatB = (t: number): number => bTempo.secToBeat(t) + bOffset
  const annotations: Annotation[] = [
    ...a.annotations.map((an) => remap(an, reBeatA, combined)),
    ...b.annotations.map((an) => remap(an, reBeatB, combined)),
  ]
  annotations.sort((x, y) => x.time - y.time || cmpKind(x, y))

  return {
    id: opts?.id ?? `${a.id}+${b.id}`,
    title: opts?.title ?? `${a.title} / ${b.title}`,
    tempo: tempoData,
    voices,
    notes,
    annotations,
  }
}

function remap(an: Annotation, toBeat: (t: number) => number, combined: TempoMap): Annotation {
  const beat = toBeat(an.time)
  return { ...an, beat, time: combined.beatToSec(beat) }
}

function cmpKind(x: Annotation, y: Annotation): number {
  return x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0
}
