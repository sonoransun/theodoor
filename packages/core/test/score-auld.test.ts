import { describe, expect, it } from 'vitest'
import { parseVoice } from '../src/music/notation.js'
import { auldLangSyne } from '../src/music/scores/auldLangSyne.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 32
const PICKUP = 1
const TOTAL_BEATS = PICKUP + BARS * 4 // 129 — beat 0 is the anacrusis
// 121 beats at 72 bpm, then the 8-beat ritardando at 58 bpm.
const MUSIC_END_SEC = (121 * 60) / 72 + (8 * 60) / 58 // ~109.109 s

describe('auldLangSyne score sanity', () => {
  it('barchecks parse clean: construction does not throw and yields notes', () => {
    expect(() => buildTimelineFromScore(auldLangSyne)).not.toThrow()
    expect(auldLangSyne.notes.length).toBeGreaterThan(0)
    expect(auldLangSyne.id).toBe('auldLangSyne')
    expect(auldLangSyne.title).toBe('Auld Lang Syne')
  })

  it('has 3 voices: lead, bass, bells', () => {
    expect(auldLangSyne.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
  })

  it('runs at 72 bpm in 4/4 with a one-beat pickup and a 58 bpm ritardando', () => {
    expect(auldLangSyne.tempo.pickupBeats).toBe(1)
    expect(auldLangSyne.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 4 }])
    // Ritardando covers the final 2 bars: bar 31 beat 1 = absolute beat 121.
    expect(auldLangSyne.tempo.segments).toEqual([
      { beat: 0, bpm: 72 },
      { beat: 121, bpm: 58 },
    ])
  })

  it('the pickup is real: barchecks fail without pickupBeats and pass with it', () => {
    const probe = 'G3/4 | C4/4 C4 C4 C4 |'
    expect(() => parseVoice(probe, 0, { meters: auldLangSyne.tempo.meters })).toThrow(/barcheck/)
    expect(() =>
      parseVoice(probe, 0, { meters: auldLangSyne.tempo.meters, pickupBeats: 1 }),
    ).not.toThrow()
    // The lead anacrusis occupies bar 0: exactly one note before beat 1.
    const lead = auldLangSyne.notes.filter((n) => n.voice === 0)
    expect(lead[0]!.startBeat).toBe(0)
    expect(lead[0]!.durBeats).toBe(1)
    expect(lead.filter((n) => n.startBeat < 1)).toHaveLength(1)
    // Bass rests through the pickup; bells are tacet until verse 2 (bar 17).
    const bassFirst = auldLangSyne.notes.find((n) => n.voice === 1)!
    expect(bassFirst.startBeat).toBe(1)
    const bellsFirst = auldLangSyne.notes.find((n) => n.voice === 2)!
    expect(bellsFirst.startBeat).toBe(PICKUP + 16 * 4) // bar 17 beat 1
  })

  it('note count snapshot: 210 total (112 lead / 63 bass / 35 bells)', () => {
    expect(auldLangSyne.notes.length).toBe(210)
    const byVoice = [0, 1, 2].map((v) => auldLangSyne.notes.filter((n) => n.voice === v).length)
    expect(byVoice).toEqual([112, 63, 35])
  })

  it('bar arithmetic is clean: 32 bars + pickup, voices monophonic', () => {
    for (let v = 0; v < 3; v++) {
      const voiceNotes = auldLangSyne.notes
        .filter((n) => n.voice === v)
        .sort((a, b) => a.startBeat - b.startBeat)
      let lastEnd = 0
      for (const n of voiceNotes) {
        expect(n.startBeat).toBeGreaterThanOrEqual(0)
        expect(n.startBeat).toBeGreaterThanOrEqual(lastEnd - 1e-9)
        lastEnd = n.startBeat + n.durBeats
        expect(lastEnd).toBeLessThanOrEqual(TOTAL_BEATS + 1e-9)
      }
    }
    // All three voices hold the final chord through the very last beat.
    const enders = auldLangSyne.notes.filter(
      (n) => Math.abs(n.startBeat + n.durBeats - TOTAL_BEATS) < 1e-9,
    )
    expect(enders.map((n) => n.voice).sort()).toEqual([0, 1, 2])
  })

  it('score annotations are sorted by time', () => {
    for (let i = 1; i < auldLangSyne.annotations.length; i++) {
      expect(auldLangSyne.annotations[i]!.time).toBeGreaterThanOrEqual(
        auldLangSyne.annotations[i - 1]!.time,
      )
    }
  })

  it('every phrase annotation is labeled phraseEnd, every 8 bars', () => {
    const phrases = auldLangSyne.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases.length).toBe(4)
    for (const p of phrases) expect(p.label).toBe('phraseEnd')
    // Bars 9, 17, 25, 33 with the one-beat pickup offset.
    expect(phrases.map((a) => a.beat)).toEqual([33, 65, 97, 129])
  })

  it('has exactly one climax, strength 1, at the final chorus (bar 25)', () => {
    const climaxes = auldLangSyne.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(1)
    expect(climaxes[0]!.label).toBe('finalChorus')
    expect(climaxes[0]!.beat).toBe(97) // bar 25 beat 1
    expect(climaxes[0]!.time).toBeCloseTo((97 * 60) / 72, 9)
  })

  it('accents mark each verse/chorus start and a hit marks the last note', () => {
    const accents = auldLangSyne.annotations.filter((a) => a.kind === 'accent')
    expect(accents.map((a) => a.label)).toEqual(['verse1', 'chorus1', 'verse2', 'finalChorus'])
    expect(accents.map((a) => a.beat)).toEqual([1, 33, 65, 97]) // bars 1, 9, 17, 25
    const hits = auldLangSyne.annotations.filter((a) => a.kind === 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.label).toBe('lastNote')
    expect(hits[0]!.strength).toBe(0.8)
    expect(hits[0]!.beat).toBe(125) // bar 32 beat 1 — the final chord's start
  })
})

