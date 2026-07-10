/**
 * show/validate.ts — structural show validation (pre-solver).
 *
 * Pure rule checks over an authored Show against a Catalog; never throws.
 * Codes emitted:
 *   'DUPLICATE_CUE_ID'    cue ids must be unique across ALL tracks (error)
 *   'EFFECT_UNRESOLVED'   cue.effectId not in the catalog (error)
 *   'MEDIUM_MISMATCH'     effect.medium differs from its track's medium (error)
 *   'POSITION_MISSING'    cue has no positionId (error; warning for fabrication)
 *   'POSITION_UNRESOLVED' positionId not among site.assets (error)
 *   'POSITION_KIND'       asset kind does not suit the medium (error):
 *                         pyro→mortarRack, drone→dronePad, laser→laserTower,
 *                         panel→panel; fabrication mounts on any asset
 *   catalog/param-*       cue params forwarded from catalog validateParams
 *   'QUIET_VARIANT'       meta.variant 'quiet' with an effect louder than
 *                         QUIET_VARIANT_MAX_DB at the reference distance (error)
 */

import type { AssetKind, Diagnostic, Medium, PositionedAsset, Show } from '../contracts.js'
import type { Catalog } from '../catalog/index.js'
import { validateParams } from '../catalog/index.js'

/** Quiet-variant shows reject effects louder than this at 15 m. */
export const QUIET_VARIANT_MAX_DB = 100

const POSITION_KIND_FOR: Readonly<Partial<Record<Medium, AssetKind>>> = {
  pyro: 'mortarRack',
  drone: 'dronePad',
  laser: 'laserTower',
  panel: 'panel',
  crowd: 'crowdMast',
  beam: 'beamArray',
  // fabrication: any asset
}

/** Validate an authored show against a catalog. Returns diagnostics only. */
export function validateShow(show: Show, catalog: Catalog): Diagnostic[] {
  const diags: Diagnostic[] = []
  const assetById = new Map<string, PositionedAsset>()
  for (const a of show.site.assets) assetById.set(a.id, a)

  const seenIds = new Set<string>()
  for (const track of show.tracks) {
    for (const cue of track.cues) {
      if (seenIds.has(cue.id)) {
        diags.push({
          code: 'DUPLICATE_CUE_ID',
          severity: 'error',
          message: `cue id '${cue.id}' appears more than once across the show's tracks`,
          cueIds: [cue.id],
        })
      }
      seenIds.add(cue.id)

      const effect = catalog.find(cue.effectId)
      if (!effect) {
        diags.push({
          code: 'EFFECT_UNRESOLVED',
          severity: 'error',
          message: `cue '${cue.id}': effect '${cue.effectId}' is not in catalog '${show.catalogId}'`,
          cueIds: [cue.id],
        })
        continue
      }

      if (effect.medium !== track.medium) {
        diags.push({
          code: 'MEDIUM_MISMATCH',
          severity: 'error',
          message:
            `cue '${cue.id}': effect '${effect.id}' has medium '${effect.medium}' ` +
            `but sits on track '${track.id}' (medium '${track.medium}')`,
          cueIds: [cue.id],
        })
      }

      if (cue.positionId === undefined) {
        diags.push({
          code: 'POSITION_MISSING',
          severity: effect.medium === 'fabrication' ? 'warning' : 'error',
          message: `cue '${cue.id}' (${effect.medium}) has no positionId`,
          cueIds: [cue.id],
        })
      } else {
        const asset = assetById.get(cue.positionId)
        if (!asset) {
          diags.push({
            code: 'POSITION_UNRESOLVED',
            severity: 'error',
            message: `cue '${cue.id}': positionId '${cue.positionId}' is not a site asset`,
            cueIds: [cue.id],
          })
        } else {
          const wanted = POSITION_KIND_FOR[effect.medium]
          if (wanted !== undefined && asset.kind !== wanted) {
            diags.push({
              code: 'POSITION_KIND',
              severity: 'error',
              message:
                `cue '${cue.id}' (${effect.medium}) is placed on asset '${asset.id}' ` +
                `of kind '${asset.kind}'; requires '${wanted}'`,
              cueIds: [cue.id],
              assetId: asset.id,
            })
          }
        }
      }

      for (const d of validateParams(effect, cue.params)) {
        diags.push({ ...d, cueIds: [cue.id] })
      }

      if (show.meta.variant === 'quiet' && effect.noiseDbAt15m > QUIET_VARIANT_MAX_DB) {
        diags.push({
          code: 'QUIET_VARIANT',
          severity: 'error',
          message:
            `cue '${cue.id}': effect '${effect.id}' is ${effect.noiseDbAt15m} dB at the ` +
            `reference distance — quiet-variant shows reject entries above ${QUIET_VARIANT_MAX_DB} dB`,
          cueIds: [cue.id],
        })
      }
    }
  }
  return diags
}
