/**
 * scores/mountainKing.ts — 48-bar, 4-voice arrangement after Edvard Grieg's
 * "In the Hall of the Mountain King" (1875) (public-domain work; this
 * arrangement is Theodoor's own), in B minor, 4/4.
 *
 * One long stepwise accelerando — 104 / 116 / 132 / 148 / 168 bpm at bars
 * 1 / 11 / 21 / 31 / 41 — under six 8-bar statements of the theme cycling
 * upward through registers, velocity ramping 0.4 -> 1.0:
 *   bars  1–8   'creep'   theme in the bass (B1)
 *   bars  9–16  'stalk'   theme in the brass (B2), bass walks
 *   bars 17–24  'pursuit' theme in the lead (B3), offbeat brass stabs
 *   bars 25–32  'quarry'  theme in the lead (B4); perc joins at bar 21
 *   bars 33–40  'frenzy'  lead + brass in octaves, driving eighths
 *   bars 41–48  'rampage' fortissimo; bars 43–48 are accelerating hammer
 *               chords (8 'stomp' hits), one 'shriek', and the suite's single
 *               strength-1.0 climax 'summit' on the closing chord.
 *
 * Perc pitch map (GM drums): B1 = 35 kick, D2 = 38 snare, C#3 = 49 cymbal.
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [
    { beat: 0, bpm: 104 }, // bar 1
    { beat: 40, bpm: 116 }, // bar 11
    { beat: 80, bpm: 132 }, // bar 21
    { beat: 120, bpm: 148 }, // bar 31
    { beat: 160, bpm: 168 }, // bar 41
  ],
  meters: [{ bar: 1, beatsPerBar: 4 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'brass', program: 'brass' },
  { name: 'bass', program: 'bass' },
  { name: 'perc', program: 'perc' },
]

/** n full bars of rest in 4/4. */
const rest4 = (n: number): string => Array.from({ length: n }, () => 'r/1 |').join(' ')

