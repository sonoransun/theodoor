/**
 * load.ts — the uniform show-input surface shared by every command.
 *
 *   --show <id>        from the @theodoor/programs registry, imported via a
 *                      computed specifier so tsc never needs programs' types
 *   --program <path>   built JS module exporting default or 'buildResult'
 *                      () => ({ show, compiled })
 *   --compiled <path>  plain CompiledShow interchange JSON (primary test path)
 *
 * Effects resolve via starterCatalog() when the show references
 * STARTER_CATALOG_ID; any other catalog id is an exit-3 resolution error.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CompiledShow, EffectDef } from '@theodoor/core'
import { STARTER_CATALOG_ID, getEffectFrom, starterCatalog } from '@theodoor/core'
import { IoError, UsageError, type CliFlags } from './args.js'

export type EffectLookup = (id: string) => EffectDef | undefined

export interface LoadedShow {
  compiled: CompiledShow
  /** Which input flag produced it. */
  origin: 'show' | 'program' | 'compiled'
}

/** Duck-typed CompiledShow check (JSON.parse gives plain objects — fine). */
export function isCompiledShow(v: unknown): v is CompiledShow {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const show = o['show'] as Record<string, unknown> | undefined
  return (
    typeof show === 'object' &&
    show !== null &&
    typeof show['catalogId'] === 'string' &&
    typeof (show['meta'] as Record<string, unknown> | undefined)?.['id'] === 'string' &&
    Array.isArray(o['cues']) &&
    Array.isArray(o['diagnostics'])
  )
}

interface BuildResultShape {
  show: unknown
  compiled: CompiledShow
}

function callBuildFactory(factory: unknown, what: string): CompiledShow {
  if (typeof factory !== 'function') {
    throw new IoError(`${what} is not a function returning { show, compiled }`)
  }
  let result: unknown
  try {
    result = (factory as () => unknown)()
  } catch (err) {
    throw new IoError(`${what} threw while building: ${message(err)}`)
  }
  const compiled = (result as Partial<BuildResultShape> | undefined)?.compiled
  if (!isCompiledShow(compiled)) {
    throw new IoError(`${what} did not return a { show, compiled } build result`)
  }
  return compiled
}

async function loadFromRegistry(id: string): Promise<CompiledShow> {
  // Computed specifier: tsc never resolves @theodoor/programs' types; the
  // package is looked up at runtime only.
  const spec = '@theodoor' + '/programs'
  let mod: unknown
  try {
    mod = await import(spec)
  } catch (err) {
    throw new IoError(
      `cannot resolve @theodoor/programs (${message(err)}); ` +
        `build programs first: npx tsc -b programs`,
    )
  }
  const registry = (mod as { PROGRAMS?: unknown }).PROGRAMS
  if (typeof registry !== 'object' || registry === null) {
    throw new IoError('@theodoor/programs does not export a PROGRAMS registry')
  }
  const programs = registry as Record<string, unknown>
  const entry = programs[id]
  if (entry === undefined) {
    const known = Object.keys(programs).sort().join(', ')
    throw new IoError(`unknown program '${id}'; known programs: ${known || '(none)'}`)
  }
  return callBuildFactory(entry, `program '${id}'`)
}

async function loadFromModule(path: string): Promise<CompiledShow> {
  const url = pathToFileURL(resolve(path)).href
  let mod: unknown
  try {
    mod = await import(url)
  } catch (err) {
    throw new IoError(`cannot import program module '${path}': ${message(err)}`)
  }
  const m = mod as { default?: unknown; buildResult?: unknown }
  const factory = m.default ?? m.buildResult
  if (factory === undefined) {
    throw new IoError(`program module '${path}' exports neither 'default' nor 'buildResult'`)
  }
  return callBuildFactory(factory, `program module '${path}'`)
}

async function loadFromJson(path: string): Promise<CompiledShow> {
  let text: string
  try {
    text = await readFile(resolve(path), 'utf8')
  } catch (err) {
    throw new IoError(`cannot read compiled show '${path}': ${message(err)}`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    throw new IoError(`'${path}' is not valid JSON: ${message(err)}`)
  }
  if (!isCompiledShow(value)) {
    throw new IoError(`'${path}' is not a CompiledShow (expected { show, cues, diagnostics })`)
  }
  return value
}

/** Load the show from exactly one of --show / --program / --compiled. */
export async function loadCompiledShow(flags: CliFlags): Promise<LoadedShow> {
  const given = [
    flags.show !== undefined ? 'show' : undefined,
    flags.program !== undefined ? 'program' : undefined,
    flags.compiled !== undefined ? 'compiled' : undefined,
  ].filter((x): x is 'show' | 'program' | 'compiled' => x !== undefined)
  if (given.length !== 1) {
    throw new UsageError('provide exactly one of --show <id>, --program <path>, --compiled <path>')
  }
  const origin = given[0]!
  const compiled =
    origin === 'show'
      ? await loadFromRegistry(flags.show!)
      : origin === 'program'
        ? await loadFromModule(flags.program!)
        : await loadFromJson(flags.compiled!)
  return { compiled, origin }
}

/**
 * Effect lookup for a loaded show: the starter catalog resolves by id; any
 * other catalog is a resolution error (the CLI bundles no other catalogs).
 */
export function effectLookupFor(compiled: CompiledShow): EffectLookup {
  const catalogId = compiled.show.catalogId
  if (catalogId === STARTER_CATALOG_ID) return getEffectFrom(starterCatalog())
  throw new IoError(
    `show references catalog '${catalogId}' which the CLI cannot resolve ` +
      `(only '${STARTER_CATALOG_ID}' is bundled)`,
  )
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
