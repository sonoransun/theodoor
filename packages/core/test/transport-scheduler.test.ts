import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../src/math/rng.js'
import { Scheduler } from '../src/transport/scheduler.js'
import { Transport } from '../src/transport/transport.js'
import type { BusEvent } from '../src/transport/bus.js'
import { cue, makeCompiled, tenCues } from './transport-fixture.js'

/** Drive a fresh transport with the given advance chunks; return fired cue ids. */
function runChunks(chunks: readonly number[]): string[] {
  const transport = new Transport(makeCompiled(tenCues()))
  const fired: string[] = []
  transport.on((e: BusEvent) => {
    if (e.type === 'fire') fired.push(e.cue.id)
  })
  transport.play()
  for (const dt of chunks) transport.advance(dt)
  return fired
}

describe('Scheduler (cursor)', () => {
  it('collect returns cues up to the horizon once, in array order', () => {
    const cues = tenCues()
    const s = new Scheduler(cues)
    expect(s.collect(0.5).map((c) => c.id)).toEqual(['c01', 'c02'])
    // Same horizon again: nothing new.
    expect(s.collect(0.5)).toEqual([])
    expect(s.collect(1.5).map((c) => c.id)).toEqual(['c03', 'c04', 'c05', 'c06'])
    expect(s.remaining).toBe(4)
  })

  it('seek positions the cursor at the first cue with fireSec > t', () => {
    const s = new Scheduler(tenCues())
    s.seek(1.5) // cues at exactly 1.5 count as passed
    expect(s.collect(10).map((c) => c.id)).toEqual(['c07', 'c08', 'c09', 'c10'])
    s.seek(-100)
    expect(s.remaining).toBe(10)
    s.seek(100)
    expect(s.remaining).toBe(0)
  })

  it('reset rewinds to the start', () => {
    const s = new Scheduler(tenCues())
    s.collect(10)
    expect(s.remaining).toBe(0)
    s.reset()
    expect(s.index).toBe(0)
    expect(s.collect(10)).toHaveLength(10)
  })
})

