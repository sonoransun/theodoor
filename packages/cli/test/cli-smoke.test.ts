/**
 * cli-smoke.test.ts — end-to-end tests against the BUILT CLI.
 *
 * beforeAll builds packages/cli (tsc -b builds core first via references),
 * compiles a small fixture show through the core SRC (vitest aliases
 * @theodoor/core -> src) and writes it to a temp dir as CompiledShow JSON —
 * the interchange path every command accepts. Each test then execs
 * `node packages/cli/dist/index.js …` and asserts on exit codes, stdout
 * JSON, and written files. Deliberately independent of @theodoor/programs
 * (that package is built by a different owner).
 *
 * All tests live in ONE file so the tsc build is never raced by parallel
 * vitest workers.
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditEntry, CompiledCue } from '@theodoor/core'
import {
  buildTimelineFromScore,
  getScore,
  lakesidePark,
  musicRefs,
  showBuilder,
  starterCatalog,
  verifyEntries,
} from '@theodoor/core'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const cliJs = join(repoRoot, 'packages', 'cli', 'dist', 'index.js')

let tmp: string
let compiledPath: string
let fixtureCueCount = 0

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function runCli(args: readonly string[]): RunResult {
  const res = spawnSync('node', [cliJs, ...args], { encoding: 'utf8', cwd: repoRoot })
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

function json(res: RunResult): Record<string, unknown> {
  return JSON.parse(res.stdout) as Record<string, unknown>
}

/** Small builder show over odeToJoy + lakesidePark + starterCatalog. */
function buildFixture() {
  const catalog = starterCatalog()
  const site = lakesidePark()
  const score = getScore('odeToJoy')!
  const tl = buildTimelineFromScore(score)
  const m = musicRefs(tl)
  const b = showBuilder({ id: 'cli-fixture', title: 'CLI Fixture', seed: 7, site, catalog })
    .score(score)
    .preRoll(6)
  b.pyro
    .fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) })
    .fire({ effect: 'peony-100-white', position: 'rack-4', land: m.barBeat(5, 1) })
    .fire({ effect: 'comet-30-gold', position: 'rack-8', land: m.beat(20) })
  b.drones.formation({
    effect: 'ring-formation-60',
    position: 'pad-1',
    by: m.barBeat(9, 1),
    holdSec: 3,
    params: { count: 30, scaleM: 24 },
  })
  b.lasers.pattern({
    effect: 'laser-sweep-gold',
    position: 'laser-west',
    from: m.beat(8),
    durBeats: 8,
  })
  b.panels.pattern({
    effect: 'panel-solid-wash',
    position: 'panel-west',
    from: m.time(2),
    rgb: [1, 0.3, 0.2],
  })
  return b.build()
}

/** Deterministic in-memory click-track WAV (pcm16 mono) at the given BPM. */
function clickWavBytes(bpm: number, durationSec: number, sampleRate: number): Uint8Array {
  const n = Math.round(durationSec * sampleRate)
  const samples = new Float32Array(n)
  let s = 42 >>> 0
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const period = 60 / bpm
  for (let t = 0.5; t <= durationSec - 0.3; t += period) {
    const start = Math.round(t * sampleRate)
    const len = Math.round(0.04 * sampleRate)
    for (let i = 0; i < len && start + i < n; i++) {
      samples[start + i]! += (rnd() * 2 - 1) * Math.exp(-i / (0.008 * sampleRate)) * 0.8
    }
  }
  const bytes = new Uint8Array(44 + n * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (off: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[off + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32768))), true)
  }
  return bytes
}

