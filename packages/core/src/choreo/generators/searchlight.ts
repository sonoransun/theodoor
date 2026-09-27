/**
 * Searchlight figure geometry — SINGLE OWNER of where a bank's heads aim.
 *
 * A figure resolves, per head and per instant, to a UNIT direction in the
 * world frame (x east, y north, z up). The alignment solver takes the
 * opening aims (t = targetSec) to solve the head slew; the sim slews the
 * heads from their previous aim onto the figure and then follows it through
 * its hold; site validation checks every aim's tilt and elevation; the DMX
 * exporter turns the same directions into pan/tilt bytes. Nothing else may
 * derive an aim.
 *
 * Head positions: evenly spaced over spanM along headingDeg + 90° (the ROW),
 * centered on the asset position, at z = elevationM.
 *
 * THE HEAD MODEL is a two-axis gimbal, two rotations applied in a fixed order
 * (never a small-angle sum): a LEAN of λ along the row (about the heading axis) followed
 * by a TILT of θ toward the bank heading (rotation about the row axis):
 *   dir = sin λ · rowDir + cos λ · sin θ · headingDir + cos λ · cos θ · up
 * which is unit by construction, reduces to a plain tilt when λ = 0 and to a
 * plain lean when θ = 0, and has tilt-from-vertical acos(cos λ · cos θ).
 * Row figures (fan, sweep, cross) lean along the row; the shared tiltDeg
 * param tips the whole figure toward the heading (away from the audience
 * when the bank faces the display, as lakesidePark's banks do).
 *
 * Beat-locked figures (sweep, chase) run on FRACTIONAL beats since the cue's
 * landing — continuous across beat boundaries and extrapolated with the edge
 * beat length past either end of the grid (sim/lasers beatPhase, made
 * unbounded) — so a sweep never stutters at a bar line or freezes when the
 * music ends before the hold does. Without a grid, one beat is one second.
 */

import type {
  Beats,
  CompiledCue,
  PositionedAsset,
  SearchlightBankSpec,
  SearchlightEffect,
  Seconds,
  Vec3,
} from '../../contracts.js'
import { clamp } from '../../math/curves.js'

const DEG = Math.PI / 180

/** Parked heads point straight up. */
export const LIGHT_PARK_DIR: Vec3 = { x: 0, y: 0, z: 1 }
/** Default full fan spread across the row when no params.spreadDeg is set, degrees. */
export const LIGHT_FAN_SPREAD_DEG = 60
/** Default cross lean when no params.spreadDeg is set, degrees. */
export const LIGHT_CROSS_LEAN_DEG = 40
/** Default sweep amplitude when no params.sweepDeg is set, degrees. */
export const LIGHT_SWEEP_DEG = 35
/** Default sweep / chase period when no params.periodBeats is set, beats. */
export const LIGHT_PERIOD_BEATS: Beats = 8
/** Default converge point altitude when params.aimZ is absent, meters. */
export const LIGHT_CONVERGE_ALT_M = 160
/** Off-heads in a chase glow at this intensity. */
export const LIGHT_CHASE_IDLE = 0.15
/** Fallback bank spec for a cue whose position carries none. */
export const DEFAULT_SEARCHLIGHT_BANK: SearchlightBankSpec = {
  heads: 1,
  spanM: 0,
  slewRateDegPerSec: 60,
  maxTiltDeg: 75,
  minElevationDeg: 15,
}

/** Snap float dust (|v| < 1e-12, and −0) to an exact 0 so cardinal azimuths stay exact. */
const snap = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v)

/** Horizontal unit vector toward a compass azimuth (degrees clockwise from north). */
export function azimuthDir(azimuthDeg: number): Vec3 {
  const az = azimuthDeg * DEG
  return { x: snap(Math.sin(az)), y: snap(Math.cos(az)), z: 0 }
}

/** Head positions of a bank: evenly spaced over spanM along heading + 90°. */
export function bankHeadBases(asset: PositionedAsset, spec: SearchlightBankSpec): Vec3[] {
  const n = Math.max(1, Math.floor(spec.heads))
  const row = azimuthDir(asset.headingDeg + 90)
  const out: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const s = n === 1 ? 0 : (i / (n - 1) - 0.5) * spec.spanM
    out.push({ x: asset.pos.x + row.x * s, y: asset.pos.y + row.y * s, z: asset.elevationM })
  }
  return out
}

