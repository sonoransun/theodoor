import { describe, expect, it } from 'vitest'
import { annotate, parseVoice, pitchToMidi } from '../src/music/notation.js'
import type { TempoMapData } from '../src/contracts.js'

const TEMPO_120: TempoMapData = {
  segments: [{ beat: 0, bpm: 120 }],
  meters: [{ bar: 1, beatsPerBar: 4 }],
}

describe('pitchToMidi', () => {
  it('maps pitch names to MIDI numbers (C4 = 60)', () => {
    expect(pitchToMidi('C4')).toBe(60)
    expect(pitchToMidi('A4')).toBe(69)
    expect(pitchToMidi('F#5')).toBe(78)
    expect(pitchToMidi('Bb3')).toBe(58)
    expect(pitchToMidi('C0')).toBe(12)
    expect(pitchToMidi('G9')).toBe(127)
  })

  it('rejects non-pitch tokens', () => {
    expect(() => pitchToMidi('H4')).toThrow()
    expect(() => pitchToMidi('C4/8')).toThrow()
    expect(() => pitchToMidi('r')).toThrow()
  })
})

describe('parseVoice durations', () => {
  it('parses /N as 4/N beats, sticky until changed', () => {
    const notes = parseVoice('C4/8 D4 E4/4 F4/2 G4/1', 0)
    expect(notes.map((n) => n.durBeats)).toEqual([0.5, 0.5, 1, 2, 4])
    expect(notes.map((n) => n.startBeat)).toEqual([0, 0.5, 1, 2, 4])
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64, 65, 67])
  })

  it('defaults to quarter notes (1 beat)', () => {
    const notes = parseVoice('C4 D4 E4', 0)
    expect(notes.map((n) => n.durBeats)).toEqual([1, 1, 1])
  })

  it('attached dot = 1.5x this token only; sticky stays undotted', () => {
    const notes = parseVoice('C4/4. D4 E4', 0)
    expect(notes[0]!.durBeats).toBe(1.5)
    expect(notes[1]!.startBeat).toBe(1.5)
    expect(notes[1]!.durBeats).toBe(1)
    expect(notes[2]!.durBeats).toBe(1)
  })

  it('standalone dot dots the previous token', () => {
    const notes = parseVoice('G5/4 . G5', 0)
    expect(notes[0]!.durBeats).toBe(1.5)
    expect(notes[1]!.startBeat).toBe(1.5)
    expect(notes[1]!.durBeats).toBe(1)
  })

  it('rejects double dots and dangling dots', () => {
    expect(() => parseVoice('C4/4 . .', 0)).toThrow(/already dotted/)
    expect(() => parseVoice('C4/4. .', 0)).toThrow(/already dotted/)
    expect(() => parseVoice('. C4', 0)).toThrow(/nothing to dot/)
  })

  it('rejects invalid duration denominators', () => {
    expect(() => parseVoice('C4/0', 0)).toThrow()
  })
})

describe('parseVoice rests', () => {
  it('rests advance the position without emitting notes', () => {
    const notes = parseVoice('r/2 C4/4', 0)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.startBeat).toBe(2)
  })

  it('rest durations are sticky and dottable', () => {
    const notes = parseVoice('r/4. C4/4 r . D4', 0)
    expect(notes[0]!.startBeat).toBe(1.5)
    // after C4 at 1.5..2.5: r (1 beat) dotted via standalone '.' -> +0.5
    expect(notes[1]!.startBeat).toBe(4)
  })
})

describe('parseVoice velocity', () => {
  it('@X is sticky; default is 0.8', () => {
    const notes = parseVoice('C4/4 @0.9 D4 E4 @0.5 F4', 0)
    expect(notes.map((n) => n.velocity)).toEqual([0.8, 0.9, 0.9, 0.5])
  })

  it('accepts an initial velocity default', () => {
    const notes = parseVoice('C4/4', 0, { velocity: 0.33 })
    expect(notes[0]!.velocity).toBe(0.33)
  })

  it('rejects velocities outside 0..1', () => {
    expect(() => parseVoice('@1.5 C4', 0)).toThrow(/velocity/)
    expect(() => parseVoice('@-0.1 C4', 0)).toThrow(/velocity/)
    expect(() => parseVoice('@x C4', 0)).toThrow(/velocity/)
  })
})

