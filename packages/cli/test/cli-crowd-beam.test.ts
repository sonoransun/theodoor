/**
 * cli-crowd-beam.test.ts — end-to-end tests for the wave-3 CLI surface:
 * export targets crowd-broadcast / beam-steering (both hardware-gated),
 * the broadcast-bandwidth interlock (recomputed fresh at arm time from the
 * choreo demand model AND the actual exporter stream), audit-chain
 * persistence on mid-emission write failure, and stats --exposure.
 *
 * Mirrors cli-smoke.test.ts: beforeAll builds packages/cli, compiles a
 * crowd+beam fixture through the core SRC (vitest aliases @theodoor/core →
 * src) and writes it as CompiledShow JSON; tests exec the BUILT CLI and
 * assert on exit codes, stdout JSON, and written files. The tsc build
 * retries a few times so a concurrent build from another CLI test file can
 * never fail this one.
 *
 * The main fixture's masts carry a zero-jitter latency spec and a 120
 * frames/s cap so its flood ramps in a single tick and the scheduled stream
 * genuinely fits the cap (the arm interlock audits the ACTUAL stream). The
 * wave fixture pins its masts to an undersized 30 frames/s budget precisely
 * so it overruns; the venue's real masts carry 1500 frames/s of headroom.
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditEntry, CompiledShow, SitePlan } from '@theodoor/core'
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
let wavePath: string
let strippedPath: string

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

function readAudit(path: string): AuditEntry[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditEntry)
}

/**
 * lakesidePark with broadcast-feasible masts: zero-jitter latency (all
 * quantiles equal, so a flood ramps in ONE mast tick instead of fanning a
 * distinct tuple per lit-fraction step) and a 120 frames/s cap that clears
 * the ~68-tuple single-tick flood jump. p95 values match the stock preset,
 * so solver anticipation (= p95) and cue timing are unchanged.
 */
function feasibleSite(): SitePlan {
  const base = lakesidePark()
  return {
    ...base,
    assets: base.assets.map((a) =>
      a.kind === 'crowdMast'
        ? {
            ...a,
            crowdMast: {
              ...a.crowdMast!,
              framesPerSec: 120,
              wristband: { minMs: 80, p50Ms: 80, p95Ms: 80, maxMs: 80 },
              phone: { minMs: 1200, p50Ms: 1200, p95Ms: 1200, maxMs: 1200 },
            },
          }
        : a,
    ),
  }
}

/** Crowd + beam fixture (south-array targets clear exposure). */
function buildFixture() {
  const catalog = starterCatalog()
  const score = getScore('odeToJoy')!
  const tl = buildTimelineFromScore(score)
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'cli-crowd-beam',
    title: 'CLI Crowd Beam',
    seed: 11,
    site: feasibleSite(),
    catalog,
  })
    .score(score)
    .preRoll(6)
  b.crowd
    .flood({ effect: 'crowd-flood-rgb', position: 'mast-west', from: m.barBeat(3, 1) })
    .haptic({ effect: 'crowd-haptic-thump', position: 'mast-east', land: m.barBeat(9, 1) })
  b.beams
    .whisper({
      effect: 'beam-whisper-narration',
      position: 'beam-south-west',
      target: 267,
      land: m.barBeat(3, 1),
    })
    .flyover({
      effect: 'beam-flyover-whoosh',
      position: 'beam-south-west',
      path: [266, 267, 268],
      land: m.barBeat(11, 1),
    })
  return b.build()
}

/**
 * Gradient wave on lakesidePark with the masts pinned to an undersized
 * 30 frames/s budget: the choreo demand model passes (10 Hz maskUpdateHz vs
 * the 30 frames/s cap) but the exporter stream fans out to one SET frame per
 * distinct tuple per tick and overruns the cap ~9x. (The venue's real masts
 * carry 1500 frames/s of broadcast headroom, so the flagships arm cleanly.)
 */
