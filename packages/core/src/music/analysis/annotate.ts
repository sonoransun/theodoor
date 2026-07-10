/**
 * music/analysis/annotate.ts — analysis features → MusicalTimeline.
 *
 * Produces the exact interchange shape authored scores produce (source
 * 'analysis', no `score` field): beat/downbeat arrays from the fitted grid,
 * hit/accent annotations from onset-strength outliers, climax annotations
 * from the 2 s-smoothed loudness curve, phrase annotations at loudness minima
 * followed by a sustained rise, and a single-segment TempoMapData.
 *
 * Silence or sub-4-second audio degrades gracefully: tempoConfidence 0 and
 * empty beat arrays, never a throw.
 */

import { ENERGY_DT_SEC } from '../../contracts.js'
import type {
  Annotation,
  AnnotationKind,
  MusicalTimeline,
  TempoMapData,
} from '../../contracts.js'
import { clamp } from '../../math/index.js'
import { STFT_HOP, STFT_SIZE, stft } from './fft.js'
import { detectOnsets } from './onset.js'
import { estimateTempo } from './tempoEst.js'
import { computeEnergy } from './energy.js'
import { decodeWav } from './wav.js'

export interface AnalyzeOptions {
  /** Assumed beats per bar for downbeat inference (default 4). */
  meterHint?: number
  id?: string
  title?: string
}

/** Below this duration tempo estimation is skipped entirely. */
const MIN_TEMPO_DURATION_SEC = 4
/** Loudness smoothing window for climax/phrase detection. */
const CLIMAX_SMOOTH_SEC = 2
/** Minimum spacing between reported climaxes. */
const CLIMAX_MIN_GAP_SEC = 5
/** Secondary climaxes must reach this fraction of the global maximum. */
const CLIMAX_SECONDARY_RATIO = 0.85

const KIND_ORDER: readonly AnnotationKind[] = [
  'downbeat',
  'beat',
  'phrase',
  'climax',
  'hit',
  'accent',
]

function kindRank(k: AnnotationKind): number {
  const i = KIND_ORDER.indexOf(k)
  return i < 0 ? KIND_ORDER.length : i
}

/** Centered moving average with a window of `taps` samples (clamped edges). */
function movingAverage(values: readonly number[], taps: number): Float64Array {
  const n = values.length
  const out = new Float64Array(n)
  const half = Math.max(0, Math.floor(taps / 2))
  // Prefix sums for O(n).
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + values[i]!
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(n - 1, i + half)
    out[i] = (prefix[hi + 1]! - prefix[lo]!) / (hi - lo + 1)
  }
  return out
}

