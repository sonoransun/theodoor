/**
 * scores/clairDeLune.ts — 32-bar, 3-voice abridgment of Debussy's Clair de
 * Lune (1905; public-domain work; this arrangement is Theodoor's own),
 * transposed to C major. The heart of the quiet midsummer suite and the one
 * score in it carrying a strength-1 climax.
 *
 * COMPOUND METER: the 9/8 is notated as beatsPerBar 9 with the DSL beat = one
 * eighth note, so '/4' = eighth, '/2' = quarter, '/2.' = dotted quarter and
 * '/1.' = dotted half. Tempo is per DSL beat (per eighth); Debussy's rubato
 * is real tempo segments — the opening 116 flows forward through the climb
 * and the arpeggio peak, then relaxes for the return, landing the whole
 * abridgment near the ~100 s target.
 *
 * Structure:
 *   bars  1–8   opening theme, andante (eighth = 116)
 *   bars  9–16  the climb, poco mosso (eighth = 180) — bells arpeggios stir
 *   bars 17–24  arpeggio peak, en animant (eighth = 216) — zenith at bar 21
 *   bars 25–32  the return, calmato (eighth = 152) — hushed reprise
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [
    { beat: 0, bpm: 116 }, // andante, bars 1–8
    { beat: 72, bpm: 180 }, // poco mosso, bars 9–16
    { beat: 144, bpm: 216 }, // en animant, bars 17–24
    { beat: 216, bpm: 152 }, // calmato, bars 25–32
  ],
  meters: [{ bar: 1, beatsPerBar: 9 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

// A 9-beat bar of rest needs two tokens: dotted half + dotted quarter.
const restBars = (n: number): string => Array.from({ length: n }, () => 'r/1. r/2. |').join(' ')

// The melody rides descending thirds in the opening (the "thirds feel" is a
// single-line reading: each gesture falls a third and curls back).
const OPENING =
  'r/4 G5/2 E5/2 D5/2 E5/2 | C5/1. D5/2 E5/4 | F5/2. E5/2. D5/2. | E5/1. ~E5/2. |'

const LEAD = [
  '@0.45',
  OPENING, // bars 1–4
  'r/4 A5/2 G5/2 F5/2 G5/2 | E5/1. F5/2 G5/4 | A5/2. G5/2. F5/2. | G5/1. ~G5/2. |', // bars 5–8
  '@0.55',
  'A4/2. C5/2. E5/2. | D5/1. C5/2. |', // bars 9–10: the climb begins
  'B4/2. D5/2. F5/2. | E5/1. D5/2. |', // bars 11–12
  'C5/2. E5/2. G5/2. | F5/1. E5/2. |', // bars 13–14
  'D5/2. F5/2. A5/2. | G5/1. ~G5/2. |', // bars 15–16
  '@0.7',
  'E5/2. G5/2. C6/2. | B5/1. A5/2. |', // bars 17–18: over the arpeggios
  'F5/2. A5/2. D6/2. | C6/1. B5/2. |', // bars 19–20
  '@0.78',
  'E6/1. D6/2. |', // bar 21: zenith — the peak of the whole suite
  '@0.65',
  'C6/2. B5/2. A5/2. | G5/2. F5/2. E5/2. | D5/1. ~D5/2. |', // bars 22–24
  '@0.42',
  OPENING, // bars 25–28: the return, hushed
  'D5/2. C5/2. A4/2. | G4/1. A4/2. |', // bars 29–30
  'C5/1. ~C5/2. | ~C5/1. ~C5/2. |', // bars 31–32: held final do
].join(' ')

// Low tenths: root held a dotted half, the tenth above closing each bar.
const BASS = [
  '@0.4',
  'C2/1. E3/2. | A2/1. C4/2. | F2/1. A3/2. | C2/1. E3/2. |', // bars 1–4
  'F2/1. A3/2. | C2/1. E3/2. | D2/1. F3/2. | C2/1. E3/2. |', // bars 5–8
  '@0.45',
  'A2/1. C4/2. | F2/1. A3/2. | G2/1. B3/2. | C2/1. E3/2. |', // bars 9–12
  'A2/1. C4/2. | F2/1. A3/2. | D2/1. F3/2. | G2/1. B3/2. |', // bars 13–16
  '@0.5',
  'C2/1. E3/2. | G2/1. B3/2. | D2/1. F3/2. | A2/1. C4/2. |', // bars 17–20
  'F2/1. A3/2. | C2/1. E3/2. | G2/1. B3/2. | G2/1. B3/2. |', // bars 21–24
  '@0.35',
  'C2/1. E3/2. | A2/1. C4/2. | F2/1. A3/2. | C2/1. E3/2. |', // bars 25–28
  'F2/1. A3/2. | G2/1. B3/2. | C2/1. ~C2/2. | ~C2/1. ~C2/2. |', // bars 29–32
].join(' ')

const BELLS = [
  restBars(8), // bars 1–8: tacet
  '@0.4',
  'A3/2. C4/2. E4/2. | F3/2. A3/2. C4/2. |', // bars 9–10: broad arps stir
  'G3/2. B3/2. D4/2. | C4/2. E4/2. G4/2. |', // bars 11–12
  'A3/2. C4/2. E4/2. | F3/2. A3/2. C4/2. |', // bars 13–14
  'D4/2. F4/2. A4/2. | G3/2. B3/2. D4/2. |', // bars 15–16
  '@0.6',
  'C4/4 E4 G4 C5 G4 E4 C4 E4 G4 | B3/4 D4 G4 B4 G4 D4 B3 D4 G4 |', // bars 17–18
  'F3/4 A3 D4 F4 D4 A3 F3 A3 D4 | A3/4 C4 E4 A4 E4 C4 A3 C4 E4 |', // bars 19–20
  '@0.68',
  'F4/4 A4 C5 F5 C5 A4 F4 A4 C5 |', // bar 21: zenith arpeggio
  '@0.6',
  'E4/4 G4 C5 E5 C5 G4 E4 G4 C5 | D4/4 G4 B4 D5 B4 G4 D4 G4 B4 |', // bars 22–23
  'B3/4 D4 F4 G4 F4 D4 B3 D4 F4 |', // bar 24
  '@0.35',
  restBars(3), // bars 25–27
  'G5/1. ~G5/2. |', // bar 28: one soft high echo
  restBars(2), // bars 29–30
  'E5/1. ~E5/2. | ~E5/1. ~E5/2. |', // bars 31–32: held with the lead
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const clairDeLune: Score = {
  id: 'clairDeLune',
  title: 'Clair de Lune',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    annotate(TEMPO, 'accent', 1, 1, 0.5, 'moonrise'),
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
    // Eight shimmers, one per arpeggio-peak bar.
    annotate(TEMPO, 'hit', 17, 1, 0.4, 'shimmer'),
    annotate(TEMPO, 'hit', 18, 1, 0.4, 'shimmer'),
    annotate(TEMPO, 'hit', 19, 1, 0.4, 'shimmer'),
    annotate(TEMPO, 'hit', 20, 1, 0.4, 'shimmer'),
    annotate(TEMPO, 'hit', 21, 1, 0.4, 'shimmer'),
    // The suite's single strength-1 climax.
    annotate(TEMPO, 'climax', 21, 1, 1, 'zenith'),
    annotate(TEMPO, 'hit', 22, 1, 0.4, 'shimmer'),
    annotate(TEMPO, 'hit', 23, 1, 0.4, 'shimmer'),
    annotate(TEMPO, 'hit', 24, 1, 0.4, 'shimmer'),
    annotate(TEMPO, 'phrase', 25, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 25, 1, 0.4, 'hush'),
    annotate(TEMPO, 'phrase', 33, 1, 0.6, 'phraseEnd'),
  ],
}
