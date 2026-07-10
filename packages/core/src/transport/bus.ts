/**
 * bus.ts — minimal typed synchronous event emitter for the transport layer.
 *
 * DETERMINISM: emission is fully synchronous and single-threaded. Listeners
 * are invoked in subscription order, on a snapshot of the listener list taken
 * at the start of `emit`, so:
 *   - a listener subscribed *during* an emit does not receive the in-flight
 *     event (it receives subsequent ones);
 *   - a listener unsubscribed during an emit still receives the in-flight
 *     event (the snapshot has already been taken);
 *   - the invocation order for any event is exactly the order in which `on`
 *     was called — no Map/Set iteration, no timers, no async hops.
 *
 * ERROR ISOLATION: a throwing listener never prevents delivery to the
 * remaining listeners. Errors are caught, the event is delivered to everyone,
 * and then the FIRST error thrown is rethrown from `emit`.
 */

import type { CompiledCue, Seconds } from '../contracts.js'

/** Events published on a Transport's bus. */
export type BusEvent =
  | { type: 'fire'; cue: CompiledCue }
  | { type: 'tick'; t: Seconds; dt: Seconds }
  | { type: 'transport'; state: 'playing' | 'paused' | 'stopped'; t: Seconds }
  | { type: 'seek'; t: Seconds }
  | { type: 'warning'; source: string; message: string; t: Seconds }

export type Listener<E> = (e: E) => void
export type Unsubscribe = () => void

export class Bus<E> {
  private readonly listeners: Listener<E>[] = []

  /**
   * Subscribe. Returns an idempotent unsubscribe function. Subscribing the
   * same function twice yields two invocations per event; each returned
   * unsubscribe removes one occurrence.
   */
  on(fn: Listener<E>): Unsubscribe {
    this.listeners.push(fn)
    let active = true
    return () => {
      if (!active) return
      active = false
      const i = this.listeners.indexOf(fn)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  /** Number of current subscriptions (introspection / tests). */
  get size(): number {
    return this.listeners.length
  }

  /**
   * Deliver `e` synchronously to every listener subscribed at call time, in
   * subscription order. If any listener throws, delivery continues to the
   * rest and the first error is rethrown afterwards.
   */
  emit(e: E): void {
    const snapshot = this.listeners.slice()
    let firstError: unknown
    let threw = false
    for (const fn of snapshot) {
      try {
        fn(e)
      } catch (err) {
        if (!threw) {
          threw = true
          firstError = err
        }
      }
    }
    if (threw) throw firstError
  }
}
