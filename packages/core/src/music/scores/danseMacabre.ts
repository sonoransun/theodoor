/**
 * scores/danseMacabre.ts — 72-bar, 3-voice arrangement after Camille
 * Saint-Saens' "Danse Macabre" (1874) (public-domain work; this arrangement
 * is Theodoor's own), in D minor, 3/4.
 *
 * Structure:
 *   bars  1–4   midnight, @60 — twelve bell strokes on D ('toll' hits)
 *   bars  5–12  @138 — the fiddler tunes: the A/Eb tritone, twice
 *   bars 13–28  the waltz theme in the lead over oom-pah bass
 *   bars 29–44  the "bones" theme rattles in the bells (xylophone-like)
 *   bars 45–60  both themes up an octave, building
 *   bars 61–64  fortissimo peak — the sabbath (climax 0.9, two shrieks)
 *   bars 65–72  wind-down: fragments dissolve onto a held low D
 *
 * The climax is damped to 0.9 — the Halloween suite's single strength-1.0
 * climax lives in mountainKing.
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [
    { beat: 0, bpm: 60 }, // the twelve strokes of midnight, bars 1–4
    { beat: 12, bpm: 138 }, // the waltz, bar 5 onward
  ],
  meters: [{ bar: 1, beatsPerBar: 3 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

/** n full bars of rest in 3/4 (the dot never sticks, so each is explicit). */
const rest3 = (n: number): string => Array.from({ length: n }, () => 'r/2. |').join(' ')

