/**
 * acoustics/spl — inverse-square propagation, log-domain summation, and the
 * per-listener SPL timeline over a compiled show.
 *
 * This is the single SPL implementation for the whole suite (solver, sim,
 * validation, and the quiet report all consume it). Noise metadata comes from
 * the effect catalog (`EffectDef.noiseDbAt15m`, referenced to
 * `SPL_REF_DISTANCE_M`); this module never looks the catalog up itself —
 * callers pass a `getEffect` lookup.
 *
 * Conventions:
 * - Distances are ground-plane (Vec2) metres; propagation distance is clamped
 *   to 1 m so a listener standing on a source never yields +Infinity.
 * - Noise windows are half-open `[start, end)` so back-to-back cues never
 *   double-count at the shared boundary sample.
 * - Silence is `-Infinity` dB, never NaN or null (JSON writers may map it to
 *   null at the serialization edge).
 */

import type {
  CompiledCue,
  CompiledShow,
  EffectDef,
  Seconds,
  SitePlan,
  Vec2,
} from '../contracts.js'
import { IMPULSE_WINDOW_SEC, SPL_REF_DISTANCE_M } from '../contracts.js'
import { dist2, v2 } from '../math/index.js'
import { beamAudibleLevelAt, type BeamTargetOpts, type SourceGroundResolver } from './beams.js'

/** Effect-catalog lookup; modules never import the catalog directly. */
export type EffectLookup = (id: string) => EffectDef | undefined

/**
 * Optional beam-aim context for the SPL samplers, so a caller (the sim
 * engine) can make the SPL channel resolve beam aims on the SAME clock and
 * source track as its beams channel. Absent → prior behavior, byte-identical
 * for non-beam shows (and for beam shows without beats/sourceTag cues).
 */
export interface SplBeamOpts {
  /** Beat instants (MusicalTimeline.beats) for periodBeats programs. */
  beats?: readonly Seconds[]
  /** Per-cue sourceTag ground track (acoustics/beams sourceGroundResolver). */
  sourceGroundAt?: SourceGroundResolver
}

/** Half-open noise emission interval `[start, end)`, show seconds. */
export interface NoiseWindow {
  start: Seconds
  end: Seconds
}

/** One sample of an SPL timeline. */
export interface SplSample {
  tSec: Seconds
  /** Summed level in dB; `-Infinity` (never NaN) when nothing is audible. */
  dB: number
  /** Ids of the cues whose noise windows cover this sample. */
  contributors: readonly string[]
}

/**
 * Propagate a reference level to a listener distance:
 * `dbAtRef - 20*log10(max(1, distM) / refM)` (−6 dB per distance doubling).
 * The distance is clamped to 1 m to avoid +Infinity inside the source.
 */
export function splAtDistance(dbAtRef: number, refM: number, distM: number): number {
  return dbAtRef - 20 * Math.log10(Math.max(1, distM) / refM)
}

/**
 * Log-domain (power) sum of simultaneous levels:
 * `10*log10(Σ 10^(L/10))`. Empty input → `-Infinity`.
 */
export function sumSpl(levels: readonly number[]): number {
  let power = 0
  for (const level of levels) power += Math.pow(10, level / 10)
  return power > 0 ? 10 * Math.log10(power) : -Infinity
}

/**
 * True for effects whose noise is a short impulse: pyro category 'salute',
 * or any effect tagged 'impulse'. Impulse sources contribute SPL only for
 * `IMPULSE_WINDOW_SEC` (or their full duration if shorter).
 */
export function isImpulseEffect(effect: EffectDef): boolean {
  if (effect.tags.includes('impulse')) return true
  return effect.medium === 'pyro' && effect.category === 'salute'
}

/**
 * The half-open interval during which a cue emits noise.
 *
 * All media emit at `cue.targetSec` — for pyro that is the burst (the rise is
 * quiet), for other media it is when the effect lands — and last
 * `effect.durationSec`, except impulse sources (salutes, 'impulse'-tagged
 * effects) which last `min(durationSec, IMPULSE_WINDOW_SEC)`.
 */
export function cueNoiseWindow(cue: CompiledCue, effect: EffectDef): NoiseWindow {
  const dur = isImpulseEffect(effect)
    ? Math.min(effect.durationSec, IMPULSE_WINDOW_SEC)
    : effect.durationSec
  return { start: cue.targetSec, end: cue.targetSec + dur }
}

/**
 * Ground-plane position a cue's noise radiates from: its `positionId` asset,
 * falling back to the site origin (0,0) when the id is absent or unknown
 * (never throws — validation flags dangling position ids elsewhere).
 */