describe('auldLangSyne timeline', () => {
  const tl = buildTimelineFromScore(auldLangSyne)
  const { tempo } = tempoMapsFrom(auldLangSyne.tempo)

  it('buildTimelineFromScore succeeds with the expected shape', () => {
    expect(tl.source).toBe('score')
    expect(tl.id).toBe('auldLangSyne')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.beats.length).toBeGreaterThan(0)
    expect(tl.downbeats.length).toBeGreaterThan(0)
  })

  it('duration is in the expected range (~109 s of music + 2 s tail)', () => {
    expect(tl.duration).toBeCloseTo(MUSIC_END_SEC + 2, 6)
    expect(tl.duration).toBeGreaterThan(105)
    expect(tl.duration).toBeLessThan(115)
    // The music itself lands inside the ~90–110 s target.
    const musicEnd = tempo.beatToSec(TOTAL_BEATS)
    expect(musicEnd).toBeGreaterThan(90)
    expect(musicEnd).toBeLessThanOrEqual(110)
  })

  it('the ritardando stretches the final bars', () => {
    // Bar 31 (58 bpm) takes longer than bar 30 (72 bpm).
    const barSec = (bar: number): number =>
      tempo.beatToSec(PICKUP + bar * 4) - tempo.beatToSec(PICKUP + (bar - 1) * 4)
    expect(barSec(30)).toBeCloseTo(60 / 72 * 4, 9)
    expect(barSec(31)).toBeCloseTo(60 / 58 * 4, 9)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of auldLangSyne.notes) {
      expect(tempo.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempo.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('timeline annotations are sorted and the climax resolves', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.label).toBe('finalChorus')
    const phrases = annotationsOfKind(tl, 'phrase', 'phraseEnd')
    expect(phrases).toHaveLength(4)
  })

  it('energy is fullest in the final chorus', () => {
    const mean = (t0: number, t1: number): number => {
      const pts = tl.energy.filter((p) => p.time >= t0 && p.time < t1)
      return pts.reduce((s, p) => s + p.rms, 0) / pts.length
    }
    const chorusStart = tempo.beatToSec(97)
    expect(mean(chorusStart, MUSIC_END_SEC)).toBeGreaterThan(mean(0, chorusStart / 3))
  })
})
