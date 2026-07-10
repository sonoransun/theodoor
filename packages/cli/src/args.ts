/**
 * args.ts — per-command flag parsing (node:util parseArgs) and the typed
 * error hierarchy that maps onto CLI exit codes.
 *
 * Exit codes:
 *   0  ok / pass
 *   1  validation or noise-budget failure (findings still printed)
 *   2  usage error (unknown command/flag; usage goes to stderr)
 *   3  I/O or resolution error (missing file, unresolvable program/catalog)
 *   4  safety refusal (missing/wrong --armed-ack, unsatisfied interlocks)
 */

import { parseArgs } from 'node:util'

// ---------------------------------------------------------------------------
// Errors — one class per non-zero exit code family
// ---------------------------------------------------------------------------

/** Base class: carries the process exit code and optional structured extras. */
export class CliError extends Error {
  readonly exitCode: number
  /** Extra fields merged into the failure JSON object (e.g. interlocks). */
  readonly extra?: Record<string, unknown>

  constructor(message: string, exitCode: number, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
    if (extra !== undefined) this.extra = extra
  }
}

/** Exit 2: bad invocation (unknown command, unknown flag, missing argument). */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 2)
    this.name = 'UsageError'
  }
}

/** Exit 3: I/O or resolution failure (file, program module, catalog). */
export class IoError extends CliError {
  constructor(message: string) {
    super(message, 3)
    this.name = 'IoError'
  }
}

/** Exit 4: safety refusal — the interlock report rides along in `extra`. */
export class SafetyRefusalError extends CliError {
  constructor(message: string, extra?: Record<string, unknown>) {
    super(message, 4, extra)
    this.name = 'SafetyRefusalError'
  }
}

// ---------------------------------------------------------------------------
// Commands & usage
// ---------------------------------------------------------------------------

export const COMMAND_NAMES = [
  'validate',
  'simulate',
  'analyze',
  'align',
  'export',
  'fab',
  'stats',
  'gallery',
] as const

export type CommandName = (typeof COMMAND_NAMES)[number]

export const USAGE = `theodoor <command> [options]

Commands:
  validate   diagnostics for a show (site rules, solver, optional quiet budget)
  simulate   headless deterministic simulation; prints aggregate stats
  analyze    analyze a WAV file into a musical timeline summary
  align      the backward-solve view: target/fire/anticipation per cue
  export     write show artifacts (--target firing-script|artnet|waypoints|ilda|
             crowd-broadcast|beam-steering|cue-sheet)
  fab        write shop drawings / BOM (--target rack|panel|bom)
  stats      quick facts: cue counts, duration, SPL peaks, quiet pass/fail
  gallery    write the README/docs showcase SVGs (ungated design artwork)

Show input (exactly one, all commands except analyze):
  --show <id>          program id from the @theodoor/programs registry
  --program <path>     built JS module exporting default or 'buildResult' () => ({ show, compiled })
  --compiled <path>    CompiledShow interchange JSON

Global options:
  --json               print ONE JSON object to stdout (logs go to stderr)
  --out <dir>          output directory for file-writing commands
  --quiet-budget <db>  evaluate the summed-SPL noise budget at the listeners

Command options:
  simulate  --to <sec>            simulate up to this show time
            --seed <n>            informational only (the seed lives in the show)
  analyze   --wav <path>          WAV file to analyze
  export    --target <t>          firing-script|artnet|waypoints|ilda|
                                  crowd-broadcast|beam-steering|cue-sheet
            --armed-ack <phrase>  'ARM CONFIRMED' — required for hardware targets
  fab       --target <t>          rack|panel|bom
  stats     --exposure            carrier-exposure report: worst cells + PASS/FAIL
  gallery   --only <asset-id>     write just one gallery asset (default: all)

Exit codes: 0 ok · 1 validation/budget failure · 2 usage · 3 I/O · 4 safety refusal`

