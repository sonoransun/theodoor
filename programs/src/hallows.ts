/**
 * programs/src/hallows.ts — "The Unquiet Hour", the Halloween flagship
 * program, plus its quiet variant for noise-sensitive audiences.
 *
 * Music: THE UNQUIET HOUR SUITE — Saint-Saens' Danse Macabre (~104 s) joined
 * bar-aligned to Grieg's In the Hall of the Mountain King (~91 s) and the
 * original coda Dawn of All Saints (~56 s) via concatScores; ~4.3 minutes.
 *
 * The conceit: the haunting arrives THROUGH SOUND before anything is seen
 * (Act 1 is near-darkness — no pyro, no lasers), then the sky dances (Act 2),
 * the chase closes in through the crowd's own wristbands (Act 3), and dawn
 * banishes it all.
 *
 *   ACT 1 — THE SUMMONING: panel eyes blink open in the pre-roll dark; the
 *     twelve strokes of midnight toll from the directional-audio arrays
 *     (see the note below); after every stroke the lawn glows bone-white for
 *     half a beat. Roving whispers walk the front corners while the fiddler
 *     tunes; three invisible flyover whooshes ride the tritones, and on the
 *     third the bats appear where the sound went — a beam tag narrating the
 *     flock.
 *   ACT 2 — THE DANCE: an 80-drone ghost hovers over the display and MOANS
 *     via a crossed stereo bed from the delay towers (retargeted every bed —
 *     dwell rule); a lateral crowd wave keeps the waltz time; green/violet
 *     volleys and ping-pong "laughter" ride the phrase ends; the bones theme
 *     gets a violet laser web, ember panels, and crowd sparkle ticks.
 *   ACT 3 — CHASE & DAWN: the HEARTBEAT PLAGUE spreads from the front-center
 *     cell, restated louder at every Mountain King statement; a west/east
 *     section chase answers the pursuit; the 8 hammer stomps land pyro pairs
 *     on the outer racks, panel lightning, crowd rings, and wrist thumps;
 *     the strength-1.0 SUMMIT takes a 25 s ramped barrage, the crowd spells
 *     BOO, and the ghost blooms apart. Dawn reverses the flyovers back the
 *     way the spirits came, warm light floods the lawn, willows hang at
 *     daybreak, and the last bell tolls into a single-cell blink and
 *     blackout.
 *
 * NOTE on the twelve tolls: the strokes arrive one per second while the bell
 * program rings for 3 s, and one array head cannot start a new bell while the
 * previous one still rings (BEAM_SLEW forbids overlapping cues per array).
 * Zone-wide bells are only feasible from the delay towers (the 10°-wide bell
 * clears the horizon margin nowhere else) and zone-wide pulses from the tall
 * north masts (6° wide), so the plan rotates all six arrays: the delay towers
 * ring the true everywhere-at-once bell (cells:'all', fired early by the
 * farthest-cell time-of-flight), the north masts answer with zone-wide pulses
 * (also cells:'all'), and strokes 5 and 9 step INSIDE the crowd — near-field
 * corner strokes from the south arrays, as if the bell walked among them.
 * That rotation covers all twelve strokes with every landing exactly on its
 * 'toll' annotation.
 *
 * Determinism: pure functions of constants only — no Date.now, no
 * Math.random, no module-level caches; every call builds a fresh show.
 */

import type { BuildResult, MusicalTimeline, MusicRefs, ShowBuilder } from '@theodoor/core'
import {
  buildTimelineFromScore,
  concatScores,
  danseMacabre,
  dawnOfAllSaints,
  lakesidePark,
  mountainKing,
  musicRefs,
  showBuilder,
  starterCatalog,
} from '@theodoor/core'
import { RGB } from './palettes.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED = 31031
const PRE_ROLL_SEC = 8

/** lakesidePark asset ids. */
const PAD_MAIN = 'pad-1'
const PAD_SIDE = 'pad-2'
/** The far ends of the firing line — the stomp racks. */
const OUTER_RACKS = ['rack-1', 'rack-8'] as const
/** Inner six racks used by the summit barrage. */
const BARRAGE_RACKS = ['rack-2', 'rack-3', 'rack-4', 'rack-5', 'rack-6', 'rack-7'] as const
/** Mountain King phrase-end shots walk this rack cycle. */
const WALK_RACKS = ['rack-2', 'rack-7', 'rack-3', 'rack-6', 'rack-5'] as const
const VOLLEY_ODD_RACKS = ['rack-3', 'rack-5'] as const
const VOLLEY_EVEN_RACKS = ['rack-4', 'rack-6'] as const
const LASERS = ['laser-west', 'laser-east'] as const
const PANELS = ['panel-west', 'panel-east'] as const
const MASTS = ['mast-west', 'mast-east'] as const

