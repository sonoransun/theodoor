import { describe, expect, it } from 'vitest'
import { decodeWav } from '../src/music/analysis/wav.js'
import { buildWav } from './analysis-helpers.js'

/** Zero-mean test signal so DC removal is a no-op (values are exact in 16-bit). */
function zeroMeanSignal(n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = ((i % 7) - 3) / 8 // -0.375..0.375 in 1/8 steps, zero mean over 7
    out[i] = v
  }
  // Force exact zero mean by mirroring the second half.
  const m = n >> 1
  for (let i = 0; i < m; i++) out[n - 1 - i] = -out[i]!
  if (n % 2 === 1) out[m] = 0
  return out
}

describe('decodeWav', () => {
  it('decodes 16-bit mono PCM within 1 LSB', () => {
    const src = zeroMeanSignal(64)
    const wav = buildWav({ sampleRate: 44100, channels: [src], encoding: 'pcm16' })
    const { samples, sampleRate, warnings } = decodeWav(wav)
    expect(sampleRate).toBe(44100)
    expect(warnings).toEqual([])
    expect(samples.length).toBe(64)
    for (let i = 0; i < src.length; i++) {
      expect(Math.abs(samples[i]! - src[i]!)).toBeLessThanOrEqual(1 / 32768)
    }
  })

  it('decodes 24-bit PCM within 1 LSB, including negative values (sign extension)', () => {
    const src = new Float32Array([0.5, -0.5, 0.25, -0.25, 0.75, -0.75, 0.999, -0.999])
    const wav = buildWav({ sampleRate: 48000, channels: [src], encoding: 'pcm24' })
    const { samples, sampleRate } = decodeWav(wav)
    expect(sampleRate).toBe(48000)
    for (let i = 0; i < src.length; i++) {
      expect(Math.abs(samples[i]! - src[i]!)).toBeLessThanOrEqual(1 / 8388608)
    }
  })

  it('decodes float32 exactly', () => {
    const src = new Float32Array([0.123456, -0.123456, 0.998877, -0.998877])
    const wav = buildWav({ sampleRate: 22050, channels: [src], encoding: 'float32' })
    const { samples } = decodeWav(wav)
    for (let i = 0; i < src.length; i++) {
      expect(samples[i]).toBeCloseTo(src[i]!, 7)
    }
  })

  it('mixes stereo down to the channel mean', () => {
    const n = 32
    const left = new Float32Array(n)
    const right = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      left[i] = i % 2 === 0 ? 0.4 : -0.4
      right[i] = i % 2 === 0 ? 0.2 : -0.2
    }
    const wav = buildWav({ sampleRate: 44100, channels: [left, right], encoding: 'pcm16' })
    const { samples } = decodeWav(wav)
    for (let i = 0; i < n; i++) {
      expect(samples[i]).toBeCloseTo(i % 2 === 0 ? 0.3 : -0.3, 4)
    }
  })

  it('removes the DC mean', () => {
    const n = 1000
    const src = new Float32Array(n)
    for (let i = 0; i < n; i++) src[i] = 0.25 + 0.1 * Math.sin((2 * Math.PI * i) / 50)
    const wav = buildWav({ sampleRate: 44100, channels: [src], encoding: 'float32' })
    const { samples } = decodeWav(wav)
    let mean = 0
    for (let i = 0; i < n; i++) mean += samples[i]!
    mean /= n
    expect(Math.abs(mean)).toBeLessThan(1e-6)
  })

  it('skips unknown chunks and honors the pad byte on odd sizes', () => {
    const src = zeroMeanSignal(16)
    const wav = buildWav({
      sampleRate: 44100,
      channels: [src],
      encoding: 'pcm16',
      preChunks: [
        { id: 'JUNK', body: new Uint8Array([1, 2, 3]) }, // odd size -> pad byte
        { id: 'LIST', body: new Uint8Array([9, 9, 9, 9]) },
      ],
    })
    const { samples } = decodeWav(wav)
    expect(samples.length).toBe(16)
    for (let i = 0; i < src.length; i++) {
      expect(Math.abs(samples[i]! - src[i]!)).toBeLessThanOrEqual(1 / 32768)
    }
  })

  it('reads WAVE_FORMAT_EXTENSIBLE via the subformat GUID (PCM and float)', () => {
    const src = zeroMeanSignal(24)
    for (const encoding of ['pcm16', 'float32'] as const) {
      const wav = buildWav({ sampleRate: 44100, channels: [src], encoding, extensible: true })
      const { samples } = decodeWav(wav)
      expect(samples.length).toBe(24)
      for (let i = 0; i < src.length; i++) {
        expect(Math.abs(samples[i]! - src[i]!)).toBeLessThanOrEqual(1 / 32768)
      }
    }
  })

  it('clamps a truncated data chunk and warns', () => {
    const src = zeroMeanSignal(100)
    const wav = buildWav({
      sampleRate: 44100,
      channels: [src],
      encoding: 'pcm16',
      dropTailBytes: 10, // 200 declared bytes, 190 available -> 95 frames
    })
    const { samples, warnings } = decodeWav(wav)
    expect(samples.length).toBe(95)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/truncated/)
  })

  it('rejects 8-bit PCM with a clear error', () => {
    const src = zeroMeanSignal(8)
    const wav = buildWav({
      sampleRate: 44100,
      channels: [src],
      encoding: 'pcm16',
      bitsOverride: 8,
    })
    expect(() => decodeWav(wav)).toThrow(/8-bit/)
  })

  it('rejects compressed formats with a clear error', () => {
    const src = zeroMeanSignal(8)
    const wav = buildWav({
      sampleRate: 44100,
      channels: [src],
      encoding: 'pcm16',
      formatCodeOverride: 2, // ADPCM container code — content is still plain bytes
    })
    expect(() => decodeWav(wav)).toThrow(/unsupported/)
  })

  it('rejects non-RIFF and non-WAVE bytes', () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3]))).toThrow(/RIFF|too short/)
    const junk = new Uint8Array(64)
    junk.set([0x52, 0x49, 0x46, 0x46], 0) // 'RIFF' but not WAVE
    expect(() => decodeWav(junk)).toThrow(/WAVE/)
  })

  it('throws when fmt or data chunks are missing', () => {
    const src = zeroMeanSignal(8)
    const ok = buildWav({ sampleRate: 44100, channels: [src], encoding: 'pcm16' })
    // Corrupt the fmt id so the walk never finds it.
    const noFmt = ok.slice()
    noFmt[12] = 'X'.charCodeAt(0)
    expect(() => decodeWav(noFmt)).toThrow(/fmt/)
    // Corrupt the data id.
    const noData = ok.slice()
    const dataOff = 12 + 8 + 16
    noData[dataOff] = 'X'.charCodeAt(0)
    expect(() => decodeWav(noData)).toThrow(/data/)
  })
})
