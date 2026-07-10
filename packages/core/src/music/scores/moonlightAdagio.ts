/**
 * scores/moonlightAdagio.ts — 16-bar, 3-voice abridgment of the Adagio
 * sostenuto from Beethoven's Sonata Op. 27 No. 2 (1801; public-domain work;
 * this arrangement is Theodoor's own), transposed to A minor. The nightcap
 * of the quiet midsummer suite.
 *
 * TRIPLET GRID: the 4/4 is notated as beatsPerBar 12 with the DSL beat = one
 * triplet eighth (tempo 160 per triplet eighth ≈ quarter = 53), so '/4' = one
 * triplet unit, '/2.' = a quarter (3 units), '/1.' = a half (6 units). The
 * melody's dotted-eighth+sixteenth figure is simplified onto the grid as
 * 2 + 1 triplet units — the standard adagio reading.
 *
 * Structure:
 *   bars  1–4   bells triplet arpeggios + sustained bass octaves alone
 *   bars  5–8   the repeated-note melody enters over i–i–VI–V
 *   bars  9–12  second half: the lament peaks (climax 0.5) and descends
 *   bars 13–16  farewell — heartbeats under every downbeat, last light held
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [{ beat: 0, bpm: 160 }],
  meters: [{ bar: 1, beatsPerBar: 12 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

// One bar of melody: a long tone (9 units), then the dotted figure (2 + 1)
// leading into the next downbeat.
const LEAD = [
  '@0.6',
  'r/1. r/1. | r/1. r/1. | r/1. r/1. | r/1. r/1. |', // bars 1–4: tacet
  'E4/1. ~E4/2. E4/2 E4/4 |', // bar 5
  'E4/1. ~E4/2. E4/2 E4/4 |', // bar 6
  'F4/1. ~F4/2. E4/2 D4/4 |', // bar 7
  'E4/1. ~E4/1. |', // bar 8: held over the dominant
  '@0.68',
  'A4/1. ~A4/2. A4/2 A4/4 |', // bar 9: the lament's peak
  'G4/1. ~G4/2. G4/2 G4/4 |', // bar 10
  'F4/1. ~F4/2. F4/2 E4/4 |', // bar 11
  'E4/1. ~E4/2. D4/2 B3/4 |', // bar 12
  '@0.55',
  'C4/1. ~C4/2. C4/2 C4/4 |', // bar 13
  'D4/1. ~D4/2. C4/2 B3/4 |', // bar 14
  'B3/1. ~B3/1. |', // bar 15
  'A3/1. ~A3/1. |', // bar 16: last light
].join(' ')

// Sustained octaves, monophonic reading: the low root holds the first half
// of the bar, its upper octave the second.
const BASS = [
  '@0.45',
  'A1/1. A2/1. | A1/1. A2/1. | F1/1. F2/1. | E1/1. E2/1. |', // bars 1–4
  'A1/1. A2/1. | A1/1. A2/1. | F1/1. F2/1. | E1/1. E2/1. |', // bars 5–8
  'A1/1. A2/1. | C2/1. C3/1. | D2/1. D3/1. | E1/1. E2/1. |', // bars 9–12
  'A1/1. A2/1. | D2/1. D3/1. | E1/1. E2/1. | A1/1. ~A1/1. |', // bars 13–16
].join(' ')

// Continuous triplet arpeggios — twelve one-unit notes per bar.
const AM = 'E3/4 A3 C4 E3 A3 C4 E3 A3 C4 E3 A3 C4 |'
const FM = 'F3/4 A3 C4 F3 A3 C4 F3 A3 C4 F3 A3 C4 |'
const EM = 'E3/4 G#3 B3 E3 G#3 B3 E3 G#3 B3 E3 G#3 B3 |'
const AM_HIGH = 'A3/4 C4 E4 A3 C4 E4 A3 C4 E4 A3 C4 E4 |'
const CM = 'G3/4 C4 E4 G3 C4 E4 G3 C4 E4 G3 C4 E4 |'
const DM = 'F3/4 A3 D4 F3 A3 D4 F3 A3 D4 F3 A3 D4 |'
const DM_LOW = 'D3/4 F3 A3 D3 F3 A3 D3 F3 A3 D3 F3 A3 |'

const BELLS = [
  '@0.5',
  AM,
  AM,
  FM,
  EM, // bars 1–4
  AM,
  AM,
  FM,
  EM, // bars 5–8
  '@0.55',
  AM_HIGH,
  CM,
  DM,
  EM, // bars 9–12
  '@0.5',
  AM,
  DM_LOW,
  EM, // bars 13–15
  'C4/1. ~C4/1. |', // bar 16: the arpeggios come to rest on the third
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const moonlightAdagio: Score = {
  id: 'moonlightAdagio',
  title: 'Moonlight Sonata — Adagio sostenuto',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    annotate(TEMPO, 'accent', 1, 1, 0.4, 'adagio'),
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    // One damped climax at the exact midpoint (the suite's strength-1 climax
    // lives in clairDeLune).
    annotate(TEMPO, 'climax', 9, 1, 0.5, 'peak'),
    // Eight heartbeats: the downbeats of the final 8 bars.
    annotate(TEMPO, 'hit', 9, 1, 0.35, 'heartbeat'),
    annotate(TEMPO, 'hit', 10, 1, 0.35, 'heartbeat'),
    annotate(TEMPO, 'hit', 11, 1, 0.35, 'heartbeat'),
    annotate(TEMPO, 'hit', 12, 1, 0.35, 'heartbeat'),
    annotate(TEMPO, 'hit', 13, 1, 0.35, 'heartbeat'),
    annotate(TEMPO, 'hit', 14, 1, 0.35, 'heartbeat'),
    annotate(TEMPO, 'hit', 15, 1, 0.35, 'heartbeat'),
    annotate(TEMPO, 'hit', 16, 1, 0.35, 'heartbeat'),
    // The final chord.
    annotate(TEMPO, 'hit', 16, 1, 0.6, 'lastLight'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
  ],
}