/** Starter-catalog effect ids (see packages/core/src/catalog/starter). */
const FX = {
  peonyGreen: 'peony-75-green',
  peonyViolet: 'peony-100-violet',
  crossetteOrange: 'crossette-100-orange',
  crossetteSilver: 'crossette-75-silver',
  chrysGold: 'chrysanthemum-100-gold',
  willowStrobe: 'willow-150-strobe',
  mineRed: 'mine-75-red',
  mineGreen: 'mine-50-green',
  mineSilver: 'mine-50-silver',
  cometSilver: 'comet-30-silver',
  cometGold: 'comet-30-gold',
  droneBat: 'bat-formation-80',
  droneGhost: 'ghost-formation-60',
  droneBloom: 'bloom-formation-120',
  laserWeb: 'laser-web-violet',
  laserFan: 'laser-fan-rgb',
  panelEyes: 'panel-eyes',
  panelEmbers: 'panel-embers',
  panelLightning: 'panel-lightning',
  crowdFlood: 'crowd-flood-rgb',
  crowdWave: 'crowd-wave-lateral',
  crowdPulse: 'crowd-pulse-radial',
  crowdChase: 'crowd-chase-sections',
  crowdSparkle: 'crowd-sparkle-gold',
  crowdText: 'crowd-text-marquee',
  crowdHeartbeat: 'crowd-heartbeat-red',
  crowdHaptic: 'crowd-haptic-thump',
  crowdBlackout: 'crowd-blackout',
  beamBell: 'beam-toll-bell',
  beamPulse: 'beam-zone-pulse',
  beamWhisper: 'beam-whisper-count',
  beamFlyover: 'beam-flyover-whoosh',
  beamStereo: 'beam-stereo-bed',
  beamBlip: 'beam-pingpong-blip',
  beamTag: 'beam-tag-drone',
} as const

/** Crowd-grid index on the lakeside 38×9 canvas (row 8 = front of the lawn). */
const cell = (row: number, col: number): number => row * 38 + col

/** Front-corner strokes/whispers (within the south arrays' pan and throw). */
const SW_TOLL_CELL = cell(7, 4) // (-114, -200), 31.6 m from beam-south-west
const SE_TOLL_CELL = cell(7, 34) // (126, -200), 22.8 m from beam-south-east
const SW_WHISPER_CELL = cell(7, 3) // (-122, -200)
const SE_WHISPER_CELL = cell(7, 33) // (118, -200)
/** Ping-pong laughter bounces between these east-corner pairs (alternated). */
const LAUGH_PAIR_A = [cell(7, 34), cell(7, 33)] as const
const LAUGH_PAIR_B = [cell(7, 35), cell(7, 37)] as const
/** Flyover sweep down the lawn's center column (front row → back row). */
const FLY_PATH_OUT = [cell(8, 19), cell(4, 19), cell(0, 19)] as const
/** Dawn: the spirits flee back-to-front, the way they came. */
const FLY_PATH_BACK = [cell(0, 19), cell(4, 19), cell(8, 19)] as const
/** The ghost's moan beds converge on these mid-lawn cells (one per bed). */
const BED_CELLS = [cell(4, 19), cell(4, 13), cell(4, 25)] as const
/** Central cell: bat-tag fallback aim and the stomp-ring origin. */
const CENTER_CELL = cell(4, 19)
/** The heartbeat plague radiates from the front-center cell. */
const PLAGUE_ORIGIN_CELL = cell(8, 19)

/** Mountain King statement accents, in score order (heartbeat restatements). */
const STATEMENTS = ['creep', 'stalk', 'pursuit', 'quarry', 'frenzy'] as const
/** Heartbeat color ramps brighter with each statement. */
const PLAGUE_RGB = [
  [0.35, 0.02, 0.04],
  [0.5, 0.04, 0.06],
  [0.65, 0.06, 0.08],
  [0.8, 0.08, 0.1],
  [0.95, 0.1, 0.12],
] as const