beforeAll(() => {
  execSync('npx tsc -b packages/cli', { cwd: repoRoot, stdio: 'pipe' })
  tmp = mkdtempSync(join(tmpdir(), 'theodoor-cli-'))
  const { compiled } = buildFixture()
  fixtureCueCount = compiled.cues.length
  compiledPath = join(tmp, 'fixture.compiled.json')
  writeFileSync(compiledPath, JSON.stringify(compiled))
}, 180_000)

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('theodoor validate', () => {
  it('exits 0 with parseable diagnostics for a clean compiled show', () => {
    const res = runCli(['validate', '--compiled', compiledPath, '--json'])
    expect(res.status).toBe(0)
    const obj = json(res)
    expect(obj['ok']).toBe(true)
    expect(Array.isArray(obj['diagnostics'])).toBe(true)
    expect(obj['errors']).toBe(0)
  }, 30_000)

  it('fails the quiet budget with exit 1 and still prints findings', () => {
    const res = runCli(['validate', '--compiled', compiledPath, '--quiet-budget', '85', '--json'])
    expect(res.status).toBe(1)
    const obj = json(res)
    expect(obj['ok']).toBe(false)
    const quiet = obj['quiet'] as { pass: boolean; peakDb: number }
    expect(quiet.pass).toBe(false)
    expect(quiet.peakDb).toBeGreaterThan(85)
    const diags = obj['diagnostics'] as { code: string; severity: string }[]
    expect(diags.some((d) => d.code === 'acoustics/quiet-budget' && d.severity === 'error')).toBe(true)
  }, 30_000)
})

describe('theodoor align', () => {
  it('prints the cue array sorted by fireSec with the keystone identity', () => {
    const res = runCli(['align', '--compiled', compiledPath, '--json'])
    expect(res.status).toBe(0)
    const cues = json(res)['cues'] as CompiledCue[]
    expect(cues.length).toBe(fixtureCueCount)
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.fireSec).toBeGreaterThanOrEqual(cues[i - 1]!.fireSec)
    }
    for (const cue of cues) {
      expect(cue.fireSec).toBeCloseTo(cue.targetSec - cue.anticipationSec, 9)
    }
  }, 30_000)
})

describe('theodoor --program input', () => {
  it('loads a built JS module exporting a default build factory', () => {
    const modPath = join(tmp, 'program.mjs')
    writeFileSync(
      modPath,
      [
        "import { readFileSync } from 'node:fs'",
        'const compiled = JSON.parse(',
        "  readFileSync(new URL('./fixture.compiled.json', import.meta.url), 'utf8'),",
        ')',
        'export default () => ({ show: compiled.show, compiled })',
      ].join('\n'),
    )
    const res = runCli(['align', '--program', modPath, '--json'])
    expect(res.status).toBe(0)
    expect((json(res)['cues'] as CompiledCue[]).length).toBe(fixtureCueCount)
  }, 30_000)

  it('rejects giving two show inputs at once as a usage error', () => {
    const res = runCli(['align', '--compiled', compiledPath, '--show', 'x', '--json'])
    expect(res.status).toBe(2)
  }, 30_000)
})

describe('theodoor simulate', () => {
  it('runs headless to --to 20 and reports sane stats', () => {
    const res = runCli(['simulate', '--compiled', compiledPath, '--to', '20', '--json'])
    expect(res.status).toBe(0)
    const obj = json(res)
    expect(obj['ok']).toBe(true)
    const stats = obj['stats'] as {
      peakStars: number
      peakDrones: number
      steps: number
      splPeakByListener: (number | null)[]
    }
    expect(stats.peakStars).toBeGreaterThan(0)
    expect(stats.peakDrones).toBeGreaterThan(0)
    expect(stats.steps).toBeGreaterThan(1000)
    expect(stats.splPeakByListener.length).toBe(3)
    expect(stats.splPeakByListener[0]).toBeGreaterThan(0)
  }, 60_000)
})

