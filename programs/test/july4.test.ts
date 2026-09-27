import { describe, expect, it } from 'vitest'
import type { BuildResult, CompiledCue } from '@theodoor/core'
import {
  annotationsOfKind,
  getEffectFrom,
  quietReport,
  runHeadless,
  starterCatalog,
} from '@theodoor/core'
import { july4, july4Quiet } from '../src/july4.js'
import { RGB } from '../src/palettes.js'

const getEffect = getEffectFrom(starterCatalog())

const errorsOf = (r: BuildResult) => r.compiled.diagnostics.filter((d) => d.severity === 'error')
const cueById = (r: BuildResult, id: string): CompiledCue => {
  const cue = r.compiled.cues.find((c) => c.id === id)
  expect(cue, `cue '${id}' should exist`).toBeDefined()
  return cue!
}

// Built once for the read-only assertions below (each factory call is pure;
// determinism of repeated calls is asserted separately).
const std = july4()
const quiet = july4Quiet()

describe('july4 (standard)', () => {
  it('builds without throwing, with zero error diagnostics (warnings allowed)', () => {
    expect(errorsOf(std)).toEqual([])
    expect(std.show.meta.variant).toBe('standard')
    expect(std.show.meta.seed).toBe(40714)
    expect(std.show.music.id).toBe('july4-suite')
    // The dense coda barrage necessarily re-fires racks quickly — expected.
    expect(std.compiled.diagnostics.some((d) => d.code === 'RAPID_REFIRE')).toBe(true)
  })

  it('carries program notes: acts in order, chronological, shared by both variants', () => {
    const titles = (r: BuildResult) => r.compiled.acts!.map((a) => a.title)
    expect(titles(std)).toEqual(['I — Colors', 'II — The Trio', 'III — Grandioso', 'IV — 1812', 'V — Final Chord'])
    expect(titles(quiet)).toEqual(titles(std))
    const acts = std.compiled.acts!
    for (let i = 1; i < acts.length; i++) {
      expect(acts[i]!.fromSec).toBeGreaterThan(acts[i - 1]!.fromSec)
      expect(acts[i - 1]!.toSec).toBe(acts[i]!.fromSec)
    }
    expect(std.show.notes?.music.length).toBeGreaterThan(0)
    expect(std.show.notes?.tagline).not.toBe(quiet.show.notes?.tagline)
    expect(acts.every((a) => a.note.length > 40)).toBe(true)
    expect(std.compiled.diagnostics.some((d) => d.code === 'ACT_UNRESOLVED')).toBe(false)
    const trio = annotationsOfKind(std.show.music, 'accent', 'trio')[0]!
    expect(acts[1]!.fromSec).toBe(trio.time)
  })

  it('has cue counts in the expected ranges', () => {
    const byMedium = new Map<string, number>()
    for (const c of std.compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    expect(std.compiled.cues.length).toBeGreaterThanOrEqual(145)
    expect(std.compiled.cues.length).toBeLessThanOrEqual(170)
    expect(byMedium.get('drone')).toBe(3) // flag, star, USA
    expect(byMedium.get('pyro')).toBeGreaterThanOrEqual(120)
    expect(byMedium.get('laser')).toBe(4)
    expect(byMedium.get('panel')).toBe(8)
    expect(byMedium.get('crowd')).toBe(3) // the RWB trio waves
    expect(byMedium.get('beam')).toBeUndefined() // beds are quiet-only
  })

  it('washes three RWB crowd waves through the trio on one mast', () => {
    const trio = annotationsOfKind(std.show.music, 'accent', 'trio')[0]!
    const waves = std.compiled.cues.filter((c) => c.medium === 'crowd')
    expect(waves.map((c) => c.id)).toEqual(['trio-wave-0-000', 'trio-wave-1-000', 'trio-wave-2-000'])
    waves.forEach((w, i) => {
      expect(w.effectId).toBe('crowd-wave-lateral')
      expect(w.positionId).toBe('mast-west')
      expect(w.params?.periodBeats).toBe(4)
      // Successive wavefronts 24 beats apart (12 s at 120 bpm), the first ON
      // the trio accent — spaced past the 10 s pattern window, so the single
      // mast never carries more than one 10 Hz wave at a time.
      expect(w.targetSec).toBeCloseTo(trio.time + 12 * i, 9)
    })
    expect(waves.map((w) => w.params?.rgb)).toEqual([RGB.red, RGB.white, RGB.blue])
  })

  it('lands a salute + chrysanthemum pair within 1e-9 of every cannon hit', () => {
    const cannons = annotationsOfKind(std.show.music, 'hit', 'cannon')
    expect(cannons).toHaveLength(16)
    cannons.forEach((hit, i) => {
      const salute = cueById(std, `cannon-${i}-salute`)
      const chrys = cueById(std, `cannon-${i}-chrys`)
      expect(Math.abs(salute.targetSec - hit.time)).toBeLessThanOrEqual(1e-9)
      expect(Math.abs(chrys.targetSec - hit.time)).toBeLessThanOrEqual(1e-9)
      expect(salute.effectId).toBe('salute-100')
      expect(chrys.effectId).toBe('chrysanthemum-150-silver')
      // Alternating far positions across the firing line.
      expect(salute.positionId).toBe(i % 2 === 0 ? 'rack-1' : 'rack-8')
      expect(chrys.positionId).toBe(i % 2 === 0 ? 'rack-8' : 'rack-1')
    })
  })

  it('lands the finale ON the finalChord climax', () => {
    const climaxes = annotationsOfKind(std.show.music, 'climax')
    expect(climaxes).toHaveLength(2)
    const finalChord = climaxes[1]!
    expect(finalChord.label).toBe('finalChord')

    for (const id of ['finale-0', 'finale-1', 'finale-2']) {
      const cue = cueById(std, id)
      expect(cue.effectId).toBe('brocade-200-gold')
      expect(Math.abs(cue.targetSec - finalChord.time)).toBeLessThanOrEqual(1e-9)
    }
    // The barrage's own final cue also peaks exactly on the climax, with the
    // largest-caliber effect of its pool.
    const barrage = std.compiled.cues.filter((c) => c.id.startsWith('coda-barrage-'))
    expect(barrage.length).toBeGreaterThanOrEqual(40)
    const peak = barrage.reduce((a, b) => (b.targetSec > a.targetSec ? b : a))
    expect(Math.abs(peak.targetSec - finalChord.time)).toBeLessThanOrEqual(1e-9)
    expect(peak.effectId).toBe('brocade-200-gold')
    // USA drones spell out on the same chord.
    const usa = cueById(std, 'usa-finale')
    expect(usa.params?.text).toBe('USA')
    expect(usa.params?.count).toBe(60)
    expect(usa.params?.scaleM).toBe(3)
    expect(Math.abs(usa.targetSec - finalChord.time)).toBeLessThanOrEqual(1e-9)
  })

  it('forms the opening flag exactly on the phrase-2 boundary', () => {
    const phraseEnds = annotationsOfKind(std.show.music, 'phrase', 'phraseEnd')
    const flag = cueById(std, 'flag-open')
    expect(flag.effectId).toBe('flag-formation-50')
    expect(flag.params?.count).toBe(50)
    expect(flag.targetSec).toBe(phraseEnds[1]!.time)
    // The march is 120 bpm 4/4: phrase 2 closes on the bar-21 downbeat (40 s).
    expect(flag.targetSec).toBeCloseTo(40, 9)
  })

  it('exceeds the 85 dB budget somewhere (negative control for the quiet variant)', () => {
    const report = quietReport(std.compiled, getEffect, 85)
    expect(report.pass).toBe(false)
    expect(report.peakDb).toBeGreaterThan(85)
    expect(report.violations.length).toBeGreaterThan(0)
  })

  it('locks the first 12 compiled cues (regression snapshot)', () => {
    const first12 = std.compiled.cues.slice(0, 12).map((c) => ({
      id: c.id,
      medium: c.medium,
      effectId: c.effectId,
      targetSec: c.targetSec,
      fireSec: c.fireSec,
    }))
    expect(first12).toEqual([
      { id: 'strain-comet-0', medium: 'pyro', effectId: 'comet-30-gold', targetSec: 8, fireSec: 6.8 },
      { id: 'rwb-0-001', medium: 'pyro', effectId: 'peony-100-white', targetSec: 24, fireSec: 21.2 },
      { id: 'rwb-0-000', medium: 'pyro', effectId: 'peony-75-red', targetSec: 24, fireSec: 21.8 },
      { id: 'rwb-0-002', medium: 'pyro', effectId: 'peony-75-blue', targetSec: 24, fireSec: 21.8 },
      { id: 'flag-open', medium: 'drone', effectId: 'flag-formation-50', targetSec: 40, fireSec: 23.567852859774277 },
      { id: 'rwb-1-000', medium: 'pyro', effectId: 'peony-100-white', targetSec: 40, fireSec: 37.2 },
      { id: 'rwb-1-001', medium: 'pyro', effectId: 'peony-75-blue', targetSec: 40, fireSec: 37.8 },
      { id: 'rwb-1-002', medium: 'pyro', effectId: 'peony-75-red', targetSec: 40, fireSec: 37.8 },
      { id: 'strain-comet-1', medium: 'pyro', effectId: 'comet-30-gold', targetSec: 40, fireSec: 38.8 },
      { id: 'rwb-2-002', medium: 'pyro', effectId: 'peony-100-white', targetSec: 56, fireSec: 53.2 },
      { id: 'rwb-2-000', medium: 'pyro', effectId: 'peony-75-blue', targetSec: 56, fireSec: 53.8 },
      { id: 'rwb-2-001', medium: 'pyro', effectId: 'peony-75-red', targetSec: 56, fireSec: 53.8 },
    ])
  })
})

describe('july4Quiet', () => {
  it('builds without throwing, with zero error diagnostics — the 85 dB budget is satisfiable', () => {
    expect(errorsOf(quiet)).toEqual([])
    expect(quiet.show.meta.variant).toBe('quiet')
    expect(quiet.show.noiseBudget).toEqual({ maxSplDb: 85 })
    expect(
      quiet.compiled.diagnostics.filter((d) => d.code === 'SPL_BUDGET' && d.severity === 'error'),
    ).toEqual([])
  })

  it('has cue counts in the expected ranges (same structure, quiet media mix)', () => {
    const byMedium = new Map<string, number>()
    for (const c of quiet.compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    expect(quiet.compiled.cues.length).toBeGreaterThanOrEqual(145)
    expect(quiet.compiled.cues.length).toBeLessThanOrEqual(175)
    // flag, star, ring pulse, wave pulse, coda bloom, USA
    expect(byMedium.get('drone')).toBe(6)
    expect(byMedium.get('pyro')).toBeGreaterThanOrEqual(80)
    expect(byMedium.get('laser')).toBeGreaterThanOrEqual(30)
    expect(byMedium.get('panel')).toBeGreaterThanOrEqual(20)
    expect(byMedium.get('crowd')).toBe(4) // trio waves + the flag flood
    expect(byMedium.get('beam')).toBe(4) // two crossed stereo-bed sections
  })

  it('quiet spectacle: flag flood in Act 1 and a retargeting stereo bed under the grandioso', () => {
    // Act 1: red-over-blue crowd flood on the first strain, on the east mast.
    const firstStrain = annotationsOfKind(quiet.show.music, 'accent', 'firstStrain')[0]!
    const flood = cueById(quiet, 'flag-flood')
    expect(flood.medium).toBe('crowd')
    expect(flood.effectId).toBe('crowd-flood-rgb')
    expect(flood.positionId).toBe('mast-east')
    expect(flood.params?.rgb).toEqual(RGB.red)
    expect(flood.params?.rgb2).toEqual(RGB.blue)
    expect(Math.abs(flood.targetSec - firstStrain.time)).toBeLessThanOrEqual(1e-9)

    // Grandioso: two 16 s stereo-bed sections on the delay towers.
    const grandioso = annotationsOfKind(quiet.show.music, 'climax')[0]!
    expect(grandioso.label).toBe('grandioso')
    const beams = quiet.compiled.cues.filter((c) => c.medium === 'beam')
    expect([...beams.map((c) => c.id)].sort()).toEqual([
      'bed-grandioso-0-000',
      'bed-grandioso-0-001',
      'bed-grandioso-1-000',
      'bed-grandioso-1-001',
    ])
    for (const c of beams) {
      expect(c.effectId).toBe('beam-stereo-bed')
      expect(c.durationSec).toBe(16)
      // L rides the west tower, R the east; each section is a crossed pair.
      expect(c.positionId).toBe(
        c.params?.role === 'L' ? 'beam-delay-west' : 'beam-delay-east',
      )
    }
    const section0 = beams.filter((c) => c.id.startsWith('bed-grandioso-0-'))
    const section1 = beams.filter((c) => c.id.startsWith('bed-grandioso-1-'))
    expect(section0).toHaveLength(2)
    expect(section1).toHaveLength(2)
    // Section 1 lands ON the grandioso; section 2 lands 36 beats (18 s)
    // later on a DIFFERENT mid-lawn cell, so no cell accrues bed dwell.
    for (const c of section0) {
      expect(Math.abs(c.targetSec - grandioso.time)).toBeLessThanOrEqual(1e-9)
      expect(c.params?.targetCellId).toBe(170)
    }
    for (const c of section1) {
      expect(c.targetSec).toBeCloseTo(grandioso.time + 18, 9)
      expect(c.params?.targetCellId).toBe(95)
    }
  })

  it('never authors an effect above 100 dB at the reference distance', () => {
    for (const cue of quiet.compiled.cues) {
      const effect = getEffect(cue.effectId)
      expect(effect, `effect '${cue.effectId}'`).toBeDefined()
      expect(effect!.noiseDbAt15m).toBeLessThanOrEqual(100)
    }
  })

  it('covers every cannon with a low-noise accent within 1e-9, plus strobe and laser hit', () => {
    const cannons = annotationsOfKind(quiet.show.music, 'hit', 'cannon')
    expect(cannons).toHaveLength(16)
    cannons.forEach((hit, i) => {
      const accent = cueById(quiet, `cannon-${i}-accent`)
      expect(Math.abs(accent.targetSec - hit.time)).toBeLessThanOrEqual(1e-9)
      expect(accent.medium).toBe('pyro')
      expect(accent.effectId).toBe(i % 2 === 0 ? 'crossette-75-silver' : 'mine-50-silver')
      expect(accent.positionId).toBe(i % 2 === 0 ? 'rack-1' : 'rack-8')
      expect(Math.abs(cueById(quiet, `cannon-${i}-strobe`).targetSec - hit.time)).toBeLessThanOrEqual(1e-9)
      expect(Math.abs(cueById(quiet, `cannon-${i}-hit`).targetSec - hit.time)).toBeLessThanOrEqual(1e-9)
    })
  })

  it('lands the comet curtain, bloom and USA around the finalChord climax', () => {
    const finalChord = annotationsOfKind(quiet.show.music, 'climax')[1]!
    expect(finalChord.label).toBe('finalChord')
    const curtain = quiet.compiled.cues.filter((c) => c.id.startsWith('curtain-'))
    expect(curtain).toHaveLength(8) // the whole rack line
    for (const c of curtain) {
      expect(Math.abs(c.targetSec - finalChord.time)).toBeLessThanOrEqual(1e-9)
    }
    const usa = cueById(quiet, 'usa-finale')
    expect(Math.abs(usa.targetSec - finalChord.time)).toBeLessThanOrEqual(1e-9)
    const bloom = cueById(quiet, 'bloom-coda')
    expect(bloom.targetSec).toBeLessThan(finalChord.time) // heralds the coda hymn
    expect(bloom.targetSec + bloom.durationSec).toBeLessThan(usa.fireSec + 1e-9)
  })

  it('stays at or below 85 dB SPL at every listener in a headless sim run', () => {
    const { stats } = runHeadless(quiet.compiled)
    expect(stats.splPeakByListener).toHaveLength(3)
    for (const peak of stats.splPeakByListener) {
      expect(peak).toBeLessThanOrEqual(85)
    }
    // Cross-check with the analytic sweep the solver enforces.
    const report = quietReport(quiet.compiled, getEffect, 85)
    expect(report.pass).toBe(true)
  }, 120_000)
})

describe('determinism', () => {
  it('two standard builds are JSON-identical', () => {
    expect(JSON.stringify(july4())).toBe(JSON.stringify(july4()))
  })

  it('two quiet builds are JSON-identical', () => {
    expect(JSON.stringify(july4Quiet())).toBe(JSON.stringify(july4Quiet()))
  })
})
