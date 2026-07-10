/**
 * gallery/sample.ts — the gallery's one consumer of the sim engine.
 *
 * Animated gallery assets are built from frames sampled at a low fixed rate
 * (2–8 fps, always a divisor of the 120 Hz step grid). SimSnapshot hands out
 * SoA subarray VIEWS that are only valid until the next step, so every
 * channel is copied (`.slice()`) before the engine advances — a GalleryFrame
 * owns its buffers.
 */

import type { BeamState, CompiledShow, EffectDef, Seconds } from '../contracts.js'
import { SimEngine } from '../sim/engine.js'

export interface SampleOpts {
  fromSec: Seconds
  toSec: Seconds
  /** Frames per second; use a divisor of 120 (2, 4, 8…) per house style. */
  fps: number
  /** Required for non-starter catalogs (mirrors SimEngine's rule). */
  getEffect?: (id: string) => EffectDef | undefined
}

/** One owned (copied) sample of the sim state at time t. */
export interface GalleryFrame {
  t: Seconds
  stars: {
    count: number
    pos: Float32Array
    rgb: Float32Array
    brightness: Float32Array
    sizeM: Float32Array
  }
  drones: { count: number; pos: Float32Array; rgb: Float32Array }
  crowd: { cellCount: number; rgb: Float32Array; white: Float32Array }
  beams: readonly BeamState[]
}

/**
 * Sample `floor((toSec − fromSec) · fps) + 1` frames inclusive of both ends.
 * Deterministic: same compiled show + opts → identical frames, and sample
 * times land on exact 120 Hz steps when fps divides 120.
 */
export function sampleFrames(compiled: CompiledShow, opts: SampleOpts): GalleryFrame[] {
  if (!(opts.fps > 0)) throw new Error('gallery sample: fps must be positive')
  if (!(opts.toSec >= opts.fromSec)) throw new Error('gallery sample: toSec must be >= fromSec')
  const engine = new SimEngine(compiled, opts.getEffect ? { getEffect: opts.getEffect } : {})
  const n = Math.floor((opts.toSec - opts.fromSec) * opts.fps + 1e-9) + 1
  const frames: GalleryFrame[] = []
  for (let k = 0; k < n; k++) {
    const t = opts.fromSec + k / opts.fps
    engine.advanceTo(t)
    const s = engine.snapshot()
    frames.push({
      t,
      stars: {
        count: s.stars.count,
        pos: s.stars.pos.slice(),
        rgb: s.stars.rgb.slice(),
        brightness: s.stars.brightness.slice(),
        sizeM: s.stars.sizeM.slice(),
      },
      drones: {
        count: s.drones.count,
        pos: s.drones.pos.slice(),
        rgb: s.drones.rgb.slice(),
      },
      crowd: {
        cellCount: s.crowd.cellCount,
        rgb: s.crowd.rgb.slice(),
        white: s.crowd.white.slice(),
      },
      // beamStatesAt builds fresh plain objects each step; copying the array
      // is enough to own them.
      beams: [...s.beams],
    })
  }
  return frames
}