export function cueSourcePos(cue: CompiledCue, site: SitePlan): Vec2 {
  if (cue.positionId !== undefined) {
    for (const asset of site.assets) {
      if (asset.id === cue.positionId) return v2(asset.pos.x, asset.pos.y)
    }
  }
  return v2(0, 0)
}

/** Precomputed per-cue emission (window + propagated level for one listener). */
interface NoiseSource {
  cueId: string
  start: Seconds
  end: Seconds
  levelDb: number
  /**
   * Time-varying level override (beam cues: steered aim + footprint gating,
   * see acoustics/beams.ts). Samplers use `levelAt?.(t) ?? levelDb`.
   */
  levelAt?: (t: Seconds) => number
}

function noiseSources(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  listener: Vec2,
  opts?: SplBeamOpts,
): NoiseSource[] {
  const out: NoiseSource[] = []
  for (const cue of compiled.cues) {
    const effect = getEffect(cue.effectId)
    if (!effect) continue
    const { start, end } = cueNoiseWindow(cue, effect)
    if (!(end > start)) continue // zero-length window: half-open ⇒ silent
    const distM = dist2(cueSourcePos(cue, compiled.show.site), listener)
    const src: NoiseSource = {
      cueId: cue.id,
      start,
      end,
      levelDb: splAtDistance(effect.noiseDbAt15m, SPL_REF_DISTANCE_M, distM),
    }
    if (effect.medium === 'beam') {
      // Beam levels vary over time at a fixed listener (steered aim, slant
      // range, footprint leakage gate) — beams.ts owns that geometry.
      src.levelAt = (t) => {
        const sourceGround =
          effect.program === 'sourceTag' ? opts?.sourceGroundAt?.(cue, t) : undefined
        const aimOpts: BeamTargetOpts = {
          ...(opts?.beats ? { beats: opts.beats } : {}),
          ...(sourceGround ? { sourceGround } : {}),
        }
        return beamAudibleLevelAt(cue, effect, compiled.show.site, listener, t, aimOpts)
      }
    }
    out.push(src)
  }
  return out
}

/**
 * Instantaneous SPL at `listener` at show time `t`: the power sum of every
 * cue whose noise window covers `t`. Empty active set → `-Infinity`.
 */
export function splAtInstant(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  listener: Vec2,
  t: Seconds,
  opts?: SplBeamOpts,
): number {
  const levels: number[] = []
  for (const src of noiseSources(compiled, getEffect, listener, opts)) {
    if (t >= src.start && t < src.end) levels.push(src.levelAt?.(t) ?? src.levelDb)
  }
  return sumSpl(levels)
}

/**
 * SPL swept over the whole show for one listener: a uniform `dtSec` grid
 * (default 0.1 s) plus every noise-window breakpoint, across
 * `[-preRollSec, max(show duration, last window end)]` inclusive.
 *
 * Beam levels are time-varying (steered aim + footprint gating) and are
 * sampled on the dt grid; breakpoint exactness holds only for the
 * piecewise-constant sources (everything else).
 */
export function splTimeline(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  listener: Vec2,
  dtSec: Seconds = 0.1,
  opts?: SplBeamOpts,
): SplSample[] {
  const sources = noiseSources(compiled, getEffect, listener, opts)
  const startSec = Math.min(0, -(compiled.show.preRollSec ?? 0))
  // Sweep to the LAST noise-window end, not just the music duration — cues
  // landing at/after the music tail must not escape the quiet gate.
  let endSec = compiled.show.music.duration
  for (const src of sources) endSec = Math.max(endSec, src.end)
  const steps = Math.max(0, Math.ceil((endSec - startSec) / dtSec - 1e-9))
  // The active set is piecewise-constant with breakpoints only at window
  // starts/ends; sampling the uniform grid PLUS every (clamped) breakpoint
  // makes the sweep exact — sub-dtSec overlap slivers cannot hide between
  // samples (the 120 Hz sim and the HUD meter sample a superset of times).
  const times: number[] = []
  for (let i = 0; i <= steps; i++) times.push(startSec + i * dtSec)
  for (const src of sources) {
    if (src.start >= startSec && src.start <= endSec) times.push(src.start)
    if (src.end >= startSec && src.end <= endSec) times.push(src.end)
  }
  times.sort((a, b) => a - b)
  const samples: SplSample[] = []
  let prevT = Number.NaN
  for (const tSec of times) {
    if (tSec === prevT) continue
    prevT = tSec
    const contributors: string[] = []
    const levels: number[] = []
    for (const src of sources) {
      if (tSec >= src.start && tSec < src.end) {
        contributors.push(src.cueId)
        levels.push(src.levelAt?.(tSec) ?? src.levelDb)
      }
    }
    samples.push({ tSec, dB: sumSpl(levels), contributors })
  }
  return samples
}