function buildWaveFixture() {
  const catalog = starterCatalog()
  const score = getScore('odeToJoy')!
  const tl = buildTimelineFromScore(score)
  const m = musicRefs(tl)
  const site = lakesidePark()
  const b = showBuilder({
    id: 'cli-crowd-wave',
    title: 'CLI Crowd Wave',
    seed: 11,
    site: {
      ...site,
      assets: site.assets.map((a) =>
        a.crowdMast ? { ...a, crowdMast: { ...a.crowdMast, framesPerSec: 30 } } : a,
      ),
    },
    catalog,
  })
    .score(score)
    .preRoll(6)
  b.crowd.wave({
    effect: 'crowd-wave-lateral',
    position: 'mast-west',
    from: m.barBeat(3, 1),
    periodBeats: 8,
  })
  return b.build()
}

beforeAll(() => {
  // Tolerate a concurrent `tsc -b packages/cli` from another test file.
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      execSync('npx tsc -b packages/cli', { cwd: repoRoot, stdio: 'pipe' })
      lastErr = undefined
      break
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr !== undefined) throw lastErr

  tmp = mkdtempSync(join(tmpdir(), 'theodoor-cli-cb-'))
  const { compiled } = buildFixture()
  expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  compiledPath = join(tmp, 'crowd-beam.compiled.json')
  writeFileSync(compiledPath, JSON.stringify(compiled))

  // Gradient wave show: compiles CLEAN (the demand model cannot see tuple
  // fan-out) yet its broadcast stream overruns the pinned 30 frames/s cap.
  const wave = buildWaveFixture().compiled
  expect(wave.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  wavePath = join(tmp, 'crowd-wave.compiled.json')
  writeFileSync(wavePath, JSON.stringify(wave))

  // Doctored interchange JSON: diagnostics stripped AND mast caps shrunk to
  // 1 frame/s, so the cues overrun the cap while the embedded diagnostics
  // array claims nothing is wrong. Only an arm-time recompute can catch it.
  const stripped = JSON.parse(readFileSync(compiledPath, 'utf8')) as CompiledShow
  ;(stripped as { diagnostics: unknown[] }).diagnostics = []
  for (const a of stripped.show.site.assets) {
    if (a.crowdMast) (a.crowdMast as { framesPerSec: number }).framesPerSec = 1
  }
  strippedPath = join(tmp, 'crowd-stripped.compiled.json')
  writeFileSync(strippedPath, JSON.stringify(stripped))
}, 180_000)

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('export --target crowd-broadcast (hardware-gated)', () => {
  it('refuses without --armed-ack: exit 4, interlock report, nothing written', () => {
    const out = join(tmp, 'cb-refused')
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'crowd-broadcast', '--out', out, '--json',
    ])
    expect(res.status).toBe(4)
    const obj = json(res)
    expect(obj['ok']).toBe(false)
    expect(obj['code']).toBe(4)
    const interlocks = obj['interlocks'] as { id: string; satisfied: boolean }[]
    expect(interlocks.some((r) => r.id === 'operator-ack' && !r.satisfied)).toBe(true)
    expect(existsSync(out)).toBe(false)
  }, 60_000)

  it('writes csv + bin + index json + audit chain with the exact ack', () => {
    const out = join(tmp, 'cb-armed')
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'crowd-broadcast',
      '--out', out, '--armed-ack', 'ARM CONFIRMED', '--json',
    ])
    expect(res.status).toBe(0)
    const obj = json(res)
    expect(obj['ok']).toBe(true)
    expect(obj['gated']).toBe(true)
    expect((obj['files'] as string[]).length).toBe(3)

    const csv = readFileSync(join(out, 'cli-crowd-beam.crowd-broadcast.csv'), 'utf8')
    expect(csv.startsWith('tSec,mastId,frameType,cellMaskHex,r,g,b,intensity,rampMs,cueIds')).toBe(true)
    expect(csv).toContain('PULSE') // the haptic cue rides the stream
    expect(csv).toContain('mast-west')

    // .bin walks cleanly on u32 BE length prefixes and matches the index.
    const bin = readFileSync(join(out, 'cli-crowd-beam.crowd-broadcast.bin'))
    const idx = JSON.parse(readFileSync(join(out, 'cli-crowd-beam.crowd-broadcast.json'), 'utf8')) as {
      format: string
      cellCount: number
      masts: { mastId: string }[]
      frames: { byteOffset: number; byteLength: number }[]
    }
    expect(idx.format).toBe('theodoor-crowd-broadcast')
    expect(idx.cellCount).toBe(342)
    expect(idx.masts.map((m) => m.mastId)).toEqual(['mast-west', 'mast-east'])
    let off = 0
    let count = 0
    while (off < bin.length) {
      const len = bin.readUInt32BE(off)
      expect(idx.frames[count]).toEqual({
        ...idx.frames[count],
        byteOffset: off,
        byteLength: 4 + len,
      })
      off += 4 + len
      count++
    }
    expect(off).toBe(bin.length)
    expect(count).toBe(idx.frames.length)
    expect(count).toBeGreaterThan(0)

    const audit = readAudit(join(out, 'cli-crowd-beam.audit.jsonl'))
    expect(verifyEntries(audit).ok).toBe(true)
    expect(audit.some((e) => e.to === 'LIVE')).toBe(true)
    // AuditEntry.tMs is contractually MILLISECONDS: epoch-ms integers
    // (> 1e12 ≈ Sep 2001), never a seconds reading (~1.7e9).
    for (const e of audit) {
      expect(Number.isInteger(e.tMs)).toBe(true)
      expect(e.tMs).toBeGreaterThan(1e12)
    }
  }, 60_000)

  it('refuses when the exporter stream overruns a mast cap (demand model clean)', () => {
    const out = join(tmp, 'cb-wave-overrun')
    const res = runCli([
      'export', '--compiled', wavePath, '--target', 'crowd-broadcast',
      '--out', out, '--armed-ack', 'ARM CONFIRMED', '--json',
    ])
    expect(res.status).toBe(4)
    const obj = json(res)
    expect(obj['ok']).toBe(false)
    const interlocks = obj['interlocks'] as { id: string; satisfied: boolean }[]
    expect(interlocks.some((r) => r.id === 'broadcast-bandwidth' && !r.satisfied)).toBe(true)
    // The refusal names the overrunning mast and its measured peak.
    expect(obj['error']).toMatch(/broadcast stream overruns/)
    expect(obj['error']).toMatch(/mast-west peaks at \d+ frames\/s \(cap 30\)/)
    expect(existsSync(out)).toBe(false)
  }, 60_000)

  it('recomputes bandwidth at arm time: stripped diagnostics cannot open the gate', () => {
    const out = join(tmp, 'cb-stripped')
    const res = runCli([
      'export', '--compiled', strippedPath, '--target', 'crowd-broadcast',
      '--out', out, '--armed-ack', 'ARM CONFIRMED', '--json',
    ])
    expect(res.status).toBe(4)
    const obj = json(res)
    expect(obj['ok']).toBe(false)
    const interlocks = obj['interlocks'] as { id: string; satisfied: boolean }[]
    expect(interlocks.some((r) => r.id === 'broadcast-bandwidth' && !r.satisfied)).toBe(true)
    expect(existsSync(out)).toBe(false)
  }, 60_000)

  it('persists the audit chain when an artifact write fails mid-emission (exit 3)', () => {
    const out = join(tmp, 'cb-io-fail')
    // Squat the .bin artifact name with a DIRECTORY: the .csv write succeeds,
    // the .bin write throws, and the audit chain must still land on disk.
    mkdirSync(join(out, 'cli-crowd-beam.crowd-broadcast.bin'), { recursive: true })
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'crowd-broadcast',
      '--out', out, '--armed-ack', 'ARM CONFIRMED', '--json',
    ])
    expect(res.status).toBe(3)
    expect(json(res)['ok']).toBe(false)
    // The gated emission that DID happen is on disk…
    expect(existsSync(join(out, 'cli-crowd-beam.crowd-broadcast.csv'))).toBe(true)
    // …and so is the audit chain recording it, closed out by STAND DOWN and
    // DISARM, with the hash chain intact.
    const audit = readAudit(join(out, 'cli-crowd-beam.audit.jsonl'))
    expect(verifyEntries(audit).ok).toBe(true)
    expect(audit.some((e) => e.to === 'LIVE')).toBe(true)
    expect(audit.at(-1)!.to).toBe('DISARMED')
  }, 60_000)
})

