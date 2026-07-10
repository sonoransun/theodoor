/**
 * site/validate.ts — SitePlan rule engine.
 *
 * Pure geometric validation of a site plan against a compiled show. Never
 * throws: every problem (including degenerate input geometry) is reported as
 * a `Diagnostic`. Effects are opaque catalog metadata looked up through the
 * injected `getEffect` — this module never imports the catalog.
 *
 * Rule codes emitted:
 *   'site-structure'  degenerate geometry (audience < 2 pts, polygons < 3 pts,
 *                     missing geofence while drone cues exist)
 *   'listener'        refListenerPos empty
 *   'wind'            wind above 80 % of limit (warning) / at-or-above limit (error)
 *   'separation'      launch point too close to the audience front line
 *   'fallout'         drifted fallout circle touches audience / exclusion zones
 *   'laser-horizon'   low-elevation scan can reach the audience below head height
 *   'geofence'        drone pad or formation bounding circle escapes the geofence
 *   'overflight'      formation bounding circle intersects the audience zone
 *   'altitude'        formation scale exceeds maxAltitudeM (warning)
 *   'crowd-structure' crowd cues without a usable crowd grid, a declared grid
 *                     that derives zero cells, or a crowd cue on a mast
 *                     without a crowdMast spec
 *   'crowd-coverage'  derived crowd cells outside every mast's coverage (warning)
 *   'beam-structure'  beam cue placed on an asset without a beamArray spec
 *   'beam-steer-range' beam aim pan/tilt outside the array's steering limits
 *   'beam-horizon'    beam aim too shallow for a bounded audible footprint
 *                     at either end of the active window
 *   'beam-focus'      aim or covered crowd cell nearer than the min focus
 *                     slant at either end of the active window
 *   'beam-pair'       pairId group without exactly 2 members, or split targets (warning)
 */
import { DRONE_BASE_ALTITUDE_M, SPEED_OF_SOUND_MPS } from '../contracts.js'
import { formationFromEffect } from '../choreo/index.js'
import {
  BEAM_HORIZON_MARGIN_DEG,
  beamAimAt,
  beamFootprintAt,
  beamTargetAt,
  inFootprint,
} from '../acoustics/beams.js'
import { coveredCellIndices, crowdGridFor } from './crowdGrid.js'
import type {
  BeamFootprint,
  CompiledCue,
  CompiledShow,
  Diagnostic,
  EffectDef,
  PositionedAsset,
  PyroEffect,
  Seconds,
  SitePlan,
  Vec2,
} from '../contracts.js'
import {
  circleIntersectsPolygon,
  dist2,
  distPointToPolygonBoundary,
  distPointToPolyline,
  pointInPolygon,
  v2,
} from '../math/index.js'

/** Effect lookup injected by the caller (catalog stays decoupled). */
export type GetEffect = (id: string) => EffectDef | undefined

const DEG = Math.PI / 180

/** NFPA-1123-style separation: ~70 ft per inch of shell ≈ 0.84 m per mm. */
const SEPARATION_M_PER_MM = 0.84
/** Fallout footprint safety factor over the burst radius. */
const FALLOUT_RADIUS_FACTOR = 1.25
/** Extra descent seconds added to rise + visible duration for fallout drift. */
const FALLOUT_DESCENT_PAD_SEC = 3
/** Wind warning threshold as a fraction of the site limit. */
const WIND_WARN_FRACTION = 0.8
/** Lasers scanning below this elevation are horizon hazards. */
const LASER_HORIZON_MARGIN_DEG = 3
/** Minimum beam height over the audience zone (head clearance). */
const HEAD_CLEARANCE_M = 3
/** Drone pads must sit at least this far inside the geofence boundary. */
const PAD_GEOFENCE_INSET_M = 1
/** Stereo-pair targets further apart than this break the phantom image. */
const BEAM_PAIR_MAX_TARGET_GAP_M = 5

/** Unit vector for a compass bearing (degrees clockwise from north; +y = north). */
const dirVec = (deg: number): Vec2 => v2(Math.sin(deg * DEG), Math.cos(deg * DEG))

const addScaled = (a: Vec2, d: Vec2, k: number): Vec2 => v2(a.x + d.x * k, a.y + d.y * k)

