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
 * so it adds zero cost to them. Program-note acts (show.notes) are resolved
 * to seconds onto compiled.acts. Pure and deterministic: two calls with
 * identical inputs return deep-equal (JSON-identical) results.
 */

import type { CompiledAct, CompiledShow, Show } from '../contracts.js'
import type { Catalog } from '../catalog/index.js'
import { getEffectFrom } from '../catalog/index.js'
import { DEFAULT_EXPOSURE_BUDGET, exposureReport } from '../acoustics/exposure.js'
import { validateSite } from '../site/index.js'
import { showDurationSec } from '../transport/transport.js'
import { resolveAnchor } from './anchors.js'
import type { SolveOptions } from './solve.js'
import { compiledCueOrder, solve } from './solve.js'
import { validateShow } from './validate.js'

/**
 * Resolve the program-note acts to seconds: each act spans from its anchor to
 * the next act's start (or the show's end). Unresolvable anchors are dropped
 * with a warning-severity ACT_UNRESOLVED diagnostic — notes are narrative,
 * never a reason to fail a compile. Acts come back sorted ascending.
 */
export function resolveActs(
  show: Show,
  compiled: Pick<CompiledShow, 'show' | 'cues'>,
): { acts: CompiledAct[]; diagnostics: CompiledShow['diagnostics'] } {
  const diagnostics: CompiledShow['diagnostics'][number][] = []
  if (!show.notes) return { acts: [], diagnostics }
  const endSec = showDurationSec({ ...compiled, diagnostics: [] })
  const starts: { title: string; note: string; fromSec: number }[] = []
  show.notes.acts.forEach((act, i) => {
    const t = resolveAnchor(act.from, show.music)
    if (t === undefined) {
      diagnostics.push({
        code: 'ACT_UNRESOLVED',
        severity: 'warning',
        message: `program-note act ${i} ('${act.title}') anchor ${JSON.stringify(act.from)} does not resolve; omitted`,
      })
      return
    }
    starts.push({ title: act.title, note: act.note, fromSec: t })
  })
  starts.sort((a, b) => a.fromSec - b.fromSec)
  const acts: CompiledAct[] = starts.map((a, i) => ({
    title: a.title,
    fromSec: a.fromSec,
    toSec: i + 1 < starts.length ? starts[i + 1]!.fromSec : Math.max(endSec, a.fromSec),
    note: a.note,
  }))
  return { acts, diagnostics }
}

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
  // Program notes → acts in seconds (narrative metadata; never fails a compile).
  const resolved = resolveActs(show, { show, cues: sorted })
  diagnostics.push(...resolved.diagnostics)
  const out: CompiledShow = {
    show,
    cues: sorted,
    diagnostics,
  }
  if (show.notes) out.acts = resolved.acts
  return out
}
