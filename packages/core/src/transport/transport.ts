/**
 * transport.ts — host-driven show transport. Core owns NO clock: hosts call
 * `advance(hostDtSec)` from their own loop (rAF, audio callback, headless
 * for-loop) and show time moves `showDt = hostDt * rate` while playing. No
 * timers, no Date.now() — fully deterministic given the same advance calls.
 *
 * TIME DOMAIN: show time starts at t0 = -(show.preRollSec ?? 0), so cues with
 * negative fireSec (anticipation before the music) fire during pre-roll.
 * `durationSec` is the larger of the music duration and the latest cue
 * tail (targetSec + durationSec); time and seeks clamp to [t0, durationSec].
 *
 * EVENTS (see bus.ts for delivery semantics):
 *   - 'fire'      once per cue per pass, when fireSec enters the lookahead
 *                 horizon (fireSec <= timeSec + lookaheadSec). The event
 *                 carries the cue's exact fireSec — consumers schedule
 *                 precisely against it; only emission batching varies with
 *                 advance chunking, never the sequence.
 *   - 'tick'      after the fires of each advance while playing.
 *   - 'transport' on play/pause/stop state changes.
 *   - 'seek'      on seek (cues at or before the target are NOT re-fired;
 *                 the sim re-simulates from zero — see scheduler.ts).
 *   - 'warning'   published by collaborators via `warn()` (e.g. the sim).
 */

import type { CompiledShow, Seconds } from '../contracts.js'
import { clamp } from '../math/index.js'
import { Bus, type BusEvent, type Listener, type Unsubscribe } from './bus.js'
import { Scheduler } from './scheduler.js'

export type TransportState = 'playing' | 'paused' | 'stopped'

export interface TransportOptions {
  /** How far ahead of show time fire events are emitted. Default 0.25 s. */
  lookaheadSec?: Seconds
}

export const DEFAULT_LOOKAHEAD_SEC: Seconds = 0.25
export const MIN_RATE = 0.1
export const MAX_RATE = 4

/**
 * Show duration: the larger of the music duration and the latest cue tail
 * (targetSec + durationSec).
 */
export function showDurationSec(compiled: CompiledShow): Seconds {
  let d = compiled.show.music.duration
  for (const c of compiled.cues) d = Math.max(d, c.targetSec + c.durationSec)
  return d
}

export class Transport {
  /** Public so collaborators (sim, viz) can publish/subscribe directly. */
  readonly bus = new Bus<BusEvent>()
  /** t0 = -(preRollSec ?? 0); show time never goes below this. */
  readonly startSec: Seconds
  readonly lookaheadSec: Seconds
  readonly durationSec: Seconds

  private readonly scheduler: Scheduler
  private _timeSec: Seconds
  private _state: TransportState = 'stopped'
  private _rate = 1

  constructor(compiled: CompiledShow, opts: TransportOptions = {}) {
    this.lookaheadSec = opts.lookaheadSec ?? DEFAULT_LOOKAHEAD_SEC
    // `0 - x` (not `-x`) so a zero pre-roll yields +0, not -0.
    this.startSec = 0 - (compiled.show.preRollSec ?? 0)
    this.durationSec = showDurationSec(compiled)
    this.scheduler = new Scheduler(compiled.cues)
    this._timeSec = this.startSec
  }

  get timeSec(): Seconds {
    return this._timeSec
  }

  get state(): TransportState {
    return this._state
  }

  get rate(): number {
    return this._rate
  }

  /** Subscribe to the transport bus. Returns unsubscribe. */
  on(fn: Listener<BusEvent>): Unsubscribe {
    return this.bus.on(fn)
  }

  /** Start (or resume) playback. No-op — no event — if already playing. */
  play(): void {
    if (this._state === 'playing') return
    this._state = 'playing'
    this.bus.emit({ type: 'transport', state: 'playing', t: this._timeSec })
  }

  /** Pause playback. No-op unless currently playing. */
  pause(): void {
    if (this._state !== 'playing') return
    this._state = 'paused'
    this.bus.emit({ type: 'transport', state: 'paused', t: this._timeSec })
  }

  /**
   * Stop: reset show time to t0 and rewind the scheduler cursor, so a
   * subsequent play() re-runs the full show (every cue fires again).
   * No-op if already stopped at t0.
   */
  stop(): void {
    if (this._state === 'stopped' && this._timeSec === this.startSec) return
    this._state = 'stopped'
    this._timeSec = this.startSec
    this.scheduler.reset()
    this.bus.emit({ type: 'transport', state: 'stopped', t: this._timeSec })
  }

  /**
   * Jump to t (clamped to [t0, durationSec]) and reposition the scheduler to
   * the first cue with fireSec > t. Emits 'seek'. Cues at or before t do NOT
   * re-fire; consumers re-simulate from zero (see scheduler.ts). Playback
   * state is unchanged.
   */
  seek(t: Seconds): void {
    const clamped = clamp(t, this.startSec, this.durationSec)
    this._timeSec = clamped
    this.scheduler.seek(clamped)
    this.bus.emit({ type: 'seek', t: clamped })
  }

  /** Playback rate, clamped to [0.1, 4]. Never rescales cue fireSec. */
  setRate(r: number): void {
    this._rate = clamp(r, MIN_RATE, MAX_RATE)
  }

  /** Publish a 'warning' event stamped with the current show time. */
  warn(source: string, message: string): void {
    this.bus.emit({ type: 'warning', source, message, t: this._timeSec })
  }

  /**
   * Advance show time by hostDtSec * rate (clamped at durationSec), emit
   * 'fire' for every cue whose fireSec has entered the lookahead horizon —
   * in compiled order — then emit one 'tick'. No-op while paused/stopped.
   */
  advance(hostDtSec: Seconds): void {
    if (this._state !== 'playing') return
    const dtHost = hostDtSec > 0 ? hostDtSec : 0
    const prev = this._timeSec
    const next = Math.min(this.durationSec, prev + dtHost * this._rate)
    this._timeSec = next
    const fires = this.scheduler.collect(next + this.lookaheadSec)
    for (const cue of fires) this.bus.emit({ type: 'fire', cue })
    this.bus.emit({ type: 'tick', t: next, dt: next - prev })
  }
}