/** Danse Macabre waltz phrase ends carrying volleys/laughter/waves. */
const WALTZ_PHRASES = { from: 0, to: 6 } as const
/** Mountain King phrase-end indices in the combined suite. */
const HUNT_PHRASES = { from: 8, to: 12 } as const

const STOMP_COUNT = 8

/**
 * The twelve strokes of midnight, one per 'toll' hit annotation. See the
 * module note: the six-array rotation keeps every per-array gap clear of the
 * 3–4 s ring time (BEAM_SLEW), and every stroke lands exactly on its beat.
 * `target` present = near-field corner stroke; absent = cells:'all'.
 */
const TOLL_PLAN: readonly { position: string; effect: string; target?: number }[] = [
  { position: 'beam-delay-west', effect: FX.beamBell },
  { position: 'beam-north-west', effect: FX.beamPulse },
  { position: 'beam-north-east', effect: FX.beamPulse },
  { position: 'beam-delay-east', effect: FX.beamBell },
  { position: 'beam-delay-west', effect: FX.beamBell },
  { position: 'beam-south-west', effect: FX.beamPulse, target: SW_TOLL_CELL },
  { position: 'beam-north-west', effect: FX.beamPulse },
  { position: 'beam-delay-east', effect: FX.beamBell },
  { position: 'beam-delay-west', effect: FX.beamBell },
  { position: 'beam-south-east', effect: FX.beamPulse, target: SE_TOLL_CELL },
  { position: 'beam-north-east', effect: FX.beamPulse },
  { position: 'beam-delay-east', effect: FX.beamBell },
]

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Fresh combined-suite timeline: Danse Macabre → Mountain King → Dawn. */
function suiteTimeline(): MusicalTimeline {
  return buildTimelineFromScore(
    concatScores(concatScores(danseMacabre, mountainKing), dawnOfAllSaints, {
      id: 'hallows-suite',
      title: 'The Unquiet Hour Suite',
    }),
  )
}

// ---------------------------------------------------------------------------
// Shared sections (identical in both variants — every effect here is quiet)
// ---------------------------------------------------------------------------

/** Eyes blink open in the dark, 6 s before the music starts. */
function eyesInTheDark(b: ShowBuilder, m: MusicRefs): void {
  PANELS.forEach((panel, i) => {
    b.panels.pattern({
      id: `eyes-${i}`,
      effect: FX.panelEyes,
      position: panel,
      from: m.time(-6),
      rgb: RGB.ecto,
    })
  })
}

/** The twelve tolls + the bone-white afterglow half a beat behind each. */
function twelveTolls(b: ShowBuilder, m: MusicRefs): void {
  TOLL_PLAN.forEach((stop, i) => {
    const land = m.hit('toll', i)
    if (stop.target === undefined) {
      b.beams.toll({ effect: stop.effect, position: stop.position, land, idPrefix: `toll-${i}` })
    } else {
      // Near-field corner stroke: same zone-pulse program, aimed at one cell.
      b.beams.whisper({
        effect: stop.effect,
        position: stop.position,
        target: stop.target,
        land,
        idPrefix: `toll-${i}`,
      })
    }
    b.crowd.flood({
      id: `toll-glow-${i}`,
      effect: FX.crowdFlood,
      position: 'mast-west',
      from: m.offset(land, 0.5),
      rgb: RGB.bone,
      intensity: 0.25,
    })
  })
}

/** Roving whispers walk the front corners while the fiddler tunes. */
function tuningWhispers(b: ShowBuilder, m: MusicRefs): void {
  const tuning = m.annotation('accent', 0, 'tuning')
  b.beams.whisper({
    effect: FX.beamWhisper,
    position: 'beam-south-west',
    target: SW_WHISPER_CELL,
    land: m.offset(tuning, 2),
    idPrefix: 'whisper-west',
  })
  b.beams.whisper({
    effect: FX.beamWhisper,
    position: 'beam-south-east',
    target: SE_WHISPER_CELL,
    land: m.offset(tuning, 4),
    idPrefix: 'whisper-east',
  })
}

