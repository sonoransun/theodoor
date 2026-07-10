/**
 * scores/starsAndStripesForever.ts — 108-bar, 5-voice arrangement of Sousa's
 * "The Stars and Stripes Forever" (1896, public domain; this arrangement is
 * Theodoor's own).
 *
 * Structure, 4/4 at 120 bpm (march feel), C major with the trio in the
 * subdominant (F major):
 *   bars   1–4    intro          unison fanfare
 *   bars   5–20   first strain   16 bars (8-bar phrase repeated, 1st/2nd endings)
 *   bars  21–36   second strain  16 bars, broad singing melody
 *   bars  37–68   trio           32 bars, THE lyrical melody, softer (@0.6)
 *   bars  69–76   breakstrain    8 bars, loud call-and-response stabs
 *   bars  77–108  grandioso      final trio, fortissimo, piccolo-style
 *                                counter-line in bells; bar 108 is the stinger
 *
 * Voices: lead (melody), brass (afterbeats / counter-lines / stabs), bass
 * (oom-pah), bells (tacet until the grandioso obbligato), perc (kick 35 on
 * beats 1/3, snare 38 on every beat, cymbal 49 at strain starts + stinger).
 * Bells stay at @0.8 so the timeline's auto-accent field is driven by the
 * beat (lead/kick), not by every obbligato sixteenth.
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [{ beat: 0, bpm: 120 }],
  meters: [{ bar: 1, beatsPerBar: 4 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'brass', program: 'brass' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
  { name: 'perc', program: 'perc' },
]

/** Repeat one barred fragment n times. */
const rep = (bar: string, n: number): string => Array.from({ length: n }, () => bar).join(' ')

// ---------------------------------------------------------------------------
// Lead (voice 0)
// ---------------------------------------------------------------------------

const LEAD_INTRO = [
  'C5/4. B4/8 C5/4 E5/4 |',
  'A4/4. G#4/8 A4/4 C5/4 |',
  'D5/4 D#5/4 E5/4 F5/4 |',
  'G5/2 G4/2 |',
].join(' ')

// First strain: one 7-bar body + 1st ending (half cadence) / 2nd ending.
const STRAIN1_BODY = [
  'E5/4. D5/8 C5/4 G4/4 |',
  'A4/4 C5/4 E5/2 |',
  'D5/4. C5/8 B4/4 D5/4 |',
  'G5/2 F5/4 D5/4 |',
  'E5/4. D5/8 C5/4 G4/4 |',
  'A4/4 C5/4 E5/4 G5/4 |',
  'F5/4 D5/4 B4/4 G4/4 |',
].join(' ')
const LEAD_STRAIN1 = [
  STRAIN1_BODY,
  'A4/4 B4/4 D5/2 |', // 1st ending — half cadence
  STRAIN1_BODY,
  'C5/2. G4/4 |', // 2nd ending — resolves, G4 leads on
].join(' ')

const LEAD_STRAIN2 = [
  'G4/2 C5/2 | E5/2. D5/4 | C5/2 A4/2 | G4/1 |',
  'A4/2 C5/2 | D5/2. E5/4 | F5/2 D5/2 | B4/1 |',
  'G4/2 C5/2 | E5/2. D5/4 | C5/2 A4/2 | G4/2 A4/4 B4/4 |',
  'C5/2 E5/2 | G5/2. F5/4 | E5/2 D5/2 | C5/1 |',
].join(' ')

// Trio melody (F major), four 8-bar phrases. P4 has a soft ending for the
// trio and a driven ending for the grandioso.
const TRIO_P1 = 'A4/2. G4/4 | F4/2 A4/2 | C5/2. Bb4/4 | A4/1 | G4/2. A4/4 | Bb4/2 G4/2 | E4/2. F4/4 | G4/1 |'
const TRIO_P2 = 'A4/2. G4/4 | F4/2 A4/2 | C5/2. D5/4 | C5/1 | Bb4/2. G4/4 | A4/2 F4/2 | G4/2 E4/2 | F4/1 |'
const TRIO_P3 = 'D5/2. C5/4 | Bb4/2 D5/2 | C5/2. Bb4/4 | A4/1 | Bb4/2. A4/4 | G4/2 Bb4/2 | A4/2. G4/4 | G4/1 |'
const TRIO_P4_HEAD = 'A4/2. G4/4 | F4/2 A4/2 | C5/2. D5/4 | F5/2 C5/2 | D5/2. C5/4 | Bb4/2 G4/2 |'
const TRIO_P4 = `${TRIO_P4_HEAD} A4/2 G4/2 | F4/1 |`
const TRIO_P4_GRAND = `${TRIO_P4_HEAD} A4/4 Bb4/4 C5/4 E5/4 | F5/1 |`

