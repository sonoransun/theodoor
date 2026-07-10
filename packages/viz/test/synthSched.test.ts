/**
 * ScoreSynth pure scheduling math: note precompute (tempo map → seconds) and
 * the lookahead window selection — headless, no AudioContext.
 */
import { describe, expect, it } from 'vitest'
import { getScore } from '@theodoor/core'
import type { Score } from '@theodoor/core'
import { showToCtxTime } from '../src/clock/audioClock.js'
import {
  SYNTH_LOOKAHEAD_SEC,
  nextNotesInWindow,
  precomputeNotes,
} from '../src/audio/synth.js'
import type { SynthNote } from '../src/audio/synth.js'
import { midiToHz } from '../src/audio/voices.js'

const tinyScore: Score = {
  id: 'tiny',
  title: 'Tiny',
  tempo: {
    segments: [{ beat: 0, bpm: 120 }],
    meters: [{ bar: 1, beatsPerBar: 4 }],
  },
  voices: [
    { name: 'lead', program: 'lead' },
    { name: 'drums', program: 'perc' },
  ],
  notes: [
    { voice: 0, startBeat: 0, durBeats: 1, midi: 60, velocity: 0.8 },
    { voice: 1, startBeat: 1, durBeats: 0.5, midi: 38, velocity: 1 },
    { voice: 0, startBeat: 2, durBeats: 2, midi: 64, velocity: 0.7 },
  ],
  annotations: [],
}

describe('precomputeNotes', () => {
  it('converts beats to seconds through the tempo map (120 bpm → 0.5 s/beat)', () => {
    const notes = precomputeNotes(tinyScore)
    expect(notes).toHaveLength(3)
    expect(notes[0]).toMatchObject({ tStartSec: 0, midi: 60, program: 'lead' })
    expect(notes[0]!.tDurSec).toBeCloseTo(0.5, 12)
    expect(notes[1]).toMatchObject({ midi: 38, program: 'perc' })
    expect(notes[1]!.tStartSec).toBeCloseTo(0.5, 12)
    expect(notes[1]!.tDurSec).toBeCloseTo(0.25, 12)
    expect(notes[2]!.tStartSec).toBeCloseTo(1, 12)
    expect(notes[2]!.tDurSec).toBeCloseTo(1, 12)
  })

  it('is sorted by start time and preserves every score note', () => {
    const score = getScore('odeToJoy')
    expect(score).toBeDefined()
    const notes = precomputeNotes(score!)
    expect(notes).toHaveLength(score!.notes.length)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]!.tStartSec).toBeGreaterThanOrEqual(notes[i - 1]!.tStartSec)
    }
    expect(notes[0]!.tStartSec).toBeGreaterThanOrEqual(0)
  })
})

describe('nextNotesInWindow', () => {
  const notes: SynthNote[] = [0, 0.5, 1, 1.5, 2, 3].map((t) => ({
    tStartSec: t,
    tDurSec: 0.25,
    midi: 60,
    velocity: 1,
    program: 'lead',
  }))

  it('selects the half-open window (from, to]', () => {
    const got = nextNotesInWindow(notes, 0.5, 1.5)
    expect(got.map((n) => n.tStartSec)).toEqual([1, 1.5]) // 0.5 excluded, 1.5 included
  })

  it('returns nothing for empty or inverted windows', () => {
    expect(nextNotesInWindow(notes, 1, 1)).toEqual([])
    expect(nextNotesInWindow(notes, 2, 1)).toEqual([])
    expect(nextNotesInWindow(notes, 3, 99)).toEqual([])
  })

  it('includes a note exactly at the start of playback via from < 0', () => {
    const got = nextNotesInWindow(notes, -1e-9, 0.2)
    expect(got.map((n) => n.tStartSec)).toEqual([0])
  })

  it('chunked scans cover every note exactly once (scheduler invariant)', () => {
    const chunks = [
      nextNotesInWindow(notes, -1, 0.4),
      nextNotesInWindow(notes, 0.4, 0.5),
      nextNotesInWindow(notes, 0.5, 2.2),
      nextNotesInWindow(notes, 2.2, 4),
    ].flat()
    const whole = nextNotesInWindow(notes, -1, 4)
    expect(chunks).toEqual(whole)
    expect(whole).toHaveLength(notes.length)
  })

  it('schedules correct context times at rate 0.5 and 2 through the anchor', () => {
    const due = nextNotesInWindow(notes, 0.9, 1 + SYNTH_LOOKAHEAD_SEC)
    expect(due.map((n) => n.tStartSec)).toEqual([1])
    const slow = { showSec: 0.9, ctxSec: 50, rate: 0.5, playing: true }
    expect(showToCtxTime(due[0]!.tStartSec, slow)).toBeCloseTo(50.2, 12)
    const fast = { showSec: 0.9, ctxSec: 50, rate: 2, playing: true }
    expect(showToCtxTime(due[0]!.tStartSec, fast)).toBeCloseTo(50.05, 12)
  })
})

describe('voice helpers', () => {
  it('midiToHz hits the standard anchors', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 9)
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3)
    expect(midiToHz(81)).toBeCloseTo(880, 9)
  })
})
