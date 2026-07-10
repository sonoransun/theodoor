/**
 * Safety-boundary guard: catalog source must stay pure performance metadata.
 * The banned list is deliberately generic vocabulary; none of it may appear
 * anywhere under src/catalog/ (code, comments, strings, ids).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CATALOG_SRC = fileURLToPath(new URL('../src/catalog', import.meta.url))

const BANNED_TERMS = [
  'perchlorate',
  'chlorate',
  'oxidizer',
  'black powder',
  'flash powder',
  'gunpowder',
  'pyrogen',
  'thermite',
  'composition',
] as const

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

describe('catalog safety boundary', () => {
  const files = walk(CATALOG_SRC)

  it('scans the whole catalog source tree', () => {
    expect(files.length).toBeGreaterThanOrEqual(9)
    expect(files.every((f) => f.endsWith('.ts'))).toBe(true)
  })

  it('contains none of the banned vocabulary', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8').toLowerCase()
      for (const term of BANNED_TERMS) {
        expect(text.includes(term), `'${term}' found in ${file}`).toBe(false)
      }
    }
  })
})
