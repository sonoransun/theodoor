/**
 * commands/analyze.ts — WAV → MusicalTimeline analysis summary.
 *
 * Reads --wav bytes (node:fs), runs the core analyzeWav pipeline, and prints
 * a summary: BPM estimate (beat-span-weighted mean over tempo segments),
 * tempo confidence, beat/downbeat counts, annotation counts by kind, and
 * duration. --json prints one object carrying the summary plus the full
 * timeline sans score (analysis timelines carry no score by contract).
 *
 * Unreadable or undecodable input exits 3.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { MusicalTimeline } from '@theodoor/core'
import { analyzeWav } from '@theodoor/core'
import { IoError, UsageError, type CliFlags } from '../args.js'
import { printJson, printLines } from '../out.js'

/** Beat-span-weighted mean BPM over the piecewise-constant tempo segments. */
export function bpmEstimate(tl: MusicalTimeline): number {
  const segs = tl.tempo.segments
  if (segs.length === 0) return 0
  if (segs.length === 1) return segs[0]!.bpm
  const totalBeats = Math.max(tl.beats.length, segs[segs.length - 1]!.beat + 1)
  let sum = 0
  let weight = 0
  for (let i = 0; i < segs.length; i++) {
    const span = (i + 1 < segs.length ? segs[i + 1]!.beat : totalBeats) - segs[i]!.beat
    const w = Math.max(span, 0)
    sum += segs[i]!.bpm * w
    weight += w
  }
  return weight > 0 ? sum / weight : segs[0]!.bpm
}

export async function runAnalyze(flags: CliFlags): Promise<number> {
  if (flags.wav === undefined) throw new UsageError('analyze requires --wav <path>')

  let bytes: Uint8Array
  try {
    bytes = await readFile(resolve(flags.wav))
  } catch (err) {
    throw new IoError(`cannot read WAV '${flags.wav}': ${message(err)}`)
  }

  let tl: MusicalTimeline
  try {
    tl = analyzeWav(bytes)
  } catch (err) {
    throw new IoError(`cannot decode/analyze WAV '${flags.wav}': ${message(err)}`)
  }

  const annotationsByKind: Record<string, number> = {}
  for (const a of tl.annotations) {
    annotationsByKind[a.kind] = (annotationsByKind[a.kind] ?? 0) + 1
  }
  const bpm = bpmEstimate(tl)

  if (flags.json) {
    const { score: _score, ...timelineSansScore } = tl
    printJson({
      ok: true,
      bpm,
      tempoConfidence: tl.tempoConfidence,
      beats: tl.beats.length,
      downbeats: tl.downbeats.length,
      annotationsByKind,
      durationSec: tl.duration,
      timeline: timelineSansScore,
    })
  } else {
    const kinds = Object.keys(annotationsByKind)
      .sort()
      .map((k) => `${k}=${annotationsByKind[k]}`)
      .join(' ')
    printLines([
      `analyzed '${flags.wav}' (${tl.duration.toFixed(2)} s)`,
      `  bpm estimate:      ${bpm > 0 ? bpm.toFixed(1) : 'none (no tempo found)'}`,
      `  tempo confidence:  ${tl.tempoConfidence.toFixed(2)}`,
      `  beats:             ${tl.beats.length} (${tl.downbeats.length} downbeats)`,
      `  annotations:       ${kinds || 'none'}`,
    ])
  }
  return 0
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