/** The bank spec a searchlight cue rides (asset spec, else the default). */
export function searchlightBankSpecOf(asset: PositionedAsset | undefined): SearchlightBankSpec {
  return asset?.searchlightBank ?? DEFAULT_SEARCHLIGHT_BANK
}

/**
 * Unit direction tilted `tiltDeg` from vertical toward `azimuthDeg` (cw from
 * north). Negative tilts lean the opposite way (toward azimuth + 180°).
 */
export function dirFromTilt(tiltDeg: number, azimuthDeg: number): Vec3 {
  const th = tiltDeg * DEG
  const a = azimuthDir(azimuthDeg)
  const s = Math.sin(th)
  return { x: snap(a.x * s), y: snap(a.y * s), z: Math.cos(th) }
}

/**
 * The gimbal rotation order (see the header): lean λ along `leanAzDeg`, then
 * tilt θ toward `tiltAzDeg`. Exact and unit for any angles; the two azimuths
 * are the bank's row and heading (perpendicular) in every figure here.
 */
export function leanAndTilt(leanDeg: number, leanAzDeg: number, tiltDeg: number, tiltAzDeg: number): Vec3 {
  const l = leanDeg * DEG
  const t = tiltDeg * DEG
  const row = azimuthDir(leanAzDeg)
  const head = azimuthDir(tiltAzDeg)
  const sl = Math.sin(l)
  const cl = Math.cos(l)
  const st = Math.sin(t)
  const ct = Math.cos(t)
  return {
    x: snap(sl * row.x + cl * st * head.x),
    y: snap(sl * row.y + cl * st * head.y),
    z: cl * ct,
  }
}

/** Tilt from vertical of a unit direction, degrees (0 = straight up). */
export function tiltDegOf(dir: Vec3): number {
  return Math.acos(clamp(dir.z, -1, 1)) / DEG
}

/** Elevation above the horizontal of a unit direction, degrees (90 = up). */
export function elevationDegOf(dir: Vec3): number {
  return Math.asin(clamp(dir.z, -1, 1)) / DEG
}

/**
 * World azimuth (cw from north, in (−180, 180]) of a direction's ground
 * projection, degrees; 0 for a vertical direction (no ground projection).
 */
export function azimuthDegOf(dir: Vec3): number {
  if (Math.hypot(dir.x, dir.y) < 1e-9) return 0
  return Math.atan2(dir.x, dir.y) / DEG
}

/**
 * Angle between two unit directions, degrees — via atan2(|a × b|, a · b),
 * which is exact for identical inputs (acos(1 − ε) would report ~1e-6°).
 */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const cx = a.y * b.z - a.z * b.y
  const cy = a.z * b.x - a.x * b.z
  const cz = a.x * b.y - a.y * b.x
  return Math.atan2(Math.hypot(cx, cy, cz), a.x * b.x + a.y * b.y + a.z * b.z) / DEG
}

/** Normalize, falling back to the park direction for a zero vector. */
export function normalizeDir(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z)
  return l > 0 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { ...LIGHT_PARK_DIR }
}

/** A unit vector perpendicular to `a` (deterministic choice). */
function perpendicular(a: Vec3): Vec3 {
  // Cross with whichever world axis a is least aligned with.
  const ax = Math.abs(a.x)
  const ay = Math.abs(a.y)
  const az = Math.abs(a.z)
  const ref: Vec3 = ax <= ay && ax <= az ? { x: 1, y: 0, z: 0 } : ay <= az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }
  return normalizeDir({
    x: a.y * ref.z - a.z * ref.y,
    y: a.z * ref.x - a.x * ref.z,
    z: a.x * ref.y - a.y * ref.x,
  })
}

/**
 * Spherical interpolation between unit directions (u clamped to [0, 1]).
 * Identical endpoints return `a`; near-antipodal endpoints (a head asked to
 * flip through the ground — physically impossible on a bank, but never a
 * NaN) travel a deterministic perpendicular great circle. Output is unit.
 */
export function slerpDir(a: Vec3, b: Vec3, u: number): Vec3 {
  const t = clamp(u, 0, 1)
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1)
  const omega = Math.acos(dot)
  if (omega < 1e-9) return { x: a.x, y: a.y, z: a.z }
  if (Math.PI - omega < 1e-6) {
    const p = perpendicular(a)
    const c = Math.cos(t * Math.PI)
    const s = Math.sin(t * Math.PI)
    return normalizeDir({ x: a.x * c + p.x * s, y: a.y * c + p.y * s, z: a.z * c + p.z * s })
  }
  const so = Math.sin(omega)
  const wa = Math.sin((1 - t) * omega) / so
  const wb = Math.sin(t * omega) / so
  return normalizeDir({ x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb })
}

