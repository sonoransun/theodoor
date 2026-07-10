/**
 * out.ts — stdout/stderr emitters and gated-adjacent file writing.
 *
 * In --json mode a command prints exactly ONE JSON object to stdout and
 * nothing else; human logs always go to stderr. JSON.stringify maps
 * -Infinity/NaN to null at the serialization edge (per the acoustics
 * contract: silence is -Infinity in memory, null in JSON).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IoError } from './args.js'

/** Human-readable log line (stderr — never pollutes --json stdout). */
export function logErr(line: string): void {
  process.stderr.write(line + '\n')
}

/** The one JSON object of a --json run. */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

/** Plain text lines to stdout (non-JSON mode). */
export function printLines(lines: readonly string[]): void {
  process.stdout.write(lines.join('\n') + '\n')
}

/** Column-aligned plain-text table (header, rule, rows). */
export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string[] {
  const widths = headers.map((h, i) => {
    let w = h.length
    for (const row of rows) w = Math.max(w, (row[i] ?? '').length)
    return w
  })
  const fmt = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd()
  const out = [fmt(headers), widths.map((w) => '-'.repeat(w)).join('  ')]
  for (const row of rows) out.push(fmt(row))
  return out
}

/** mkdir -p the output directory; IoError (exit 3) when it cannot be made. */
export function ensureOutDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    throw new IoError(`cannot create output directory '${dir}': ${message(err)}`)
  }
}

/**
 * Write one artifact into `dir` and return its full path. Callers gate any
 * hardware-consumable write behind SafetyMachine.requireLive BEFORE calling.
 */
export function writeArtifact(dir: string, name: string, data: string | Uint8Array): string {
  // Artifact names derive from author-controlled ids (meta.id, asset.id);
  // never let a name with path separators or traversal escape `dir`.
  const safe = basename(name)
  if (safe !== name || safe === '' || safe === '.' || safe === '..') {
    throw new IoError(`unsafe artifact name '${name}'`)
  }
  const path = join(dir, safe)
  try {
    writeFileSync(path, data)
  } catch (err) {
    throw new IoError(`cannot write '${path}': ${message(err)}`)
  }
  return path
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Seconds with 3 decimals for tables. */
export function fmtSec(t: number): string {
  return t.toFixed(3)
}
