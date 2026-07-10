/**
 * scores/dawnOfAllSaints.ts — 20-bar, 3-voice Theodoor ORIGINAL (no borrowed
 * melody): a coda after the Danse Macabre dawn, in 3/4, ritardando 69 -> 54
 * bpm. The night ends: a cock-crow motif rises three times in the lead while
 * a dying fragment of the waltz drifts in the bells, and D minor resolves to
 * D major at first light.
 *
 * Structure:
 *   bars  1–4   @69 — the waltz ghost in the bells over a low D pedal
 *   bars  2–12  three rising cock-crow figures (bars 2, 6, 11); 'dawn'
 *               accent at bar 5; the bass slides D -> Bb -> A under them
 *   bars 13–20  @54 — the lead sighs down F–E–D against the leading tone,
 *               then lands F# ('daybreak' climax, bar 17): D major at last;
 *               'lastBell' rings the final tonic at bar 20
 */

import type { Score, TempoMapData, Voice } from '../../contracts.js'
import { annotate, parseVoice } from '../notation.js'

const TEMPO: TempoMapData = {
  segments: [
    { beat: 0, bpm: 69 }, // bars 1–12
    { beat: 36, bpm: 54 }, // bars 13–20: the ritardando settles
  ],
  meters: [{ bar: 1, beatsPerBar: 3 }],
}

const VOICES: readonly Voice[] = [
  { name: 'lead', program: 'lead' },
  { name: 'bass', program: 'bass' },
  { name: 'bells', program: 'bells' },
]

const LEAD = [
  '@0.55',
  'r/2. |', // bar 1
  'A4/8 D5 F5/4 A5/4 | ~A5/2. |', // bars 2–3: cock-crow 1 (minor)
  'r/2. |', // bar 4
  '@0.5 D5/2. |', // bar 5: first light
  '@0.6 A4/8 D5 G5/4 Bb5/4 | ~Bb5/2. |', // bars 6–7: cock-crow 2, higher
  'A5/2. |', // bar 8: sighing back down
  'r/2. | r/2. |', // bars 9–10
  '@0.65 A4/8 E5 A5/4 C#6/4 | ~C#6/2. |', // bars 11–12: cock-crow 3, dominant
  '@0.6',
  'A5/2 G5/4 | F5/2 E5/4 | D5/2 C#5/4 | E5/2. |', // bars 13–16: still minor
  '@0.75 F#5/2. | ~F#5/2. |', // bars 17–18: the major third — daybreak
  '@0.6 G5/2 E5/4 |', // bar 19
  '@0.65 F#5/2. |', // bar 20: held in the final D-major chord
].join(' ')

const BASS = [
  '@0.45',
  'D2/2. |', // bar 1: the night's D pedal…
  Array.from({ length: 7 }, () => '~D2/2. |').join(' '), // …tied through bar 8
  'Bb1/2. | ~Bb1/2. |', // bars 9–10
  'A1/2. | ~A1/2. |', // bars 11–12: dominant under the third crow
  '@0.5',
  'D2/2. | ~D2/2. | A1/2. | ~A1/2. |', // bars 13–16
  '@0.6 D2/2. | ~D2/2. |', // bars 17–18: daybreak
  'A1/2. | D2/2. |', // bars 19–20
].join(' ')

const BELLS = [
  '@0.45',
  'D5/2 A4/4 | F4/2 A4/4 | D5/2 A4/4 | F4/2 r/4 |', // bars 1–4: the waltz ghost
  '@0.4 D5/2 A4/4 |', // bar 5: one more turn…
  'r/2. | r/2. |', // bars 6–7: …the crow interrupts
  'F4/2 E4/4 |', // bar 8
  'D5/2 Bb4/4 | F4/2. |', // bars 9–10: the fragment sinks
  'r/2. |', // bar 11
  '@0.4 E5/4 D5 C#5 |', // bar 12: last three steps of the dance
  '@0.5',
  'D5/2. | ~D5/2. | C#5/2. | ~C#5/2. |', // bars 13–16: tonic, leading tone
  '@0.55 A5/2. | ~A5/2. |', // bars 17–18
  'C#5/2. |', // bar 19
  '@0.6 D6/2. |', // bar 20: the last bell, high and clear
].join(' ')

const parseDefaults = { meters: TEMPO.meters, pickupBeats: TEMPO.pickupBeats }

const notes = [
  ...parseVoice(LEAD, 0, parseDefaults),
  ...parseVoice(BASS, 1, parseDefaults),
  ...parseVoice(BELLS, 2, parseDefaults),
].sort((a, b) => a.startBeat - b.startBeat || a.voice - b.voice || a.midi - b.midi)

export const dawnOfAllSaints: Score = {
  id: 'dawnOfAllSaints',
  title: 'Dawn of All Saints',
  tempo: TEMPO,
  voices: VOICES,
  notes,
  annotations: [
    // Three cock-crows, each on the downbeat where its figure launches.
    annotate(TEMPO, 'hit', 2, 1, 0.7, 'cockcrow'),
    annotate(TEMPO, 'accent', 5, 1, 0.6, 'dawn'),
    annotate(TEMPO, 'hit', 6, 1, 0.7, 'cockcrow'),
    annotate(TEMPO, 'hit', 11, 1, 0.7, 'cockcrow'),
    annotate(TEMPO, 'phrase', 13, 1, 0.6, 'phraseEnd'),
    // The resolution to D major — damped below the suite's single 1.0.
    annotate(TEMPO, 'climax', 17, 1, 0.85, 'daybreak'),
    annotate(TEMPO, 'hit', 20, 1, 0.75, 'lastBell'),
    annotate(TEMPO, 'phrase', 21, 1, 0.6, 'phraseEnd'),
  ],
}