/**
 * Fractional beat index of `t` on a sorted beat grid — beats[k] ↦ k,
 * linear between beats, and EXTRAPOLATED with the edge beat length outside
 * the array (unlike the clamped sim/lasers beatPhase) so beat-locked motion
 * stays continuous when a hold outlives the music. Fewer than two beats
 * (or a degenerate interval) fall back to 1 s per beat from beats[0] or 0.
 */
export function beatIndexAt(beats: readonly Seconds[] | undefined, t: Seconds): number {
  if (!beats || beats.length === 0) return t
  const n = beats.length
  if (n === 1) return t - beats[0]!
  if (t <= beats[0]!) {
    const len = beats[1]! - beats[0]!
    return len > 0 ? (t - beats[0]!) / len : t - beats[0]!
  }
  if (t >= beats[n - 1]!) {
    const len = beats[n - 1]! - beats[n - 2]!
    return n - 1 + (len > 0 ? (t - beats[n - 1]!) / len : t - beats[n - 1]!)
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (beats[mid]! <= t) lo = mid
    else hi = mid
  }
  const a = beats[lo]!
  const b = beats[hi]!
  return b > a ? lo + (t - a) / (b - a) : lo
}

/**
 * Fractional beats elapsed from `startSec` to `tSec` (negative before the
 * start). One beat = one second without a usable grid.
 */
export function fractionalBeatsSince(
  beats: readonly Seconds[] | undefined,
  startSec: Seconds,
  tSec: Seconds,
): number {
  if (!beats || beats.length < 2) return tSec - startSec
  return beatIndexAt(beats, tSec) - beatIndexAt(beats, startSec)
}

/** Optional context for aim resolution. */
export interface FigureOpts {
  /** Beat instants (MusicalTimeline.beats) for periodBeats figures. */
  beats?: readonly Seconds[]
}

