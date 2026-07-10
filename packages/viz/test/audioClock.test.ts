/**
 * AudioClock — host-driver time math and transport delegation, driven by a
 * fake master clock (no AudioContext, no rAF).
 */
import { describe, expect, it } from 'vitest'
import { Transport } from '@theodoor/core'
import type { CompiledShow } from '@theodoor/core'
import {
  AudioClock,
  anchorFrom,
  computeHostDt,
  showToCtxTime,
} from '../src/clock/audioClock.js'
import type { FlushReason } from '../src/clock/audioClock.js'

function minimalCompiled(durationSec: number, preRollSec = 0): CompiledShow {
  return {
    show: {
      meta: { id: 't', title: 't', variant: 'standard', seed: 1 },
      music: { duration: durationSec },
      site: { refListenerPos: [] },
      catalogId: 'starter-v1',
      tracks: [],
      preRollSec,
    },
    cues: [],
    diagnostics: [],
  } as unknown as CompiledShow
}

/** Clock harness: fake now + inert rAF (tests pump via clock.tick()). */
function makeClock(): { clock: AudioClock; setNow(t: number): void } {
  let t = 0
  const clock = new AudioClock({
    now: () => t,
    raf: () => 0,
    caf: () => {},
    createContext: () => null,
  })
  return { clock, setNow: (v) => (t = v) }
}

describe('computeHostDt', () => {
  it('returns 0 on the first sample (no lastNow)', () => {
    expect(computeHostDt(12.5, null)).toBe(0)
  })

  it('returns the positive delta', () => {
    expect(computeHostDt(2.5, 1.25)).toBeCloseTo(1.25, 12)
  })

  it('clamps a stalled or backwards clock to 0', () => {
    expect(computeHostDt(1, 1)).toBe(0)
    expect(computeHostDt(0.5, 1)).toBe(0)
  })
})

describe('showToCtxTime / anchorFrom', () => {
  it('maps show time through the anchor at rate 1', () => {
    const a = { showSec: 10, ctxSec: 100, rate: 1, playing: true }
    expect(showToCtxTime(12.5, a)).toBeCloseTo(102.5, 12)
    expect(showToCtxTime(10, a)).toBeCloseTo(100, 12)
  })

  it('divides show deltas by rate (rate 2 halves, rate 0.5 doubles)', () => {
    const fast = { showSec: 10, ctxSec: 100, rate: 2, playing: true }
    expect(showToCtxTime(14, fast)).toBeCloseTo(102, 12)
    const slow = { showSec: 10, ctxSec: 100, rate: 0.5, playing: true }
    expect(showToCtxTime(14, slow)).toBeCloseTo(108, 12)
  })

  it('anchorFrom snapshots a transport-like object', () => {
    const a = anchorFrom({ timeSec: 3, rate: 2, state: 'playing' }, 42)
    expect(a).toEqual({ showSec: 3, ctxSec: 42, rate: 2, playing: true })
    expect(anchorFrom({ timeSec: 0, rate: 1, state: 'paused' }, 0).playing).toBe(false)
  })
})

