import { describe, expect, it } from 'vitest'
import type { BuildResult, CompiledCue } from '@theodoor/core'
import {
  SPEED_OF_SOUND_MPS,
  annotationsOfKind,
  beamAimAt,
  crowdGridFor,
  getEffectFrom,
  quietReport,
  runHeadless,
  starterCatalog,
} from '@theodoor/core'
import { cosmos, cosmosQuiet } from '../src/cosmos.js'

const getEffect = getEffectFrom(starterCatalog())

const errorsOf = (r: BuildResult) => r.compiled.diagnostics.filter((d) => d.severity === 'error')
const cueById = (r: BuildResult, id: string): CompiledCue => {
  const cue = r.compiled.cues.find((c) => c.id === id)
  expect(cue, `cue '${id}' should exist`).toBeDefined()
  return cue!
}
/** Beam cues that tag a source cue — the thunder-with-flash pairs. */
const thunderTags = (r: BuildResult): CompiledCue[] =>
  r.compiled.cues.filter(
    (c) => c.medium === 'beam' && typeof c.params?.['sourceCueId'] === 'string',
  )

// Built once for the read-only assertions below (each factory call is pure;
// determinism of repeated calls is asserted separately).
const std = cosmos()
const quiet = cosmosQuiet()

describe('cosmos (standard)', () => {
  it('builds without throwing, with zero error diagnostics (warnings allowed)', () => {
    expect(errorsOf(std)).toEqual([])
    expect(std.show.meta.variant).toBe('standard')
    expect(std.show.meta.seed).toBe(19680101)
    expect(std.show.music.id).toBe('cosmos-suite')
  })

  it('carries the three suite climaxes with jovian as the lone strength-1 peak', () => {
    const climaxes = annotationsOfKind(std.show.music, 'climax')
    expect(climaxes.map((c) => c.label)).toEqual(['daybreak', 'waltzPeak', 'jovian'])
    expect(climaxes.map((c) => c.strength)).toEqual([0.95, 0.8, 1])
  })

  it('has cue counts in the expected ranges', () => {
    const byMedium = new Map<string, number>()
    for (const c of std.compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    expect(std.compiled.cues.length).toBeGreaterThanOrEqual(150)
    expect(std.compiled.cues.length).toBeLessThanOrEqual(175)
    expect(byMedium.get('drone')).toBe(5) // spiral, orrery, bloom, comet, IO
    expect(byMedium.get('pyro')).toBeGreaterThanOrEqual(70)
    expect(byMedium.get('laser')).toBe(10)
    expect(byMedium.get('panel')).toBe(10)
    expect(byMedium.get('fabrication')).toBe(3) // gantry + two wheels
    expect(byMedium.get('crowd')).toBe(27)
    expect(byMedium.get('beam')).toBe(25)
  })

  it('THE SIGNATURE: every thunder tag lands WITH its burst, fired early by the ToF', () => {
    const tags = thunderTags(std)
    expect(tags).toHaveLength(15)

    const site = std.show.site
    const grid = crowdGridFor(site)!
    for (const tag of tags) {
      const srcId = tag.params!['sourceCueId'] as string
      const src = cueById(std, srcId)
      expect(['pyro', 'drone']).toContain(src.medium)

      // Light and sound land together: identical targetSec…
      expect(Math.abs(tag.targetSec - src.targetSec)).toBeLessThanOrEqual(1e-9)

      // …while the beam is fired early by exactly slant / c toward its aim
      // cell (the solver's beam anticipation = acoustic time-of-flight).
      const asset = site.assets.find((a) => a.id === tag.positionId)!
      const cell = grid.cells[tag.params!['targetCellId'] as number]!
      const tof = beamAimAt(asset, cell.centroid).slantM / SPEED_OF_SOUND_MPS
      expect(tag.anticipationSec).toBeCloseTo(tof, 9)
      expect(tag.fireSec).toBeCloseTo(tag.targetSec - tof, 9)

      // The two fire instants genuinely differ (shell rise vs sound flight).
      expect(Math.abs(tag.fireSec - src.fireSec)).toBeGreaterThan(0.05)
    }

    // North-mast thunder crosses the whole lawn: ToF at the ~0.55 s scale.
    const northTags = tags.filter((t) => t.positionId!.startsWith('beam-north'))
    expect(northTags.length).toBeGreaterThanOrEqual(11)
    for (const t of northTags) {
      expect(t.anticipationSec).toBeGreaterThan(0.5)
    }
  })

  it('sourceCueId links resolve cleanly in both variants', () => {
    for (const r of [std, quiet]) {
      expect(
        r.compiled.diagnostics.filter((d) => d.code.startsWith('BEAM_SOURCE')),
      ).toEqual([])
    }
  })

  it('act 1 tells the story: the first comet is untagged, the third is tagged', () => {
    const lag = cueById(std, 'sunrise-lag-comet')
    const repaired = cueById(std, 'sunrise-repaired-comet')
    // Same effect, same rack — the only difference is the physics repair.
    expect(lag.effectId).toBe('comet-30-gold')
    expect(repaired.effectId).toBe('comet-30-gold')
    expect(lag.positionId).toBe('rack-8')
    expect(repaired.positionId).toBe('rack-8')
    const tags = thunderTags(std)
    expect(tags.some((t) => t.params!['sourceCueId'] === 'sunrise-lag-comet')).toBe(false)
    expect(tags.some((t) => t.params!['sourceCueId'] === 'sunrise-repaired-comet')).toBe(true)
    // The sunrise hits are where the score says they are.
    const sunrises = annotationsOfKind(std.show.music, 'hit', 'sunrise')
    expect(sunrises).toHaveLength(3)
    expect(Math.abs(lag.targetSec - sunrises[0]!.time)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(repaired.targetSec - sunrises[2]!.time)).toBeLessThanOrEqual(1e-9)
  })

  it('lands the daybreak peony pair ON the damped act-1 climax', () => {
    const daybreak = annotationsOfKind(std.show.music, 'climax')[0]!
    expect(daybreak.label).toBe('daybreak')
    for (const id of ['daybreak-a', 'daybreak-b']) {
      const cue = cueById(std, id)
      expect(cue.effectId).toBe('peony-100-white')
      expect(Math.abs(cue.targetSec - daybreak.time)).toBeLessThanOrEqual(1e-9)
    }
    expect(Math.abs(cueById(std, 'daybreak-haptic').targetSec - daybreak.time)).toBeLessThanOrEqual(
      1e-9,
    )
  })

  it('holds the planetary orrery ≥ 45 s, spanning the waltz through thaxted', () => {
    const orrery = cueById(std, 'orrery')
    expect(orrery.effectId).toBe('orrery-formation-140')
    expect(orrery.durationSec).toBeGreaterThanOrEqual(45)
    const waltzPeak = annotationsOfKind(std.show.music, 'climax')[1]!
    expect(waltzPeak.label).toBe('waltzPeak')
    expect(orrery.targetSec).toBeLessThanOrEqual(waltzPeak.time)
    const thaxted = std.show.music.annotations.find((a) => a.label === 'thaxted')!
    expect(orrery.targetSec + orrery.durationSec).toBeGreaterThanOrEqual(thaxted.time)
  })

  it('chases the comet crossing with its own tag while the doppler flies front→back', () => {
    const comet = cueById(std, 'comet-crossing')
    expect(comet.positionId).toBe('pad-2')
    const tag = cueById(std, 'thunder-comet-crossing-000')
    expect(tag.params!['sourceCueId']).toBe('comet-crossing')
    expect(Math.abs(tag.targetSec - comet.targetSec)).toBeLessThanOrEqual(1e-9)
    const doppler = cueById(std, 'doppler-000')
    expect(doppler.params!['pathCellIds']).toEqual([323, 171, 19])
    expect(doppler.targetSec).toBeGreaterThan(comet.targetSec)
  })

  it('peaks the barrage and the triple ice burst ON the jovian climax', () => {
    const jovian = annotationsOfKind(std.show.music, 'climax')[2]!
    expect(jovian.label).toBe('jovian')
    for (let i = 0; i < 3; i++) {
      const cue = cueById(std, `jovian-ice-${i}`)
      expect(cue.effectId).toBe('brocade-200-ice')
      expect(Math.abs(cue.targetSec - jovian.time)).toBeLessThanOrEqual(1e-9)
      // …and each of the three carries its own thunder.
      const tag = cueById(std, `thunder-jovian-ice-${i}-000`)
      expect(tag.params!['sourceCueId']).toBe(`jovian-ice-${i}`)
    }
    const barrage = std.compiled.cues.filter((c) => c.id.startsWith('jovian-barrage-'))
    expect(barrage.length).toBeGreaterThanOrEqual(40)
    const peak = barrage.reduce((a, b) => (b.targetSec > a.targetSec ? b : a))
    expect(Math.abs(peak.targetSec - jovian.time)).toBeLessThanOrEqual(1e-9)
    expect(peak.effectId).toBe('brocade-200-ice')
  })

  it('spells IO from pad-2 on the perihelion hit', () => {
    const perihelion = annotationsOfKind(std.show.music, 'hit', 'perihelion')[0]!
    const io = cueById(std, 'io-moons')
    expect(io.positionId).toBe('pad-2')
    expect(io.params?.['text']).toBe('IO')
    expect(io.params?.['count']).toBe(60)
    expect(Math.abs(io.targetSec - perihelion.time)).toBeLessThanOrEqual(1e-9)
  })

  it('rains the phone starfield in ahead of the downbeat (phone-latency lead)', () => {
    const first = cueById(std, 'starfield-0')
    expect(first.targetSec).toBe(-4)
    // Phone channel p95 on lakeside masts is 1.2 s — commanded that early.
    expect(first.anticipationSec).toBeCloseTo(1.2, 9)
    expect(first.fireSec).toBeCloseTo(-5.2, 9)
    expect(first.fireSec).toBeGreaterThanOrEqual(-8) // inside the pre-roll
  })

  it('exceeds the 85 dB budget somewhere (negative control for the quiet variant)', () => {
    const report = quietReport(std.compiled, getEffect, 85)
    expect(report.pass).toBe(false)
    expect(report.peakDb).toBeGreaterThan(85)
  })
})

describe('cosmosQuiet', () => {
  it('builds without throwing, with zero error diagnostics — the 85 dB budget holds', () => {
    expect(errorsOf(quiet)).toEqual([])
    expect(quiet.show.meta.variant).toBe('quiet')
    expect(quiet.show.noiseBudget).toEqual({ maxSplDb: 85 })
    expect(
      quiet.compiled.diagnostics.filter((d) => d.code === 'SPL_BUDGET' && d.severity === 'error'),
    ).toEqual([])
  })

  it('never authors an effect above 100 dB at the reference distance', () => {
    for (const cue of quiet.compiled.cues) {
      const effect = getEffect(cue.effectId)
      expect(effect, `effect '${cue.effectId}'`).toBeDefined()
      expect(effect!.noiseDbAt15m).toBeLessThanOrEqual(100)
    }
  })

  it('keeps the identical thunder-with-flash skeleton (15 tags, same sources)', () => {
    const stdTags = thunderTags(std)
    const quietTags = thunderTags(quiet)
    expect(quietTags).toHaveLength(15)
    expect(quietTags.map((t) => [t.id, t.params!['sourceCueId']])).toEqual(
      stdTags.map((t) => [t.id, t.params!['sourceCueId']]),
    )
    for (const tag of quietTags) {
      const src = cueById(quiet, tag.params!['sourceCueId'] as string)
      expect(Math.abs(tag.targetSec - src.targetSec)).toBeLessThanOrEqual(1e-9)
    }
  })

  it('stands in for every act-1/act-2 report with zone pulses + haptics', () => {
    const pulses = quiet.compiled.cues.filter((c) => c.effectId === 'beam-zone-pulse')
    expect(pulses).toHaveLength(7) // daybreak + six waltz phrase ends
    for (const p of pulses) {
      expect(p.params?.['cells']).toBe('all') // whole-lawn thump
      expect(p.positionId!.startsWith('beam-delay')).toBe(true)
    }
    const haptics = quiet.compiled.cues.filter((c) => c.effectId === 'crowd-haptic-thump')
    expect(haptics).toHaveLength(8) // daybreak + jovian + six waltz reports
    // The standard variant keeps only the two climax haptics.
    expect(std.compiled.cues.filter((c) => c.effectId === 'crowd-haptic-thump')).toHaveLength(2)
  })

  it('has cue counts in the expected ranges (same structure, quiet mix)', () => {
    const byMedium = new Map<string, number>()
    for (const c of quiet.compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    expect(quiet.compiled.cues.length).toBeGreaterThanOrEqual(130)
    expect(quiet.compiled.cues.length).toBeLessThanOrEqual(160)
    expect(byMedium.get('drone')).toBe(5)
    expect(byMedium.get('crowd')).toBe(33) // +6 report haptics
    expect(byMedium.get('beam')).toBe(32) // +7 zone pulses
    expect(byMedium.get('fabrication')).toBe(3)
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
    expect(JSON.stringify(cosmos())).toBe(JSON.stringify(cosmos()))
  })

  it('two quiet builds are JSON-identical', () => {
    expect(JSON.stringify(cosmosQuiet())).toBe(JSON.stringify(cosmosQuiet()))
  })
})
