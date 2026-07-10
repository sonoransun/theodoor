/**
 * scores/auldLangSyne.ts — 32-bar, 3-voice arrangement of the traditional
 * Scottish air "Auld Lang Syne" (public-domain melody; this arrangement is
 * Theodoor's own). The repo's one pickup exercise: the tune starts on a
 * one-beat anacrusis (pickupBeats: 1), so every barcheck below proves the
 * "bar 0" arithmetic.
 *
 * Structure, 4/4 at 72 bpm, C major, one-beat pickup:
 *   pickup+1–8   verse 1        lead + bass, gentle
 *   9–16         chorus 1       lead + bass, still soft
 *   17–24        verse 2        sustained bells harmony enters
 *   25–32        final chorus   fuller; bells double the lead an octave up;
 *                               ritardando over the last 2 bars (72 -> 58 bpm)
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  // Ritardando: bar 31 beat 1 is absolute beat 121 (1 pickup + 30 * 4).
  segments: [
    { beat: 0, bpm: 72 },
    { beat: 121, bpm: 58 },
  ],
  meters: [{ bar: 1, beatsPerBar: 4 }],
  pickupBeats: 1,
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

// Verse bars 1–7 ("Should auld acquaintance be forgot…"); bar 8 lands the
// held do and hands the next section its pickup, so it is spliced per use.
const VERSE7 =
  'C4/4. C4/8 C4/4 E4/4 | D4/4. C4/8 D4/4 E4/4 | C4/4. C4/8 E4/4 G4/4 | A4/2. A4/4 | ' +
  'G4/4. E4/8 E4/4 C4/4 | D4/4. C4/8 D4/4 E4/4 | C4/4. A3/8 A3/4 G3/4 |'

// Chorus bars 1–7 ("For auld lang syne, my jo…") — opens on the high sol and
// peaks on the held la before the closing line.
const CHORUS7 =
  'G4/4. E4/8 E4/4 C4/4 | D4/4. C4/8 D4/4 A4/4 | A4/4. G4/8 E4/4 G4/4 | A4/2. A4/4 | ' +
  'G4/4. E4/8 E4/4 C4/4 | D4/4. C4/8 D4/4 E4/4 | C4/4. A3/8 A3/4 G3/4 |'

/** Transpose a section string up one octave (bells doubling). */
const up8 = (section: string): string =>
  section.replace(/([A-G][#b]?)(\d)/g, (_m, p, o) => `${p}${Number(o) + 1}`)

const LEAD = [
  '@0.55 G3/4 |', // anacrusis: "Should" on sol, bar 0
  VERSE7,
  'C4/2. @0.6 A4/4 |', // bar 8 + pickup into chorus 1
  CHORUS7,
  'C4/2. @0.65 G3/4 |', // bar 16 + pickup into verse 2
  VERSE7,
  'C4/2. @0.85 A4/4 |', // bar 24 + pickup into the final chorus
  CHORUS7,
  'C4/1 |', // bar 32: final held do through the ritardando
].join(' ')

// Root/fifth halves; the pickup beat is a rest so the bass proves bar 0 too.
const BASS_VERSE = 'C2/2 G2 | G2 G2 | C2 E2 | F2 F2 | C2 G2 | G2 G2 | F2 G2 | C2 C2 |'
const BASS_CHORUS7 = 'C2/2 G2 | G2 G2 | F2 C2 | F2 F2 | C2 G2 | G2 G2 | F2 G2 |'

const BASS = [
  '@0.5 r/4 |',
  BASS_VERSE, // bars 1–8
  '@0.55',
  BASS_CHORUS7,
  'C2/2 C2 |', // bars 9–16
  '@0.6',
  BASS_VERSE, // bars 17–24
  '@0.78',
  BASS_CHORUS7,
  'C2/1 |', // bar 32 — whole-note close
].join(' ')

const REST8 = 'r/1 | r | r | r | r | r | r | r |'

const BELLS = [
  'r/4 |', // tacet through the pickup…
  REST8,
  REST8, // …and bars 1–16
  '@0.65 E5/1 | D5 | E5 | F5 | E5 | D5 | ~D5 |', // bars 17–23: sustained tones
  'C5/2. @0.85 A5/4 |', // bar 24 + pickup, joining the lead's leap
  up8(CHORUS7), // bars 25–31: double the lead an octave up
  'C5/1 |', // bar 32
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const auldLangSyne: Score = {
  id: 'auldLangSyne',
  title: 'Auld Lang Syne',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // Section starts (the anacrusis leads in; the accent sits on the downbeat).
    annotate(TEMPO, 'accent', 1, 1, 0.6, 'verse1'),
    // Classic 8-bar phrases: each boundary is the downbeat closing the phrase.
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 9, 1, 0.65, 'chorus1'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 17, 1, 0.7, 'verse2'),
    annotate(TEMPO, 'phrase', 25, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 25, 1, 0.85, 'finalChorus'),
    // Exactly one gentle climax, strength 1, where the final chorus lifts off.
    annotate(TEMPO, 'climax', 25, 1, 1, 'finalChorus'),
    // The held final chord (all three voices land together on bar 32).
    annotate(TEMPO, 'hit', 32, 1, 0.8, 'lastNote'),
    annotate(TEMPO, 'phrase', 33, 1, 0.6, 'phraseEnd'),
  ],
}
