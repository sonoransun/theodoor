/**
 * scores/vltava.ts — 152-bar, 5-voice arrangement of Bedřich Smetana's
 * "Vltava" (The Moldau, 1874; public-domain work, this arrangement is
 * Theodoor's own): the river tone poem, from two springs to the broad river
 * passing the castle rock.
 *
 * The 6/8 sections are notated as 3 beats per bar of eighths (a 6/8 bar =
 * three quarter-beats), so tempo is set on the quarter throughout.
 *
 *   I    THE TWO SPRINGS   bars   1–16   3/4 @116   hit 'spring' ×2 (cold bar 1,
 *                                                    warm bar 5)
 *   II   THE RIVER         bars  17–48   3/4 @116   accent 'river' ×2 (bars 17, 33;
 *                                                    E minor, statement 2 with brass)
 *   III  FOREST HUNT       bars  49–64   3/4 @116   accent 'hunt'; hit 'horn' ×4
 *   IV   PEASANT WEDDING   bars  65–88   2/4 @104   accent 'wedding'; hit 'stomp' ×6
 *   V    MOONLIGHT, NYMPHS bars  89–100  4/4 @66    accent 'moonlight'; hit 'nymph' ×3
 *   VI   ST JOHN'S RAPIDS  bars 101–124  3/4 @128   accent 'rapids'; hit 'rapid' ×8
 *   VII  THE BROAD VLTAVA  bars 125–140  3/4 @120   climax 'broadRiver' 1.0 (E MAJOR)
 *   VIII VYŠEHRAD          bars 141–152  4/4 @60    accent 'vysehrad'; hit 'lastWave'
 *                                                    (bar 151); final phraseEnd bar 153
 *
 * Phrase ends every 8 bars (label 'phraseEnd'). Perc pitch map (GM drums):
 * B1 = 35 kick, D2 = 38 snare, C#3 = 49 cymbal.
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [
    { beat: 0, bpm: 116 }, // I–III: springs, river, hunt (bars 1–64)
    { beat: 192, bpm: 104 }, // IV: wedding polka (bars 65–88)
    { beat: 240, bpm: 66 }, // V: moonlight (bars 89–100)
    { beat: 288, bpm: 128 }, // VI: rapids (bars 101–124)
    { beat: 360, bpm: 120 }, // VII: the broad river (bars 125–140)
    { beat: 408, bpm: 60 }, // VIII: Vyšehrad (bars 141–152)
  ],
  meters: [
    { bar: 1, beatsPerBar: 3 },
    { bar: 65, beatsPerBar: 2 },
    { bar: 89, beatsPerBar: 4 },
    { bar: 101, beatsPerBar: 3 },
    { bar: 141, beatsPerBar: 4 },
  ],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'brass', program: 'brass' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
  { name: 'perc', program: 'perc' },
]

// ---------------------------------------------------------------------------
// Helpers (pure string assembly — deterministic)
// ---------------------------------------------------------------------------

/** n copies of one bar. */
const rep = (bar: string, n: number): string => Array.from({ length: n }, () => bar).join(' ')

/** Whole-bar rests for each meter (explicit durations — sticky state stays honest). */
const REST3 = 'r/2. |'
const REST2 = 'r/2 |'
const REST4 = 'r/1 |'

