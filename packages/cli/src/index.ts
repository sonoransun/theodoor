#!/usr/bin/env node
/**
 * @theodoor/cli — `theodoor <command>`: validate, simulate, analyze, align,
 * export, fab, stats.
 *
 * This file owns dispatch and the top-level error → exit-code mapping:
 *   0 ok/pass · 1 validation/budget failure · 2 usage · 3 I/O · 4 safety.
 * In --json mode failures still print exactly ONE JSON object to stdout
 * ({ ok:false, error, code, ...extras }); human logs go to stderr.
 */

import { SafetyError } from '@theodoor/core'
import { CliError, USAGE, parseCli } from './args.js'
import { logErr, printJson } from './out.js'
import { runAlign } from './commands/align.js'
import { runAnalyze } from './commands/analyze.js'
import { runExport } from './commands/export.js'
import { runFab } from './commands/fab.js'
import { runGallery } from './commands/gallery.js'
import { runSimulate } from './commands/simulate.js'
import { runStats } from './commands/stats.js'
import { runValidate } from './commands/validate.js'

interface Failure {
  code: number
  message: string
  extra?: Record<string, unknown>
}

function classify(err: unknown): Failure {
  if (err instanceof CliError) {
    return {
      code: err.exitCode,
      message: err.message,
      ...(err.extra !== undefined ? { extra: err.extra } : {}),
    }
  }
  if (err instanceof SafetyError) {
    return {
      code: 4,
      message: err.message,
      ...(err.unsatisfied !== undefined ? { extra: { interlocks: err.unsatisfied } } : {}),
    }
  }
  return { code: 1, message: err instanceof Error ? err.message : String(err) }
}

async function main(argv: readonly string[]): Promise<number> {
  const wantJson = argv.includes('--json')
  try {
    const { command, flags } = parseCli(argv)
    switch (command) {
      case 'validate':
        return await runValidate(flags)
      case 'simulate':
        return await runSimulate(flags)
      case 'analyze':
        return await runAnalyze(flags)
      case 'align':
        return await runAlign(flags)
      case 'export':
        return await runExport(flags)
      case 'fab':
        return await runFab(flags)
      case 'stats':
        return await runStats(flags)
      case 'gallery':
        return await runGallery(flags)
    }
  } catch (err) {
    const failure = classify(err)
    if (wantJson) {
      printJson({ ok: false, error: failure.message, code: failure.code, ...(failure.extra ?? {}) })
    }
    logErr(`theodoor: ${failure.message}`)
    if (failure.code === 2) logErr('\n' + USAGE)
    if (failure.code === 4 && failure.extra !== undefined) {
      const interlocks = failure.extra['interlocks']
      if (Array.isArray(interlocks)) {
        logErr('interlock report:')
        for (const r of interlocks as { id: string; satisfied: boolean; detail: string }[]) {
          logErr(`  [${r.satisfied ? 'ok' : 'FAIL'}] ${r.id}: ${r.detail}`)
        }
      }
    }
    return failure.code
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    logErr(`theodoor: internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    process.exitCode = 1
  },
)
