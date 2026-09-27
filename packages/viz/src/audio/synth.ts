/**
 * audio/synth.ts — Chris-Wilson lookahead scheduler rendering an authored
 * Score through the voice graphs in voices.ts.
 *
 * A setInterval(25 ms) pass schedules every note whose show time lies in
 * (lastScheduled, t + 0.2*rate]; each is converted to context time through
 * the AudioClock anchor (ctxTime = anchorCtx + (noteShow − anchorShow)/rate)
 * and its whole graph is scheduled immediately. An active-node registry
 * makes flush() (on pause/seek/rate-change/teardown) stop every sounding
 * graph — without it, orphaned oscillators drone forever.
 *
 * Note times are PRECOMPUTED once per score: [tStartSec, tDurSec, midi,
 * velocity, program] via the score's tempo map (tempoMapsFrom). The window
 * selection is a pure exported function (nextNotesInWindow) so tests cover
 * the exactly-once/only-in-horizon behavior headlessly.
 */

import { tempoMapsFrom } from '@theodoor/core'
import type { Score, VoiceProgram } from '@theodoor/core'
import type { SynthAnchor } from '../clock/audioClock.js'
import { showToCtxTime } from '../clock/audioClock.js'
import { buildVoice } from './voices.js'
import type { BuiltVoice } from './voices.js'

/** One precomputed, schedulable note (show-time seconds). */
export interface SynthNote {
  tStartSec: number
  tDurSec: number
  midi: number
  velocity: number
  program: VoiceProgram
}

/** Scheduling lookahead in show seconds (multiplied by rate at run time). */
export const SYNTH_LOOKAHEAD_SEC = 0.2
/** Scheduler pass interval. */
export const SYNTH_INTERVAL_MS = 25
/** Notes older than this behind the playhead are dropped, not burst-played. */
export const STALE_NOTE_GRACE_SEC = 0.05

/**
 * Precompute schedulable notes from a score, sorted by tStartSec (stable on
 * ties). Pure and deterministic.
 */
export function precomputeNotes(score: Score): SynthNote[] {
  const { tempo } = tempoMapsFrom(score.tempo)
  const out: SynthNote[] = score.notes.map((n) => {
    const t0 = tempo.beatToSec(n.startBeat)
    const t1 = tempo.beatToSec(n.startBeat + n.durBeats)
    return {
      tStartSec: t0,
      tDurSec: Math.max(0, t1 - t0),
      midi: n.midi,
      velocity: n.velocity,
      program: score.voices[n.voice]?.program ?? 'lead',
    }
  })
  out.sort((a, b) => a.tStartSec - b.tStartSec || a.midi - b.midi)
  return out
}

/**
 * All notes with tStartSec in the half-open window (fromSec, toSec].
 * `notesSorted` must be sorted by tStartSec ascending. Pure; O(log n + k).
 */
export function nextNotesInWindow(
  notesSorted: readonly SynthNote[],
  fromSec: number,
  toSec: number,
): SynthNote[] {
  if (!(toSec > fromSec)) return []
  // Binary search: first index with tStartSec > fromSec.
  let lo = 0
  let hi = notesSorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (notesSorted[mid]!.tStartSec <= fromSec) lo = mid + 1
    else hi = mid
  }
  const out: SynthNote[] = []
  for (let i = lo; i < notesSorted.length && notesSorted[i]!.tStartSec <= toSec; i++) {
    out.push(notesSorted[i]!)
  }
  return out
}

/** Per-program mix levels into the master compressor. */
export const PROGRAM_GAIN: Record<VoiceProgram, number> = {
  lead: 0.2,
  brass: 0.18,
  bass: 0.24,
  bells: 0.14,
  perc: 0.3,
}

const PROGRAMS: readonly VoiceProgram[] = ['lead', 'brass', 'bass', 'bells', 'perc']

export interface ScoreSynthOptions {
  /** Output for the musical compressor (the mix bus); defaults to ctx.destination. */
  out?: AudioNode
  /** Reverb send input (MixBus.reverb.input) at `sendLevel`; omitted → no send. */
  reverbSend?: AudioNode | null
  sendLevel?: number
}

/** Default score reverb send (the music is already mixed; keep the lawn subtle). */
export const SCORE_SEND_LEVEL = 0.18