/** Three invisible flyovers on the tritones; the third reveals the bats. */
function tritoneFlyovers(b: ShowBuilder, m: MusicRefs): void {
  const lands = [m.hit('tritone', 0), m.hit('tritone', 1), m.offset(m.hit('tritone', 1), 6)]
  lands.forEach((land, i) => {
    b.beams.flyover({
      effect: FX.beamFlyover,
      position: i === 1 ? 'beam-north-east' : 'beam-north-west',
      path: FLY_PATH_OUT,
      land,
      idPrefix: `tritone-fly-${i}`,
    })
  })
  // The bats appear where the sound went…
  b.drones.formation({
    id: 'bats-rise',
    effect: FX.droneBat,
    position: PAD_SIDE,
    by: lands[2]!,
    holdSec: 30,
    params: { count: 50, rgb: RGB.violet },
  })
  // …and the east mast narrates the flock (source-tagged audio).
  b.beams.tag({
    effect: FX.beamTag,
    position: 'beam-north-east',
    source: 'bats-rise',
    fallbackTarget: CENTER_CELL,
    land: m.offset(m.hit('tritone', 1), 16),
    idPrefix: 'bat-tag',
  })
}

/** The ghost rises at the danse and moans via crossed stereo beds. */
function ghostAndMoans(b: ShowBuilder, m: MusicRefs): void {
  b.drones.formation({
    id: 'ghost-rise',
    effect: FX.droneGhost,
    position: PAD_MAIN,
    by: m.annotation('accent', 0, 'danse'),
    holdSec: 60,
    params: { count: 80, rgb: RGB.ecto },
  })
  // Three 16 s beds, each converging on a DIFFERENT mid-lawn cell so no cell
  // sits under the carrier for more than one bed per exposure window.
  const lands = [m.annotation('accent', 0, 'danse'), m.phraseEnd(1), m.phraseEnd(3)]
  lands.forEach((land, i) => {
    b.beams.stereo({
      effect: FX.beamStereo,
      positions: ['beam-delay-west', 'beam-delay-east'],
      target: BED_CELLS[i]!,
      land,
      idPrefix: `moan-${i}`,
    })
  })
}

/** Lateral crowd wave as the waltz metronome + sparkle ticks on the bones. */
function waltzCrowd(b: ShowBuilder, m: MusicRefs): void {
  const froms = [m.annotation('accent', 0, 'danse'), ...m.everyPhraseEnd({ from: 0, to: 5 })]
  froms.forEach((from, i) => {
    b.crowd.wave({
      effect: FX.crowdWave,
      position: 'mast-west',
      from,
      periodBeats: 3,
      rgb: i % 2 === 0 ? RGB.ecto : RGB.violet,
      idPrefix: `waltz-wave-${i}`,
    })
  })
  const bones = m.annotation('accent', 0, 'bones')
  b.crowd.sparkle({
    id: 'sparkle-0',
    effect: FX.crowdSparkle,
    position: 'mast-east',
    from: bones,
    rgb: RGB.ecto,
  })
  b.crowd.sparkle({
    id: 'sparkle-1',
    effect: FX.crowdSparkle,
    position: 'mast-east',
    from: m.offset(bones, 28),
    rgb: RGB.ecto,
  })
}

/** Ping-pong laughter in the east corner + the violet web on the bones. */
function laughterAndWebs(b: ShowBuilder, m: MusicRefs): void {
  m.everyPhraseEnd(WALTZ_PHRASES).forEach((land, i) => {
    b.beams.pingPong({
      effect: FX.beamBlip,
      position: 'beam-south-east',
      cells: i % 2 === 0 ? LAUGH_PAIR_A : LAUGH_PAIR_B,
      periodBeats: 2,
      land,
      idPrefix: `laugh-${i}`,
    })
  })
  const bones = m.annotation('accent', 0, 'bones')
  LASERS.forEach((tower, i) => {
    b.lasers.pattern({ id: `web-${i}`, effect: FX.laserWeb, position: tower, from: bones, durBeats: 24 })
  })
  PANELS.forEach((panel, i) => {
    b.panels.pattern({ id: `ember-${i}`, effect: FX.panelEmbers, position: panel, from: bones })
  })
}

/** Sabbath laser fans (the volley on the same climax is variant-specific). */
function sabbathFans(b: ShowBuilder, m: MusicRefs): void {
  LASERS.forEach((tower, i) => {
    b.lasers.pattern({
      id: `fan-${i}`,
      effect: FX.laserFan,
      position: tower,
      from: m.climax(0),
      durBeats: 16,
    })
  })
}