describe('parseVoice ties', () => {
  it('~ extends the previous note of the same pitch', () => {
    const notes = parseVoice('G4/4 ~G4/4', 0)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.durBeats).toBe(2)
  })

  it('ties work across barlines', () => {
    const notes = parseVoice('G4/1 | ~G4/1 |', 0)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.durBeats).toBe(8)
  })

  it('tied tokens can be dotted', () => {
    const notes = parseVoice('G4/4 ~G4/2.', 0)
    expect(notes[0]!.durBeats).toBe(4)
  })

  it('rejects a tie to a different pitch', () => {
    expect(() => parseVoice('G4/4 ~A4/4', 0)).toThrow(/pitch/)
  })

  it('rejects a tie with no previous note', () => {
    expect(() => parseVoice('~G4/4', 0)).toThrow(/no previous note/)
  })

  it('rejects a non-contiguous tie (rest in between)', () => {
    expect(() => parseVoice('G4/4 r/4 ~G4/4', 0)).toThrow(/contiguous/)
  })
})

describe('parseVoice barchecks', () => {
  it('passes when bars add up (4/4 default)', () => {
    expect(() => parseVoice('C4/4 C4 C4 C4 | D4/1 | E4/2 E4/2 |', 0)).not.toThrow()
  })

  it('failure message names bar 1 on a short first bar', () => {
    expect(() => parseVoice('C4/4 C4 C4 |', 0)).toThrow(/bar 1/)
  })

  it('failure message names the failing later bar', () => {
    expect(() => parseVoice('C4/1 | C4/1 | C4/4 C4 C4 |', 0)).toThrow(/bar 3/)
  })

  it('respects the meter option (3/4)', () => {
    const meters = [{ bar: 1, beatsPerBar: 3 }]
    expect(() => parseVoice('C4/4 C4 C4 | C4 C4 C4 |', 0, { meters })).not.toThrow()
    expect(() => parseVoice('C4/4 C4 C4 | C4 C4 C4 |', 0)).toThrow(/bar 1/)
  })

  it('respects meter changes mid-piece', () => {
    const meters = [
      { bar: 1, beatsPerBar: 4 },
      { bar: 2, beatsPerBar: 3 },
    ]
    expect(() => parseVoice('C4/1 | C4/4 C4 C4 | C4 C4 C4 |', 0, { meters })).not.toThrow()
  })

  it('handles pickup bars (anacrusis in bar 0)', () => {
    const notes = parseVoice('C4/4 | E4 E4 F4 G4 |', 0, { pickupBeats: 1 })
    expect(notes[0]!.startBeat).toBe(0)
    expect(notes[1]!.startBeat).toBe(1)
  })
})

describe('parseVoice misc', () => {
  it('tags notes with the given voice index', () => {
    const notes = parseVoice('C4/4 D4', 3)
    expect(notes.every((n) => n.voice === 3)).toBe(true)
  })

  it('empty input yields no notes', () => {
    expect(parseVoice('', 0)).toEqual([])
    expect(parseVoice('   ', 0)).toEqual([])
  })

  it('rejects unrecognized tokens, naming the token', () => {
    expect(() => parseVoice('C4/4 X9', 0)).toThrow(/token 1/)
    expect(() => parseVoice('C4/4 X9', 0)).toThrow(/unrecognized/)
  })

  it('rejects pitches outside MIDI range', () => {
    expect(() => parseVoice('A9/4', 0)).toThrow(/range/)
  })
})

describe('annotate', () => {
  it('converts bar:beat to seconds and absolute beats', () => {
    const a = annotate(TEMPO_120, 'phrase', 3, 1, 0.5, 'phraseEnd')
    expect(a.beat).toBe(8)
    expect(a.time).toBeCloseTo(4)
    expect(a.kind).toBe('phrase')
    expect(a.strength).toBe(0.5)
    expect(a.label).toBe('phraseEnd')
  })

  it('supports fractional beats and omitted labels', () => {
    const a = annotate(TEMPO_120, 'accent', 2, 3.5, 0.9)
    expect(a.beat).toBe(6.5)
    expect(a.time).toBeCloseTo(3.25)
    expect(a.label).toBeUndefined()
  })

  it('accounts for pickup beats', () => {
    const tempo: TempoMapData = { ...TEMPO_120, pickupBeats: 2 }
    const a = annotate(tempo, 'hit', 1, 1, 1)
    expect(a.beat).toBe(2)
    expect(a.time).toBeCloseTo(1)
  })

  it('accounts for tempo changes', () => {
    const tempo: TempoMapData = {
      segments: [
        { beat: 0, bpm: 120 },
        { beat: 4, bpm: 60 },
      ],
      meters: [{ bar: 1, beatsPerBar: 4 }],
    }
    const a = annotate(tempo, 'downbeat', 3, 1, 0.8)
    expect(a.beat).toBe(8)
    expect(a.time).toBeCloseTo(2 + 4) // bar 1 at 120 bpm, bar 2 at 60 bpm
  })
})
