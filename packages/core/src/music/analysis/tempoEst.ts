/**
 * music/analysis/tempoEst.ts — global tempo, beat grid, and downbeat
 * estimation from an onset envelope.
 *
 * Autocorrelation over 0.25–2.0 s lags weighted by a log-Gaussian prior
 * centered at 120 BPM (σ = 0.7 octave); octave disambiguation via harmonic
 * support at half/double lags; parabolic peak interpolation; 64-candidate
 * phase fit; onset snapping + least-squares refit of a single global tempo
 * (no piecewise rubato in v1); downbeat offset by summed onset strength.
 */

import type { Seconds } from '../../contracts.js'
import { clamp } from '../../math/index.js'
import type { OnsetResult } from './onset.js'

export interface TempoEstimateOptions {
  /** Assumed beats per bar for downbeat inference (default 4). */
  meterHint?: number
}

export interface TempoEstimate {
  bpm: number
  periodSec: Seconds
  /** Time of beat index 0 of the fitted grid (first beat >= 0). */
  phaseSec: Seconds
  /** Fitted beat instants in [0, duration], sorted ascending. */
  beats: number[]
  /** Beats at indices ≡ downbeatOffset (mod meterHint). */
  downbeats: number[]
  downbeatOffset: number
  /** 0..1 — autocorrelation peak/mean ratio mapped onto the unit interval. */
  confidence: number
}

const PRIOR_CENTER_BPM = 120
const PRIOR_SIGMA_OCTAVES = 0.7
const LAG_MIN_SEC = 0.25
const LAG_MAX_SEC = 2.0
/** Octave halving never goes faster than this (lag floor of 0.2 s = 300 BPM). */
const MIN_PERIOD_SEC = 0.2

function emptyEstimate(): TempoEstimate {
  return {
    bpm: PRIOR_CENTER_BPM,
    periodSec: 60 / PRIOR_CENTER_BPM,
    phaseSec: 0,
    beats: [],
    downbeats: [],
    downbeatOffset: 0,
    confidence: 0,
  }
}

