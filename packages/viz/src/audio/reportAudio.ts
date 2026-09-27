/**
 * audio/reportAudio.ts — the REPORT audition: shell breaks, set pieces, and
 * fountain rush heard from the selected seat, each arriving one acoustic
 * time-of-flight after it happens.
 *
 * A Chris-Wilson lookahead scheduler (setInterval REPORT_INTERVAL_MS) walks a
 * precomputed, arrival-sorted ReportEvent table (reportMath.precomputeReports
 * — emit instant + slant / 343 s at the seat, propagated level, air-absorption
 * cutoff, pan) and schedules every event whose arrival lies in
 * (lastScheduled, showSec + lookahead·rate] through the AudioClock anchor,
 * building its graph (reportVoices.buildReport) into the mix bus and the
 * reverb send. An active-node registry makes flush() (pause/seek/rate/stop)
 * silence every sounding graph; stale events behind the playhead are dropped
 * rather than burst-played.
 *
 * Moving the seat (setSeat) re-derives the whole table — delays, levels, and
 * pans are per-event constants for one seat — and resets the cursor to the
 * current show time so nothing already heard replays.
 *
 * What you now hear that the flash alone never told you: a peony's boom
 * ~0.6–0.9 s after its break from the lakeside lawn, the same shell landing
 * WITH its beam-tagged thunder (BeamAudio) once the program "repairs
 * physics", mines whooshing at the racks, water rushing up before the beat
 * and cresting on it.
 */
import type { CompiledShow, EffectDef, Vec2 } from '@theodoor/core'
import type { SynthAnchor } from '../clock/audioClock.js'
import { showToCtxTime } from '../clock/audioClock.js'
import { precomputeReports, reportsInWindow, type ReportEvent } from './reportMath.js'
import { buildReport } from './reportVoices.js'
import type { BuiltVoice } from './voices.js'

/** Scheduling lookahead in show seconds (multiplied by rate at run time). */
export const REPORT_LOOKAHEAD_SEC = 0.25
/** Scheduler pass interval. */
export const REPORT_INTERVAL_MS = 25
/** Events older than this behind the playhead are dropped, not burst-played. */
export const REPORT_STALE_GRACE_SEC = 0.05

export interface ReportAudioOptions {
  /** Dry output (the mix bus); defaults to ctx.destination. */
  out?: AudioNode
  /** Reverb send input (MixBus.reverb.input); null disables the send. */
  reverbSend?: AudioNode | null
}

export class ReportAudio {
  private readonly ctx: AudioContext
  private readonly compiled: CompiledShow
  private readonly getEffect: (id: string) => EffectDef | undefined
  private readonly anchorSource: () => SynthAnchor
  private readonly out: AudioNode
  private readonly reverbSend: AudioNode | null
  private readonly active: BuiltVoice[] = []
  private events: ReportEvent[] = []
  private seat: Vec2 | null = null
  private lastScheduled: number
  private intervalId: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(
    ctx: AudioContext,
    compiled: CompiledShow,
    getEffect: (id: string) => EffectDef | undefined,
    anchorSource: () => SynthAnchor,
    opts: ReportAudioOptions = {},
  ) {
    this.ctx = ctx
    this.compiled = compiled
    this.getEffect = getEffect
    this.anchorSource = anchorSource
    this.out = opts.out ?? ctx.destination
    this.reverbSend = opts.reverbSend ?? null
    this.lastScheduled = anchorSource().showSec - REPORT_STALE_GRACE_SEC
  }

  /** Number of live (not yet reaped) report graphs. */
  get activeCount(): number {
    return this.active.length
  }

  /** The current arrival-sorted event table (empty without a seat). */
  get table(): readonly ReportEvent[] {
    return this.events
  }

  /**
   * Move the audition seat (null mutes: no seat, no table). Re-derives the
   * event table and FLUSHES: graphs already scheduled for the old seat are
   * stopped (their delays/pans belong to the old seat) and the cursor resets
   * to now, so a report inside the lookahead window is never built twice.
   */
  setSeat(seat: Vec2 | null): void {
    this.seat = seat
    this.events = seat ? precomputeReports(this.compiled, this.getEffect, seat) : []
    this.flush()
  }

  /** Begin the scheduler loop. Idempotent. */
  start(): void {
    if (this.intervalId !== null || this.disposed) return
    this.intervalId = setInterval(() => this.scheduleTick(), REPORT_INTERVAL_MS)
  }

  /** One scheduler pass (public so hosts/tests can drive manually). */
  scheduleTick(): void {
    if (this.disposed) return
    const a = this.anchorSource()
    this.reap()
    if (!a.playing || !this.seat) return
    const horizon = a.showSec + REPORT_LOOKAHEAD_SEC * a.rate
    const from = Math.max(this.lastScheduled, a.showSec - REPORT_STALE_GRACE_SEC)
    const due = reportsInWindow(this.events, from, horizon)
    const ctxNow = this.ctx.currentTime
    for (const ev of due) {
      if (!(ev.gain > 0)) continue
      const at = Math.max(showToCtxTime(ev.arrivalSec, a), ctxNow)
      this.active.push(buildReport(this.ctx, ev, at, ev.durSec / a.rate, this.out, this.reverbSend))
    }
    if (horizon > this.lastScheduled) this.lastScheduled = horizon
  }

  /** Stop every sounding graph NOW and reset the cursor (pause/seek/rate). */
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
    this.lastScheduled = this.anchorSource().showSec - REPORT_STALE_GRACE_SEC
  }

  /** Stop the loop and flush every graph. */
  dispose(): void {
    if (this.disposed) return
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.flush()
    this.disposed = true
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
