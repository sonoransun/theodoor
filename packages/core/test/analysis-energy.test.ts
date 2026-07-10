import { describe, expect, it } from 'vitest'
import { ENERGY_DT_SEC } from '../src/contracts.js'
import { aWeightDb, computeEnergy } from '../src/music/analysis/energy.js'

const SR = 44100

function sine(freq: number, amp: number, n: number, out: Float32Array, from: number): void {
  for (let i = 0; i < n; i++) {
    out[from + i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  }
}

describe('aWeightDb', () => {
  it('matches the standard A-weighting curve at reference points', () => {
    expect(aWeightDb(1000)).toBeCloseTo(0, 1)
    expect(Math.abs(aWeightDb(100) - -19.1)).toBeLessThan(0.5)
    expect(Math.abs(aWeightDb(10000) - -2.5)).toBeLessThan(0.5)
    expect(aWeightDb(0)).toBe(-Infinity)
  })
})

describe('computeEnergy', () => {
  it('produces the uniform 50 ms grid with rms and loudness in 0..1', () => {
    const samples = new Float32Array(3 * SR)
    sine(440, 0.5, samples.length, samples, 0)
    const energy = computeEnergy(samples, SR)
    expect(energy.length).toBe(Math.ceil(3 / ENERGY_DT_SEC))
    for (let i = 0; i < energy.length; i++) {
      expect(energy[i]!.time).toBeCloseTo(i * ENERGY_DT_SEC, 9)
      expect(energy[i]!.rms).toBeGreaterThanOrEqual(0)
      expect(energy[i]!.rms).toBeLessThanOrEqual(1)
      expect(energy[i]!.loudness).toBeGreaterThanOrEqual(0)
      expect(energy[i]!.loudness).toBeLessThanOrEqual(1)
    }
    // Steady tone: interior bins all near the normalized maximum.
    for (let i = 2; i < energy.length - 2; i++) {
      expect(energy[i]!.rms).toBeGreaterThan(0.95)
    }
  })

  it('tracks level changes in both rms and loudness', () => {
    const samples = new Float32Array(4 * SR)
    sine(1000, 0.1, 2 * SR, samples, 0)
    sine(1000, 0.9, 2 * SR, samples, 2 * SR)
    const energy = computeEnergy(samples, SR)
    const early = energy[20]! // ~1.0 s
    const late = energy[60]! // ~3.0 s
    expect(late.rms).toBeGreaterThan(early.rms * 2)
    expect(late.loudness).toBeGreaterThan(early.loudness)
    expect(early.rms).toBeCloseTo(0.1 / 0.9, 1)
  })

  it('A-weighting suppresses low-frequency loudness at equal rms', () => {
    const samples = new Float32Array(4 * SR)
    sine(1000, 0.5, 2 * SR, samples, 0)
    sine(50, 0.5, 2 * SR, samples, 2 * SR)
    const energy = computeEnergy(samples, SR)
    const at1k = energy[20]! // ~1.0 s
    const at50 = energy[60]! // ~3.0 s
    expect(Math.abs(at1k.rms - at50.rms)).toBeLessThan(0.1) // same physical level
    // 50 Hz is ~30 dB down after A-weighting -> ~0.5 lower on the 60 dB scale.
    expect(at1k.loudness - at50.loudness).toBeGreaterThan(0.35)
  })

  it('returns zero loudness for silence and [] for empty input', () => {
    const energy = computeEnergy(new Float32Array(SR), SR)
    for (const e of energy) {
      expect(e.rms).toBe(0)
      expect(e.loudness).toBe(0)
    }
    expect(computeEnergy(new Float32Array(0), SR)).toEqual([])
  })
})
