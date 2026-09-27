/**
 * Fountain geometry — SINGLE OWNER of how a fountain cue maps onto a bank's
 * nozzle row: nozzle positions, which nozzles a program engages, each
 * column's crest height and lateral tip offset, and the per-nozzle stagger
 * (cascades run along the row). The alignment solver (anticipation), the sim
 * (column heights), the DMX exporter, and site validation all read this file,
 * so no two consumers can disagree about where the water goes.
 *
 * Frames: world x = east, y = north; a bank's nozzles are spaced evenly over
 * spanM along headingDeg + 90° (a bank facing north runs east–west, nozzle 0
 * at the west end), centered on the asset position, at z = elevationM (the
 * water surface).
 *
 * Stagger runs on the show's REAL beat grid: a cascade column k crests
 * exactly k·stepBeats beats after the cue's landing as the tempo map places
 * those beats (beatOffsetSec), so a cascade authored on a ritardando slows
 * with the music instead of drifting off it.
 */

import type {
  Beats,
  CompiledCue,
  CueParams,
  FountainBankSpec,
  FountainEffect,
  PositionedAsset,
  Seconds,
  Vec3,
} from '../../contracts.js'
import { clamp } from '../../math/curves.js'

const DEG = Math.PI / 180

/** Fanned columns lean outward up to this angle from vertical, degrees. */
export const FOUNTAIN_FAN_MAX_LEAN_DEG = 35
/** Cascade step between successive nozzles when no params.stepBeats is set, beats. */
export const FOUNTAIN_CASCADE_STEP_BEATS: Beats = 0.5
/** Wave modulation period when no params.periodBeats is set, beats. */
export const FOUNTAIN_WAVE_PERIOD_BEATS: Beats = 4
/** Wave columns dip to this fraction of the crest between peaks. */
export const FOUNTAIN_WAVE_DEPTH = 0.3
/** Fallback bank spec for a fountain cue whose position carries none. */
export const DEFAULT_FOUNTAIN_BANK: FountainBankSpec = {
  nozzles: 1,
  spanM: 0,
  maxHeightM: 60,
  valveLatencySec: 0.15,
}

/** Snap float noise (cos 90° ≈ 6e-17) so axis-aligned rows land on exact coordinates. */
const snap = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v)

/** Unit vector along a bank's row (heading + 90°), world x/y. */
export function bankRowDir(asset: Pick<PositionedAsset, 'headingDeg'>): { x: number; y: number } {
  const az = (asset.headingDeg + 90) * DEG
  return { x: snap(Math.sin(az)), y: snap(Math.cos(az)) }
}

/** Nozzle positions of a bank: evenly spaced over spanM along heading + 90°. */
export function bankNozzleBases(asset: PositionedAsset, spec: FountainBankSpec): Vec3[] {
  const n = Math.max(1, Math.floor(spec.nozzles))
  const u = bankRowDir(asset)
  const out: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const s = n === 1 ? 0 : (i / (n - 1) - 0.5) * spec.spanM
    out.push({ x: asset.pos.x + u.x * s, y: asset.pos.y + u.y * s, z: asset.elevationM })
  }
  return out
}

/** The bank spec a fountain cue rides (asset spec, else the default). */
export function fountainBankSpecOf(asset: PositionedAsset | undefined): FountainBankSpec {
  return asset?.fountainBank ?? DEFAULT_FOUNTAIN_BANK
}

/**
 * Crest height of a cue's columns: params.heightM when given (site validation
 * reports overshoot of the bank maximum; the value is never clamped here so
 * the anticipation stays honest to the request), else the effect's height.
 */
export function fountainCrestM(effect: FountainEffect, params: CueParams | undefined): number {
  const p = params?.['heightM']
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : effect.heightM
}

/**
 * Indices of the nozzles a program engages: `params.nozzles` (else the
 * effect's count), 0 meaning the whole row, centered on the row (an odd
 * remainder leaves the extra idle nozzle at the row's high-index end) and
 * clamped to it. Cascades, waves, and mist always take the whole row.
 */
export function engagedNozzles(
  effect: FountainEffect,
  params: CueParams | undefined,
  spec: FountainBankSpec,
): number[] {
  const total = Math.max(1, Math.floor(spec.nozzles))
  if (effect.jet === 'cascade' || effect.jet === 'wave' || effect.jet === 'mist') {
    return Array.from({ length: total }, (_, i) => i)
  }
  const raw = params?.['nozzles']
  const want = typeof raw === 'number' && raw >= 0 ? Math.floor(raw) : effect.nozzles
  const k = want === 0 ? total : clamp(want, 1, total)
  const first = Math.floor((total - k) / 2)
  return Array.from({ length: k }, (_, i) => first + i)
}

/** One engaged nozzle's static geometry for a cue. */
export interface JetEnvelope {
  nozzle: number
  base: Vec3
  crestM: number
  /** Lateral crest offset (fanned columns), world meters. */
  tipDx: number
  tipDy: number
  /** Stagger of this column's crest after the cue's landing, seconds. */
  delaySec: Seconds
}

