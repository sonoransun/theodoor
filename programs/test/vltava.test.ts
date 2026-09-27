import { describe, expect, it } from 'vitest'
import type { BuildResult, CompiledCue } from '@theodoor/core'
import {
  GRAVITY_MPS2,
  SPEED_OF_SOUND_MPS,
  annotationsOfKind,
  beamAimAt,
  crowdGridFor,
  deriveLightChains,
  getEffectFrom,
  quietReport,
  runHeadless,
  starterCatalog,
} from '@theodoor/core'
import { vltava, vltavaQuiet } from '../src/vltava.js'

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
const countBy = (r: BuildResult): Map<string, number> => {
  const m = new Map<string, number>()
  for (const c of r.compiled.cues) m.set(c.medium, (m.get(c.medium) ?? 0) + 1)
  return m
}

/** lakesidePark fountain banks: 0.15 s valve latency; the ballistic rise is sqrt(2h/g). */
const VALVE_SEC = 0.15
const riseSec = (h: number): number => Math.sqrt((2 * h) / GRAVITY_MPS2)

const ACT_TITLES = [
  'I — Two Springs',
  'II — The River',
  'III — Forest Hunt',
  'IV — Peasant Wedding',
  'V — Moonlight, Nymphs',
  'VI — St John’s Rapids',
  'VII — The Broad Vltava',
  'VIII — Vyšehrad',
]

// Built once for the read-only assertions below (each factory call is pure;
// determinism of repeated calls is asserted separately).
const std = vltava()
const quiet = vltavaQuiet()

