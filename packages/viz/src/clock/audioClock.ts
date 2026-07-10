/**
 * clock/audioClock.ts — the HOST DRIVER for the core Transport.
 *
 * ONE-TRANSPORT RULE: the core Transport is the single source of truth for
 * show time, state, and rate. This class never keeps its own show time — it
 * only (a) feeds the transport wall-clock dt from the best available master
 * clock (AudioContext.currentTime when audio is up, performance.now()/1000
 * otherwise) via a rAF pump, and (b) mediates browser-only concerns:
 * ctx.resume() on play (autoplay policy) and flush notifications so the
 * synth/WAV player can stop scheduled nodes on pause/seek/rate/stop.
 *
 * Tab throttling: rAF stops but the master clock does not; the first pump
 * after resume passes the full elapsed dt, so the transport snaps to true
 * time with no catch-up loop.
 *
 * All time math is in the exported pure functions (computeHostDt,
 * showToCtxTime, anchorFrom) so tests drive them — and the class, via the
 * injectable { now, raf } — without an AudioContext or a real rAF.
 */

import type { Transport } from '@theodoor/core'

export type FlushReason = 'seek' | 'pause' | 'rate' | 'stop'

/** The subset of core Transport the clock needs (structural, test-friendly). */
export interface TransportLike {
  readonly timeSec: number
  readonly rate: number
  readonly state: 'playing' | 'paused' | 'stopped'
  play(): void
  pause(): void
  stop(): void
  seek(t: number): void
  setRate(r: number): void
  advance(hostDtSec: number): void
}

/**
 * (show ↔ host clock) anchor pair captured at one instant. ctxSec is the
 * master-clock reading at which show time was showSec.
 */
export interface SynthAnchor {
  showSec: number
  ctxSec: number
  rate: number
  playing: boolean
}

/** Host dt for one pump step: 0 on the first step or when the clock stalls. */
export function computeHostDt(nowSec: number, lastNowSec: number | null): number {
  if (lastNowSec === null) return 0
  const dt = nowSec - lastNowSec
  return dt > 0 ? dt : 0
}

/** Map a show-time instant to master-clock time through an anchor. */
export function showToCtxTime(showSec: number, anchor: SynthAnchor): number {
  return anchor.ctxSec + (showSec - anchor.showSec) / anchor.rate
}

/** Build an anchor from a transport snapshot + a master-clock reading. */
export function anchorFrom(
  t: Pick<TransportLike, 'timeSec' | 'rate' | 'state'>,
  ctxSec: number,
): SynthAnchor {
  return {
    showSec: t.timeSec,
    ctxSec,
    rate: t.rate,
    playing: t.state === 'playing',
  }
}

export interface AudioClockOptions {
  /** Injected master clock (seconds) — overrides AudioContext/performance. */
  now?: () => number
  /** rAF scheduler; default window.requestAnimationFrame. */
  raf?: (cb: () => void) => number
  /** Cancel for `raf`; default window.cancelAnimationFrame. */
  caf?: (id: number) => void
  /**
   * AudioContext factory; default `new AudioContext()` when available.
   * Return null to force the silent performance.now() fallback.
   */
  createContext?: () => AudioContext | null
}

function defaultCreateContext(): AudioContext | null {
  try {
    if (typeof AudioContext !== 'undefined') return new AudioContext()
  } catch {
    /* fall through to the silent clock */
  }
  return null
}

export class AudioClock {
  /** null → silent fallback clock (performance.now()/1000). */
  readonly ctx: AudioContext | null

  private readonly nowFn: (() => number) | undefined
  private readonly raf: (cb: () => void) => number
  private readonly caf: (id: number) => void
  private readonly flushListeners: ((reason: FlushReason) => void)[] = []

  private boundTransport: TransportLike | null = null
  private lastNow: number | null = null
  private rafId: number | null = null
  private disposed = false

  constructor(opts: AudioClockOptions = {}) {
    this.nowFn = opts.now
    this.raf =
      opts.raf ??
      ((cb) =>
        typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(() => cb()) : 0)
    this.caf =
      opts.caf ??
      ((id) => {
        if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id)
      })
    this.ctx = (opts.createContext ?? defaultCreateContext)()
  }

  /** Bound transport (null when not driving). */
  get transport(): TransportLike | null {
    return this.boundTransport
  }

  /** Master-clock reading, seconds. */
  now(): number {
    if (this.nowFn) return this.nowFn()
    if (this.ctx) return this.ctx.currentTime
    return performance.now() / 1000
  }

  /**
   * Bind a transport and start the rAF pump (transport.advance(hostDt) once
   * per frame; the transport applies rate itself). Returns an unbind function
   * that stops the pump. Rebinding replaces the previous transport.
   */
  drive(transport: Transport | TransportLike): () => void {
    this.stopPump()
    this.boundTransport = transport
    this.lastNow = null
    const pump = (): void => {
      if (this.disposed || this.boundTransport !== transport) return
      this.tick()
      this.rafId = this.raf(pump)
    }
    this.rafId = this.raf(pump)
    return () => {
      if (this.boundTransport === transport) {
        this.stopPump()
        this.boundTransport = null
      }
    }
  }

  /** One pump step (public so fake-clock tests can drive without rAF). */
  tick(): void {
    const n = this.now()
    const dt = computeHostDt(n, this.lastNow)
    this.lastNow = n
    if (dt > 0) this.boundTransport?.advance(dt)
  }

  /**
   * Anchor for schedulers: show time ↔ master clock at the last pump. Exact
   * because the transport's timeSec was produced from this clock's readings.
   */
  anchor(): SynthAnchor {
    const t = this.boundTransport
    const ctxSec = this.lastNow ?? this.now()
    if (!t) return { showSec: 0, ctxSec, rate: 1, playing: false }
    return anchorFrom(t, ctxSec)
  }

  /** Resume the AudioContext (autoplay gesture) then start the transport. */
  async play(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume()
      } catch {
        /* stay functional (silent) when resume is refused */
      }
    }
    this.boundTransport?.play()
  }

  /** Pause the transport and notify flush listeners. */
  pause(): void {
    this.boundTransport?.pause()
    this.emitFlush('pause')
  }

  /** Stop the transport (rewind to t0) and notify flush listeners. */
  stop(): void {
    this.boundTransport?.stop()
    this.emitFlush('stop')
  }

  /** Seek the transport and notify flush listeners. */
  seek(t: number): void {
    this.boundTransport?.seek(t)
    this.emitFlush('seek')
  }

  /** Set the transport rate and notify flush listeners. */
  setRate(r: number): void {
    this.boundTransport?.setRate(r)
    this.emitFlush('rate')
  }

  /** Subscribe to flush notifications (synth/WAV node teardown). */
  onFlush(fn: (reason: FlushReason) => void): () => void {
    this.flushListeners.push(fn)
    return () => {
      const i = this.flushListeners.indexOf(fn)
      if (i >= 0) this.flushListeners.splice(i, 1)
    }
  }

  /** Stop the pump and drop listeners. The AudioContext is left open. */
  dispose(): void {
    this.disposed = true
    this.stopPump()
    this.boundTransport = null
    this.flushListeners.length = 0
  }

  private stopPump(): void {
    if (this.rafId !== null) {
      this.caf(this.rafId)
      this.rafId = null
    }
    this.lastNow = null
  }

  private emitFlush(reason: FlushReason): void {
    for (const fn of [...this.flushListeners]) fn(reason)
  }
}