/** Optional context for envelope resolution. */
export interface JetEnvelopeOpts {
  /** Beat instants (MusicalTimeline.beats) so stepBeats runs on the real grid. */
  beats?: readonly Seconds[]
}

/** Fractional beat index of tSec on a sorted beat grid (extrapolated past the ends). */
function beatIndexAt(beats: readonly Seconds[], tSec: Seconds): number {
  const n = beats.length
  if (tSec <= beats[0]!) {
    const len = beats[1]! - beats[0]!
    return len > 0 ? (tSec - beats[0]!) / len : 0
  }
  if (tSec >= beats[n - 1]!) {
    const len = beats[n - 1]! - beats[n - 2]!
    return len > 0 ? n - 1 + (tSec - beats[n - 1]!) / len : n - 1
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (beats[mid]! <= tSec) lo = mid
    else hi = mid
  }
  const len = beats[hi]! - beats[lo]!
  return len > 0 ? lo + (tSec - beats[lo]!) / len : lo
}

/** Show time of a fractional beat index (extrapolated past the ends at the edge interval). */
function secAtBeatIndex(beats: readonly Seconds[], idx: number): Seconds {
  const n = beats.length
  if (idx <= 0) return beats[0]! + idx * (beats[1]! - beats[0]!)
  if (idx >= n - 1) return beats[n - 1]! + (idx - (n - 1)) * (beats[n - 1]! - beats[n - 2]!)
  const i = Math.floor(idx)
  return beats[i]! + (idx - i) * (beats[i + 1]! - beats[i]!)
}

/**
 * Show time exactly `count` beats after tSec on the grid: the tempo map's
 * own placement of those beats (interpolated between grid instants,
 * extrapolated at the edge interval). Without a usable grid, 1 s per beat.
 */
export function beatOffsetSec(
  beats: readonly Seconds[] | undefined,
  tSec: Seconds,
  count: Beats,
): Seconds {
  if (!beats || beats.length < 2) return tSec + count
  return secAtBeatIndex(beats, beatIndexAt(beats, tSec) + count)
}

/**
 * Seconds spanned by `count` beats starting at tSec on the grid (1 s/beat
 * without one) — the duration form of {@link beatOffsetSec}.
 */
export function beatsToSecAt(
  beats: readonly Seconds[] | undefined,
  tSec: Seconds,
  count: Beats,
): Seconds {
  if (!(count > 0)) return 0
  return beatOffsetSec(beats, tSec, count) - tSec
}

/** Cascade step (beats) a cue carries: params.stepBeats when positive, else the default. */
export function cascadeStepBeats(params: CueParams | undefined): Beats {
  const v = params?.['stepBeats']
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : FOUNTAIN_CASCADE_STEP_BEATS
}

/** Wave period (beats) a cue carries: params.periodBeats when positive, else the default. */
export function wavePeriodBeats(params: CueParams | undefined): Beats {
  const v = params?.['periodBeats']
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : FOUNTAIN_WAVE_PERIOD_BEATS
}

/**
 * Per-engaged-nozzle envelopes for a cue: crest, lean, stagger.
 * - plume / mist: vertical columns, no stagger;
 * - fan: columns lean outward symmetrically along the row, up to
 *   FOUNTAIN_FAN_MAX_LEAN_DEG at the row ends (tip offset = crest·tan(lean));
 *   a single engaged nozzle stays vertical;
 * - cascade: successive nozzles crest stepBeats apart ON THE BEAT GRID
 *   (column k crests at the grid time k·stepBeats beats after the landing);
 *   params.reverse walks the row from the high-index end;
 * - wave: no stagger here — the traveling modulation is time-varying and
 *   lives in the sim (sim/fountains waveFactor).
 */
export function jetEnvelopes(
  cue: CompiledCue,
  effect: FountainEffect,
  asset: PositionedAsset,
  opts: JetEnvelopeOpts = {},
): JetEnvelope[] {
  const spec = fountainBankSpecOf(asset)
  const bases = bankNozzleBases(asset, spec)
  const idx = engagedNozzles(effect, cue.params, spec)
  const crest = fountainCrestM(effect, cue.params)
  const u = bankRowDir(asset)
  const stepBeats = cascadeStepBeats(cue.params)
  const reverse = cue.params?.['reverse'] === true
  const mid = (idx.length - 1) / 2

  return idx.map((nozzle, k) => {
    let tipDx = 0
    let tipDy = 0
    if (effect.jet === 'fan' && idx.length > 1) {
      const lean = ((k - mid) / mid) * FOUNTAIN_FAN_MAX_LEAN_DEG * DEG
      const off = crest * Math.tan(lean)
      tipDx = u.x * off
      tipDy = u.y * off
    }
    const order = reverse ? idx.length - 1 - k : k
    const delaySec =
      effect.jet === 'cascade' && order > 0
        ? beatOffsetSec(opts.beats, cue.targetSec, order * stepBeats) - cue.targetSec
        : 0
    return { nozzle, base: bases[nozzle]!, crestM: crest, tipDx, tipDy, delaySec }
  })
}
