/**
 * acoustics/beams — aim, ground footprint, and audibility geometry for the
 * steerable directional-audio arrays ("audio spotlights").
 *
 * Single owner of beam geometry: the alignment solver, sim, site validation,
 * the exposure report, and viz all consume this file (import it directly,
 * never through barrels). A beam cue aims a cone from the array head at a
 * ground target resolved from cue params (crowd-grid cells); the audible
 * region is the cone's intersection with the audience plane at ear height —
 * an ellipse. Listeners outside the footprint hear the in-beam level minus a
 * fixed leakage suppression; power summation makes distant leakage
 * self-erasing next to any in-beam source.
 *
 * Frames: world x = east, y = north; azimuth is degrees clockwise from north;
 * pan is azimuth relative to the asset's headingDeg; tilt is negative when
 * pointing below the horizontal (arrays aim down at the crowd).
 */

import type {
  BeamEffect,
  BeamFootprint,
  CompiledCue,
  CompiledShow,
  PositionedAsset,
  Seconds,
  SitePlan,
  Vec2,
} from '../contracts.js'
import { SPEED_OF_SOUND_MPS, SPL_REF_DISTANCE_M } from '../contracts.js'
import { clamp, dist2, v2 } from '../math/index.js'
import { crowdGridFor } from '../site/crowdGrid.js'
import { formationFromEffect } from '../choreo/generators/fromEffect.js'
import { splAtDistance, type EffectLookup } from './spl.js'

/** Out-of-footprint suppression, dB (applied to the slant-propagated level). */
export const BEAM_LEAKAGE_DB = 20
/** A footprint must clear the horizon by this depression margin, degrees. */
export const BEAM_HORIZON_MARGIN_DEG = 2
/** Steering-feasibility headroom: required slew ≤ rate / this margin. */
export const BEAM_SLEW_MARGIN = 1.1
/** Listener ear height above the ground plane, meters. */
export const EAR_HEIGHT_M = 1.6

const DEG = Math.PI / 180

/** Wrap an angle to (-180, 180]. */
function wrap180(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180
  return w === -180 ? 180 : w
}

/** Resolved steering state toward one ground target. */
export interface BeamAim {
  /** Azimuth relative to the asset heading, degrees, wrapped to ±180. */
  panDeg: number
  /** Negative below the horizontal (aiming down at the crowd). */
  tiltDeg: number
  /** World azimuth of the target, degrees clockwise from north. */
  azimuthDeg: number
  /** Head-to-ear slant distance, meters. */
  slantM: number
}

/** Optional context for target resolution. */
export interface BeamTargetOpts {
  /** Beat instants (MusicalTimeline.beats) for periodBeats conversion. */
  beats?: readonly Seconds[]
  /** Ground point of a tagged source cue (sourceTag program). */
  sourceGround?: Vec2
}

/**
 * Per-cue source-ground track for sourceTag programs: the tagged cue's ground
 * point while that SOURCE cue is active, undefined otherwise (callers fall
 * back to targetCellId via beamTargetAt).
 */
export type SourceGroundResolver = (beamCue: CompiledCue, tSec: Seconds) => Vec2 | undefined

/**
 * SINGLE OWNER of sourceTag ground-track resolution — the sim engine, the
 * steering exporter, the exposure gate, and the per-listener SPL samplers all
 * build their resolver here, so every consumer aims a tagged beam at the SAME
 * deterministic trajectory.
 *
 * A beam cue's `params.sourceCueId` resolves to the tagged cue's ground point
 * during ITS active window `[targetSec, targetSec + durationSec)`:
 * - drone source → its pad position plus the ground (x/y) centroid of
 *   formationFromEffect(effect, params, seed) — the formation the fleet holds
 *   over the source window (pad fallback mirrors sim/drones derivePadTimelines:
 *   positionId when it names a fleet-bearing dronePad, else the first one);
 * - pyro source → the source cue's rack asset position.
 * Outside the source window, or when the reference/asset does not resolve,
 * the resolver returns undefined. Pure and deterministic: a precomputed
 * lookup over (compiled, catalog) with no engine state.
 */
