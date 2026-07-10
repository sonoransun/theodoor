/**
 * music/analysis/energy.ts — RMS + approximate-loudness curves on the
 * uniform 50 ms energy grid (ENERGY_DT_SEC).
 *
 * rms: root-mean-square per bin, normalized 0..1 by the track maximum.
 * loudness: per-STFT-frame A-weighted power (closed-form IEC 61672 curve
 * applied to bin center frequencies), converted to dB, resampled onto the
 * grid, and normalized 0..1 over a 60 dB dynamic window below the maximum.
 */

import { ENERGY_DT_SEC } from '../../contracts.js'
import type { EnergyPoint } from '../../contracts.js'
import { clamp, sampleCurve } from '../../math/index.js'
import { STFT_HOP, STFT_SIZE, stft } from './fft.js'

export interface EnergyOptions {
  fftSize?: number
  hop?: number
  /** Precomputed stft(samples, fftSize, hop) frames, to share work with onset. */
  frames?: readonly Float64Array[]
}

/**
 * Closed-form A-weighting in dB for frequency f (Hz). Standard two-constant
 * approximation; ~0 dB at 1 kHz, strongly attenuating lows and extreme highs.
 */
export function aWeightDb(f: number): number {
  if (!(f > 0)) return -Infinity
  const f2 = f * f
  const c1 = 12194 * 12194
  const num = c1 * f2 * f2
  const den =
    (f2 + 20.6 * 20.6) *
    Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
    (f2 + c1)
  return 20 * Math.log10(num / den) + 2.0
}

/** Loudness dynamic range mapped onto 0..1 (dB below the track maximum). */
const LOUDNESS_RANGE_DB = 60
const SILENCE_FLOOR_DB = -110
const POWER_EPS = 1e-12

export function computeEnergy(
  samples: Float32Array,
  sampleRate: number,
  opts: EnergyOptions = {},
): EnergyPoint[] {
  if (!(sampleRate > 0)) throw new Error('computeEnergy: sampleRate must be > 0')
  const len = samples.length
  if (len === 0) return []
  const dt = ENERGY_DT_SEC
  const durationSec = len / sampleRate
  const nBins = Math.max(1, Math.ceil(durationSec / dt - 1e-9))

  // RMS per 50 ms bin, normalized by the maximum.
  const rms = new Float64Array(nBins)
  let rmsMax = 0
  for (let b = 0; b < nBins; b++) {
    const from = Math.min(len, Math.round(b * dt * sampleRate))
    const to = Math.min(len, Math.round((b + 1) * dt * sampleRate))
    let sum = 0
    for (let i = from; i < to; i++) {
      const v = samples[i]!
      sum += v * v
    }
    const v = to > from ? Math.sqrt(sum / (to - from)) : 0
    rms[b] = v
    if (v > rmsMax) rmsMax = v
  }
  if (rmsMax > 0) for (let b = 0; b < nBins; b++) rms[b] = rms[b]! / rmsMax

  // A-weighted loudness per STFT frame (dB), then resampled onto the grid.
  const n = opts.fftSize ?? STFT_SIZE
  const hop = opts.hop ?? STFT_HOP
  const frames = opts.frames ?? stft(samples, n, hop)
  const binCount = frames.length > 0 ? frames[0]!.length : 0
  const weight = new Float64Array(binCount)
  for (let k = 1; k < binCount; k++) {
    weight[k] = Math.pow(10, aWeightDb((k * sampleRate) / n) / 10)
  }
  const frameTimes: number[] = []
  const frameDb: number[] = []
  const t0 = n / 2 / sampleRate
  for (let f = 0; f < frames.length; f++) {
    const mag = frames[f]!
    let p = 0
    for (let k = 1; k < binCount; k++) p += mag[k]! * mag[k]! * weight[k]!
    frameTimes.push(t0 + (f * hop) / sampleRate)
    frameDb.push(10 * Math.log10(p + POWER_EPS))
  }

  let maxDb = -Infinity
  for (const d of frameDb) if (d > maxDb) maxDb = d
  const silent = frames.length === 0 || maxDb <= SILENCE_FLOOR_DB
  const curve = { times: frameTimes, values: frameDb }

  const out: EnergyPoint[] = []
  for (let b = 0; b < nBins; b++) {
    let loudness = 0
    if (!silent) {
      const db = sampleCurve(curve, (b + 0.5) * dt)
      loudness = clamp((db - (maxDb - LOUDNESS_RANGE_DB)) / LOUDNESS_RANGE_DB, 0, 1)
    }
    out.push({ time: b * dt, rms: rms[b]!, loudness })
  }
  return out
}
