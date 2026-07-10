import { describe, expect, it } from 'vitest'
import { parseVoice } from '../src/music/notation.js'
import { clairDeLune } from '../src/music/scores/clairDeLune.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 32
const BEATS_PER_BAR = 9 // 9/8 — the DSL beat is an eighth note
const TOTAL_BEATS = BARS * BEATS_PER_BAR // 288
// Rubato segments: 8 bars each at 116 / 180 / 216 / 152 per eighth.
const MUSIC_END_SEC = (72 * 60) / 116 + (72 * 60) / 180 + (72 * 60) / 216 + (72 * 60) / 152
const TARGET_SEC = 100
const barBeat = (bar: number): number => (bar - 1) * BEATS_PER_BAR

describe('clairDeLune score sanity', () => {
  it('barchecks parse clean: construction does not throw and yields notes', () => {
    expect(() => buildTimelineFromScore(clairDeLune)).not.toThrow()
    expect(clairDeLune.notes.length).toBeGreaterThan(0)
    expect(clairDeLune.id).toBe('clairDeLune')
    expect(clairDeLune.title).toBe('Clair de Lune')
  })

  it('has 3 voices: lead, bass, bells', () => {
    expect(clairDeLune.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
  })

  it('notates the 9/8 as 9 eighth-note beats per bar', () => {
    expect(clairDeLune.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 9 }])
    const { meter } = tempoMapsFrom(clairDeLune.tempo)
    expect(meter.beatsPerBarAt(1)).toBe(9)
    expect(meter.beatsPerBarAt(BARS)).toBe(9)
    expect(meter.barBeatToBeat(2, 1)).toBe(9)
    expect(meter.barBeatToBeat(BARS + 1, 1)).toBe(TOTAL_BEATS)
  })

  it('compound-meter barchecks are real: a 9/8 bar must sum to 9 eighths', () => {
    const meters = clairDeLune.tempo.meters
    // Two dotted halves = 12 eighths — overshoots the bar.
    expect(() => parseVoice('C4/1. C4/1. |', 0, { meters })).toThrow(/barcheck/)
    // 4 + 4 = 8 eighths — undershoots.
    expect(() => parseVoice('C4/1 C4/1 |', 0, { meters })).toThrow(/barcheck/)
    // Three dotted quarters fill the compound bar exactly.
    expect(() => parseVoice('C4/2. C4/2. C4/2. |', 0, { meters })).not.toThrow()
  })

  it('rubato is segmented: opening 116 per eighth, mosso, animando, calmato', () => {
    expect(clairDeLune.tempo.segments).toEqual([
      { beat: 0, bpm: 116 },
      { beat: 72, bpm: 180 },
      { beat: 144, bpm: 216 },
      { beat: 216, bpm: 152 },
    ])
  })

  it('spans exactly 32 bars by the meter map', () => {
    const { meter } = tempoMapsFrom(clairDeLune.tempo)
    const maxEnd = Math.max(...clairDeLune.notes.map((n) => n.startBeat + n.durBeats))
    expect(maxEnd).toBe(TOTAL_BEATS)
    expect(meter.beatToBarBeat(maxEnd)).toEqual({ bar: BARS + 1, beat: 1 })
  })

  it('note count snapshot: 236 total (77 lead / 61 bass / 98 bells)', () => {
    expect(clairDeLune.notes.length).toBe(236)
    const byVoice = [0, 1, 2].map((v) => clairDeLune.notes.filter((n) => n.voice === v).length)
    expect(byVoice).toEqual([77, 61, 98])
  })

  it('score annotations are sorted by time and all carry labels', () => {
    for (let i = 1; i < clairDeLune.annotations.length; i++) {
      expect(clairDeLune.annotations[i]!.time).toBeGreaterThanOrEqual(
        clairDeLune.annotations[i - 1]!.time,
      )
    }
    for (const a of clairDeLune.annotations) expect(a.label).toBeTruthy()
  })

  it('accents: moonrise opens the piece, hush marks the return', () => {
    const accents = clairDeLune.annotations.filter((a) => a.kind === 'accent')
    expect(accents.map((a) => a.label)).toEqual(['moonrise', 'hush'])
    expect(accents.map((a) => a.beat)).toEqual([0, barBeat(25)])
    expect(accents.map((a) => a.strength)).toEqual([0.5, 0.4])
  })

  it('shimmers 8 times across the arpeggio peak (bars 17–24)', () => {
    const shimmers = clairDeLune.annotations.filter((a) => a.kind === 'hit')
    expect(shimmers).toHaveLength(8)
    for (const s of shimmers) {
      expect(s.label).toBe('shimmer')
      expect(s.strength).toBe(0.4)
    }
    expect(shimmers.map((s) => s.beat)).toEqual(
      [17, 18, 19, 20, 21, 22, 23, 24].map(barBeat),
    )
  })

  it('marks phrase ends every 8 bars', () => {
    const phrases = clairDeLune.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases).toHaveLength(4)
    for (const p of phrases) expect(p.label).toBe('phraseEnd')
    expect(phrases.map((p) => p.beat)).toEqual([9, 17, 25, 33].map(barBeat))
  })

  it('carries the suite\'s single strength-1 climax: zenith at bar 21', () => {
    const climaxes = clairDeLune.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(1)
    expect(climaxes[0]!.label).toBe('zenith')
    expect(climaxes[0]!.beat).toBe(barBeat(21)) // 180
    // 8 bars @116 + 8 bars @180 + 4 bars @216.
    expect(climaxes[0]!.time).toBeCloseTo((72 * 60) / 116 + 24 + 10, 9)
  })
})

describe('clairDeLune timeline', () => {
  const tl = buildTimelineFromScore(clairDeLune)
  const { tempo } = tempoMapsFrom(clairDeLune.tempo)

  it('builds successfully as a score-sourced timeline', () => {
    expect(tl.source).toBe('score')
    expect(tl.id).toBe('clairDeLune')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.downbeats.length).toBeGreaterThan(0)
  })

  it('duration lands within ±15% of the ~100 s target (plus the 2 s tail)', () => {
    expect(tempo.beatToSec(TOTAL_BEATS)).toBeCloseTo(MUSIC_END_SEC, 6) // ~109.66 s
    expect(tl.duration).toBeCloseTo(MUSIC_END_SEC + 2, 6)
    expect(MUSIC_END_SEC).toBeGreaterThanOrEqual(TARGET_SEC * 0.85)
    expect(MUSIC_END_SEC).toBeLessThanOrEqual(TARGET_SEC * 1.15)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of clairDeLune.notes) {
      expect(tempo.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempo.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('the zenith survives the merge and the shimmers keep their label', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.label).toBe('zenith')
    expect(annotationsOfKind(tl, 'hit', 'shimmer')).toHaveLength(8)
    expect(annotationsOfKind(tl, 'phrase', 'phraseEnd')).toHaveLength(4)
  })

  it('the arpeggio peak is fuller than the hushed opening', () => {
    const mean = (t0: number, t1: number): number => {
      const pts = tl.energy.filter((p) => p.time >= t0 && p.time < t1)
      return pts.reduce((s, p) => s + p.rms, 0) / pts.length
    }
    const peakStart = tempo.beatToSec(144)
    const peakEnd = tempo.beatToSec(216)
    expect(mean(peakStart, peakEnd)).toBeGreaterThan(mean(0, tempo.beatToSec(72)))
  })
})