const num = (cue: CompiledCue, key: string): number | undefined => {
  const v = cue.params?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** params.periodBeats when positive, else the default. */
export function figurePeriodBeats(cue: CompiledCue): Beats {
  const p = num(cue, 'periodBeats')
  return p !== undefined && p > 0 ? p : LIGHT_PERIOD_BEATS
}

/** Cycle phase of a beat-locked figure at tSec: fractional beats since landing over the period. */
export function figurePhaseAt(cue: CompiledCue, tSec: Seconds, opts: FigureOpts = {}): number {
  return fractionalBeatsSince(opts.beats, cue.targetSec, tSec) / figurePeriodBeats(cue)
}

/**
 * Per-head unit aims of a figure at show time tSec (the caller owns the slew
 * onto them). Row azimuth = heading + 90°; tiltDeg (default 0) tips every
 * row figure toward the heading through {@link leanAndTilt}.
 * - pillar:   every head tilted tiltDeg toward the heading;
 * - converge: every head aims at (aimX, aimY, aimZ) — defaults: x = 0, the
 *             bank's own y, LIGHT_CONVERGE_ALT_M up (tiltDeg ignored);
 * - fan:      heads lean symmetrically along the row to ±spreadDeg/2 (default
 *             LIGHT_FAN_SPREAD_DEG; a negative spread mirrors the fan);
 * - sweep:    every head leans sweepDeg · sin(2π · phase) along the row
 *             (defaults LIGHT_SWEEP_DEG / LIGHT_PERIOD_BEATS; a negative
 *             sweepDeg mirrors the motion);
 * - cross:    heads alternate ±spreadDeg (default LIGHT_CROSS_LEAN_DEG) along
 *             the row so neighbours cross over the bank (negative flips);
 * - chase:    heads as a pillar; the lit head advances (figureIntensityAt).
 */
export function figureAimsAt(
  cue: CompiledCue,
  effect: SearchlightEffect,
  asset: PositionedAsset,
  tSec: Seconds,
  opts: FigureOpts = {},
): Vec3[] {
  const spec = searchlightBankSpecOf(asset)
  const bases = bankHeadBases(asset, spec)
  const n = bases.length
  const rowAz = asset.headingDeg + 90
  const headAz = asset.headingDeg
  const tilt = num(cue, 'tiltDeg') ?? 0
  const mid = (n - 1) / 2

  switch (effect.figure) {
    case 'pillar':
    case 'chase':
      return bases.map(() => dirFromTilt(tilt, headAz))
    case 'converge': {
      const target: Vec3 = {
        x: num(cue, 'aimX') ?? 0,
        y: num(cue, 'aimY') ?? asset.pos.y,
        z: num(cue, 'aimZ') ?? LIGHT_CONVERGE_ALT_M,
      }
      return bases.map((b) => normalizeDir({ x: target.x - b.x, y: target.y - b.y, z: target.z - b.z }))
    }
    case 'fan': {
      const spread = num(cue, 'spreadDeg') ?? LIGHT_FAN_SPREAD_DEG
      return bases.map((_, i) => {
        const lean = n > 1 ? ((i - mid) / mid) * (spread / 2) : 0
        return leanAndTilt(lean, rowAz, tilt, headAz)
      })
    }
    case 'sweep': {
      const amp = num(cue, 'sweepDeg') ?? LIGHT_SWEEP_DEG
      const lean = amp * Math.sin(2 * Math.PI * figurePhaseAt(cue, tSec, opts))
      return bases.map(() => leanAndTilt(lean, rowAz, tilt, headAz))
    }
    case 'cross': {
      const lean = num(cue, 'spreadDeg') ?? LIGHT_CROSS_LEAN_DEG
      return bases.map((_, i) => leanAndTilt(i % 2 === 0 ? lean : -lean, rowAz, tilt, headAz))
    }
  }
}

/**
 * Index of the lit head in a chase at tSec: the cycle phase runs the row
 * once per period, one head per period/heads, wrapping — a pure function of
 * (cue, tSec, grid), so seek and chunked advance agree.
 */
export function chaseLitHead(cue: CompiledCue, heads: number, tSec: Seconds, opts: FigureOpts = {}): number {
  const n = Math.max(1, Math.floor(heads))
  const phase = figurePhaseAt(cue, tSec, opts)
  const frac = phase - Math.floor(phase)
  return Math.min(n - 1, Math.floor(frac * n))
}

/**
 * Per-head lamp intensity of the figure itself (before strike/fade
 * envelopes): 1 for every figure except 'chase', where one head at a time
 * is lit ({@link chaseLitHead}) and the rest idle at LIGHT_CHASE_IDLE.
 */
export function figureIntensityAt(
  cue: CompiledCue,
  effect: SearchlightEffect,
  asset: PositionedAsset,
  head: number,
  tSec: Seconds,
  opts: FigureOpts = {},
): number {
  if (effect.figure !== 'chase') return 1
  const spec = searchlightBankSpecOf(asset)
  return head === chaseLitHead(cue, spec.heads, tSec, opts) ? 1 : LIGHT_CHASE_IDLE
}

/**
 * Sweep extremes inside a window: the show times in [fromSec, toSec] where a
 * sweep figure's |lean| peaks (phase ≡ ¼ or ¾ of a period), for validation
 * sampling. Empty for non-sweep figures or a degenerate window.
 */
export function sweepExtremeTimes(
  cue: CompiledCue,
  effect: SearchlightEffect,
  fromSec: Seconds,
  toSec: Seconds,
  opts: FigureOpts = {},
): Seconds[] {
  if (effect.figure !== 'sweep' || !(toSec > fromSec)) return []
  const out: Seconds[] = []
  // Walk quarter-periods in beat space from the landing, both directions
  // bounded by the window, converting back through the grid by bisection
  // (the grid is monotone) — exact on uniform grids, tight on tempo maps.
  const phaseAt = (t: Seconds): number => figurePhaseAt(cue, t, opts)
  const pFrom = phaseAt(fromSec)
  const pTo = phaseAt(toSec)
  const first = Math.ceil((pFrom - 0.25) * 2) // k such that 0.25 + k/2 ≥ pFrom
  for (let k = first; k < 4096; k++) {
    const target = 0.25 + k / 2
    if (target > pTo) break
    // Bisect t in [fromSec, toSec] for phase(t) = target (phase is monotone in t).
    let lo = fromSec
    let hi = toSec
    for (let i = 0; i < 48; i++) {
      const midT = (lo + hi) / 2
      if (phaseAt(midT) < target) lo = midT
      else hi = midT
    }
    out.push((lo + hi) / 2)
  }
  return out
}
