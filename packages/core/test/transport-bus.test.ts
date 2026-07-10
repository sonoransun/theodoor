import { describe, expect, it } from 'vitest'
import { Bus, type BusEvent } from '../src/transport/bus.js'

describe('Bus', () => {
  it('calls listeners in subscription order, deterministically', () => {
    const bus = new Bus<string>()
    const log: string[] = []
    bus.on((e) => log.push(`a:${e}`))
    bus.on((e) => log.push(`b:${e}`))
    bus.on((e) => log.push(`c:${e}`))
    bus.emit('x')
    bus.emit('y')
    expect(log).toEqual(['a:x', 'b:x', 'c:x', 'a:y', 'b:y', 'c:y'])
  })

  it('unsubscribe removes only that listener and is idempotent', () => {
    const bus = new Bus<number>()
    const log: string[] = []
    bus.on((e) => log.push(`a${e}`))
    const offB = bus.on((e) => log.push(`b${e}`))
    bus.on((e) => log.push(`c${e}`))
    bus.emit(1)
    offB()
    offB() // second call must be a safe no-op
    bus.emit(2)
    expect(log).toEqual(['a1', 'b1', 'c1', 'a2', 'c2'])
    expect(bus.size).toBe(2)
  })

  it('same function subscribed twice runs twice; each unsubscribe removes one', () => {
    const bus = new Bus<number>()
    let calls = 0
    const fn = () => {
      calls++
    }
    const off1 = bus.on(fn)
    bus.on(fn)
    bus.emit(0)
    expect(calls).toBe(2)
    off1()
    bus.emit(0)
    expect(calls).toBe(3)
  })

  it('a throwing listener does not block later listeners; first error rethrows after delivery', () => {
    const bus = new Bus<string>()
    const log: string[] = []
    bus.on(() => log.push('first'))
    bus.on(() => {
      throw new Error('boom-1')
    })
    bus.on(() => {
      throw new Error('boom-2')
    })
    bus.on(() => log.push('last'))
    expect(() => bus.emit('e')).toThrowError('boom-1')
    // Everyone after the throwers still got the event.
    expect(log).toEqual(['first', 'last'])
    // The bus stays usable and listeners stay subscribed.
    log.length = 0
    expect(() => bus.emit('e')).toThrowError('boom-1')
    expect(log).toEqual(['first', 'last'])
  })

  it('listener subscribed during emit does not receive the in-flight event', () => {
    const bus = new Bus<string>()
    const log: string[] = []
    bus.on((e) => {
      log.push(`outer:${e}`)
      if (e === 'first') bus.on((e2) => log.push(`inner:${e2}`))
    })
    bus.emit('first')
    bus.emit('second')
    expect(log).toEqual(['outer:first', 'outer:second', 'inner:second'])
  })

  it('listener unsubscribed during emit still receives the in-flight event (snapshot)', () => {
    const bus = new Bus<string>()
    const log: string[] = []
    let offB: () => void = () => {}
    bus.on((e) => {
      log.push(`a:${e}`)
      offB()
    })
    offB = bus.on((e) => log.push(`b:${e}`))
    bus.emit('x')
    bus.emit('y')
    expect(log).toEqual(['a:x', 'b:x', 'a:y'])
  })

  it('typechecks against the BusEvent union', () => {
    const bus = new Bus<BusEvent>()
    const types: string[] = []
    bus.on((e) => types.push(e.type))
    bus.emit({ type: 'seek', t: 1 })
    bus.emit({ type: 'warning', source: 'test', message: 'm', t: 2 })
    bus.emit({ type: 'transport', state: 'paused', t: 3 })
    bus.emit({ type: 'tick', t: 3, dt: 0.5 })
    expect(types).toEqual(['seek', 'warning', 'transport', 'tick'])
  })
})
