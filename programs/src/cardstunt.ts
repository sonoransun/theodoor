/**
 * programs/src/cardstunt.ts — "The Living Field", the crowd-canvas tech demo.
 *
 * THE ACCEPTANCE TEST implementers copy: legibility over spectacle. Every
 * group below carries a terse WHY; the scheduling arithmetic (mast bandwidth,
 * digit spacing, beam dwell) is spelled out where it bites.
 *
 * Music: THREE bar-aligned passes of Ode to Joy (32 bars 4/4 @ 120 bpm each,
 * ~3.3 min total; one bar = 2 s). concatScores starts each appended score on
 * the bar line AFTER the previous score's final bar, so one silent join bar
 * separates the passes: they start on bars 1 / 34 / 67 (t = 0 / 66 / 132 s).
 * Pass starts are stamped with accents 'calibrate' / 'stunt' / 'synthesis';
 * the downbeats of each pass's local bars 9/11/25/27 (the two contrasting B
 * phrases) carry 'cardCall' hits — the moments a card-stunt caller would
 * flash the cue card. Only the pass-3 finalRefrain keeps climax strength 1
 * (earlier passes damped to 0.9) so the strongest-climax convention holds.
 *
 * Arc:
 *   PASS 1 — CALIBRATION: the crowd learns it is an instrument. Radial
 *     pulses from the four lawn corners, a 4-section column sweep, one
 *     full-field wave lap, a 3-thump haptic roll-call, and a whisper
 *     count-in from the west delay tower announcing each figure.
 *   PASS 2 — THE STUNT: card-stunt images on the cardCall hits
 *     (checkerboard chase, an 'OK' card — font5x7 has no ')', so the ':)'
 *     smiley falls back per spec — and a THEODOOR marquee on the pass
 *     start), then THE SHOWPIECE: drone digits 3-2-1-0 from pad-1 racing
 *     crowd text digits 3/2/1 on the SAME landings array, digit 0 landing
 *     exactly ON the synthesis downbeat.
 *   PASS 3 — SYNTHESIS: every medium enters, one phrase each — comet fans,
 *     a pad-2 drone ring, laser fans, panel tickers, the gerb-fan set
 *     piece, a beam ping-pong lap + front-row flyover — then the finale
 *     climax lands a modest RWB volley + crowd 'BRAVO' + all-cells white
 *     pulse.
 *
 * SCHEDULING FACTS the layout leans on (lakesidePark, starter catalog):
 *   - crowd text = 16 s at 20 Hz, chase sections = 12 s at 12 Hz each, and a
 *     mast caps at 30 frames/s: two texts (40) or text+chase (32) can NEVER
 *     share a mast. Everything below alternates mast-west/mast-east.
 *   - wristband p95 latency is 80 ms, so a crowd cue OCCUPIES the mast from
 *     0.08 s BEFORE its landing: back-to-back windows need a real gap, never
 *     a shared endpoint.
 *   - drone digits hold 8 s and a digit→digit morph needs ~3-4 s of flight:
 *     countdown landings are 24 beats (12 s) apart, counting back from the
 *     synthesis downbeat that digit 0 lands on.
 *   - one beam array can never start a cue before the previous cue's window
 *     ends (slew gap ≥ 0), so the four count-in whispers are 12+ s apart and
 *     pass 3 splits its two beam cues across two different arrays.
 *
 * cardstuntQuiet(): identical, except the finale RWB volley becomes comet
 * fans (quiet pool) and the show carries an 85 dB noise budget.
 *
 * Pure and deterministic: no clocks, no randomness, no module caches.
 */

import type {
  Annotation,
  BuildResult,
  MusicalTimeline,
  MusicRefs,
  ShowBuilder,
} from '@theodoor/core'
import {
  annotationsOfKind,
  buildTimelineFromScore,
  concatScores,
  lakesidePark,
  musicRefs,
  odeToJoy,
  showBuilder,
  starterCatalog,
} from '@theodoor/core'
import { RGB } from './palettes.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED = 24601
const PRE_ROLL_SEC = 6

/** Pass start bars: concatScores leaves one silent join bar between passes
 * (see module doc), so the three passes begin on bars 1, 34 and 67. */
const PASS_START_BARS = [1, 34, 67] as const
/** Pass-start accent labels. */
const CALIBRATE = 'calibrate'
const STUNT = 'stunt'
const SYNTHESIS = 'synthesis'
/** Card-caller hits: the B-phrase downbeats (local bars 9-12 and 25-28 hold
 * the contrasting B sections; the 1st and 3rd bar of each keep the hits 4 s
 * apart — wide enough for 12-16 s crowd patterns to hand off between masts). */
