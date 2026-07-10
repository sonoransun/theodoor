import { describe, expect, it } from 'vitest'
import { mountainKing } from '../src/music/scores/mountainKing.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 48
const TOTAL_BEATS = BARS * 4 // 192, 4/4 throughout
const TARGET_SEC = 95
const PERC_VOICE = 3

const { tempo: tempoMap, meter } = tempoMapsFrom(mountainKing.tempo)
const tl = buildTimelineFromScore(mountainKing)

describe('mountainKing score', () => {
  it('constructs without throwing (all barchecks parse clean)', async () => {
    // parseVoice runs at import time; a failed barcheck would throw on
    // import. Re-import to make the assertion explicit.
    await expect(import('../src/music/scores/mountainKing.js')).resolves.toHaveProperty(
      'mountainKing',
    )
    expect(mountainKing.id).toBe('mountainKing')
    expect(mountainKing.title).toBe('In the Hall of the Mountain King')
  })

  it('has 4 voices: lead, brass, bass, perc', () => {
    expect(mountainKing.voices.map((v) => v.program)).toEqual(['lead', 'brass', 'bass', 'perc'])
    for (const v of [0, 1, 2, 3]) {
      expect(mountainKing.notes.filter((n) => n.voice === v).length).toBeGreaterThan(0)
    }
  })

  it('steps the accelerando 104/116/132/148/168 at bars 1/11/21/31/41', () => {
    expect(mountainKing.tempo.segments).toEqual([
      { beat: 0, bpm: 104 },
      { beat: 40, bpm: 116 },
      { beat: 80, bpm: 132 },
      { beat: 120, bpm: 148 },
      { beat: 160, bpm: 168 },
    ])
    expect(mountainKing.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 4 }])
  })

  it('spans exactly 48 bars / 192 beats with sane note fields', () => {
    let maxEnd = 0
    for (const n of mountainKing.notes) {
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

  it('ramps velocity 0.4 -> 1.0 across the statements', () => {
    const first = mountainKing.notes.filter((n) => n.startBeat < 32) // bars 1–8
    expect(first.length).toBeGreaterThan(0)
    for (const n of first) expect(n.velocity).toBe(0.4)
    const last = mountainKing.notes.filter((n) => n.startBeat >= 168) // bars 43–48
    expect(last.length).toBeGreaterThan(0)
    for (const n of last) expect(n.velocity).toBe(1)
  })

  it('accents all six statement starts, ramping with the chase', () => {
    const accents = mountainKing.annotations.filter((a) => a.kind === 'accent')
    expect(accents.map((a) => a.label)).toEqual([
      'creep',
      'stalk',
      'pursuit',
      'quarry',
      'frenzy',
      'rampage',
    ])
    expect(accents.map((a) => a.beat)).toEqual([0, 32, 64, 96, 128, 160])
    expect(accents.map((a) => a.strength)).toEqual([0.4, 0.5, 0.6, 0.7, 0.85, 0.95])
  })

  it('stamps phraseEnd at every 8-bar statement boundary', () => {
    const phrases = mountainKing.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases).toHaveLength(6)
    for (const p of phrases) {
      expect(p.label).toBe('phraseEnd')
      expect(p.strength).toBe(0.6)
    }
    expect(phrases.map((p) => p.beat)).toEqual([32, 64, 96, 128, 160, 192])
  })

  it('keeps the perc tacet until bar 21', () => {
    const perc = mountainKing.notes.filter((n) => n.voice === PERC_VOICE)
    expect(Math.min(...perc.map((n) => n.startBeat))).toBe(80) // bar 21 beat 1
  })

  it('hammers 8 accelerating stomps through the final 6 bars, plus one shriek', () => {
    const stomps = mountainKing.annotations.filter((a) => a.label === 'stomp')
    expect(stomps).toHaveLength(8)
    for (const s of stomps) {
      expect(s.kind).toBe('hit')
      expect(s.strength).toBe(0.9)
    }
    // Bars 43,44,45,46,46.5,47,47.5,48 — bar-wise, then half-bar-wise.
    expect(stomps.map((s) => s.beat)).toEqual([168, 172, 176, 180, 182, 184, 186, 188])

    const shrieks = mountainKing.annotations.filter((a) => a.label === 'shriek')
    expect(shrieks).toHaveLength(1)
    expect(shrieks[0]!.kind).toBe('hit')
    expect(shrieks[0]!.beat).toBe(176) // bar 45, where the lead leaps to D6
  })

  it('has exactly one climax — "summit", strength 1, on the closing chord', () => {
    const climaxes = mountainKing.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(1)
    expect(climaxes[0]!.label).toBe('summit')
    expect(climaxes[0]!.beat).toBe(188) // bar 48 beat 1
  })
})

describe('mountainKing timeline', () => {
  it('builds and lands within ±15% of the ~95 s target', () => {
    expect(tl.duration).toBeGreaterThan(TARGET_SEC * 0.85)
    expect(tl.duration).toBeLessThan(TARGET_SEC * 1.15)
    // 40-beat notches at 104/116/132/148 + 32 beats @168, + 2 s tail.
    expect(tl.duration).toBeCloseTo(91.5932, 3)
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of mountainKing.notes) {
      expect(tempoMap.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempoMap.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('annotations are sorted by time', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
  })

  it('climaxOf finds the strength-1 summit', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.label).toBe('summit')
    expect(c?.time).toBeCloseTo(tempoMap.beatToSec(188), 9)
  })

  it('labelled annotations survive the merge', () => {
    expect(annotationsOfKind(tl, 'hit', 'stomp')).toHaveLength(8)
    expect(annotationsOfKind(tl, 'hit', 'shriek')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'accent', 'rampage')).toHaveLength(1)
  })
})
