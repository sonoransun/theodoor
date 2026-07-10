/**
 * scores/odeToJoy.ts — 32-bar, 3-voice arrangement of Beethoven's Ode to Joy
 * theme (public domain melody; this arrangement is Theodoor's own).
 *
 * Structure, 4/4 at 120 bpm, C major:
 *   bars  1–8   A + A'   first statement, lead + bass, mezzo
 *   bars  9–16  B + A''  lead + bass, sustained bells enter
 *   bars 17–24  A + A'   forte, bells double the lead an octave up
 *   bars 25–28  B        building
 *   bars 29–32  A''      final refrain, fortissimo — the single climax
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [{ beat: 0, bpm: 120 }],
  meters: [{ bar: 1, beatsPerBar: 4 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

// Melody sections (4 bars each). A ends on the half cadence, A2 resolves,
// B is the contrasting middle phrase.
const A = 'E4/4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/4. D4/8 D4/2 |'
const A2 = 'E4/4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/4. C4/8 C4/2 |'
const B = 'D4/4 D4 E4 C4 | D4 E4/8 F4/8 E4/4 C4 | D4 E4/8 F4/8 E4/4 D4 | C4 D4 G3/2 |'

/** Transpose a section string up one octave (bells doubling). */
const up8 = (section: string): string => section.replace(/([A-G][#b]?)(\d)/g, (_m, p, o) => `${p}${Number(o) + 1}`)

const LEAD = ['@0.72', A, A2, B, A2, '@0.8', A, A2, '@0.84', B, '@0.92', A2].join(' ')

const BASS = [
  '@0.65',
  'C2/2 C2 | C2 G2 | C2 G2 | G2 G2 |', // A
  'C2/2 C2 | C2 G2 | C2 G2 | G2 C2 |', // A'
  'G2/2 G2 | C2 C2 | G2 G2 | F2 G2 |', // B
  'C2/2 C2 | C2 G2 | C2 G2 | G2 C2 |', // A''
  '@0.75',
  'C2/2 C2 | C2 G2 | C2 G2 | G2 G2 |', // A
  'C2/2 C2 | C2 G2 | C2 G2 | G2 C2 |', // A'
  '@0.8',
  'G2/2 G2 | C2 C2 | G2 G2 | F2 G2 |', // B
  '@0.88',
  'C2/2 C2 | C2 G2 | G2 G2 | C2/1 |', // final A'' — whole-note close
].join(' ')

const BELLS = [
  'r/1 | r | r | r | r | r | r | r |', // bars 1–8: tacet
  '@0.6',
  'G5/1 | ~G5/1 | G5 | E5 | C5 | G4 | C5 | ~C5 |', // bars 9–16: sustained tones
  '@0.78',
  up8(A),
  up8(A2), // bars 17–24: double the lead up an octave
  '@0.82',
  up8(B), // bars 25–28
  '@0.95',
  up8(A2), // bars 29–32: final refrain
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const odeToJoy: Score = {
  id: 'odeToJoy',
  title: 'Ode to Joy',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // Phrase boundaries every 8 bars (downbeat closing each phrase pair).
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 17, 1, 0.8, 'forte'),
    annotate(TEMPO, 'phrase', 25, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 25, 1, 0.85, 'forte'),
    // Exactly one climax, strength 1, at the final refrain.
    annotate(TEMPO, 'climax', 29, 1, 1, 'finalRefrain'),
    annotate(TEMPO, 'phrase', 33, 1, 0.6, 'phraseEnd'),
  ],
}
