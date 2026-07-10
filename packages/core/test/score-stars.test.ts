import { describe, expect, it } from 'vitest'
import type { NoteEvent } from '../src/contracts.js'
import { starsAndStripesForever } from '../src/music/scores/starsAndStripesForever.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'

const BARS = 108
const TOTAL_BEATS = BARS * 4 // 432, 4/4 throughout
const SEC_PER_BEAT = 60 / 120

describe('starsAndStripesForever score sanity', () => {
  it('constructs cleanly (all barchecks passed at module load)', () => {
    // parseVoice runs at import time; a failed barcheck would have thrown
    // before this test executed. Re-touching the frozen result proves it.
    expect(starsAndStripesForever.id).toBe('starsAndStripesForever')
    expect(starsAndStripesForever.title).toBe('The Stars and Stripes Forever')
    expect(starsAndStripesForever.notes.length).toBeGreaterThan(0)
  })

  it('has 5 voices: lead, brass, bass, bells, perc', () => {
    expect(starsAndStripesForever.voices.map((v) => v.program)).toEqual([
      'lead', 'brass', 'bass', 'bells', 'perc',
    ])
  })

  it('runs at 120 bpm in 4/4', () => {
    expect(starsAndStripesForever.tempo.segments).toEqual([{ beat: 0, bpm: 120 }])
    expect(starsAndStripesForever.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 4 }])
  })

  it('note count snapshot: 1619 total (249 lead / 164 brass / 239 bass / 317 bells / 650 perc)', () => {
    // Update on purpose only — this pins the arrangement byte-for-byte.
    expect(starsAndStripesForever.notes.length).toBe(1619)
    const byVoice = [0, 1, 2, 3, 4].map(
      (v) => starsAndStripesForever.notes.filter((n) => n.voice === v).length,
    )
    expect(byVoice).toEqual([249, 164, 239, 317, 650])
  })

  it('spans exactly 108 bars and stays sorted with sane ranges', () => {
    let prev: NoteEvent | undefined
    for (const n of starsAndStripesForever.notes) {
      if (prev) expect(n.startBeat).toBeGreaterThanOrEqual(prev.startBeat)
      expect(n.startBeat).toBeGreaterThanOrEqual(0)
      expect(n.durBeats).toBeGreaterThan(0)
      expect(n.velocity).toBeGreaterThan(0)
      expect(n.velocity).toBeLessThanOrEqual(1)
      expect(n.midi).toBeGreaterThanOrEqual(12)
      expect(n.midi).toBeLessThanOrEqual(127)
      prev = n
    }
    const maxEnd = Math.max(
      ...starsAndStripesForever.notes.map((n) => n.startBeat + n.durBeats),
    )
    expect(maxEnd).toBe(TOTAL_BEATS)
  })

  it('labels every phrase annotation phraseEnd, one per 8-bar phrase', () => {
    const phrases = starsAndStripesForever.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases.length).toBe(13)
    for (const p of phrases) {
      expect(p.label).toBe('phraseEnd')
      expect(p.strength).toBe(0.7)
    }
    // Bars 13,21,29,37,45,53,61,69,77,85,93,101,109 -> beats (bar-1)*4.
    expect(phrases.map((p) => p.beat)).toEqual([
      48, 80, 112, 144, 176, 208, 240, 272, 304, 336, 368, 400, 432,
    ])
  })

  it('accents each strain start at strength 0.9', () => {
    const accents = starsAndStripesForever.annotations.filter((a) => a.kind === 'accent')
    expect(accents.map((a) => a.label)).toEqual([
      'firstStrain', 'secondStrain', 'trio', 'breakstrain', 'grandioso',
    ])
    expect(accents.map((a) => a.beat)).toEqual([16, 80, 144, 272, 304])
    for (const a of accents) expect(a.strength).toBe(0.9)
  })

  it('has exactly one climax, strength 1, at the grandioso (bar 77)', () => {
    const climaxes = starsAndStripesForever.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(1)
    expect(climaxes[0]!.label).toBe('grandioso')
    expect(climaxes[0]!.beat).toBe(304) // bar 77 beat 1
    expect(climaxes[0]!.time).toBe(152)
  })

  it('puts the stinger hit on the final chord (bar 108)', () => {
    const hits = starsAndStripesForever.annotations.filter((a) => a.kind === 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.strength).toBe(1)
    expect(hits[0]!.label).toBe('stinger')
    expect(hits[0]!.beat).toBe(428) // bar 108 beat 1
  })
})

describe('starsAndStripesForever timeline', () => {
  const tl = buildTimelineFromScore(starsAndStripesForever)

  it('builds successfully as a score-sourced timeline', () => {
    expect(tl.source).toBe('score')
    expect(tl.id).toBe('starsAndStripesForever')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.score).toBe(starsAndStripesForever)
  })

  it('duration lands in the 3.2-3.6 min target range (plus the 2 s tail)', () => {
    expect(tl.duration).toBeCloseTo(218) // 432 beats @ 120 bpm = 216 s, + 2
    expect(tl.duration).toBeGreaterThanOrEqual(3.2 * 60)
    expect(tl.duration).toBeLessThanOrEqual(3.6 * 60 + 2 + 1e-9)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of starsAndStripesForever.notes) {
      const startSec = n.startBeat * SEC_PER_BEAT
      const endSec = (n.startBeat + n.durBeats) * SEC_PER_BEAT
      expect(startSec).toBeGreaterThanOrEqual(0)
      expect(endSec).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('annotations are sorted by time', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
  })

  it('climaxOf finds the single strength-1 climax at 152 s', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.time).toBe(152)
    expect(c?.label).toBe('grandioso')
  })

  it('the grandioso is the loudest stretch and the trio the softest', () => {
    const mean = (t0: number, t1: number): number => {
      const pts = tl.energy.filter((p) => p.time >= t0 && p.time < t1)
      return pts.reduce((s, p) => s + p.rms, 0) / pts.length
    }
    const trio = mean(72, 136) // bars 37-68
    const grandioso = mean(152, 214) // bars 77-107
    expect(grandioso).toBeGreaterThan(trio)
    expect(grandioso).toBeGreaterThan(mean(0, 8)) // intro
  })

  it('phrase annotations survive the merge with phraseEnd labels intact', () => {
    const phrases = annotationsOfKind(tl, 'phrase')
    expect(phrases.length).toBe(13)
    for (const p of phrases) expect(p.label).toBe('phraseEnd')
  })
})
