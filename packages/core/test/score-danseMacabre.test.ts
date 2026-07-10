import { describe, expect, it } from 'vitest'
import { danseMacabre } from '../src/music/scores/danseMacabre.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 72
const TOTAL_BEATS = BARS * 3 // 216, 3/4 throughout
// 12 beats @60 (12 s) + 204 beats @138 (~88.7 s): the structure-implied
// duration target is ~103 s, plus the 2 s timeline tail.
const TARGET_SEC = 103

const { tempo: tempoMap, meter } = tempoMapsFrom(danseMacabre.tempo)
const tl = buildTimelineFromScore(danseMacabre)

describe('danseMacabre score', () => {
  it('constructs without throwing (all barchecks parse clean)', async () => {
    // parseVoice runs at import time; a failed barcheck would throw on
    // import. Re-import to make the assertion explicit.
    await expect(import('../src/music/scores/danseMacabre.js')).resolves.toHaveProperty(
      'danseMacabre',
    )
    expect(danseMacabre.id).toBe('danseMacabre')
    expect(danseMacabre.title).toBe('Danse Macabre')
  })

  it('has 3 voices: lead, bass, bells', () => {
    expect(danseMacabre.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
    for (const v of [0, 1, 2]) {
      expect(danseMacabre.notes.filter((n) => n.voice === v).length).toBeGreaterThan(0)
    }
  })

  it('tolls midnight at 60 bpm, then waltzes at 138 from bar 5, in 3/4', () => {
    expect(danseMacabre.tempo.segments).toEqual([
      { beat: 0, bpm: 60 },
      { beat: 12, bpm: 138 },
    ])
    expect(danseMacabre.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 3 }])
  })

  it('spans exactly 72 bars / 216 beats with sane note fields', () => {
    let maxEnd = 0
    for (const n of danseMacabre.notes) {
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

  it('strikes midnight: 12 toll hits, one per beat of bars 1–4, at 1 s apart', () => {
    const tolls = danseMacabre.annotations.filter((a) => a.kind === 'hit' && a.label === 'toll')
    expect(tolls).toHaveLength(12)
    expect(tolls.map((t) => t.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    tolls.forEach((t, i) => {
      expect(t.strength).toBe(0.7)
      expect(t.time).toBeCloseTo(i, 9) // 60 bpm: one stroke per second
    })
  })

  it('tunes the fiddle: accent "tuning" at bar 5 and two "tritone" hits', () => {
    const tuning = danseMacabre.annotations.filter((a) => a.label === 'tuning')
    expect(tuning).toHaveLength(1)
    expect(tuning[0]!.kind).toBe('accent')
    expect(tuning[0]!.beat).toBe(12)

    const tritones = danseMacabre.annotations.filter((a) => a.label === 'tritone')
    expect(tritones).toHaveLength(2)
    for (const t of tritones) {
      expect(t.kind).toBe('hit')
      expect(t.strength).toBe(0.75)
    }
    expect(tritones.map((t) => t.beat)).toEqual([12, 24]) // bars 5 and 9
  })

  it('marks the waltz and bones entries', () => {
    const danse = danseMacabre.annotations.filter((a) => a.label === 'danse')
    expect(danse).toHaveLength(1)
    expect(danse[0]!.kind).toBe('accent')
    expect(danse[0]!.beat).toBe(36) // bar 13

    const bones = danseMacabre.annotations.filter((a) => a.label === 'bones')
    expect(bones).toHaveLength(1)
    expect(bones[0]!.kind).toBe('accent')
    expect(bones[0]!.beat).toBe(84) // bar 29
  })

  it('stamps phraseEnd every 8 waltz bars', () => {
    const phrases = danseMacabre.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases).toHaveLength(8)
    for (const p of phrases) {
      expect(p.label).toBe('phraseEnd')
      expect(p.strength).toBe(0.6)
    }
    // Bars 21,29,37,45,53,61,69,73 -> beats (bar-1)*3.
    expect(phrases.map((p) => p.beat)).toEqual([60, 84, 108, 132, 156, 180, 204, 216])
  })

  it('shrieks twice at the peak', () => {
    const shrieks = danseMacabre.annotations.filter((a) => a.label === 'shriek')
    expect(shrieks).toHaveLength(2)
    for (const s of shrieks) {
      expect(s.kind).toBe('hit')
      expect(s.strength).toBe(0.9)
    }
    expect(shrieks.map((s) => s.beat)).toEqual([183, 189]) // bars 62 and 64
  })

  it('has exactly one climax — "sabbath", damped to 0.9, at bar 64', () => {
    const climaxes = danseMacabre.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(0.9)
    expect(climaxes[0]!.label).toBe('sabbath')
    expect(climaxes[0]!.beat).toBe(189) // bar 64 beat 1
  })
})

describe('danseMacabre timeline', () => {
  it('builds and lands within ±15% of the ~103 s structural target', () => {
    expect(tl.duration).toBeGreaterThan(TARGET_SEC * 0.85)
    expect(tl.duration).toBeLessThan(TARGET_SEC * 1.15)
    // 12 + 204 * 60/138 + 2 s tail.
    expect(tl.duration).toBeCloseTo(102.6957, 3)
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of danseMacabre.notes) {
      expect(tempoMap.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempoMap.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('annotations are sorted by time', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
  })

  it('climaxOf finds the sabbath at 0.9', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(0.9)
    expect(c?.label).toBe('sabbath')
    expect(c?.time).toBeCloseTo(tempoMap.beatToSec(189), 9)
  })

  it('labelled annotations survive the merge', () => {
    expect(annotationsOfKind(tl, 'hit', 'toll')).toHaveLength(12)
    expect(annotationsOfKind(tl, 'hit', 'tritone')).toHaveLength(2)
    expect(annotationsOfKind(tl, 'hit', 'shriek')).toHaveLength(2)
    expect(annotationsOfKind(tl, 'phrase', 'phraseEnd')).toHaveLength(8)
  })
})
