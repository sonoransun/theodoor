/**
 * Pure report-audition math (audio/reportMath.ts): where and when each cue's
 * sound is emitted, when it ARRIVES at the seat (the time-of-flight lag the
 * show narrates), the propagated level → monitor gain, air absorption, pan,
 * and the arrival-sorted table + window selection. No AudioContext, no DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  EAR_HEIGHT_M,
  SPEED_OF_SOUND_MPS,
  buildTimelineFromScore,
  getEffectFrom,
  getScore,
  lakesidePark,
  musicRefs,
  showBuilder,
  starterCatalog,
} from '@theodoor/core'
import type { CompiledShow, PyroEffect, Vec2 } from '@theodoor/core'
import { MONITOR_REF_DB, MONITOR_REF_GAIN, REPORT_MAX_GAIN, monitorGain, reportGain } from '../src/audio/beamMath.js'
import {
  REPORT_ABSORPTION_SCALE_M,
  REPORT_LOWPASS_MIN_HZ,
  REPORT_LOWPASS_REF_HZ,
  airAbsorptionFcHz,
  boomSize,
  hasReportableCues,
  precomputeReports,
  pyroReportKind,
  reportSource,
  reportsInWindow,
  sourceLevelDb,
  sourceSlantM,
  sourceTofSec,
} from '../src/audio/reportMath.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)

/** A small lakeside show: an untagged peony, a salute, a mine, a comet, a waterfall, a fountain, and a beam. */
function buildFixture(): CompiledShow {
  const tl = buildTimelineFromScore(getScore('odeToJoy')!)
  const m = musicRefs(tl)
  const b = showBuilder({ id: 'report-fx', title: 'Report Fixture', seed: 5, site: lakesidePark(), catalog })
    .music(tl)
    .preRoll(8)
  b.pyro
    .fire({ id: 'peony', effect: 'peony-100-white', position: 'rack-4', land: m.barBeat(3, 1) })
    .fire({ id: 'salute', effect: 'salute-100', position: 'rack-8', land: m.barBeat(5, 1) })
    .fire({ id: 'mine', effect: 'mine-50-silver', position: 'rack-1', land: m.barBeat(7, 1) })
    .fire({ id: 'comet', effect: 'comet-30-gold', position: 'rack-5', land: m.barBeat(9, 1) })
  b.fabrication.cue({ id: 'falls', effectId: 'waterfall-30m', anchor: m.barBeat(11, 1), positionId: 'rack-6' })
  b.fountains.jet({ id: 'jet', effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(13, 1) })
  b.lights.figure({ id: 'pillar', effect: 'light-pillar-white', position: 'lights-west', land: m.barBeat(3, 1) })
  b.drones.formation({ id: 'ring', effect: 'ring-formation-60', position: 'pad-1', by: m.barBeat(15, 1), params: { count: 30, scaleM: 24 } })
  return b.build().compiled
}

const compiled = buildFixture()
const cue = (id: string) => compiled.cues.find((c) => c.id === id)!
/** Front-center seat on the lakeside lawn (row 8, col 19 ≈ (2, −192)). */
const seat: Vec2 = { x: 2, y: -192 }

describe('airAbsorptionFcHz', () => {
  it('is the full 16 kHz at the source and falls by 1/e per 400 m', () => {
    expect(airAbsorptionFcHz(0)).toBe(REPORT_LOWPASS_REF_HZ)
    expect(airAbsorptionFcHz(REPORT_ABSORPTION_SCALE_M)).toBeCloseTo(REPORT_LOWPASS_REF_HZ / Math.E, 6)
    expect(airAbsorptionFcHz(190)).toBeCloseTo(16000 * Math.exp(-190 / 400), 6)
  })

  it('is monotonic in distance and floors at the minimum cutoff', () => {
    let last = Infinity
    for (const d of [0, 50, 100, 200, 400, 800, 1600]) {
      const fc = airAbsorptionFcHz(d)
      expect(fc).toBeLessThanOrEqual(last)
      last = fc
    }
    expect(airAbsorptionFcHz(1e6)).toBe(REPORT_LOWPASS_MIN_HZ)
    expect(airAbsorptionFcHz(-10)).toBe(REPORT_LOWPASS_REF_HZ)
  })
})