/** Compass azimuth (deg clockwise from north) of `to` as seen from `from`. */
const azimuthDeg = (from: Vec2, to: Vec2): number =>
  Math.atan2(to.x - from.x, to.y - from.y) / DEG

/** Wrap an angle difference into [-180, 180). */
const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString()

/**
 * Azimuth interval (center ± half, degrees) subtended by a polygon as seen
 * from `from`. A point inside the polygon subtends the full circle.
 */
function zoneAzimuthInterval(
  from: Vec2,
  poly: readonly Vec2[],
): { centerDeg: number; halfDeg: number } {
  if (pointInPolygon(from, poly)) return { centerDeg: 0, halfDeg: 180 }
  let cx = 0
  let cy = 0
  for (const p of poly) {
    cx += p.x
    cy += p.y
  }
  const ref = azimuthDeg(from, v2(cx / poly.length, cy / poly.length))
  let lo = 0
  let hi = 0
  for (const p of poly) {
    const d = wrap180(azimuthDeg(from, p) - ref)
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  return { centerDeg: ref + (lo + hi) / 2, halfDeg: (hi - lo) / 2 }
}

/** Launch point of a rack for a given effect: pos drifted downrange by tilt. */
function launchPoint(asset: PositionedAsset, effect: PyroEffect): Vec2 {
  const tiltDeg = asset.rack?.tiltDeg ?? 0
  if (tiltDeg === 0) return asset.pos
  const drift = Math.tan(tiltDeg * DEG) * effect.burstHeightM
  return addScaled(asset.pos, dirVec(asset.headingDeg), drift)
}

interface PyroGroup {
  asset: PositionedAsset
  effect: PyroEffect
  cueIds: string[]
  tSec: number
}

interface DroneGroup {
  asset: PositionedAsset
  radiusM: number
  topM?: number
  cueIds: string[]
  tSec: number
}

/**
 * Validate a site plan (optionally against a compiled show). Never throws;
 * all findings — including degenerate geometry — come back as diagnostics.
 */
export function validateSite(
  site: SitePlan,
  compiled: CompiledShow | null,
  getEffect: GetEffect,
): Diagnostic[] {
  const out: Diagnostic[] = []
  try {
    runRules(site, compiled?.cues ?? [], compiled?.show.music.beats ?? [], getEffect, out)
  } catch (err) {
    out.push({
      code: 'site-structure',
      severity: 'error',
      message: `site validation aborted on malformed input: ${String(err)}`,
    })
  }
  return out
}

function runRules(
  site: SitePlan,
  cues: readonly CompiledCue[],
  beats: readonly Seconds[],
  getEffect: GetEffect,
  out: Diagnostic[],
): void {
  const error = (code: string, message: string, extra?: Partial<Diagnostic>): void => {
    out.push({ code, severity: 'error', message, ...extra })
  }
  const warning = (code: string, message: string, extra?: Partial<Diagnostic>): void => {
    out.push({ code, severity: 'warning', message, ...extra })
  }

  const assetById = new Map<string, PositionedAsset>()
  for (const a of site.assets) assetById.set(a.id, a)

  // --- structure -----------------------------------------------------------
  if (site.audience.length < 2) {
    error('site-structure', `audience polyline needs at least 2 points (got ${site.audience.length})`)
  }
  if (site.audienceZone.length < 3) {
    error('site-structure', `audienceZone polygon needs at least 3 points (got ${site.audienceZone.length})`)
  }
  for (const ez of site.exclusionZones) {
    if (ez.poly.length < 3) {
      error('site-structure', `exclusion zone '${ez.id}' polygon needs at least 3 points (got ${ez.poly.length})`)
    }
  }
  const hasDroneCues = cues.some((c) => c.medium === 'drone')
  if (site.geofence.length < 3 && (site.geofence.length > 0 || hasDroneCues)) {
    error(
      'site-structure',
      site.geofence.length === 0
        ? 'geofence is empty but the show contains drone cues'
        : `geofence polygon needs at least 3 points (got ${site.geofence.length})`,
    )
  }

  // --- listener ------------------------------------------------------------
  if (site.refListenerPos.length < 1) {
    error('listener', 'refListenerPos must contain at least one SPL listener point')
  }

  // --- wind ----------------------------------------------------------------
  const w = site.wind
  if (w.speedMps >= w.limitMps) {
    error('wind', `wind ${fmt(w.speedMps)} m/s is at or above the site limit ${fmt(w.limitMps)} m/s`)
  } else if (w.speedMps > WIND_WARN_FRACTION * w.limitMps) {
    warning('wind', `wind ${fmt(w.speedMps)} m/s exceeds 80% of the site limit ${fmt(w.limitMps)} m/s`)
  }

  // --- separation + fallout (per rack × pyro effect) ------------------------
  const pyroGroups = new Map<string, PyroGroup>()
  for (const cue of cues) {
    if (cue.medium !== 'pyro' || cue.positionId === undefined) continue
    const asset = assetById.get(cue.positionId)
    if (!asset || asset.kind !== 'mortarRack') continue
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'pyro') {
      // An unresolvable pyro effect is precisely the cue whose separation and
      // fallout CANNOT be verified — it must fail the gate, not skip it.
      error(
        'separation',
        `rack '${asset.id}': pyro cue '${cue.id}' references effect '${cue.effectId}' ` +
          `that does not resolve to a pyro effect; cannot verify audience separation/fallout`,
        { assetId: asset.id, cueIds: [cue.id], tSec: cue.fireSec },
      )
      continue
    }
    const key = `${asset.id}\u0000${effect.id}`
    const g = pyroGroups.get(key)
    if (g) {
      g.cueIds.push(cue.id)
      g.tSec = Math.min(g.tSec, cue.fireSec)
    } else {
      pyroGroups.set(key, { asset, effect, cueIds: [cue.id], tSec: cue.fireSec })
    }
  }

  const windDrift = dirVec(w.dirDegFrom + 180) // wind blows TOWARD dirDegFrom + 180

  for (const g of pyroGroups.values()) {
    const launch = launchPoint(g.asset, g.effect)
    const requiredM = Math.max(g.effect.minAudienceDistanceM, SEPARATION_M_PER_MM * g.effect.caliberMm)
    const distM = distPointToPolyline(launch, site.audience)
    if (!(distM >= requiredM)) {
      error(
        'separation',
        `rack '${g.asset.id}': launch point for '${g.effect.id}' (${g.effect.caliberMm} mm) is ` +
          `${fmt(distM)} m from the audience line; requires ${fmt(requiredM)} m`,
        { assetId: g.asset.id, cueIds: g.cueIds, tSec: g.tSec },
      )
    }

    const airborneSec = g.effect.riseTimeSec + g.effect.durationSec + FALLOUT_DESCENT_PAD_SEC
    const centroid = addScaled(launch, windDrift, w.speedMps * airborneSec)
    const radiusM = g.effect.burstRadiusM * FALLOUT_RADIUS_FACTOR
    if (circleIntersectsPolygon(centroid, radiusM, site.audienceZone)) {
      error(
        'fallout',
        `rack '${g.asset.id}': fallout circle for '${g.effect.id}' (r=${fmt(radiusM)} m, ` +
          `drifted to ${fmt(centroid.x)},${fmt(centroid.y)}) intersects the audience zone`,
        { assetId: g.asset.id, cueIds: g.cueIds, tSec: g.tSec },
      )
    }
    for (const ez of site.exclusionZones) {
      if (circleIntersectsPolygon(centroid, radiusM, ez.poly)) {
        error(
          'fallout',
          `rack '${g.asset.id}': fallout circle for '${g.effect.id}' (r=${fmt(radiusM)} m) ` +
            `intersects exclusion zone '${ez.id}'`,
          { assetId: g.asset.id, cueIds: g.cueIds, tSec: g.tSec },
        )
      }
    }
  }

  // --- laser horizon ---------------------------------------------------------
  for (const asset of site.assets) {
    if (asset.kind !== 'laserTower' || !asset.laser) continue
    const spec = asset.laser
    if (spec.minElevationDeg >= LASER_HORIZON_MARGIN_DEG) continue
    if (site.audienceZone.length < 3) continue
    const zone = zoneAzimuthInterval(asset.pos, site.audienceZone)
    const overlaps =
      Math.abs(wrap180(zone.centerDeg - asset.headingDeg)) <= zone.halfDeg + spec.scanFovDeg / 2
    if (!overlaps) continue
    const dM = pointInPolygon(asset.pos, site.audienceZone)
      ? 0
      : distPointToPolygonBoundary(asset.pos, site.audienceZone)
    const el = spec.minElevationDeg * DEG
    const beamHeightM = asset.elevationM + dM * Math.tan(el)
    const reachM = spec.terminationM * Math.cos(el)
    if (beamHeightM < HEAD_CLEARANCE_M && reachM >= dM) {
      error(
        'laser-horizon',
        `laser '${asset.id}': scan floor ${fmt(spec.minElevationDeg)}° crosses the audience zone at ` +
          `${fmt(beamHeightM)} m beam height (< ${HEAD_CLEARANCE_M} m clearance at ${fmt(dM)} m)`,
        { assetId: asset.id },
      )
    }
  }

  // --- drone pads inside geofence -------------------------------------------
  for (const asset of site.assets) {
    if (asset.kind !== 'dronePad') continue
    const inset = distPointToPolygonBoundary(asset.pos, site.geofence)
    if (!pointInPolygon(asset.pos, site.geofence) || inset < PAD_GEOFENCE_INSET_M) {
      error(
        'geofence',
        `drone pad '${asset.id}' is not inside the geofence with a ${PAD_GEOFENCE_INSET_M} m margin`,
        { assetId: asset.id },
      )
    }
  }

  // --- drone formation containment / overflight / altitude -------------------
  const droneGroups = new Map<string, DroneGroup>()
  for (const cue of cues) {
    if (cue.medium !== 'drone' || cue.positionId === undefined) continue
    const asset = assetById.get(cue.positionId)
    if (!asset || asset.kind !== 'dronePad') continue
    const effect = getEffect(cue.effectId)
    // Footprint from the ACTUAL formation geometry (formationFromEffect — the
    // same single owner the solver and sim use), not from scaleM, whose
    // meaning varies by formation kind (e.g. meters-per-font-cell for text).
    let radiusM: number | undefined
    let topM: number | undefined
    if (effect && effect.medium === 'drone') {
      const formation = formationFromEffect(effect, cue.params, cue.seed)
      let halfW = 0
      let maxZ = 0
      for (const p of formation.points) {
        halfW = Math.max(halfW, Math.abs(p.x), Math.abs(p.y))
        maxZ = Math.max(maxZ, p.z)
      }
      const paramScale = cue.params?.['scaleM']
      const scale = typeof paramScale === 'number' ? paramScale : effect.scaleM
      radiusM = halfW
      topM = DRONE_BASE_ALTITUDE_M + scale / 2 + maxZ
    } else {
      const paramScale = cue.params?.['scaleM']
      if (typeof paramScale === 'number') radiusM = paramScale
    }
    if (radiusM === undefined) continue
    const key = `${asset.id}\u0000${radiusM.toFixed(3)}\u0000${(topM ?? 0).toFixed(3)}`
    const g = droneGroups.get(key)
    if (g) {
      g.cueIds.push(cue.id)
      g.tSec = Math.min(g.tSec, cue.fireSec)
    } else {
      droneGroups.set(key, { asset, radiusM, topM, cueIds: [cue.id], tSec: cue.fireSec })
    }
  }

  for (const g of droneGroups.values()) {
    const extra = { assetId: g.asset.id, cueIds: g.cueIds, tSec: g.tSec }
    const containsCircle =
      pointInPolygon(g.asset.pos, site.geofence) &&
      distPointToPolygonBoundary(g.asset.pos, site.geofence) >= g.radiusM
    if (!containsCircle) {
      error(
        'geofence',
        `formation bounding circle (r=${fmt(g.radiusM)} m) at pad '${g.asset.id}' is not contained by the geofence`,
        extra,
      )
    }
    if (circleIntersectsPolygon(g.asset.pos, g.radiusM, site.audienceZone)) {
      error(
        'overflight',
        `formation bounding circle (r=${fmt(g.radiusM)} m) at pad '${g.asset.id}' intersects the audience zone`,
        extra,
      )
    }
    const flightTopM = g.topM ?? g.radiusM
    if (site.maxAltitudeM < flightTopM) {
      warning(
        'altitude',
        `formation flight top ${fmt(flightTopM)} m exceeds maxAltitudeM ${fmt(site.maxAltitudeM)} m`,
        extra,
      )
    }
  }

  // --- crowd grid: structure + mast coverage ---------------------------------
  const crowdCueIds = cues.filter((c) => c.medium === 'crowd').map((c) => c.id)
  const grid = crowdGridFor(site)
  if (site.crowdGrid !== undefined && grid === undefined) {
    // Site-only: a declared grid that derives no cells is broken regardless of
    // whether a show is loaded — every crowd cue and beam target depends on it.
    error(
      'crowd-structure',
      !(site.crowdGrid.cellSizeM > 0)
        ? `crowdGrid cellSizeM must be positive (got ${fmt(site.crowdGrid.cellSizeM)})`
        : 'crowdGrid derives zero cells over the audience zone',
      crowdCueIds.length > 0 ? { cueIds: crowdCueIds } : undefined,
    )
  } else if (crowdCueIds.length > 0 && site.crowdGrid === undefined) {
    error(
      'crowd-structure',
      `show has ${crowdCueIds.length} crowd cue(s) but the site declares no crowdGrid`,
      { cueIds: crowdCueIds },
    )
  }

  if (grid) {
    const masts = site.assets.filter((a) => a.kind === 'crowdMast' && a.crowdMast)
    if (masts.length === 0) {
      warning(
        'crowd-coverage',
        `site has a crowdGrid but no crowd masts: all ${grid.cells.length} cells are outside coverage`,
      )
    } else {
      const uncovered = grid.cells.length - coveredCellIndices(site, grid).size
      if (uncovered > 0) {
        warning(
          'crowd-coverage',
          `${uncovered} of ${grid.cells.length} crowd cells lie outside every mast's coverage radius`,
        )
      }
    }
  }

  // A crowd cue on a mast that declares no crowdMast spec cannot be broadcast
  // (the sim/exporter would silently ride a different mast's latency spec) —
  // the crowd analogue of 'beam-structure' below.
  for (const cue of cues) {
    if (cue.medium !== 'crowd' || cue.positionId === undefined) continue
    const asset = assetById.get(cue.positionId)
    if (!asset || asset.kind !== 'crowdMast' || asset.crowdMast) continue
    error(
      'crowd-structure',
      `crowd cue '${cue.id}' is placed on '${asset.id}' (crowdMast) which has no crowdMast spec`,
      { assetId: asset.id, cueIds: [cue.id], tSec: cue.fireSec },
    )
  }

  // --- beam arrays: structure, steering, horizon, focus, pairs ----------------
  const pairGroups = new Map<string, { cueIds: string[]; targets: Vec2[]; tSec: number }>()

  for (const cue of cues) {
    if (cue.medium !== 'beam' || cue.positionId === undefined) continue
    const asset = assetById.get(cue.positionId)
    if (!asset) continue // dangling positionId is reported by show validation
    const extra = { assetId: asset.id, cueIds: [cue.id], tSec: cue.fireSec }
    const spec = asset.beamArray
    if (!spec) {
      error(
        'beam-structure',
        `beam cue '${cue.id}' is placed on '${asset.id}' (${asset.kind}) which has no beamArray spec`,
        extra,
      )
      continue
    }
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'beam') continue // unresolvable effect is reported elsewhere

    // Both ends of the active window, resolved on the show's beat grid so
    // pingPong endpoint aims match the sim's clock. Sweeps/pingPong move the
    // aim while the cue runs, so every windowed rule checks both endpoints
    // (one diagnostic per rule per cue, naming which end failed).
    const startTarget = beamTargetAt(cue, effect, site, cue.targetSec, { beats })
    const endTarget = beamTargetAt(cue, effect, site, cue.targetSec + cue.durationSec, { beats })
    const endpoints = ([['target', startTarget], ['window end', endTarget]] as const).map(
      ([label, target]) => ({
        label,
        target,
        aim: beamAimAt(asset, target),
        fp: beamFootprintAt(asset, effect, target),
      }),
    )

    // Steering limits at both ends of the active window.
    const halfPanDeg = spec.panRangeDeg / 2
    for (const { label, aim: a } of endpoints) {
      const panBad = Math.abs(a.panDeg) > halfPanDeg
      const tiltBad = a.tiltDeg < spec.tiltMinDeg || a.tiltDeg > spec.tiltMaxDeg
      if (panBad || tiltBad) {
        error(
          'beam-steer-range',
          `array '${asset.id}': aim at ${label} (pan ${fmt(a.panDeg)}°, tilt ${fmt(a.tiltDeg)}°) is outside ` +
            `pan ±${fmt(halfPanDeg)}° / tilt ${fmt(spec.tiltMinDeg)}°..${fmt(spec.tiltMaxDeg)}°`,
          extra,
        )
        break
      }
    }

    // Horizon: the aim must produce a bounded audible footprint at both ends.
    for (const { label, target, aim, fp } of endpoints) {
      if (fp !== undefined) continue
      error(
        'beam-horizon',
        `array '${asset.id}': aim at ${label} (${fmt(target.x)},${fmt(target.y)}) has no bounded footprint ` +
          `(depression ${fmt(-aim.tiltDeg)}° is within ${BEAM_HORIZON_MARGIN_DEG}° of the ` +
          `${fmt(effect.beamWidthDeg / 2)}° half-angle)`,
        extra,
      )
      break
    }

    // Focus: at each end of the window, neither the aim nor any crowd cell
    // caught by the wind-inflated footprint may sit nearer than the array's
    // minimum focus slant.
    focus: for (const { label, aim, fp } of endpoints) {
      if (aim.slantM < spec.minFocusDistanceM) {
        error(
          'beam-focus',
          `array '${asset.id}': aim slant at ${label} (${fmt(aim.slantM)} m) is under the ` +
            `${fmt(spec.minFocusDistanceM)} m minimum focus distance`,
          extra,
        )
        break
      }
      if (fp === undefined || !grid) continue
      // Validation-only wind inflation, mirroring the fallout drift model:
      // translate by wind × time-of-flight and pad both semi-axes.
      const growM = w.speedMps * (aim.slantM / SPEED_OF_SOUND_MPS)
      const inflated: BeamFootprint = {
        cx: fp.cx + windDrift.x * growM,
        cy: fp.cy + windDrift.y * growM,
        a: fp.a + growM,
        b: fp.b + growM,
        azimuthDeg: fp.azimuthDeg,
      }
      for (const cell of grid.cells) {
        if (!inFootprint(inflated, cell.centroid)) continue
        const slantM = beamAimAt(asset, cell.centroid).slantM
        if (slantM < spec.minFocusDistanceM) {
          error(
            'beam-focus',
            `array '${asset.id}': crowd cell ${cell.index} inside the wind-inflated footprint at ` +
              `${label} sits ${fmt(slantM)} m slant away (< ${fmt(spec.minFocusDistanceM)} m ` +
              `minimum focus distance)`,
            extra,
          )
          break focus
        }
      }
    }

    // Stereo-pair bookkeeping (checked after the loop).
    const pairId = cue.params?.['pairId']
    if (typeof pairId === 'string' || typeof pairId === 'number') {
      const key = String(pairId)
      const g = pairGroups.get(key)
      if (g) {
        g.cueIds.push(cue.id)
        g.targets.push(startTarget)
        g.tSec = Math.min(g.tSec, cue.fireSec)
      } else {
        pairGroups.set(key, { cueIds: [cue.id], targets: [startTarget], tSec: cue.fireSec })
      }
    }
  }

  for (const [pairId, g] of pairGroups) {
    if (g.cueIds.length !== 2) {
      warning(
        'beam-pair',
        `pairId '${pairId}' has ${g.cueIds.length} member cue(s); a stereo pair needs exactly 2`,
        { cueIds: g.cueIds, tSec: g.tSec },
      )
    } else {
      const gapM = dist2(g.targets[0]!, g.targets[1]!)
      if (gapM > BEAM_PAIR_MAX_TARGET_GAP_M) {
        warning(
          'beam-pair',
          `pairId '${pairId}' targets are ${fmt(gapM)} m apart (max ${BEAM_PAIR_MAX_TARGET_GAP_M} m)`,
          { cueIds: g.cueIds, tSec: g.tSec },
        )
      }
    }
  }
}
