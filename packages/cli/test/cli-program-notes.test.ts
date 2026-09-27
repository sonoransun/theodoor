/**
 * cli-program-notes.test.ts — `theodoor export --target program-notes`
 * against the BUILT CLI + BUILT programs. The guest program is a design
 * artifact: UNGATED (no --armed-ack, no audit log), exit 0, one markdown file.
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildTimelineFromScore,
  getScore,
  lakesidePark,
  musicRefs,
  showBuilder,
  starterCatalog,
} from '@theodoor/core'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const cliJs = join(repoRoot, 'packages', 'cli', 'dist', 'index.js')

let tmp: string
let compiledPath: string

function runCli(args: readonly string[]) {
  const res = spawnSync('node', [cliJs, ...args], { encoding: 'utf8', cwd: repoRoot })
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

function buildFixture() {
  const tl = buildTimelineFromScore(getScore('odeToJoy')!)
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'notes-cli',
    title: 'Notes CLI Fixture',
    seed: 11,
    site: lakesidePark(),
    catalog: starterCatalog(),
  })
    .music(tl)
    .preRoll(6)
    .notes({ tagline: 'A fixture with a program.', music: ['Beethoven — Ode to Joy (1824)'] })
    .act('I — Opening', m.time(0), 'Watch the first shell.')
    .act('II — Finale', m.barBeat(17, 1), 'Watch the willow.')
  b.pyro
    .fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) })
    .fire({ effect: 'willow-150-gold', position: 'rack-4', land: m.barBeat(19, 1) })
  b.crowd.flood({ effect: 'crowd-flood-rgb', position: 'mast-west', from: m.barBeat(18, 1) })
  return b.build()
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
  tmp = mkdtempSync(join(tmpdir(), 'theodoor-notes-'))
  const { compiled } = buildFixture()
  expect(compiled.acts?.map((a) => a.title)).toEqual(['I — Opening', 'II — Finale'])
  compiledPath = join(tmp, 'fixture.compiled.json')
  writeFileSync(compiledPath, JSON.stringify(compiled))
}, 240_000)

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('theodoor export --target program-notes', () => {
  it('writes <id>.program.md ungated: exit 0, no --armed-ack, no audit log', () => {
    const out = join(tmp, 'fixture-out')
    const res = runCli(['export', '--compiled', compiledPath, '--target', 'program-notes', '--out', out, '--json'])
    expect(res.status).toBe(0)
    const obj = JSON.parse(res.stdout) as { ok: boolean; gated: boolean; files: string[]; auditLog?: string }
    expect(obj.ok).toBe(true)
    expect(obj.gated).toBe(false)
    expect(obj.auditLog).toBeUndefined()
    expect(obj.files).toHaveLength(1)
    expect(obj.files[0]!.endsWith('notes-cli.program.md')).toBe(true)
    expect(readdirSync(out)).toEqual(['notes-cli.program.md'])
    expect(existsSync(join(out, 'notes-cli.audit.jsonl'))).toBe(false)
    expect(res.stderr).toContain('design artifact')

    const md = readFileSync(join(out, 'notes-cli.program.md'), 'utf8')
    expect(md.startsWith('# Notes CLI Fixture')).toBe(true)
    expect(md).toContain('*A fixture with a program.*')
    expect(md).toContain('## I — Opening (0:00)')
    expect(md).toContain('## II — Finale (')
    expect(md).toContain('Watch the willow.')
    expect(md).toContain('*Look for:*')
    expect(md).toContain('## How it lands on the beat')
    expect(md).not.toContain('SIMULATION ONLY')
  }, 30_000)

  it('prints the program of a flagship straight from the registry (--show hallows)', () => {
    const out = join(tmp, 'hallows-out')
    const res = runCli(['export', '--show', 'hallows', '--target', 'program-notes', '--out', out])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('hallows.program.md')
    const md = readFileSync(join(out, 'hallows.program.md'), 'utf8')
    expect(md).toContain('# The Unquiet Hour')
    for (const title of ['I — The Summoning', 'II — The Dance', 'III — The Chase', 'IV — Dawn']) {
      expect(md).toContain(`## ${title} (`)
    }
    expect(md).toContain('Camille Saint-Saëns — Danse Macabre (1874)')
    expect(md).toContain('everywhere-at-once')
    expect(existsSync(join(out, 'hallows.audit.jsonl'))).toBe(false)
  }, 60_000)

  it('the quiet variant carries the budget remark', () => {
    const out = join(tmp, 'quiet-out')
    const res = runCli(['export', '--show', 'aurora-quiet', '--target', 'program-notes', '--out', out])
    expect(res.status).toBe(0)
    const md = readFileSync(join(out, 'aurora-quiet.program.md'), 'utf8')
    expect(md).toContain('A quiet-variant performance')
    expect(md).toContain('held to 85 dB')
  }, 60_000)
})
