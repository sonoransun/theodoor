import { describe, expect, it } from 'vitest'
import { jupiterHymn } from '../src/music/scores/jupiterHymn.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 36
const TOTAL_BEATS = BARS * 3 // 108, 3/4 throughout
const TARGET_SEC = 85
// 108 beats at 76 bpm + the 2 s timeline tail.
const EXPECTED_DURATION = (TOTAL_BEATS * 60) / 76 + 2
const STATEMENT2_START = 16 * 3 // bar 17 beat 1
const CODA_START = 32 * 3 // bar 33 beat 1

const { tempo, meter } = tempoMapsFrom(jupiterHymn.tempo)
const tl = buildTimelineFromScore(jupiterHymn)

describe('jupiterHymn score sanity', () => {
  it('barchecks parse clean: construction does not throw and yields notes', () => {
    expect(() => buildTimelineFromScore(jupiterHymn)).not.toThrow()
    expect(jupiterHymn.notes.length).toBeGreaterThan(0)
    expect(jupiterHymn.id).toBe('jupiterHymn')
    expect(jupiterHymn.title).toBe('Jupiter — Thaxted Hymn')
  })

  it('has 3 voices: lead, bass, bells', () => {
    expect(jupiterHymn.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
  })

  it('runs at 76 bpm in 3/4 throughout', () => {
    expect(jupiterHymn.tempo.segments).toEqual([{ beat: 0, bpm: 76 }])
    expect(jupiterHymn.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 3 }])
  })

  it('note count snapshot: 193 total (95 lead / 47 bass / 51 bells)', () => {
    expect(jupiterHymn.notes.length).toBe(193)
    const byVoice = [0, 1, 2].map((v) => jupiterHymn.notes.filter((n) => n.voice === v).length)
    expect(byVoice).toEqual([95, 47, 51])
  })

  it('spans exactly 36 bars / 108 beats with sane note fields', () => {
    let maxEnd = 0
    for (const n of jupiterHymn.notes) {
      expect(n.startBeat).toBeGreaterThanOrEqual(0)
      expect(n.durBeats).toBeGreaterThan(0)
      expect(n.velocity).toBeGreaterThan(0)
      expect(n.velocity).toBeLessThanOrEqual(1)
      maxEnd = Math.max(maxEnd, n.startBeat + n.durBeats)
    }
    expect(maxEnd).toBe(TOTAL_BEATS)
    expect(meter.beatToBarBeat(TOTAL_BEATS)).toEqual({ bar: BARS + 1, beat: 1 })
  })

  it('bells are tacet in statement 1, then double the lead an octave up', () => {
    const bells = jupiterHymn.notes.filter((n) => n.voice === 2)
    expect(bells[0]!.startBeat).toBe(STATEMENT2_START)
    // Every statement-2 lead note has a bells twin 12 semitones higher.
    const lead2 = jupiterHymn.notes.filter(
      (n) => n.voice === 0 && n.startBeat >= STATEMENT2_START && n.startBeat < CODA_START,
    )
    expect(lead2.length).toBeGreaterThan(0)
    for (const n of lead2) {
      const twin = bells.find(
        (b) => b.startBeat === n.startBeat && b.durBeats === n.durBeats && b.midi === n.midi + 12,
      )
      expect(twin).toBeDefined()
    }
  })

  it('the second statement is the fortissimo one', () => {
    const lead1 = jupiterHymn.notes.filter((n) => n.voice === 0 && n.startBeat < STATEMENT2_START)
    const lead2 = jupiterHymn.notes.filter(
      (n) => n.voice === 0 && n.startBeat >= STATEMENT2_START && n.startBeat < CODA_START,
    )
    for (const n of lead1) expect(n.velocity).toBeLessThan(0.7)
    for (const n of lead2) expect(n.velocity).toBeGreaterThan(0.85)
  })

  it('stamps the thaxted accent on bar 1', () => {
    const thaxted = jupiterHymn.annotations.filter((a) => a.label === 'thaxted')
    expect(thaxted).toHaveLength(1)
    expect(thaxted[0]!.kind).toBe('accent')
    expect(thaxted[0]!.beat).toBe(0)
  })

  it('phrase ends every 8 bars, all labeled phraseEnd', () => {
    const phrases = jupiterHymn.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases).toHaveLength(5)
    for (const p of phrases) expect(p.label).toBe('phraseEnd')
    // Bars 9, 17, 25, 33 and the closing downbeat 37.
    expect(phrases.map((a) => a.beat)).toEqual([24, 48, 72, 96, 108])
  })

  it('carries the suite\'s single strength-1.0 climax at the bar-29 summit', () => {
    const climaxes = jupiterHymn.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(1)
    expect(climaxes[0]!.label).toBe('jovian')
    expect(climaxes[0]!.beat).toBe(84) // bar 29 beat 1 — statement 2's peak bar
    // The summit is real: the lead's high C sits on that downbeat.
    const summit = jupiterHymn.notes.find((n) => n.voice === 0 && n.startBeat === 84)
    expect(summit?.midi).toBe(72) // C5
  })

  it('a perihelion hit lands on the held final chord', () => {
    const hits = jupiterHymn.annotations.filter((a) => a.kind === 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.label).toBe('perihelion')
    expect(hits[0]!.strength).toBe(0.9)
    expect(hits[0]!.beat).toBe(102) // bar 35 beat 1
    // All three voices attack there and hold to the end.
    const finals = jupiterHymn.notes.filter((n) => n.startBeat === 102)
    expect(finals.map((n) => n.voice).sort()).toEqual([0, 1, 2])
    for (const n of finals) expect(n.startBeat + n.durBeats).toBe(TOTAL_BEATS)
  })

  it('score annotations are sorted by time', () => {
    for (let i = 1; i < jupiterHymn.annotations.length; i++) {
      expect(jupiterHymn.annotations[i]!.time).toBeGreaterThanOrEqual(
        jupiterHymn.annotations[i - 1]!.time,
      )
    }
  })
})

describe('jupiterHymn timeline', () => {
  it('builds and lands within ±15% of the ~85 s target', () => {
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.duration).toBeGreaterThan(TARGET_SEC * 0.85)
    expect(tl.duration).toBeLessThan(TARGET_SEC * 1.15)
    expect(tl.duration).toBeCloseTo(EXPECTED_DURATION, 6)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of jupiterHymn.notes) {
      expect(tempo.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempo.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('timeline annotations are sorted and the labelled marks survive the merge', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
    expect(annotationsOfKind(tl, 'accent', 'thaxted')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'hit', 'perihelion')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'phrase', 'phraseEnd')).toHaveLength(5)
  })

  it('climaxOf finds the jovian climax at bar 29', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.label).toBe('jovian')
    expect(c?.time).toBeCloseTo(tempo.beatToSec(84), 9)
  })
})