export function analyzePcm(
  samples: Float32Array,
  sampleRate: number,
  opts: AnalyzeOptions = {},
): MusicalTimeline {
  if (!(sampleRate > 0)) throw new Error('analyzePcm: sampleRate must be > 0')
  const meterHint = Math.max(1, Math.round(opts.meterHint ?? 4))
  const id = opts.id ?? 'analysis'
  const title = opts.title ?? id
  const duration = samples.length / sampleRate

  // One STFT shared by the onset and energy paths.
  const frames = stft(samples, STFT_SIZE, STFT_HOP)
  const energy = computeEnergy(samples, sampleRate, { frames })
  const onset = detectOnsets(samples, sampleRate, { frames })

  const est =
    duration >= MIN_TEMPO_DURATION_SEC
      ? estimateTempo(onset, duration, { meterHint })
      : undefined
  const hasTempo = est !== undefined && est.confidence > 0 && est.beats.length > 0
  const beats = hasTempo ? est.beats : []
  const downbeats = hasTempo ? est.downbeats : []
  const bpm = hasTempo ? est.bpm : 120
  const tempoConfidence = hasTempo ? est.confidence : 0

  const annotations: Annotation[] = []

  // --- hits & accents from onset-strength outliers -------------------------
  const strengths = onset.onsets.map((o) => o.strength)
  if (strengths.length > 0) {
    let mu = 0
    for (const s of strengths) mu += s
    mu /= strengths.length
    let varAcc = 0
    for (const s of strengths) varAcc += (s - mu) * (s - mu)
    const sigma = Math.sqrt(varAcc / strengths.length)
    let maxS = 0
    for (const s of strengths) if (s > maxS) maxS = s
    for (const o of onset.onsets) {
      const norm = maxS > 0 ? clamp(o.strength / maxS, 0, 1) : 0
      if (o.strength > mu + 2 * sigma) {
        annotations.push({ time: o.t, kind: 'hit', strength: norm })
      } else if (o.strength > mu + sigma) {
        annotations.push({ time: o.t, kind: 'accent', strength: norm })
      }
    }
  }

  // --- climaxes from the 2 s-smoothed loudness curve ------------------------
  const loud = energy.map((e) => e.loudness)
  const smooth = movingAverage(loud, Math.round(CLIMAX_SMOOTH_SEC / ENERGY_DT_SEC) | 1)
  let maxV = 0
  let maxI = 0
  for (let i = 0; i < smooth.length; i++) {
    if (smooth[i]! > maxV) {
      maxV = smooth[i]!
      maxI = i
    }
  }
  if (maxV > 0) {
    const climaxTimes: number[] = [energy[maxI]!.time]
    annotations.push({ time: energy[maxI]!.time, kind: 'climax', strength: 1 })
    for (let i = 1; i < smooth.length - 1; i++) {
      if (i === maxI) continue
      if (!(smooth[i]! > smooth[i - 1]! && smooth[i]! >= smooth[i + 1]!)) continue
      if (smooth[i]! < CLIMAX_SECONDARY_RATIO * maxV) continue
      const t = energy[i]!.time
      if (climaxTimes.some((c) => Math.abs(c - t) < CLIMAX_MIN_GAP_SEC)) continue
      climaxTimes.push(t)
      annotations.push({ time: t, kind: 'climax', strength: CLIMAX_SECONDARY_RATIO })
    }
  }

  // --- phrases: loudness local minima followed by a sustained >= 4-beat rise
  if (hasTempo && maxV > 0 && beats.length >= 8) {
    const beatDur = 60 / bpm
    const riseSteps = Math.max(1, Math.round((4 * beatDur) / ENERGY_DT_SEC))
    const minGapSec = 8 * beatDur
    let lastPhraseT = -Infinity
    for (let i = 1; i < smooth.length - 1; i++) {
      if (!(smooth[i]! < smooth[i - 1]! && smooth[i]! <= smooth[i + 1]!)) continue
      const end = i + riseSteps
      if (end >= smooth.length) continue
      const v0 = smooth[i]!
      // Sustained: never dips meaningfully below the minimum, ends clearly above.
      let sustained = smooth[end]! >= v0 + 0.05
      for (let j = i + 1; sustained && j <= end; j++) {
        if (smooth[j]! < v0 - 0.02) sustained = false
      }
      if (!sustained) continue
      const t = energy[i]!.time
      if (t - lastPhraseT < minGapSec) continue
      lastPhraseT = t
      annotations.push({ time: t, kind: 'phrase', strength: 0.6 })
    }
  }

  annotations.sort((a, b) => a.time - b.time || kindRank(a.kind) - kindRank(b.kind))

  const tempo: TempoMapData = {
    segments: [{ beat: 0, bpm }],
    meters: [{ bar: 1, beatsPerBar: meterHint }],
  }

  return {
    source: 'analysis',
    id,
    title,
    duration,
    tempo,
    beats,
    downbeats,
    annotations,
    energy,
    tempoConfidence,
  }
}

/** Convenience: decodeWav + analyzePcm (decode warnings are dropped here —
 * call decodeWav directly when you need them). */
export function analyzeWav(bytes: Uint8Array, opts: AnalyzeOptions = {}): MusicalTimeline {
  const { samples, sampleRate } = decodeWav(bytes)
  return analyzePcm(samples, sampleRate, opts)
}
