/**
 * audio/reverb.ts — the lakeside room: one shared ConvolverNode fed by a
 * SEEDED synthetic impulse response, on a send/return bus.
 *
 * Outdoors there is no room, but there is a lawn between a treeline and the
 * water: a sparse, fast-decaying diffuse tail (RT60 ≈ REVERB_RT60_SEC, the
 * −60 dB point) plus one discrete slapback — the report bouncing off the
 * treeline REVERB_TREELINE_M behind the lawn and coming back past the seat,
 * a 2·d / c round trip (60 m → 0.35 s). Both channels use independent seeds
 * so the tail is decorrelated (wide) while the slapback stays centered.
 *
 * The IR is a pure function of (sampleRate, opts) built from mulberry32 —
 * no Math.random — so the same page always hears the same lawn. Consumers
 * connect a send GainNode to `input`; the wet return feeds the master bus.
 */
import { SPEED_OF_SOUND_MPS, mulberry32 } from '@theodoor/core'

/** Fixed IR seed (two channels fork from it). */
export const REVERB_SEED = 0x1a4e51de
/** Time for the diffuse tail to fall 60 dB, seconds. */
export const REVERB_RT60_SEC = 1.4
/** Impulse-response length, seconds (the tail is ~ −85 dB by then). */
export const REVERB_IR_SEC = 2.0
/** Distance from the lawn to the treeline behind it, meters. */
export const REVERB_TREELINE_M = 60
/** Slapback gain relative to the direct impulse. */
export const REVERB_SLAPBACK_GAIN = 0.35
/** Slapback smear (a short burst, not a single sample), seconds. */
export const REVERB_SLAPBACK_SMEAR_SEC = 0.006
/** Diffuse-tail level at t = 0 relative to the direct sound. */
export const REVERB_TAIL_GAIN = 0.18
/** Pre-delay before the diffuse tail starts (ground and near reflections), seconds. */
export const REVERB_PREDELAY_SEC = 0.02
/** Default wet return level on the master bus. */
export const REVERB_WET_GAIN = 0.28

/** Slapback round-trip delay: out to the treeline and back, seconds. */
export function slapbackDelaySec(treelineM: number = REVERB_TREELINE_M): number {
  return (2 * treelineM) / SPEED_OF_SOUND_MPS
}

export interface ImpulseOpts {
  rt60Sec?: number
  irSec?: number
  treelineM?: number
  slapbackGain?: number
  tailGain?: number
  seed?: number
}

/**
 * One channel of the impulse response at `sampleRate`: seeded noise decaying
 * as exp(−ln(1000)·t / RT60) after a pre-delay, plus the slapback burst.
 * Deterministic for (sampleRate, opts).
 */
export function impulseResponse(sampleRate: number, opts: ImpulseOpts = {}): Float32Array<ArrayBuffer> {
  const rt60 = opts.rt60Sec ?? REVERB_RT60_SEC
  const irSec = opts.irSec ?? REVERB_IR_SEC
  const n = Math.max(1, Math.round(irSec * sampleRate))
  const out = new Float32Array(n)
  const rng = mulberry32((opts.seed ?? REVERB_SEED) >>> 0)
  const k = Math.log(1000) / rt60 // −60 dB at t = RT60
  const tail = opts.tailGain ?? REVERB_TAIL_GAIN
  const pre = Math.round(REVERB_PREDELAY_SEC * sampleRate)
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / sampleRate
    out[i] = (rng() * 2 - 1) * tail * Math.exp(-k * t)
  }
  // Slapback: a short decorrelated burst centered on the treeline round trip.
  const slapAt = Math.round(slapbackDelaySec(opts.treelineM ?? REVERB_TREELINE_M) * sampleRate)
  const smear = Math.max(1, Math.round(REVERB_SLAPBACK_SMEAR_SEC * sampleRate))
  const slapGain = opts.slapbackGain ?? REVERB_SLAPBACK_GAIN
  for (let j = 0; j < smear && slapAt + j < n; j++) {
    const env = 1 - j / smear
    // The first sample carries the full impulse; the rest is a decaying noise tail.
    out[slapAt + j] += j === 0 ? slapGain : (rng() * 2 - 1) * slapGain * 0.5 * env
  }
  return out
}

/** Left/right channels with forked seeds (decorrelated tails, shared slapback). */
export function stereoImpulseResponse(
  sampleRate: number,
  opts: ImpulseOpts = {},
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const seed = (opts.seed ?? REVERB_SEED) >>> 0
  return [
    impulseResponse(sampleRate, { ...opts, seed }),
    impulseResponse(sampleRate, { ...opts, seed: (seed ^ 0x5bd1e995) >>> 0 }),
  ]
}

/** RMS of a Float32Array slice (test/diagnostic helper). */
export function rms(a: Float32Array, from: number, to: number): number {
  let s = 0
  let n = 0
  for (let i = Math.max(0, from); i < Math.min(a.length, to); i++) {
    s += a[i]! * a[i]!
    n++
  }
  return n > 0 ? Math.sqrt(s / n) : 0
}

/**
 * The shared lakeside reverb: `input` (send) → convolver → wet gain → out.
 * Build one per AudioContext and connect per-source send gains to `input`.
 */
export class Reverb {
  readonly input: GainNode
  private readonly convolver: ConvolverNode
  private readonly wet: GainNode

  constructor(ctx: BaseAudioContext, out: AudioNode, opts: ImpulseOpts & { wetGain?: number } = {}) {
    const [l, r] = stereoImpulseResponse(ctx.sampleRate, opts)
    const buf = ctx.createBuffer(2, l.length, ctx.sampleRate)
    buf.copyToChannel(l, 0)
    buf.copyToChannel(r, 1)
    this.convolver = ctx.createConvolver()
    this.convolver.normalize = false
    this.convolver.buffer = buf
    this.input = ctx.createGain()
    this.input.gain.value = 1
    this.wet = ctx.createGain()
    this.wet.gain.value = opts.wetGain ?? REVERB_WET_GAIN
    this.input.connect(this.convolver)
    this.convolver.connect(this.wet)
    this.wet.connect(out)
  }

  dispose(): void {
    this.input.disconnect()
    this.convolver.disconnect()
    this.wet.disconnect()
  }
}
