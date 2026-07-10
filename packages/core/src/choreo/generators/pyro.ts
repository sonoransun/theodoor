/**
 * Pyro cue generators — pure, deterministic factories producing Cue[] with
 * MusicAnchor anchors and ids '<prefix>-NNN'. Effects are opaque catalog ids;
 * where caliber ordering matters the caller passes a `getEffect` lookup
 * (generators never import the catalog).
 */

import type {
  Beats,
  Cue,
  EffectDef,
  MusicAnchor,
  MusicalTimeline,
  Seconds,
} from '../../contracts.js'

const pad3 = (k: number): string => String(k).padStart(3, '0')

function mkCue(
  id: string,
  effectId: string,
  anchor: MusicAnchor,
  positionId: string | undefined,
  priority: number | undefined,
): Cue {
  const cue: Cue = { id, effectId, anchor }
  if (positionId !== undefined) cue.positionId = positionId
  if (priority !== undefined) cue.priority = priority
  return cue
}

/**
 * Shift a MusicAnchor by whole/fractional beats (accumulates into
 * offsetBeats). Seconds anchors cannot take beat offsets without a tempo map,
 * so a non-zero offset on a 'sec' anchor throws.
 */
export function offsetAnchor(anchor: MusicAnchor, offsetBeats: Beats): MusicAnchor {
  if (offsetBeats === 0) return anchor
  if (anchor.kind === 'sec') {
    throw new Error('offsetAnchor: beat offsets cannot apply to seconds anchors')
  }
  return { ...anchor, offsetBeats: (anchor.offsetBeats ?? 0) + offsetBeats }
}

// ---------------------------------------------------------------------------
// volley
// ---------------------------------------------------------------------------

export interface VolleySpec {
  /** Effect ids cycled across positions. */
  effects: readonly string[]
  positionIds: readonly string[]
  /** Landing anchor of the first position. */
  land: MusicAnchor
  /** Beats between successive positions (default 0 = simultaneous). */
  staggerBeats?: Beats
  idPrefix?: string
  priority?: number
}

/** One cue per position, effects cycled, landings staggered by staggerBeats. */
export function volley(spec: VolleySpec): Cue[] {
  if (spec.effects.length === 0) throw new Error('volley: effects must be non-empty')
  const stagger = spec.staggerBeats ?? 0
  const prefix = spec.idPrefix ?? 'volley'
  return spec.positionIds.map((positionId, i) =>
    mkCue(
      `${prefix}-${pad3(i)}`,
      spec.effects[i % spec.effects.length]!,
      offsetAnchor(spec.land, i * stagger),
      positionId,
      spec.priority,
    ),
  )
}

// ---------------------------------------------------------------------------
// fan
// ---------------------------------------------------------------------------

export interface FanSpec {
  effect: string
  /** Rack line left-to-right; all land together (the fan comes from tilt). */
  positionIds: readonly string[]
  land: MusicAnchor
  idPrefix?: string
  priority?: number
}

/** Simultaneous salvo of one effect across a rack line. */
export function fan(spec: FanSpec): Cue[] {
  const prefix = spec.idPrefix ?? 'fan'
  return spec.positionIds.map((positionId, i) =>
    mkCue(`${prefix}-${pad3(i)}`, spec.effect, spec.land, positionId, spec.priority),
  )
}

// ---------------------------------------------------------------------------
// chase
// ---------------------------------------------------------------------------

export interface ChaseSpec {
  effect: string
  positionIds: readonly string[]
  /** Landing anchor of the first position. */
  startLand: MusicAnchor
  /** Beats between successive positions. */
  stepBeats: Beats
  idPrefix?: string
  priority?: number
}

/** Linear chase: position i lands at startLand + i·stepBeats. */
export function chase(spec: ChaseSpec): Cue[] {
  const prefix = spec.idPrefix ?? 'chase'
  return spec.positionIds.map((positionId, i) =>
    mkCue(
      `${prefix}-${pad3(i)}`,
      spec.effect,
      offsetAnchor(spec.startLand, i * spec.stepBeats),
      positionId,
      spec.priority,
    ),
  )
}

// ---------------------------------------------------------------------------
// ripple
// ---------------------------------------------------------------------------

export interface RippleSpec {
  effect: string
  positionIds: readonly string[]
  /** Landing anchor of the CENTER position; neighbors land later. */
  land: MusicAnchor
  /** Beats per step of distance from the center. */
  stepBeats: Beats
  idPrefix?: string
  priority?: number
}