describe('theodoor export — safety gate', () => {
  it('refuses firing-script without --armed-ack: exit 4, interlock report, nothing written', () => {
    const out = join(tmp, 'export-refused')
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'firing-script', '--out', out, '--json',
    ])
    expect(res.status).toBe(4)
    const obj = json(res)
    expect(obj['ok']).toBe(false)
    expect(obj['code']).toBe(4)
    const interlocks = obj['interlocks'] as { id: string; satisfied: boolean }[]
    expect(interlocks.some((r) => r.id === 'operator-ack' && !r.satisfied)).toBe(true)
    expect(existsSync(out)).toBe(false) // nothing written, not even the dir
  }, 30_000)

  it('refuses a wrong ack phrase with exit 4', () => {
    const out = join(tmp, 'export-wrong-ack')
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'firing-script',
      '--out', out, '--armed-ack', 'arm confirmed', '--json',
    ])
    expect(res.status).toBe(4)
    expect(existsSync(out)).toBe(false)
  }, 30_000)

  it('exports firing-script with the exact ack; audit chain verifies', () => {
    const out = join(tmp, 'export-armed')
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'firing-script',
      '--out', out, '--armed-ack', 'ARM CONFIRMED', '--json',
    ])
    expect(res.status).toBe(0)
    const obj = json(res)
    expect(obj['ok']).toBe(true)

    const csvPath = join(out, 'cli-fixture.firing-script.csv')
    expect(existsSync(csvPath)).toBe(true)
    const csv = readFileSync(csvPath, 'utf8')
    expect(csv.startsWith('fireTimeSec,module,pin,effectId')).toBe(true)
    expect(csv).toContain('peony-75-red')

    const auditPath = join(out, 'cli-fixture.audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    const entries = readFileSync(auditPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AuditEntry)
    expect(entries.length).toBeGreaterThanOrEqual(2) // ARM + GO LIVE at minimum
    expect(verifyEntries(entries).ok).toBe(true)
    expect(entries.some((e) => e.to === 'LIVE')).toBe(true)

    // Tampering breaks the chain at the edited entry.
    const tampered = entries.map((e, i) => (i === 1 ? { ...e, actor: 'intruder' } : e))
    expect(verifyEntries(tampered)).toEqual({ ok: false, brokenAt: 1 })
  }, 30_000)

  it('exports cue-sheet without any ack (ungated design artifact)', () => {
    const out = join(tmp, 'export-cuesheet')
    const res = runCli(['export', '--compiled', compiledPath, '--target', 'cue-sheet', '--out', out])
    expect(res.status).toBe(0)
    const md = readFileSync(join(out, 'cli-fixture.cue-sheet.md'), 'utf8')
    expect(md).toContain('# Cue Sheet — CLI Fixture')
    expect(md).toContain('SIMULATION ONLY')
    expect(existsSync(join(out, 'cli-fixture.audit.jsonl'))).toBe(false) // no gate, no audit
  }, 30_000)

  it('exports drone waypoints (CSV + JSON) when armed', () => {
    const out = join(tmp, 'export-waypoints')
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'waypoints',
      '--out', out, '--armed-ack', 'ARM CONFIRMED', '--json',
    ])
    expect(res.status).toBe(0)
    const csv = readFileSync(join(out, 'cli-fixture.waypoints.csv'), 'utf8')
    expect(csv.startsWith('droneId,tSec,x,y,z,r,g,b')).toBe(true)
    const wp = JSON.parse(readFileSync(join(out, 'cli-fixture.waypoints.json'), 'utf8')) as {
      format: string
      drones: { droneId: number; waypoints: unknown[] }[]
    }
    expect(wp.format).toBe('theodoor-drone-waypoints')
    expect(wp.drones.length).toBeGreaterThan(0)
    expect(verifyEntries(
      readFileSync(join(out, 'cli-fixture.audit.jsonl'), 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as AuditEntry),
    ).ok).toBe(true)
  }, 60_000)
})