describe('vltava (standard)', () => {
  it('builds without throwing, with zero error diagnostics (warnings allowed)', () => {
    expect(errorsOf(std)).toEqual([])
    expect(std.show.meta.variant).toBe('standard')
    expect(std.show.meta.seed).toBe(18750404)
    expect(std.show.music.id).toBe('vltava')
    expect(std.show.preRollSec).toBe(8)
  })

  it('has no hardware or kinematic conflicts: no slew, overlap, pad, or negative-fire diagnostics', () => {
    const codes = std.compiled.diagnostics.map((d) => d.code)
    for (const bad of ['BEAM_SLEW', 'DRONE_OVERLAP', 'NEGATIVE_FIRE', 'PIN_CAPACITY', 'CROWD_BANDWIDTH']) {
      expect(codes).not.toContain(bad)
    }
    expect(codes.filter((c) => c.startsWith('sim/light-'))).toEqual([])
    expect(codes).not.toContain('sim/morph-window-short')
  })

  it('tells the story in eight chronological acts', () => {
    expect(std.compiled.acts?.map((a) => a.title)).toEqual(ACT_TITLES)
    const acts = std.compiled.acts!
    for (let i = 1; i < acts.length; i++) {
      expect(acts[i]!.fromSec).toBeGreaterThan(acts[i - 1]!.fromSec)
      expect(acts[i - 1]!.toSec).toBe(acts[i]!.fromSec)
    }
    // Act starts sit on the score's own section marks.
    expect(acts[1]!.fromSec).toBeCloseTo(annotationsOfKind(std.show.music, 'accent', 'river')[0]!.time, 9)
    expect(acts[6]!.fromSec).toBeCloseTo(annotationsOfKind(std.show.music, 'climax')[0]!.time, 9)
    expect(std.show.notes?.music).toEqual(['Bedřich Smetana — Vltava (Má vlast, 1874)'])
  })

  it('has cue counts in the expected ranges — every one of the nine media but fabrication', () => {
    const by = countBy(std)
    expect(std.compiled.cues.length).toBeGreaterThanOrEqual(210)
    expect(std.compiled.cues.length).toBeLessThanOrEqual(235)
    expect(by.get('fountain')).toBe(44)
    expect(by.get('searchlight')).toBe(27)
    expect(by.get('drone')).toBe(7) // wave, spiral, birds, ring, crescent, bloom, VLTAVA
    expect(by.get('beam')).toBe(25)
    expect(by.get('crowd')).toBe(32)
    expect(by.get('laser')).toBe(12)
    expect(by.get('panel')).toBe(12)
    expect(by.get('pyro')).toBeGreaterThanOrEqual(55)
    expect(by.get('fabrication')).toBeUndefined()
  })

  it('SIGNATURE (a): one 45 m shooter crests ON each nymph chime, fired 3.18 s early; the sky stays dark', () => {
    const nymphs = annotationsOfKind(std.show.music, 'hit', 'nymph')
    expect(nymphs).toHaveLength(3)
    const lead = VALVE_SEC + riseSec(45)
    expect(lead).toBeCloseTo(3.179, 3)
    nymphs.forEach((hit, i) => {
      const shooter = cueById(std, `nymph-shooter-${i}`)
      expect(shooter.effectId).toBe('fountain-shooter-45m')
      expect(shooter.positionId).toBe(i % 2 === 0 ? 'fount-west' : 'fount-east')
      expect(Math.abs(shooter.targetSec - hit.time)).toBeLessThanOrEqual(1e-9)
      expect(shooter.anticipationSec).toBeCloseTo(lead, 9)
      expect(shooter.fireSec).toBeCloseTo(hit.time - lead, 9)
      // Nothing in the sky lands anywhere near a nymph chime: water only.
      const skyNearby = std.compiled.cues.filter(
        (c) => c.medium === 'pyro' && Math.abs(c.targetSec - hit.time) < 3,
      )
      expect(skyNearby).toEqual([])
    })
  })

  it('SIGNATURE (b): the two springs are the first things seen — plumes cresting on the spring hits, valves opened 2.62 s early', () => {
    const springs = annotationsOfKind(std.show.music, 'hit', 'spring')
    expect(springs).toHaveLength(2)
    const lead = VALVE_SEC + riseSec(30)
    const cold = cueById(std, 'spring-cold')
    const warm = cueById(std, 'spring-warm')
    expect(cold.targetSec).toBe(0)
    expect(Math.abs(warm.targetSec - springs[1]!.time)).toBeLessThanOrEqual(1e-9)
    for (const c of [cold, warm]) {
      expect(c.effectId).toBe('fountain-plume-30m')
      expect(c.anticipationSec).toBeCloseTo(lead, 9)
    }
    expect(cold.fireSec).toBeCloseTo(-lead, 9)
    expect(cold.fireSec).toBeGreaterThanOrEqual(-8) // inside the pre-roll
    // Before the first river accent no pyro, laser, or panel has landed.
    const river = annotationsOfKind(std.show.music, 'accent', 'river')[0]!.time
    expect(
      std.compiled.cues.filter(
        (c) => ['pyro', 'laser', 'panel', 'drone'].includes(c.medium) && c.targetSec < river,
      ),
    ).toEqual([])
  })

  it('SIGNATURE (c): the moon spire lands together from both banks, fired early by exactly the sim chain slew', () => {
    const moon = annotationsOfKind(std.show.music, 'accent', 'moonlight')[0]!
    const west = cueById(std, 'moon-spire-1-000')
    const east = cueById(std, 'moon-spire-1-001')
    expect(west.positionId).toBe('lights-west')
    expect(east.positionId).toBe('lights-east')
    for (const c of [west, east]) {
      expect(Math.abs(c.targetSec - moon.time)).toBeLessThanOrEqual(1e-9)
      expect(c.params?.['aimX']).toBe(0)
      expect(c.params?.['aimZ']).toBe(160)
      // From park (straight up) to 41° toward center at 60°/s × 1.1 ≈ 0.76 s.
      expect(c.anticipationSec).toBeGreaterThan(0.7)
      expect(c.anticipationSec).toBeLessThan(0.8)
    }
    expect(west.fireSec).toBeCloseTo(east.fireSec, 9)

    // Every compiled searchlight cue's fireSec IS its chain departure.
    const chains = deriveLightChains(std.compiled, getEffect)
    const segments = chains.flatMap((b) => b.segments)
    const lights = std.compiled.cues.filter((c) => c.medium === 'searchlight')
    expect(segments).toHaveLength(lights.length)
    for (const seg of segments) {
      const c = cueById(std, seg.cue.id)
      expect(c.fireSec).toBeCloseTo(seg.startSec, 9)
      expect(c.anticipationSec).toBeCloseTo(seg.targetSec - seg.startSec, 9)
      // Unsqueezed everywhere: the departure is the kinematic ideal.
      expect(seg.startSec).toBeCloseTo(seg.targetSec - seg.slewSec, 9)
    }
    // Mirrored pairs depart together.
    expect(cueById(std, 'river-sweep-000').fireSec).toBeCloseTo(cueById(std, 'river-sweep-001').fireSec, 9)
    expect(cueById(std, 'broad-pillars-000').anticipationSec).toBe(0) // vertical → vertical: no slew
  })

  it('SIGNATURE (d): every thunder tag lands WITH its shell, fired early by the time-of-flight', () => {
    const tags = thunderTags(std)
    expect(tags).toHaveLength(8) // 3 rapids + 3 brocades + 2 willows
    const site = std.show.site
    const grid = crowdGridFor(site)!
    for (const tag of tags) {
      const src = cueById(std, tag.params!['sourceCueId'] as string)
      expect(src.medium).toBe('pyro')
      expect(Math.abs(tag.targetSec - src.targetSec)).toBeLessThanOrEqual(1e-9)
      const asset = site.assets.find((a) => a.id === tag.positionId)!
      const cell = grid.cells[tag.params!['targetCellId'] as number]!
      const tof = beamAimAt(asset, cell.centroid).slantM / SPEED_OF_SOUND_MPS
      expect(tag.anticipationSec).toBeCloseTo(tof, 9)
      expect(Math.abs(tag.fireSec - src.fireSec)).toBeGreaterThan(0.05)
    }
    expect(std.compiled.diagnostics.filter((d) => d.code.startsWith('BEAM_SOURCE'))).toEqual([])
    // The other five rapids get whole-lawn zone pulses from the east delay tower.
    const pulses = std.compiled.cues.filter((c) => c.id.startsWith('rapid-pulse-'))
    expect(pulses).toHaveLength(5)
    for (const p of pulses) {
      expect(p.params?.['cells']).toBe('all')
      expect(p.positionId).toBe('beam-delay-east')
    }
  })

  it('SIGNATURE (e): the barrage, the triple brocade, and nine shooters per bank all land ON the climax', () => {
    const climax = annotationsOfKind(std.show.music, 'climax')[0]!
    expect(climax.label).toBe('broadRiver')
    expect(climax.strength).toBe(1)
    const barrage = std.compiled.cues.filter((c) => c.id.startsWith('rapids-barrage-'))
    expect(barrage.length).toBeGreaterThanOrEqual(25)
    const peak = barrage.reduce((a, b) => (b.targetSec > a.targetSec ? b : a))
    expect(Math.abs(peak.targetSec - climax.time)).toBeLessThanOrEqual(1e-9)
    expect(peak.effectId).toBe('brocade-200-gold')
    for (let i = 0; i < 3; i++) {
      const cue = cueById(std, `broad-brocade-${i}`)
      expect(cue.effectId).toBe('brocade-200-gold')
      expect(Math.abs(cue.targetSec - climax.time)).toBeLessThanOrEqual(1e-9)
      expect(cueById(std, `thunder-broad-brocade-${i}-000`).params!['sourceCueId']).toBe(`broad-brocade-${i}`)
    }
    for (const id of ['broad-shooters-000', 'broad-shooters-001']) {
      const shooters = cueById(std, id)
      expect(shooters.effectId).toBe('fountain-shooter-45m')
      expect(shooters.params?.['nozzles']).toBe(0) // the whole row: nine columns
      expect(Math.abs(shooters.targetSec - climax.time)).toBeLessThanOrEqual(1e-9)
      expect(shooters.anticipationSec).toBeCloseTo(VALVE_SEC + riseSec(45), 9)
    }
    expect(Math.abs(cueById(std, 'broad-pillars-000').targetSec - climax.time)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(cueById(std, 'broad-bloom').targetSec - climax.time)).toBeLessThanOrEqual(1e-9)
  })

  it('ends on the last wave: one plume, one bank of pillars, one bell, then dark', () => {
    const lastWave = annotationsOfKind(std.show.music, 'hit', 'lastWave')[0]!
    const plume = cueById(std, 'last-wave-plume')
    expect(plume.params?.['nozzles']).toBe(1)
    expect(Math.abs(plume.targetSec - lastWave.time)).toBeLessThanOrEqual(1e-9)
    const pillar = cueById(std, 'last-pillar')
    expect(pillar.positionId).toBe('lights-west')
    expect(Math.abs(pillar.targetSec - lastWave.time)).toBeLessThanOrEqual(1e-9)
    const bell = cueById(std, 'last-bell-000')
    expect(bell.params?.['cells']).toBe('all')
    // Nothing lands after the blackout floods.
    const out = cueById(std, 'lights-out-mast-west')
    expect(std.compiled.cues.filter((c) => c.targetSec > out.targetSec + 1e-9)).toEqual([])
  })

  it('pad-1 spells VLTAVA inside the geofence and the crowd spells it back', () => {
    const text = cueById(std, 'castle-text')
    expect(text.params?.['text']).toBe('VLTAVA')
    expect(text.positionId).toBe('pad-1')
    const castle = annotationsOfKind(std.show.music, 'accent', 'vysehrad')[0]!
    expect(Math.abs(text.targetSec - castle.time)).toBeLessThanOrEqual(1e-9)
    const crowdText = std.compiled.cues.filter((c) => c.id.startsWith('castle-text-crowd-'))
    expect(crowdText.length).toBeGreaterThan(0)
    expect(std.compiled.diagnostics.filter((d) => d.code === 'geofence')).toEqual([])
  })

  it('SIGNATURE (f): the headless sim confirms water and light keep the keystone', () => {
    const { stats } = runHeadless(std.compiled)
    expect(stats.peakActiveJets).toBeGreaterThanOrEqual(18) // nine shooters per bank at the climax
    expect(stats.peakActiveLights).toBeGreaterThanOrEqual(8) // both banks, all heads
    expect(stats.fountainCrestErrorSecMax).toBeLessThan(1e-9)
    expect(stats.lightArrivalLagSecMax).toBe(0)
    expect(stats.beamLandingErrorSecMax).toBeLessThan(1e-9)
    expect(stats.peakDrones).toBeGreaterThanOrEqual(200)
  }, 120_000)

  it('exceeds the 85 dB budget somewhere (negative control for the quiet variant)', () => {
    const report = quietReport(std.compiled, getEffect, 85)
    expect(report.pass).toBe(false)
    expect(report.peakDb).toBeGreaterThan(85)
  })
})