/**
 * Score synthesizer. `anchorSource` is AudioClock.anchor (bound) — the show
 * time ↔ context time mapping owned by the host driver.
 */
export class ScoreSynth {
  private readonly ctx: AudioContext
  private readonly notes: readonly SynthNote[]
  private readonly anchorSource: () => SynthAnchor
  private readonly programGains: Map<VoiceProgram, GainNode> = new Map()
  private readonly compressor: DynamicsCompressorNode
  private readonly send: GainNode | null
  private readonly active: BuiltVoice[] = []
  private lastScheduled: number
  private intervalId: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(
    ctx: AudioContext,
    score: Score,
    anchorSource: () => SynthAnchor,
    opts: ScoreSynthOptions = {},
  ) {
    this.ctx = ctx
    this.notes = precomputeNotes(score)
    this.anchorSource = anchorSource
    this.lastScheduled = anchorSource().showSec - STALE_NOTE_GRACE_SEC

    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -18
    this.compressor.knee.value = 24
    this.compressor.ratio.value = 6
    this.compressor.connect(opts.out ?? ctx.destination)
    if (opts.reverbSend) {
      this.send = ctx.createGain()
      this.send.gain.value = opts.sendLevel ?? SCORE_SEND_LEVEL
      this.compressor.connect(this.send)
      this.send.connect(opts.reverbSend)
    } else {
      this.send = null
    }
    for (const p of PROGRAMS) {
      const g = ctx.createGain()
      g.gain.value = PROGRAM_GAIN[p]
      g.connect(this.compressor)
      this.programGains.set(p, g)
    }
  }

  /** Number of live (not yet reaped) voice graphs. */
  get activeCount(): number {
    return this.active.length
  }

  /** Begin the 25 ms scheduler loop. Idempotent. */
  start(): void {
    if (this.intervalId !== null || this.disposed) return
    this.intervalId = setInterval(() => this.scheduleTick(), SYNTH_INTERVAL_MS)
  }

  /** One scheduler pass (public so hosts/tests can drive manually). */
  scheduleTick(): void {
    if (this.disposed) return
    const a = this.anchorSource()
    this.reap()
    if (!a.playing) return
    const horizon = a.showSec + SYNTH_LOOKAHEAD_SEC * a.rate
    // Never schedule stale notes (big rAF gaps, resumed tabs): the window
    // floor tracks the playhead minus a small grace.
    const from = Math.max(this.lastScheduled, a.showSec - STALE_NOTE_GRACE_SEC)
    const due = nextNotesInWindow(this.notes, from, horizon)
    const ctxNow = this.ctx.currentTime
    for (const n of due) {
      const at = Math.max(showToCtxTime(n.tStartSec, a), ctxNow)
      const dest = this.programGains.get(n.program)!
      this.active.push(
        buildVoice(this.ctx, n.program, {
          midi: n.midi,
          velocity: n.velocity,
          tStart: at,
          tDur: n.tDurSec / a.rate,
        }, dest),
      )
    }
    if (horizon > this.lastScheduled) this.lastScheduled = horizon
  }

  /**
   * Stop every active voice NOW and reset the scheduling cursor to the
   * current show time. Call on pause/seek/rate-change.
   */
  flush(): void {
    for (const v of this.active) {
      for (const node of v.nodes) {
        const src = node as Partial<AudioScheduledSourceNode>
        if (typeof src.stop === 'function') {
          try {
            src.stop()
          } catch {
            /* not started / already stopped */
          }
        }
        node.disconnect()
      }
    }
    this.active.length = 0
    this.lastScheduled = this.anchorSource().showSec - STALE_NOTE_GRACE_SEC
  }

  /** Stop the loop, flush voices, and disconnect the mix bus. */
  dispose(): void {
    if (this.disposed) return
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.flush()
    this.disposed = true
    for (const g of this.programGains.values()) g.disconnect()
    this.compressor.disconnect()
    this.send?.disconnect()
  }

  /** Drop finished graphs from the registry. */
  private reap(): void {
    const now = this.ctx.currentTime
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i]!.stopAt < now) {
        for (const node of this.active[i]!.nodes) node.disconnect()
        this.active.splice(i, 1)
      }
    }
  }
}
