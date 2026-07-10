import { describe, expect, it } from 'vitest'
import { parseVoice } from '../src/music/notation.js'
import { moonlightAdagio } from '../src/music/scores/moonlightAdagio.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 16
const BEATS_PER_BAR = 12 // 4/4 on a triplet grid — the DSL beat is a triplet eighth
const TOTAL_BEATS = BARS * BEATS_PER_BAR // 192
const SEC_PER_BEAT = 60 / 160
const MUSIC_END_SEC = TOTAL_BEATS * SEC_PER_BEAT // 72 s
const TARGET_SEC = 70
const barBeat = (bar: number): number => (bar - 1) * BEATS_PER_BAR

describe('moonlightAdagio score sanity', () => {
  it('barchecks parse clean: construction does not throw and yields notes', () => {
    expect(() => buildTimelineFromScore(moonlightAdagio)).not.toThrow()
    expect(moonlightAdagio.notes.length).toBeGreaterThan(0)
    expect(moonlightAdagio.id).toBe('moonlightAdagio')
    expect(moonlightAdagio.title).toBe('Moonlight Sonata — Adagio sostenuto')
  })

  it('has 3 voices: lead, bass, bells', () => {
    expect(moonlightAdagio.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
  })

  it('notates the 4/4 as 12 triplet-eighth beats per bar at 160', () => {
    expect(moonlightAdagio.tempo.segments).toEqual([{ beat: 0, bpm: 160 }])
    expect(moonlightAdagio.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 12 }])
    const { meter } = tempoMapsFrom(moonlightAdagio.tempo)
    expect(meter.beatsPerBarAt(1)).toBe(12)
    expect(meter.barBeatToBeat(2, 1)).toBe(12)
    expect(meter.barBeatToBeat(BARS + 1, 1)).toBe(TOTAL_BEATS)
  })

  it('the triplet grid is real: bars must sum to 12 units, the 2+1 figure fits', () => {
    const meters = moonlightAdagio.tempo.meters
    // The dotted figure as 2 + 1 triplet units after a 9-unit tone: exact fit.
    expect(() => parseVoice('E4/1. ~E4/2. E4/2 E4/4 |', 0, { meters })).not.toThrow()
    // One unit too many (13) fails the barcheck.
    expect(() => parseVoice('E4/1. ~E4/1. E4/4 |', 0, { meters })).toThrow(/barcheck/)
    // A plain 4/4 whole note (8 eighths) undershoots the triplet bar.
    expect(() => parseVoice('E4/1 ~E4/1 |', 0, { meters })).toThrow(/barcheck/)
  })

  it('spans exactly 16 bars by the meter map', () => {
    const { meter } = tempoMapsFrom(moonlightAdagio.tempo)
    const maxEnd = Math.max(...moonlightAdagio.notes.map((n) => n.startBeat + n.durBeats))
    expect(maxEnd).toBe(TOTAL_BEATS)
    expect(meter.beatToBarBeat(maxEnd)).toEqual({ bar: BARS + 1, beat: 1 })
  })

  it('note count snapshot: 242 total (30 lead / 31 bass / 181 bells)', () => {
    expect(moonlightAdagio.notes.length).toBe(242)
    const byVoice = [0, 1, 2].map((v) => moonlightAdagio.notes.filter((n) => n.voice === v).length)
    expect(byVoice).toEqual([30, 31, 181])
  })

  it('bells carry continuous triplet arpeggios: 12 one-unit notes per rolling bar', () => {
    const bells = moonlightAdagio.notes.filter((n) => n.voice === 2)
    // Bars 1–15 roll in single triplet units; bar 16 comes to rest on one held tone.
    expect(bells.filter((n) => n.durBeats === 1)).toHaveLength(15 * 12)
    expect(bells.filter((n) => n.durBeats === 12)).toHaveLength(1)
  })

  it('score annotations are sorted by time and all carry labels', () => {
    for (let i = 1; i < moonlightAdagio.annotations.length; i++) {
      expect(moonlightAdagio.annotations[i]!.time).toBeGreaterThanOrEqual(
        moonlightAdagio.annotations[i - 1]!.time,
      )
    }
    for (const a of moonlightAdagio.annotations) expect(a.label).toBeTruthy()
  })

  it('beats 8 heartbeats on the downbeats of the final 8 bars', () => {
    const hearts = moonlightAdagio.annotations.filter(
      (a) => a.kind === 'hit' && a.label === 'heartbeat',
    )
    expect(hearts).toHaveLength(8)
    for (const h of hearts) expect(h.strength).toBe(0.35)
    expect(hearts.map((h) => h.beat)).toEqual(
      [9, 10, 11, 12, 13, 14, 15, 16].map(barBeat),
    )
  })

  it('lastLight lands on the final chord', () => {
    const last = moonlightAdagio.annotations.filter(
      (a) => a.kind === 'hit' && a.label === 'lastLight',
    )
    expect(last).toHaveLength(1)
    expect(last[0]!.strength).toBe(0.6)
    expect(last[0]!.beat).toBe(barBeat(16)) // 180
    // All three voices hold that chord to the very end.
    const enders = moonlightAdagio.notes.filter(
      (n) => n.startBeat === barBeat(16) && n.startBeat + n.durBeats === TOTAL_BEATS,
    )
    expect(enders.map((n) => n.voice).sort()).toEqual([0, 1, 2])
  })

  it('has exactly one climax, damped to 0.5, at the exact midpoint', () => {
    const climaxes = moonlightAdagio.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(0.5)
    expect(climaxes[0]!.label).toBe('peak')
    expect(climaxes[0]!.beat).toBe(barBeat(9)) // 96 — half of 192
    expect(climaxes[0]!.time).toBeCloseTo(MUSIC_END_SEC / 2, 9)
    // Nothing in this score reaches strength 1.
    for (const a of moonlightAdagio.annotations) expect(a.strength).toBeLessThan(1)
  })
})

describe('moonlightAdagio timeline', () => {
  const tl = buildTimelineFromScore(moonlightAdagio)

  it('builds successfully as a score-sourced timeline', () => {
    expect(tl.source).toBe('score')
    expect(tl.id).toBe('moonlightAdagio')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.downbeats.length).toBeGreaterThan(0)
  })

  it('duration lands within ±15% of the ~70 s target (plus the 2 s tail)', () => {
    expect(tl.duration).toBeCloseTo(MUSIC_END_SEC + 2, 6) // 74 s
    expect(MUSIC_END_SEC).toBeGreaterThanOrEqual(TARGET_SEC * 0.85)
    expect(MUSIC_END_SEC).toBeLessThanOrEqual(TARGET_SEC * 1.15)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of moonlightAdagio.notes) {
      expect(n.startBeat * SEC_PER_BEAT).toBeGreaterThanOrEqual(0)
      expect((n.startBeat + n.durBeats) * SEC_PER_BEAT).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('the damped peak survives the merge; heartbeats and lastLight keep labels', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(0.5)
    expect(c?.label).toBe('peak')
    expect(annotationsOfKind(tl, 'hit', 'heartbeat')).toHaveLength(8)
    expect(annotationsOfKind(tl, 'hit', 'lastLight')).toHaveLength(1)
  })
})
