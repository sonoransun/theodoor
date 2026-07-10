/**
 * scores/gymnopedie1.ts — 32-bar, 3-voice arrangement of Satie's Gymnopédie
 * No. 1 (1888; public-domain work; this arrangement is Theodoor's own), in
 * D major. The opener of the quiet midsummer suite: its climax is a gentle
 * 0.6 "lift" — the suite's single strength-1 climax lives in clairDeLune.
 *
 * Structure, 3/4 at 66 bpm ("Lent et douloureux"):
 *   bars  1–4   bass vamp alone (root–chord alternation)
 *   bars  5–12  phrase A: the floating melody, long exhale on F#4
 *   bars 13–20  phrase A': same opening, tail rises toward the lift
 *   bars 21–28  phrase B: the lift — sparse bells double the downbeats
 *   bars 29–32  settle back to the tonic
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [{ beat: 0, bpm: 66 }],
  meters: [{ bar: 1, beatsPerBar: 3 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

// 3/4 has no single-token whole-bar rest (3 beats), so each rest bar is an
// explicit dotted half ('/2.' — the dot never sticks).
const REST4 = 'r/2. | r/2. | r/2. | r/2. |'

const LEAD = [
  '@0.5',
  REST4, // bars 1–4: vamp alone
  'F#5/4 A5 G5 | F#5 C#5 B4 | C#5 D5 A4 |', // bars 5–7
  'F#4/2. | ~F#4/2. | ~F#4/2. |', // bars 8–10: the long exhale
  'B4/4 A4 F#4 | G4/2. |', // bars 11–12
  '@0.55',
  'F#5/4 A5 G5 | F#5 C#5 B4 | C#5 D5 A4 |', // bars 13–15
  'C#5/2. | ~C#5/2. | ~C#5/2. |', // bars 16–18
  'F#5/4 E5 C#5 | D5/2. |', // bars 19–20
  '@0.62',
  'A4/4 B4 C#5 | D5 E5 F#5 | G5/2 F#5/4 | E5/2. |', // bars 21–24: the lift
  'F#5/4 E5 D5 | C#5/2 B4/4 | A4/2 B4/4 | C#5/2. |', // bars 25–28
  '@0.45',
  'D5/4 A4 F#4 | G4/4 F#4 E4 | D4/2. | ~D4/2. |', // bars 29–32: settle
].join(' ')

// Satie's vamp: low root on the downbeat, one mid-register harmony tone held
// through beats 2–3 (a monophonic reading of the root–chord alternation).
const BASS = [
  '@0.45',
  'G2/4 B3/2 | D2/4 A3/2 | G2/4 B3/2 | D2/4 A3/2 |', // bars 1–4
  'G2/4 B3/2 | D2/4 A3/2 | G2/4 B3/2 | D2/4 A3/2 |', // bars 5–8
  'G2/4 B3/2 | D2/4 A3/2 | E2/4 G3/2 | A2/4 G3/2 |', // bars 9–12
  'G2/4 B3/2 | D2/4 A3/2 | G2/4 B3/2 | D2/4 A3/2 |', // bars 13–16
  'G2/4 B3/2 | D2/4 A3/2 | A2/4 C#3/2 | D2/4 F#3/2 |', // bars 17–20
  '@0.5',
  'A2/4 E3/2 | D2/4 F#3/2 | G2/4 B3/2 | A2/4 C#3/2 |', // bars 21–24
  'B2/4 D3/2 | E2/4 G3/2 | A2/4 E3/2 | A2/4 C#3/2 |', // bars 25–28
  '@0.4',
  'G2/4 B3/2 | A2/4 C#3/2 | D2/2. | ~D2/2. |', // bars 29–32
].join(' ')

// Sparse doubling only: one chime per bar through the lift, then a last echo.
const BELLS = [
  REST4,
  REST4,
  REST4,
  REST4,
  REST4, // bars 1–20: tacet
  '@0.35',
  'A5/2. | D6/2. | G6/2. | E6/2. |', // bars 21–24: double the lift downbeats
  'F#6/2. | C#6/2. | A5/2. | C#6/2. |', // bars 25–28
  'D6/2. | r/2. | D6/2. | ~D6/2. |', // bars 29–32: echo, breath, held close
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const gymnopedie1: Score = {
  id: 'gymnopedie1',
  title: 'Gymnopédie No. 1',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // The first sounding moment of the suite.
    annotate(TEMPO, 'accent', 1, 1, 0.5, 'firstStar'),
    // Six phrase-exhale points: where each melodic line lands and holds.
    annotate(TEMPO, 'hit', 8, 1, 0.3, 'breath'),
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 12, 1, 0.3, 'breath'),
    annotate(TEMPO, 'hit', 16, 1, 0.3, 'breath'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 20, 1, 0.3, 'breath'),
    // Exactly one climax — deliberately damped to 0.6: the suite's only
    // strength-1 climax is clairDeLune's zenith.
    annotate(TEMPO, 'climax', 21, 1, 0.6, 'lift'),
    annotate(TEMPO, 'hit', 24, 1, 0.3, 'breath'),
    annotate(TEMPO, 'phrase', 25, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 28, 1, 0.3, 'breath'),
    annotate(TEMPO, 'phrase', 33, 1, 0.6, 'phraseEnd'),
  ],
}