/** THE HEARTBEAT PLAGUE + the west/east call-and-response chase. */
function heartbeatPlague(b: ShowBuilder, m: MusicRefs): void {
  STATEMENTS.forEach((label, i) => {
    b.crowd.heartbeat({
      effect: FX.crowdHeartbeat,
      position: 'mast-west',
      land: m.annotation('accent', 0, label),
      originCell: PLAGUE_ORIGIN_CELL,
      rgb: PLAGUE_RGB[i]!,
      idPrefix: `plague-${i}`,
    })
  })
  // At the frenzy every wrist pounds.
  b.crowd.haptic({
    id: 'plague-haptic',
    effect: FX.crowdHaptic,
    position: 'mast-east',
    land: m.annotation('accent', 0, 'frenzy'),
  })
  b.crowd.chase({
    effect: FX.crowdChase,
    position: 'mast-east',
    startLand: m.annotation('accent', 0, 'pursuit'),
    stepBeats: 8,
    sections: 2,
    rgb: RGB.ember,
    idPrefix: 'call-response',
  })
}

/**
 * The 8 hammer stomps, quiet media: panel lightning on every stomp; crowd
 * rings from the center on stomps 0/2/4/6 (mast-west stays exactly at its
 * 30 Hz mask cap: three 6 s rings overlap at the accelerando's end); wrist
 * thumps on stomps 1/3/5 (mast-east keeps 10 Hz headroom for the BOO text
 * that lands on stomp 7 — the summit itself).
 */
function stompsShared(b: ShowBuilder, m: MusicRefs): void {
  for (let i = 0; i < STOMP_COUNT; i++) {
    const land = m.hit('stomp', i)
    b.panels.pattern({
      id: `stomp-${i}-flash`,
      effect: FX.panelLightning,
      position: PANELS[i % 2]!,
      from: land,
      rgb: RGB.bone,
    })
    if (i % 2 === 0) {
      b.crowd.pulse({
        effect: FX.crowdPulse,
        position: 'mast-west',
        land,
        originCell: CENTER_CELL,
        periodBeats: 1,
        rgb: RGB.ember,
        idPrefix: `stomp-ring-${i}`,
      })
    } else if (i < 7) {
      b.crowd.haptic({
        id: `stomp-thump-${i}`,
        effect: FX.crowdHaptic,
        position: 'mast-east',
        land,
      })
    }
  }
}

/** Summit crowd BOO + the ghost blooming apart on the closing chord. */
function summitReveal(b: ShowBuilder, m: MusicRefs): void {
  b.crowd.text('BOO', {
    effect: FX.crowdText,
    position: 'mast-east',
    land: m.climax(1),
    rgb: RGB.ecto,
    idPrefix: 'boo',
  })
  b.drones.formation({
    id: 'ghost-bloom',
    effect: FX.droneBloom,
    position: PAD_MAIN,
    by: m.climax(1),
    holdSec: 6,
    params: { count: 80, scaleM: 45, rgb: RGB.violet },
  })
}

/** Dawn: reversed flyovers, warm floods, the last bell, blink, blackout. */
function dawnBanishing(b: ShowBuilder, m: MusicRefs): void {
  for (let i = 0; i < 3; i++) {
    b.beams.flyover({
      effect: FX.beamFlyover,
      position: 'beam-north-east',
      path: FLY_PATH_BACK,
      land: m.hit('cockcrow', i),
      idPrefix: `cockcrow-${i}`,
    })
  }
  MASTS.forEach((mast, i) => {
    b.crowd.flood({
      id: `dawn-flood-${i}`,
      effect: FX.crowdFlood,
      position: mast,
      from: m.annotation('accent', 0, 'dawn'),
      rgb: RGB.ember,
      rgb2: RGB.bone,
      intensity: 0.6,
    })
  })
  const lastBell = m.hit('lastBell', 0)
  b.beams.toll({
    effect: FX.beamBell,
    position: 'beam-delay-west',
    land: lastBell,
    idPrefix: 'final-toll',
  })
  // One dim blink at the cell where the plague began — then nothing.
  b.crowd.pulse({
    effect: FX.crowdPulse,
    position: 'mast-west',
    land: lastBell,
    originCell: PLAGUE_ORIGIN_CELL,
    periodBeats: 1,
    rgb: [0.3, 0.29, 0.27],
    idPrefix: 'last-blink',
  })
  MASTS.forEach((mast, i) => {
    b.crowd.flood({
      id: `blackout-${i}`,
      effect: FX.crowdBlackout,
      position: mast,
      from: m.offset(lastBell, 2),
    })
  })
}

