/**
 * repo-guards.test.ts — repo-wide invariants, enforced over source text:
 *
 *   (a) SAFETY VOCABULARY: the banned list from catalog-safety.test.ts,
 *       extended, must not appear anywhere under packages/*\/src, programs/src,
 *       or README.md. Effects are opaque performance metadata; the vocabulary
 *       of energetic materials has no business in this repo. (These words are
 *       allowed in THIS test file only — it is under test/, outside the scan.)
 *   (b) ISOMORPHISM: packages/core/src never imports node built-ins — core
 *       must run unchanged in the browser (the viz imports it directly).
 *   (c) DETERMINISM: no Date.now()/Math.random() call sites under
 *       packages/core/src or programs/src. Clocks are caller-supplied
 *       (safety/machine.ts documents this), randomness is seeded (math/rng).
 *   (d) BARREL COMPLETENESS: every directory under packages/core/src is
 *       re-exported from src/index.ts.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CORE_SRC = join(REPO_ROOT, 'packages', 'core', 'src')
const PROGRAMS_SRC = join(REPO_ROOT, 'programs', 'src')

/** Recursively list every file under dir (sorted, deterministic order). */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/** All scanned roots: every packages/*\/src that exists, programs/src, README.md. */
function scannedFiles(): string[] {
  const roots: string[] = []
  for (const entry of readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const src = join(REPO_ROOT, 'packages', entry.name, 'src')
    if (existsSync(src)) roots.push(src)
  }
  roots.push(PROGRAMS_SRC)
  const files = roots.flatMap((r) => walk(r))
  files.push(join(REPO_ROOT, 'README.md'))
  return files
}

const rel = (f: string): string => f.slice(REPO_ROOT.length)

// ---------------------------------------------------------------------------
// (a) banned vocabulary — catalog-safety list, extended, repo-wide
// ---------------------------------------------------------------------------

/** Superset of the list in catalog-safety.test.ts (kept in sync by hand). */
const BANNED_TERMS = [
  // catalog-safety.test.ts list:
  'perchlorate',
  'chlorate',
  'oxidizer',
  'black powder',
  'flash powder',
  'gunpowder',
  'pyrogen',
  'thermite',
  'composition',
  // repo-wide extensions (same spirit: generic energetic-materials vocabulary):
  'explosive',
  'detonat',
  'propellant',
  'nitrate',
  'ammonium',
  'shrapnel',
  'warhead',
] as const

describe('repo guards — safety vocabulary', () => {
  const files = scannedFiles()

  it('scans a plausible slice of the repo (all src trees + README.md)', () => {
    expect(files.length).toBeGreaterThanOrEqual(60)
    expect(files.some((f) => f.endsWith('README.md'))).toBe(true)
    expect(files.some((f) => f.includes(join('packages', 'core', 'src')))).toBe(true)
    expect(files.some((f) => f.includes(join('packages', 'viz', 'src')))).toBe(true)
    expect(files.some((f) => f.includes(join('programs', 'src')))).toBe(true)
  })

  it('no banned vocabulary anywhere in src trees or README.md', () => {
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase()
      for (const term of BANNED_TERMS) {
        if (text.includes(term)) violations.push(`'${term}' in ${rel(file)}`)
      }
    }
    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (b) isomorphism — core never imports node built-ins
// ---------------------------------------------------------------------------

describe('repo guards — core isomorphism', () => {
  it("packages/core/src has no `from 'node:` imports", () => {
    const violations: string[] = []
    for (const file of walk(CORE_SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (line.includes("from 'node:") || line.includes('from "node:')) {
          violations.push(`${rel(file)}:${i + 1}`)
        }
      })
    }
    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (c) determinism — no ambient clock / randomness call sites
// ---------------------------------------------------------------------------

const CLOCK_OR_RANDOM = /(?:Date\.now|Math\.random)\s*\(/

describe('repo guards — determinism', () => {
  it('no Date.now()/Math.random() call sites in core or programs src', () => {
    const roots = [CORE_SRC, PROGRAMS_SRC]
    const violations: string[] = []
    for (const file of roots.flatMap((r) => walk(r))) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // Match call sites only. Prose about caller-supplied clocks is fine:
        // safety/machine.ts and transport.ts document "no Date.now()" in
        // comments — skip line comments, block-comment prose, and clock
        // parameter documentation.
        if (line.includes('//') || line.includes('clock:')) return
        const lead = line.trimStart()
        if (lead.startsWith('*') || lead.startsWith('/*')) return
        if (CLOCK_OR_RANDOM.test(line)) violations.push(`${rel(file)}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (d) barrel completeness — src/index.ts re-exports every core directory
// ---------------------------------------------------------------------------

describe('repo guards — barrel completeness', () => {
  it('every packages/core/src directory is exported from src/index.ts', () => {
    const barrel = readFileSync(join(CORE_SRC, 'index.ts'), 'utf8')
    const dirs = readdirSync(CORE_SRC, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect(dirs.length).toBeGreaterThanOrEqual(14)
    const missing = dirs.filter((d) => !barrel.includes(`from './${d}/`))
    expect(missing).toEqual([])
  })

  it('the barrel also exports contracts', () => {
    const barrel = readFileSync(join(CORE_SRC, 'index.ts'), 'utf8')
    expect(barrel.includes("from './contracts.js'")).toBe(true)
  })
})
