import { describe, expect, it } from 'vitest'
import { zarathustraSunrise } from '../src/music/scores/zarathustraSunrise.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 22
const TOTAL_BEATS = BARS * 4 // 88, 4/4 throughout
const TARGET_SEC = 95
// 88 beats at 56 bpm + the 2 s timeline tail.
const EXPECTED_DURATION = (TOTAL_BEATS * 60) / 56 + 2

const { tempo, meter } = tempoMapsFrom(zarathustraSunrise.tempo)
const tl = buildTimelineFromScore(zarathustraSunrise)

describe('zarathustraSunrise score sanity', () => {
  it('barchecks parse clean: construction does not throw and yields notes', () => {
    expect(() => buildTimelineFromScore(zarathustraSunrise)).not.toThrow()
    expect(zarathustraSunrise.notes.length).toBeGreaterThan(0)
    expect(zarathustraSunrise.id).toBe('zarathustraSunrise')
    expect(zarathustraSunrise.title).toBe('Also sprach Zarathustra — Sunrise')
  })

  it('has 4 voices: lead, brass, bass, perc', () => {
    expect(zarathustraSunrise.voices.map((v) => v.program)).toEqual([
      'lead',
      'brass',
      'bass',
      'perc',
    ])
  })

  it('runs at 56 bpm in 4/4 throughout', () => {
    expect(zarathustraSunrise.tempo.segments).toEqual([{ beat: 0, bpm: 56 }])
    expect(zarathustraSunrise.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 4 }])
  })

  it('note count snapshot: 75 total (6 lead / 21 brass / 2 bass / 46 perc)', () => {
    expect(zarathustraSunrise.notes.length).toBe(75)
    const byVoice = [0, 1, 2, 3].map(
      (v) => zarathustraSunrise.notes.filter((n) => n.voice === v).length,
    )
    expect(byVoice).toEqual([6, 21, 2, 46])
  })

  it('spans exactly 22 bars / 88 beats with sane note fields', () => {
    let maxEnd = 0
    for (const n of zarathustraSunrise.notes) {
      expect(n.startBeat).toBeGreaterThanOrEqual(0)
      expect(n.durBeats).toBeGreaterThan(0)
      expect(n.velocity).toBeGreaterThan(0)
      expect(n.velocity).toBeLessThanOrEqual(1)
      expect(n.midi).toBeGreaterThanOrEqual(12)
      expect(n.midi).toBeLessThanOrEqual(127)
      maxEnd = Math.max(maxEnd, n.startBeat + n.durBeats)
    }
    expect(maxEnd).toBe(TOTAL_BEATS)
    expect(meter.beatToBarBeat(TOTAL_BEATS)).toEqual({ bar: BARS + 1, beat: 1 })
  })

  it('the organ pedal is two long tie chains: bars 1–17, then 18–22', () => {
    const bass = zarathustraSunrise.notes.filter((n) => n.voice === 2)
    expect(bass).toHaveLength(2)
    expect(bass[0]).toMatchObject({ startBeat: 0, durBeats: 17 * 4, midi: 36 }) // C2
    expect(bass[1]).toMatchObject({ startBeat: 17 * 4, durBeats: 5 * 4, midi: 36 })
  })

  it('stamps three rising sunrise hits, one per trumpet statement', () => {
    const sunrises = zarathustraSunrise.annotations.filter((a) => a.label === 'sunrise')
    expect(sunrises).toHaveLength(3)
    for (const s of sunrises) expect(s.kind).toBe('hit')
    expect(sunrises.map((a) => a.beat)).toEqual([8, 28, 48]) // bars 3, 8, 13
    expect(sunrises.map((a) => a.strength)).toEqual([0.7, 0.8, 0.9])
  })

  it('stamps four timpani pulse hits between the statements', () => {
    const pulses = zarathustraSunrise.annotations.filter((a) => a.label === 'pulse')
    expect(pulses).toHaveLength(4)
    for (const p of pulses) expect(p.kind).toBe('hit')
    expect(pulses.map((a) => a.beat)).toEqual([20, 40, 60, 64]) // bars 6, 11, 16, 17
    for (const p of pulses) expect(p.strength).toBeLessThan(0.95)
  })

  it('has exactly one climax, damped to 0.95, labeled daybreak at bar 18', () => {
    const climaxes = zarathustraSunrise.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(0.95)
    expect(climaxes[0]!.label).toBe('daybreak')
    expect(climaxes[0]!.beat).toBe(68) // bar 18 beat 1
  })

  it('score annotations are sorted by time', () => {
    for (let i = 1; i < zarathustraSunrise.annotations.length; i++) {
      expect(zarathustraSunrise.annotations[i]!.time).toBeGreaterThanOrEqual(
        zarathustraSunrise.annotations[i - 1]!.time,
      )
    }
  })
})

describe('zarathustraSunrise timeline', () => {
  it('builds and lands within ±15% of the ~95 s target', () => {
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.duration).toBeGreaterThan(TARGET_SEC * 0.85)
    expect(tl.duration).toBeLessThan(TARGET_SEC * 1.15)
    expect(tl.duration).toBeCloseTo(EXPECTED_DURATION, 6)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of zarathustraSunrise.notes) {
      expect(tempo.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempo.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('timeline annotations are sorted and the labelled hits survive the merge', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
    expect(annotationsOfKind(tl, 'hit', 'sunrise')).toHaveLength(3)
    expect(annotationsOfKind(tl, 'hit', 'pulse')).toHaveLength(4)
  })

  it('climaxOf finds the daybreak climax at bar 18', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(0.95)
    expect(c?.label).toBe('daybreak')
    expect(c?.time).toBeCloseTo(tempo.beatToSec(68), 9)
  })
})
