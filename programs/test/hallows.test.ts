import { describe, expect, it } from 'vitest'
import type { BuildResult, CompiledCue } from '@theodoor/core'
import {
  annotationsOfKind,
  getEffectFrom,
  quietReport,
  runHeadless,
  starterCatalog,
} from '@theodoor/core'
import { hallows, hallowsQuiet } from '../src/hallows.js'

const getEffect = getEffectFrom(starterCatalog())

const errorsOf = (r: BuildResult) => r.compiled.diagnostics.filter((d) => d.severity === 'error')
const cueById = (r: BuildResult, id: string): CompiledCue => {
  const cue = r.compiled.cues.find((c) => c.id === id)
  expect(cue, `cue '${id}' should exist`).toBeDefined()
  return cue!
}

/** The toll rotation authored in hallows.ts (see its module note). */
const TOLL_POSITIONS = [
  'beam-delay-west',
  'beam-north-west',
  'beam-north-east',
  'beam-delay-east',
  'beam-delay-west',
  'beam-south-west',
  'beam-north-west',
  'beam-delay-east',
  'beam-delay-west',
  'beam-south-east',
  'beam-north-east',
  'beam-delay-east',
] as const
/** Strokes 5 and 9 are the near-field corner strokes from the south arrays. */
const CORNER_TOLLS = new Map<number, number>([
  [5, 7 * 38 + 4],
  [9, 7 * 38 + 34],
])

// Built once for the read-only assertions below (each factory call is pure;
// determinism of repeated calls is asserted separately).
const std = hallows()
const quiet = hallowsQuiet()