const LEAD_BREAK = [
  'D5/4. C5/8 Bb4/4 A4/4 |',
  'G4/4. A4/8 Bb4/4 C5/4 |',
  'D5/4. C5/8 Bb4/4 A4/4 |',
  'Bb4/4. C5/8 D5/4 E5/4 |',
  'F5/4 r/4 F5/4 r/4 |',
  'G5/4 r/4 G5/4 r/4 |',
  'A5/4 G5/4 F5/4 E5/4 |',
  'C5/8 D5/8 E5/8 F5/8 G5/8 A5/8 Bb5/8 C6/8 |',
].join(' ')

const LEAD = [
  '@0.82', LEAD_INTRO,
  '@0.78', LEAD_STRAIN1,
  '@0.82', LEAD_STRAIN2,
  '@0.6', TRIO_P1, TRIO_P2, TRIO_P3, TRIO_P4,
  '@0.95', LEAD_BREAK,
  '@1', TRIO_P1, TRIO_P2, TRIO_P3, TRIO_P4_GRAND,
].join(' ')

// ---------------------------------------------------------------------------
// Brass (voice 1) — intro doubling, strain afterbeats, second-strain counter,
// trio pads, breakstrain stabs.
// ---------------------------------------------------------------------------

const BRASS_INTRO = [
  'C4/4. B3/8 C4/4 E4/4 |',
  'A3/4. G#3/8 A3/4 C4/4 |',
  'D4/4 D#4/4 E4/4 F4/4 |',
  'G4/2 G3/2 |',
].join(' ')

const AFTER_C = 'r/4 E4/4 r/4 G4/4 |'
const AFTER_G = 'r/4 D4/4 r/4 B3/4 |'
const AFTER_G7 = 'r/4 D4/4 r/4 F4/4 |'
const BRASS_STRAIN1_BODY = [AFTER_C, AFTER_C, AFTER_G, AFTER_G7, AFTER_C, AFTER_C, AFTER_G7].join(' ')
const BRASS_STRAIN1 = [
  BRASS_STRAIN1_BODY, 'r/4 D4/4 r/4 D4/4 |',
  BRASS_STRAIN1_BODY, AFTER_C,
].join(' ')

const BRASS_STRAIN2 = [
  'E4/1 | G4/1 | F4/1 | D4/2 E4/2 | F4/1 | G4/1 | F4/2 D4/2 | D4/1 |',
  'E4/1 | G4/1 | F4/1 | D4/2 F4/2 | E4/2 G4/2 | C5/1 | G4/2 F4/2 | E4/1 |',
].join(' ')

// Sustained pads under the trio melody (one whole note per bar).
const PAD_P1 = 'C4/1 | C4/1 | F4/1 | C4/1 | C4/1 | Bb3/1 | C4/1 | Bb3/1 |'
const PAD_P2 = 'C4/1 | C4/1 | F4/1 | F4/1 | D4/1 | C4/1 | Bb3/1 | A3/1 |'
const PAD_P3 = 'F4/1 | F4/1 | F4/1 | C4/1 | D4/1 | D4/1 | C4/1 | Bb3/1 |'
const PAD_P4 = 'C4/1 | C4/1 | F4/1 | A4/1 | F4/1 | D4/1 | C4/1 | C4/1 |'
const PAD_P4_GRAND = 'C4/1 | C4/1 | F4/1 | A4/1 | F4/1 | D4/1 | C4/2 Bb3/2 | A3/1 |'

const BRASS_BREAK = [
  'D4/8 D4/8 r/4 F4/8 F4/8 r/4 |',
  'E4/8 E4/8 r/4 G4/8 G4/8 r/4 |',
  'D4/8 D4/8 r/4 F4/8 F4/8 r/4 |',
  'G4/8 G4/8 r/4 E4/8 E4/8 r/4 |',
  'r/4 A4/4 r/4 A4/4 |',
  'r/4 Bb4/4 r/4 Bb4/4 |',
  'C4/4 C4/4 C4/4 C4/4 |',
  'C4/8 D4/8 E4/8 F4/8 G4/8 A4/8 Bb4/8 C5/8 |',
].join(' ')

const BRASS = [
  '@0.78', BRASS_INTRO,
  '@0.7', BRASS_STRAIN1,
  '@0.72', BRASS_STRAIN2,
  '@0.55', PAD_P1, PAD_P2, PAD_P3, PAD_P4,
  '@0.9', BRASS_BREAK,
  '@0.92', PAD_P1, PAD_P2, PAD_P3, PAD_P4_GRAND,
].join(' ')

// ---------------------------------------------------------------------------
// Bass (voice 2) — oom-pah roots and fifths on beats 1/3.
// ---------------------------------------------------------------------------