describe('export --target beam-steering (hardware-gated)', () => {
  it('refuses a wrong ack phrase with exit 4 and writes nothing', () => {
    const out = join(tmp, 'bs-wrong-ack')
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'beam-steering',
      '--out', out, '--armed-ack', 'arm confirmed', '--json',
    ])
    expect(res.status).toBe(4)
    expect(existsSync(out)).toBe(false)
  }, 60_000)

  it('writes csv + json + audit chain with the exact ack', () => {
    const out = join(tmp, 'bs-armed')
    const res = runCli([
      'export', '--compiled', compiledPath, '--target', 'beam-steering',
      '--out', out, '--armed-ack', 'ARM CONFIRMED', '--json',
    ])
    expect(res.status).toBe(0)
    expect(json(res)['ok']).toBe(true)

    const csv = readFileSync(join(out, 'cli-crowd-beam.beam-steering.csv'), 'utf8')
    expect(
      csv.startsWith('tSec,arrayId,eventType,panDeg,tiltDeg,gainDb,audibleDb,programRef,cueId,pairId,role'),
    ).toBe(true)
    expect(csv).toContain('beam-south-west')
    expect(csv).toContain(',start,')
    expect(csv).toContain(',stop,')
    expect(csv).not.toContain('whoosh-audio') // timing/geometry only

    const doc = JSON.parse(readFileSync(join(out, 'cli-crowd-beam.beam-steering.json'), 'utf8')) as {
      format: string
      speedOfSoundMps: number
      arrays: { arrayId: string; events: unknown[] }[]
    }
    expect(doc.format).toBe('theodoor-beam-steering')
    expect(doc.speedOfSoundMps).toBe(343)
    expect(doc.arrays.map((a) => a.arrayId)).toEqual(['beam-south-west'])
    expect(doc.arrays[0]!.events.length).toBeGreaterThan(2)

    expect(verifyEntries(readAudit(join(out, 'cli-crowd-beam.audit.jsonl'))).ok).toBe(true)
  }, 60_000)
})