describe('reportGain (shared anchor with the beams, 4:1 above it)', () => {
  it('is identical to monitorGain at and below the anchor', () => {
    for (const db of [20, 40, 55, MONITOR_REF_DB]) expect(reportGain(db)).toBe(monitorGain(db))
    expect(reportGain(MONITOR_REF_DB)).toBeCloseTo(MONITOR_REF_GAIN, 12)
  })

  it('compresses 4:1 above the anchor: +32 dB of source → +8 dB of monitor', () => {
    expect(reportGain(MONITOR_REF_DB + 32)).toBeCloseTo(MONITOR_REF_GAIN * Math.pow(10, 8 / 20), 9)
    // A 150 dB salute heard from the lawn (~128 dB) pins the cap, not far past it.
    expect(reportGain(128)).toBe(REPORT_MAX_GAIN)
    expect(reportGain(-Infinity)).toBe(0)
    expect(reportGain(Number.NaN)).toBe(0)
  })

  it('keeps fireworks and murmurs in honest proportion (a comet beats a whisper, a salute beats both)', () => {
    const whisper = monitorGain(47) // a 70 dB in-beam whisper ~200 m out
    const comet = reportGain(sourceLevelDb(85, { x: 0, y: 0, z: 40 }, seat))
    const salute = reportGain(sourceLevelDb(150, { x: 0, y: 0, z: 120 }, seat))
    expect(comet).toBeGreaterThan(whisper)
    expect(salute).toBeGreaterThan(comet)
    expect(salute).toBeLessThanOrEqual(REPORT_MAX_GAIN)
  })
})

describe('source geometry', () => {
  it('slant measures to the ear height and ToF is slant / 343', () => {
    const src = { x: 0, y: 0, z: EAR_HEIGHT_M }
    expect(sourceSlantM(src, { x: 0, y: -30 })).toBeCloseTo(30, 9)
    expect(sourceTofSec(src, { x: 0, y: -30 })).toBeCloseTo(30 / SPEED_OF_SOUND_MPS, 12)
    expect(sourceLevelDb(110, src, { x: 0, y: -30 })).toBeCloseTo(110 - 20 * Math.log10(2), 9)
  })

  it('maps every pyro category to a timbre and sizes booms by caliber', () => {
    expect(pyroReportKind('salute')).toBe('salute')
    expect(pyroReportKind('crossette')).toBe('crackle')
    expect(pyroReportKind('mine')).toBe('mine')
    expect(pyroReportKind('comet')).toBe('comet')
    for (const c of ['peony', 'chrysanthemum', 'willow', 'brocade'] as const) expect(pyroReportKind(c)).toBe('boom')
    expect(boomSize(200)).toBe(1)
    expect(boomSize(100)).toBeCloseTo(0.5, 12)
    expect(boomSize(1)).toBeCloseTo(0.15, 12)
  })
})

describe('reportSource', () => {
  it('a shell reports at its burst apex at targetSec (the break), not at fire', () => {
    const c = cue('peony')
    const fx = getEffect(c.effectId) as PyroEffect
    const s = reportSource(compiled, c, fx)!
    expect(s.kind).toBe('boom')
    expect(s.emitSec).toBe(c.targetSec)
    expect(s.src.z).toBeCloseTo(fx.burstHeightM, 9)
    const rack = compiled.show.site.assets.find((a) => a.id === 'rack-4')!
    expect(s.src.x).toBe(rack.pos.x)
    expect(s.src.y).toBe(rack.pos.y)
    expect(s.durSec).toBe(0)
  })

  it('a mine whooshes from the rack at fire time; a comet rides its ascent', () => {
    const mine = reportSource(compiled, cue('mine'), getEffect('mine-50-silver')!)!
    expect(mine.kind).toBe('mine')
    expect(mine.emitSec).toBe(cue('mine').fireSec)
    expect(mine.src.z).toBe(0)
    const comet = reportSource(compiled, cue('comet'), getEffect('comet-30-gold')!)!
    expect(comet.kind).toBe('comet')
    expect(comet.emitSec).toBe(cue('comet').fireSec)
    expect(comet.durSec).toBeCloseTo((getEffect('comet-30-gold') as PyroEffect).riseTimeSec, 9)
  })

  it('set pieces hiss for their duration; fountains rush from first water to dry', () => {
    const falls = reportSource(compiled, cue('falls'), getEffect('waterfall-30m')!)!
    expect(falls.kind).toBe('hiss')
    expect(falls.emitSec).toBe(cue('falls').targetSec)
    expect(falls.durSec).toBe(cue('falls').durationSec)
    const jet = cue('jet')
    const water = reportSource(compiled, jet, getEffect('fountain-plume-30m')!)!
    expect(water.kind).toBe('water')
    // First water = fire + the bank's 0.15 s valve latency; dry at target + duration.
    expect(water.emitSec).toBeCloseTo(jet.fireSec + 0.15, 9)
    expect(water.emitSec + water.durSec).toBeCloseTo(jet.targetSec + jet.durationSec, 9)
  })

  it('drones, lights (and beams) make no report', () => {
    expect(reportSource(compiled, cue('ring'), getEffect('ring-formation-60')!)).toBeUndefined()
    expect(reportSource(compiled, cue('pillar'), getEffect('light-pillar-white')!)).toBeUndefined()
  })
})

