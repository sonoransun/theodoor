/**
 * commands/align.ts — the backward-solve view.
 *
 * Prints every compiled cue's alignment: id, medium, effect, targetSec (when
 * the visual lands), fireSec (when it is emitted), anticipationSec — sorted
 * by fireSec. The keystone identity holds row by row:
 *   fireSec = targetSec − anticipationSec
 * --json prints the full CompiledCue array.
 */

import type { CliFlags } from '../args.js'
import { loadCompiledShow } from '../load.js'
import { fmtSec, printJson, printLines, renderTable } from '../out.js'

export async function runAlign(flags: CliFlags): Promise<number> {
  const { compiled } = await loadCompiledShow(flags)
  const cues = [...compiled.cues].sort(
    (a, b) =>
      a.fireSec - b.fireSec ||
      (a.trackId < b.trackId ? -1 : a.trackId > b.trackId ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  if (flags.json) {
    printJson({ ok: true, show: compiled.show.meta.id, cueCount: cues.length, cues })
  } else {
    const lines = [
      `alignment for '${compiled.show.meta.id}' — ${cues.length} cue(s), sorted by fireSec`,
      '',
      ...renderTable(
        ['id', 'medium', 'effect', 'targetSec', 'fireSec', 'anticipationSec'],
        cues.map((c) => [
          c.id,
          c.medium,
          c.effectId,
          fmtSec(c.targetSec),
          fmtSec(c.fireSec),
          fmtSec(c.anticipationSec),
        ]),
      ),
    ]
    printLines(lines)
  }
  return 0
}
