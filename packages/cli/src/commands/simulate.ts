/**
 * commands/simulate.ts — headless deterministic simulation.
 *
 * runHeadless drives the fixed-timestep engine to --to (default: full show
 * duration) and reports aggregate SimStats plus the engine warning count.
 * --seed is informational only: the deterministic seed lives in the show
 * (show.meta.seed); per-cue seeds are forked from it at compile time.
 */

import { runHeadless, showDurationSec } from '@theodoor/core'
import type { CliFlags } from '../args.js'
import { effectLookupFor, loadCompiledShow } from '../load.js'
import { logErr, printJson, printLines } from '../out.js'

export async function runSimulate(flags: CliFlags): Promise<number> {
  const { compiled } = await loadCompiledShow(flags)
  const getEffect = effectLookupFor(compiled)

  if (flags.seed !== undefined) {
    logErr(
      `note: --seed is informational — the deterministic seed lives in the show ` +
        `(meta.seed = ${compiled.show.meta.seed}); re-author the show to change it`,
    )
  }

  const toSec = flags.to ?? showDurationSec(compiled)
  const { stats, engine } = runHeadless(compiled, {
    ...(flags.to !== undefined ? { toSec: flags.to } : {}),
    getEffect,
  })
  const warnings = engine.warnings()

  if (flags.json) {
    printJson({
      ok: true,
      show: compiled.show.meta.id,
      seed: compiled.show.meta.seed,
      toSec,
      stats,
      warningCount: warnings.length,
    })
  } else {
    const spl = stats.splPeakByListener
      .map((db) => (Number.isFinite(db) ? db.toFixed(1) : 'silent'))
      .join(', ')
    printLines([
      `simulated '${compiled.show.meta.id}' to t=${toSec.toFixed(2)}s ` +
        `(${stats.steps} steps, seed ${compiled.show.meta.seed})`,
      `  peak stars:          ${stats.peakStars}`,
      `  peak drones:         ${stats.peakDrones}`,
      `  min separation:      ${Number.isFinite(stats.minSeparationM) ? stats.minSeparationM.toFixed(2) + ' m' : 'n/a'}`,
      `  landing accuracy:    ${stats.landingAccuracyM.toFixed(2)} m`,
      `  SPL peak/listener:   ${spl || 'none'} dB`,
      `  warnings:            ${warnings.length}`,
    ])
  }
  return 0
}
