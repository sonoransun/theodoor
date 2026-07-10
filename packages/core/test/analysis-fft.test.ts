import { describe, expect, it } from 'vitest'
import { fft, hann, stft } from '../src/music/analysis/fft.js'
import { mulberry32 } from '../src/math/rng.js'

function mag(re: Float64Array, im: Float64Array, k: number): number {
  return Math.hypot(re[k]!, im[k]!)
}

describe('fft', () => {
  it('impulse -> flat magnitude spectrum', () => {
    const n = 64
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    re[0] = 1
    fft(re, im)
    for (let k = 0; k < n; k++) expect(mag(re, im, k)).toBeCloseTo(1, 12)
  })

  it('shifted impulse keeps flat magnitude', () => {
    const n = 64
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    re[5] = 1
    fft(re, im)
    for (let k = 0; k < n; k++) expect(mag(re, im, k)).toBeCloseTo(1, 12)
  })

  it('sine at bin k -> peak of N/2 at k and N-k, ~0 elsewhere', () => {
    const n = 256
    const k = 5
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * k * i) / n)
    fft(re, im)
    for (let j = 0; j < n; j++) {
      const m = mag(re, im, j)
      if (j === k || j === n - k) expect(m).toBeCloseTo(n / 2, 8)
      else expect(m).toBeLessThan(1e-9)
    }
  })

  it("satisfies Parseval's theorem", () => {
    const n = 128
    const rng = mulberry32(99)
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    let timeEnergy = 0
    for (let i = 0; i < n; i++) {
      re[i] = rng() * 2 - 1
      timeEnergy += re[i]! * re[i]!
    }
    fft(re, im)
    let freqEnergy = 0
    for (let k = 0; k < n; k++) freqEnergy += re[k]! * re[k]! + im[k]! * im[k]!
    expect(freqEnergy / n).toBeCloseTo(timeEnergy, 9)
  })

  it('matches a naive DFT at N=64 within 1e-9 (complex input)', () => {
    const n = 64
    const rng = mulberry32(7)
    const xr = new Float64Array(n)
    const xi = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      xr[i] = rng() * 2 - 1
      xi[i] = rng() * 2 - 1
    }
    const re = Float64Array.from(xr)
    const im = Float64Array.from(xi)
    fft(re, im)
    for (let k = 0; k < n; k++) {
      let sr = 0
      let si = 0
      for (let t = 0; t < n; t++) {
        const ang = (-2 * Math.PI * k * t) / n
        const c = Math.cos(ang)
        const s = Math.sin(ang)
        sr += xr[t]! * c - xi[t]! * s
        si += xr[t]! * s + xi[t]! * c
      }
      expect(Math.abs(re[k]! - sr)).toBeLessThan(1e-9)
      expect(Math.abs(im[k]! - si)).toBeLessThan(1e-9)
    }
  })

  it('rejects non-power-of-two sizes and mismatched arrays', () => {
    expect(() => fft(new Float64Array(48), new Float64Array(48))).toThrow(/power of two/)
    expect(() => fft(new Float64Array(64), new Float64Array(32))).toThrow(/mismatch/)
  })
})

describe('hann', () => {
  it('is a periodic Hann window: w[0]=0, peak 1 at N/2, symmetric', () => {
    const n = 128
    const w = hann(n)
    expect(w.length).toBe(n)
    expect(w[0]).toBeCloseTo(0, 12)
    expect(w[n / 2]).toBeCloseTo(1, 12)
    for (let i = 1; i < n; i++) expect(w[i]).toBeCloseTo(w[n - i]!, 12)
  })

  it('returns the cached instance for repeated calls', () => {
    expect(hann(64)).toBe(hann(64))
  })
})

describe('stft', () => {
  it('produces ceil(len/hop) frames of n/2+1 magnitude bins', () => {
    const samples = new Float32Array(5000)
    const frames = stft(samples, 2048, 512)
    expect(frames.length).toBe(Math.ceil(5000 / 512))
    for (const f of frames) expect(f.length).toBe(1025)
  })

  it('returns no frames for empty input', () => {
    expect(stft(new Float32Array(0))).toEqual([])
  })

  it('localizes a sine at its bin in interior frames (last frame zero-padded, finite)', () => {
    const sr = 44100
    const n = 2048
    const hop = 512
    const k = 40 // bin-center frequency
    const freq = (k * sr) / n
    const samples = new Float32Array(sr) // 1 s
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * freq * i) / sr)
    }
    const frames = stft(samples, n, hop)
    // Interior frame: peak bin is k.
    const f = frames[10]!
    let peak = 0
    for (let j = 1; j < f.length; j++) if (f[j]! > f[peak]!) peak = j
    expect(peak).toBe(k)
    // Final (zero-padded) frame is finite everywhere.
    const last = frames[frames.length - 1]!
    for (let j = 0; j < last.length; j++) expect(Number.isFinite(last[j]!)).toBe(true)
  })
})
