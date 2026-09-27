/**
 * site/rules/searchlight.ts — SitePlan rules for the searchlight banks.
 *
 * Rule codes emitted (appended by site/validate.ts runRules):
 *   'light-structure' searchlight cue on an asset without a searchlightBank spec
 *   'light-tilt'      a head's aim exceeds the bank's maxTiltDeg from vertical
 *                     anywhere in the active window (error)
 *   'light-elevation' a head's aim dips below the bank's minElevationDeg while
 *                     its ground azimuth points into the audience zone — never
 *                     sweep the crowd's eyes (error)
 *
 * Aims are sampled through the SAME single-owner figure geometry the sim and
 * the DMX exporter use (choreo/generators/searchlight figureAimsAt): the
 * window's start, end, LIGHT_RULE_SAMPLES interior points on the show's real
 * beat grid, and — for sweeps — every analytic lean extreme inside the window
 * (sweepExtremeTimes), so a sweep's peak can never fall between samples.
 *
 * Slew paths need no separate check: a great circle between two aims inside
 * the tilt cone stays inside it (tilt along the arc never exceeds the larger
 * endpoint), and heads park straight up.
 */

import type { CompiledCue, Diagnostic, EffectDef, PositionedAsset, Seconds, SitePlan } from '../../contracts.js'
import {
  azimuthDegOf,
  elevationDegOf,
  figureAimsAt,
  sweepExtremeTimes,
  tiltDegOf,
} from '../../choreo/generators/searchlight.js'
import { pointInPolygon, v2 } from '../../math/index.js'

/** Interior sample count per cue window (plus both endpoints). */
export const LIGHT_RULE_SAMPLES = 8
/** Azimuth slack around the audience interval, degrees (the zone edge is no place to graze). */
export const LIGHT_AUDIENCE_AZ_SLACK_DEG = 5

const DEG = Math.PI / 180
const fmt = (n: number): string => (Math.round(n * 10) / 10).toString()
const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180

/** Azimuth interval (center ± half) the audience zone subtends from `from`. */
export function audienceAzimuthInterval(
  from: { x: number; y: number },
  site: SitePlan,
): { centerDeg: number; halfDeg: number } | undefined {
  const poly = site.audienceZone
  if (poly.length < 3) return undefined
  if (pointInPolygon(from, poly)) return { centerDeg: 0, halfDeg: 180 }
  let cx = 0
  let cy = 0
  for (const p of poly) {
    cx += p.x / poly.length
    cy += p.y / poly.length
  }
  const az = (p: { x: number; y: number }): number => Math.atan2(p.x - from.x, p.y - from.y) / DEG
  const ref = az(v2(cx, cy))
  let lo = 0
  let hi = 0
  for (const p of poly) {
    const d = wrap180(az(p) - ref)
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  return { centerDeg: ref + (lo + hi) / 2, halfDeg: (hi - lo) / 2 }
}

/** True when a ground azimuth (degrees) points into the interval (with slack). */
export function azimuthTowardAudience(
  azimuthDeg: number,
  zone: { centerDeg: number; halfDeg: number },
): boolean {
  return Math.abs(wrap180(azimuthDeg - zone.centerDeg)) <= zone.halfDeg + LIGHT_AUDIENCE_AZ_SLACK_DEG
}

export function searchlightRules(
  site: SitePlan,
  cues: readonly CompiledCue[],
  beats: readonly Seconds[],
  getEffect: (id: string) => EffectDef | undefined,
  out: Diagnostic[],
): void {
  const assetById = new Map<string, PositionedAsset>()
  for (const a of site.assets) assetById.set(a.id, a)

  for (const cue of cues) {
    if (cue.medium !== 'searchlight' || cue.positionId === undefined) continue
    const asset = assetById.get(cue.positionId)
    if (!asset) continue // dangling positionId is show validation's rule
    const extra = { assetId: asset.id, cueIds: [cue.id], tSec: cue.fireSec }
    const spec = asset.searchlightBank
    if (!spec) {
      out.push({
        code: 'light-structure',
        severity: 'error',
        message: `searchlight cue '${cue.id}' is placed on '${asset.id}' (${asset.kind}) which has no searchlightBank spec`,
        ...extra,
      })
      continue
    }
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'searchlight') continue // unresolvable effect is reported elsewhere
    const zone = audienceAzimuthInterval(asset.pos, site)

    const endSec = cue.targetSec + cue.durationSec
    const times: Seconds[] = []
    for (let i = 0; i <= LIGHT_RULE_SAMPLES + 1; i++) {
      times.push(cue.targetSec + (cue.durationSec * i) / (LIGHT_RULE_SAMPLES + 1))
    }
    times.push(...sweepExtremeTimes(cue, effect, cue.targetSec, endSec, { beats }))
    times.sort((a, b) => a - b)

    let tiltReported = false
    let elevReported = false
    for (const t of times) {
      if (tiltReported && elevReported) break
      const aims = figureAimsAt(cue, effect, asset, t, { beats })
      aims.forEach((dir, head) => {
        const tilt = tiltDegOf(dir)
        if (!tiltReported && tilt > spec.maxTiltDeg + 1e-6) {
          tiltReported = true
          out.push({
            code: 'light-tilt',
            severity: 'error',
            message:
              `bank '${asset.id}': head ${head} of cue '${cue.id}' tilts ${fmt(tilt)}° from vertical at ` +
              `t=${t.toFixed(2)}s (max ${fmt(spec.maxTiltDeg)}°)`,
            ...extra,
          })
        }
        const elev = elevationDegOf(dir)
        if (
          !elevReported &&
          zone !== undefined &&
          elev < spec.minElevationDeg - 1e-6 &&
          azimuthTowardAudience(azimuthDegOf(dir), zone)
        ) {
          elevReported = true
          out.push({
            code: 'light-elevation',
            severity: 'error',
            message:
              `bank '${asset.id}': head ${head} of cue '${cue.id}' aims ${fmt(elev)}° above the horizon ` +
              `toward the audience at t=${t.toFixed(2)}s (floor ${fmt(spec.minElevationDeg)}°)`,
            ...extra,
          })
        }
      })
    }
  }
}