describe('theodoor fab', () => {
  it('bom --json reports positive totals', () => {
    const res = runCli(['fab', '--compiled', compiledPath, '--target', 'bom', '--json'])
    expect(res.status).toBe(0)
    const bom = json(res)['bom'] as {
      igniters: number
      drones: { flying: number; total: number }
      lasers: number
      mortarTubesByCaliber: Record<string, number>
    }
    expect(bom.igniters).toBe(3) // one per pyro cue
    expect(bom.drones.flying).toBe(260) // pad-1 (200) + pad-2 (60)
    expect(bom.drones.total).toBe(299) // +15% spares
    expect(bom.lasers).toBe(2)
    const tubes = Object.values(bom.mortarTubesByCaliber).reduce((a, b) => a + b, 0)
    expect(tubes).toBe(3)
  }, 30_000)

  it('rack --out writes one dimensioned SVG per rack asset', () => {
    const out = join(tmp, 'fab-rack')
    const res = runCli(['fab', '--compiled', compiledPath, '--target', 'rack', '--out', out])
    expect(res.status).toBe(0)
    const files = readdirSync(out).filter((f) => f.endsWith('.rack.svg'))
    expect(files.length).toBe(8) // lakesidePark has 8 racks
    const svg = readFileSync(join(out, 'rack-1.rack.svg'), 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('mm')
  }, 30_000)
})

describe('theodoor stats', () => {
  it('reports cue counts by medium, duration, and SPL peaks', () => {
    const res = runCli(['stats', '--compiled', compiledPath, '--json'])
    expect(res.status).toBe(0)
    const obj = json(res)
    expect(obj['cueCounts']).toEqual({ pyro: 3, drone: 1, laser: 1, panel: 1 })
    expect(obj['durationSec']).toBeGreaterThan(0)
    const spl = obj['splPeakByListener'] as number[]
    expect(spl.length).toBe(3)
    expect(spl[1]).toBeGreaterThan(90) // peonies at ~190 m
  }, 30_000)
})

describe('theodoor analyze', () => {
  it('recovers ~120 BPM from a synthesized click-track WAV', () => {
    const wavPath = join(tmp, 'click120.wav')
    writeFileSync(wavPath, clickWavBytes(120, 8, 22050))
    const res = runCli(['analyze', '--wav', wavPath, '--json'])
    expect(res.status).toBe(0)
    const obj = json(res)
    expect(obj['ok']).toBe(true)
    expect(Math.abs((obj['bpm'] as number) - 120)).toBeLessThanOrEqual(2)
    expect(obj['beats']).toBeGreaterThan(8)
    expect(obj['durationSec']).toBeCloseTo(8, 3)
    const timeline = obj['timeline'] as Record<string, unknown>
    expect(timeline['source']).toBe('analysis')
    expect(timeline['score']).toBeUndefined() // sans score
  }, 60_000)

  it('exits 3 on a missing WAV file', () => {
    const res = runCli(['analyze', '--wav', join(tmp, 'nope.wav'), '--json'])
    expect(res.status).toBe(3)
    const obj = json(res)
    expect(obj['ok']).toBe(false)
    expect(obj['code']).toBe(3)
  }, 30_000)
})

describe('exit-code mapping', () => {
  it('unknown flag exits 2 with usage on stderr', () => {
    const res = runCli(['align', '--compiled', compiledPath, '--bogus'])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('theodoor <command>')
  }, 30_000)

  it('unknown command exits 2', () => {
    const res = runCli(['frobnicate'])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("unknown command 'frobnicate'")
  }, 30_000)

  it('missing --compiled file exits 3 with a JSON failure object', () => {
    const res = runCli(['validate', '--compiled', join(tmp, 'missing.json'), '--json'])
    expect(res.status).toBe(3)
    const obj = json(res)
    expect(obj).toMatchObject({ ok: false, code: 3 })
  }, 30_000)

  it('--show exits 3 gracefully whether or not programs is built', () => {
    // Never depends on @theodoor/programs being built: an unbuilt package is
    // a resolution error, a built one reports the unknown program id.
    const res = runCli(['stats', '--show', 'no-such-program-xyz', '--json'])
    expect(res.status).toBe(3)
    const obj = json(res)
    expect(obj['ok']).toBe(false)
    expect(String(obj['error'])).toMatch(/programs/i)
  }, 30_000)
})