const OOM_C = 'C3/4 r/4 G2/4 r/4 |'
const OOM_C_WALK = 'C3/4 r/4 E3/4 r/4 |'
const OOM_G = 'G2/4 r/4 D3/4 r/4 |'
const OOM_G7 = 'G2/4 r/4 B2/4 r/4 |'
const OOM_F_C = 'F2/4 r/4 A2/4 r/4 |'
const DRIVE_G = 'G2/4 G2/4 G2/4 G2/4 |'
const OOM_F = 'F2/4 r/4 C3/4 r/4 |'
const OOM_C7 = 'C3/4 r/4 G2/4 r/4 |'
const OOM_GM = 'G2/4 r/4 D3/4 r/4 |'
const OOM_BB = 'Bb2/4 r/4 F2/4 r/4 |'

const BASS_INTRO = 'C3/4 r/4 C3/4 r/4 | A2/4 r/4 A2/4 r/4 | D3/4 r/4 E3/4 r/4 | G2/4 G2/4 G2/4 G2/4 |'

const BASS_STRAIN1_BODY = [OOM_C, OOM_C_WALK, OOM_G, OOM_G7, OOM_C, OOM_C_WALK, OOM_G7].join(' ')
const BASS_STRAIN1 = [BASS_STRAIN1_BODY, DRIVE_G, BASS_STRAIN1_BODY, OOM_C].join(' ')

const BASS_STRAIN2 = [
  OOM_C, OOM_C_WALK, OOM_F_C, OOM_C, OOM_F_C, OOM_G, OOM_G7, DRIVE_G,
  OOM_C, OOM_C_WALK, OOM_F_C, 'G2/4 r/4 G2/4 r/4 |', OOM_C_WALK, OOM_C, DRIVE_G, 'C3/4 r/4 C3/4 r/4 |',
].join(' ')

const BASS_TRIO_P1 = [OOM_F, OOM_F, OOM_F, OOM_F, OOM_C7, OOM_GM, OOM_C7, OOM_C7].join(' ')
const BASS_TRIO_P2 = [OOM_F, OOM_F, OOM_F, OOM_F, OOM_GM, OOM_F, OOM_C7, OOM_F].join(' ')
const BASS_TRIO_P3 = [OOM_BB, OOM_BB, OOM_F, OOM_F, OOM_GM, OOM_GM, OOM_F, OOM_C7].join(' ')
const BASS_TRIO_P4 = [OOM_F, OOM_F, OOM_F, OOM_F, OOM_BB, OOM_GM, OOM_C7, OOM_F].join(' ')
const BASS_TRIO_P4_GRAND = [OOM_F, OOM_F, OOM_F, OOM_F, OOM_BB, OOM_GM, 'C3/4 C3/4 C3/4 C3/4 |', 'F2/1 |'].join(' ')

const BASS_BREAK = [
  'D3/4 D3/4 A2/4 A2/4 |',
  'G2/4 G2/4 C3/4 C3/4 |',
  'D3/4 D3/4 A2/4 A2/4 |',
  'G2/4 G2/4 C3/4 C3/4 |',
  'F2/4 F2/4 A2/4 A2/4 |',
  'C3/4 C3/4 C3/4 C3/4 |',
  'C3/4 C3/4 C3/4 C3/4 |',
  'C3/2 C3/2 |',
].join(' ')

const BASS = [
  '@0.75', BASS_INTRO,
  '@0.7', BASS_STRAIN1,
  '@0.72', BASS_STRAIN2,
  '@0.5', BASS_TRIO_P1, BASS_TRIO_P2, BASS_TRIO_P3, BASS_TRIO_P4,
  '@0.85', BASS_BREAK,
  '@0.88', BASS_TRIO_P1, BASS_TRIO_P2, BASS_TRIO_P3, BASS_TRIO_P4_GRAND,
].join(' ')

// ---------------------------------------------------------------------------
// Bells (voice 3) — tacet until bar 77, then the piccolo-style obbligato:
// one decorated arpeggio figure per bar, chosen by the bar's harmony.
// ---------------------------------------------------------------------------

const FIG: Record<'F' | 'C7' | 'Gm' | 'Bb', string> = {
  F: 'F6/16 E6/16 F6/16 G6/16 A6/8 F6/8 C6/8 A5/8 C6/8 F6/8 |',
  C7: 'E6/16 D6/16 E6/16 F6/16 G6/8 E6/8 C6/8 Bb5/8 C6/8 E6/8 |',
  Gm: 'G6/16 F6/16 G6/16 A6/16 Bb6/8 G6/8 D6/8 Bb5/8 D6/8 G6/8 |',
  Bb: 'Bb5/16 A5/16 Bb5/16 C6/16 D6/8 Bb5/8 F6/8 D6/8 F6/8 Bb6/8 |',
}