describe('vltavaQuiet', () => {
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

  it('keeps the water and the light identical to the standard performance', () => {
    const pick = (r: BuildResult) =>
      r.compiled.cues
        .filter((c) => c.medium === 'fountain' || c.medium === 'searchlight')
        .map((c) => [c.id, c.effectId, c.positionId, c.targetSec, c.fireSec, c.params])
    expect(pick(quiet)).toEqual(pick(std))
    expect(thunderTags(quiet).map((t) => t.id)).toEqual(thunderTags(std).map((t) => t.id))
  })

  it('stands in for the reports with wristband thumps (eight rapids + the castle)', () => {
    const haptics = quiet.compiled.cues.filter((c) => c.effectId === 'crowd-haptic-thump')
    expect(haptics).toHaveLength(10) // 8 rapids + climax + castle
    expect(std.compiled.cues.filter((c) => c.effectId === 'crowd-haptic-thump')).toHaveLength(1)
    const by = countBy(quiet)
    expect(by.get('crowd')).toBe(41)
    expect(by.get('fountain')).toBe(44)
    expect(by.get('searchlight')).toBe(27)
    expect(by.get('beam')).toBe(25)
  })

  it('shares the acts with the standard variant under a quiet tagline', () => {
    expect(quiet.compiled.acts?.map((a) => a.title)).toEqual(ACT_TITLES)
    expect(quiet.show.notes?.tagline).not.toBe(std.show.notes?.tagline)
    expect(quiet.show.notes?.tagline).toContain('quiet')
  })

  it('stays at or below 85 dB SPL at every listener in a headless sim run', () => {
    const { stats } = runHeadless(quiet.compiled)
    expect(stats.splPeakByListener).toHaveLength(3)
    for (const peak of stats.splPeakByListener) expect(peak).toBeLessThanOrEqual(85)
    expect(stats.fountainCrestErrorSecMax).toBeLessThan(1e-9)
    expect(stats.lightArrivalLagSecMax).toBe(0)
    // Cross-check with the analytic sweep the solver enforces.
    const report = quietReport(quiet.compiled, getEffect, 85)
    expect(report.pass).toBe(true)
  }, 120_000)
})

describe('determinism', () => {
  it('two standard builds are JSON-identical', () => {
    expect(JSON.stringify(vltava())).toBe(JSON.stringify(vltava()))
  })

  it('two quiet builds are JSON-identical', () => {
    expect(JSON.stringify(vltavaQuiet())).toBe(JSON.stringify(vltavaQuiet()))
  })
})
