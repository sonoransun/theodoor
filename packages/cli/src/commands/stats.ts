/**
 * commands/stats.ts — quick facts about a show.
 *
 * Cue counts by medium, total duration, peak summed SPL per reference
 * listener (splTimeline sweep), diagnostic counts, and — when --quiet-budget
 * is given — the quiet-report pass/fail (a failing budget exits 1; findings
 * are still printed).
 *
 * Sim extensions: shows with crowd, beam, fountain, or searchlight cues also
 * run a headless sim to report peakCrowdCellsLit, peakActiveBeams,
 * beamLandingErrorSecMax, peakActiveJets, peakActiveLights, and
 * fountainCrestErrorSecMax (printed only when nonzero). --exposure runs the
 * carrier-exposure sweep and prints the top 10 worst cells (peak carrier dB,
 * dwell seconds) plus a PASS/FAIL line; like the quiet budget, a FAIL exits
 * 1. In --json mode --exposure embeds the full ExposureReport.
 */

import {
  DEFAULT_EXPOSURE_BUDGET,
  exposureReport,
  quietReport,
  runHeadless,
  showDurationSec,
  splTimeline,
  type ExposureCellStats,
  type SimStats,
} from '@theodoor/core'
import type { CliFlags } from '../args.js'
import { effectLookupFor, loadCompiledShow } from '../load.js'
import { logErr, printJson, printLines, renderTable } from '../out.js'

/** Worst cells first: peak carrier, then dwell, then stable cell order. */
export function worstExposureCells(
  cells: readonly ExposureCellStats[],
  limit = 10,
): ExposureCellStats[] {
  return [...cells]
    .sort(
      (a, b) =>
        b.peakCarrierDb - a.peakCarrierDb || b.dwellSec - a.dwellSec || a.cellIndex - b.cellIndex,
    )
    .slice(0, limit)
}

