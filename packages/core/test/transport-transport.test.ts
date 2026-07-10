import { describe, expect, it } from 'vitest'
import { Transport, MIN_RATE, MAX_RATE, DEFAULT_LOOKAHEAD_SEC } from '../src/transport/transport.js'
import type { BusEvent } from '../src/transport/bus.js'
import { makeCompiled, tenCues } from './transport-fixture.js'

function firedIds(events: readonly BusEvent[]): string[] {
  return events.filter((e) => e.type === 'fire').map((e) => (e as { cue: { id: string } }).cue.id)
}

describe('Transport state machine', () => {
  it('starts stopped at t0 with rate 1 and the default lookahead', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    expect(transport.state).toBe('stopped')
    expect(transport.timeSec).toBe(0) // no preRollSec → t0 = 0
    expect(transport.rate).toBe(1)
    expect(transport.lookaheadSec).toBe(DEFAULT_LOOKAHEAD_SEC)
  })

  it('play/pause/stop emit transport events; redundant calls do not', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const events: BusEvent[] = []
    transport.on((e) => {
      if (e.type === 'transport') events.push(e)
    })
    transport.play()
    transport.play() // no duplicate
    transport.pause()
    transport.pause() // no duplicate
    transport.play()
    transport.stop()
    transport.stop() // already stopped at t0 → no duplicate
    expect(events).toEqual([
      { type: 'transport', state: 'playing', t: 0 },
      { type: 'transport', state: 'paused', t: 0 },
      { type: 'transport', state: 'playing', t: 0 },
      { type: 'transport', state: 'stopped', t: 0 },
    ])
  })

  it('advance is a no-op (no time, no events) while paused or stopped', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const events: BusEvent[] = []
    transport.on((e) => events.push(e))
    transport.advance(1) // stopped
    expect(transport.timeSec).toBe(0)
    expect(events).toEqual([])
    transport.play()
    transport.advance(0.05)
    transport.pause()
    const before = transport.timeSec
    const nEvents = events.length
    transport.advance(1) // paused
    expect(transport.timeSec).toBe(before)
    expect(events.length).toBe(nEvents)
  })

  it('stop resets time and cursor, allowing an identical full re-run', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const events: BusEvent[] = []
    transport.on((e) => events.push(e))
    transport.play()
    for (let i = 0; i < 240; i++) transport.advance(1 / 60)
    const firstRun = firedIds(events)
    expect(firstRun).toHaveLength(10)

    transport.stop()
    expect(transport.timeSec).toBe(0)
    expect(transport.state).toBe('stopped')

    events.length = 0
    transport.play()
    for (let i = 0; i < 240; i++) transport.advance(1 / 60)
    expect(firedIds(events)).toEqual(firstRun)
  })

  it('rate 2 reaches a given show time in half the host time; fire sequence unchanged', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const fired: string[] = []
    transport.on((e) => {
      if (e.type === 'fire') fired.push(e.cue.id)
    })
    transport.setRate(2)
    transport.play()
    // 1.5 s of host time at rate 2 → show time 3.0.
    for (let i = 0; i < 90; i++) transport.advance(1 / 60)
    expect(transport.timeSec).toBeCloseTo(3.0, 9)
    // Same 10-cue sequence as a rate-1 run to t = 3 (lookahead 0.25 covers 2.9).
    expect(fired).toEqual(['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10'])
  })

  it('rate 0.5 doubles the host time to a given show time', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    transport.setRate(0.5)
    transport.play()
    transport.advance(4) // 4 s host → 2 s show
    expect(transport.timeSec).toBeCloseTo(2, 12)
  })

  it('setRate clamps to [0.1, 4] and never rescales fireSec', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    transport.setRate(0)
    expect(transport.rate).toBe(MIN_RATE)
    transport.setRate(-3)
    expect(transport.rate).toBe(MIN_RATE)
    transport.setRate(1000)
    expect(transport.rate).toBe(MAX_RATE)
    transport.setRate(1.5)
    expect(transport.rate).toBe(1.5)

    const fireSecs: number[] = []
    transport.on((e) => {
      if (e.type === 'fire') fireSecs.push(e.cue.fireSec)
    })
    transport.setRate(4)
    transport.play()
    transport.advance(1) // show time 4
    expect(fireSecs).toContain(0.1) // untouched show-time stamps
    expect(fireSecs).toContain(2.9)
  })

  it('listener order on the transport bus is subscription order for every event', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const log: string[] = []
    transport.on((e) => log.push(`A:${e.type}`))
    transport.on((e) => log.push(`B:${e.type}`))
    transport.play()
    transport.advance(0.05)
    for (let i = 0; i < log.length; i += 2) {
      expect(log[i]!.startsWith('A:')).toBe(true)
      expect(log[i + 1]).toBe(`B:${log[i]!.slice(2)}`)
    }
    expect(log.length).toBeGreaterThan(0)
  })

  it('unsubscribing a transport listener stops delivery', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    let count = 0
    const off = transport.on(() => count++)
    transport.play()
    const after = count
    off()
    transport.advance(1)
    expect(count).toBe(after)
  })

  it('warn publishes a warning event stamped with current show time', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const warnings: BusEvent[] = []
    transport.on((e) => {
      if (e.type === 'warning') warnings.push(e)
    })
    transport.play()
    transport.advance(0.5)
    transport.warn('sim', 'separation below minimum')
    expect(warnings).toEqual([
      { type: 'warning', source: 'sim', message: 'separation below minimum', t: 0.5 },
    ])
  })

  it('seek preserves playback state (paused stays paused, playing stays playing)', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    transport.seek(1)
    expect(transport.state).toBe('stopped')
    transport.play()
    transport.seek(2)
    expect(transport.state).toBe('playing')
    transport.pause()
    transport.seek(0.5)
    expect(transport.state).toBe('paused')
    expect(transport.timeSec).toBe(0.5)
  })
})
