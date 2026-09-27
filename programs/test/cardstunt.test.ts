import { describe, expect, it } from 'vitest'
import type { BuildResult, CompiledCue } from '@theodoor/core'
import {
  annotationsOfKind,
  getEffectFrom,
  quietReport,
  runHeadless,
  starterCatalog,
} from '@theodoor/core'
import { cardstunt, cardstuntQuiet } from '../src/cardstunt.js'

const getEffect = getEffectFrom(starterCatalog())

const errorsOf = (r: BuildResult) => r.compiled.diagnostics.filter((d) => d.severity === 'error')

// Built once for the read-only assertions below (each factory call is pure;
// determinism of repeated calls is asserted separately).
const std = cardstunt()
const quiet = cardstuntQuiet()

/** The four drone countdown digit cues, in landing order (3, 2, 1, 0). */
const droneDigitsOf = (r: BuildResult): CompiledCue[] =>
  r.compiled.cues.filter((c) => c.id.startsWith('cs-cd-')).sort((a, b) => (a.id < b.id ? -1 : 1))

describe('cardstunt timeline', () => {
  it('stamps the pass accents and 12 cardCall hits over three Ode to Joy passes', () => {
    const tl = std.show.music
    expect(tl.id).toBe('cardstunt-suite')
    // Pass starts: bars 1 / 34 / 67 at 120 bpm 4/4 (one bar = 2 s; a silent
    // join bar separates the passes — see the program's module doc).
    for (const [label, t] of [
      ['calibrate', 0],
      ['stunt', 66],
      ['synthesis', 132],
    ] as const) {
      const a = annotationsOfKind(tl, 'accent', label)
      expect(a).toHaveLength(1)
      expect(a[0]!.time).toBeCloseTo(t, 9)
    }
    // Four B-phrase downbeat hits per pass (local bars 9/11/25/27).
    const calls = annotationsOfKind(tl, 'hit', 'cardCall')
    expect(calls.map((a) => a.time)).toEqual([
      16, 20, 48, 52, 82, 86, 114, 118, 148, 152, 180, 184,
    ])
    // Only the pass-3 finalRefrain keeps climax strength 1.
    const climaxes = annotationsOfKind(tl, 'climax')
    expect(climaxes).toHaveLength(3)
    expect(climaxes.map((c) => c.strength)).toEqual([0.9, 0.9, 1])
    expect(climaxes[2]!.time).toBeCloseTo(188, 9)
  })
})

