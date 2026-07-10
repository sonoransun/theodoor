import { describe, expect, it } from 'vitest'
import { gymnopedie1 } from '../src/music/scores/gymnopedie1.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 32
const TOTAL_BEATS = BARS * 3 // 96, 3/4 throughout
const SEC_PER_BEAT = 60 / 66
const MUSIC_END_SEC = TOTAL_BEATS * SEC_PER_BEAT // ~87.27 s
const TARGET_SEC = 85

describe('gymnopedie1 score sanity', () => {
  it('barchecks parse clean: construction does not throw and yields notes', () => {
    expect(() => buildTimelineFromScore(gymnopedie1)).not.toThrow()
    expect(gymnopedie1.notes.length).toBeGreaterThan(0)
    expect(gymnopedie1.id).toBe('gymnopedie1')
    expect(gymnopedie1.title).toBe('Gymnopédie No. 1')
  })

  it('has 3 voices: lead, bass, bells', () => {
    expect(gymnopedie1.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
  })

  it('runs at 66 bpm in 3/4 with no pickup', () => {
    expect(gymnopedie1.tempo.segments).toEqual([{ beat: 0, bpm: 66 }])
    expect(gymnopedie1.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 3 }])
    expect(gymnopedie1.tempo.pickupBeats).toBeUndefined()
  })

  it('spans exactly 32 bars by the meter map', () => {
    const { meter } = tempoMapsFrom(gymnopedie1.tempo)
    expect(meter.beatsPerBarAt(1)).toBe(3)
    expect(meter.barBeatToBeat(BARS + 1, 1)).toBe(TOTAL_BEATS)
    const maxEnd = Math.max(...gymnopedie1.notes.map((n) => n.startBeat + n.durBeats))
    expect(maxEnd).toBe(TOTAL_BEATS)
    expect(meter.beatToBarBeat(maxEnd)).toEqual({ bar: BARS + 1, beat: 1 })
  })

  it('note count snapshot: 123 total (52 lead / 61 bass / 10 bells)', () => {
    expect(gymnopedie1.notes.length).toBe(123)
    const byVoice = [0, 1, 2].map((v) => gymnopedie1.notes.filter((n) => n.voice === v).length)
    expect(byVoice).toEqual([52, 61, 10])
  })

  it('score annotations are sorted by time and all carry labels', () => {
    for (let i = 1; i < gymnopedie1.annotations.length; i++) {
      expect(gymnopedie1.annotations[i]!.time).toBeGreaterThanOrEqual(
        gymnopedie1.annotations[i - 1]!.time,
      )
    }
    for (const a of gymnopedie1.annotations) expect(a.label).toBeTruthy()
  })

  it('stamps the firstStar accent on bar 1 beat 1', () => {
    const accents = gymnopedie1.annotations.filter((a) => a.kind === 'accent')
    expect(accents).toHaveLength(1)
    expect(accents[0]!.label).toBe('firstStar')
    expect(accents[0]!.strength).toBe(0.5)
    expect(accents[0]!.beat).toBe(0)
    expect(accents[0]!.time).toBe(0)
  })

  it('breathes 6 times at the phrase exhale points (bars 8/12/16/20/24/28)', () => {
    const breaths = gymnopedie1.annotations.filter((a) => a.kind === 'hit')
    expect(breaths).toHaveLength(6)
    for (const b of breaths) {
      expect(b.label).toBe('breath')
      expect(b.strength).toBe(0.3)
    }
    expect(breaths.map((b) => b.beat)).toEqual([21, 33, 45, 57, 69, 81])
  })

  it('marks phrase ends every 8 bars', () => {
    const phrases = gymnopedie1.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases).toHaveLength(4)
    for (const p of phrases) expect(p.label).toBe('phraseEnd')
    expect(phrases.map((p) => p.beat)).toEqual([24, 48, 72, 96]) // bars 9, 17, 25, 33
  })

  it('has exactly one climax at 0.6 — the strength-1 climax lives in clairDeLune', () => {
    const climaxes = gymnopedie1.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(0.6)
    expect(climaxes[0]!.label).toBe('lift')
    expect(climaxes[0]!.beat).toBe(60) // bar 21 beat 1
    expect(climaxes[0]!.time).toBeCloseTo(60 * SEC_PER_BEAT, 9)
    // Nothing in this score reaches strength 1.
    for (const a of gymnopedie1.annotations) expect(a.strength).toBeLessThan(1)
  })
})

describe('gymnopedie1 timeline', () => {
  const tl = buildTimelineFromScore(gymnopedie1)

  it('builds successfully as a score-sourced timeline', () => {
    expect(tl.source).toBe('score')
    expect(tl.id).toBe('gymnopedie1')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.beats.length).toBeGreaterThan(0)
    expect(tl.downbeats.length).toBeGreaterThan(0)
  })

  it('duration lands within ±15% of the ~85 s target (plus the 2 s tail)', () => {
    expect(tl.duration).toBeCloseTo(MUSIC_END_SEC + 2, 6)
    expect(MUSIC_END_SEC).toBeGreaterThanOrEqual(TARGET_SEC * 0.85)
    expect(MUSIC_END_SEC).toBeLessThanOrEqual(TARGET_SEC * 1.15)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of gymnopedie1.notes) {
      expect(n.startBeat * SEC_PER_BEAT).toBeGreaterThanOrEqual(0)
      expect((n.startBeat + n.durBeats) * SEC_PER_BEAT).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('the damped lift survives the merge; the breaths keep their label', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(0.6)
    expect(c?.label).toBe('lift')
    expect(annotationsOfKind(tl, 'hit', 'breath')).toHaveLength(6)
    expect(annotationsOfKind(tl, 'phrase', 'phraseEnd')).toHaveLength(4)
  })
})