const CARD_CALL = 'cardCall'
const CARD_CALL_LOCAL_BARS = [9, 11, 25, 27] as const

/** lakesidePark asset ids. */
const MAST_W = 'mast-west'
const MAST_E = 'mast-east'
const PAD_MAIN = 'pad-1'
const PAD_RING = 'pad-2'
const BEAM_DELAY_W = 'beam-delay-west'
const BEAM_DELAY_E = 'beam-delay-east'
const BEAM_NORTH_W = 'beam-north-west'
const LASERS = ['laser-west', 'laser-east'] as const
const PANELS = ['panel-west', 'panel-east'] as const

/** Crowd grid: 38 cols × 9 rows, index = row·38 + col, row 8 nearest stage. */
const COLS = 38
const CORNER_CELLS = [0, COLS - 1, 8 * COLS, 8 * COLS + COLS - 1] as const
/** Mid-lawn (row 4) narrator cells for the count-in whispers. Both sit far
 * enough from beam-delay-west (36 m / 122 m slant) that the propagated
 * carrier stays below the 100 dB dwell threshold — no exposure dwell accrues
 * no matter how long the narrator talks. */
const NARRATE_CELL_W = 4 * COLS + 13 // (-42, -224): 33 m from the west tower
const NARRATE_CELL_E = 4 * COLS + 24 // (46, -224): 121 m from the west tower
/** Pass-3 ping-pong bounce cells (row 4), both within beam-delay-east's
 * ~165 m throw (109 m / 29 m). */
const PINGPONG_CELLS = [4 * COLS + 14, 4 * COLS + 24] as const
/** Pass-3 flyover path: west→east along the FRONT row (row 8, ~197-240 m
 * from the north-west mast — comfortably inside its ~267 m throw). */
const FLYOVER_PATH = [8 * COLS + 8, 8 * COLS + 13, 8 * COLS + 18, 8 * COLS + 23, 8 * COLS + 28] as const

/** Crowd digit texts and the masts they alternate across (E/W/E keeps every
 * 20 Hz text window alone on its mast). */
const CROWD_DIGITS = [
  ['3', MAST_E],
  ['2', MAST_W],
  ['1', MAST_E],
] as const

/** Starter-catalog effect ids. */
const FX = {
  crowdPulse: 'crowd-pulse-radial',
  crowdChase: 'crowd-chase-sections',
  crowdWave: 'crowd-wave-lateral',
  crowdText: 'crowd-text-marquee',
  crowdHaptic: 'crowd-haptic-thump',
  whisperCount: 'beam-whisper-count',
  pingPong: 'beam-pingpong-blip',
  flyover: 'beam-flyover-whoosh',
  cometGold: 'comet-30-gold',
  cometSilver: 'comet-30-silver',
  cometRed: 'comet-50-red',
  peonyRed: 'peony-75-red',
  peonyWhite: 'peony-100-white',
  peonyBlue: 'peony-75-blue',
  droneRing: 'ring-formation-60',
  laserFan: 'laser-fan-rgb',
  gerbArc: 'gerb-fan-arc-12m',
} as const

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * Three bar-aligned passes of Ode to Joy (the nye concat pattern), restamped:
 * accents calibrate/stunt/synthesis on the three pass-start downbeats, hit
 * 'cardCall' on the B-phrase downbeats of every pass, and the pass-1/2
 * finalRefrain climaxes damped to 0.9 so only the pass-3 climax keeps
 * strength 1.
 */
