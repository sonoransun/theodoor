/**
 * music/analysis/fft.ts — iterative radix-2 Cooley–Tukey FFT with cached
 * bit-reversal tables, twiddle factors, and Hann windows, plus a magnitude
 * STFT. Everything runs on Float64Arrays for numerical headroom.
 */

interface FftPlan {
  rev: Int32Array
  cos: Float64Array
  sin: Float64Array
}

const planCache = new Map<number, FftPlan>()

function planFor(n: number): FftPlan {
  const cached = planCache.get(n)
  if (cached) return cached
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`fft: size must be a power of two >= 2 (got ${n})`)
  }
  const rev = new Int32Array(n)
  for (let i = 1; i < n; i++) {
    rev[i] = (rev[i >> 1]! >> 1) | ((i & 1) !== 0 ? n >> 1 : 0)
  }
  const half = n >> 1
  const cos = new Float64Array(half)
  const sin = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    const ang = (-2 * Math.PI * k) / n
    cos[k] = Math.cos(ang)
    sin[k] = Math.sin(ang)
  }
  const plan: FftPlan = { rev, cos, sin }
  planCache.set(n, plan)
  return plan
}

/**
 * In-place forward FFT (X[k] = Σ x[n]·e^{-2πikn/N}). `re` and `im` must have
 * the same power-of-two length.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (im.length !== n) throw new Error('fft: re/im length mismatch')
  const { rev, cos, sin } = planFor(n)

  for (let i = 0; i < n; i++) {
    const j = rev[i]!
    if (j > i) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const stride = n / len
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const t = k * stride
        const wr = cos[t]!
        const wi = sin[t]!
        const a = start + k
        const b = a + half
        const br = re[b]!
        const bi = im[b]!
        const xr = br * wr - bi * wi
        const xi = br * wi + bi * wr
        re[b] = re[a]! - xr
        im[b] = im[a]! - xi
        re[a] = re[a]! + xr
        im[a] = im[a]! + xi
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>()

/** Periodic Hann window of length n (cached — treat the result as read-only). */
export function hann(n: number): Float64Array {
  const cached = hannCache.get(n)
  if (cached) return cached
  if (n < 1) throw new Error(`hann: window length must be >= 1 (got ${n})`)
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n))
  hannCache.set(n, w)
  return w
}

/** Default STFT frame size used across the analysis pipeline. */
export const STFT_SIZE = 2048
/** Default STFT hop used across the analysis pipeline. */
export const STFT_HOP = 512

/**
 * Short-time Fourier transform: Hann-windowed frames every `hop` samples
 * starting at sample 0 (the final frame is zero-padded). Returns one
 * magnitude spectrum per frame, each of length n/2+1 (bins 0..Nyquist).
 *
 * Frame f covers samples [f*hop, f*hop + n); its center time is
 * (f*hop + n/2) / sampleRate — the time convention onset/energy use.
 */
export function stft(
  samples: Float32Array | Float64Array,
  n: number = STFT_SIZE,
  hop: number = STFT_HOP,
): Float64Array[] {
  if (!(hop > 0) || !Number.isInteger(hop)) throw new Error(`stft: hop must be a positive integer (got ${hop})`)
  planFor(n) // validates n up front
  const w = hann(n)
  const len = samples.length
  const numFrames = len === 0 ? 0 : Math.ceil(len / hop)
  const out: Float64Array[] = []
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const bins = (n >> 1) + 1
  for (let f = 0; f < numFrames; f++) {
    const start = f * hop
    for (let i = 0; i < n; i++) {
      const s = start + i
      re[i] = s < len ? samples[s]! * w[i]! : 0
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float64Array(bins)
    for (let k = 0; k < bins; k++) {
      const r = re[k]!
      const m = im[k]!
      mag[k] = Math.sqrt(r * r + m * m)
    }
    out.push(mag)
  }
  return out
}
