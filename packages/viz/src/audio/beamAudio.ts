/**
 * audio/beamAudio.ts — the "sit here" beam audition: a per-active-beam-cue
 * Web Audio chain that renders what a listener seated at the selected crowd
 * cell would hear from the directional arrays.
 *
 * Chain per active cue (keyed by BeamState.cueIdx):
 *   seeded looping noise source (audio/voices.noiseBuffer)
 *     → BiquadFilter (bandpass, fc = 300·2^(3u) Hz seeded per cue, Q ≈ 2 —
 *       a speech-band murmur stand-in for the program content)
 *     → GainNode   (monitor gain from the audible level at the seat)
 *     → DelayNode  (slant time-of-flight + stereo-pair extraDelayMs — the
 *       physical arrival delay, so crossed pairs image through genuinely
 *       different delays with no special-casing)
 *     → StereoPannerNode (pan = sin(array azimuth from the seat; the seat
 *       faces the stage, world +y))
 *     → shared master gain → destination.
 *
 * All level/delay/pan math lives in audio/beamMath.ts (pure, tested); this
 * class only owns node lifecycle. Params are smoothed with setTargetAtTime
 * to avoid zipper noise. Lifecycle:
 *
 *   - Chains are created as cues enter the active set. When a cue leaves,
 *     the chain is RELEASED, not cut: its gain ramps to 0 with the usual
 *     smoothing, the source is scheduled to stop after chainReleaseSec
 *     (~8·tau decay plus the delay line draining), and the nodes are
 *     disconnected once that horizon elapses (onended, plus a time check in
 *     update() so long seek gaps still reap). This keeps cue ends click-free.
 *   - When the transport is not playing every chain's gain targets 0 (the
 *     loops keep running silently — resume is click-free).
 *   - Hidden tabs keep rendering audio while rAF (hence update()) halts, so
 *     a visibilitychange listener ramps every gain to 0 on hide; the normal
 *     rAF reconcile restores gains on foreground. Guarded for DOM-less
 *     environments and removed on dispose().
 *   - dispose() (session switch) hard-stops everything immediately — that
 *     teardown may click, which is acceptable when tearing the session down.
 */
import type { BeamState, CompiledCue, Vec2 } from '@theodoor/core'
import {
  MAX_BEAM_DELAY_SEC,
  monitorGain,
  murmurFcHz,
  seatDelaySec,
  seatLevelDb,
  seatPan,
} from './beamMath.js'
import { noiseBuffer } from './voices.js'

/** setTargetAtTime time constant for gain/pan/delay smoothing, seconds. */
export const BEAM_SMOOTH_TAU_SEC = 0.05
/** Murmur band-pass Q. */
export const MURMUR_Q = 2
/**
 * Multiples of BEAM_SMOOTH_TAU_SEC after which a released gain is effectively
 * silent (e^-8 ≈ 0.00034, about −70 dB below the pre-release level).
 */
export const BEAM_RELEASE_TAU_MULTIPLE = 8

/**
 * Release horizon for a chain whose cue just left the active set, seconds:
 * how long after the gain starts ramping to 0 the looping source may be
 * hard-stopped without a click — the setTargetAtTime decay (8·tau) plus the
 * delay line draining the already-audible samples still in flight.
 */
export function chainReleaseSec(delayTimeSec: number): number {
  return BEAM_RELEASE_TAU_MULTIPLE * BEAM_SMOOTH_TAU_SEC + Math.max(0, delayTimeSec)
}

/**
 * The gain a chain targets this frame: the seat monitor gain only when the
 * transport is playing, a seat is selected (seatDb non-null), and the
 * document is visible. Hidden always mutes — background tabs keep rendering
 * audio while rAF halts, so an audible gain would drone on unreconciled.
 */
export function chainGainTarget(
  playing: boolean,
  hidden: boolean,
  seatDb: number | null,
): number {
  return playing && !hidden && seatDb !== null ? monitorGain(seatDb) : 0
}

/**
 * Split reaping entries into those whose release horizon has elapsed
 * (nowSec ≥ reapAtSec — due for node teardown) and those still draining.
 * A far-future nowSec (seek far ahead, long rAF gap) reaps everything.
 */
export function partitionReaping<T extends { reapAtSec: number }>(
  entries: readonly T[],
  nowSec: number,
): { due: T[]; keep: T[] } {
  const due: T[] = []
  const keep: T[] = []
  for (const e of entries) (nowSec >= e.reapAtSec ? due : keep).push(e)
  return { due, keep }
}

interface Chain {
  src: AudioBufferSourceNode
  filter: BiquadFilterNode
  gain: GainNode
  delay: DelayNode
  pan: StereoPannerNode
}

interface Reaping {
  chain: Chain
  /** Context time at which the chain's nodes may be torn down. */
  reapAtSec: number
}

/** True when running under a DOM whose document is currently hidden. */
function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true
}

export class BeamAudio {
  private readonly ctx: AudioContext
  private readonly cues: readonly CompiledCue[]
  private readonly master: GainNode
  private readonly chains = new Map<number, Chain>()
  /** Released chains draining toward silence before node teardown. */
  private reaping: Reaping[] = []
  private readonly onVisibility: (() => void) | null
  private seat: Vec2 | null = null
  private disposed = false

