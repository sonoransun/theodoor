/**
 * music/analysis/onset.ts — spectral-flux onset detection.
 *
 * Pipeline: STFT magnitudes → log compression → positive spectral flux below
 * 11 kHz → 98th-percentile normalization → Dixon-style adaptive peak picking.
 */

import type { Seconds } from '../../contracts.js'
import { STFT_HOP, STFT_SIZE, stft } from './fft.js'

export interface OnsetPoint {
  t: Seconds
  /** Normalized flux at the peak (98th percentile ≈ 1; may exceed 1). */
  strength: number
}

export interface OnsetResult {
  /** Normalized spectral-flux envelope, one value per STFT frame. */
  envelope: Float64Array
  /** Seconds between envelope samples (hop / sampleRate). */
  hopSec: Seconds
  /** Time of envelope[0] — the STFT window-center convention (n/2 / sampleRate). */
  t0Sec: Seconds
  /** Detected onsets, sorted by time. */
  onsets: OnsetPoint[]
}

export interface OnsetOptions {
  fftSize?: number
  hop?: number
  /** Precomputed stft(samples, fftSize, hop) frames, to share work with energy. */
  frames?: readonly Float64Array[]
}

/** Frequency ceiling for flux accumulation (percussive band). */
const FLUX_MAX_HZ = 11_000
/** Minimum spacing between reported onsets. */
const MIN_ONSET_GAP_SEC = 0.03

function median(sorted: Float64Array): number {
  const n = sorted.length
  if (n === 0) return 0
  const mid = n >> 1
  return n % 2 === 1 ? sorted[mid]! : 0.5 * (sorted[mid - 1]! + sorted[mid]!)
}

export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  opts: OnsetOptions = {},
): OnsetResult {
  if (!(sampleRate > 0)) throw new Error('detectOnsets: sampleRate must be > 0')
  const n = opts.fftSize ?? STFT_SIZE
  const hop = opts.hop ?? STFT_HOP
  const frames = opts.frames ?? stft(samples, n, hop)
  const hopSec = hop / sampleRate
  const t0Sec = n / 2 / sampleRate
  const nf = frames.length
  const envelope = new Float64Array(nf)
  if (nf < 2) return { envelope, hopSec, t0Sec, onsets: [] }

  const binHz = sampleRate / n
  const kMax = Math.min(frames[0]!.length - 1, Math.floor(FLUX_MAX_HZ / binHz))

  // Log-compressed positive spectral flux.
  const bins = kMax + 1
  let prev = new Float64Array(bins)
  let cur = new Float64Array(bins)
  for (let k = 0; k < bins; k++) prev[k] = Math.log(1 + 10 * frames[0]![k]!)
  for (let f = 1; f < nf; f++) {
    const mag = frames[f]!
    let flux = 0
    for (let k = 0; k < bins; k++) {
      const m = Math.log(1 + 10 * mag[k]!)
      cur[k] = m
      const d = m - prev[k]!
      if (d > 0) flux += d
    }
    envelope[f] = flux
    const tmp = prev
    prev = cur
    cur = tmp
  }

  // Normalize by the 98th percentile so thresholds are level-independent.
  const sorted = Float64Array.from(envelope).sort()
  const p98 = sorted[Math.floor(0.98 * (nf - 1))]!
  if (p98 > 0) {
    for (let i = 0; i < nf; i++) envelope[i] = envelope[i]! / p98
  }

  // Dixon adaptive peak picking.
  const onsets: OnsetPoint[] = []
  let lastT = -Infinity
  for (let i = 1; i < nf; i++) {
    const v = envelope[i]!
    if (v <= 0) continue

    // (a) local maximum over [i-3, i+3]
    let isMax = true
    for (let j = Math.max(0, i - 3); j <= Math.min(nf - 1, i + 3); j++) {
      if (j !== i && envelope[j]! > v) {
        isMax = false
        break
      }
    }
    if (!isMax) continue

    // (b) above adaptive threshold over [i-30, i+10]
    const lo = Math.max(0, i - 30)
    const hi = Math.min(nf - 1, i + 10)
    const win = envelope.slice(lo, hi + 1)
    let mean = 0
    for (let j = 0; j < win.length; j++) mean += win[j]!
    mean /= win.length
    const med = median(win.sort())
    const delta = 0.1 + 0.5 * med
    if (v < mean + delta) continue

    // (c) minimum spacing
    const t = t0Sec + i * hopSec
    if (t - lastT < MIN_ONSET_GAP_SEC) continue
    lastT = t
    onsets.push({ t, strength: v })
  }

  return { envelope, hopSec, t0Sec, onsets }
}