function livingFieldTimeline(): MusicalTimeline {
  const opening = concatScores(odeToJoy, odeToJoy, {
    id: 'cardstunt-open',
    title: 'Ode to Joy (I-II)',
  })
  const suite = concatScores(opening, odeToJoy, {
    id: 'cardstunt-suite',
    title: 'The Living Field',
  })
  const tl = buildTimelineFromScore(suite)
  /** time+beat of a bar's downbeat (4/4 throughout, no pickup). */
  const at = (bar: number): { time: number; beat: number } => ({
    time: tl.downbeats[bar - 1]!,
    beat: (bar - 1) * 4,
  })
  const stamps: Annotation[] = []
  ;[CALIBRATE, STUNT, SYNTHESIS].forEach((label, pass) => {
    stamps.push({ ...at(PASS_START_BARS[pass]!), kind: 'accent', strength: 1, label })
  })
  for (const startBar of PASS_START_BARS) {
    for (const bar of CARD_CALL_LOCAL_BARS) {
      stamps.push({
        ...at(startBar + bar - 1),
        kind: 'hit',
        strength: 0.7,
        label: CARD_CALL,
      })
    }
  }
  const climaxes = annotationsOfKind(tl, 'climax')
  const last = climaxes[climaxes.length - 1]!
  const annotations: Annotation[] = [
    ...tl.annotations.map((a) =>
      a.kind === 'climax' && a.time < last.time - 1e-9 ? { ...a, strength: 0.9 } : a,
    ),
    ...stamps,
  ].sort((a, b) => a.time - b.time)
  return { ...tl, annotations }
}

// ---------------------------------------------------------------------------
// Passes (shared by both variants; only the finale volley differs)
// ---------------------------------------------------------------------------

/** PASS 1 — CALIBRATION (bars 1-32): the crowd learns it is an instrument. */
function pass1Calibration(b: ShowBuilder, m: MusicRefs): void {
  // Corner-to-corner radial pulses on bars 3/5/7/9 — the last lands ON the
  // first cardCall. Masts alternate so each 10 Hz pulse rides a mast alone.
  CORNER_CELLS.forEach((cell, i) => {
    b.crowd.pulse({
      effect: FX.crowdPulse,
      position: i % 2 === 0 ? MAST_W : MAST_E,
      land: m.barBeat(3 + 2 * i, 1),
      originCell: cell,
      periodBeats: 2,
      rgb: RGB.gold,
      idPrefix: `cs-corner-${i}`,
    })
  })
  // Column sweep on the second cardCall. stepBeats 14 (7 s) keeps at most
  // two of the 12 s / 12 Hz sections concurrent: 24 Hz ≤ the 30 Hz mast cap.
  b.crowd.chase({
    effect: FX.crowdChase,
    position: MAST_W,
    startLand: m.hit(CARD_CALL, 1),
    stepBeats: 14,
    sections: 4,
    idPrefix: 'cs-sweep',
  })
  // One full-field wave lap on the third cardCall (east mast: the sweep's
  // last section still occupies west until bar 27).
  b.crowd.wave({
    effect: FX.crowdWave,
    position: MAST_E,
    from: m.hit(CARD_CALL, 2),
    periodBeats: 16,
    dirDeg: 90,
    rgb: RGB.drift,
    idPrefix: 'cs-lap',
  })
  // Haptic roll-call: three thumps 8 beats apart from the fourth cardCall
  // (4 Hz each — rides beside the sweep tail well under the cap).
  for (let i = 0; i < 3; i++) {
    b.crowd.haptic({
      id: `cs-rollcall-${i}`,
      effect: FX.crowdHaptic,
      position: MAST_W,
      land: m.offset(m.hit(CARD_CALL, 3), 8 * i),
    })
  }
  // Whisper count-in announcing each figure, all from the west delay tower.
  // The 10 s windows are 12+ s apart (a beam array cannot start a cue before
  // its previous window ends) and the narrator cells alternate so no cell
  // collects two consecutive windows.
  const countIns: ReadonlyArray<readonly [number, number]> = [
    [1, NARRATE_CELL_W], // announces the corner pulses
    [8, NARRATE_CELL_E], // announces the column sweep (lands bar 11)
    [21, NARRATE_CELL_W], // announces the wave lap (lands bar 25)
    [27, NARRATE_CELL_E], // announces the roll-call (lands bar 27)
  ]
  countIns.forEach(([bar, cell], i) => {
    b.beams.whisper({
      effect: FX.whisperCount,
      position: BEAM_DELAY_W,
      target: cell,
      land: m.barBeat(bar, 1),
      idPrefix: `cs-count-${i}`,
    })
  })
}

