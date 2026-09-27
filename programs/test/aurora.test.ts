import { describe, expect, it } from 'vitest'
import type { BuildResult, CompiledCue } from '@theodoor/core'
import {
  annotationsOfKind,
  getEffectFrom,
  quietReport,
  runHeadless,
  starterCatalog,
} from '@theodoor/core'
import { aurora, auroraQuiet } from '../src/aurora.js'

const getEffect = getEffectFrom(starterCatalog())

const errorsOf = (r: BuildResult) => r.compiled.diagnostics.filter((d) => d.severity === 'error')
const cueById = (r: BuildResult, id: string): CompiledCue => {
  const cue = r.compiled.cues.find((c) => c.id === id)
  expect(cue, `cue '${id}' should exist`).toBeDefined()
  return cue!
}

// Built once for the read-only assertions below (each factory call is pure;
// determinism of repeated calls is asserted separately).
const std = aurora()
const quiet = auroraQuiet()

describe('aurora (standard)', () => {
  it('builds without throwing, with zero error diagnostics (warnings allowed)', () => {
    expect(errorsOf(std)).toEqual([])
    expect(std.show.meta.variant).toBe('standard')
    expect(std.show.meta.seed).toBe(62166)
    expect(std.show.music.id).toBe('aurora-suite')
  })

  it('carries program notes: acts in order, chronological, shared by both variants', () => {
    const titles = (r: BuildResult) => r.compiled.acts!.map((a) => a.title)
    expect(titles(std)).toEqual(['I — First Light', 'II — Moonrise', 'III — Sleep'])
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
    expect(acts[1]!.fromSec).toBe(std.show.music.annotations.find((a) => a.label === 'moonrise')!.time)
  })

  it('has the expected cue counts by medium', () => {
    const byMedium = new Map<string, number>()
    for (const c of std.compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    // heartbeat 1 + waves 8 + breath floods 6 + chase 3 + sparkles 2 +
    // indigo floods 7 + contracting pulses 7 + last blink 1
    expect(byMedium.get('crowd')).toBe(35)
    // lullaby 1 + duet 4 + stereo pair 2 + tag 1 + goodnight rows 9
    expect(byMedium.get('beam')).toBe(17)
    expect(byMedium.get('pyro')).toBe(8) // shimmer comets
    expect(byMedium.get('drone')).toBe(3) // crescent, heart, fireflies
    expect(byMedium.get('laser')).toBe(4)
    expect(byMedium.get('panel')).toBe(4)
    expect(byMedium.get('fabrication')).toBe(3) // lancework moon + 2 waterfalls
    expect(std.compiled.cues).toHaveLength(74)
  })

  it('ACT 1 is crowd + beams ONLY: no sky medium lands before moonrise', () => {
    const moonrise = annotationsOfKind(std.show.music, 'accent', 'moonrise')[0]!
    const actOne = std.compiled.cues.filter((c) => c.targetSec < moonrise.time - 1e-9)
    expect(actOne.length).toBeGreaterThanOrEqual(20)
    for (const c of actOne) {
      expect(['crowd', 'beam'], `act-1 cue '${c.id}' (${c.medium})`).toContain(c.medium)
    }
    // Both act-1 media are actually present (the invariant is not vacuous).
    expect(actOne.some((c) => c.medium === 'crowd')).toBe(true)
    expect(actOne.some((c) => c.medium === 'beam')).toBe(true)
    // And the aurora is born ON the first sounding moment, in the birth cell.
    const birth = cueById(std, 'birth-heartbeat-000')
    expect(birth.targetSec).toBeCloseTo(0, 9)
    expect(birth.params?.originCell).toBe(4 * 38 + 19)
  })

  it('the sky joins exactly at moonrise: crescent + lancework land ON the accent', () => {
    const moonrise = annotationsOfKind(std.show.music, 'accent', 'moonrise')[0]!
    const crescent = cueById(std, 'moon-crescent')
    expect(crescent.effectId).toBe('crescent-formation-60')
    expect(crescent.positionId).toBe('pad-2')
    expect(Math.abs(crescent.targetSec - moonrise.time)).toBeLessThanOrEqual(1e-9)
    const lancework = cueById(std, 'moon-lancework')
    expect(Math.abs(lancework.targetSec - moonrise.time)).toBeLessThanOrEqual(1e-9)
    // The moon's hum is tagged to the crescent cue itself.
    expect(cueById(std, 'moon-tag-000').params?.sourceCueId).toBe('moon-crescent')
  })

  it('lands the waterfalls and maximum sparkle ON the zenith (the single 1.0 climax)', () => {
    const climaxes = annotationsOfKind(std.show.music, 'climax')
    expect(climaxes).toHaveLength(3)
    const zenith = climaxes[1]!
    expect(zenith.label).toBe('zenith')
    expect(zenith.strength).toBe(1)
    expect(climaxes.filter((c) => c.strength === 1)).toHaveLength(1)

    for (const id of ['zenith-waterfall-0', 'zenith-waterfall-1']) {
      const c = cueById(std, id)
      expect(c.effectId).toBe('waterfall-30m')
      expect(Math.abs(c.targetSec - zenith.time)).toBeLessThanOrEqual(1e-9)
    }
    for (const id of ['zenith-sparkle-west', 'zenith-sparkle-east']) {
      expect(Math.abs(cueById(std, id).targetSec - zenith.time)).toBeLessThanOrEqual(1e-9)
    }
    // The sentimental beat: the crescent melts into a heart after the zenith.
    const heart = cueById(std, 'moon-heart')
    expect(heart.effectId).toBe('heart-formation-80')
    expect(heart.targetSec).toBeGreaterThan(zenith.time)
    expect(heart.params?.holdSec).toBe(20)
  })

  it('ends in silence: the last blink lands ON lastLight and nothing lands after it', () => {
    const lastLight = annotationsOfKind(std.show.music, 'hit', 'lastLight')[0]!
    const blink = cueById(std, 'last-blink-000')
    expect(Math.abs(blink.targetSec - lastLight.time)).toBeLessThanOrEqual(1e-9)
    for (const c of std.compiled.cues) {
      expect(c.targetSec, `cue '${c.id}' must not land after lastLight`).toBeLessThanOrEqual(
        lastLight.time + 1e-9,
      )
    }
    // The final landing IS lastLight (not merely before it).
    const lastLanding = std.compiled.cues.reduce((a, b) => (b.targetSec > a.targetSec ? b : a))
    expect(Math.abs(lastLanding.targetSec - lastLight.time)).toBeLessThanOrEqual(1e-9)
  })

  it('is quiet-native: no entry above 100 dB, and the 85 dB sweep already passes', () => {
    let loudest = 0
    for (const cue of std.compiled.cues) {
      const effect = getEffect(cue.effectId)
      expect(effect, `effect '${cue.effectId}'`).toBeDefined()
      expect(effect!.noiseDbAt15m).toBeLessThanOrEqual(100)
      loudest = Math.max(loudest, effect!.noiseDbAt15m)
    }
    expect(loudest).toBe(98) // the zenith waterfall is the loudest the night gets
    const report = quietReport(std.compiled, getEffect, 85)
    expect(report.pass).toBe(true)
  })
})

describe('auroraQuiet — enforcement-only proof of quiet-native design', () => {
  it('builds without throwing, with zero error diagnostics and the 85 dB budget set', () => {
    expect(errorsOf(quiet)).toEqual([])
    expect(quiet.show.meta.variant).toBe('quiet')
    expect(quiet.show.noiseBudget).toEqual({ maxSplDb: 85 })
  })

  it('carries the IDENTICAL cue list as the standard build (zero substitutions)', () => {
    // Authored tracks are deep-equal…
    expect(quiet.show.tracks).toEqual(std.show.tracks)
    // …and so are the solved cues (no SPL substitution or drop ever ran).
    expect(JSON.stringify(quiet.compiled.cues)).toBe(JSON.stringify(std.compiled.cues))
    expect(quiet.compiled.diagnostics.filter((d) => d.code === 'SPL_BUDGET')).toEqual([])
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
    expect(JSON.stringify(aurora())).toBe(JSON.stringify(aurora()))
  })

  it('two quiet builds are JSON-identical', () => {
    expect(JSON.stringify(auroraQuiet())).toBe(JSON.stringify(auroraQuiet()))
  })
})