export async function runStats(flags: CliFlags): Promise<number> {
  const { compiled } = await loadCompiledShow(flags)
  const getEffect = effectLookupFor(compiled)
  const site = compiled.show.site

  const cueCounts: Record<string, number> = {}
  for (const cue of compiled.cues) {
    cueCounts[cue.medium] = (cueCounts[cue.medium] ?? 0) + 1
  }

  const durationSec = showDurationSec(compiled)

  const splPeakByListener = site.refListenerPos.map((listener) => {
    let peak = -Infinity
    for (const sample of splTimeline(compiled, getEffect, listener)) {
      if (sample.dB > peak) peak = sample.dB
    }
    return peak
  })

  const errors = compiled.diagnostics.filter((d) => d.severity === 'error').length
  const warnings = compiled.diagnostics.length - errors

  const quiet =
    flags.quietBudgetDb !== undefined
      ? quietReport(compiled, getEffect, flags.quietBudgetDb)
      : undefined

  // Crowd/beam/fountain/searchlight sim stats exist only for shows that use
  // those media; other shows skip the headless run entirely (every one of
  // those fields would be zero).
  const hasSimMedia = compiled.cues.some(
    (c) =>
      c.medium === 'crowd' ||
      c.medium === 'beam' ||
      c.medium === 'fountain' ||
      c.medium === 'searchlight',
  )
  const sim: SimStats | undefined = hasSimMedia
    ? runHeadless(compiled, { getEffect }).stats
    : undefined

  const exposure = flags.exposure
    ? exposureReport(compiled, getEffect, compiled.show.exposureBudget ?? DEFAULT_EXPOSURE_BUDGET)
    : undefined

  if (flags.json) {
    printJson({
      ok: (quiet === undefined || quiet.pass) && (exposure === undefined || exposure.pass),
      show: compiled.show.meta.id,
      title: compiled.show.meta.title,
      variant: compiled.show.meta.variant,
      seed: compiled.show.meta.seed,
      durationSec,
      cueCount: compiled.cues.length,
      cueCounts,
      splPeakByListener, // -Infinity serializes as null (silent listener)
      diagnostics: { errors, warnings },
      ...(sim !== undefined
        ? {
            peakCrowdCellsLit: sim.peakCrowdCellsLit,
            peakActiveBeams: sim.peakActiveBeams,
            beamLandingErrorSecMax: sim.beamLandingErrorSecMax,
            peakActiveJets: sim.peakActiveJets,
            peakActiveLights: sim.peakActiveLights,
            lightArrivalLagSecMax: sim.lightArrivalLagSecMax,
            fountainCrestErrorSecMax: sim.fountainCrestErrorSecMax,
          }
        : {}),
      ...(exposure !== undefined ? { exposure } : {}),
      ...(quiet !== undefined
        ? {
            quiet: {
              budgetDb: quiet.budgetDb,
              pass: quiet.pass,
              peakDb: quiet.peakDb,
              peakTSec: quiet.peakTSec,
              violationWindows: quiet.violations.length,
              substitutionHints: quiet.substitutionHints,
            },
          }
        : {}),
    })
  } else {
    const media = Object.keys(cueCounts)
      .sort()
      .map((m) => `${m}=${cueCounts[m]}`)
      .join(' ')
    const spl = splPeakByListener
      .map((db) => (Number.isFinite(db) ? db.toFixed(1) : 'silent'))
      .join(', ')
    const lines = [
      `'${compiled.show.meta.title}' (${compiled.show.meta.id}, ${compiled.show.meta.variant}, seed ${compiled.show.meta.seed})`,
      `  duration:           ${durationSec.toFixed(2)} s`,
      `  cues:               ${compiled.cues.length} (${media || 'none'})`,
      `  SPL peak/listener:  ${spl || 'no listeners'} dB`,
      `  diagnostics:        ${errors} error(s), ${warnings} warning(s)`,
    ]
    if (sim !== undefined) {
      if (sim.peakCrowdCellsLit > 0) {
        lines.push(`  crowd cells lit:    ${sim.peakCrowdCellsLit} peak`)
      }
      if (sim.peakActiveBeams > 0) {
        lines.push(`  active beams:       ${sim.peakActiveBeams} peak`)
      }
      if (sim.beamLandingErrorSecMax > 0) {
        lines.push(`  beam landing error: ${sim.beamLandingErrorSecMax.toFixed(3)} s max`)
      }
      if (sim.peakActiveJets > 0) {
        lines.push(`  water columns:      ${sim.peakActiveJets} peak`)
      }
      if (sim.peakActiveLights > 0) {
        lines.push(`  searchlight heads:  ${sim.peakActiveLights} peak`)
      }
      if (sim.fountainCrestErrorSecMax > 0) {
        lines.push(`  crest timing error: ${sim.fountainCrestErrorSecMax.toFixed(3)} s max`)
      }
      if (sim.lightArrivalLagSecMax > 0) {
        lines.push(`  light arrival lag:  ${sim.lightArrivalLagSecMax.toFixed(3)} s max`)
      }
    }
    if (quiet !== undefined) {
      lines.push(
        `  quiet budget:       ${quiet.budgetDb} dB — ${quiet.pass ? 'PASS' : 'FAIL'} ` +
          `(peak ${Number.isFinite(quiet.peakDb) ? quiet.peakDb.toFixed(1) : '-inf'} dB, ` +
          `${quiet.violations.length} violation window(s))`,
      )
    }
    if (exposure !== undefined) {
      lines.push(
        `  exposure budget:    ${exposure.budget.maxCarrierDb} dB ceiling / ` +
          `${exposure.budget.dwellMaxSec} s dwell — ${exposure.pass ? 'PASS' : 'FAIL'} ` +
          `(${exposure.violations.length} violation(s))`,
      )
      const worst = worstExposureCells(exposure.cells)
      if (worst.length > 0) {
        lines.push('  worst cells by peak carrier:')
        const table = renderTable(
          ['cellIndex', 'peakCarrierDb', 'dwellSec'],
          worst.map((c) => [
            String(c.cellIndex),
            Number.isFinite(c.peakCarrierDb) ? c.peakCarrierDb.toFixed(1) : 'silent',
            c.dwellSec.toFixed(1),
          ]),
        )
        lines.push(...table.map((row) => `    ${row}`))
      } else {
        lines.push('  worst cells by peak carrier: none (no beam cues)')
      }
    }
    printLines(lines)
  }

  let failed = false
  if (quiet !== undefined && !quiet.pass) {
    logErr(`stats: noise budget ${quiet.budgetDb} dB FAILED (peak ${quiet.peakDb.toFixed(1)} dB)`)
    failed = true
  }
  if (exposure !== undefined && !exposure.pass) {
    logErr(
      `stats: carrier-exposure budget FAILED ` +
        `(${exposure.violations.length} violation(s), peak ${exposure.peakDb.toFixed(1)} dB ` +
        `at cell ${exposure.worstCellIndex})`,
    )
    failed = true
  }
  return failed ? 1 : 0
}