/** PASS 2 — THE STUNT (bars 33-64): card images, then the countdown. */
function pass2Stunt(b: ShowBuilder, m: MusicRefs): void {
  // Title card on the pass start: 8 glyphs of 5×7 font exceed the 38-column
  // canvas, so THEODOOR scrolls as a marquee. West mast; its 16 s window
  // clears before the smiley needs west on the second cardCall.
  b.crowd.text('THEODOOR', {
    effect: FX.crowdText,
    position: MAST_W,
    land: m.annotation('accent', 0, STUNT),
    rgb: RGB.gold,
    idPrefix: 'cs-ticker',
  })
  // Checkerboard on cardCall 4 (local bar 9): two fast half-lawn sections,
  // east mast — 24 Hz for 13 s, done before the first crowd digit needs east.
  b.crowd.chase({
    effect: FX.crowdChase,
    position: MAST_E,
    startLand: m.hit(CARD_CALL, 4),
    stepBeats: 2,
    sections: 2,
    idPrefix: 'cs-checker',
  })
  // Smiley on cardCall 5 (local bar 11): font5x7 has no ')' glyph, so per
  // spec the ':)' smiley falls back to 'OK'. West mast (east runs the
  // checkerboard).
  b.crowd.text('OK', {
    effect: FX.crowdText,
    position: MAST_W,
    land: m.hit(CARD_CALL, 5),
    rgb: RGB.white,
    idPrefix: 'cs-smiley',
  })
  // Haptic pips on the late cardCalls (local bars 25/27): 4 Hz accents that
  // ride beside the 20 Hz digit texts under the cap as the countdown looms.
  b.crowd.haptic({ id: 'cs-pip-0', effect: FX.crowdHaptic, position: MAST_W, land: m.hit(CARD_CALL, 6) })
  b.crowd.haptic({ id: 'cs-pip-1', effect: FX.crowdHaptic, position: MAST_E, land: m.hit(CARD_CALL, 7) })

  // THE SHOWPIECE: one landings array feeds BOTH tracks — drone digits
  // 3-2-1-0 from pad-1 and crowd text digits 3/2/1, each pair landing on the
  // same downbeat (the test asserts targetSec equality). Landings count back
  // from the synthesis downbeat in 24-beat (12 s) steps — 8 s digit hold +
  // ~3-4 s morph flight — so digit 0 lands exactly ON the synthesis accent.
  const synthesis = m.annotation('accent', 0, SYNTHESIS)
  const landings = [3, 2, 1, 0].map((digit) => m.offset(synthesis, -24 * digit))
  b.drones.countdown({
    position: PAD_MAIN,
    landings,
    count: 60,
    scaleM: 2,
    idPrefix: 'cs-cd',
    priority: 10,
  })
  CROWD_DIGITS.forEach(([digit, mast], i) => {
    b.crowd.text(digit, {
      effect: FX.crowdText,
      position: mast,
      land: landings[i]!,
      rgb: RGB.white,
      idPrefix: `cs-digit-${digit}`,
      priority: 10,
    })
  })
}

/** PASS 3 — SYNTHESIS (bars 65-96): every medium enters, one phrase each. */
function pass3Synthesis(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  const synthesis = m.annotation('accent', 0, SYNTHESIS)
  // Comet fans across the inner racks ON the synthesis downbeat (quiet-legal
  // in both variants), drone digit 0 landing into them on the same beat.
  b.pyro.volley({
    effects: [FX.cometGold, FX.cometSilver],
    positions: ['rack-3', 'rack-4', 'rack-5', 'rack-6'],
    land: synthesis,
    staggerBeats: 1,
    idPrefix: 'cs-fans',
  })
  // Drone ring from pad-2 (pad-1 is still flying the countdown chain — one
  // morph chain per pad), formed by the first pass-3 phrase end.
  b.drones.formation({
    id: 'cs-ring',
    effect: FX.droneRing,
    position: PAD_RING,
    by: m.phraseEnd(8),
    holdSec: 8,
    params: { count: 40, scaleM: 24, rgb: RGB.gold },
  })
  // Laser fans from both towers through the second phrase.
  for (const tower of LASERS) {
    b.lasers.pattern({
      effect: FX.laserFan,
      position: tower,
      from: m.offset(synthesis, 8),
      durBeats: 16,
      params: { spreadDeg: 90 },
    })
  }
  // Panel tickers name the show.
  for (const panel of PANELS) {
    b.panels.ticker('THE LIVING FIELD', {
      position: panel,
      from: m.offset(synthesis, 16),
      speedPxPerBeat: 8,
      rgb: RGB.silver,
    })
  }
  // Gerb fan arc set piece on cardCall 9 (fabrication mounts on any asset;
  // the firing line sits ~190 m from the audience, far past its 25 m minimum).
  b.fabrication.cue({
    id: 'cs-gerb-arc',
    effectId: FX.gerbArc,
    anchor: m.hit(CARD_CALL, 9),
    positionId: 'rack-5',
  })
  // Beams, one array each so neither cue waits on the other's slew: a
  // ping-pong lap across mid-lawn from the east delay tower, then a
  // front-row flyover from the north-west mast.
  b.beams.pingPong({
    effect: FX.pingPong,
    position: BEAM_DELAY_E,
    cells: PINGPONG_CELLS,
    periodBeats: 8,
    land: m.offset(synthesis, 48),
    idPrefix: 'cs-pingpong',
  })
  b.beams.flyover({
    effect: FX.flyover,
    position: BEAM_NORTH_W,
    path: FLYOVER_PATH,
    land: m.offset(synthesis, 80),
    idPrefix: 'cs-flyover',
  })
  // Finale ON the pass-3 climax (the suite's only strength-1 climax): a
  // modest RWB volley (quiet: comet fans), crowd 'BRAVO', and an all-cells
  // white pulse radiating from the zone center.
  b.pyro.volley({
    effects: quiet
      ? [FX.cometGold, FX.cometRed, FX.cometSilver]
      : [FX.peonyRed, FX.peonyWhite, FX.peonyBlue],
    positions: ['rack-2', 'rack-4', 'rack-6'],
    land: m.climax(2),
    staggerBeats: 0,
    idPrefix: 'cs-finale',
  })
  b.crowd.text('BRAVO', {
    effect: FX.crowdText,
    position: MAST_W,
    land: m.climax(2),
    rgb: RGB.gold,
    idPrefix: 'cs-bravo',
  })
  b.crowd.pulse({
    effect: FX.crowdPulse,
    position: MAST_E,
    land: m.climax(2),
    periodBeats: 2,
    rgb: RGB.white,
    idPrefix: 'cs-flash',
  })
}

