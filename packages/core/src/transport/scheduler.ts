/**
 * scheduler.ts — fixed-lookahead cursor over a CompiledShow's cue array.
 *
 * The cue array arrives already sorted by (fireSec, trackId, id) — a total,
 * stable order (see contracts.ts CompiledShow). The scheduler keeps a single
 * monotonic cursor into that array; `collect` returns every not-yet-emitted
 * cue whose fireSec has entered the horizon, in array order. Because the
 * order is a property of the array and the cursor only moves forward, the
 * emitted SEQUENCE is independent of how time is chunked — only the batching
 * of emissions varies (proven by the chunking-invariance test).
 *
 * SEEK SEMANTICS: `seek(t)` repositions the cursor to the first cue with
 * fireSec > t. Cues at or before t are treated as already handled and are
 * NOT re-fired — on seek, consumers (the sim) re-simulate deterministically
 * from time zero instead of replaying fire events. Seeking backward therefore
 * re-arms exactly the cues with fireSec > t (they will fire again).
 */

import type { CompiledCue, Seconds } from '../contracts.js'

export class Scheduler {
  private cursor = 0

  constructor(private readonly cues: readonly CompiledCue[]) {}

  /**
   * All not-yet-emitted cues with fireSec <= horizonSec, in array order.
   * Advances the cursor past them; each cue is returned at most once per
   * cursor pass.
   */
  collect(horizonSec: Seconds): CompiledCue[] {
    const out: CompiledCue[] = []
    while (
      this.cursor < this.cues.length &&
      this.cues[this.cursor]!.fireSec <= horizonSec
    ) {
      out.push(this.cues[this.cursor]!)
      this.cursor++
    }
    return out
  }

  /** Reposition to the first cue with fireSec > t (binary search). */
  seek(t: Seconds): void {
    let lo = 0
    let hi = this.cues.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.cues[mid]!.fireSec <= t) lo = mid + 1
      else hi = mid
    }
    this.cursor = lo
  }

  /** Rewind to the start (used by Transport.stop). */
  reset(): void {
    this.cursor = 0
  }

  /** Index of the next cue to emit (introspection / tests). */
  get index(): number {
    return this.cursor
  }

  /** Cues not yet emitted on this pass. */
  get remaining(): number {
    return this.cues.length - this.cursor
  }
}