describe('precomputeReports (the arrival table)', () => {
  const table = precomputeReports(compiled, getEffect, seat)

  it('lists one event per reportable cue, sorted by arrival', () => {
    expect(table.map((e) => e.cueId).sort()).toEqual(['comet', 'falls', 'jet', 'mine', 'peony', 'salute'])
    for (let i = 1; i < table.length; i++) expect(table[i]!.arrivalSec).toBeGreaterThanOrEqual(table[i - 1]!.arrivalSec)
  })

  it('THE LAG: a peony breaking 120 m up over the racks is heard ~0.66 s after its flash', () => {
    const ev = table.find((e) => e.cueId === 'peony')!
    const rack = compiled.show.site.assets.find((a) => a.id === 'rack-4')!
    const slant = Math.hypot(rack.pos.x - seat.x, rack.pos.y - seat.y, 120 - EAR_HEIGHT_M)
    expect(ev.arrivalSec - ev.emitSec).toBeCloseTo(slant / SPEED_OF_SOUND_MPS, 9)
    expect(ev.arrivalSec - ev.emitSec).toBeGreaterThan(0.6)
    expect(ev.arrivalSec - ev.emitSec).toBeLessThan(0.75)
    expect(ev.emitSec).toBe(cue('peony').targetSec)
  })

  it('carries level → gain, air cutoff, and pan for the seat', () => {
    const salute = table.find((e) => e.cueId === 'salute')!
    const peony = table.find((e) => e.cueId === 'peony')!
    expect(salute.gain).toBeGreaterThan(peony.gain)
    expect(salute.gain).toBeLessThanOrEqual(REPORT_MAX_GAIN)
    expect(peony.lowpassHz).toBeLessThan(REPORT_LOWPASS_REF_HZ)
    expect(peony.lowpassHz).toBeGreaterThan(8000)
    // rack-8 sits at x = +120: due east-ish of a center seat → positive pan.
    expect(salute.pan).toBeGreaterThan(0.3)
    expect(salute.pan).toBeLessThanOrEqual(1)
    expect(peony.size).toBeCloseTo(0.5, 12)
    expect(peony.seed).toBe(cue('peony').seed)
  })

  it('moving the seat changes delays and pans deterministically', () => {
    const west = precomputeReports(compiled, getEffect, { x: -110, y: -192 })
    const again = precomputeReports(compiled, getEffect, { x: -110, y: -192 })
    expect(JSON.stringify(west)).toBe(JSON.stringify(again))
    const sW = west.find((e) => e.cueId === 'salute')!
    const sC = table.find((e) => e.cueId === 'salute')!
    expect(sW.arrivalSec).toBeGreaterThan(sC.arrivalSec) // farther from rack-8
    expect(sW.pan).toBeGreaterThan(sC.pan) // even more to the east
    expect(sW.emitSec).toBe(sC.emitSec) // the burst itself never moves
  })

  it('hasReportableCues is true here and false for a lights-only show', () => {
    expect(hasReportableCues(compiled, getEffect)).toBe(true)
    const onlyLights: CompiledShow = { ...compiled, cues: compiled.cues.filter((c) => c.medium === 'searchlight') }
    expect(hasReportableCues(onlyLights, getEffect)).toBe(false)
  })
})

describe('reportsInWindow', () => {
  const sorted = [{ arrivalSec: 1 }, { arrivalSec: 2 }, { arrivalSec: 2 }, { arrivalSec: 3.5 }, { arrivalSec: 9 }]

  it('selects the half-open window (from, to] exactly once per event', () => {
    expect(reportsInWindow(sorted, 0.5, 2).map((e) => e.arrivalSec)).toEqual([1, 2, 2])
    expect(reportsInWindow(sorted, 2, 4).map((e) => e.arrivalSec)).toEqual([3.5])
    expect(reportsInWindow(sorted, 4, 100).map((e) => e.arrivalSec)).toEqual([9])
  })

  it('returns nothing for an empty or inverted window', () => {
    expect(reportsInWindow(sorted, 5, 5)).toEqual([])
    expect(reportsInWindow(sorted, 6, 5)).toEqual([])
    expect(reportsInWindow([], 0, 10)).toEqual([])
  })
})