  constructor(ctx: AudioContext, cues: readonly CompiledCue[]) {
    this.ctx = ctx
    this.cues = cues
    this.master = ctx.createGain()
    this.master.gain.value = 1
    this.master.connect(ctx.destination)
    // Hidden tabs render audio while rAF halts: mute on hide, and let the
    // first update() after foregrounding restore the correct gains.
    if (typeof document !== 'undefined') {
      this.onVisibility = (): void => {
        if (document.hidden) this.muteAll()
      }
      document.addEventListener('visibilitychange', this.onVisibility)
    } else {
      this.onVisibility = null
    }
  }

  /** Move the audition seat (null mutes everything until a seat is set). */
  setSeat(seat: Vec2 | null): void {
    this.seat = seat
  }

  /** Per-rAF: reconcile chains with the snapshot's active beams. */
  update(beams: readonly BeamState[], playing: boolean): void {
    if (this.disposed) return
    const t = this.ctx.currentTime
    const seat = this.seat
    const hidden = isDocumentHidden()
    const active = new Set<number>()

    for (const b of beams) {
      active.add(b.cueIdx)
      let chain = this.chains.get(b.cueIdx)
      if (!chain) {
        chain = this.makeChain(b, seat)
        this.chains.set(b.cueIdx, chain)
      }
      const target = chainGainTarget(playing, hidden, seat ? seatLevelDb(b, seat) : null)
      chain.gain.gain.setTargetAtTime(target, t, BEAM_SMOOTH_TAU_SEC)
      if (seat) {
        chain.delay.delayTime.setTargetAtTime(seatDelaySec(b, seat), t, BEAM_SMOOTH_TAU_SEC)
        chain.pan.pan.setTargetAtTime(seatPan(b.apex, seat), t, BEAM_SMOOTH_TAU_SEC)
      }
    }

    for (const [cueIdx, chain] of this.chains) {
      if (!active.has(cueIdx)) {
        this.releaseChain(chain, t)
        this.chains.delete(cueIdx)
      }
    }

    this.reap(t)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility)
    // Hard cut — may click, acceptable for session teardown.
    for (const chain of this.chains.values()) teardownChain(chain)
    this.chains.clear()
    for (const r of this.reaping) teardownChain(r.chain)
    this.reaping = []
    this.master.disconnect()
  }

  /** Ramp every chain's gain to 0 (hidden tab); update() restores later. */
  private muteAll(): void {
    if (this.disposed) return
    const t = this.ctx.currentTime
    for (const chain of this.chains.values()) {
      chain.gain.gain.setTargetAtTime(0, t, BEAM_SMOOTH_TAU_SEC)
    }
    // Reaping chains already target 0.
  }

  /**
   * Click-free release for a chain whose cue left the active set: ramp the
   * gain to 0, schedule the source stop at the release horizon, and queue
   * the chain for node teardown (via onended and the reap sweep).
   */
  private releaseChain(chain: Chain, t: number): void {
    chain.gain.gain.setTargetAtTime(0, t, BEAM_SMOOTH_TAU_SEC)
    const reapAtSec = t + chainReleaseSec(chain.delay.delayTime.value)
    try {
      chain.src.stop(reapAtSec)
    } catch {
      /* already stopped */
    }
    chain.src.onended = (): void => disconnectChain(chain)
    this.reaping.push({ chain, reapAtSec })
  }

  /** Tear down released chains whose horizon has elapsed (idempotent). */
  private reap(nowSec: number): void {
    if (this.reaping.length === 0) return
    const { due, keep } = partitionReaping(this.reaping, nowSec)
    if (due.length === 0) return
    for (const r of due) teardownChain(r.chain)
    this.reaping = keep
  }

  /** Build + start one cue's chain (gain starts at 0 and fades in). */
  private makeChain(beam: BeamState, seat: Vec2 | null): Chain {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx)
    src.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = murmurFcHz(this.cues[beam.cueIdx]?.seed ?? 0)
    filter.Q.value = MURMUR_Q

    const gain = ctx.createGain()
    gain.gain.value = 0

    const delay = ctx.createDelay(MAX_BEAM_DELAY_SEC)
    const pan = ctx.createStereoPanner()
    if (seat) {
      delay.delayTime.value = seatDelaySec(beam, seat)
      pan.pan.value = seatPan(beam.apex, seat)
    }

    src.connect(filter)
    filter.connect(gain)
    gain.connect(delay)
    delay.connect(pan)
    pan.connect(this.master)
    src.start()
    return { src, filter, gain, delay, pan }
  }
}

/** Immediate stop + disconnect. May click — teardown paths only. */
function teardownChain(chain: Chain): void {
  chain.src.onended = null
  try {
    chain.src.stop()
  } catch {
    /* never started or already stopped */
  }
  disconnectChain(chain)
}

/** Detach every node of a chain from the graph (safe to call twice). */
function disconnectChain(chain: Chain): void {
  chain.src.disconnect()
  chain.filter.disconnect()
  chain.gain.disconnect()
  chain.delay.disconnect()
  chain.pan.disconnect()
}