export function sourceGroundResolver(
  compiled: CompiledShow,
  getEffect: EffectLookup,
): SourceGroundResolver {
  const site = compiled.show.site
  const pads = site.assets.filter((a) => a.kind === 'dronePad' && a.fleet !== undefined)
  const sources = new Map<string, { start: Seconds; end: Seconds; ground: Vec2 }>()

  for (const cue of compiled.cues) {
    let ground: Vec2 | undefined
    if (cue.medium === 'pyro') {
      const rack =
        cue.positionId !== undefined
          ? site.assets.find((a) => a.id === cue.positionId)
          : undefined
      if (rack) ground = v2(rack.pos.x, rack.pos.y)
    } else if (cue.medium === 'drone') {
      const effect = getEffect(cue.effectId)
      if (!effect || effect.medium !== 'drone') continue
      const pad =
        (cue.positionId !== undefined
          ? pads.find((p) => p.id === cue.positionId)
          : undefined) ?? pads[0]
      if (!pad) continue
      const points = formationFromEffect(effect, cue.params, cue.seed).points
      let sx = 0
      let sy = 0
      for (const p of points) {
        sx += p.x
        sy += p.y
      }
      const n = Math.max(1, points.length)
      ground = v2(pad.pos.x + sx / n, pad.pos.y + sy / n)
    } else {
      continue
    }
    if (ground === undefined) continue
    sources.set(cue.id, {
      start: cue.targetSec,
      end: cue.targetSec + cue.durationSec,
      ground,
    })
  }

  return (beamCue, tSec) => {
    const ref = beamCue.params?.['sourceCueId']
    if (typeof ref !== 'string') return undefined
    const src = sources.get(ref)
    if (!src) return undefined
    return tSec >= src.start && tSec < src.end ? src.ground : undefined
  }
}

/**
 * The asset a beam cue steers: its `positionId` in the site, falling back to
 * a ground-level stand-in at the origin (never throws — validation flags
 * dangling position ids elsewhere; the stand-in footprint is always undefined
 * so the cue is leakage-suppressed everywhere).
 */
export function beamSourceAsset(cue: CompiledCue, site: SitePlan): PositionedAsset {
  if (cue.positionId !== undefined) {
    for (const asset of site.assets) {
      if (asset.id === cue.positionId) return asset
    }
  }
  return { id: cue.positionId ?? '', kind: 'beamArray', pos: v2(0, 0), headingDeg: 0, elevationM: 0 }
}

/** Beats elapsed since startSec: counted on the grid, or 1 s/beat without one. */
function beatsElapsed(
  beats: readonly Seconds[] | undefined,
  startSec: Seconds,
  tSec: Seconds,
): number {
  if (!(tSec > startSec)) return 0
  if (beats && beats.length > 0) {
    let n = 0
    for (const b of beats) {
      if (b > tSec) break
      if (b > startSec) n++
    }
    return n
  }
  return tSec - startSec
}

/**
 * Resolve a beam cue's ground aim at show time `tSec`.
 *
 * Param resolution (cells are crowd-grid indices, see site/crowdGrid.ts):
 * - sourceTag program: `opts.sourceGround`, else `targetCellId`, else the
 *   audience-zone centroid.
 * - pingPong program with `pathCellIds`: alternates first/last cell every
 *   `periodBeats` beats (opts.beats converts; 1 s/beat without a grid).
 * - `targetCellId`: that cell's centroid.
 * - `pathCellIds`: piecewise-linear sweep along the cell centroids over the
 *   active window `[targetSec, targetSec + durationSec)` (clamped outside).
 * - `cells === 'all'` (or anything unresolvable): audience-zone centroid
 *   (mean of cell centroids; polygon-vertex mean without a grid).
 */
