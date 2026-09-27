/**
 * audio/mixBus.ts — the master bus every audition source feeds.
 *
 *   source ──▶ bus.dry ─────────────────┐
 *     │                                 ▼
 *     └─(send gain)─▶ reverb.input ─▶ wet ─▶ limiter ─▶ destination
 *
 * The limiter is a DynamicsCompressorNode set as a gentle brick wall
 * (threshold −6 dBFS, high ratio, fast attack) so a salute's crack plus a
 * stereo bed plus the score cannot clip, while ordinary levels pass
 * untouched. Level mapping: beamMath.monitorGain anchors 66 dB at the seat
 * to 0.25 linear; reportGain shares the anchor and compresses 4:1 above it
 * (a salute at the lawn ≈ 1.0); the score synth keeps its own per-program
 * gains (0.14–0.3) under its own musical compressor.
 *
 * One MixBus per AudioContext (app level); sessions attach and detach their
 * sources — the bus itself persists across show switches.
 */
import { Reverb } from './reverb.js'

/** Limiter threshold, dBFS. */
export const MASTER_LIMIT_THRESHOLD_DB = -6
/** Limiter ratio — high enough to read as a ceiling, low enough to stay soft. */
export const MASTER_LIMIT_RATIO = 12
/** Limiter knee, dB. */
export const MASTER_LIMIT_KNEE_DB = 6
/** Limiter attack / release, seconds. */
export const MASTER_LIMIT_ATTACK_SEC = 0.003
export const MASTER_LIMIT_RELEASE_SEC = 0.15
/** Default reverb send level for beams and reports. */
export const DEFAULT_REVERB_SEND = 0.5
/** Score synth reverb send (lower: the music is already mixed). */
export const SCORE_REVERB_SEND = 0.18

export class MixBus {
  readonly ctx: BaseAudioContext
  /** Dry input — connect sources here. */
  readonly dry: GainNode
  /** The shared lakeside reverb (connect a per-source send GainNode to reverb.input). */
  readonly reverb: Reverb
  private readonly limiter: DynamicsCompressorNode

  constructor(ctx: BaseAudioContext, destination: AudioNode = ctx.destination) {
    this.ctx = ctx
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = MASTER_LIMIT_THRESHOLD_DB
    this.limiter.ratio.value = MASTER_LIMIT_RATIO
    this.limiter.knee.value = MASTER_LIMIT_KNEE_DB
    this.limiter.attack.value = MASTER_LIMIT_ATTACK_SEC
    this.limiter.release.value = MASTER_LIMIT_RELEASE_SEC
    this.limiter.connect(destination)
    this.dry = ctx.createGain()
    this.dry.gain.value = 1
    this.dry.connect(this.limiter)
    this.reverb = new Reverb(ctx, this.limiter)
  }

  /** A fresh send GainNode into the reverb at `level` (callers connect their source to it). */
  makeSend(level: number = DEFAULT_REVERB_SEND): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = level
    g.connect(this.reverb.input)
    return g
  }

  dispose(): void {
    this.reverb.dispose()
    this.dry.disconnect()
    this.limiter.disconnect()
  }
}
