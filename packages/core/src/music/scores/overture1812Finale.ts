/**
 * scores/overture1812Finale.ts — 56-bar, 5-voice arrangement of the finale of
 * Tchaikovsky's 1812 Overture (public-domain work; melody/harmony after
 * Tchaikovsky, this arrangement is Theodoor's own), in C major.
 *
 * Structure — real tempo AND meter variety (exercises TempoMapData):
 *   bars  1–8   Largo 4/4 @ 60          brass-chorale hymn, majestic @0.7
 *   bars  9–24  Allegro vivace 4/4 @138 descending-run motif +
 *                                       'La Marseillaise' fragment quotes
 *   bars 25–32  bell peal 3/4 @138      cascading bells @0.9
 *   bars 33–40  Allegro reprise 4/4 @138 runs building toward the coda
 *   bars 41–56  coda 4/4 @144           the hymn fortissimo over runs;
 *                                       the famous cannon volley
 *
 * Sixteen cannons — 'hit' annotations labeled 'cannon', strength 1: five
 * spread through the Allegro on offbeats (bars 11, 15, 22, 27, 35), eleven
 * in the coda (every 2 bars, then accelerating: 41 43 45 47 49 51 53 54 55
 * 55.3 56). Each cannon doubles a perc note (midi 57) at velocity 1.0 on the
 * same bar:beat so the synth thunders where the big shells land.
 *
 * Perc pitch map (GM drums): B1 = 35 kick, D2 = 38 snare, C#3 = 49 cymbal,
 * A3 = 57 cannon.
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [
    { beat: 0, bpm: 60 }, // Largo hymn, bars 1–8
    { beat: 32, bpm: 138 }, // Allegro vivace, bars 9–40
    { beat: 152, bpm: 144 }, // coda, bars 41–56
  ],
  meters: [
    { bar: 1, beatsPerBar: 4 },
    { bar: 25, beatsPerBar: 3 }, // bell-peal passage
    { bar: 33, beatsPerBar: 4 },
  ],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'brass', program: 'brass' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
  { name: 'perc', program: 'perc' },
]

// --------------------------------------------------------------------------
// Voice 0 — lead
// --------------------------------------------------------------------------

const LEAD = [
  // Largo hymn, bars 1–8 (majestic).
  '@0.7',
  'E4/4 E4 F4 G4 | G4/2 F4 | E4/4 D4 C4 D4 | E4/2. r/4 |',
  'F4/4 F4 E4 D4 | E4/4 F4 G4/2 | E4/4 D4 C4/2 | ~C4/1 |',
  // Allegro vivace, bars 9–16: descending runs, then the Marseillaise quote.
  '@0.78',
  'C5/8 B4 A4 G4 F4 E4 D4 C4 | B4/8 A4 G4 F4 E4 D4 C4 B3 |',
  'C5/8 D5 C5 B4 A4 G4 F4 E4 | F4/8 E4 D4 C4 G3/4 G4/8. G4/16 |',
  'C5/4 C5 D5 D5 | G5/2 E5/4. C5/8 | E5/4. C5/8 G4/4 G4/8 G4/8 | E5/2 C5/4 G4 |',
  // Bars 17–24: sequenced runs, second (higher) Marseillaise quote.
  '@0.82',
  'G5/8 F5 E5 D5 C5 B4 A4 G4 | A5/8 G5 F5 E5 D5 C5 B4 A4 |',
  'B5/8 A5 G5 F5 E5 D5 C5 B4 | C5/4 E5 G5 C6 |',
  '@0.86',
  'G5/4 G5 A5 A5 | C6/2 A5/4. F5/8 | G5/4. E5/8 C5/4 E5/8 F5/8 | G5/2 G4/2 |',
  // Bell peal, bars 25–32 (3/4): long tones under the bells.
  'C5/2. | ~C5/2. | G4/2. | ~G4/2. | A4/2. | F4/2. | G4/2. | ~G4/2. |',
  // Allegro reprise, bars 33–40: runs building.
  '@0.88',
  'C6/8 B5 A5 G5 F5 E5 D5 C5 | B5/8 A5 G5 F5 E5 D5 C5 B4 |',
  'C6/8 B5 A5 G5 A5 G5 F5 E5 | F5/8 E5 D5 C5 D5 C5 B4 A4 |',
  '@0.9',
  'G4/8 A4 B4 C5 D5 E5 F5 G5 | A5/8 B5 C6 D6 C6 B5 A5 G5 |',
  'G5/4 G5 G5/8 G5/8 G5/4 | G5/2 r/2 |',
  // Coda, bars 41–56: perpetual runs against the fortissimo hymn.
  '@0.95',
  'C6/8 B5 A5 G5 F5 E5 D5 C5 | D5/8 E5 F5 G5 A5 B5 C6 D6 |',
  'E6/8 D6 C6 B5 A5 G5 F5 E5 | F5/8 G5 A5 B5 C6 B5 A5 G5 |',
  'C6/8 B5 A5 G5 F5 E5 D5 C5 | B4/8 C5 D5 E5 F5 G5 A5 B5 |',
  'C6/8 D6 C6 B5 A5 G5 F5 E5 | D5/8 E5 F5 E5 D5 C5 B4 D5 |',
  'C5/8 D5 E5 F5 G5 A5 B5 C6 | D6/8 C6 B5 A5 G5 F5 E5 D5 |',
  'E5/8 F5 G5 A5 B5 C6 D6 E6 | F6/8 E6 D6 C6 B5 A5 G5 F5 |',
  'E5/4 G5 C6 E6 | F6/4 E6 D6 C6 | G5/4 G5 G5 G5 | C6/1 |',
].join(' ')

// --------------------------------------------------------------------------
// Voice 1 — brass
// --------------------------------------------------------------------------

const BRASS = [
  // Largo hymn, bars 1–8: chorale harmony under the lead.
  '@0.7',
  'C4/4 C4 D4 E4 | E4/2 D4 | C4/4 B3 A3 B3 | C4/2. r/4 |',
  'D4/4 D4 C4 B3 | C4/4 D4 E4/2 | C4/4 B3 G3/2 | ~G3/1 |',
  // Allegro, bars 9–16: punched chords, then Marseillaise harmony.
  '@0.75',
  'C4/4 r C4 r | G3/4 r G3 r | A3/4 r A3 r | F3/4 F3 G3/2 |',
  'E4/4 E4 F4 F4 | E4/2 C4/4. E4/8 | C4/4. E4/8 E4/4 E4/8 E4/8 | C4/2 E4/4 E4 |',
  // Bars 17–24: answers, then the higher quote.
  '@0.8',
  'E4/4 r E4 r | F4/4 r F4 r | G4/4 r G4 r | E4/4 G4 C5 E5 |',
  '@0.85',
  'E5/4 E5 F5 F5 | E5/2 C5/4. A4/8 | E5/4. C5/8 G4/4 C5/4 | E5/2 E4/2 |',
  // Bell peal, bars 25–32: soft pads.
  '@0.6',
  'E4/2. | ~E4/2. | E4/2. | ~E4/2. | F4/2. | A4/2. | B4/2. | ~B4/2. |',
  // Allegro reprise, bars 33–40: fanfare hits into the dominant.
  '@0.85',
  'C5/4 r C5 r | G4/4 r G4 r | A4/4 r A4 r | F4/4 F4 G4 A4 |',
  'B4/2 C5/2 | D5/2 E5/2 | G4/4 G4 G4/8 G4/8 G4/4 | G4/2 G4/4 G4 |',
  // Coda, bars 41–56: THE HYMN, fortissimo.
  '@0.98',
  'E5/2 D5/4 C5/4 | D5/2 E5/2 | F5/2 E5/4 D5/4 | E5/2 C5/2 |',
  'G5/2 F5/4 E5/4 | F5/2 E5/4 D5/4 | E5/2. D5/4 | C5/1 |',
  'E5/2 D5/4 C5/4 | D5/2 E5/2 | F5/2 G5/2 | A5/2 G5/4 F5/4 |',
  'E5/2 G5/2 | A5/2 B5/2 | C6/4 G5 E5 G5 | C5/1 |',
].join(' ')

// --------------------------------------------------------------------------
// Voice 2 — bass
// --------------------------------------------------------------------------

const BASS = [
  // Largo hymn, bars 1–8.
  '@0.7',
  'C2/2 G2 | C3/2 G2 | A2/2 G2 | C2/2. r/4 |',
  'D2/2 G2 | A2/4 B2/4 C3/2 | G2/2 G2 | C2/1 |',
  // Allegro, bars 9–24: driving quarters.
  '@0.8',
  'C2/4 C2 C2 C2 | G2/4 G2 G2 G2 | A2/4 A2 A2 A2 | F2/4 F2 G2 G2 |',
  'C2/4 G2 C2 G2 | C2/4 G2 C2 G2 | C2/4 G2 C2 G2 | C2/4 E2 G2 C3 |',
  'C2/4 C2 C2 C2 | F2/4 F2 F2 F2 | G2/4 G2 G2 G2 | C2/4 E2 G2 C3 |',
  'C2/4 G2 C2 G2 | F2/4 C3 F2 C3 | C2/4 G2 C2 G2 | C2/2 C2 |',
  // Bell peal, bars 25–32: tolling low bells.
  'C2/2. | C2/2. | C2/2. | C2/2. | F2/2. | F2/2. | G2/2. | G2/2. |',
  // Allegro reprise, bars 33–40.
  '@0.85',
  'C2/4 C2 C2 C2 | G2/4 G2 G2 G2 | A2/4 A2 A2 A2 | F2/4 F2 F2 F2 |',
  'G2/4 G2 G2 G2 | G2/4 G2 G2 G2 | G2/4 G2 G2/8 G2/8 G2/4 | G2/2 G2 |',
  // Coda, bars 41–56: hymn roots.
  '@0.95',
  'C2/4 C2 C2 C2 | G2/4 G2 G2 G2 | F2/4 F2 F2 F2 | C2/4 C2 C2 C2 |',
  'E2/4 E2 E2 E2 | F2/4 F2 D2 D2 | C2/4 C2 G2 G2 | C2/4 C2 C2 C2 |',
  'C2/4 C2 C2 C2 | G2/4 G2 G2 G2 | F2/4 F2 E2 E2 | F2/4 F2 G2 G2 |',
  'C2/4 C2 E2 E2 | F2/4 F2 G2 G2 | C2/4 G2 C2 G2 | C2/1 |',
].join(' ')

// --------------------------------------------------------------------------
// Voice 3 — bells
// --------------------------------------------------------------------------

const BELLS = [
  // Bars 1–24: tacet.
  'r/1 | r | r | r | r | r | r | r |',
  'r | r | r | r | r | r | r | r |',
  'r | r | r | r | r | r | r | r |',
  // Bell peal, bars 25–32 (3/4): cascading peals over rotating chords.
  '@0.9',
  'C6/8 G5 E5 C6 G5 E5 | B5/8 G5 D5 B5 G5 D5 | C6/8 A5 F5 C6 A5 F5 | C6/8 G5 E5 C6 G5 E5 |',
  'D6/8 A5 F5 D6 A5 F5 | C6/8 A5 F5 C6 A5 F5 | B5/8 G5 D5 B5 G5 D5 | C6/8 G5 E5 C6 G5 E5 |',
  // Allegro reprise, bars 33–40: broader peals in quarters.
  'C6/4 G5 E5 G5 | B5/4 G5 D5 G5 | C6/4 A5 F5 A5 | D6/4 A5 F5 A5 |',
  'G5/4 B5 D6 G5 | E6/4 C6 G5 C6 | G5/4 G5 G5/8 G5/8 G5/4 | r/1 |',
  // Coda, bars 41–56: full peal against the hymn.
  '@0.92',
  'C6/8 G5 E5 G5 C6 G5 E5 G5 | B5/8 G5 D5 G5 B5 G5 D5 G5 |',
  'A5/8 F5 C5 F5 A5 F5 C5 F5 | C6/8 G5 E5 G5 C6 G5 E5 G5 |',
  'C6/8 G5 E5 G5 C6 G5 E5 G5 | D6/8 A5 F5 A5 D6 A5 F5 A5 |',
  'C6/8 G5 E5 G5 B5 G5 D5 G5 | C6/8 G5 E5 G5 C6 G5 E5 G5 |',
  'C6/8 G5 E5 G5 C6 G5 E5 G5 | B5/8 G5 D5 G5 B5 G5 D5 G5 |',
  'A5/8 F5 C5 F5 A5 F5 C5 F5 | D6/8 A5 F5 A5 D6 B5 G5 B5 |',
  'C6/4 E6 G5 C6 | D6/4 F6 A5 D6 | E6/4 C6 G5 E6 | C6/1 |',
].join(' ')

// --------------------------------------------------------------------------
// Voice 4 — perc (B1 kick, D2 snare, C#3 cymbal, A3 cannon)
// --------------------------------------------------------------------------

const PERC = [
  // Largo, bars 1–8: tacet.
  'r/1 | r | r | r | r | r | r | r |',
  // Allegro, bars 9–24: kick/snare drive; offbeat cannons at 11:3.5 and 15:2.5
  // and 22:4.5 (velocity 1, restored after).
  '@0.85 C#3/4 @0.7 D2 B1 D2 | B1/4 D2 B1 D2 |',
  'B1/4 D2 B1/8 @1 A3/8 @0.7 D2/4 | B1/4 D2 B1 D2 |',
  'B1/4 D2 B1 D2 | B1/4 D2 B1 D2 |',
  'B1/4 D2/8 @1 A3/8 @0.7 B1/4 D2/4 | B1/4 D2 B1 D2 |',
  'B1/4 D2 B1 D2 | B1/4 D2 B1 D2 | B1/4 D2 B1 D2 |',
  'B1/4 D2 B1/8 D2/8 D2/4 | B1/4 D2 B1 D2 |',
  'B1/4 D2 B1 D2/8 @1 A3/8 @0.7 | B1/4 D2 B1 D2 |',
  'B1/4 D2/4 D2/8 D2/8 D2/8 D2/8 |',
  // Bell peal, bars 25–32 (3/4): sparse strokes; cannon at 27:2.5.
  '@0.75 C#3/4 r/2 | B1/4 r/2 |',
  'B1/4 r/8 @1 A3/8 @0.75 r/4 | B1/4 r/2 |',
  'B1/4 r/2 | B1/4 r/2 | B1/4 r/2 | B1/4 D2/4 D2/4 |',
  // Allegro reprise, bars 33–40: cannon at 35:3.5, roll into the coda.
  '@0.8 C#3/4 D2 B1 D2 | B1/4 D2 B1 D2 |',
  'B1/4 D2 B1/8 @1 A3/8 @0.8 D2/4 | B1/4 D2 B1 D2 |',
  'B1/4 D2 B1 D2 | B1/4 D2 B1 D2 |',
  'B1/4 D2 D2/8 D2/8 D2/4 | D2/8 D2 D2 D2 D2 D2 D2 D2 |',
  // Coda, bars 41–56: the volley — cannons on 41 43 45 47 49 51, then
  // accelerating 53 54 55:1 55:3 and the final one under the last chord.
  '@1 A3/4 @0.9 D2 B1 D2 | B1/4 D2 B1 D2 |',
  '@1 A3/4 @0.9 D2 B1 D2 | B1/4 D2 B1 D2 |',
  '@1 A3/4 @0.9 D2 B1 D2 | B1/4 D2 B1 D2 |',
  '@1 A3/4 @0.9 D2 B1 D2 | B1/4 D2 D2/8 D2/8 D2/4 |',
  '@1 A3/4 @0.9 D2 B1 D2 | B1/4 D2 B1 D2 |',
  '@1 A3/4 @0.9 D2 B1 D2 | B1/4 D2 D2/8 D2/8 D2/4 |',
  '@1 A3/4 @0.9 D2 B1 D2 | @1 A3/4 @0.9 D2 B1 D2 |',
  '@1 A3/4 @0.9 D2 @1 A3/4 @0.9 D2 | @1 A3/1 |',
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BRASS, 1, parseDefaults),
  ...parseVoice(BASS, 2, parseDefaults),
  ...parseVoice(BELLS, 3, parseDefaults),
  ...parseVoice(PERC, 4, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const overture1812Finale: Score = {
  id: 'overture1812Finale',
  title: '1812 Overture — Finale',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // Section-start accents.
    annotate(TEMPO, 'accent', 1, 1, 0.6, 'largoHymn'),
    // Phrase boundaries (downbeat closing each phrase).
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 9, 1, 0.8, 'allegroVivace'),
    // Five Allegro cannons on offbeats.
    annotate(TEMPO, 'hit', 11, 3.5, 1, 'cannon'),
    annotate(TEMPO, 'hit', 15, 2.5, 1, 'cannon'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 22, 4.5, 1, 'cannon'),
    annotate(TEMPO, 'phrase', 25, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 25, 1, 0.85, 'bellPeal'),
    annotate(TEMPO, 'hit', 27, 2.5, 1, 'cannon'),
    annotate(TEMPO, 'phrase', 33, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 33, 1, 0.9, 'allegroReprise'),
    annotate(TEMPO, 'hit', 35, 3.5, 1, 'cannon'),
    // Coda: the eleven-cannon volley — every 2 bars, then accelerating.
    annotate(TEMPO, 'phrase', 41, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 41, 1, 0.95, 'codaHymn'),
    annotate(TEMPO, 'hit', 41, 1, 1, 'cannon'),
    annotate(TEMPO, 'hit', 43, 1, 1, 'cannon'),
    annotate(TEMPO, 'hit', 45, 1, 1, 'cannon'),
    annotate(TEMPO, 'hit', 47, 1, 1, 'cannon'),
    annotate(TEMPO, 'phrase', 49, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 49, 1, 1, 'cannon'),
    annotate(TEMPO, 'hit', 51, 1, 1, 'cannon'),
    annotate(TEMPO, 'hit', 53, 1, 1, 'cannon'),
    annotate(TEMPO, 'hit', 54, 1, 1, 'cannon'),
    annotate(TEMPO, 'hit', 55, 1, 1, 'cannon'),
    annotate(TEMPO, 'hit', 55, 3, 1, 'cannon'),
    // Exactly one climax, strength 1, on the last downbeat.
    annotate(TEMPO, 'climax', 56, 1, 1, 'finalChord'),
    annotate(TEMPO, 'hit', 56, 1, 1, 'cannon'),
    annotate(TEMPO, 'phrase', 57, 1, 0.6, 'phraseEnd'),
  ],
}