describe('hallows (standard)', () => {
  it('builds without throwing, with zero error diagnostics (warnings allowed)', () => {
    expect(errorsOf(std)).toEqual([])
    expect(std.show.meta.variant).toBe('standard')
    expect(std.show.meta.seed).toBe(31031)
    expect(std.show.music.id).toBe('hallows-suite')
    // The stomp pairs and the dense summit barrage re-fire racks quickly.
    expect(std.compiled.diagnostics.some((d) => d.code === 'RAPID_REFIRE')).toBe(true)
  })

  it('has cue counts in the expected ranges', () => {
    const byMedium = new Map<string, number>()
    for (const c of std.compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    expect(std.compiled.cues.length).toBeGreaterThanOrEqual(170)
    expect(std.compiled.cues.length).toBeLessThanOrEqual(205)
    expect(byMedium.get('beam')).toBeGreaterThanOrEqual(12)
    expect(byMedium.get('beam')).toBe(35) // 12 tolls + whispers/flyovers/tag/beds/laughs/final
    expect(byMedium.get('crowd')).toBeGreaterThanOrEqual(10)
    expect(byMedium.get('crowd')).toBe(42)
    expect(byMedium.get('drone')).toBe(3) // bats, ghost, bloom
    expect(byMedium.get('laser')).toBe(4)
    expect(byMedium.get('panel')).toBe(12) // eyes ×2, embers ×2, lightning ×8
    expect(byMedium.get('pyro')).toBeGreaterThanOrEqual(85)
  })

  it('lands all twelve tolls exactly on the toll annotations, on the planned arrays', () => {
    const tolls = annotationsOfKind(std.show.music, 'hit', 'toll')
    expect(tolls).toHaveLength(12)
    tolls.forEach((hit, i) => {
      const cue = cueById(std, `toll-${i}-000`)
      expect(Math.abs(cue.targetSec - hit.time)).toBeLessThanOrEqual(1e-9)
      expect(cue.positionId).toBe(TOLL_POSITIONS[i])
      const corner = CORNER_TOLLS.get(i)
      if (corner === undefined) {
        // Everywhere-at-once strokes: fired early by the FARTHEST-cell
        // time-of-flight (well over half a second on the lakeside lawn).
        expect(cue.params?.cells).toBe('all')
        expect(cue.anticipationSec).toBeGreaterThan(0.5)
      } else {
        // Strokes 5 and 9 step inside the crowd: near-field corner cells,
        // anticipated by their own (much shorter) time-of-flight.
        expect(cue.params?.targetCellId).toBe(corner)
        expect(cue.anticipationSec).toBeGreaterThan(0.05)
        expect(cue.anticipationSec).toBeLessThan(0.5)
      }
    })
  })

  it('follows every toll with a bone glow half a beat (0.5 s at 60 bpm) later', () => {
    const tolls = annotationsOfKind(std.show.music, 'hit', 'toll')
    tolls.forEach((hit, i) => {
      const glow = cueById(std, `toll-glow-${i}`)
      expect(glow.medium).toBe('crowd')
      expect(glow.targetSec).toBeCloseTo(hit.time + 0.5, 9)
    })
  })

  it('moans three retargeted stereo beds from the delay towers', () => {
    for (let i = 0; i < 3; i++) {
      const l = cueById(std, `moan-${i}-000`)
      const r = cueById(std, `moan-${i}-001`)
      expect(l.params?.role).toBe('L')
      expect(r.params?.role).toBe('R')
      expect(l.params?.pairId).toBe(`moan-${i}`)
      expect(l.positionId).toBe('beam-delay-west')
      expect(r.positionId).toBe('beam-delay-east')
      expect(l.params?.targetCellId).toBe(r.params?.targetCellId)
    }
    // The dwell rule: each bed converges on a DIFFERENT mid-lawn cell.
    const targets = [0, 1, 2].map((i) => cueById(std, `moan-${i}-000`).params?.targetCellId)
    expect(new Set(targets).size).toBe(3)
  })

  it('lands the heartbeat plague on every Mountain King statement accent', () => {
    const labels = ['creep', 'stalk', 'pursuit', 'quarry', 'frenzy']
    labels.forEach((label, i) => {
      const accent = std.show.music.annotations.find(
        (a) => a.kind === 'accent' && a.label === label,
      )
      expect(accent, `accent '${label}'`).toBeDefined()
      const beat = cueById(std, `plague-${i}-000`)
      expect(beat.effectId).toBe('crowd-heartbeat-red')
      expect(Math.abs(beat.targetSec - accent!.time)).toBeLessThanOrEqual(1e-9)
      expect(beat.params?.originCell).toBe(8 * 38 + 19) // the front-center cell
    })
  })

  it('peaks the summit: barrage tops out ON the strength-1.0 climax with BOO and the bloom', () => {
    const climaxes = annotationsOfKind(std.show.music, 'climax')
    expect(climaxes).toHaveLength(3)
    const summit = climaxes[1]!
    expect(summit.label).toBe('summit')
    expect(summit.strength).toBe(1)

    const barrage = std.compiled.cues.filter((c) => c.id.startsWith('summit-barrage-'))
    expect(barrage.length).toBeGreaterThanOrEqual(40)
    const peak = barrage.reduce((a, b) => (b.targetSec > a.targetSec ? b : a))
    expect(Math.abs(peak.targetSec - summit.time)).toBeLessThanOrEqual(1e-9)
    expect(peak.effectId).toBe('willow-150-strobe') // largest caliber of the pool

    const boo = cueById(std, 'boo-000')
    expect(boo.params?.text).toBe('BOO')
    expect(Math.abs(boo.targetSec - summit.time)).toBeLessThanOrEqual(1e-9)
    const bloom = cueById(std, 'ghost-bloom')
    expect(Math.abs(bloom.targetSec - summit.time)).toBeLessThanOrEqual(1e-9)
  })

  it('rings the last bell everywhere-at-once and blinks out where the plague began', () => {
    const lastBell = annotationsOfKind(std.show.music, 'hit', 'lastBell')[0]!
    const toll = cueById(std, 'final-toll-000')
    expect(toll.params?.cells).toBe('all')
    expect(Math.abs(toll.targetSec - lastBell.time)).toBeLessThanOrEqual(1e-9)
    expect(toll.anticipationSec).toBeGreaterThan(0.5)
    const blink = cueById(std, 'last-blink-000')
    expect(Math.abs(blink.targetSec - lastBell.time)).toBeLessThanOrEqual(1e-9)
    expect(blink.params?.originCell).toBe(8 * 38 + 19)
  })

  it('exceeds the 85 dB budget somewhere (negative control for the quiet variant)', () => {
    const report = quietReport(std.compiled, getEffect, 85)
    expect(report.pass).toBe(false)
    expect(report.peakDb).toBeGreaterThan(85)
    expect(report.violations.length).toBeGreaterThan(0)
  })
})

describe('hallowsQuiet', () => {
  it('builds without throwing, with zero error diagnostics — the 85 dB budget is satisfiable', () => {
    expect(errorsOf(quiet)).toEqual([])
    expect(quiet.show.meta.variant).toBe('quiet')
    expect(quiet.show.noiseBudget).toEqual({ maxSplDb: 85 })
    expect(
      quiet.compiled.diagnostics.filter((d) => d.code === 'SPL_BUDGET' && d.severity === 'error'),
    ).toEqual([])
  })

  it('keeps the beam/crowd/drone/laser/panel design unchanged (they ARE the show)', () => {
    const byMedium = new Map<string, number>()
    for (const c of quiet.compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    expect(byMedium.get('beam')).toBe(35)
    expect(byMedium.get('crowd')).toBe(42)
    expect(byMedium.get('drone')).toBe(3)
    expect(byMedium.get('laser')).toBe(4)
    expect(byMedium.get('panel')).toBe(12)
    // Same twelve tolls, exactly on their annotations.
    const tolls = annotationsOfKind(quiet.show.music, 'hit', 'toll')
    tolls.forEach((hit, i) => {
      expect(Math.abs(cueById(quiet, `toll-${i}-000`).targetSec - hit.time)).toBeLessThanOrEqual(
        1e-9,
      )
    })
  })

  it('drops the loud stomp pairs but keeps lightning, rings and thumps', () => {
    for (let i = 0; i < 8; i++) {
      expect(quiet.compiled.cues.some((c) => c.id === `stomp-${i}-mine`)).toBe(false)
      expect(quiet.compiled.cues.some((c) => c.id === `stomp-${i}-burst`)).toBe(false)
      cueById(quiet, `stomp-${i}-flash`)
    }
    cueById(quiet, 'stomp-ring-0-000')
    cueById(quiet, 'stomp-thump-1')
  })

  it('never authors an effect above 100 dB at the reference distance', () => {
    for (const cue of quiet.compiled.cues) {
      const effect = getEffect(cue.effectId)
      expect(effect, `effect '${cue.effectId}'`).toBeDefined()
      expect(effect!.noiseDbAt15m).toBeLessThanOrEqual(100)
    }
  })

  it('stays at or below 85 dB SPL at every listener in a headless sim run', () => {
    const { stats } = runHeadless(quiet.compiled)
    expect(stats.splPeakByListener).toHaveLength(3)
    for (const peak of stats.splPeakByListener) {
      expect(peak).toBeLessThanOrEqual(85)
    }
    // The crowd canvas and the beam arrays actually ran.
    expect(stats.peakCrowdCellsLit).toBeGreaterThan(0)
    expect(stats.peakActiveBeams).toBeGreaterThanOrEqual(2)
    // Cross-check with the analytic sweep the solver enforces.
    const report = quietReport(quiet.compiled, getEffect, 85)
    expect(report.pass).toBe(true)
  }, 120_000)
})

describe('determinism', () => {
  it('two standard builds are JSON-identical', () => {
    expect(JSON.stringify(hallows())).toBe(JSON.stringify(hallows()))
  })

  it('two quiet builds are JSON-identical', () => {
    expect(JSON.stringify(hallowsQuiet())).toBe(JSON.stringify(hallowsQuiet()))
  })
})
