/**
 * site/rules/fountain.ts — SitePlan rules for the fountain banks.
 *
 * Rule codes emitted (appended by site/validate.ts runRules):
 *   'fountain-structure' fountain cue on a fountainBank asset that declares
 *                        no fountainBank spec (error) — the analogue of
 *                        'crowd-structure'; a cue on some OTHER asset kind is
 *                        show validation's POSITION_KIND and is not repeated
 *   'fountain-height'    requested crest (params.heightM, else the effect's)
 *                        above the bank's maxHeightM (error)
 *   'fountain-drift'     wind carries the falling spray from the crest to
 *                        within SPRAY_CLEARANCE_M of the audience front line
 *                        (warning). Drift model mirrors the fallout rule:
 *                        translate downwind by wind × SPRAY_DRIFT_FACTOR ×
 *                        one rise time (the fall takes as long as the rise).
 */

import type { CompiledCue, Diagnostic, EffectDef, PositionedAsset, SitePlan } from '../../contracts.js'
import { fountainCrestM } from '../../choreo/generators/fountain.js'
import { fountainRiseSecFor } from '../../sim/fountains.js'
import { distPointToPolyline, v2 } from '../../math/index.js'

const DEG = Math.PI / 180
/** Spray drifts at this fraction of the wind speed while the crest falls. */
export const SPRAY_DRIFT_FACTOR = 0.6
/** Drifted spray must stay this far from the audience front line, meters. */
export const SPRAY_CLEARANCE_M = 30

const fmt = (n: number): string => (Math.round(n * 10) / 10).toString()

export function fountainRules(
  site: SitePlan,
  cues: readonly CompiledCue[],
  getEffect: (id: string) => EffectDef | undefined,
  out: Diagnostic[],
): void {
  const assetById = new Map<string, PositionedAsset>()
  for (const a of site.assets) assetById.set(a.id, a)
  const w = site.wind
  const downwind = v2(-Math.sin(w.dirDegFrom * DEG), -Math.cos(w.dirDegFrom * DEG))

  for (const cue of cues) {
    if (cue.medium !== 'fountain' || cue.positionId === undefined) continue
    const asset = assetById.get(cue.positionId)
    if (!asset) continue // dangling positionId is show validation's rule
    const extra = { assetId: asset.id, cueIds: [cue.id], tSec: cue.fireSec }
    const spec = asset.fountainBank
    if (!spec) {
      // Wrong asset kind is POSITION_KIND (show validation) — never doubled here.
      if (asset.kind === 'fountainBank') {
        out.push({
          code: 'fountain-structure',
          severity: 'error',
          message: `fountain cue '${cue.id}' is placed on '${asset.id}' (fountainBank) which has no fountainBank spec`,
          ...extra,
        })
      }
      continue
    }
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'fountain') continue
    const crest = fountainCrestM(effect, cue.params)
    if (crest > spec.maxHeightM + 1e-9) {
      out.push({
        code: 'fountain-height',
        severity: 'error',
        message:
          `bank '${asset.id}': cue '${cue.id}' asks for a ${fmt(crest)} m crest but the pumps ` +
          `top out at ${fmt(spec.maxHeightM)} m`,
        ...extra,
      })
    }
    // Spray drift: the falling crest is carried downwind for one rise time.
    // The falling crest is carried downwind for one fall time — the same
    // (mist-stretched) rise the sim uses, via the single owner in sim/fountains.
    const driftM = w.speedMps * SPRAY_DRIFT_FACTOR * fountainRiseSecFor(effect, crest)
    const landing = v2(asset.pos.x + downwind.x * driftM, asset.pos.y + downwind.y * driftM)
    if (site.audience.length >= 2) {
      const dist = distPointToPolyline(landing, site.audience)
      if (dist < SPRAY_CLEARANCE_M) {
        out.push({
          code: 'fountain-drift',
          severity: 'warning',
          message:
            `bank '${asset.id}': spray from cue '${cue.id}' (${fmt(crest)} m crest) drifts ` +
            `${fmt(driftM)} m downwind in ${fmt(w.speedMps)} m/s wind, landing ${fmt(dist)} m from ` +
            `the audience line (< ${SPRAY_CLEARANCE_M} m clearance)`,
          ...extra,
        })
      }
    }
  }
}
