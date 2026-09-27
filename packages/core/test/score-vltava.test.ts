import { describe, expect, it } from 'vitest'
import { vltava } from '../src/music/scores/vltava.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 152
/** 64 bars of 3 + 24 of 2 + 12 of 4 + 40 of 3 + 12 of 4. */
const TOTAL_BEATS = 64 * 3 + 24 * 2 + 12 * 4 + 40 * 3 + 12 * 4 // 456
const TARGET_SEC = 278
/** Per-section beats over their bpm, plus the 2 s timeline tail. */
const EXPECTED_DURATION =
  (192 * 60) / 116 + (48 * 60) / 104 + (48 * 60) / 66 + (72 * 60) / 128 + (48 * 60) / 120 + (48 * 60) / 60 + 2

const { tempo, meter } = tempoMapsFrom(vltava.tempo)
const tl = buildTimelineFromScore(vltava)

const LEAD = 0
const BRASS = 1
const BASS = 2
const BELLS = 3
const PERC = 4

const G4 = 67
const G_SHARP_4 = 68
const G5 = 79
const G_SHARP_5 = 80

describe('vltava score sanity', () => {
  it('barchecks parse clean: construction does not throw and yields notes', () => {
    expect(() => buildTimelineFromScore(vltava)).not.toThrow()
    expect(vltava.notes.length).toBeGreaterThan(0)
    expect(vltava.id).toBe('vltava')
    expect(vltava.title).toBe('Vltava')
  })

  it('has 5 voices: lead, brass, bass, bells, perc', () => {
    expect(vltava.voices.map((v) => v.program)).toEqual(['lead', 'brass', 'bass', 'bells', 'perc'])
  })

  it('changes meter 3 → 2 → 4 → 3 → 4 at the section boundaries', () => {
    expect(vltava.tempo.meters).toEqual([
      { bar: 1, beatsPerBar: 3 },
      { bar: 65, beatsPerBar: 2 },
      { bar: 89, beatsPerBar: 4 },
      { bar: 101, beatsPerBar: 3 },
      { bar: 141, beatsPerBar: 4 },
    ])
    expect(vltava.tempo.pickupBeats).toBeUndefined()
  })

  it('changes tempo with every section, each segment on a section downbeat', () => {
    expect(vltava.tempo.segments).toEqual([
      { beat: 0, bpm: 116 },
      { beat: 192, bpm: 104 },
      { beat: 240, bpm: 66 },
      { beat: 288, bpm: 128 },
      { beat: 360, bpm: 120 },
      { beat: 408, bpm: 60 },
    ])
    for (const seg of vltava.tempo.segments) {
      expect(meter.beatToBarBeat(seg.beat).beat).toBe(1)
    }
    expect(meter.barBeatToBeat(65, 1)).toBe(192)
    expect(meter.barBeatToBeat(89, 1)).toBe(240)
    expect(meter.barBeatToBeat(101, 1)).toBe(288)
    expect(meter.barBeatToBeat(125, 1)).toBe(360)
    expect(meter.barBeatToBeat(141, 1)).toBe(408)
  })

  it('note count snapshot: 2033 total (556 lead / 207 brass / 447 bass / 527 bells / 296 perc)', () => {
    expect(vltava.notes.length).toBe(2033)
    const byVoice = [LEAD, BRASS, BASS, BELLS, PERC].map(
      (v) => vltava.notes.filter((n) => n.voice === v).length,
    )
    expect(byVoice).toEqual([556, 207, 447, 527, 296])
  })

  it('spans exactly 152 bars / 456 beats with sane note fields', () => {
    let maxEnd = 0
    for (const n of vltava.notes) {
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

  it('every voice is monophonic (no overlapping notes within a voice)', () => {
    for (const v of [LEAD, BRASS, BASS, BELLS, PERC]) {
      const voiceNotes = vltava.notes
        .filter((n) => n.voice === v)
        .sort((a, b) => a.startBeat - b.startBeat)
      let lastEnd = 0
      for (const n of voiceNotes) {
        expect(n.startBeat).toBeGreaterThanOrEqual(lastEnd - 1e-9)
        lastEnd = n.startBeat + n.durBeats
      }
    }
  })

  it('the river theme opens with the ascending head motif E F# G A B right on the river accent', () => {
    const river = vltava.annotations.filter((a) => a.label === 'river')
    expect(river).toHaveLength(2)
    for (const r of river) expect(r.kind).toBe('accent')
    expect(river.map((a) => a.beat)).toEqual([48, 96]) // bars 17 and 33
    for (const r of river) {
      const lead = vltava.notes
        .filter((n) => n.voice === LEAD && n.startBeat >= r.beat! && n.startBeat < r.beat! + 3)
        .sort((a, b) => a.startBeat - b.startBeat)
      // E4 F#4 G4 A4 (eighths) then B4 (quarter) — the famous rise.
      expect(lead.map((n) => n.midi)).toEqual([64, 66, 67, 69, 71])
      expect(lead.map((n) => n.startBeat - r.beat!)).toEqual([0, 0.5, 1, 1.5, 2])
    }
    // Statement 2 is the fuller one: the brass doubles the theme an octave down.
    const brassAt33 = vltava.notes.filter(
      (n) => n.voice === BRASS && n.startBeat >= 96 && n.startBeat < 99,
    )
    expect(brassAt33.map((n) => n.midi)).toEqual([52, 54, 55, 57, 59])
    const brassAt17 = vltava.notes.filter(
      (n) => n.voice === BRASS && n.startBeat >= 48 && n.startBeat < 96,
    )
    expect(brassAt17).toHaveLength(0)
  })

  it('the two springs: cold bells from bar 1, warm lead from bar 5', () => {
    const springs = vltava.annotations.filter((a) => a.label === 'spring')
    expect(springs).toHaveLength(2)
    for (const s of springs) expect(s.kind).toBe('hit')
    expect(springs.map((a) => a.beat)).toEqual([0, 12])
    // Bells ripple in sixteenths from beat 0; the lead is silent until bar 5.
    const bellsBar1 = vltava.notes.filter((n) => n.voice === BELLS && n.startBeat < 3)
    expect(bellsBar1).toHaveLength(12)
    for (const n of bellsBar1) expect(n.durBeats).toBe(0.25)
    expect(vltava.notes.filter((n) => n.voice === LEAD && n.startBeat < 12)).toHaveLength(0)
    expect(vltava.notes.filter((n) => n.voice === LEAD && n.startBeat >= 12 && n.startBeat < 15)).toHaveLength(6)
  })

  it('the hunt: four horn hits on brass fanfare downbeats', () => {
    expect(vltava.annotations.filter((a) => a.label === 'hunt').map((a) => a.beat)).toEqual([144])
    const horns = vltava.annotations.filter((a) => a.label === 'horn')
    expect(horns).toHaveLength(4)
    for (const h of horns) expect(h.kind).toBe('hit')
    expect(horns.map((a) => a.beat)).toEqual([144, 156, 168, 180]) // bars 49, 53, 57, 61
    for (const h of horns) {
      const brass = vltava.notes.filter((n) => n.voice === BRASS && n.startBeat === h.beat)
      expect(brass).toHaveLength(1)
      const cymbal = vltava.notes.filter((n) => n.voice === PERC && n.startBeat === h.beat && n.midi === 49)
      expect(cymbal).toHaveLength(1)
    }
  })

  it('the wedding: a 2/4 polka with six stomps on the strong beats', () => {
    expect(vltava.annotations.filter((a) => a.label === 'wedding').map((a) => a.beat)).toEqual([192])
    const stomps = vltava.annotations.filter((a) => a.label === 'stomp')
    expect(stomps).toHaveLength(6)
    expect(stomps.map((a) => a.beat)).toEqual([192, 200, 208, 216, 224, 232])
    for (const s of stomps) {
      expect(meter.beatToBarBeat(s.beat!).beat).toBe(1)
      const kick = vltava.notes.filter((n) => n.voice === PERC && n.startBeat === s.beat && n.midi === 35)
      expect(kick).toHaveLength(1)
      expect(kick[0]!.velocity).toBeGreaterThan(0.8) // the stomp is heavier than the pulse
    }
    // Two-beat bars: the bass oom-pah lands two notes per bar throughout.
    for (const bar of [65, 70, 77, 88]) {
      const start = meter.barBeatToBeat(bar, 1)
      const inBar = vltava.notes.filter((n) => n.voice === BASS && n.startBeat >= start && n.startBeat < start + 2)
      expect(inBar).toHaveLength(2)
    }
  })

  it('moonlight: three soft nymph chimes in the high bells over a still bass', () => {
    expect(vltava.annotations.filter((a) => a.label === 'moonlight').map((a) => a.beat)).toEqual([240])
    const nymphs = vltava.annotations.filter((a) => a.label === 'nymph')
    expect(nymphs).toHaveLength(3)
    expect(nymphs.map((a) => a.beat)).toEqual([240, 256, 272])
    for (const n of nymphs) {
      const chime = vltava.notes.filter((x) => x.voice === BELLS && x.startBeat === n.beat)
      expect(chime).toHaveLength(1)
      expect(chime[0]!.midi).toBe(88) // E6
      expect(chime[0]!.velocity).toBeLessThanOrEqual(0.5)
    }
    // The bass holds one E2 pedal through the whole section (one tie chain).
    const pedal = vltava.notes.filter((n) => n.voice === BASS && n.startBeat >= 240 && n.startBeat < 288)
    expect(pedal).toHaveLength(1)
    expect(pedal[0]).toMatchObject({ startBeat: 240, durBeats: 48, midi: 40 })
  })

  it('the rapids: eight irregular stabs, each a brass note with a cymbal crash', () => {
    expect(vltava.annotations.filter((a) => a.label === 'rapids').map((a) => a.beat)).toEqual([288])
    const rapids = vltava.annotations.filter((a) => a.label === 'rapid')
    expect(rapids).toHaveLength(8)
    expect(rapids.map((a) => a.beat)).toEqual([288, 296, 303, 310, 318, 329, 339, 351])
    // Irregular: not every gap is the same.
    const gaps = rapids.slice(1).map((a, i) => a.beat! - rapids[i]!.beat!)
    expect(new Set(gaps).size).toBeGreaterThan(2)
    for (const r of rapids) {
      const stab = vltava.notes.filter((n) => n.voice === BRASS && n.startBeat === r.beat)
      expect(stab).toHaveLength(1)
      const barStart = meter.barBeatToBeat(meter.beatToBarBeat(r.beat!).bar, 1)
      const crash = vltava.notes.filter((n) => n.voice === PERC && n.startBeat === barStart && n.midi === 49)
      expect(crash).toHaveLength(1)
    }
  })

  it('the broad Vltava is the one strength-1 climax, and it is in E MAJOR', () => {
    const climaxes = vltava.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(1)
    expect(climaxes[0]!.label).toBe('broadRiver')
    expect(climaxes[0]!.beat).toBe(360) // bar 125 beat 1
    // Lead notes over the whole broad-river statement: G sharps, never G naturals.
    const lead = vltava.notes.filter((n) => n.voice === LEAD && n.startBeat >= 360 && n.startBeat < 408)
    expect(lead.length).toBeGreaterThan(40)
    expect(lead.some((n) => n.midi === G_SHARP_4 || n.midi === G_SHARP_5)).toBe(true)
    expect(lead.some((n) => n.midi === G4 || n.midi === G5)).toBe(false)
    // …while the minor statements really are minor: G naturals, no G sharps.
    const minorLead = vltava.notes.filter((n) => n.voice === LEAD && n.startBeat >= 48 && n.startBeat < 144)
    expect(minorLead.some((n) => n.midi === G4)).toBe(true)
    expect(minorLead.some((n) => n.midi === G_SHARP_4)).toBe(false)
    // The head motif returns, now with G#: E F# G# A B.
    const head = lead.filter((n) => n.startBeat < 363).sort((a, b) => a.startBeat - b.startBeat)
    expect(head.map((n) => n.midi)).toEqual([64, 66, 68, 69, 71])
  })

  it('Vyšehrad: the castle motif (rising fourth, step down) and the last wave', () => {
    expect(vltava.annotations.filter((a) => a.label === 'vysehrad').map((a) => a.beat)).toEqual([408])
    const motif = vltava.notes
      .filter((n) => n.voice === LEAD && n.startBeat >= 408 && n.startBeat < 412)
      .sort((a, b) => a.startBeat - b.startBeat)
    expect(motif.map((n) => n.midi)).toEqual([71, 76, 75, 71]) // B4 E5 D#5 B4
    const last = vltava.annotations.filter((a) => a.label === 'lastWave')
    expect(last).toHaveLength(1)
    expect(last[0]!.kind).toBe('hit')
    expect(last[0]!.beat).toBe(448) // bar 151 beat 1
    // The closing low chord: bass E2 struck on the last wave and held to the end.
    const bassLast = vltava.notes.filter((n) => n.voice === BASS && n.startBeat === 448)
    expect(bassLast).toHaveLength(1)
    expect(bassLast[0]).toMatchObject({ midi: 40, durBeats: 8 })
    // Nothing sounds after the final bar.
    for (const n of vltava.notes) expect(n.startBeat + n.durBeats).toBeLessThanOrEqual(TOTAL_BEATS)
  })

  it('phrase ends every 8 bars (18 of them, all labeled phraseEnd), closing after the last bar', () => {
    const phrases = vltava.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases.length).toBeGreaterThanOrEqual(10)
    expect(phrases).toHaveLength(18)
    for (const p of phrases) {
      expect(p.label).toBe('phraseEnd')
      expect(meter.beatToBarBeat(p.beat!).beat).toBe(1)
    }
    expect(phrases[phrases.length - 1]!.beat).toBe(TOTAL_BEATS) // bar 153 beat 1
    expect(phrases.map((a) => meter.beatToBarBeat(a.beat!).bar)).toEqual([
      9, 17, 25, 33, 41, 49, 57, 65, 73, 81, 89, 101, 109, 117, 125, 133, 141, 153,
    ])
  })

  it('score annotations are sorted by time', () => {
    for (let i = 1; i < vltava.annotations.length; i++) {
      expect(vltava.annotations[i]!.time).toBeGreaterThanOrEqual(vltava.annotations[i - 1]!.time)
    }
  })
})

describe('vltava timeline', () => {
  it('builds and lands within ±15% of the ~278 s target (4.6 minutes)', () => {
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.duration).toBeGreaterThan(TARGET_SEC * 0.85)
    expect(tl.duration).toBeLessThan(TARGET_SEC * 1.15)
    expect(tl.duration).toBeGreaterThanOrEqual(270)
    expect(tl.duration).toBeLessThanOrEqual(330)
    expect(tl.duration).toBeCloseTo(EXPECTED_DURATION, 6)
  })

  it('section downbeats land at the expected seconds', () => {
    expect(tempo.beatToSec(48)).toBeCloseTo(24.83, 2) // river
    expect(tempo.beatToSec(144)).toBeCloseTo(74.48, 2) // hunt
    expect(tempo.beatToSec(192)).toBeCloseTo(99.31, 2) // wedding
    expect(tempo.beatToSec(240)).toBeCloseTo(127.0, 2) // moonlight
    expect(tempo.beatToSec(288)).toBeCloseTo(170.64, 2) // rapids
    expect(tempo.beatToSec(360)).toBeCloseTo(204.39, 2) // broad river
    expect(tempo.beatToSec(408)).toBeCloseTo(228.39, 2) // vysehrad
    expect(tempo.beatToSec(448)).toBeCloseTo(268.39, 2) // last wave
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of vltava.notes) {
      expect(tempo.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempo.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('timeline annotations are sorted and every labelled mark survives the merge', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
    expect(annotationsOfKind(tl, 'hit', 'spring')).toHaveLength(2)
    expect(annotationsOfKind(tl, 'accent', 'river')).toHaveLength(2)
    expect(annotationsOfKind(tl, 'accent', 'hunt')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'hit', 'horn')).toHaveLength(4)
    expect(annotationsOfKind(tl, 'accent', 'wedding')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'hit', 'stomp')).toHaveLength(6)
    expect(annotationsOfKind(tl, 'accent', 'moonlight')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'hit', 'nymph')).toHaveLength(3)
    expect(annotationsOfKind(tl, 'accent', 'rapids')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'hit', 'rapid')).toHaveLength(8)
    expect(annotationsOfKind(tl, 'accent', 'vysehrad')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'hit', 'lastWave')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'phrase', 'phraseEnd')).toHaveLength(18)
  })

  it('climaxOf finds the broad river at bar 125 as the lone strength-1 peak', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.label).toBe('broadRiver')
    expect(c?.time).toBeCloseTo(tempo.beatToSec(360), 9)
    expect(annotationsOfKind(tl, 'climax')).toHaveLength(1)
  })

  it('the meter grid is honest: downbeats every 3, 2, 4, 3, 4 beats per section', () => {
    const downbeatBeats = tl.downbeats.map((t) => Math.round(tempo.secToBeat(t) * 1e6) / 1e6)
    expect(downbeatBeats.slice(0, 3)).toEqual([0, 3, 6])
    expect(downbeatBeats).toContain(192)
    expect(downbeatBeats).toContain(194) // 2/4 bars from bar 65
    expect(downbeatBeats).toContain(240)
    expect(downbeatBeats).toContain(244) // 4/4 bars from bar 89
    expect(downbeatBeats).toContain(288)
    expect(downbeatBeats).toContain(291) // 3/4 bars from bar 101
    expect(downbeatBeats).toContain(408)
    expect(downbeatBeats).toContain(412) // 4/4 bars from bar 141
    expect(downbeatBeats).not.toContain(193)
  })

  it('energy peaks in the broad river, above the moonlight hush', () => {
    const mean = (t0: number, t1: number): number => {
      const pts = tl.energy.filter((p) => p.time >= t0 && p.time < t1)
      return pts.reduce((s, p) => s + p.rms, 0) / pts.length
    }
    const broad = mean(tempo.beatToSec(360), tempo.beatToSec(408))
    const moon = mean(tempo.beatToSec(240), tempo.beatToSec(288))
    expect(broad).toBeGreaterThan(moon * 1.5)
  })

  it('is deterministic: two timelines built from the score are equal', () => {
    const a = buildTimelineFromScore(vltava)
    const b = buildTimelineFromScore(vltava)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
