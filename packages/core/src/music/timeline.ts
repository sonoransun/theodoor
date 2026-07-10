/**
 * music/timeline.ts — authored Score -> MusicalTimeline (the one music
 * interchange every downstream consumer reads), plus query helpers.
 */

import type {
  Annotation,
  AnnotationKind,
  EnergyPoint,
  MusicalTimeline,
  Score,
  Seconds,
} from '../contracts.js'
import { ENERGY_DT_SEC } from '../contracts.js'
import { lerp } from '../math/index.js'
import { gridTimes, tempoMapsFrom, TempoMap } from '../time/index.js'

/** Silence appended after the last note so tails/echoes have room. */
export const TIMELINE_TAIL_SEC = 2
/** Notes at or above this velocity get an auto 'accent' annotation. */
export const ACCENT_VELOCITY = 0.85
/** Exponential decay time constant of the synthesized note envelope. */
const ENVELOPE_TAU_SEC = 0.5
/** Notes below this MIDI number read "big" — loudness weights them 1.2x. */
const BASS_MIDI = 45
const BASS_WEIGHT = 1.2
const EMA_ALPHA = 0.2
/** Two annotations within this window count as the same musical instant. */
const SAME_INSTANT_SEC = 1e-3

/** Build the canonical MusicalTimeline for an authored score. */
export function buildTimelineFromScore(score: Score): MusicalTimeline {
  const { tempo, meter } = tempoMapsFrom(score.tempo)

  let lastEndBeat = 0
  for (const n of score.notes) lastEndBeat = Math.max(lastEndBeat, n.startBeat + n.durBeats)
  const duration = tempo.beatToSec(lastEndBeat) + TIMELINE_TAIL_SEC

  const { beats, downbeats } = gridTimes(tempo, meter, duration)
  const annotations = mergedAnnotations(score, tempo)
  const energy = energyCurve(score, tempo, duration)

  return {
    source: 'score',
    id: score.id,
    title: score.title,
    duration,
    tempo: score.tempo,
    beats,
    downbeats,
    annotations,
    energy,
    tempoConfidence: 1,
    score,
  }
}

/**
 * Score annotations plus auto 'accent' marks (strength = velocity) wherever
 * notes at velocity >= ACCENT_VELOCITY start, unless an authored
 * accent/hit/climax already sits on that instant. Sorted by time.
 */
function mergedAnnotations(score: Score, tempo: TempoMap): Annotation[] {
  const annotations: Annotation[] = [...score.annotations]
  const emphasized = score.annotations.filter(
    (a) => a.kind === 'accent' || a.kind === 'hit' || a.kind === 'climax',
  )

  // Strongest loud-note velocity per starting instant (chords collapse).
  const strongStarts = new Map<number, number>()
  for (const n of score.notes) {
    if (n.velocity < ACCENT_VELOCITY) continue
    const key = Math.round(n.startBeat * 1e6) / 1e6
    const prev = strongStarts.get(key)
    if (prev === undefined || n.velocity > prev) strongStarts.set(key, n.velocity)
  }

  const sortedStarts = [...strongStarts.keys()].sort((a, b) => a - b)
  for (const beat of sortedStarts) {
    const time = tempo.beatToSec(beat)
    if (emphasized.some((a) => Math.abs(a.time - time) < SAME_INSTANT_SEC)) continue
    annotations.push({ time, beat, kind: 'accent', strength: strongStarts.get(beat)! })
  }

  annotations.sort(
    (a, b) => a.time - b.time || a.kind.localeCompare(b.kind) || b.strength - a.strength,
  )
  return annotations
}

/**
 * Synthesized energy on the uniform ENERGY_DT_SEC grid. Per bin:
 * sum of active-note velocity * exp(-age/tau); rms is that normalized to
 * peak 1 then EMA-smoothed; loudness additionally weights midi < BASS_MIDI
 * by 1.2 before its own normalization (bass reads "big").
 */
function energyCurve(score: Score, tempo: TempoMap, duration: Seconds): EnergyPoint[] {
  const dt = ENERGY_DT_SEC
  const bins = Math.floor(duration / dt + 1e-9) + 1
  const rms = new Float64Array(bins)
  const loudness = new Float64Array(bins)

  for (const note of score.notes) {
    const start = tempo.beatToSec(note.startBeat)
    const end = tempo.beatToSec(note.startBeat + note.durBeats)
    const weight = note.midi < BASS_MIDI ? BASS_WEIGHT : 1
    const first = Math.max(0, Math.ceil((start - 1e-9) / dt))
    for (let i = first; i < bins; i++) {
      const t = i * dt
      if (t >= end - 1e-9) break
      const e = note.velocity * Math.exp(-(t - start) / ENVELOPE_TAU_SEC)
      rms[i] += e
      loudness[i] += e * weight
    }
  }

  normalizeToPeak(rms)
  normalizeToPeak(loudness)
  emaSmooth(rms, EMA_ALPHA)
  emaSmooth(loudness, EMA_ALPHA)

  const points: EnergyPoint[] = new Array(bins)
  for (let i = 0; i < bins; i++) {
    points[i] = { time: i * dt, rms: rms[i]!, loudness: loudness[i]! }
  }
  return points
}

function normalizeToPeak(values: Float64Array): void {
  let peak = 0
  for (let i = 0; i < values.length; i++) if (values[i]! > peak) peak = values[i]!
  if (peak <= 0) return
  for (let i = 0; i < values.length; i++) values[i] = values[i]! / peak
}

function emaSmooth(values: Float64Array, alpha: number): void {
  for (let i = 1; i < values.length; i++) {
    values[i] = alpha * values[i]! + (1 - alpha) * values[i - 1]!
  }
}

/** Linear-interpolated energy lookup (clamped at the curve's ends). */
export function energyAt(tl: MusicalTimeline, t: Seconds): EnergyPoint {
  const e = tl.energy
  const n = e.length
  if (n === 0) return { time: t, rms: 0, loudness: 0 }
  if (t <= e[0]!.time) return { time: t, rms: e[0]!.rms, loudness: e[0]!.loudness }
  if (t >= e[n - 1]!.time) return { time: t, rms: e[n - 1]!.rms, loudness: e[n - 1]!.loudness }
  let i = Math.floor(t / ENERGY_DT_SEC)
  if (i >= n - 1) i = n - 2
  const a = e[i]!
  const b = e[i + 1]!
  const u = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time)
  return { time: t, rms: lerp(a.rms, b.rms, u), loudness: lerp(a.loudness, b.loudness, u) }
}

/** Annotations of one kind (optionally filtered by label), in time order. */
export function annotationsOfKind(
  tl: MusicalTimeline,
  kind: AnnotationKind,
  label?: string,
): Annotation[] {
  return tl.annotations.filter(
    (a) => a.kind === kind && (label === undefined || a.label === label),
  )
}

/** The strongest 'climax' annotation (first on ties), or undefined. */
export function climaxOf(tl: MusicalTimeline): Annotation | undefined {
  let best: Annotation | undefined
  for (const a of tl.annotations) {
    if (a.kind !== 'climax') continue
    if (!best || a.strength > best.strength) best = a
  }
  return best
}