/** Shift every pitch token down one octave (velocity marks and rests untouched). */
function octaveDown(dsl: string): string {
  return dsl.replace(/([A-G][#b]?)(\d)/g, (_m, p: string, o: string) => `${p}${Number(o) - 1}`)
}

/** Flowing 6/8 bass bar: root, fifth, octave, fifth. */
const flow = (root: string, fifth: string, up: string): string =>
  `${root}/4 ${fifth}/8 ${up}/8 ${fifth}/4 |`
const FLOW: Record<string, string> = {
  E: flow('E2', 'B2', 'E3'),
  G: flow('G2', 'D3', 'G3'),
  B: flow('B1', 'F#2', 'B2'),
  C: flow('C2', 'G2', 'C3'),
  A: flow('A1', 'E2', 'A2'),
  D: flow('D2', 'A2', 'D3'),
}
const flowBars = (harmony: string): string =>
  [...harmony.replace(/\s+/g, '')].map((h) => FLOW[h]!).join(' ')

/** Bell ripple bar (eighths) on a triad. */
const ripple = (a: string, b: string, c: string): string => `${a}/8 ${b} ${c} ${b} ${a} ${b} |`
const RIPPLE: Record<string, string> = {
  E: ripple('E5', 'G5', 'B5'),
  G: ripple('G5', 'B5', 'D6'),
  B: ripple('B4', 'D5', 'F#5'),
  C: ripple('C5', 'E5', 'G5'),
  A: ripple('A4', 'C5', 'E5'),
  D: ripple('D5', 'F#5', 'A5'),
}
const rippleBars = (harmony: string): string =>
  [...harmony.replace(/\s+/g, '')].map((h) => RIPPLE[h]!).join(' ')

/** Harmony letters under the 16-bar river theme (minor statement). */
const RIVER_HARMONY = 'EEGE EEBE ECAE AGBE'
/** Harmony letters under the 16-bar broad-river theme (major statement). */
const BROAD_HARMONY = 'EEAE EEBE EAAE AEBE'

/** The river theme, E minor, 16 bars of 6/8 (head motif E F# G A B). */
const THEME_MINOR = [
  'E4/8 F#4/8 G4/8 A4/8 B4/4 |',
  'B4/4. C5/8 B4/8 A4/8 |',
  'G4/4. A4/8 G4/8 F#4/8 |',
  'E4/2. |',
  'E4/8 F#4/8 G4/8 A4/8 B4/4 |',
  'B4/4. C5/8 B4/8 A4/8 |',
  'G4/4 F#4/8 E4/4 D4/8 |',
  'E4/2. |',
  'E4/8 F#4/8 G4/8 A4/8 B4/4 |',
  'C5/4. D5/8 C5/8 B4/8 |',
  'A4/4. B4/8 C5/8 D5/8 |',
  'E5/2. |',
  'E5/8 D5/8 C5/8 B4/8 A4/4 |',
  'G4/4. A4/8 G4/8 F#4/8 |',
  'E4/4 F#4/8 G4/4 F#4/8 |',
  'E4/2. |',
].join(' ')

/** The same theme in E MAJOR (G#, C#, D# — the broad river). */
const THEME_MAJOR = [
  'E4/8 F#4/8 G#4/8 A4/8 B4/4 |',
  'B4/4. C#5/8 B4/8 A4/8 |',
  'G#4/4. A4/8 G#4/8 F#4/8 |',
  'E4/2. |',
  'E4/8 F#4/8 G#4/8 A4/8 B4/4 |',
  'B4/4. C#5/8 B4/8 A4/8 |',
  'G#4/4 F#4/8 E4/4 D#4/8 |',
  'E4/2. |',
  'E4/8 F#4/8 G#4/8 A4/8 B4/4 |',
  'C#5/4. D#5/8 C#5/8 B4/8 |',
  'A4/4. B4/8 C#5/8 D#5/8 |',
  'E5/2. |',
  'E5/8 D#5/8 C#5/8 B4/8 A4/4 |',
  'G#4/4. A4/8 G#4/8 F#4/8 |',
  'E4/4 F#4/8 G#4/4 F#4/8 |',
  'E4/2. |',
].join(' ')

/** Polka tune, 24 bars of 2/4 (G major). */
const POLKA_A = [
  'G4/8 B4 D5 B4 |',
  'G4/4 D5/4 |',
  'B4/8 A4 G4 F#4 |',
  'G4/4 r/4 |',
  'D4/8 F#4 A4 F#4 |',
  'D4/4 A4/4 |',
  'F#4/8 E4 D4 C4 |',
  'D4/4 r/4 |',
].join(' ')
const POLKA_B = [
  'G4/8 A4 B4 C5 |',
  'D5/4 D5/4 |',
  'E5/8 D5 C5 B4 |',
  'A4/4 r/4 |',
  'C5/8 B4 A4 G4 |',
  'F#4/8 G4 A4 F#4 |',
  'G4/8 B4 D5 B4 |',
  'G4/4 r/4 |',
].join(' ')

/** Rapids running-bass bars (eighths) and turbulent lead fragments, 8-bar blocks. */
const RAPIDS_BASS_BLOCK = [
  'E2/8 F#2 G2 A2 B2 A2 |',
  'G2/8 F#2 E2 D2 E2 F#2 |',
  'E2/8 G2 B2 E3 B2 G2 |',
  'A1/8 B1 C2 D2 E2 D2 |',
  'B1/8 C2 D2 E2 F#2 E2 |',
  'E2/8 D2 C2 B1 A1 B1 |',
  'C2/8 D2 E2 F#2 G2 F#2 |',
  'B1/8 D2 F#2 B2 F#2 D2 |',
].join(' ')
const RAPIDS_LEAD_BLOCK = [
  'E5/8 D5 C5 B4 A4 G4 |',
  'F#4/8 G4 A4 B4 C5 D5 |',
  'E5/4 r/8 E5/8 r/4 |',
  'B4/8 C5 B4 A4 G4 F#4 |',
  'E4/8 G4 B4 E5 B4 G4 |',
  'A4/4. G4/8 F#4/8 E4/8 |',
  'D5/8 C5 B4 A4 G4 F#4 |',
  'B4/4 r/8 B4/8 r/4 |',
].join(' ')

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

const LEAD = [
  // I — the warm spring joins the cold one at bar 5: eighth ripples, lower.
  rep(REST3, 4),
  '@0.45',
  ripple('E4', 'G4', 'B4'),
  ripple('E4', 'G4', 'B4'),
  ripple('F#4', 'A4', 'C5'),
  ripple('G4', 'B4', 'D5'),
  '@0.5',
  ripple('A4', 'C5', 'E5'),
  ripple('G4', 'B4', 'D5'),
  ripple('F#4', 'A4', 'C5'),
  ripple('E4', 'G4', 'B4'),
  '@0.55',
  ripple('E4', 'G4', 'B4'),
  ripple('F#4', 'A4', 'D5'),
  ripple('G4', 'B4', 'E5'),
  ripple('B4', 'D5', 'F#5'),
  // II — the river theme, twice (the second statement fuller).
  '@0.7',
  THEME_MINOR,
  '@0.8',
  THEME_MINOR,
  // III — the river keeps flowing under the horns (soft ripple).
  '@0.5',
  rippleBars('EEGE EEBE EEGE EEBE').replace(/5/g, '4').replace(/6/g, '5'),
  // IV — the polka tune.
  '@0.75',
  POLKA_A,
  POLKA_B,
  '@0.8',
  POLKA_A,
  // V — the theme dimly quoted in long notes under the moon.
  '@0.4',
  'E4/2 F#4/4 G4/4 |',
  'A4/2 B4/2 |',
  'B4/2 C5/4 B4/4 |',
  'A4/2 G4/2 |',
  'F#4/1 |',
  'E4/1 |',
  'r/1 |',
  'E4/2 F#4/4 G4/4 |',
  'A4/2 B4/2 |',
  'C5/2 B4/2 |',
  'A4/1 |',
  'G4/2 F#4/2 |',
  // VI — turbulence: three eight-bar blocks, louder each time.
  '@0.7',
  RAPIDS_LEAD_BLOCK,
  '@0.78',
  RAPIDS_LEAD_BLOCK,
  '@0.84',
  RAPIDS_LEAD_BLOCK.replace('B4/4 r/8 B4/8 r/4 |', 'B4/2. |'),
  // VII — the broad river: the theme in E major, fortissimo.
  '@0.95',
  THEME_MAJOR,
  // VIII — Vyšehrad: the castle motif (rising fourth, step down) then away.
  '@0.85',
  'B4/4 E5/4 D#5/4 B4/4 |',
  'C#5/2 B4/2 |',
  'B4/4 E5/4 D#5/4 B4/4 |',
  'F#5/2 E5/2 |',
  'E5/1 |',
  '~E5/1 |',
  '@0.5 B4/2 G#4/2 |',
  'E4/1 |',
  '~E4/1 |',
  'r/1 |',
  '@0.6 E4/1 |',
  '~E4/1 |',
].join(' ')

const HUNT_FANFARE_G = [
  'G4/8 G4/8 G4/8 B4/4 G4/8 |',
  'D5/4. B4/4. |',
  'G4/8 B4/8 D5/8 G5/4 D5/8 |',
  'B4/2. |',
].join(' ')
const HUNT_FANFARE_E = [
  'E4/8 E4/8 E4/8 G4/4 E4/8 |',
  'B4/4. G4/4. |',
  'E4/8 G4/8 B4/8 E5/4 B4/8 |',
  'G4/2. |',
].join(' ')

/** Rapids brass: stabs on the eight irregular 'rapid' hits (bars 101–124). */
const RAPIDS_BRASS = (() => {
  const stabOn: Record<number, string> = {
    1: 'E4/8 B4/8 r/2 |',
    3: 'r/2 E4/8 B4/8 |',
    6: 'G4/8 D5/8 r/2 |',
    8: 'r/4 E4/8 B4/8 r/4 |',
    11: 'A4/8 E5/8 r/2 |',
    14: 'r/2 B4/8 F#5/8 |',
    18: 'E4/8 B4/8 r/2 |',
    22: 'B4/8 F#5/8 r/2 |',
  }
  const bars: string[] = []
  for (let i = 1; i <= 24; i++) {
    if (i === 23) bars.push('B3/2. |')
    else if (i === 24) bars.push('~B3/2. |')
    else bars.push(stabOn[i] ?? REST3)
  }
  return bars.join(' ')
})()

const BRASS = [
  // I — tacet.
  rep(REST3, 16),
  // II — statement 1 tacet; statement 2 doubles the theme an octave down.
  rep(REST3, 16),
  '@0.6',
  octaveDown(THEME_MINOR),
  // III — horn calls: four fanfares, G and E alternating.
  '@0.8',
  HUNT_FANFARE_G,
  HUNT_FANFARE_E,
  HUNT_FANFARE_G,
  HUNT_FANFARE_E,
  // IV — rests, then oom-pah doubling through the last eight bars.
  rep(REST2, 16),
  '@0.5',
  rep('G3/4 D4/4 |', 8),
  // V — tacet.
  rep(REST4, 12),
  // VI — stabs on the rapids, then the dominant pedal into the broad river.
  '@0.82',
  RAPIDS_BRASS,
  // VII — doubles the major theme an octave down.
  '@0.9',
  octaveDown(THEME_MAJOR),
  // VIII — chorale under the castle motif.
  '@0.8',
  'E4/1 |',
  'A3/2 B3/2 |',
  'E4/1 |',
  'B3/1 |',
  'E4/1 |',
  '~E4/1 |',
  '@0.5 G#3/2 E3/2 |',
  'E3/1 |',
  '~E3/1 |',
  'r/1 |',
  '@0.6 E3/1 |',
  '~E3/1 |',
].join(' ')

const BASS = [
  // I — one soft pedal under the springs.
  '@0.4 E2/2. |',
  rep('~E2/2. |', 15),
  // II — the flowing river bass, harmony following the theme.
  '@0.6',
  flowBars(RIVER_HARMONY),
  '@0.68',
  flowBars(RIVER_HARMONY),
  // III — hunting rhythm.
  '@0.62',
  rep('G2/4 G2/8 G2/8 G2/4 |', 4),
  rep('E2/4 E2/8 E2/8 E2/4 |', 4),
  rep('G2/4 G2/8 G2/8 G2/4 |', 4),
  rep('E2/4 E2/8 E2/8 E2/4 |', 4),
  // IV — polka oom-pah.
  '@0.62',
  rep('G2/4 D3/4 |', 4),
  rep('D2/4 A2/4 |', 4),
  rep('G2/4 D3/4 |', 3),
  'D2/4 A2/4 |',
  'C2/4 G2/4 |',
  'D2/4 A2/4 |',
  rep('G2/4 D3/4 |', 2),
  rep('G2/4 D3/4 |', 4),
  rep('D2/4 A2/4 |', 4),
  // V — still.
  '@0.4 E2/1 |',
  rep('~E2/1 |', 11),
  // VI — running eighths, three blocks, the last ending on the dominant.
  '@0.72',
  RAPIDS_BASS_BLOCK,
  '@0.78',
  RAPIDS_BASS_BLOCK,
  '@0.84',
  RAPIDS_BASS_BLOCK.replace('C2/8 D2 E2 F#2 G2 F#2 |', 'B1/2. |').replace(
    'B1/8 D2 F#2 B2 F#2 D2 |',
    '~B1/2. |',
  ),
  // VII — the flowing bass in E major.
  '@0.85',
  flowBars(BROAD_HARMONY),
  // VIII — chorale bass, then the last low chord.
  '@0.8',
  'E2/1 |',
  'A1/2 B1/2 |',
  'E2/1 |',
  'B1/1 |',
  'E2/1 |',
  '~E2/1 |',
  '@0.6 E2/1 |',
  '~E2/1 |',
  '~E2/1 |',
  'r/1 |',
  '@0.7 E2/1 |',
  '~E2/1 |',
].join(' ')

/** Cold-spring sixteenth ripple on a pentatonic-ish cell. */
const cold = (a: string, b: string, c: string, d: string, e: string): string =>
  `${a}/16 ${b} ${c} ${b} ${a} ${e} ${a} ${b} ${c} ${b} ${a} ${d} |`

const BELLS = [
  // I — the cold spring: high sixteenth ripples from bar 1.
  '@0.45',
  cold('E5', 'F#5', 'G5', 'D5', 'D5'),
  cold('E5', 'F#5', 'G5', 'D5', 'D5'),
  cold('F#5', 'G5', 'A5', 'E5', 'E5'),
  cold('G5', 'A5', 'B5', 'F#5', 'F#5'),
  '@0.5',
  cold('E5', 'F#5', 'G5', 'D5', 'D5'),
  cold('G5', 'A5', 'B5', 'F#5', 'F#5'),
  cold('A5', 'B5', 'C6', 'G5', 'G5'),
  cold('B5', 'C6', 'D6', 'A5', 'A5'),
  '@0.55',
  cold('E5', 'F#5', 'G5', 'D5', 'D5'),
  cold('F#5', 'G5', 'A5', 'E5', 'E5'),
  cold('G5', 'A5', 'B5', 'F#5', 'F#5'),
  cold('A5', 'B5', 'C6', 'G5', 'G5'),
  cold('B5', 'C6', 'D6', 'A5', 'A5'),
  cold('A5', 'B5', 'C6', 'G5', 'G5'),
  cold('G5', 'A5', 'B5', 'F#5', 'F#5'),
  cold('F#5', 'G5', 'A5', 'E5', 'E5'),
  // II — eighth ripples following the harmony.
  '@0.4',
  rippleBars(RIVER_HARMONY),
  '@0.45',
  rippleBars(RIVER_HARMONY),
  // III–IV — tacet.
  rep(REST3, 16),
  rep(REST2, 24),
  // V — three nymph chimes, high and soft.
  '@0.5 E6/2 B5/2 |',
  'G5/1 |',
  'r/1 |',
  'r/1 |',
  'E6/2 B5/2 |',
  'G5/1 |',
  'r/1 |',
  'r/1 |',
  'E6/2 B5/2 |',
  'G5/1 |',
  'r/1 |',
  'r/1 |',
  // VI — tacet.
  rep(REST3, 24),
  // VII — high E-major shimmer.
  '@0.55',
  rippleBars(BROAD_HARMONY).replace(/G5/g, 'G#5').replace(/C5/g, 'C#5').replace(/D6/g, 'D#6'),
  // VIII — the motif doubled high, then the river flows away.
  '@0.7',
  'B5/4 E6/4 D#6/4 B5/4 |',
  'C#6/2 B5/2 |',
  'B5/4 E6/4 D#6/4 B5/4 |',
  'F#6/2 E6/2 |',
  'E6/1 |',
  '~E6/1 |',
  '@0.45 E5/8 G#5 B5 G#5 E5 G#5 B5 G#5 |',
  '@0.4 E5/8 G#5 B5 G#5 E5 G#5 B5 G#5 |',
  '@0.35 E5/8 G#5 B5 G#5 E5 G#5 B5 G#5 |',
  'r/1 |',
  '@0.5 E6/1 |',
  '~E6/1 |',
].join(' ')

/** Rapids drums: kick + snare, a cymbal on the rapid-hit bars. */
const RAPIDS_PERC = (() => {
  const hitBars = new Set([1, 3, 6, 8, 11, 14, 18, 22])
  const bars: string[] = []
  for (let i = 1; i <= 24; i++) {
    bars.push(hitBars.has(i) ? 'C#3/4 D2/8 D2/8 B1/8 D2/8 |' : 'B1/4 D2/8 D2/8 B1/8 D2/8 |')
  }
  return bars.join(' ')
})()

const PERC = [
  // I–II — tacet.
  rep(REST3, 48),
  // III — hunting kick, cymbal on each fanfare downbeat.
  '@0.6',
  rep('C#3/4 B1/8 B1/8 B1/4 | B1/4 B1/8 B1/8 B1/4 | B1/4 B1/8 B1/8 B1/4 | B1/4 B1/8 B1/8 B1/4 |', 4),
  // IV — polka: kick–snare, the stomps heavier every four bars.
  rep('@0.82 B1/4 @0.6 D2/4 | B1/4 D2/4 | B1/4 D2/4 | B1/4 D2/4 |', 6),
  // V — tacet.
  rep(REST4, 12),
  // VI — the rapids.
  '@0.75',
  RAPIDS_PERC,
  // VII — crash into the broad river, steady pulse, crash on the second half.
  '@0.8 C#3/4 B1/4 B1/4 |',
  rep('B1/4 B1/8 B1/8 B1/4 |', 7),
  'C#3/4 B1/4 B1/4 |',
  rep('B1/4 B1/8 B1/8 B1/4 |', 7),
  // VIII — a single crash under the castle, then the last low stroke.
  '@0.7 C#3/1 |',
  rep(REST4, 9),
  '@0.6 B1/1 |',
  REST4,
].join(' ')

const parseDefaults = { meters: TEMPO.meters }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BRASS, 1, parseDefaults),
  ...parseVoice(BASS, 2, parseDefaults),
  ...parseVoice(BELLS, 3, parseDefaults),
  ...parseVoice(PERC, 4, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const vltava: Score = {
  id: 'vltava',
  title: 'Vltava',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // I — two springs.
    annotate(TEMPO, 'hit', 1, 1, 0.5, 'spring'),
    annotate(TEMPO, 'hit', 5, 1, 0.55, 'spring'),
    annotate(TEMPO, 'phrase', 9, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 17, 1, 0.6, 'phraseEnd'),
    // II — the river.
    annotate(TEMPO, 'accent', 17, 1, 0.7, 'river'),
    annotate(TEMPO, 'phrase', 25, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 33, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'accent', 33, 1, 0.8, 'river'),
    annotate(TEMPO, 'phrase', 41, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 49, 1, 0.6, 'phraseEnd'),
    // III — forest hunt.
    annotate(TEMPO, 'accent', 49, 1, 0.75, 'hunt'),
    annotate(TEMPO, 'hit', 49, 1, 0.7, 'horn'),
    annotate(TEMPO, 'hit', 53, 1, 0.7, 'horn'),
    annotate(TEMPO, 'phrase', 57, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 57, 1, 0.75, 'horn'),
    annotate(TEMPO, 'hit', 61, 1, 0.75, 'horn'),
    annotate(TEMPO, 'phrase', 65, 1, 0.6, 'phraseEnd'),
    // IV — peasant wedding.
    annotate(TEMPO, 'accent', 65, 1, 0.75, 'wedding'),
    annotate(TEMPO, 'hit', 65, 1, 0.6, 'stomp'),
    annotate(TEMPO, 'hit', 69, 1, 0.6, 'stomp'),
    annotate(TEMPO, 'phrase', 73, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 73, 1, 0.6, 'stomp'),
    annotate(TEMPO, 'hit', 77, 1, 0.6, 'stomp'),
    annotate(TEMPO, 'phrase', 81, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 81, 1, 0.65, 'stomp'),
    annotate(TEMPO, 'hit', 85, 1, 0.65, 'stomp'),
    annotate(TEMPO, 'phrase', 89, 1, 0.6, 'phraseEnd'),
    // V — moonlight, nymphs.
    annotate(TEMPO, 'accent', 89, 1, 0.5, 'moonlight'),
    annotate(TEMPO, 'hit', 89, 1, 0.45, 'nymph'),
    annotate(TEMPO, 'hit', 93, 1, 0.45, 'nymph'),
    annotate(TEMPO, 'hit', 97, 1, 0.45, 'nymph'),
    annotate(TEMPO, 'phrase', 101, 1, 0.6, 'phraseEnd'),
    // VI — St John's rapids (eight irregular stabs).
    annotate(TEMPO, 'accent', 101, 1, 0.8, 'rapids'),
    annotate(TEMPO, 'hit', 101, 1, 0.75, 'rapid'),
    annotate(TEMPO, 'hit', 103, 3, 0.75, 'rapid'),
    annotate(TEMPO, 'hit', 106, 1, 0.78, 'rapid'),
    annotate(TEMPO, 'hit', 108, 2, 0.78, 'rapid'),
    annotate(TEMPO, 'phrase', 109, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 111, 1, 0.8, 'rapid'),
    annotate(TEMPO, 'hit', 114, 3, 0.8, 'rapid'),
    annotate(TEMPO, 'phrase', 117, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'hit', 118, 1, 0.82, 'rapid'),
    annotate(TEMPO, 'hit', 122, 1, 0.84, 'rapid'),
    annotate(TEMPO, 'phrase', 125, 1, 0.6, 'phraseEnd'),
    // VII — the broad Vltava: the piece's one strength-1 climax.
    annotate(TEMPO, 'climax', 125, 1, 1, 'broadRiver'),
    annotate(TEMPO, 'phrase', 133, 1, 0.6, 'phraseEnd'),
    annotate(TEMPO, 'phrase', 141, 1, 0.6, 'phraseEnd'),
    // VIII — Vyšehrad.
    annotate(TEMPO, 'accent', 141, 1, 0.8, 'vysehrad'),
    annotate(TEMPO, 'hit', 151, 1, 0.6, 'lastWave'),
    annotate(TEMPO, 'phrase', 153, 1, 0.6, 'phraseEnd'),
  ],
}
