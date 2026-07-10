/**
 * scores/blueDanube.ts — 64-bar, 3-voice arrangement of the opening waltz
 * chain of Johann Strauss II's The Blue Danube (1866; public-domain work,
 * this arrangement is Theodoor's own), in C major.
 *
 * Structure, 3/4 at 144 bpm — oom-pah-pah bass throughout, melody in the
 * lead, the famous echo notes in the bells:
 *   bars  1–4    shimmer intro                        accent 'liftoff'
 *   bars  5–20   waltz 1A: rising triads + echoes     accent 'orbit'
 *   bars 21–36   waltz 1B                             accent 'orbit'
 *   bars 37–52   waltz 2: the flowing second strain   accent 'orbit'
 *   bars 53–64   cadence, peaking at bar 56           accent 'orbit',
 *                                                     climax 'waltzPeak' 0.8
 * The echo pairs land as hit 'twirl' x8; phrase ends every 8 bars from 13.
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [{ beat: 0, bpm: 144 }],
  meters: [{ bar: 1, beatsPerBar: 3 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

/** Four full-bar rests (a dotted half each — sticky durations stay honest). */
const REST4 = 'r/2. | r/2. | r/2. | r/2. |'

const LEAD = [
  // Shimmer intro, bars 1–4: long horn tones under the bells' twinkle.
  '@0.5 C4/2. | E4/2. | G4/2. | ~G4/2. |',
  // Waltz 1A, bars 5–20: rising-triad calls answered by the bell echoes.
  '@0.68',
  'C4/4 E4 G4 | G4/2. | C4/4 E4 G4 | G4/2. |',
  REST4,
  'C4/4 F4 A4 | A4/2. | C4/4 F4 A4 | A4/2. |',
  REST4,
  // Waltz 1B, bars 21–36.
  '@0.72',
  'D4/4 G4 B4 | B4/2. | D4/4 G4 B4 | B4/2. |',
  REST4,
  'E4/4 G4 C5 | C5/2. | E4/4 G4 C5 | C5/2. |',
  REST4,
  // Waltz 2, bars 37–52: the flowing strain, two 8-bar sweeps.
  '@0.76',
  'E4/2 G4/4 | C5/2. | B4/2 A4/4 | G4/2. |',
  'A4/2 B4/4 | C5/2. | D5/2 C5/4 | B4/2. |',
  'E4/2 G4/4 | C5/2. | B4/2 A4/4 | G4/2. |',
  'A4/2 G4/4 | F4/2. | E4/2 D4/4 | C4/2. |',
  // Cadence, bars 53–64: climb to the bar-56 peak, then settle home.
  '@0.8 E4/4 G4 C5 | E5/2. | G5/2. | @0.85 C6/2. |',
  '@0.78 G5/2 E5/4 | C5/2. | D5/2 B4/4 | C5/2. |',
  '@0.7 E4/4 G4 C5 | G4/2. | E4/2 D4/4 | C4/2. |',
].join(' ')

/** One oom-pah-pah bar per harmony letter: root, then the fifth above twice. */
const OOM: Record<string, string> = {
  C: 'C2/4 G2 G2 |',
  F: 'F2/4 C3 C3 |',
  G: 'G2/4 D3 D3 |',
  A: 'A2/4 E3 E3 |',
}
const oomPah = (harmony: string): string =>
  [...harmony.replace(/\s+/g, '')].map((chord) => OOM[chord]!).join(' ')

const BASS = [
  // Intro pedal, bars 1–4.
  '@0.5 C2/2. | ~C2/2. | G2/2. | ~G2/2. |',
  '@0.58',
  oomPah('CCCC GGCC FFFF FFCC'), // waltz 1A, bars 5–20
  '@0.62',
  oomPah('GGGG GGGG CCCC CCGG'), // waltz 1B, bars 21–36
  '@0.66',
  oomPah('CCGC GCGG CCGC FFGC'), // waltz 2, bars 37–52
  '@0.72',
  oomPah('CAGC CCGC CCG'), // cadence, bars 53–63
  'C2/2. |', // bar 64 — settled close
].join(' ')

const BELLS = [
  // Shimmer intro, bars 1–4: eighth-note twinkle circling the tonic triad.
  '@0.45',
  'E5/8 G5 C6 G5 E5 G5 | E5/8 G5 C6 G5 E5 G5 |',
  'G5/8 C6 E6 C6 G5 C6 | E6/8 C6 G5 C6 E6 G6 |',
  // Waltz 1A echoes, bars 5–20 (pairs at 9/11 and 17/19).
  REST4,
  '@0.6 G5/4 G5 r | r/2. | E5/4 E5 r | r/2. |',
  REST4,
  'A5/4 A5 r | r/2. | F5/4 F5 r | r/2. |',
  // Waltz 1B echoes, bars 21–36 (pairs at 25/27 and 33/35).
  REST4,
  '@0.65 B5/4 B5 r | r/2. | G5/4 G5 r | r/2. |',
  REST4,
  'C6/4 C6 r | r/2. | G5/4 G5 r | r/2. |',
  // Waltz 2, bars 37–52: tacet.
  REST4,
  REST4,
  REST4,
  REST4,
  // Cadence: one high shimmer on the peak, then the settled close.
  'r/2. | r/2. | r/2. | @0.8 E6/2. |',
  REST4,
  'r/2. | r/2. | r/2. |',
  '@0.6 C6/2. |',
].join(' ')

const parseDefaults = { meters: TEMPO.meters }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const blueDanube: Score = {
  id: 'blueDanube',
  title: 'The Blue Danube',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    annotate(TEMPO, 'accent', 1, 1, 0.6, 'liftoff'),
    annotate(TEMPO, 'accent', 5, 1, 0.65, 'orbit'),
    annotate(TEMPO, 'hit', 9, 1, 0.5, 'twirl'),
    annotate(TEMPO, 'hit', 11, 1, 0.5, 'twirl'),
    annotate(TEMPO, 'phrase', 13, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 17, 1, 0.5, 'twirl'),
    annotate(TEMPO, 'hit', 19, 1, 0.5, 'twirl'),
    annotate(TEMPO, 'phrase', 21, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 21, 1, 0.68, 'orbit'),
    annotate(TEMPO, 'hit', 25, 1, 0.5, 'twirl'),
    annotate(TEMPO, 'hit', 27, 1, 0.5, 'twirl'),
    annotate(TEMPO, 'phrase', 29, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 33, 1, 0.5, 'twirl'),
    annotate(TEMPO, 'hit', 35, 1, 0.5, 'twirl'),
    annotate(TEMPO, 'phrase', 37, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 37, 1, 0.72, 'orbit'),
    annotate(TEMPO, 'phrase', 45, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 53, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 53, 1, 0.75, 'orbit'),
    // The one climax — damped to 0.8 (the suite's 1.0 lives in jupiterHymn).
    annotate(TEMPO, 'climax', 56, 1, 0.8, 'waltzPeak'),
    annotate(TEMPO, 'phrase', 61, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 65, 1, 0.6, 'phraseEnd'),
  ],
}