describe('stats --exposure', () => {
  it('prints the worst-cell table and PASS for a clean show (exit 0)', () => {
    const res = runCli(['stats', '--compiled', compiledPath, '--exposure'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('exposure budget:')
    expect(res.stdout).toContain('PASS')
    expect(res.stdout).toContain('cellIndex')
    expect(res.stdout).toContain('peakCarrierDb')
    expect(res.stdout).toContain('dwellSec')
  }, 120_000)

  it('--json embeds the full ExposureReport and the crowd/beam sim stats', () => {
    const res = runCli(['stats', '--compiled', compiledPath, '--exposure', '--json'])
    expect(res.status).toBe(0)
    const obj = json(res)
    expect(obj['ok']).toBe(true)
    const exposure = obj['exposure'] as {
      pass: boolean
      peakDb: number
      cells: unknown[]
      budget: { maxCarrierDb: number }
      violations: unknown[]
    }
    expect(exposure.pass).toBe(true)
    expect(exposure.budget.maxCarrierDb).toBe(110)
    expect(exposure.cells).toHaveLength(342)
    expect(exposure.violations).toEqual([])
    expect(exposure.peakDb).toBeGreaterThan(0)
    expect(exposure.peakDb).toBeLessThanOrEqual(110)
    // The three wave-3 SimStats fields ride along for crowd/beam shows.
    expect(obj['peakCrowdCellsLit']).toBeGreaterThan(0)
    expect(obj['peakActiveBeams']).toBeGreaterThanOrEqual(1)
    expect(obj['beamLandingErrorSecMax']).toBeLessThan(0.01) // the keystone, audibly
  }, 120_000)
})