// ---------------------------------------------------------------------------
// Per-command option tables
// ---------------------------------------------------------------------------

interface OptionSpec {
  type: 'string' | 'boolean'
}

const SHOW_INPUT: Record<string, OptionSpec> = {
  show: { type: 'string' },
  program: { type: 'string' },
  compiled: { type: 'string' },
}

const GLOBAL: Record<string, OptionSpec> = {
  json: { type: 'boolean' },
  out: { type: 'string' },
  'quiet-budget': { type: 'string' },
}

const COMMAND_OPTIONS: Record<CommandName, Record<string, OptionSpec>> = {
  validate: { ...SHOW_INPUT, ...GLOBAL },
  simulate: { ...SHOW_INPUT, ...GLOBAL, to: { type: 'string' }, seed: { type: 'string' } },
  analyze: { ...GLOBAL, wav: { type: 'string' } },
  align: { ...SHOW_INPUT, ...GLOBAL },
  export: { ...SHOW_INPUT, ...GLOBAL, target: { type: 'string' }, 'armed-ack': { type: 'string' } },
  fab: { ...SHOW_INPUT, ...GLOBAL, target: { type: 'string' } },
  stats: { ...SHOW_INPUT, ...GLOBAL, exposure: { type: 'boolean' } },
  gallery: { ...GLOBAL, only: { type: 'string' } },
}

/** All flags any command can carry, normalized (numbers parsed). */
export interface CliFlags {
  json: boolean
  out?: string
  quietBudgetDb?: number
  show?: string
  program?: string
  compiled?: string
  to?: number
  seed?: number
  wav?: string
  target?: string
  armedAck?: string
  /** stats: print the carrier-exposure worst-cell table + PASS/FAIL. */
  exposure?: boolean
  /** gallery: write only the named asset. */
  only?: string
}

export interface ParsedCli {
  command: CommandName
  flags: CliFlags
}

function numberFlag(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new UsageError(`--${name} expects a finite number, got '${raw}'`)
  return n
}

/**
 * Parse `argv` (process.argv.slice(2)): first token is the command, the rest
 * are its flags. Throws UsageError on unknown commands/flags/positionals.
 */
export function parseCli(argv: readonly string[]): ParsedCli {
  const [command, ...rest] = argv
  if (command === undefined) throw new UsageError('missing command')
  if (!(COMMAND_NAMES as readonly string[]).includes(command)) {
    throw new UsageError(`unknown command '${command}'`)
  }
  const name = command as CommandName

  let values: Record<string, string | boolean | undefined>
  try {
    const parsed = parseArgs({
      args: [...rest],
      options: COMMAND_OPTIONS[name],
      allowPositionals: false,
      strict: true,
    })
    values = parsed.values as Record<string, string | boolean | undefined>
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err))
  }

  const str = (k: string): string | undefined =>
    typeof values[k] === 'string' ? (values[k] as string) : undefined

  const flags: CliFlags = { json: values['json'] === true }
  const out = str('out')
  if (out !== undefined) flags.out = out
  const budget = numberFlag('quiet-budget', str('quiet-budget'))
  if (budget !== undefined) flags.quietBudgetDb = budget
  const show = str('show')
  if (show !== undefined) flags.show = show
  const program = str('program')
  if (program !== undefined) flags.program = program
  const compiled = str('compiled')
  if (compiled !== undefined) flags.compiled = compiled
  const to = numberFlag('to', str('to'))
  if (to !== undefined) flags.to = to
  const seed = numberFlag('seed', str('seed'))
  if (seed !== undefined) flags.seed = seed
  const wav = str('wav')
  if (wav !== undefined) flags.wav = wav
  const target = str('target')
  if (target !== undefined) flags.target = target
  const armedAck = str('armed-ack')
  if (armedAck !== undefined) flags.armedAck = armedAck
  if (values['exposure'] === true) flags.exposure = true
  const only = str('only')
  if (only !== undefined) flags.only = only

  return { command: name, flags }
}