/** Center-out ripple: position i lands at land + |i − center|·stepBeats. */
export function ripple(spec: RippleSpec): Cue[] {
  const prefix = spec.idPrefix ?? 'ripple'
  const center = (spec.positionIds.length - 1) / 2
  return spec.positionIds.map((positionId, i) =>
    mkCue(
      `${prefix}-${pad3(i)}`,
      spec.effect,
      offsetAnchor(spec.land, Math.abs(i - center) * spec.stepBeats),
      positionId,
      spec.priority,
    ),
  )
}

// ---------------------------------------------------------------------------
// finaleBarrage
// ---------------------------------------------------------------------------

export interface FinaleBarrageSpec {
  timeline: MusicalTimeline
  /**
   * Effect ids to ramp through, small → large. When `getEffect` is provided
   * the pool is stably sorted by caliberMm ascending; otherwise the given
   * order is trusted.
   */
  effectPool: readonly string[]
  positionIds: readonly string[]
  /** Barrage window ending exactly on the max-strength climax. */
  windowSec: Seconds
  /** Cue density at the window start (cues per second). */
  startRateHz: number
  /** Cue density at the climax (cues per second). */
  endRateHz: number
  idPrefix?: string
  priority?: number
  /** Catalog lookup (never imported) used only to order the pool by caliber. */
  getEffect?: (id: string) => EffectDef | undefined
}

function orderPool(
  pool: readonly string[],
  getEffect?: (id: string) => EffectDef | undefined,
): readonly string[] {
  if (!getEffect) return pool
  const caliber = (id: string): number => {
    const e = getEffect(id)
    return e !== undefined && e.medium === 'pyro' ? e.caliberMm : 0
  }
  return [...pool].sort((a, b) => caliber(a) - caliber(b))
}

/**
 * Finale barrage over [tc − windowSec, tc] where tc is the max-strength
 * 'climax' annotation (ties go to the earliest). Density ramps as
 * d(u) = d0 + (dmax − d0)·u² (monotone nondecreasing for dmax ≥ d0); land
 * times step by 1/d. Positions cycle; calibers ramp small → large across the
 * window. The final cue is anchored ON the climax annotation itself and uses
 * the largest effect. The window is clamped at t = 0 for early climaxes.
 */
export function finaleBarrage(spec: FinaleBarrageSpec): Cue[] {
  if (spec.effectPool.length === 0) throw new Error('finaleBarrage: effectPool must be non-empty')
  if (spec.positionIds.length === 0) throw new Error('finaleBarrage: positionIds must be non-empty')
  if (!(spec.startRateHz > 0) || !(spec.endRateHz > 0)) {
    throw new Error('finaleBarrage: rates must be > 0')
  }
  if (!(spec.windowSec > 0)) throw new Error('finaleBarrage: windowSec must be > 0')

  const climaxes = spec.timeline.annotations.filter((a) => a.kind === 'climax')
  if (climaxes.length === 0) {
    throw new Error('finaleBarrage: timeline has no climax annotation')
  }
  let ci = 0
  for (let i = 1; i < climaxes.length; i++) {
    if (climaxes[i]!.strength > climaxes[ci]!.strength) ci = i
  }
  const tc = climaxes[ci]!.time
  const pool = orderPool(spec.effectPool, spec.getEffect)
  const prefix = spec.idPrefix ?? 'finale'
  const t0 = Math.max(0, tc - spec.windowSec)
  const w = tc - t0

  const cues: Cue[] = []
  const push = (effectId: string, anchor: MusicAnchor): void => {
    const k = cues.length
    cues.push(
      mkCue(
        `${prefix}-${pad3(k)}`,
        effectId,
        anchor,
        spec.positionIds[k % spec.positionIds.length],
        spec.priority,
      ),
    )
  }

  if (w > 1e-9) {
    let t = t0
    let guard = 0
    while (t < tc - 1e-9 && guard++ < 100_000) {
      const u = (t - t0) / w
      const effect = pool[Math.min(pool.length - 1, Math.floor(u * pool.length))]!
      push(effect, { kind: 'sec', t })
      const rate = spec.startRateHz + (spec.endRateHz - spec.startRateHz) * u * u
      t += 1 / rate
    }
  }
  // The climax lands the largest effect, anchored on the annotation itself.
  push(pool[pool.length - 1]!, { kind: 'annotation', type: 'climax', index: ci })
  return cues
}
