/**
 * cli-gallery.test.ts — end-to-end tests for `theodoor gallery` against the
 * BUILT CLI + BUILT programs (several assets load flagship shows from the
 * @theodoor/programs registry). The tsc build retries a few times so a
 * concurrent build from another CLI test file can never fail this one.
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const cliJs = join(repoRoot, 'packages', 'cli', 'dist', 'index.js')

const EXPECTED_IDS = [
  'hero-cosmos-orbit',
  'keystone-cosmos-daybreak',
  'anim-crowd-ramp-cosmos',
  'site-lakeside-park',
  'timeline-hallows',
  'exposure-hallows',
  'spl-nye-vs-quiet',
  'formations',
  'beam-footprint-geometry',
  'scene-hallows-summit',
  'anim-drone-morph-cosmos',
  'anim-beam-flyover-hallows',
  'fab-rack-drawing',
] as const

const ANIMATED_IDS = new Set([
  'hero-cosmos-orbit',
  'anim-crowd-ramp-cosmos',
  'anim-drone-morph-cosmos',
  'anim-beam-flyover-hallows',
])

/** Soft byte budgets (1.5× the documented targets, matching core test style). */
const STATIC_MAX = 90_000
const ANIMATED_MAX = 600_000

let tmp: string

function runCli(args: readonly string[]) {
  const res = spawnSync('node', [cliJs, ...args], { encoding: 'utf8', cwd: repoRoot })
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

beforeAll(() => {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      execSync('npx tsc -b packages/cli programs', { cwd: repoRoot, stdio: 'pipe' })
      lastErr = undefined
      break
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr !== undefined) throw lastErr
  tmp = mkdtempSync(join(tmpdir(), 'theodoor-gallery-'))
}, 240_000)

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('theodoor gallery', () => {
  it('writes every registry asset plus a deterministic manifest', () => {
    const out = join(tmp, 'all')
    const res = runCli(['gallery', '--out', out, '--json'])
    expect(res.status).toBe(0)

    const files = readdirSync(out).sort()
    expect(files).toEqual([...EXPECTED_IDS.map((id) => `${id}.svg`), 'manifest.json'].sort())

    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as {
      id: string
      file: string
      title: string
      kind: 'static' | 'animated'
    }[]
    expect(manifest.map((m) => m.id)).toEqual([...EXPECTED_IDS])
    expect(readFileSync(join(out, 'manifest.json'), 'utf8')).not.toMatch(/\d{4}-\d{2}-\d{2}/)

    for (const entry of manifest) {
      const svg = readFileSync(join(out, entry.file), 'utf8')
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('theodoor gallery')
      if (entry.id === 'fab-rack-drawing') {
        // Reuses the fab shop drawing; currentColor is pinned via the root
        // `color` attribute instead of per-element fills.
        expect(svg).toContain(`color="`)
      } else {
        expect(svg).not.toContain('currentColor')
      }
      expect(entry.kind).toBe(ANIMATED_IDS.has(entry.id) ? 'animated' : 'static')
      if (ANIMATED_IDS.has(entry.id)) {
        expect(svg).toContain('repeatCount="indefinite"')
        expect(svg.length).toBeLessThanOrEqual(ANIMATED_MAX)
      } else {
        expect(svg.length).toBeLessThanOrEqual(STATIC_MAX)
      }
    }
  }, 240_000)

  it('--only writes exactly the named asset (no manifest truncation)', () => {
    const out = join(tmp, 'only')
    const res = runCli(['gallery', '--out', out, '--only', 'formations'])
    expect(res.status).toBe(0)
    expect(readdirSync(out)).toEqual(['formations.svg'])
    expect(existsSync(join(out, 'manifest.json'))).toBe(false)
  }, 120_000)

  it('unknown --only exits 2 listing the known ids', () => {
    const res = runCli(['gallery', '--out', join(tmp, 'x'), '--only', 'nope'])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('hero-cosmos-orbit')
  }, 30_000)

  it('missing --out exits 2', () => {
    const res = runCli(['gallery'])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('--out')
  }, 30_000)
})
