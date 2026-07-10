import { describe, expect, it } from 'vitest'
import { dawnOfAllSaints } from '../src/music/scores/dawnOfAllSaints.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 20
const TOTAL_BEATS = BARS * 3 // 60, 3/4 throughout
const TARGET_SEC = 65
const DAYBREAK_BEAT = 48 // bar 17 beat 1
const FSHARP_PITCH_CLASS = 6

const { tempo: tempoMap, meter } = tempoMapsFrom(dawnOfAllSaints.tempo)
const tl = buildTimelineFromScore(dawnOfAllSaints)

describe('dawnOfAllSaints score', () => {
  it('constructs without throwing (all barchecks parse clean)', async () => {
    // parseVoice runs at import time; a failed barcheck would throw on
    // import. Re-import to make the assertion explicit.
    await expect(import('../src/music/scores/dawnOfAllSaints.js')).resolves.toHaveProperty(
      'dawnOfAllSaints',
    )
    expect(dawnOfAllSaints.id).toBe('dawnOfAllSaints')
    expect(dawnOfAllSaints.title).toBe('Dawn of All Saints')
  })

  it('has 3 voices: lead, bass, bells', () => {
    expect(dawnOfAllSaints.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
    for (const v of [0, 1, 2]) {
      expect(dawnOfAllSaints.notes.filter((n) => n.voice === v).length).toBeGreaterThan(0)
    }
  })

  it('slows 69 -> 54 bpm at bar 13, in 3/4', () => {
    expect(dawnOfAllSaints.tempo.segments).toEqual([
      { beat: 0, bpm: 69 },
      { beat: 36, bpm: 54 },
    ])
    expect(dawnOfAllSaints.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 3 }])
  })

  it('spans exactly 20 bars / 60 beats with sane note fields', () => {
    let maxEnd = 0
    for (const n of dawnOfAllSaints.notes) {
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

  it('crows three times, rising (bars 2, 6, 11)', () => {
    const crows = dawnOfAllSaints.annotations.filter((a) => a.label === 'cockcrow')
    expect(crows).toHaveLength(3)
    for (const c of crows) {
      expect(c.kind).toBe('hit')
      expect(c.strength).toBe(0.7)
    }
    expect(crows.map((c) => c.beat)).toEqual([3, 15, 30])
  })

  it('accents the dawn at bar 5 and stamps two phrase ends', () => {
    const dawn = dawnOfAllSaints.annotations.filter((a) => a.label === 'dawn')
    expect(dawn).toHaveLength(1)
    expect(dawn[0]!.kind).toBe('accent')
    expect(dawn[0]!.strength).toBe(0.6)
    expect(dawn[0]!.beat).toBe(12) // bar 5

    const phrases = dawnOfAllSaints.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases).toHaveLength(2)
    for (const p of phrases) expect(p.label).toBe('phraseEnd')
    expect(phrases.map((p) => p.beat)).toEqual([36, 60]) // bars 13 and 21
  })

  it('holds D minor until the daybreak, then resolves to D major', () => {
    // No F# anywhere before bar 17; the resolution lands it in the lead.
    const before = dawnOfAllSaints.notes.filter((n) => n.startBeat < DAYBREAK_BEAT)
    for (const n of before) expect(n.midi % 12).not.toBe(FSHARP_PITCH_CLASS)
    const after = dawnOfAllSaints.notes.filter(
      (n) => n.startBeat >= DAYBREAK_BEAT && n.midi % 12 === FSHARP_PITCH_CLASS,
    )
    expect(after.length).toBeGreaterThan(0)
  })

  it('has exactly one climax — "daybreak", 0.85, at the bar-17 resolution', () => {
    const climaxes = dawnOfAllSaints.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(0.85)
    expect(climaxes[0]!.label).toBe('daybreak')
    expect(climaxes[0]!.beat).toBe(DAYBREAK_BEAT)
  })

  it('rings the lastBell on the final tonic (bar 20)', () => {
    const last = dawnOfAllSaints.annotations.filter((a) => a.label === 'lastBell')
    expect(last).toHaveLength(1)
    expect(last[0]!.kind).toBe('hit')
    expect(last[0]!.strength).toBe(0.75)
    expect(last[0]!.beat).toBe(57) // bar 20 beat 1
    // The bells' high D6 lands on that instant.
    const d6 = dawnOfAllSaints.notes.find((n) => n.startBeat === 57 && n.midi === 86)
    expect(d6).toBeDefined()
  })
})

describe('dawnOfAllSaints timeline', () => {
  it('builds and lands within ±15% of the ~65 s target', () => {
    expect(tl.duration).toBeGreaterThan(TARGET_SEC * 0.85)
    expect(tl.duration).toBeLessThan(TARGET_SEC * 1.15)
    // 36 beats @69 + 24 beats @54, + 2 s tail.
    expect(tl.duration).toBeCloseTo(59.971, 3)
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of dawnOfAllSaints.notes) {
      expect(tempoMap.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempoMap.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('annotations are sorted by time', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
  })

  it('climaxOf finds the daybreak at 0.85', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(0.85)
    expect(c?.label).toBe('daybreak')
    expect(c?.time).toBeCloseTo(tempoMap.beatToSec(DAYBREAK_BEAT), 9)
  })

  it('labelled annotations survive the merge', () => {
    expect(annotationsOfKind(tl, 'hit', 'cockcrow')).toHaveLength(3)
    expect(annotationsOfKind(tl, 'hit', 'lastBell')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'accent', 'dawn')).toHaveLength(1)
  })
})