describe('Transport scheduling', () => {
  it('chunking invariance: one big advance, 180 frames, and random chunks fire identical sequences', () => {
    const one = runChunks([3.0])
    const frames = runChunks(Array.from({ length: 180 }, () => 1 / 60))
    const rng = mulberry32(0xc0ffee)
    const randomChunks: number[] = []
    let total = 0
    while (total < 3.0) {
      const dt = 0.001 + rng() * 0.3
      randomChunks.push(dt)
      total += dt
    }
    const random = runChunks(randomChunks)

    expect(one).toEqual(['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10'])
    expect(frames).toEqual(one)
    expect(random).toEqual(one)
  })

  it('each cue fires exactly once over a full run', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const counts = new Map<string, number>()
    transport.on((e) => {
      if (e.type === 'fire') counts.set(e.cue.id, (counts.get(e.cue.id) ?? 0) + 1)
    })
    transport.play()
    for (let i = 0; i < 600; i++) transport.advance(1 / 60) // past durationSec
    expect(counts.size).toBe(10)
    for (const [, n] of counts) expect(n).toBe(1)
  })

  it('never emits a fire more than lookahead early (checked at each emission)', () => {
    const transport = new Transport(makeCompiled(tenCues()), { lookaheadSec: 0.25 })
    const earliness: number[] = []
    transport.on((e) => {
      if (e.type === 'fire') earliness.push(e.cue.fireSec - transport.timeSec)
    })
    transport.play()
    const rng = mulberry32(99)
    let t = 0
    while (t < 4) {
      const dt = 0.001 + rng() * 0.1
      transport.advance(dt)
      t += dt
    }
    expect(earliness).toHaveLength(10)
    for (const early of earliness) expect(early).toBeLessThanOrEqual(0.25 + 1e-9)
  })

  it('fire events carry the exact compiled fireSec', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const byId = new Map<string, number>()
    transport.on((e) => {
      if (e.type === 'fire') byId.set(e.cue.id, e.cue.fireSec)
    })
    transport.play()
    transport.advance(5)
    expect(byId.get('c01')).toBe(0.1)
    expect(byId.get('c06')).toBe(1.5)
    expect(byId.get('c10')).toBe(2.9)
  })

  it('emits tick after fires on each advance, with t and dt in show time', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const log: string[] = []
    const ticks: { t: number; dt: number }[] = []
    transport.on((e) => {
      log.push(e.type)
      if (e.type === 'tick') ticks.push({ t: e.t, dt: e.dt })
    })
    transport.play()
    transport.advance(0.5) // fires c01, c02 (horizon 0.75 → c03 too)
    expect(log).toEqual(['transport', 'fire', 'fire', 'fire', 'tick'])
    expect(ticks[0]).toEqual({ t: 0.5, dt: 0.5 })
    transport.advance(0.25)
    expect(log[log.length - 1]).toBe('tick')
    expect(ticks[1]!.t).toBeCloseTo(0.75, 12)
    expect(ticks[1]!.dt).toBeCloseTo(0.25, 12)
  })

  it('seek forward skips the cues in between (they never fire)', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const fired: string[] = []
    transport.on((e) => {
      if (e.type === 'fire') fired.push(e.cue.id)
    })
    transport.play()
    transport.advance(0.5) // horizon 0.75: c01, c02, c03
    expect(fired).toEqual(['c01', 'c02', 'c03'])
    transport.seek(2.0) // c04..c07 (fireSec <= 2.0) are treated as passed
    transport.advance(2.0)
    expect(fired).toEqual(['c01', 'c02', 'c03', 'c08', 'c09', 'c10'])
  })

  it('seek backward then play emits exactly the not-yet-fired suffix for the new position', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const fired: string[] = []
    transport.on((e) => {
      if (e.type === 'fire') fired.push(e.cue.id)
    })
    transport.play()
    transport.advance(10) // everything fires
    expect(fired).toHaveLength(10)
    fired.length = 0
    transport.seek(1.4) // cues with fireSec > 1.4 re-arm
    transport.advance(10)
    expect(fired).toEqual(['c05', 'c06', 'c07', 'c08', 'c09', 'c10'])
  })

  it('seek emits a seek event with the clamped time and repositions without firing', () => {
    const transport = new Transport(makeCompiled(tenCues()))
    const events: BusEvent[] = []
    transport.on((e) => events.push(e))
    transport.seek(2.5)
    expect(events).toEqual([{ type: 'seek', t: 2.5 }])
    expect(transport.timeSec).toBe(2.5)
    // Clamps to [t0, durationSec]: duration here is max(10, 2.9 + 1) = 10.
    transport.seek(-5)
    expect(transport.timeSec).toBe(0)
    transport.seek(999)
    expect(transport.timeSec).toBe(10)
  })

  it('pre-roll: timeSec starts at -3 and a cue at fireSec -2.5 fires before t = 0', () => {
    const cues = [cue('early', -2.5), ...tenCues()]
    const transport = new Transport(makeCompiled(cues, { preRollSec: 3 }))
    expect(transport.timeSec).toBe(-3)
    const firedAt: { id: string; tAtEmit: number }[] = []
    transport.on((e) => {
      if (e.type === 'fire') firedAt.push({ id: e.cue.id, tAtEmit: transport.timeSec })
    })
    transport.play()
    for (let i = 0; i < 360; i++) transport.advance(1 / 60) // -3 → +3
    expect(firedAt[0]!.id).toBe('early')
    expect(firedAt[0]!.tAtEmit).toBeLessThan(0)
    expect(firedAt.map((f) => f.id)).toEqual([
      'early', 'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10',
    ])
    // Stop resets to t0 = -3, not 0.
    transport.stop()
    expect(transport.timeSec).toBe(-3)
  })

  it('durationSec is max(cue tail, music duration)', () => {
    // Cue tail beyond the music: target 11 + duration 2 = 13 > music 10.
    const long = new Transport(
      makeCompiled([cue('tail', 11, { durationSec: 2 })], { musicDuration: 10 }),
    )
    expect(long.durationSec).toBe(13)
    // Music longer than every cue tail.
    const musical = new Transport(makeCompiled(tenCues(), { musicDuration: 30 }))
    expect(musical.durationSec).toBe(30)
    // No cues at all → music duration.
    const empty = new Transport(makeCompiled([], { musicDuration: 12.5 }))
    expect(empty.durationSec).toBe(12.5)
  })

  it('advance clamps show time at durationSec', () => {
    const transport = new Transport(makeCompiled(tenCues(), { musicDuration: 10 }))
    transport.play()
    transport.advance(50)
    expect(transport.timeSec).toBe(10)
    transport.advance(1)
    expect(transport.timeSec).toBe(10)
    expect(transport.state).toBe('playing') // host decides what to do at the end
  })
})
