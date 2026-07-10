/**
 * music/notation.ts — compact per-voice string DSL -> NoteEvent[].
 *
 * Grammar (whitespace-separated tokens):
 *   C4  F#5  Bb3      pitch + octave (accidental '#'/'b'), MIDI C4 = 60
 *   /N                duration suffix: 4/N beats (/1 whole = 4, /2 half = 2,
 *                     /4 quarter = 1, /8 eighth = 0.5). Sticky until changed.
 *   .                 dotted (1.5x) — attached ('G4/4.') or standalone after
 *                     the token it dots; applies to that token only, the
 *                     sticky duration stays undotted.
 *   r                 rest (takes /N and '.' like a note)
 *   ~C4               tie: extends the previous note (same pitch, contiguous)
 *                     by this token's duration instead of emitting a new note
 *   @0.9              sticky velocity (0..1)
 *   |                 barcheck: position must sit on a bar boundary; the
 *                     error names the offending bar
 */

import type {
  Annotation,
  AnnotationKind,
  Beats,
  MeterSegment,
  NoteEvent,
  TempoMapData,
} from '../contracts.js'
import { MeterMap, tempoMapsFrom } from '../time/index.js'

/** Optional initial parser state / meter context for barchecks. */
export interface ParseVoiceDefaults {
  /** Meter segments for barcheck arithmetic; default single 4/4 at bar 1. */
  meters?: readonly MeterSegment[]
  /** Beats before bar 1 (anacrusis); tokens before bar 1 sit in "bar 0". */
  pickupBeats?: Beats
  /** Initial sticky duration in beats (default 1 = quarter). */
  durBeats?: Beats
  /** Initial sticky velocity 0..1 (default 0.8). */
  velocity?: number
  /** Absolute beat where the voice begins (default 0). */
  startBeat?: Beats
}

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const NOTE_RE = /^(~?)([A-Ga-g])([#b]?)(\d)(?:\/(\d+))?(\.?)$/
const REST_RE = /^[rR](?:\/(\d+))?(\.?)$/

/** MIDI number for a pitch token like 'C4', 'F#5', 'Bb3' (no duration part). */
export function pitchToMidi(pitch: string): number {
  const m = NOTE_RE.exec(pitch)
  if (!m || m[1] === '~' || m[5] !== undefined || m[6] === '.') {
    throw new Error(`pitchToMidi: not a plain pitch token: '${pitch}'`)
  }
  return midiOf(m[2]!, m[3]!, m[4]!, pitch)
}

function midiOf(letter: string, accidental: string, octave: string, token: string): number {
  const base = SEMITONE[letter.toUpperCase()]!
  const acc = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  const midi = 12 * (Number(octave) + 1) + base + acc
  if (midi < 0 || midi > 127) throw new Error(`pitch out of MIDI range: '${token}'`)
  return midi
}

interface LastEvent {
  kind: 'note' | 'rest'
  durBeats: Beats
  dotted: boolean
  /** The NoteEvent to extend when a standalone '.' dots a note. */
  note?: NoteEvent
}

/**
 * Parse one voice's DSL into NoteEvent[] (velocity/duration state is local
 * to the voice). Throws with token index + bar number on malformed input or
 * failed barchecks.
 */
export function parseVoice(
  dsl: string,
  voiceIndex: number,
  defaults: ParseVoiceDefaults = {},
): NoteEvent[] {
  const meter = new MeterMap(
    defaults.meters ?? [{ bar: 1, beatsPerBar: 4 }],
    defaults.pickupBeats ?? 0,
  )
  let pos: Beats = defaults.startBeat ?? 0
  let stickyDur: Beats = defaults.durBeats ?? 1
  let velocity = defaults.velocity ?? 0.8
  const notes: NoteEvent[] = []
  let last: LastEvent | undefined

  const tokens = dsl.trim().length === 0 ? [] : dsl.trim().split(/\s+/)
  const fail = (i: number, token: string, why: string): never => {
    const { bar } = meter.beatToBarBeat(pos)
    throw new Error(`parseVoice: voice ${voiceIndex}, token ${i} ('${token}') at bar ${bar}: ${why}`)
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!

    if (token === '|') {
      const { bar, beat } = meter.beatToBarBeat(pos)
      if (bar < 1 || Math.abs(beat - 1) > 1e-6) {
        throw new Error(
          `parseVoice: voice ${voiceIndex}, token ${i}: barcheck failed at bar ${Math.max(bar, 1)} ` +
            `— position is bar ${bar} beat ${beat}, expected beat 1`,
        )
      }
      continue
    }

    if (token.startsWith('@')) {
      const v = Number(token.slice(1))
      if (!Number.isFinite(v) || v < 0 || v > 1) fail(i, token, 'velocity must be in 0..1')
      velocity = v
      continue
    }

    if (token === '.') {
      if (!last) fail(i, token, "standalone '.' has nothing to dot")
      if (last!.dotted) fail(i, token, 'token is already dotted')
      const extra = last!.durBeats * 0.5
      if (last!.note) last!.note.durBeats += extra
      last!.dotted = true
      last!.durBeats += extra
      pos += extra
      continue
    }

    const rest = REST_RE.exec(token)
    if (rest) {
      const [, den, dot] = rest
      if (den !== undefined) stickyDur = durFromDenominator(den, i, token, fail)
      const dur = stickyDur * (dot === '.' ? 1.5 : 1)
      last = { kind: 'rest', durBeats: dur, dotted: dot === '.' }
      pos += dur
      continue
    }

    const note = NOTE_RE.exec(token)
    if (note) {
      const [, tie, letter, accidental, octave, den, dot] = note
      const midi = midiOf(letter!, accidental!, octave!, token)
      if (den !== undefined) stickyDur = durFromDenominator(den, i, token, fail)
      const dur = stickyDur * (dot === '.' ? 1.5 : 1)

      if (tie === '~') {
        const prev = notes[notes.length - 1]
        if (!prev) fail(i, token, 'tie has no previous note')
        if (prev!.midi !== midi) fail(i, token, 'tie must match the previous note pitch')
        if (Math.abs(prev!.startBeat + prev!.durBeats - pos) > 1e-6) {
          fail(i, token, 'tie must be contiguous with the previous note')
        }
        prev!.durBeats += dur
        last = { kind: 'note', durBeats: dur, dotted: dot === '.', note: prev! }
      } else {
        const ev: NoteEvent = { voice: voiceIndex, startBeat: pos, durBeats: dur, midi, velocity }
        notes.push(ev)
        last = { kind: 'note', durBeats: dur, dotted: dot === '.', note: ev }
      }
      pos += dur
      continue
    }

    fail(i, token, 'unrecognized token')
  }

  return notes
}

function durFromDenominator(
  den: string,
  i: number,
  token: string,
  fail: (i: number, token: string, why: string) => never,
): Beats {
  const n = Number(den)
  if (!Number.isInteger(n) || n <= 0) fail(i, token, 'duration denominator must be a positive integer')
  return 4 / n
}

/**
 * Build an Annotation at bar:beat (1-indexed, meter-aware), resolving both
 * the absolute `beat` and its wall-clock `time` through the tempo map.
 */
export function annotate(
  tempo: TempoMapData,
  kind: AnnotationKind,
  bar: number,
  beat: number,
  strength: number,
  label?: string,
): Annotation {
  const { tempo: tempoMap, meter } = tempoMapsFrom(tempo)
  const absBeat = meter.barBeatToBeat(bar, beat)
  const a: Annotation = { time: tempoMap.beatToSec(absBeat), beat: absBeat, kind, strength }
  if (label !== undefined) a.label = label
  return a
}