/** Transpose a section string up one octave. */
const up8 = (section: string): string =>
  section.replace(/([A-G][#b]?)(\d)/g, (_m, p, o) => `${p}${Number(o) + 1}`)

// The fiddler's tuning: long A/Eb double-stop tones rocking on the tritone.
const TUNE =
  'A4/2 Eb5/4 | A4/2 Eb5/4 | A4/4 Eb5/4 A4/4 | Eb5/2. | ' +
  'A4/2 Eb5/4 | A4/2 Eb5/4 | A4/4 Eb5/4 A4/4 | Eb5/2 r/4 |'

// Waltz theme (8 bars): the leaping D–A figure, then the falling close.
const WALTZ =
  'D5/2 A4/4 | F4/2 A4/4 | D5/2 A4/4 | F4/2 A4/4 | ' +
  'E5/4 D5 C5 | D5/4 C5 Bb4 | A4/4 G4 C#5 | D5/2. |'

// "Bones" theme (8 bars): dry staccato eighths for the bells.
const BONES =
  'F5/8 E5 D5 E5 F5 G5 | A5/4 F5 D5 | E5/8 F5 G5 F5 E5 D5 | C#5/4 E5 A4 | ' +
  'D5/8 E5 F5 G5 A5 Bb5 | A5/4 F5 D5 | E5/4 C#5 E5 | D5/2 r/4 |'

// Rising build toward the peak (8 bars).
const BUILD =
  'D5/4 E5 F5 | E5/4 F5 G5 | F5/4 G5 A5 | G5/4 A5 Bb5 | ' +
  'A5/8 Bb5 A5 G5 F5 E5 | F5/8 G5 F5 E5 D5 C#5 | D5/4 E5 C#5 | D5/4 F5 A5 |'

// Held counter-line under the bones theme's first pass.
const COUNTER = 'D4/2. | ~D4/2. | C4/2. | ~C4/2. | Bb3/2. | G3/2. | A3/2. | ~A3/2. |'

// Oom-pah-pah bass under one waltz statement (Dm, then Gm–Bb–A–Dm close).
const OOMPAH =
  'D2/4 A2 A2 | D2/4 A2 A2 | D2/4 A2 A2 | D2/4 A2 A2 | ' +
  'G2/4 D3 D3 | Bb1/4 F2 F2 | A1/4 E2 E2 | D2/4 A2 A2 |'

// Ascending roots under the build.
const BUILD_BASS =
  'D2/4 D2 D2 | E2/4 E2 E2 | F2/4 F2 F2 | G2/4 G2 G2 | ' +
  'A2/4 A2 A2 | A1/4 A1 A1 | A1/4 E2 A2 | D2/4 A2 D3 |'

const LEAD = [
  rest3(4), // bars 1–4: the bells toll alone
  '@0.7',
  TUNE, // bars 5–12
  '@0.78',
  WALTZ, // bars 13–20
  '@0.82',
  WALTZ, // bars 21–28
  '@0.66',
  COUNTER, // bars 29–36: held tones under the bones
  '@0.85',
  WALTZ, // bars 37–44
  '@0.9',
  up8(WALTZ), // bars 45–52
  '@0.94',
  BUILD, // bars 53–60
  '@0.98',
  'D6/2 A5/4 | Bb5/2 G5/4 | C#6/2 E6/4 | D6/2. |', // bars 61–64: the peak
  '@0.55',
  'D5/2 A4/4 | F4/2 A4/4 | D5/2. | r/2. |', // bars 65–68: wind-down
  '@0.42',
  'F4/4 E4 D4 | C#4/2. | D4/2. | ~D4/2. |', // bars 69–72
].join(' ')

const BASS = [
  '@0.55',
  'D2/2. |', // bar 1: low D pedal under the tolls…
  Array.from({ length: 11 }, () => '~D2/2. |').join(' '), // …tied through bar 12
  '@0.68',
  OOMPAH, // bars 13–20
  '@0.72',
  OOMPAH, // bars 21–28
  OOMPAH, // bars 29–36
  '@0.78',
  OOMPAH, // bars 37–44
  '@0.82',
  OOMPAH, // bars 45–52
  '@0.88',
  BUILD_BASS, // bars 53–60
  '@0.95',
  'D2/4 A2 D3 | G1/4 G2 Bb2 | A1/4 A2 C#3 | D2/2. |', // bars 61–64
  '@0.5',
  'D2/4 A2 A2 | D2/4 A2 A2 | D2/2. | A1/2. |', // bars 65–68
  '@0.42',
  'G2/2. | A1/2. | D2/2. | ~D2/2. |', // bars 69–72
].join(' ')

const BELLS = [
  '@0.82',
  'D5/4 D5 D5 | D5 D5 D5 | D5 D5 D5 | D5 D5 D5 |', // bars 1–4: twelve tolls
  rest3(24), // bars 5–28: tacet
  '@0.8',
  BONES, // bars 29–36
  '@0.84',
  BONES, // bars 37–44
  '@0.88',
  up8(BONES), // bars 45–52
  '@0.9',
  up8(BUILD), // bars 53–60: doubling the lead's build an octave up
  '@0.95',
  'D6/8 A5 F5 A5 D6 A5 | Bb5/8 G5 D5 G5 Bb5 G5 | A5/8 E5 C#5 E5 A5 E5 | D6/2. |', // 61–64
  '@0.5',
  'F5/8 E5 D5 E5 F5 G5 | A5/4 F5 D5 | r/2. | E5/4 C#5 A4 |', // bars 65–68
  'r/2. | @0.4 E5/4 C#5 A4 | r/2. | D5/2. |', // bars 69–72
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const danseMacabre: Score = {
  id: 'danseMacabre',
  title: 'Danse Macabre',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // The twelve strokes of midnight: one per beat across bars 1–4.
    ...Array.from({ length: 12 }, (_, i) =>
      annotate(TEMPO, 'hit', 1 + Math.floor(i / 3), 1 + (i % 3), 0.7, 'toll'),
    ),
    // The fiddler tunes (the tritone rings at each half-statement).
    annotate(TEMPO, 'accent', 5, 1, 0.65, 'tuning'),
    annotate(TEMPO, 'hit', 5, 1, 0.75, 'tritone'),
    annotate(TEMPO, 'hit', 9, 1, 0.75, 'tritone'),
    // The waltz begins; phrase boundaries every 8 waltz bars.
    annotate(TEMPO, 'accent', 13, 1, 0.8, 'danse'),
    annotate(TEMPO, 'phrase', 21, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 29, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 29, 1, 0.75, 'bones'),
    annotate(TEMPO, 'phrase', 37, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 45, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 53, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 61, 1, 0.6, 'phraseEnd'),
    // The peak: two shrieks around the damped 0.9 climax.
    annotate(TEMPO, 'hit', 62, 1, 0.9, 'shriek'),
    annotate(TEMPO, 'climax', 64, 1, 0.9, 'sabbath'),
    annotate(TEMPO, 'hit', 64, 1, 0.9, 'shriek'),
    annotate(TEMPO, 'phrase', 69, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 73, 1, 0.6, 'phraseEnd'),
  ],
}