describe('AudioClock driving a core Transport', () => {
  it('advances the transport by host dt while playing (first tick is free)', () => {
    const { clock, setNow } = makeClock()
    const transport = new Transport(minimalCompiled(60))
    clock.drive(transport)
    transport.play()

    setNow(1)
    clock.tick() // first tick after drive: lastNow was null → dt 0
    expect(transport.timeSec).toBe(0)

    setNow(1.5)
    clock.tick()
    expect(transport.timeSec).toBeCloseTo(0.5, 12)

    setNow(3.25)
    clock.tick()
    expect(transport.timeSec).toBeCloseTo(2.25, 12)
  })

  it('does not advance a paused transport but keeps tracking the clock', () => {
    const { clock, setNow } = makeClock()
    const transport = new Transport(minimalCompiled(60))
    clock.drive(transport)
    transport.play()
    setNow(1)
    clock.tick()
    setNow(2)
    clock.tick()
    expect(transport.timeSec).toBeCloseTo(1, 12)

    clock.pause()
    setNow(10)
    clock.tick() // big gap while paused
    expect(transport.timeSec).toBeCloseTo(1, 12)

    void clock.play()
    setNow(10.25)
    clock.tick() // resumes with the small post-play dt, no catch-up jump
    expect(transport.timeSec).toBeCloseTo(1.25, 12)
  })

  it('lets the transport apply rate itself (dt is raw host seconds)', () => {
    const { clock, setNow } = makeClock()
    const transport = new Transport(minimalCompiled(60))
    clock.drive(transport)
    transport.play()
    setNow(1)
    clock.tick()
    clock.setRate(2)
    setNow(2)
    clock.tick()
    expect(transport.timeSec).toBeCloseTo(2, 12) // 1 host sec × rate 2
    clock.setRate(0.5)
    setNow(4)
    clock.tick()
    expect(transport.timeSec).toBeCloseTo(3, 12) // +2 host sec × 0.5
  })

  it('snaps to true time after a long rAF gap (tab throttling)', () => {
    const { clock, setNow } = makeClock()
    const transport = new Transport(minimalCompiled(600))
    clock.drive(transport)
    transport.play()
    setNow(1)
    clock.tick()
    setNow(31) // 30 s without frames
    clock.tick()
    expect(transport.timeSec).toBeCloseTo(30, 12)
  })

  it('delegates pause/seek/setRate/stop and notifies flush listeners', () => {
    const { clock } = makeClock()
    const transport = new Transport(minimalCompiled(60))
    clock.drive(transport)
    const reasons: FlushReason[] = []
    clock.onFlush((r) => reasons.push(r))

    void clock.play()
    expect(transport.state).toBe('playing')
    clock.seek(12)
    expect(transport.timeSec).toBe(12)
    clock.setRate(2)
    expect(transport.rate).toBe(2)
    clock.pause()
    expect(transport.state).toBe('paused')
    clock.stop()
    expect(transport.state).toBe('stopped')
    expect(reasons).toEqual(['seek', 'rate', 'pause', 'stop'])
  })

  it('anchor() pairs the transport time with the last pump instant', () => {
    const { clock, setNow } = makeClock()
    const transport = new Transport(minimalCompiled(60))
    clock.drive(transport)
    transport.play()
    setNow(5)
    clock.tick()
    setNow(6)
    clock.tick()
    const a = clock.anchor()
    expect(a.showSec).toBeCloseTo(1, 12)
    expect(a.ctxSec).toBe(6)
    expect(a.rate).toBe(1)
    expect(a.playing).toBe(true)
    // Round trip: a note landing at show 1.2 should map 0.2 s ahead.
    expect(showToCtxTime(1.2, a)).toBeCloseTo(6.2, 12)
  })

  it('unbinding stops advancing; a new drive() rebinds cleanly', () => {
    const { clock, setNow } = makeClock()
    const t1 = new Transport(minimalCompiled(60))
    const un = clock.drive(t1)
    t1.play()
    setNow(1)
    clock.tick()
    setNow(2)
    clock.tick()
    expect(t1.timeSec).toBeCloseTo(1, 12)
    un()
    setNow(3)
    clock.tick()
    expect(t1.timeSec).toBeCloseTo(1, 12) // unbound → untouched

    const t2 = new Transport(minimalCompiled(60, 2))
    clock.drive(t2)
    expect(t2.timeSec).toBe(-2) // pre-roll respected
    t2.play()
    setNow(4)
    clock.tick()
    setNow(4.5)
    clock.tick()
    expect(t2.timeSec).toBeCloseTo(-1.5, 12)
    expect(clock.transport).toBe(t2)
  })

  it('is functional (silent) without an AudioContext', () => {
    const clock = new AudioClock({ createContext: () => null, raf: () => 0, caf: () => {} })
    expect(clock.ctx).toBeNull()
    expect(Number.isFinite(clock.now())).toBe(true) // performance fallback
    const transport = new Transport(minimalCompiled(10))
    clock.drive(transport)
    void clock.play()
    expect(transport.state).toBe('playing')
    clock.dispose()
  })
})
