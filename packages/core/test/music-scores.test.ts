import { describe, expect, it } from 'vitest'
import type { NoteEvent } from '../src/contracts.js'
import { SCORES, getScore, odeToJoy } from '../src/music/scores/index.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'

const BARS = 32
const TOTAL_BEATS = BARS * 4 // 128, 4/4 throughout

describe('scores registry', () => {
  it('contains the fourteen built-in scores', () => {
    expect(Object.keys(SCORES).sort()).toEqual([
      'auldLangSyne',
      'blueDanube',
      'clairDeLune',
      'danseMacabre',
      'dawnOfAllSaints',
      'gymnopedie1',
      'jupiterHymn',
      'moonlightAdagio',
      'mountainKing',
      'odeToJoy',
      'overture1812Finale',
      'starsAndStripesForever',
      'vltava',
      'zarathustraSunrise',
    ])
    expect(getScore('odeToJoy')).toBe(odeToJoy)
    expect(getScore('nope')).toBeUndefined()
  })
})

describe('odeToJoy score sanity', () => {
  it('has 3 voices: lead, bass, bells', () => {
    expect(odeToJoy.voices.map((v) => v.program)).toEqual(['lead', 'bass', 'bells'])
  })

  it('runs at 120 bpm in 4/4', () => {
    expect(odeToJoy.tempo.segments).toEqual([{ beat: 0, bpm: 120 }])
    expect(odeToJoy.tempo.meters).toEqual([{ bar: 1, beatsPerBar: 4 }])
  })

  it('note count snapshot: 255 total (124 lead / 63 bass / 68 bells)', () => {
    expect(odeToJoy.notes.length).toBe(255)
    const byVoice = [0, 1, 2].map((v) => odeToJoy.notes.filter((n) => n.voice === v).length)
    expect(byVoice).toEqual([124, 63, 68])
  })

  it('bar arithmetic is clean: 32 bars, voices monophonic and gapless-valid', () => {
    for (let v = 0; v < 3; v++) {
      const voiceNotes = odeToJoy.notes
        .filter((n) => n.voice === v)
        .sort((a, b) => a.startBeat - b.startBeat)
      let lastEnd = 0
      for (const n of voiceNotes) {
        expect(n.startBeat).toBeGreaterThanOrEqual(0)
        // Monophonic: no overlap with the previous note in the same voice.
        expect(n.startBeat).toBeGreaterThanOrEqual(lastEnd - 1e-9)
        lastEnd = n.startBeat + n.durBeats
        expect(lastEnd).toBeLessThanOrEqual(TOTAL_BEATS + 1e-9)
      }
    }
    const maxEnd = Math.max(...odeToJoy.notes.map((n) => n.startBeat + n.durBeats))
    expect(maxEnd).toBe(TOTAL_BEATS)
  })

  it('notes are sorted and have sane velocity/midi ranges', () => {
    let prev: NoteEvent | undefined
    for (const n of odeToJoy.notes) {
      if (prev) expect(n.startBeat).toBeGreaterThanOrEqual(prev.startBeat)
      expect(n.velocity).toBeGreaterThan(0)
      expect(n.velocity).toBeLessThanOrEqual(1)
      expect(n.midi).toBeGreaterThanOrEqual(12)
      expect(n.midi).toBeLessThanOrEqual(127)
      expect(n.durBeats).toBeGreaterThan(0)
      prev = n
    }
    // The bass voice really is bass: everything under the midi-45 loudness knee.
    for (const n of odeToJoy.notes.filter((x) => x.voice === 1)) {
      expect(n.midi).toBeLessThan(45)
    }
  })

  it('annotates phrase boundaries every 8 bars with label phraseEnd', () => {
    const phrases = odeToJoy.annotations.filter(
      (a) => a.kind === 'phrase' && a.label === 'phraseEnd',
    )
    expect(phrases.map((a) => a.beat)).toEqual([32, 64, 96, 128]) // bars 9, 17, 25, 33
    expect(phrases.map((a) => a.time)).toEqual([16, 32, 48, 64])
  })

  it('has exactly one climax, strength 1, at the final refrain (bar 29)', () => {
    const climaxes = odeToJoy.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(1)
    expect(climaxes[0]!.beat).toBe(112) // bar 29 beat 1
    expect(climaxes[0]!.time).toBe(56)
    expect(climaxes[0]!.label).toBe('finalRefrain')
  })
})

describe('odeToJoy timeline', () => {
  const tl = buildTimelineFromScore(odeToJoy)

  it('spans 32 bars plus the 2 s tail', () => {
    expect(tl.duration).toBeCloseTo(66) // 128 beats @ 120 bpm = 64 s, + 2
    expect(tl.beats.length).toBe(133) // beats 0..132 every 0.5 s
    expect(tl.downbeats.length).toBe(34) // bars 1..34 downbeats within 66 s
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of odeToJoy.notes) {
      const endSec = ((n.startBeat + n.durBeats) * 60) / 120
      expect(endSec).toBeLessThanOrEqual(tl.duration)
      expect((n.startBeat * 60) / 120).toBeGreaterThanOrEqual(0)
    }
  })

  it('annotations are sorted and include auto accents for the fortissimo refrain', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
    const accents = annotationsOfKind(tl, 'accent')
    // 2 authored forte accents + 14 auto accents in bars 29-32 (bar 29 beat 1
    // is suppressed by the climax annotation).
    expect(accents).toHaveLength(16)
    const auto = accents.filter((a) => a.label === undefined)
    expect(auto).toHaveLength(14)
    for (const a of auto) {
      expect(a.beat!).toBeGreaterThanOrEqual(112)
      expect(a.strength).toBeGreaterThanOrEqual(0.85)
    }
    expect(auto.some((a) => a.beat === 112)).toBe(false) // climax owns that instant
  })

  it('climaxOf finds the single strength-1 climax at 56 s', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.time).toBe(56)
  })

  it('energy is loudest around the final refrain', () => {
    // Mean energy across the final-refrain bars should beat the opening bars.
    const mean = (t0: number, t1: number): number => {
      const pts = tl.energy.filter((p) => p.time >= t0 && p.time < t1)
      return pts.reduce((s, p) => s + p.rms, 0) / pts.length
    }
    expect(mean(56, 64)).toBeGreaterThan(mean(0, 8))
  })
})
