/**
 * docs-integrity.test.ts — the documentation's images stay real.
 *
 * Every image reference in README.md and docs/**\/*.md must resolve to a file
 * that exists in the repo; every committed gallery SVG must be referenced
 * from at least one page (no orphans); and the gallery manifest must agree
 * with the files on disk. Tests may use node:fs — only core SRC is
 * isomorphism-restricted.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DOCS = join(REPO_ROOT, 'docs')
const GALLERY = join(DOCS, 'gallery')

interface ImageRef {
  page: string
  target: string
  resolved: string
}

function markdownPages(): string[] {
  const pages = [join(REPO_ROOT, 'README.md')]
  const stack = [DOCS]
  while (stack.length > 0) {
    const dir = stack.pop()!
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.endsWith('.md')) pages.push(full)
    }
  }
  return pages.sort()
}

function imageRefs(): ImageRef[] {
  const refs: ImageRef[] = []
  for (const page of markdownPages()) {
    const text = readFileSync(page, 'utf8')
    const md = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]!)
    const html = [...text.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!)
    for (const target of [...md, ...html]) {
      if (/^https?:/.test(target)) continue
      refs.push({ page, target, resolved: resolve(dirname(page), target) })
    }
  }
  return refs
}

describe('documentation image integrity', () => {
  const refs = imageRefs()

  it('finds a meaningful set of image references', () => {
    expect(refs.length).toBeGreaterThanOrEqual(6)
  })

  it('every referenced image exists in the repo', () => {
    const missing = refs.filter((r) => !existsSync(r.resolved))
    expect(
      missing.map((r) => `${r.page.slice(REPO_ROOT.length)} → ${r.target}`),
    ).toEqual([])
  })

  it('every committed gallery SVG is referenced from at least one page', () => {
    const referenced = new Set(refs.map((r) => r.resolved))
    const orphans = readdirSync(GALLERY)
      .filter((f) => f.endsWith('.svg'))
      .filter((f) => !referenced.has(join(GALLERY, f)))
    expect(orphans).toEqual([])
  })

  it('the gallery manifest agrees with the files on disk', () => {
    const manifest = JSON.parse(readFileSync(join(GALLERY, 'manifest.json'), 'utf8')) as {
      id: string
      file: string
      kind: 'static' | 'animated'
    }[]
    const svgs = readdirSync(GALLERY).filter((f) => f.endsWith('.svg')).sort()
    expect(manifest.map((m) => m.file).sort()).toEqual(svgs)
    for (const entry of manifest) {
      const svg = readFileSync(join(GALLERY, entry.file), 'utf8')
      expect(svg.includes('repeatCount="indefinite"')).toBe(entry.kind === 'animated')
    }
  })
})