/** Transpose a section string up one octave. */
const up8 = (section: string): string =>
  section.replace(/([A-G][#b]?)(\d)/g, (_m, p, o) => `${p}${Number(o) + 1}`)

// The theme, built per register: `o` is the octave of the root B.
const themeBar = (o: number): string =>
  `B${o}/8 C#${o + 1} D${o + 1} E${o + 1} F#${o + 1} D${o + 1} F#${o + 1}/4 |`
// The lowered-step answer (F and C naturals — the creeping chromatic bar).
const chromBar = (o: number): string =>
  `F${o + 1}/8 C#${o + 1} F${o + 1}/4 E${o + 1}/8 C${o + 1} E${o + 1}/4 |`
const answerBar = (o: number): string =>
  `B${o + 1}/8 A${o + 1} F#${o + 1} D${o + 1} F#${o + 1} A${o + 1} B${o + 1}/4 |`
const closeBar = (o: number): string => `B${o + 1}/8 A${o + 1} F#${o + 1} D${o + 1} B${o}/2 |`

/** One full 8-bar statement of the theme at root B{o}. */
const statement = (o: number): string =>
  [
    themeBar(o),
    chromBar(o),
    themeBar(o),
    answerBar(o),
    themeBar(o),
    chromBar(o),
    themeBar(o),
    closeBar(o),
  ].join(' ')

// Offbeat stabs under a lead statement (4 bars, used twice per statement).
const STAB4 = 'r/4 B2 r B2 | r/4 F3 r F3 | r/4 B2 r B2 | r/4 D3 r D3 |'

// Walking bass under a statement (8 bars).
const WALK8 =
  Array.from({ length: 7 }, () => 'B1/4 F#2 B1 F#2 |').join(' ') + ' B1/4 D2 E2 F#2 |'

// Driving eighths (8 bars), the last bar an ascending run into the finale.
const DRIVE8 =
  Array.from({ length: 7 }, () => 'B1/8 B1 F#2 F#2 B1 B1 F#2 F#2 |').join(' ') +
  ' B1/8 C#2 D2 E2 F#2 G2 A2 B2 |'

const LEAD = [
  rest4(16), // bars 1–16
  '@0.62',
  statement(3), // bars 17–24
  '@0.74',
  statement(4), // bars 25–32
  '@0.86',
  statement(4), // bars 33–40
  '@1',
  themeBar(4), // bar 41
  answerBar(4), // bar 42: the theme flung to its top B
  'B5/2 r/2 | B5/2 r/2 | D6/2 r/2 | B5/2 B5/2 | D6/2 B5/2 | B5/1 |', // 43–48 hammer
].join(' ')

const BRASS = [
  rest4(8), // bars 1–8
  '@0.5',
  statement(2), // bars 9–16
  '@0.58',
  STAB4,
  STAB4, // bars 17–24
  '@0.68',
  up8(STAB4),
  up8(STAB4), // bars 25–32
  '@0.86',
  statement(3), // bars 33–40: octave doubling under the lead
  '@1',
  themeBar(3),
  answerBar(3), // bars 41–42
  'F#4/2 r/2 | F#4/2 r/2 | F#4/2 r/2 | F#4/2 F#4/2 | F#4/2 F#4/2 | D5/1 |', // 43–48
].join(' ')

const BASS = [
  '@0.4',
  statement(1), // bars 1–8: the theme creeps in at the bottom
  '@0.52',
  WALK8, // bars 9–16
  '@0.6',
  WALK8, // bars 17–24
  '@0.72',
  WALK8, // bars 25–32
  '@0.85',
  DRIVE8, // bars 33–40
  '@1',
  'B1/4 B1 B1 B1 | B1/4 B1 B1 B1 |', // bars 41–42
  'B1/2 r/2 | B1/2 r/2 | B1/2 r/2 | B1/2 B1/2 | B1/2 B1/2 | B1/1 |', // 43–48
].join(' ')

const PERC = [
  rest4(20), // bars 1–20: tacet until the third tempo notch
  '@0.6',
  'C#3/4 D2 B1 D2 |', // bar 21: cymbal marks the entry
  Array.from({ length: 11 }, () => 'B1/4 D2 B1 D2 |').join(' '), // bars 22–32
  '@0.8',
  'C#3/4 D2 B1 D2 |', // bar 33
  Array.from({ length: 6 }, () => 'B1/4 D2 B1 D2 |').join(' '), // bars 34–39
  'B1/8 B1 D2 D2 D2 D2 D2 D2 |', // bar 40: roll into the finale
  '@0.9',
  'B1/4 D2 B1 D2 | B1/4 D2 B1 D2 |', // bars 41–42
  '@1',
  'B1/2 r/2 | B1/2 r/2 | B1/2 r/2 | B1/2 B1/2 | B1/2 B1/2 | C#3/1 |', // 43–48
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BRASS, 1, parseDefaults),
  ...parseVoice(BASS, 2, parseDefaults),
  ...parseVoice(PERC, 3, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const mountainKing: Score = {
  id: 'mountainKing',
  title: 'In the Hall of the Mountain King',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // Six statement starts, ramping with the accelerando.
    annotate(TEMPO, 'accent', 1, 1, 0.4, 'creep'),
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 9, 1, 0.5, 'stalk'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 17, 1, 0.6, 'pursuit'),
    annotate(TEMPO, 'phrase', 25, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 25, 1, 0.7, 'quarry'),
    annotate(TEMPO, 'phrase', 33, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 33, 1, 0.85, 'frenzy'),
    annotate(TEMPO, 'phrase', 41, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 41, 1, 0.95, 'rampage'),
    // Eight accelerating hammer chords: bar-wise, then half-bar-wise.
    annotate(TEMPO, 'hit', 43, 1, 0.9, 'stomp'),
    annotate(TEMPO, 'hit', 44, 1, 0.9, 'stomp'),
    annotate(TEMPO, 'hit', 45, 1, 0.9, 'stomp'),
    annotate(TEMPO, 'hit', 45, 1, 0.9, 'shriek'),
    annotate(TEMPO, 'hit', 46, 1, 0.9, 'stomp'),
    annotate(TEMPO, 'hit', 46, 3, 0.9, 'stomp'),
    annotate(TEMPO, 'hit', 47, 1, 0.9, 'stomp'),
    annotate(TEMPO, 'hit', 47, 3, 0.9, 'stomp'),
    // The suite's single strength-1.0 climax, on the closing chord.
    annotate(TEMPO, 'climax', 48, 1, 1, 'summit'),
    annotate(TEMPO, 'hit', 48, 1, 0.9, 'stomp'),
    annotate(TEMPO, 'phrase', 49, 1, 0.6, 'phraseEnd'),
  ],
}
