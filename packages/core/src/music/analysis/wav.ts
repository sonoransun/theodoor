/**
 * music/analysis/wav.ts — RIFF/WAVE decoder for the analysis pipeline.
 *
 * Accepts 16-bit and 24-bit integer PCM (format 1), 32-bit IEEE float
 * (format 3), and the extensible container (0xFFFE) wrapping either of the
 * two. Multi-channel audio is mixed down to mono by channel mean and the DC
 * mean is removed. Truncated data chunks clamp with a warning; 8-bit and
 * compressed formats are rejected with a clear error.
 */

export interface DecodedWav {
  /** Mono, DC-free samples nominally in [-1, 1]. */
  samples: Float32Array
  sampleRate: number
  warnings: string[]
}

function fourcc(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!)
}

interface FmtInfo {
  formatCode: number
  channels: number
  sampleRate: number
  bitsPerSample: number
}

export function decodeWav(bytes: Uint8Array): DecodedWav {
  if (bytes.length < 12) throw new Error('decodeWav: not a RIFF/WAVE file (too short)')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (fourcc(bytes, 0) !== 'RIFF') throw new Error('decodeWav: missing RIFF header')
  if (fourcc(bytes, 8) !== 'WAVE') throw new Error('decodeWav: not a WAVE file')

  const warnings: string[] = []
  let fmt: FmtInfo | undefined
  let dataOff = -1
  let dataDeclared = 0
  let dataAvail = 0

  // Chunk walk: chunks are word-aligned, so odd-sized chunks carry one pad
  // byte that is not counted in the declared size.
  let off = 12
  while (off + 8 <= bytes.length) {
    const id = fourcc(bytes, off)
    const size = view.getUint32(off + 4, true)
    const body = off + 8
    const avail = Math.max(0, bytes.length - body)
    const clamped = Math.min(size, avail)

    if (id === 'fmt ') {
      if (clamped < 16) throw new Error('decodeWav: fmt chunk too small')
      let formatCode = view.getUint16(body, true)
      const channels = view.getUint16(body + 2, true)
      const sampleRate = view.getUint32(body + 4, true)
      const bitsPerSample = view.getUint16(body + 14, true)
      if (formatCode === 0xfffe) {
        // WAVE_FORMAT_EXTENSIBLE: the real code is the first 2 bytes of the
        // 16-byte subformat GUID at offset 24 within the chunk body.
        if (clamped < 26) throw new Error('decodeWav: extensible fmt chunk too small')
        formatCode = view.getUint16(body + 24, true)
      }
      fmt = { formatCode, channels, sampleRate, bitsPerSample }
    } else if (id === 'data' && dataOff < 0) {
      dataOff = body
      dataDeclared = size
      dataAvail = clamped
    }

    off = body + size + (size & 1)
  }

  if (!fmt) throw new Error('decodeWav: missing fmt chunk')
  if (dataOff < 0) throw new Error('decodeWav: missing data chunk')
  const { formatCode, channels, sampleRate, bitsPerSample } = fmt
  if (channels < 1) throw new Error('decodeWav: fmt declares zero channels')
  if (!(sampleRate > 0)) throw new Error('decodeWav: fmt declares invalid sample rate')

  if (bitsPerSample === 8) {
    throw new Error('decodeWav: 8-bit PCM is not supported (use 16/24-bit PCM or 32-bit float)')
  }
  const isPcm16 = formatCode === 1 && bitsPerSample === 16
  const isPcm24 = formatCode === 1 && bitsPerSample === 24
  const isFloat32 = formatCode === 3 && bitsPerSample === 32
  if (!isPcm16 && !isPcm24 && !isFloat32) {
    throw new Error(
      `decodeWav: unsupported WAV encoding (format code ${formatCode}, ${bitsPerSample}-bit); ` +
        'only 16/24-bit PCM and 32-bit float are supported (compressed formats are rejected)',
    )
  }

  if (dataDeclared > dataAvail) {
    warnings.push(
      `decodeWav: data chunk truncated (declares ${dataDeclared} bytes, ${dataAvail} available); clamping`,
    )
  }

  const bytesPerSample = bitsPerSample >> 3
  const frameBytes = bytesPerSample * channels
  const frames = Math.floor(Math.min(dataDeclared, dataAvail) / frameBytes)
  const samples = new Float32Array(frames)

  for (let f = 0; f < frames; f++) {
    let acc = 0
    let p = dataOff + f * frameBytes
    for (let c = 0; c < channels; c++, p += bytesPerSample) {
      if (isPcm16) {
        acc += view.getInt16(p, true) / 32768
      } else if (isPcm24) {
        let v = bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16)
        v = (v << 8) >> 8 // sign-extend 24 -> 32 bits
        acc += v / 8388608
      } else {
        acc += view.getFloat32(p, true)
      }
    }
    samples[f] = acc / channels
  }

  // DC removal: subtract the mean so silence and offset recordings analyze
  // identically.
  if (frames > 0) {
    let mean = 0
    for (let i = 0; i < frames; i++) mean += samples[i]!
    mean /= frames
    if (mean !== 0) for (let i = 0; i < frames; i++) samples[i] = samples[i]! - mean
  }

  return { samples, sampleRate, warnings }
}