/**
 * Program notes (the printed program), shared by both variants: four acts on
 * the suite's own marks — the danse, the first Mountain King statement, and
 * the first cock-crow of the dawn coda.
 */
function programNotes(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  b.notes({
    tagline: quiet
      ? 'The haunting arrives through sound before anything is seen — the quiet performance: the same ghosts, softer thunder.'
      : 'The haunting arrives through sound before anything is seen.',
    music: [
      'Camille Saint-Saëns — Danse Macabre (1874)',
      'Edvard Grieg — In the Hall of the Mountain King (1875)',
      'Theodoor — Dawn of All Saints (original coda)',
    ],
    epilogue: 'Twelve strokes, one heartbeat, and a dawn.',
  })
  b.act(
    'I — The Summoning',
    m.time(0),
    'Eyes blink open on the panels in the dark. Then midnight tolls twelve times — not from a ' +
      'speaker but from the directional arrays, each stroke sent early by the time sound needs ' +
      'to cross the lawn, so every seat hears the bell at the same instant; the lawn glows ' +
      'bone-white half a beat behind each stroke. Whispers walk the front corners while the ' +
      'fiddler tunes, and three invisible whooshes fly over you on the tritones. On the third, ' +
      'look up: the bats are where the sound went.',
  )
  b.act(
    'II — The Dance',
    m.annotation('accent', 0, 'danse'),
    'An eighty-drone ghost rises over the display and moans from where it hangs — crossed audio ' +
      'beds place the sound at the spot in the sky it occupies. The waltz keeps time as a wave ' +
      'across your wristbands; green and violet volleys ride the phrase ends; laughter ' +
      'ping-pongs between two corner seats. On the bones theme, a violet web of laser light and ' +
      'ember panels.',
  )
  b.act(
    'III — The Chase',
    m.annotation('accent', 0, 'creep'),
    'The Mountain King begins as a heartbeat in the front-centre cell and spreads through the ' +
      'crowd, redder and stronger with every statement, until every wrist pounds on the frenzy. ' +
      'Eight hammer stomps land on the outer racks with lightning on the panels and rings ' +
      'through the lawn. The summit takes a 25-second barrage; the crowd spells BOO; the ghost ' +
      'blooms apart.',
  )
  b.act(
    'IV — Dawn',
    m.hit('cockcrow', 0),
    'Three cock-crows send the spirits back the way they came — the flyovers reverse. Warm ' +
      'light floods the lawn, willows hang at daybreak, and the last bell tolls everywhere at ' +
      'once into a single blink where the plague began. Then blackout.',
  )
}

/** Everything both variants share (all of it is quiet-legal). */
function sharedShow(b: ShowBuilder, m: MusicRefs): void {
  eyesInTheDark(b, m)
  twelveTolls(b, m)
  tuningWhispers(b, m)
  tritoneFlyovers(b, m)
  ghostAndMoans(b, m)
  waltzCrowd(b, m)
  laughterAndWebs(b, m)
  sabbathFans(b, m)
  heartbeatPlague(b, m)
  stompsShared(b, m)
  summitReveal(b, m)
  dawnBanishing(b, m)
}

// ---------------------------------------------------------------------------
// Variant-specific pyro
// ---------------------------------------------------------------------------

/** Green/violet volleys on the waltz phrase ends (effects vary per variant). */
function waltzVolleys(b: ShowBuilder, m: MusicRefs, effects: readonly [string, string]): void {
  m.everyPhraseEnd(WALTZ_PHRASES).forEach((land, i) => {
    b.pyro.volley({
      idPrefix: `waltz-volley-${i}`,
      effects: i % 2 === 0 ? [effects[0], effects[1]] : [effects[1], effects[0]],
      positions: i % 2 === 0 ? VOLLEY_ODD_RACKS : VOLLEY_EVEN_RACKS,
      land,
    })
  })
}

/** Single shots walking the racks on the Mountain King phrase ends. */
function huntShots(b: ShowBuilder, m: MusicRefs, effects: readonly [string, string]): void {
  m.everyPhraseEnd(HUNT_PHRASES).forEach((land, i) => {
    b.pyro.fire({
      id: `hunt-shot-${i}`,
      effect: effects[i % 2]!,
      position: WALK_RACKS[i % WALK_RACKS.length]!,
      land,
    })
  })
}

