import { describe, expect, it } from 'vitest'
import { blueDanube } from '../src/music/scores/blueDanube.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 64
const TOTAL_BEATS = BARS * 3 // 192, 3/4 throughout
const TARGET_SEC = 80
// 192 beats at 144 bpm (= 80 s) + the 2 s timeline tail.
const EXPECTED_DURATION = (TOTAL_BEATS * 60) / 144 + 2

const { tempo, meter } = tempoMapsFrom(blueDanube.tempo)
const tl = buildTimelineFromScore(blueDanube)

describe('blueDanube score sanity', () => {
  it('barchecks parse clean: construction does not throw and yields notes', () => {
    expect(() => buildTimelineFromScore(blueDanube)).not.toThrow()
    expect(blueDanube.notes.length).toBeGreaterThan(0)
    expect(blueDanube.id).toBe('blueDanube')
    expect(blueDanube.title).toBe('The Blue Danube')
  })

  it('has 3 voices: lead, bass, bells', () => {
    expect(blueDanube.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
  })

  it('runs at 144 bpm in 3/4 throughout', () => {
    expect(blueDanube.tempo.segments).toEqual([{ beat: 0, bpm: 144 }])
    expect(blueDanube.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 3 }])
  })

  it('note count snapshot: 300 total (78 lead / 180 bass / 42 bells)', () => {
    expect(blueDanube.notes.length).toBe(300)
    const byVoice = [0, 1, 2].map((v) => blueDanube.notes.filter((n) => n.voice === v).length)
    expect(byVoice).toEqual([78, 180, 42])
  })

  it('spans exactly 64 bars / 192 beats with sane note fields', () => {
    let maxEnd = 0
    for (const n of blueDanube.notes) {
      expect(n.startBeat).toBeGreaterThanOrEqual(0)
      expect(n.durBeats).toBeGreaterThan(0)
      expect(n.velocity).toBeGreaterThan(0)
      expect(n.velocity).toBeLessThanOrEqual(1)
      maxEnd = Math.max(maxEnd, n.startBeat + n.durBeats)
    }
    expect(maxEnd).toBe(TOTAL_BEATS)
    expect(meter.beatToBarBeat(TOTAL_BEATS)).toEqual({ bar: BARS + 1, beat: 1 })
  })

  it('the bass oom-pah-pahs: root then two upper fifths, bars 5–63', () => {
    // Bar 5 (beat 12): C2 oom, then two G2 pahs on beats 2 and 3.
    const bar5 = blueDanube.notes.filter(
      (n) => n.voice === 1 && n.startBeat >= 12 && n.startBeat < 15,
    )
    expect(bar5.map((n) => ({ startBeat: n.startBeat, midi: n.midi }))).toEqual([
      { startBeat: 12, midi: 36 }, // C2
      { startBeat: 13, midi: 43 }, // G2
      { startBeat: 14, midi: 43 },
    ])
    // Three bass notes in every oom-pah bar (bars 5–63).
    for (const bar of [5, 21, 37, 53, 63]) {
      const start = (bar - 1) * 3
      const inBar = blueDanube.notes.filter(
        (n) => n.voice === 1 && n.startBeat >= start && n.startBeat < start + 3,
      )
      expect(inBar).toHaveLength(3)
    }
  })

  it('stamps liftoff at bar 1 and four orbit accents at the section starts', () => {
    const liftoff = blueDanube.annotations.filter((a) => a.label === 'liftoff')
    expect(liftoff).toHaveLength(1)
    expect(liftoff[0]!.kind).toBe('accent')
    expect(liftoff[0]!.beat).toBe(0)
    const orbits = blueDanube.annotations.filter((a) => a.label === 'orbit')
    expect(orbits).toHaveLength(4)
    for (const o of orbits) expect(o.kind).toBe('accent')
    expect(orbits.map((a) => a.beat)).toEqual([12, 60, 108, 156]) // bars 5, 21, 37, 53
  })

  it('the famous echo notes land as eight twirl hits', () => {
    const twirls = blueDanube.annotations.filter((a) => a.label === 'twirl')
    expect(twirls).toHaveLength(8)
    for (const t of twirls) {
      expect(t.kind).toBe('hit')
      expect(t.strength).toBe(0.5)
    }
    // Bars 9, 11, 17, 19, 25, 27, 33, 35 — each has a bells echo pair on it.
    expect(twirls.map((a) => a.beat)).toEqual([24, 30, 48, 54, 72, 78, 96, 102])
    for (const t of twirls) {
      const echo = blueDanube.notes.filter((n) => n.voice === 2 && n.startBeat === t.beat)
      expect(echo).toHaveLength(1)
    }
  })

  it('phrase ends every 8 bars, all labeled phraseEnd', () => {
    const phrases = blueDanube.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases).toHaveLength(8)
    for (const p of phrases) expect(p.label).toBe('phraseEnd')
    // Bars 13, 21, 29, 37, 45, 53, 61 and the closing downbeat 65.
    expect(phrases.map((a) => a.beat)).toEqual([36, 60, 84, 108, 132, 156, 180, 192])
  })

  it('has exactly one climax, damped to 0.8, labeled waltzPeak at bar 56', () => {
    const climaxes = blueDanube.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(0.8)
    expect(climaxes[0]!.label).toBe('waltzPeak')
    expect(climaxes[0]!.beat).toBe(165) // bar 56 beat 1
  })

  it('score annotations are sorted by time', () => {
    for (let i = 1; i < blueDanube.annotations.length; i++) {
      expect(blueDanube.annotations[i]!.time).toBeGreaterThanOrEqual(
        blueDanube.annotations[i - 1]!.time,
      )
    }
  })
})

describe('blueDanube timeline', () => {
  it('builds and lands within ±15% of the ~80 s target', () => {
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.duration).toBeGreaterThan(TARGET_SEC * 0.85)
    expect(tl.duration).toBeLessThan(TARGET_SEC * 1.15)
    expect(tl.duration).toBeCloseTo(EXPECTED_DURATION, 6)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of blueDanube.notes) {
      expect(tempo.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempo.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('timeline annotations are sorted and the labelled marks survive the merge', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
    expect(annotationsOfKind(tl, 'hit', 'twirl')).toHaveLength(8)
    expect(annotationsOfKind(tl, 'accent', 'orbit')).toHaveLength(4)
    expect(annotationsOfKind(tl, 'phrase', 'phraseEnd')).toHaveLength(8)
  })

  it('climaxOf finds the waltzPeak near bar 56', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(0.8)
    expect(c?.label).toBe('waltzPeak')
    expect(c?.time).toBeCloseTo(tempo.beatToSec(165), 9)
  })
})
