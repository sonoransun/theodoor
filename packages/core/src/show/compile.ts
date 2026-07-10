/**
 * show/compile.ts — Show + Catalog → CompiledShow, the plain-JSON interchange
 * every downstream consumer (sim, viz, CLI, exporters, validators) reads.
 *
 * compile() = validateShow diagnostics (errors do NOT abort — they accompany
 * the result) + the two-phase solver + the contract sort (fireSec, trackId,
 * id) + validateSite diagnostics appended + the carrier-exposure gate: when
 * the compiled show has at least one beam cue, exposureReport() runs against
 * show.exposureBudget (or the always-on DEFAULT_EXPOSURE_BUDGET) and its
 * violations are appended; shows without beam cues skip the sweep entirely,
 * so it adds zero cost to them. Pure and deterministic: two calls with
 * identical inputs return deep-equal (JSON-identical) results.
 */

import type { CompiledShow, Show } from '../contracts.js'
import type { Catalog } from '../catalog/index.js'
import { getEffectFrom } from '../catalog/index.js'
import { DEFAULT_EXPOSURE_BUDGET, exposureReport } from '../acoustics/exposure.js'
import { validateSite } from '../site/index.js'
import type { SolveOptions } from './solve.js'
import { compiledCueOrder, solve } from './solve.js'
import { validateShow } from './validate.js'

/** Compile an authored show. See the module doc for the exact pipeline. */
export function compile(show: Show, catalog: Catalog, opts: SolveOptions = {}): CompiledShow {
  const showDiags = validateShow(show, catalog)
  const { cues, diagnostics: solveDiags } = solve(show, catalog, opts)
  const sorted = [...cues].sort(compiledCueOrder)
  const getEffect = getEffectFrom(catalog)
  const interim: CompiledShow = {
    show,
    cues: sorted,
    diagnostics: [...showDiags, ...solveDiags],
  }
  const siteDiags = validateSite(show.site, interim, getEffect)
  const diagnostics = [...showDiags, ...solveDiags, ...siteDiags]
  // Carrier-exposure gate — always on for beam shows (a show may override the
  // budget via show.exposureBudget, never disable it).
  if (sorted.some((c) => c.medium === 'beam')) {
    const report = exposureReport(
      { show, cues: sorted, diagnostics },
      getEffect,
      show.exposureBudget ?? DEFAULT_EXPOSURE_BUDGET,
    )
    diagnostics.push(...report.violations)
  }
  return {
    show,
    cues: sorted,
    diagnostics,
  }
}