/** The summit barrage: 25 s ramp peaking ON the strength-1.0 climax. */
function summitBarrage(b: ShowBuilder, m: MusicRefs, pool: readonly string[]): void {
  b.pyro.barrage({
    idPrefix: 'summit-barrage',
    window: { peak: m.climax(1), windowSec: 25 },
    effectPool: pool,
    positions: BARRAGE_RACKS,
    startRateHz: 0.5,
    endRateHz: 5,
  })
}

// ---------------------------------------------------------------------------
// Standard show
// ---------------------------------------------------------------------------

/** The Unquiet Hour (standard variant). Throws if any diagnostic is an error. */
export function hallows(): BuildResult {
  const tl = suiteTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'hallows',
    title: 'The Unquiet Hour',
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant: 'standard',
  })
    .music(tl)
    .preRoll(PRE_ROLL_SEC)
    .quantize('none')

  programNotes(b, m, false)
  sharedShow(b, m)

  // --- ACT 2: green/violet volleys + the sabbath peak -----------------------
  waltzVolleys(b, m, [FX.peonyGreen, FX.peonyViolet])
  b.pyro.volley({
    idPrefix: 'sabbath-volley',
    effects: [FX.peonyViolet, FX.crossetteOrange],
    positions: ['rack-2', 'rack-4', 'rack-6'],
    land: m.climax(0),
  })

  // --- ACT 3: the hunt, the stomps, the summit -------------------------------
  huntShots(b, m, [FX.crossetteOrange, FX.chrysGold])
  for (let i = 0; i < STOMP_COUNT; i++) {
    const land = m.hit('stomp', i)
    b.pyro.fire({
      id: `stomp-${i}-mine`,
      effect: FX.mineRed,
      position: OUTER_RACKS[i % 2]!,
      land,
    })
    b.pyro.fire({
      id: `stomp-${i}-burst`,
      effect: FX.crossetteOrange,
      position: OUTER_RACKS[(i + 1) % 2]!,
      land,
    })
  }
  summitBarrage(b, m, [
    FX.peonyGreen,
    FX.peonyViolet,
    FX.crossetteOrange,
    FX.chrysGold,
    FX.willowStrobe,
  ])

  // --- DAWN: strobing willows hang at daybreak -------------------------------
  ;(['rack-3', 'rack-6'] as const).forEach((rack, i) => {
    b.pyro.fire({ id: `daybreak-${i}`, effect: FX.willowStrobe, position: rack, land: m.climax(2) })
  })

  return b.build()
}

// ---------------------------------------------------------------------------
// Quiet show
// ---------------------------------------------------------------------------

/**
 * The quiet variant: same timeline and structure, and the beam/crowd/drone/
 * laser/panel design is UNCHANGED — those cues ARE the show. Pyro pools swap
 * to low-noise entries, the stomps drop their loud pairs (lightning, rings
 * and thumps carry them), and the whole show holds a summed 85 dB SPL budget
 * at the audience listeners.
 */
export function hallowsQuiet(): BuildResult {
  const tl = suiteTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'hallows-quiet',
    title: 'The Unquiet Hour (Quiet)',
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant: 'quiet',
  })
    .music(tl)
    .preRoll(PRE_ROLL_SEC)
    .quantize('none')
    .noiseBudget(85)

  programNotes(b, m, true)
  sharedShow(b, m)

  // --- ACT 2: low-noise mines/comets take the waltz landings ----------------
  waltzVolleys(b, m, [FX.mineGreen, FX.cometSilver])
  b.pyro.volley({
    idPrefix: 'sabbath-volley',
    effects: [FX.crossetteSilver, FX.mineGreen],
    positions: ['rack-2', 'rack-4', 'rack-6'],
    land: m.climax(0),
  })

  // --- ACT 3: the hunt walks in comets; stomps keep only their quiet media ---
  huntShots(b, m, [FX.cometSilver, FX.mineGreen])
  summitBarrage(b, m, [FX.cometGold, FX.cometSilver, FX.mineGreen, FX.mineSilver])

  // --- DAWN: silver comet pair at daybreak -----------------------------------
  ;(['rack-3', 'rack-6'] as const).forEach((rack, i) => {
    b.pyro.fire({
      id: `daybreak-${i}`,
      effect: i === 0 ? FX.cometSilver : FX.mineSilver,
      position: rack,
      land: m.climax(2),
    })
  })

  return b.build()
}
