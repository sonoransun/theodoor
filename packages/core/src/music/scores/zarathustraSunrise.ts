/**
 * scores/zarathustraSunrise.ts — 22-bar, 4-voice arrangement of the sunrise
 * opening of R. Strauss's Also sprach Zarathustra (1896; public-domain work,
 * this arrangement is Theodoor's own), in C major.
 *
 * Sparse texture is the point — a vast pedal, three rising calls, then dawn:
 *   bars  1–2   organ-pedal C alone (one long tie chain in the bass)
 *   bars  3–5   trumpet statement 1, C–G–C rising      hit 'sunrise'
 *   bars  6–7   timpani strokes                        hit 'pulse'
 *   bars  8–10  trumpet statement 2                    hit 'sunrise'
 *   bars 11–12  timpani strokes                        hit 'pulse'
 *   bars 13–15  trumpet statement 3                    hit 'sunrise'
 *   bars 16–17  timpani, doubled pound                 hit 'pulse' x2
 *   bars 18–22  full C-major blaze                     climax 'daybreak' 0.95
 *
 * 4/4 at 56 bpm. Perc pitch map (GM drums): B1 = 35 kick (the timpani
 * stand-in), C#3 = 49 cymbal.
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [{ beat: 0, bpm: 56 }],
  meters: [{ bar: 1, beatsPerBar: 4 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'brass', program: 'brass' },
  { name: 'bass', program: 'bass' },
  { name: 'perc', program: 'perc' },
]

const REST2 = 'r/1 | r |'
const REST3 = 'r/1 | r | r |'

const LEAD = [
  // Bars 1–17: tacet — the blaze is the lead's only entrance.
  REST3,
  REST3,
  REST3,
  REST3,
  REST3,
  REST2,
  // Blaze, bars 18–22: the high third/fifth over the brass chord.
  '@0.9 E5/2 G5/2 | C6/1 | E6/2 C6/2 | G5/1 | ~G5 |',
].join(' ')

const BRASS = [
  REST2,
  // Statement 1, bars 3–5: soft — the call barely clears the pedal.
  '@0.62 C4/2 G4/2 | C5/1 | E5/2 G5/2 |',
  REST2,
  // Statement 2, bars 8–10: closer, resolving downward.
  '@0.76 C4/2 G4/2 | C5/1 | E5/2. C5/4 |',
  REST2,
  // Statement 3, bars 13–15: full voice.
  '@0.86 C4/2 G4/2 | C5/1 | E5/2 G5/2 |',
  REST2,
  // Blaze, bars 18–22.
  '@0.94 G4/2 C5/2 | E5/1 | G5/2 E5/2 | C5/1 | ~C5 |',
].join(' ')

const BASS = [
  // One tie chain, bars 1–17 — the pedal point the calls rise from.
  '@0.55 C2/1 | ~C2 | ~C2 | ~C2 | ~C2 | ~C2 | ~C2 | ~C2 | ~C2 |',
  '~C2 | ~C2 | ~C2 | ~C2 | ~C2 | ~C2 | ~C2 | ~C2 |',
  // Re-struck fortissimo under the blaze, bars 18–22.
  '@0.9 C2/1 | ~C2 | ~C2 | ~C2 | ~C2 |',
].join(' ')

const PERC = [
  'r/1 | r | r | r | r |',
  // Bars 6–7: the pounding low figure between statements.
  '@0.6 B1/4 B1/8 B1/8 B1/4 B1/4 | B1/8 B1 B1 B1 B1/4 B1/4 |',
  REST3,
  '@0.7 B1/4 B1/8 B1/8 B1/4 B1/4 | B1/8 B1 B1 B1 B1/4 B1/4 |',
  REST3,
  // Bars 16–17: doubled pound driving into the blaze.
  '@0.8 B1/4 B1/8 B1/8 B1/4 B1/4 | B1/8 B1 B1 B1 B1/8 B1 B1 B1 |',
  // Blaze, bars 18–22: crash, rolls, crash, final stroke.
  '@0.95 C#3/1 | @0.85 B1/4 B1 B1 B1 | B1/4 B1 B1 B1 | @0.9 C#3/1 | B1/1 |',
].join(' ')

const parseDefaults = { meters: TEMPO.meters }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BRASS, 1, parseDefaults),
  ...parseVoice(BASS, 2, parseDefaults),
  ...parseVoice(PERC, 3, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const zarathustraSunrise: Score = {
  id: 'zarathustraSunrise',
  title: 'Also sprach Zarathustra — Sunrise',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // Three trumpet statements, each landing a labelled hit as it enters.
    annotate(TEMPO, 'hit', 3, 1, 0.7, 'sunrise'),
    annotate(TEMPO, 'hit', 6, 1, 0.55, 'pulse'),
    annotate(TEMPO, 'hit', 8, 1, 0.8, 'sunrise'),
    annotate(TEMPO, 'hit', 11, 1, 0.6, 'pulse'),
    annotate(TEMPO, 'hit', 13, 1, 0.9, 'sunrise'),
    annotate(TEMPO, 'hit', 16, 1, 0.65, 'pulse'),
    annotate(TEMPO, 'hit', 17, 1, 0.7, 'pulse'),
    // The one climax — damped to 0.95 (the suite's 1.0 lives in jupiterHymn).
    annotate(TEMPO, 'climax', 18, 1, 0.95, 'daybreak'),
  ],
}