// Grandioso harmony, bars 77–106 (bar 107 is the run, 108 the stinger).
const GRAND_HARMONY: readonly (keyof typeof FIG)[] = [
  'F', 'F', 'F', 'F', 'C7', 'Gm', 'C7', 'C7',
  'F', 'F', 'F', 'F', 'Gm', 'F', 'C7', 'F',
  'Bb', 'Bb', 'F', 'F', 'Gm', 'Gm', 'F', 'C7',
  'F', 'F', 'F', 'F', 'Bb', 'Gm',
]

const BELLS_RUN =
  'C7/16 Bb6/16 A6/16 G6/16 F6/16 E6/16 D6/16 C6/16 Bb5/16 A5/16 G5/16 F5/16 G5/16 A5/16 C6/16 E6/16 |'

const BELLS = [
  rep('r/1 |', 76),
  '@0.8',
  ...GRAND_HARMONY.map((h) => FIG[h]),
  BELLS_RUN,
  'F6/1 |',
].join(' ')

// ---------------------------------------------------------------------------
// Perc (voice 4) — three merged monophonic streams: snare 38 on every beat,
// kick 35 on beats 1/3, cymbal 49 at strain starts and on the stinger.
// ---------------------------------------------------------------------------

const SNARE_BAR = 'D2/4 D2/4 D2/4 D2/4 |'
const KICK_BAR = 'B1/4 r/4 B1/4 r/4 |'
const HIT_BAR_SNARE = 'D2/4 r/4 r/2 |'
const HIT_BAR_KICK = 'B1/4 r/4 r/2 |'
const CYM_BAR = 'C#3/4 r/4 r/2 |'
const REST_BAR = 'r/1 |'

const PERC_SNARE = [
  '@0.6', rep(SNARE_BAR, 4), // intro
  '@0.7', rep(SNARE_BAR, 32), // first + second strains
  '@0.4', rep(SNARE_BAR, 32), // trio (soft)
  '@0.8', rep(SNARE_BAR, 8), // breakstrain
  '@0.82', rep(SNARE_BAR, 31), // grandioso
  '@0.9', HIT_BAR_SNARE, // stinger
].join(' ')

const PERC_KICK = [
  '@0.7', rep(KICK_BAR, 4),
  '@0.75', rep(KICK_BAR, 32),
  '@0.5', rep(KICK_BAR, 32),
  '@0.88', rep(KICK_BAR, 8),
  '@0.9', rep(KICK_BAR, 31),
  HIT_BAR_KICK,
].join(' ')

const PERC_CYM = [
  rep(REST_BAR, 4),
  '@0.8', CYM_BAR, // bar 5: first strain
  rep(REST_BAR, 15),
  CYM_BAR, // bar 21: second strain
  rep(REST_BAR, 15),
  '@0.6', CYM_BAR, // bar 37: trio (soft)
  rep(REST_BAR, 31),
  '@0.9', CYM_BAR, // bar 69: breakstrain
  rep(REST_BAR, 7),
  '@1', CYM_BAR, // bar 77: grandioso
  rep(REST_BAR, 30),
  CYM_BAR, // bar 108: stinger
].join(' ')

// ---------------------------------------------------------------------------

const parseDefaults = { meters: TEMPO.meters }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BRASS, 1, parseDefaults),
  ...parseVoice(BASS, 2, parseDefaults),
  ...parseVoice(BELLS, 3, parseDefaults),
  ...parseVoice(PERC_SNARE, 4, parseDefaults),
  ...parseVoice(PERC_KICK, 4, parseDefaults),
  ...parseVoice(PERC_CYM, 4, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const starsAndStripesForever: Score = {
  id: 'starsAndStripesForever',
  title: 'The Stars and Stripes Forever',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // Strain starts.
    annotate(TEMPO, 'accent', 5, 1, 0.9, 'firstStrain'),
    // 8-bar phrase ends (downbeat closing each phrase).
    annotate(TEMPO, 'phrase', 13, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'accent', 21, 1, 0.9, 'secondStrain'),
    annotate(TEMPO, 'phrase', 21, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 29, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'accent', 37, 1, 0.9, 'trio'),
    annotate(TEMPO, 'phrase', 37, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 45, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 53, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 61, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'accent', 69, 1, 0.9, 'breakstrain'),
    annotate(TEMPO, 'phrase', 69, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'accent', 77, 1, 0.9, 'grandioso'),
    // Exactly one climax, strength 1, at the final grandioso trio.
    annotate(TEMPO, 'climax', 77, 1, 1, 'grandioso'),
    annotate(TEMPO, 'phrase', 77, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 85, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 93, 1, 0.7, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 101, 1, 0.7, 'phraseEnd'),
    // The stinger — final chord of bar 108.
    annotate(TEMPO, 'hit', 108, 1, 1, 'stinger'),
    annotate(TEMPO, 'phrase', 109, 1, 0.7, 'phraseEnd'),
  ],
}
