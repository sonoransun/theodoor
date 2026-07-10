/**
 * scores/jupiterHymn.ts — 36-bar, 3-voice arrangement of the Thaxted hymn
 * from Holst's Jupiter (published 1921; public-domain work, this arrangement
 * is Theodoor's own), in C major.
 *
 * Structure, 3/4 at 76 bpm — the 16-bar hymn stated twice, plus a coda:
 *   bars  1–16  first statement, warm (lead + bass)     accent 'thaxted'
 *   bars 17–32  second statement, fortissimo, bells
 *               doubling the melody an octave up        climax 'jovian' 1.0
 *                                                       at the bar-29 peak
 *   bars 33–36  coda: one last ascent into the held
 *               final chord (bars 35–36)                hit 'perihelion'
 * Phrase ends every 8 bars.
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [{ beat: 0, bpm: 76 }],
  meters: [{ bar: 1, beatsPerBar: 3 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

// The 16-bar hymn: two gentle 4-bar lines, the rising middle, then the
// peak phrase — bar 13's downbeat high C is the tune's summit.
const HYMN = [
  'E4/8 F4/8 G4/4. A4/8 | G4/4 E4/4 C4/4 | A3/4. B3/8 C4/4 | D4/2. |',
  'E4/8 F4/8 G4/4. A4/8 | G4/4 E4/4 C4/4 | D4/4. C4/8 D4/4 | C4/2. |',
  'G4/4 A4/8 B4/8 C5/4 | B4/4 A4/4 G4/4 | A4/4. G4/8 F4/4 | G4/2. |',
  'C5/4. B4/8 A4/4 | G4/4 A4/8 B4/8 C5/4 | E4/4. F4/8 D4/4 | C4/2. |',
].join(' ')

const HYMN_BASS = [
  'C2/2. | C2/2 G2/4 | F2/2. | G2/2. |',
  'C2/2. | A2/2 E2/4 | F2/2 G2/4 | C2/2. |',
  'E2/2. | G2/2. | F2/2. | C2/2 G2/4 |',
  'A2/2. | E2/2 G2/4 | F2/2 G2/4 | C2/2. |',
].join(' ')

// Coda, bars 33–36: one last ascent, then the held final chord.
const CODA = 'E4/4 F4 G4 | A4/4 B4 D5 | C5/2. | ~C5/2. |'
const CODA_BASS = 'F2/2. | G2/2. | C2/2. | ~C2/2. |'

/** Transpose a section string up one octave (bells doubling). */
const up8 = (section: string): string =>
  section.replace(/([A-G][#b]?)(\d)/g, (_m, p, o) => `${p}${Number(o) + 1}`)

const REST16 = [
  'r/2. | r/2. | r/2. | r/2. | r/2. | r/2. | r/2. | r/2. |',
  'r/2. | r/2. | r/2. | r/2. | r/2. | r/2. | r/2. | r/2. |',
].join(' ')

const LEAD = ['@0.62', HYMN, '@0.92', HYMN, '@0.95', CODA].join(' ')

const BASS = ['@0.6', HYMN_BASS, '@0.85', HYMN_BASS, '@0.9', CODA_BASS].join(' ')

const BELLS = [
  REST16, // bars 1–16: tacet through the warm statement
  '@0.9',
  up8(HYMN), // bars 17–32: double the melody an octave up
  '@0.95',
  up8(CODA), // bars 33–36
].join(' ')

const parseDefaults = { meters: TEMPO.meters }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const jupiterHymn: Score = {
  id: 'jupiterHymn',
  title: 'Jupiter — Thaxted Hymn',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    annotate(TEMPO, 'accent', 1, 1, 0.6, 'thaxted'),
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 25, 1, 0.6, 'phraseEnd'),
    // THE suite climax, strength 1.0: the second statement's bar-13 summit.
    annotate(TEMPO, 'climax', 29, 1, 1, 'jovian'),
    annotate(TEMPO, 'phrase', 33, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 35, 1, 0.9, 'perihelion'),
    annotate(TEMPO, 'phrase', 37, 1, 0.6, 'phraseEnd'),
  ],
}