export function beamTargetAt(
  cue: CompiledCue,
  effect: BeamEffect,
  site: SitePlan,
  tSec: Seconds,
  opts?: BeamTargetOpts,
): Vec2 {
  const grid = crowdGridFor(site)
  const params = cue.params

  const centroidOf = (index: number): Vec2 | undefined => {
    if (!grid) return undefined
    const cell = grid.cells[index]
    return cell && cell.index === index ? cell.centroid : undefined
  }
  const zoneCentroid = (): Vec2 => {
    if (grid && grid.cells.length > 0) {
      let sx = 0
      let sy = 0
      for (const c of grid.cells) {
        sx += c.centroid.x
        sy += c.centroid.y
      }
      return v2(sx / grid.cells.length, sy / grid.cells.length)
    }
    if (site.audienceZone.length > 0) {
      let sx = 0
      let sy = 0
      for (const p of site.audienceZone) {
        sx += p.x
        sy += p.y
      }
      return v2(sx / site.audienceZone.length, sy / site.audienceZone.length)
    }
    return v2(0, 0)
  }

  const rawTarget = params?.targetCellId
  const rawPath = params?.pathCellIds
  const targetCell = typeof rawTarget === 'number' ? centroidOf(rawTarget) : undefined
  const path = Array.isArray(rawPath)
    ? rawPath
        .filter((x): x is number => typeof x === 'number')
        .map(centroidOf)
        .filter((p): p is Vec2 => p !== undefined)
    : undefined

  if (effect.program === 'sourceTag') {
    return opts?.sourceGround ?? targetCell ?? zoneCentroid()
  }
  if (effect.program === 'pingPong' && path && path.length > 0) {
    const periodBeats =
      typeof params?.periodBeats === 'number' && params.periodBeats > 0 ? params.periodBeats : 1
    const phase = Math.floor(beatsElapsed(opts?.beats, cue.targetSec, tSec) / periodBeats) % 2
    return phase === 0 ? path[0]! : path[path.length - 1]!
  }
  if (targetCell) return targetCell
  if (path && path.length > 0) {
    if (path.length === 1) return path[0]!
    const u =
      cue.durationSec > 0 ? clamp((tSec - cue.targetSec) / cue.durationSec, 0, 1) : 0
    const s = u * (path.length - 1)
    const i = Math.min(path.length - 2, Math.floor(s))
    const f = s - i
    const a = path[i]!
    const b = path[i + 1]!
    return v2(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
  }
  return zoneCentroid()
}

/** Steering state (pan/tilt/azimuth/slant) from an asset toward a ground target. */
export function beamAimAt(asset: PositionedAsset, target: Vec2): BeamAim {
  const dx = target.x - asset.pos.x
  const dy = target.y - asset.pos.y
  const azimuthDeg = Math.atan2(dx, dy) / DEG
  const groundM = Math.hypot(dx, dy)
  const h = asset.elevationM - EAR_HEIGHT_M
  return {
    panDeg: wrap180(azimuthDeg - asset.headingDeg),
    tiltDeg: -Math.atan2(h, groundM) / DEG,
    azimuthDeg,
    slantM: Math.hypot(groundM, h),
  }
}

/**
 * Cone ∩ ear-height-plane ellipse for a beam aimed at `target`.
 *
 * With h = elevation above ear height, ε = depression to the target and
 * α = half the beam width: the footprint spans ground distances
 * `h/tan(ε+α) … h/tan(ε−α)` along the aim azimuth, with cross semi-axis
 * `slant·tan(α)`. Undefined when ε < α + BEAM_HORIZON_MARGIN_DEG — the upper
 * cone edge (nearly) escapes over the horizon and there is no bounded
 * footprint; site validation reports that aim as infeasible.
 */
export function beamFootprintAt(
  asset: PositionedAsset,
  effect: BeamEffect,
  target: Vec2,
): BeamFootprint | undefined {
  const h = asset.elevationM - EAR_HEIGHT_M
  const d = dist2(asset.pos, target)
  const eps = Math.atan2(h, d)
  const alpha = (effect.beamWidthDeg / 2) * DEG
  if (eps < alpha + BEAM_HORIZON_MARGIN_DEG * DEG) return undefined
  const dNear = h / Math.tan(eps + alpha)
  const dFar = h / Math.tan(eps - alpha)
  const aim = beamAimAt(asset, target)
  const azRad = aim.azimuthDeg * DEG
  const mid = (dNear + dFar) / 2
  return {
    cx: asset.pos.x + Math.sin(azRad) * mid,
    cy: asset.pos.y + Math.cos(azRad) * mid,
    a: (dFar - dNear) / 2,
    b: aim.slantM * Math.tan(alpha),
    azimuthDeg: aim.azimuthDeg,
  }
}

/** Point-in-ellipse test in the footprint's (along, cross) frame. */
export function inFootprint(fp: BeamFootprint, p: Vec2): boolean {
  if (!(fp.a > 0) || !(fp.b > 0)) return false
  const azRad = fp.azimuthDeg * DEG
  const dx = p.x - fp.cx
  const dy = p.y - fp.cy
  const along = dx * Math.sin(azRad) + dy * Math.cos(azRad)
  const cross = dx * Math.cos(azRad) - dy * Math.sin(azRad)
  return (along / fp.a) ** 2 + (cross / fp.b) ** 2 <= 1
}

/**
 * Audible level of one beam cue at a ground listener at show time `tSec`:
 * the in-beam reference level (`noiseDbAt15m + gainDb`) propagated over the
 * head-to-ear slant range, minus BEAM_LEAKAGE_DB outside the footprint.
 * An undefined footprint (horizon escape, ground-level stand-in asset) is
 * always leakage-suppressed.
 */
export function beamAudibleLevelAt(
  cue: CompiledCue,
  effect: BeamEffect,
  site: SitePlan,
  listener: Vec2,
  tSec: Seconds,
  opts?: BeamTargetOpts,
): number {
  const asset = beamSourceAsset(cue, site)
  const target = beamTargetAt(cue, effect, site, tSec, opts)
  const fp = beamFootprintAt(asset, effect, target)
  const h = asset.elevationM - EAR_HEIGHT_M
  const slantM = Math.hypot(dist2(asset.pos, listener), h)
  const gainDb = typeof cue.params?.gainDb === 'number' ? cue.params.gainDb : 0
  const level = splAtDistance(effect.noiseDbAt15m + gainDb, SPL_REF_DISTANCE_M, slantM)
  return fp !== undefined && inFootprint(fp, listener) ? level : level - BEAM_LEAKAGE_DB
}

/**
 * Landing time-of-flight for a beam cue, seconds: slant from the array head
 * to the cue's landing aim (resolved at targetSec) over SPEED_OF_SOUND_MPS.
 * `params.cells === 'all'` (the everywhere-at-once strike) takes the MAX
 * slant over all crowd-grid cells — fired that early, even the farthest cell
 * hears it on the beat, and per-cell emissions each carry their own lead.
 * SINGLE OWNER: the solver's beam anticipation and the sim's landing-error
 * cross-check both delegate here, so they can never disagree.
 */
export function beamLandingTofSec(
  cue: CompiledCue,
  effect: BeamEffect,
  site: SitePlan,
): Seconds {
  const asset = beamSourceAsset(cue, site)
  if (cue.params?.['cells'] === 'all') {
    const grid = crowdGridFor(site)
    if (grid) {
      let maxSlantM = 0
      for (const cell of grid.cells) {
        const slantM = beamAimAt(asset, cell.centroid).slantM
        if (slantM > maxSlantM) maxSlantM = slantM
      }
      return maxSlantM / SPEED_OF_SOUND_MPS
    }
  }
  const target = beamTargetAt(cue, effect, site, cue.targetSec)
  return beamAimAt(asset, target).slantM / SPEED_OF_SOUND_MPS
}

/**
 * Great-circle angle between two aim directions, degrees — the arc a head
 * must slew through between cues (checked against steerRateDegPerSec with
 * BEAM_SLEW_MARGIN headroom).
 */
export function angularDistanceDeg(
  aimA: { panDeg: number; tiltDeg: number },
  aimB: { panDeg: number; tiltDeg: number },
): number {
  const unit = (a: { panDeg: number; tiltDeg: number }): readonly [number, number, number] => {
    const pan = a.panDeg * DEG
    const tilt = a.tiltDeg * DEG
    const c = Math.cos(tilt)
    return [c * Math.sin(pan), c * Math.cos(pan), Math.sin(tilt)]
  }
  const va = unit(aimA)
  const vb = unit(aimB)
  const dot = clamp(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], -1, 1)
  return Math.acos(dot) / DEG
}
