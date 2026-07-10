/**
 * export/cueSheet.ts — human-readable markdown cue sheet.
 *
 * PURE string builder over a CompiledShow. One table per track: land time
 * (the musical moment, mm:ss.d), fire time, effect name, position, and
 * anticipation. The header carries show title/variant/seed and a
 * SIMULATION-ONLY banner — this document is a design artifact, never a
 * firing authorization.
 */

import type { CompiledShow, EffectDef, Seconds } from '../contracts.js'

/** Format seconds as mm:ss.d (one decimal), sign-prefixed when negative. */
export function formatMmSsD(t: Seconds): string {
  const sign = t < 0 ? '-' : ''
  const tenths = Math.round(Math.abs(t) * 10)
  const minutes = Math.floor(tenths / 600)
  const seconds = (tenths - minutes * 600) / 10
  const ss = (seconds < 10 ? '0' : '') + seconds.toFixed(1)
  return `${sign}${String(minutes).padStart(2, '0')}:${ss}`
}

/** Escape characters that would break a markdown table cell. */
function mdCell(s: string): string {
  return s.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

/** Build the full markdown cue sheet for a compiled show. */
export function cueSheetMarkdown(
  compiled: CompiledShow,
  getEffect: (id: string) => EffectDef | undefined,
): string {
  const { show, cues } = compiled
  const lines: string[] = []
  lines.push(`# Cue Sheet — ${mdCell(show.meta.title)}`)
  lines.push('')
  lines.push(
    `**Variant:** ${show.meta.variant} · **Seed:** ${show.meta.seed} · ` +
      `**Show:** ${mdCell(show.meta.id)} · **Cues:** ${cues.length}`,
  )
  lines.push('')
  lines.push('> **SIMULATION ONLY.** This cue sheet is generated for design review and')
  lines.push('> rehearsal simulation. It is not a firing authorization; live emission is')
  lines.push('> gated separately by the safety state machine and site validation.')
  lines.push('')

  for (const track of show.tracks) {
    const trackCues = cues
      .filter((c) => c.trackId === track.id)
      .sort((a, b) => a.targetSec - b.targetSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    lines.push(`## ${mdCell(track.name)} (${track.medium}) — ${trackCues.length} cue${trackCues.length === 1 ? '' : 's'}`)
    lines.push('')
    if (trackCues.length === 0) {
      lines.push('_No cues._')
      lines.push('')
      continue
    }
    lines.push('| Cue | Land | Fire | Effect | Position | Anticipation |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const cue of trackCues) {
      const effect = getEffect(cue.effectId)
      lines.push(
        `| ${mdCell(cue.id)} ` +
          `| ${formatMmSsD(cue.targetSec)} ` +
          `| ${formatMmSsD(cue.fireSec)} ` +
          `| ${mdCell(effect ? effect.name : `${cue.effectId} (unknown)`)} ` +
          `| ${cue.positionId ? mdCell(cue.positionId) : '—'} ` +
          `| ${cue.anticipationSec.toFixed(2)} s |`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}
