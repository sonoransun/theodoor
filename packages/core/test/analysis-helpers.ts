/**
 * Shared fixtures for the analysis-* tests: in-memory WAV byte synthesis and
 * deterministic click-track generators. No fixtures ever touch disk.
 */

import { mulberry32 } from '../src/math/rng.js'

export type WavEncoding = 'pcm16' | 'pcm24' | 'float32'

export interface WavBuildOptions {
  sampleRate: number
  /** One Float32Array per channel; all must share a length. */
  channels: readonly Float32Array[]
  encoding: WavEncoding
  /** Wrap fmt in a WAVE_FORMAT_EXTENSIBLE (0xFFFE) header. */
  extensible?: boolean
  /** Extra chunks inserted before fmt (odd-sized bodies test pad bytes). */
  preChunks?: readonly { id: string; body: Uint8Array }[]
  /** Override the declared data-chunk size (truncation tests). */
  declaredDataBytes?: number
  /** Drop this many bytes from the end of the finished file. */
  dropTailBytes?: number
  /** Override the fmt format code (reject tests). */
  formatCodeOverride?: number
  /** Override bits per sample (reject tests). */
  bitsOverride?: number
}

const ENCODING_BITS: Record<WavEncoding, number> = { pcm16: 16, pcm24: 24, float32: 32 }
const ENCODING_CODE: Record<WavEncoding, number> = { pcm16: 1, pcm24: 1, float32: 3 }

/** Synthesize RIFF/WAVE bytes entirely in memory. */
export function buildWav(opts: WavBuildOptions): Uint8Array {
  const { channels, sampleRate, encoding } = opts
  const numCh = channels.length
  const frames = numCh > 0 ? channels[0]!.length : 0
  for (const ch of channels) {
    if (ch.length !== frames) throw new Error('buildWav: channel length mismatch')
  }
  const bits = opts.bitsOverride ?? ENCODING_BITS[encoding]
  const realCode = opts.formatCodeOverride ?? ENCODING_CODE[encoding]
  const bytesPerSample = ENCODING_BITS[encoding] >> 3
  const blockAlign = bytesPerSample * numCh
  const dataBytes = frames * blockAlign
  const fmtBody = opts.extensible ? 40 : 16

  let size = 12 // RIFF + size + WAVE
  for (const c of opts.preChunks ?? []) size += 8 + c.body.length + (c.body.length & 1)
  size += 8 + fmtBody
  size += 8 + dataBytes + (dataBytes & 1)

  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  let off = 0
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes[off++] = s.charCodeAt(i)
  }
  const u16 = (v: number) => {
    view.setUint16(off, v, true)
    off += 2
  }
  const u32 = (v: number) => {
    view.setUint32(off, v, true)
    off += 4
  }

  str('RIFF')
  u32(size - 8)
  str('WAVE')

  for (const c of opts.preChunks ?? []) {
    str(c.id.padEnd(4).slice(0, 4))
    u32(c.body.length)
    bytes.set(c.body, off)
    off += c.body.length + (c.body.length & 1) // word alignment pad
  }

  str('fmt ')
  u32(fmtBody)
  u16(opts.extensible ? 0xfffe : realCode)
  u16(numCh)
  u32(sampleRate)
  u32(sampleRate * blockAlign) // byte rate
  u16(blockAlign)
  u16(bits)
  if (opts.extensible) {
    u16(22) // cbSize
    u16(bits) // valid bits
    u32(0) // channel mask
    u16(realCode) // subformat GUID: first 2 bytes carry the format code
    u16(0x0000)
    u32(0x00100000)
    u32(0xaa000080)
    u32(0x719b3800)
  }

  str('data')
  u32(opts.declaredDataBytes ?? dataBytes)
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numCh; c++) {
      const x = channels[c]![f]!
      if (encoding === 'pcm16') {
        const v = Math.max(-32768, Math.min(32767, Math.round(x * 32768)))
        view.setInt16(off, v, true)
        off += 2
      } else if (encoding === 'pcm24') {
        const v = Math.max(-8388608, Math.min(8388607, Math.round(x * 8388608)))
        bytes[off++] = v & 0xff
        bytes[off++] = (v >> 8) & 0xff
        bytes[off++] = (v >> 16) & 0xff
      } else {
        view.setFloat32(off, x, true)
        off += 4
      }
    }
  }

  const drop = opts.dropTailBytes ?? 0
  return drop > 0 ? bytes.slice(0, bytes.length - drop) : bytes
}

/** Add one decaying noise burst (a "click") starting at time t. */
export function addBurst(
  samples: Float32Array,
  sampleRate: number,
  t: number,
  amp: number,
  rng: () => number,
): void {
  const burstLen = Math.round(0.04 * sampleRate)
  const start = Math.round(t * sampleRate)
  for (let i = 0; i < burstLen && start + i < samples.length; i++) {
    samples[start + i] =
      samples[start + i]! + (rng() * 2 - 1) * Math.exp(-i / (0.008 * sampleRate)) * amp
  }
}

export interface ClickTrackOptions {
  bpm: number
  durationSec: number
  sampleRate: number
  seed?: number
  /** No clicks after this time (silent tail tests). Default: durationSec - 0.3. */
  lastClickSec?: number
  firstClickSec?: number
  /** Per-click amplitude by index (default constant 0.8). */
  amp?: (index: number) => number
}

/** Deterministic click track: decaying noise bursts on the beat grid. */
export function clickTrack(opts: ClickTrackOptions): {
  samples: Float32Array
  clickTimes: number[]
} {
  const { bpm, durationSec, sampleRate } = opts
  const rng = mulberry32(opts.seed ?? 42)
  const samples = new Float32Array(Math.round(durationSec * sampleRate))
  const period = 60 / bpm
  const first = opts.firstClickSec ?? 0.5
  const last = opts.lastClickSec ?? durationSec - 0.3
  const clickTimes: number[] = []
  let index = 0
  for (let t = first; t <= last + 1e-9; t += period, index++) {
    clickTimes.push(t)
    addBurst(samples, sampleRate, t, opts.amp ? opts.amp(index) : 0.8, rng)
  }
  return { samples, clickTimes }
}

/** Distance from t to the nearest element of `times` (Infinity when empty). */
export function nearestDist(times: readonly number[], t: number): number {
  let best = Infinity
  for (const c of times) {
    const d = Math.abs(t - c)
    if (d < best) best = d
  }
  return best
}