export function estimateTempo(
  onset: OnsetResult,
  durationSec: Seconds,
  opts: TempoEstimateOptions = {},
): TempoEstimate {
  const meterHint = Math.max(1, Math.round(opts.meterHint ?? 4))
  const { envelope: env, hopSec, t0Sec, onsets } = onset
  const n = env.length

  const lagMin = Math.max(2, Math.round(LAG_MIN_SEC / hopSec))
  const lagMax = Math.min(n - 2, Math.round(LAG_MAX_SEC / hopSec))
  if (lagMax <= lagMin + 2 || onsets.length < 4) return emptyEstimate()

  // Per-term-normalized autocorrelation, computed out to 2×lagMax so the
  // octave test can consult r(2T).
  const maxLag = Math.min(n - 2, lagMax * 2)
  const r = new Float64Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0
    const m = n - lag
    for (let i = 0; i < m; i++) s += env[i]! * env[i + lag]!
    r[lag] = s / m
  }
  const rAt = (lag: number): number => {
    const i = Math.round(lag)
    return i >= 1 && i <= maxLag ? r[i]! : 0
  }
  const priorAt = (lag: number): number => {
    const bpm = 60 / (lag * hopSec)
    const x = Math.log2(bpm / PRIOR_CENTER_BPM) / PRIOR_SIGMA_OCTAVES
    return Math.exp(-0.5 * x * x)
  }

  // Prior-weighted peak over the search range.
  let best = lagMin
  let bestScore = -Infinity
  let sumR = 0
  for (let lag = lagMin; lag <= lagMax; lag++) {
    sumR += r[lag]!
    const sc = r[lag]! * priorAt(lag)
    if (sc > bestScore) {
      bestScore = sc
      best = lag
    }
  }
  const meanR = sumR / (lagMax - lagMin + 1)
  if (!(meanR > 0) || !(rAt(best) > 0)) return emptyEstimate()

  // Octave disambiguation.
  // Doubling: only when the double lag is decisively more periodic.
  const dbl = best * 2
  if (dbl <= maxLag && rAt(dbl) > 1.3 * rAt(best) && priorAt(dbl) >= 0.5 * priorAt(best)) {
    best = dbl
  }
  // Halving: the half lag being nearly as periodic means `best` was a
  // subharmonic — take the faster tempo unless the prior strongly objects
  // (this is what keeps 120 preferred over 240).
  const minHalfLag = Math.max(2, Math.round(MIN_PERIOD_SEC / hopSec))
  for (;;) {
    const half = Math.round(best / 2)
    if (half < minHalfLag) break
    if (rAt(half) >= 0.5 * rAt(best) && priorAt(half) >= 0.5 * priorAt(best)) best = half
    else break
  }

  // Parabolic interpolation of the prior-weighted score around the peak.
  const sAt = (lag: number): number => rAt(lag) * priorAt(lag)
  const s0 = sAt(best - 1)
  const s1 = sAt(best)
  const s2 = sAt(best + 1)
  const denom = s0 - 2 * s1 + s2
  const frac = denom !== 0 ? clamp((0.5 * (s0 - s2)) / denom, -0.5, 0.5) : 0
  let period = (best + frac) * hopSec

  const confidence = clamp((rAt(best) / meanR - 1) / 4, 0, 1)

  // Linear-interpolated envelope lookup in seconds.
  const envAt = (t: Seconds): number => {
    const x = (t - t0Sec) / hopSec
    if (x <= 0) return env[0]!
    if (x >= n - 1) return env[n - 1]!
    const i = Math.floor(x)
    const u = x - i
    return env[i]! * (1 - u) + env[i + 1]! * u
  }

  // Phase fit: 64 candidate phases, maximize summed envelope on the grid.
  let phase = 0
  let bestPhaseScore = -Infinity
  for (let k = 0; k < 64; k++) {
    const phi = (k / 64) * period
    let s = 0
    for (let t = phi; t <= durationSec; t += period) s += envAt(t)
    if (s > bestPhaseScore) {
      bestPhaseScore = s
      phase = phi
    }
  }

  // Snap provisional beats to the strongest onset within ±T/8 and refit the
  // line t = phase + n·period by least squares. Two iterations so a slightly
  //-off initial period cannot drift later beats out of the snap window.
  const onsetTs = onsets.map((o) => o.t)
  for (let iter = 0; iter < 2; iter++) {
    const tol = period / 8
    const ns: number[] = []
    const ts: number[] = []
    const count = Math.max(0, Math.floor((durationSec - phase) / period) + 1)
    let cursor = 0
    for (let j = 0; j < count; j++) {
      const tb = phase + j * period
      while (cursor < onsetTs.length && onsetTs[cursor]! < tb - tol) cursor++
      let bestT = NaN
      let bestStrength = -Infinity
      for (let i = cursor; i < onsetTs.length && onsetTs[i]! <= tb + tol; i++) {
        if (onsets[i]!.strength > bestStrength) {
          bestStrength = onsets[i]!.strength
          bestT = onsetTs[i]!
        }
      }
      if (!Number.isNaN(bestT)) {
        ns.push(j)
        ts.push(bestT)
      }
    }
    if (ns.length < 2) break
    let nMean = 0
    let tMean = 0
    for (let i = 0; i < ns.length; i++) {
      nMean += ns[i]!
      tMean += ts[i]!
    }
    nMean /= ns.length
    tMean /= ns.length
    let sxy = 0
    let sxx = 0
    for (let i = 0; i < ns.length; i++) {
      const dx = ns[i]! - nMean
      sxy += dx * (ts[i]! - tMean)
      sxx += dx * dx
    }
    if (!(sxx > 0)) break
    const b = sxy / sxx
    if (!(b > 0.5 * period) || !(b < 2 * period)) break
    period = b
    phase = tMean - b * nMean
  }

  // Final grid covering [0, duration].
  const beats: number[] = []
  const first = Math.ceil((0 - phase) / period - 1e-9)
  for (let j = first; ; j++) {
    const t = phase + j * period
    if (t > durationSec + 1e-9) break
    beats.push(t < 0 ? 0 : t)
  }
  if (beats.length === 0) return emptyEstimate()

  // Downbeat offset: beat indices ≡ o (mod meterHint) with the greatest
  // summed onset-envelope strength (flat profiles fall back to offset 0).
  let downbeatOffset = 0
  let bestOffsetScore = -Infinity
  for (let o = 0; o < meterHint; o++) {
    let s = 0
    for (let j = o; j < beats.length; j += meterHint) s += envAt(beats[j]!)
    if (s > bestOffsetScore) {
      bestOffsetScore = s
      downbeatOffset = o
    }
  }
  const downbeats: number[] = []
  for (let j = downbeatOffset; j < beats.length; j += meterHint) downbeats.push(beats[j]!)

  return {
    bpm: 60 / period,
    periodSec: period,
    phaseSec: beats[0]!,
    beats,
    downbeats,
    downbeatOffset,
    confidence,
  }
}
