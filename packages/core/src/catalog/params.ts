/**
 * params.ts — cue-param validation against the documented per-medium keys.
 *
 * The allowed keys mirror the CueParams comment in contracts.ts exactly:
 *   drone:  count, scaleM, holdSec, text (for 'text'/'digit'), rgb
 *   laser:  headId, spreadDeg, periodBeats, rgb
 *   panel:  text, speedPxPerBeat, rgb, rgb2
 *   pyro:   (none in v1 — everything comes from the effect entry)
 * Fabrication is not listed there, so it accepts no params either.
 */

import type { CueParams, Diagnostic, EffectDef, Medium } from '../contracts.js'

/** Expected value shape for a cue param. */
export type ParamKind = 'number' | 'string' | 'boolean' | 'numberArray' | 'stringArray'

/** Documented cue param keys (and their expected kinds) per medium. */
export const ALLOWED_PARAM_KEYS: Readonly<Record<Medium, Readonly<Record<string, ParamKind>>>> = {
  pyro: {},
  drone: {
    count: 'number',
    scaleM: 'number',
    holdSec: 'number',
    text: 'string',
    rgb: 'numberArray',
  },
  laser: {
    headId: 'string',
    spreadDeg: 'number',
    periodBeats: 'number',
    rgb: 'numberArray',
  },
  panel: {
    text: 'string',
    speedPxPerBeat: 'number',
    rgb: 'numberArray',
    rgb2: 'numberArray',
  },
  fabrication: {},
  crowd: {
    rgb: 'numberArray',
    rgb2: 'numberArray',
    intensity: 'number',
    periodBeats: 'number',
    originCell: 'number',
    dirDeg: 'number',
    sections: 'number',
    densityFrac: 'number',
    twinkleHz: 'number',
    text: 'string',
    bitmap: 'stringArray',
  },
  beam: {
    targetCellId: 'number',
    pathCellIds: 'numberArray',
    cells: 'string',
    pairId: 'string',
    role: 'string',
    extraDelayMs: 'number',
    sourceCueId: 'string',
    periodBeats: 'number',
    gainDb: 'number',
  },
}

/** Classify a runtime value into a {@link ParamKind}-comparable label. */
function kindOf(v: unknown): string {
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string') return 'string'
  if (typeof v === 'boolean') return 'boolean'
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'number')) return 'numberArray'
    if (v.every((x) => typeof x === 'string')) return 'stringArray'
    return 'mixedArray'
  }
  return typeof v
}

/**
 * Validate cue params against the effect's medium.
 *
 * - Unknown key → warning ('catalog/unknown-param'): tolerated, ignored downstream.
 * - Wrong primitive type → error ('catalog/param-type'): the cue cannot compile.
 * - 'text' on a drone formation other than 'text'/'digit' → warning
 *   ('catalog/param-inapplicable'), per the contracts.ts note.
 */
export function validateParams(effect: EffectDef, params: CueParams | undefined): Diagnostic[] {
  if (params === undefined) return []
  const allowed = ALLOWED_PARAM_KEYS[effect.medium]
  const diags: Diagnostic[] = []

  for (const [key, value] of Object.entries(params)) {
    const expected = allowed[key]
    if (expected === undefined) {
      const allowedKeys = Object.keys(allowed)
      const hint =
        allowedKeys.length > 0 ? `allowed: ${allowedKeys.join(', ')}` : 'this medium takes no params'
      diags.push({
        code: 'catalog/unknown-param',
        severity: 'warning',
        message: `Param '${key}' is not a documented cue param for medium '${effect.medium}' (${hint})`,
      })
      continue
    }
    const actual = kindOf(value)
    if (actual !== expected) {
      diags.push({
        code: 'catalog/param-type',
        severity: 'error',
        message: `Param '${key}' for medium '${effect.medium}' must be ${expected}, got ${actual}`,
      })
      continue
    }
    if (
      key === 'text' &&
      effect.medium === 'drone' &&
      effect.formation !== 'text' &&
      effect.formation !== 'digit'
    ) {
      diags.push({
        code: 'catalog/param-inapplicable',
        severity: 'warning',
        message:
          `Param 'text' only applies to drone formations 'text' and 'digit' ` +
          `(effect '${effect.id}' has formation '${effect.formation}')`,
      })
    }
  }
  return diags
}