/** Program notes (the printed program), shared by both variants: one act per pass. */
function programNotes(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  b.notes({
    tagline: quiet
      ? 'The crowd learns it is an instrument, then plays — the quiet performance closes on comet fans.'
      : 'The crowd learns it is an instrument, then plays.',
    music: ['Ludwig van Beethoven — Ode to Joy, from Symphony No. 9 (1824), three passes'],
    epilogue: 'Bravo — that was you.',
  })
  b.act(
    'I — Calibration',
    m.annotation('accent', 0, CALIBRATE),
    'A whispered count-in from the tower behind the lawn announces each figure before it ' +
      'happens. Gold pulses ripple in from the four corners; a sweep runs the columns; one wave ' +
      'laps the whole field; three thumps in every wristband take the roll call. Every figure ' +
      'is commanded a fraction early so it completes on the downbeat.',
  )
  b.act(
    'II — The Stunt',
    m.annotation('accent', 0, STUNT),
    "THEODOOR scrolls across the field, then card-stunt images on the caller's cues: a " +
      'checkerboard, a smiley. The showpiece: drone digits 3-2-1-0 in the sky racing crowd ' +
      'digits 3-2-1 on the wristbands, each pair landing on the same downbeat, digit 0 exactly ' +
      'on the start of the third pass.',
  )
  b.act(
    'III — Synthesis',
    m.annotation('accent', 0, SYNTHESIS),
    'Every medium enters, one phrase each: comet fans, a drone ring from the second pad, laser ' +
      'fans, panel tickers, a gerb-fan set piece, a ping-pong of sound across mid-lawn and a ' +
      'flyover along the front row. The finale lands a volley, spells BRAVO, and flashes the ' +
      'whole field white.',
  )
}

// ---------------------------------------------------------------------------
// Program factories
// ---------------------------------------------------------------------------

function buildCardstunt(variant: 'standard' | 'quiet'): BuildResult {
  const quiet = variant === 'quiet'
  const tl = livingFieldTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: quiet ? 'cardstunt-quiet' : 'cardstunt',
    title: quiet ? 'The Living Field (Quiet)' : 'The Living Field',
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant,
  })
    .music(tl)
    .preRoll(PRE_ROLL_SEC)
  if (quiet) b.noiseBudget(85)
  programNotes(b, m, quiet)

  pass1Calibration(b, m)
  pass2Stunt(b, m)
  pass3Synthesis(b, m, quiet)
  return b.build()
}

/** "The Living Field" crowd-canvas tech demo (standard variant). */
export function cardstunt(): BuildResult {
  return buildCardstunt('standard')
}

/** The quiet variant: comet-fan finale, 85 dB noise budget. */
export function cardstuntQuiet(): BuildResult {
  return buildCardstunt('quiet')
}