describe('cardstunt (standard)', () => {
  it('builds without throwing, with zero error diagnostics (warnings allowed)', () => {
    expect(errorsOf(std)).toEqual([])
    expect(std.show.meta.variant).toBe('standard')
    expect(std.show.meta.seed).toBe(24601)
    expect(std.show.preRollSec).toBe(6)
    expect(std.show.noiseBudget).toBeUndefined()
  })

  it('carries program notes: acts in order, chronological, shared by both variants', () => {
    const titles = (r: BuildResult) => r.compiled.acts!.map((a) => a.title)
    expect(titles(std)).toEqual(['I — Calibration', 'II — The Stunt', 'III — Synthesis'])
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
    expect(acts[1]!.fromSec).toBe(std.show.music.annotations.find((a) => a.label === 'stunt')!.time)
  })

  it('plays all seven media, with the expected cue count per medium', () => {
    const byMedium = new Map<string, number>()
    for (const c of std.compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    expect([...byMedium.keys()].sort()).toEqual([
      'beam', 'crowd', 'drone', 'fabrication', 'laser', 'panel', 'pyro',
    ])
    expect(byMedium.get('pyro')).toBe(7) // 4 comet fans + 3 finale volley
    expect(byMedium.get('drone')).toBe(5) // 4 countdown digits + pad-2 ring
    expect(byMedium.get('laser')).toBe(2)
    expect(byMedium.get('panel')).toBe(2)
    expect(byMedium.get('fabrication')).toBe(1)
    expect(byMedium.get('crowd')).toBe(23) // 12 calibration + 9 stunt + 2 finale
    expect(byMedium.get('beam')).toBe(6) // 4 count-ins + ping-pong + flyover
    expect(std.compiled.cues).toHaveLength(46)
  })

  it('THE SHOWPIECE: crowd digits land on exactly the drone digit anchors', () => {
    for (const r of [std, quiet]) {
      const drones = droneDigitsOf(r)
      expect(drones.map((c) => c.params?.['text'])).toEqual(['3', '2', '1', '0'])
      expect(drones.every((c) => c.effectId === 'digit-formation-100')).toBe(true)
      expect(drones.every((c) => c.positionId === 'pad-1')).toBe(true)
      // Landings 12 s apart (8 s digit hold + morph flight), digit 0 exactly
      // ON the synthesis downbeat (t = 132).
      expect(drones.map((c) => c.targetSec)).toEqual([96, 108, 120, 132])
      const synthesis = annotationsOfKind(r.show.music, 'accent', 'synthesis')[0]!
      expect(drones[3]!.targetSec).toBe(synthesis.time)
      // Crowd digits 3/2/1 share the SAME landings array — targetSec is
      // exactly equal, not merely close.
      const digits = ['3', '2', '1'] as const
      digits.forEach((d, i) => {
        const crowd = r.compiled.cues.find((c) => c.id === `cs-digit-${d}-000`)!
        expect(crowd.medium).toBe('crowd')
        expect(crowd.params?.['text']).toBe(d)
        expect(crowd.targetSec).toBe(drones[i]!.targetSec)
      })
    }
  })

  it('pass-1 calibration figures land where the caller announces them', () => {
    // Corner pulses radiate from the four lawn corners of the 38×9 grid.
    const corners = std.compiled.cues.filter((c) => c.id.startsWith('cs-corner-'))
    expect(corners.map((c) => c.params?.['originCell'])).toEqual([0, 37, 304, 341])
    expect(corners.map((c) => c.targetSec)).toEqual([4, 8, 12, 16])
    // Whisper count-ins: all four from the west delay tower, inside pass 1.
    const countIns = std.compiled.cues.filter((c) => c.id.startsWith('cs-count-'))
    expect(countIns).toHaveLength(4)
    for (const c of countIns) {
      expect(c.effectId).toBe('beam-whisper-count')
      expect(c.positionId).toBe('beam-delay-west')
      expect(c.targetSec).toBeLessThan(64)
    }
    // Column sweep: four sections, 7 s apart, on the second cardCall.
    const sweep = std.compiled.cues.filter((c) => c.id.startsWith('cs-sweep-'))
    expect(sweep.map((c) => c.targetSec)).toEqual([20, 27, 34, 41])
  })

  it('never exceeds the 30 Hz mast bandwidth cap (pass 1 and everywhere else)', () => {
    // Recompute the crowd-mast load the solver enforces: at any cue's start,
    // the summed maskUpdateHz of concurrently active cues on that mast.
    const crowd = std.compiled.cues.filter((c) => c.medium === 'crowd')
    const hzOf = (c: CompiledCue): number => {
      const e = getEffect(c.effectId)!
      return e.medium === 'crowd' ? e.maskUpdateHz : 0
    }
    let worst = 0
    for (const c of crowd) {
      const sum = crowd
        .filter((a) => a.positionId === c.positionId)
        .filter((a) => a.fireSec <= c.fireSec && c.fireSec < a.targetSec + a.durationSec - 1e-6)
        .reduce((acc, a) => acc + hzOf(a), 0)
      worst = Math.max(worst, sum)
      expect(sum).toBeLessThanOrEqual(30)
    }
    // The layout's densest moment is a 12+12 chase pair riding one mast.
    expect(worst).toBe(24)
  })

  it('lands the finale ON the pass-3 climax: RWB volley + BRAVO + white pulse', () => {
    const climax = annotationsOfKind(std.show.music, 'climax')[2]!
    const finale = std.compiled.cues.filter((c) => c.id.startsWith('cs-finale-'))
    expect(finale.map((c) => c.effectId).sort()).toEqual([
      'peony-100-white', 'peony-75-blue', 'peony-75-red',
    ])
    for (const c of finale) expect(Math.abs(c.targetSec - climax.time)).toBeLessThanOrEqual(1e-9)
    const bravo = std.compiled.cues.find((c) => c.id === 'cs-bravo-000')!
    expect(bravo.params?.['text']).toBe('BRAVO')
    expect(Math.abs(bravo.targetSec - climax.time)).toBeLessThanOrEqual(1e-9)
    const flash = std.compiled.cues.find((c) => c.id === 'cs-flash-000')!
    expect(flash.effectId).toBe('crowd-pulse-radial')
    expect(Math.abs(flash.targetSec - climax.time)).toBeLessThanOrEqual(1e-9)
    // The set piece is a fabrication cue on the ninth cardCall.
    const gerb = std.compiled.cues.find((c) => c.id === 'cs-gerb-arc')!
    expect(gerb.medium).toBe('fabrication')
    expect(gerb.effectId).toBe('gerb-fan-arc-12m')
    expect(gerb.targetSec).toBe(152)
  })

  it('exceeds the 85 dB budget somewhere (negative control for the quiet variant)', () => {
    const report = quietReport(std.compiled, getEffect, 85)
    expect(report.pass).toBe(false)
    expect(report.peakDb).toBeGreaterThan(85)
  })
})

describe('cardstuntQuiet', () => {
  it('builds clean with variant quiet and an 85 dB budget, without SPL repairs', () => {
    expect(errorsOf(quiet)).toEqual([])
    expect(quiet.show.meta.variant).toBe('quiet')
    expect(quiet.show.noiseBudget).toEqual({ maxSplDb: 85 })
    // The program is authored under budget: the solver never substitutes.
    expect(quiet.compiled.diagnostics.filter((d) => d.code === 'SPL_BUDGET')).toEqual([])
  })

  it('differs from standard ONLY in the finale volley (comet fans)', () => {
    const finale = quiet.compiled.cues.filter((c) => c.id.startsWith('cs-finale-'))
    expect(finale.map((c) => c.effectId).sort()).toEqual([
      'comet-30-gold', 'comet-30-silver', 'comet-50-red',
    ])
    const strip = (r: BuildResult) =>
      r.compiled.cues.filter((c) => !c.id.startsWith('cs-finale-')).map((c) => ({ ...c, seed: 0 }))
    expect(strip(quiet)).toEqual(strip(std))
  })

  it('never authors an effect above 100 dB at the reference distance', () => {
    for (const track of quiet.show.tracks) {
      for (const cue of track.cues) {
        const effect = getEffect(cue.effectId)
        expect(effect, `effect '${cue.effectId}'`).toBeDefined()
        expect(effect!.noiseDbAt15m).toBeLessThanOrEqual(100)
      }
    }
  })

  it('stays at or below 85 dB SPL at every listener in a headless sim run', { timeout: 120_000 }, () => {
    const { stats } = runHeadless(quiet.compiled)
    for (const peak of stats.splPeakByListener) {
      expect(peak).toBeLessThanOrEqual(85)
    }
  })
})

describe('determinism', () => {
  it('two standard builds are JSON-identical', () => {
    const again = cardstunt()
    expect(JSON.stringify(again.show)).toBe(JSON.stringify(std.show))
    expect(JSON.stringify(again.compiled)).toBe(JSON.stringify(std.compiled))
  })

  it('two quiet builds are JSON-identical', () => {
    const again = cardstuntQuiet()
    expect(JSON.stringify(again.show)).toBe(JSON.stringify(quiet.show))
    expect(JSON.stringify(again.compiled)).toBe(JSON.stringify(quiet.compiled))
  })
})
