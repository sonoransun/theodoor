/**
 * programs/src/vltava.ts — "Vltava — The River", the water-and-light
 * flagship program, plus its quiet variant for noise-sensitive audiences.
 *
 * Music: Bedřich Smetana's Vltava (Má vlast, 1874) in Theodoor's own
 * arrangement — eight sections, 278 s, one strength-1 climax ('broadRiver').
 *
 * THE THEME IS THE RIVER ITSELF, AND THE TWO NEWEST KINDS OF PHYSICS. Water
 * is the first thing the audience sees, and every column is commanded early
 * by the bank's valve latency plus its ballistic rise sqrt(2h/g) so the crest
 * — not the valve — lands on the beat. The searchlights are chained per bank
 * like a drone pad: every figure is fired early by its heads' slew from
 * wherever the previous figure left them, so the light arrives on the beat
 * while visibly in motion. Around them the older media do what they do best.
 *
 *   I    TWO SPRINGS (0–25 s): a cold blue-white plume crests on the first
 *        spring hit, a warm gold one on the second; a mist screen breathes low
 *        on both banks; the wristbands sparkle silver-blue; a whisper names
 *        the river from a front-corner array. The sky stays dark.
 *   II   THE RIVER (25–74 s): the springs join — mirrored cascades run
 *        outward from center on every phrase end, pad-1 rises as the river's
 *        surface (a wave line, then a spiral), the crowd waves west→east in
 *        three, silver comets on the second statement's phrase ends, and the
 *        searchlights wake with one slow low sweep from both banks.
 *   III  FOREST HUNT (74–99 s): gold fans from both banks — sun through the
 *        trees; horn calls as blips bouncing between the east front corner
 *        cells and whispers from the west; gold comets on the horn hits;
 *        pad-2 scatters as startled birds; ember panels.
 *   IV   PEASANT WEDDING (99–127 s): the polka — a section chase and RWB
 *        floods on the stomps, low mines on alternating racks, peacock fans
 *        alternating banks, pad-1 turns a ring, flag-stripe panels, laser
 *        fans, and the searchlights chase the beat.
 *   V    MOONLIGHT, NYMPHS (127–171 s): everything else dark; both banks
 *        converge into one spire over center stage — the moon; pad-2 hangs a
 *        crescent; mist under blue; ONE 45 m shooter crests on EACH nymph hit
 *        (alternating banks) — the 3.18 s lead made visible; silver sparkle;
 *        crossed stereo beds from the delay towers; laser aurora curtains.
 *   VI   ST JOHN'S RAPIDS (171–204 s): turbulence — crossettes and mines on
 *        the eight rapid hits, three of them with beam-delivered thunder from
 *        the north arrays and the rest with zone pulses from the east delay
 *        tower; violet crossed beams then a frantic chase from the
 *        searchlights; fast cascades running back and forth plus the rolling
 *        wave; sweep-lines roaring front→back down the lawn on the phrase
 *        ends; fast crowd waves, panel lightning, laser sweeps, and a 20 s
 *        ramped barrage into the climax.
 *   VII  THE BROAD VLTAVA (204–228 s): the climax — a triple gold brocade,
 *        each with thunder from its own array, nine 45 m shooters on BOTH
 *        banks cresting on the same beat, white pillars from both banks,
 *        pad-1 blooming gold, the crowd flooding gold with a thump in every
 *        wristband, waveform panels; then peonies on the major statement's
 *        phrase end.
 *   VIII VYŠEHRAD (228–278 s): the chorale — the spire returns as the
 *        castle, gold willows hang with their thunder, pad-1 spells VLTAVA
 *        and the crowd spells it back, slow gold cascades; on the last wave a
 *        single plume rises and falls, one bank of pillars remains, a bell
 *        tolls everywhere at once, the canvas goes dark — the river flows on.
 *
 * vltavaQuiet(): identical skeleton, variant 'quiet', 85 dB noise budget,
 * shells swapped to the low-noise pool, wristband thumps standing in for the
 * reports; fountains and searchlights unchanged (they are already quiet).
 *
 * Determinism: pure functions of constants only — no Date.now, no
 * Math.random, no module-level caches; every call builds a fresh show.
 */

import type {
  BuildResult,
  MusicAnchor,
  MusicalTimeline,
  MusicRefs,
  ShowBuilder,
} from '@theodoor/core'
import {
  buildTimelineFromScore,
  lakesidePark,
  musicRefs,
  showBuilder,
  starterCatalog,
  vltava as vltavaScore,
} from '@theodoor/core'
import { RGB } from './palettes.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Vltava's premiere: 4 April 1875. */
const SEED = 18750404
const PRE_ROLL_SEC = 8

/** lakesidePark asset ids. */
const PAD_MAIN = 'pad-1'
const PAD_SIDE = 'pad-2'
const FOUNT_W = 'fount-west'
const FOUNT_E = 'fount-east'
const FOUNTS = [FOUNT_W, FOUNT_E] as const
const LIGHTS_W = 'lights-west'
const LIGHTS_E = 'lights-east'
const LIGHTS = [LIGHTS_W, LIGHTS_E] as const
const LASERS = ['laser-west', 'laser-east'] as const
const PANELS = ['panel-west', 'panel-east'] as const
const MAST_W = 'mast-west'
const MAST_E = 'mast-east'
/** Long-throw arrays on the 25 m masts — thunder-with-flash. */
const BEAM_NW = 'beam-north-west'
const BEAM_NE = 'beam-north-east'
/** Whole-zone delay towers — stereo beds, sweep-lines, zone pulses, the bell. */
const BEAM_DW = 'beam-delay-west'
const BEAM_DE = 'beam-delay-east'
/** Near-field corner arrays — front-corner whispers and blips. */
const BEAM_SW = 'beam-south-west'
const BEAM_SE = 'beam-south-east'
/** Inner racks carry the barrage; the outer ones the featured shells. */
const BARRAGE_RACKS = ['rack-3', 'rack-4', 'rack-5', 'rack-6'] as const

/** Starter-catalog effect ids (see packages/core/src/catalog/starter). */
const FX = {
  cometGold: 'comet-30-gold',
  cometSilver: 'comet-30-silver',
  mineRed: 'mine-75-red',
  mineGreen: 'mine-50-green',
  mineSilver: 'mine-50-silver',
  crossetteRed: 'crossette-100-red',
  crossetteOrange: 'crossette-100-orange',
  crossetteSilver: 'crossette-75-silver',
  peonyGreen: 'peony-75-green',
  peonyWhite: 'peony-100-white',
  peonyViolet: 'peony-100-violet',
  peonyGold: 'peony-150-gold',
  chrysGold: 'chrysanthemum-100-gold',
  willowGold: 'willow-150-gold',
  brocadeGold: 'brocade-200-gold',
  droneWave: 'wave-formation-100',
  droneSpiral: 'spiral-formation-120',
  droneRing: 'ring-formation-60',
  droneScatter: 'scatter-formation-100',
  droneCrescent: 'crescent-formation-60',
  droneBloom: 'bloom-formation-120',
  droneText: 'text-formation-150',
  laserFan: 'laser-fan-rgb',
  laserAurora: 'laser-aurora-curtain',
  laserSweep: 'laser-sweep-gold',
  laserWeb: 'laser-web-violet',
  panelEmbers: 'panel-embers',
  panelFlag: 'panel-flag-stripes',
  panelAurora: 'panel-aurora',
  panelLightning: 'panel-lightning',
  panelWaveform: 'panel-waveform-bars',
  crowdSparkle: 'crowd-sparkle-gold',
  crowdWave: 'crowd-wave-lateral',
  crowdChase: 'crowd-chase-sections',
  crowdFlood: 'crowd-flood-rgb',
  crowdText: 'crowd-text-marquee',
  crowdHaptic: 'crowd-haptic-thump',
  crowdBlackout: 'crowd-blackout',
  beamWhisper: 'beam-whisper-narration',
  beamBlip: 'beam-pingpong-blip',
  beamStereo: 'beam-stereo-bed',
  beamTag: 'beam-tag-drone',
  beamZonePulse: 'beam-zone-pulse',
  beamSweepLine: 'beam-sweep-line',
  beamBell: 'beam-toll-bell',
  fountPlume: 'fountain-plume-30m',
  fountShooter: 'fountain-shooter-45m',
  fountFan: 'fountain-fan-20m',
  fountWave: 'fountain-wave-15m',
  fountCascade: 'fountain-cascade-25m',
  fountMist: 'fountain-mist-screen',
  lightPillar: 'light-pillar-white',
  lightSpire: 'light-converge-spire',
  lightFan: 'light-fan-gold',
  lightSweep: 'light-sweep-slow',
  lightCross: 'light-cross-violet',
  lightChase: 'light-chase-beat',
} as const

/**
 * Crowd-grid cell indices (38 cols × 9 rows, index = row·38 + col, 8 m
 * cells; row 8 is the FRONT of the lawn at y = −192, row 0 the back at
 * y = −256). The same known-feasible geometry as cosmos.ts.
 */
const CELL = {
  westMid: 161, // (−74, −224)
  center: 170, // (−2, −224)
  eastMid: 180, // (78, −224)
  delayWest: 166, // (−34, −224)
  delayEast: 175, // (38, −224)
  frontWest: [266, 267, 268, 269], // y = −200, x = −146 … −122
  frontEast: [302, 301], // y = −200, x = 142 / 134
  /** Column-19 walk (x = 6): front row 8 → mid row 4 → back row 0. */
  dopplerPath: [323, 171, 19],
} as const

/** The moon / the castle: both banks converge on one point over center stage. */
const SPIRE_POINT = { x: 0, z: 160 } as const

/**
 * The eight rapid hits: which rack fires, which standard/quiet shell, and how
 * its report is delivered — a north-array thunder tag (three hits, alternating
 * arrays so each array's 12 s program clears before its next and before the
 * climax brocade it also carries) or a whole-lawn zone pulse from the east
 * delay tower (the other five).
 */
const RAPIDS = [
  { rack: 'rack-2', std: FX.crossetteRed, quiet: FX.crossetteSilver, report: BEAM_NW, cell: CELL.westMid },
  { rack: 'rack-7', std: FX.crossetteOrange, quiet: FX.mineGreen, report: BEAM_DE },
  { rack: 'rack-3', std: FX.mineRed, quiet: FX.mineSilver, report: BEAM_NE, cell: CELL.eastMid },
  { rack: 'rack-6', std: FX.crossetteSilver, quiet: FX.cometGold, report: BEAM_DE },
  { rack: 'rack-4', std: FX.crossetteRed, quiet: FX.crossetteSilver, report: BEAM_NW, cell: CELL.westMid },
  { rack: 'rack-5', std: FX.crossetteOrange, quiet: FX.mineGreen, report: BEAM_DE },
  { rack: 'rack-2', std: FX.mineRed, quiet: FX.mineSilver, report: BEAM_DE },
  { rack: 'rack-7', std: FX.crossetteSilver, quiet: FX.cometGold, report: BEAM_DE },
] as const

/** The triple brocade on the climax: rack → its own thunder array. */
const CLIMAX_TRIPLE = [
  { rack: 'rack-2', array: BEAM_NW, cell: CELL.westMid },
  { rack: 'rack-7', array: BEAM_NE, cell: CELL.eastMid },
  { rack: 'rack-1', array: BEAM_DW, cell: CELL.delayWest },
] as const

/** Barrage pools, ramped small → large by the builder. */
const BARRAGE_STD = [
  FX.peonyGreen,
  FX.peonyWhite,
  FX.peonyViolet,
  FX.chrysGold,
  FX.brocadeGold,
] as const
const BARRAGE_QUIET = [
  FX.cometGold,
  FX.cometSilver,
  FX.mineGreen,
  FX.mineSilver,
  FX.crossetteSilver,
] as const

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Fresh Vltava timeline (one score, no concatenation). */
function riverTimeline(): MusicalTimeline {
  return buildTimelineFromScore(vltavaScore)
}

// ---------------------------------------------------------------------------
// Thunder-with-flash helper (the cosmos signature, reused)
// ---------------------------------------------------------------------------

interface ThunderSpec {
  /** Pyro cue id (the beam tag becomes `thunder-<id>-000`). */
  id: string
  effect: string
  position: string
  /** Beam array delivering the report. */
  array: string
  /** Fallback aim cell — also the ToF reference for the anticipation. */
  cell: number
  land: MusicAnchor
}

/**
 * One shell plus its thunder: a beam tag sourced on the shell, landing on
 * the SAME anchor. The solver fires the beam early by slant / 343 s, so the
 * wavefront arrives with the flash (identical targetSec, different fireSec).
 */
function fireWithThunder(b: ShowBuilder, spec: ThunderSpec): void {
  b.pyro.fire({ id: spec.id, effect: spec.effect, position: spec.position, land: spec.land })
  b.beams.tag({
    effect: FX.beamTag,
    position: spec.array,
    source: spec.id,
    fallbackTarget: spec.cell,
    land: spec.land,
    idPrefix: `thunder-${spec.id}`,
  })
}

// ---------------------------------------------------------------------------
// Program notes
// ---------------------------------------------------------------------------

function programNotes(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  b.notes({
    tagline: quiet
      ? 'Two springs become a river: water that crests on the beat, light that arrives on it — the quiet performance, the river heard through water and wrist.'
      : 'Two springs become a river: water that crests on the beat, light that arrives on it.',
    music: ['Bedřich Smetana — Vltava (Má vlast, 1874)'],
    epilogue: 'The river flows on past the castle rock, out of sight, out of hearing.',
  })
  b.act(
    'I — Two Springs',
    m.hit('spring', 0),
    'Nothing in the sky yet. On the first bar a single cold column of water rises from the ' +
      'west bank and reaches its crest exactly on the beat; a warm gold one answers from the ' +
      'east. Each was commanded almost three seconds early — the pumps need their latency and ' +
      'the water needs its rise — so what lands on the music is the crest, not the valve. Mist ' +
      'breathes low over both banks, the wristbands sparkle like light on water, and a voice ' +
      'from the front corner names the river.',
  )
  b.act(
    'II — The River',
    m.annotation('accent', 0, 'river'),
    'The theme arrives and the springs join: cascades run outward from center on every phrase ' +
      'end, one column cresting after another on the beat grid. Drones rise as the surface of ' +
      'the river — a line, then a slow spiral. The lawn waves west to east in three. Silver ' +
      'comets mark the second statement, and at the ends of the line the searchlights wake with ' +
      'one slow sweep, low over the water.',
  )
  b.act(
    'III — Forest Hunt',
    m.annotation('accent', 0, 'hunt'),
    'Gold fans from both banks — sun through trees. The horn calls bounce between two seats in ' +
      'the east front corner as short blips while whispers answer from the west; gold comets ' +
      'ride the calls; sixty drones scatter like startled birds and the panels glow with embers.',
  )
  b.act(
    'IV — Peasant Wedding',
    m.annotation('accent', 0, 'wedding'),
    'The polka. A chase runs section by section across the lawn on the stomps, red-white-blue ' +
      'floods answer, low mines thump from alternating racks, peacock fans lean open from one ' +
      'bank then the other, a ring of drones turns overhead, and the searchlights chase the beat ' +
      'head by head.',
  )
  b.act(
    'V — Moonlight, Nymphs',
    m.annotation('accent', 0, 'moonlight'),
    'Everything else goes dark. Eight beams from the two ends of the line converge into one ' +
      'spire over center stage: the moon. A crescent of drones hangs beside it. Watch the ' +
      'fountains: on each of the three nymph chimes a single 45 m shooter crests exactly on the ' +
      'chime — it left the nozzle more than three seconds before you hear the note. Mist under ' +
      'blue light, a silver sparkle across the wristbands, and the melody sung from mid-lawn by ' +
      'crossed directional beds.',
  )
  b.act(
    'VI — St John’s Rapids',
    m.annotation('accent', 0, 'rapids'),
    'Turbulence. Eight rapid hits: crossettes and mines, three of them with thunder delivered by ' +
      'directional beam so the report lands with the flash, the rest as a pulse felt across the ' +
      'whole lawn. Violet beams cross overhead then chase frantically; cascades run back and ' +
      'forth along both banks under a rolling wave; a roar sweeps front to back down the lawn on ' +
      'every phrase; lightning on the panels; and a twenty-second barrage builds into the climax.',
  )
  b.act(
    'VII — The Broad Vltava',
    m.climax(0),
    'The theme in the major. Three gold brocades break together, each with its own thunder from ' +
      'its own array. Nine 45 m shooters on both banks crest on the same beat. White pillars stand ' +
      'up from both ends of the line, the drones bloom gold, the lawn floods gold with a thump in ' +
      'every wristband, and peonies hang over the phrase end.',
  )
  b.act(
    'VIII — Vyšehrad',
    m.annotation('accent', 0, 'vysehrad'),
    'The chorale. The spire returns as the castle rock; gold willows hang over it with their ' +
      'thunder; the drones spell VLTAVA and the wristbands spell it back; slow gold cascades run ' +
      'outward. On the last wave one plume rises and falls, one bank of pillars remains, a bell ' +
      'tolls everywhere at once, and the canvas goes dark.',
  )
}

// ---------------------------------------------------------------------------
// Sections shared by both variants (every effect here is quiet already)
// ---------------------------------------------------------------------------

/** I — the two springs, the mist, the sparkle, the whisper. */
function twoSprings(b: ShowBuilder, m: MusicRefs): void {
  const cold = m.hit('spring', 0)
  const warm = m.hit('spring', 1)
  b.fountains.jet({
    id: 'spring-cold',
    effect: FX.fountPlume,
    position: FOUNT_W,
    crest: cold,
    rgb: RGB.spring,
    rgb2: RGB.white,
  })
  b.fountains.jet({
    id: 'spring-warm',
    effect: FX.fountPlume,
    position: FOUNT_E,
    crest: warm,
    rgb: RGB.meadow,
    rgb2: RGB.white,
  })
  FOUNTS.forEach((bank, i) => {
    b.fountains.mist({ id: `spring-mist-${i}`, position: bank, from: cold, rgb: RGB.deep, rgb2: RGB.spring })
  })
  for (let i = 0; i < 2; i++) {
    b.crowd.sparkle({
      id: `spring-sparkle-${i}`,
      effect: FX.crowdSparkle,
      position: MAST_W,
      from: m.time(12 * i),
      densityFrac: 0.12,
      twinkleHz: 2,
      rgb: RGB.spring,
    })
  }
  b.beams.whisper({
    effect: FX.beamWhisper,
    position: BEAM_SW,
    target: CELL.frontWest[0],
    land: warm,
    gainDb: -2,
    idPrefix: 'name-the-river',
  })
}

/** II — cascades outward, the river surface, the crowd in three, the first sweep. */
function theRiver(b: ShowBuilder, m: MusicRefs): void {
  const river1 = m.annotation('accent', 0, 'river')
  const river2 = m.annotation('accent', 1, 'river')
  // Phrase ends 1, 2, 4 carry outward cascades; phrase end 3 (the second
  // statement) the rolling wave on both banks.
  for (const idx of [1, 2, 4] as const) {
    b.fountains.mirror({
      effect: FX.fountCascade,
      positions: FOUNTS,
      crest: m.phraseEnd(idx),
      stepBeats: 0.5,
      rgb: RGB.spring,
      rgb2: RGB.white,
      idPrefix: `river-cascade-${idx}`,
    })
  }
  b.fountains.mirror({
    effect: FX.fountWave,
    positions: FOUNTS,
    crest: m.phraseEnd(3),
    periodBeats: 6,
    rgb: RGB.deep,
    rgb2: RGB.spring,
    idPrefix: 'river-wave',
  })
  // The river's surface: a line of 30 drones (2 m spacing over 58 m), then a
  // slow spiral for the second statement.
  b.drones.formation({
    id: 'river-surface',
    effect: FX.droneWave,
    position: PAD_MAIN,
    by: river1,
    params: { count: 30, scaleM: 58, rgb: RGB.drift },
  })
  // Six beats past the second statement's downbeat buys the 30→100 morph its
  // 12.8 s kinematic window after the 14 s wave line.
  b.drones.formation({
    id: 'river-spiral',
    effect: FX.droneSpiral,
    position: PAD_MAIN,
    by: m.offset(river2, 6),
    params: { count: 100, scaleM: 56, rgb: RGB.moon },
  })
  ;([1, 2, 3, 4] as const).forEach((idx, i) => {
    b.crowd.wave({
      effect: FX.crowdWave,
      position: i % 2 === 0 ? MAST_W : MAST_E,
      from: m.phraseEnd(idx),
      periodBeats: 3,
      dirDeg: 90,
      rgb: RGB.drift,
      idPrefix: `river-wave-crowd-${idx}`,
    })
  })
  b.pyro.fire({ id: 'river-comet-3', effect: FX.cometSilver, position: 'rack-1', land: m.phraseEnd(3) })
  b.pyro.fire({ id: 'river-comet-4', effect: FX.cometSilver, position: 'rack-8', land: m.phraseEnd(4) })
  // The searchlights wake: one slow low sweep from both banks.
  b.lights.mirror({
    effect: FX.lightSweep,
    positions: LIGHTS,
    land: river1,
    tiltDeg: 10,
    sweepDeg: 20,
    periodBeats: 12,
    rgb: RGB.moon,
    idPrefix: 'river-sweep',
  })
}

/** III — gold fans, horn blips and whispers, gold comets, scattered birds. */
function forestHunt(b: ShowBuilder, m: MusicRefs): void {
  const hunt = m.annotation('accent', 0, 'hunt')
  b.lights.mirror({
    effect: FX.lightFan,
    positions: LIGHTS,
    land: hunt,
    spreadDeg: 60,
    idPrefix: 'hunt-fan',
  })
  for (const idx of [0, 2] as const) {
    b.beams.pingPong({
      effect: FX.beamBlip,
      position: BEAM_SE,
      cells: CELL.frontEast,
      periodBeats: 1,
      land: m.hit('horn', idx),
      idPrefix: `horn-blip-${idx}`,
    })
  }
  for (const idx of [1, 3] as const) {
    b.beams.whisper({
      effect: FX.beamWhisper,
      position: BEAM_SW,
      target: CELL.frontWest[1],
      land: m.hit('horn', idx),
      gainDb: -3,
      idPrefix: `horn-whisper-${idx}`,
    })
  }
  for (let i = 0; i < 4; i++) {
    b.pyro.fire({
      id: `horn-comet-${i}`,
      effect: FX.cometGold,
      position: i % 2 === 0 ? 'rack-2' : 'rack-7',
      land: m.hit('horn', i),
    })
  }
  b.drones.formation({
    id: 'startled-birds',
    effect: FX.droneScatter,
    position: PAD_SIDE,
    by: hunt,
    params: { count: 60, scaleM: 50, rgb: RGB.gold },
  })
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelEmbers, position: panel, from: hunt })
  }
  b.crowd.sparkle({
    id: 'hunt-sparkle',
    effect: FX.crowdSparkle,
    position: MAST_E,
    from: hunt,
    densityFrac: 0.2,
    twinkleHz: 4,
    rgb: RGB.meadow,
  })
}

/** IV — the polka: chase, floods, peacock fans, the turning ring, beat chase. */
function peasantWedding(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  const wedding = m.annotation('accent', 0, 'wedding')
  b.crowd.chase({
    effect: FX.crowdChase,
    position: MAST_W,
    startLand: m.hit('stomp', 0),
    stepBeats: 2,
    sections: 4,
    rgb: RGB.red,
    idPrefix: 'wedding-chase',
  })
  const floodColors = [RGB.white, RGB.blue, RGB.red, RGB.white] as const
  ;([2, 3, 4, 5] as const).forEach((idx, i) => {
    b.crowd.flood({
      id: `wedding-flood-${idx}`,
      effect: FX.crowdFlood,
      position: i % 2 === 0 ? MAST_E : MAST_W,
      from: m.hit('stomp', idx),
      rgb: floodColors[i]!,
      intensity: 0.85,
    })
  })
  const mineFx = quiet ? ([FX.mineGreen, FX.mineSilver] as const) : ([FX.mineRed, FX.mineSilver] as const)
  for (let i = 0; i < 6; i++) {
    b.pyro.fire({
      id: `stomp-mine-${i}`,
      effect: mineFx[i % 2]!,
      position: i % 2 === 0 ? 'rack-3' : 'rack-6',
      land: m.hit('stomp', i),
    })
    b.fountains.jet({
      id: `stomp-fan-${i}`,
      effect: FX.fountFan,
      position: FOUNTS[i % 2]!,
      crest: m.hit('stomp', i),
      rgb: RGB.meadow,
      rgb2: RGB.white,
    })
  }
  b.drones.formation({
    id: 'wedding-ring',
    effect: FX.droneRing,
    position: PAD_MAIN,
    by: wedding,
    params: { count: 80, scaleM: 50, rgb: RGB.gold },
  })
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelFlag, position: panel, from: wedding })
  }
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserFan, position: tower, from: wedding, durBeats: 32 })
  }
  for (const idx of [0, 3] as const) {
    LIGHTS.forEach((bank, i) => {
      b.lights.chase({
        id: `wedding-chase-lights-${idx}-${i}`,
        effect: FX.lightChase,
        position: bank,
        land: m.hit('stomp', idx),
        periodBeats: 4,
        rgb: RGB.meadow,
      })
    })
  }
}

/** V — the moon spire, the crescent, the nymph shooters, beds, aurora. */
function moonlight(b: ShowBuilder, m: MusicRefs): void {
  const moon = m.annotation('accent', 0, 'moonlight')
  // The moon: both banks converge on one point over center stage; re-lit
  // right after its first hold so it hangs through the nymphs.
  b.lights.converge({
    effect: FX.lightSpire,
    positions: LIGHTS,
    at: SPIRE_POINT,
    land: moon,
    rgb: RGB.moon,
    idPrefix: 'moon-spire-1',
  })
  b.lights.converge({
    effect: FX.lightSpire,
    positions: LIGHTS,
    at: SPIRE_POINT,
    land: m.offset(m.hit('nymph', 1), 4),
    rgb: RGB.moon,
    idPrefix: 'moon-spire-2',
  })
  b.drones.formation({
    id: 'moon-crescent',
    effect: FX.droneCrescent,
    position: PAD_SIDE,
    by: moon,
    params: { count: 60, scaleM: 40, rgb: RGB.moon },
  })
  // ONE shooter per nymph chime, alternating banks — the 3.18 s lead visible.
  for (let i = 0; i < 3; i++) {
    b.fountains.jet({
      id: `nymph-shooter-${i}`,
      effect: FX.fountShooter,
      position: FOUNTS[i % 2]!,
      crest: m.hit('nymph', i),
      rgb: RGB.white,
      rgb2: RGB.moon,
    })
  }
  FOUNTS.forEach((bank, i) => {
    b.fountains.mist({ id: `moon-mist-${i}`, position: bank, from: moon, rgb: RGB.deep, rgb2: RGB.drift })
    b.fountains.mist({
      id: `moon-mist-late-${i}`,
      position: bank,
      from: m.offset(m.hit('nymph', 1), 4),
      rgb: RGB.deep,
      rgb2: RGB.drift,
    })
  })
  for (const mast of [MAST_W, MAST_E]) {
    b.crowd.flood({ id: `moon-dark-${mast}`, effect: FX.crowdBlackout, position: mast, from: moon })
  }
  for (let i = 0; i < 3; i++) {
    b.crowd.sparkle({
      id: `nymph-sparkle-${i}`,
      effect: FX.crowdSparkle,
      position: MAST_W,
      from: m.hit('nymph', i),
      densityFrac: 0.15,
      twinkleHz: 2,
      rgb: RGB.moon,
    })
  }
  b.beams.stereo({
    effect: FX.beamStereo,
    positions: [BEAM_DW, BEAM_DE],
    target: CELL.center,
    land: moon,
    pairId: 'nymph-bed-1',
    idPrefix: 'nymph-bed-1',
  })
  b.beams.stereo({
    effect: FX.beamStereo,
    positions: [BEAM_DW, BEAM_DE],
    target: CELL.delayEast,
    land: m.hit('nymph', 2),
    pairId: 'nymph-bed-2',
    idPrefix: 'nymph-bed-2',
  })
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserAurora, position: tower, from: moon, durBeats: 40 })
  }
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelAurora, position: panel, from: moon, rgb: RGB.indigo, rgb2: RGB.moon })
  }
}

/** VI — the rapids: reports, crossed beams, cascades, sweep-lines, barrage. */
function rapids(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  const rapidsStart = m.annotation('accent', 0, 'rapids')
  RAPIDS.forEach((r, i) => {
    const land = m.hit('rapid', i)
    const effect = quiet ? r.quiet : r.std
    if ('cell' in r) {
      fireWithThunder(b, { id: `rapid-${i}`, effect, position: r.rack, array: r.report, cell: r.cell, land })
    } else {
      b.pyro.fire({ id: `rapid-${i}`, effect, position: r.rack, land })
      b.beams.toll({ effect: FX.beamZonePulse, position: r.report, land, idPrefix: `rapid-pulse-${i}` })
    }
  })
  // Searchlights: violet cross, then a frantic chase, then a faster one.
  b.lights.mirror({
    effect: FX.lightCross,
    positions: LIGHTS,
    land: rapidsStart,
    spreadDeg: 40,
    idPrefix: 'rapids-cross',
  })
  LIGHTS.forEach((bank, i) => {
    b.lights.chase({
      id: `rapids-chase-a-${i}`,
      effect: FX.lightChase,
      position: bank,
      land: m.hit('rapid', 4),
      periodBeats: 2,
      rgb: RGB.rapids,
    })
    b.lights.chase({
      id: `rapids-chase-b-${i}`,
      effect: FX.lightChase,
      position: bank,
      land: m.hit('rapid', 6),
      periodBeats: 1,
      rgb: RGB.white,
    })
  })
  // Fountains: cascades running back and forth along both banks, the wave.
  ;([0, 2, 4, 6] as const).forEach((idx, i) => {
    b.fountains.mirror({
      effect: FX.fountCascade,
      positions: FOUNTS,
      crest: m.hit('rapid', idx),
      stepBeats: 0.25,
      outward: i % 2 === 0,
      rgb: RGB.rapids,
      rgb2: RGB.white,
      idPrefix: `rapids-cascade-${idx}`,
    })
  })
  b.fountains.mirror({
    effect: FX.fountWave,
    positions: FOUNTS,
    crest: m.phraseEnd(12),
    periodBeats: 2,
    rgb: RGB.deep,
    rgb2: RGB.rapids,
    idPrefix: 'rapids-wave',
  })
  // Sweep-lines roaring front → back on the rapids phrase ends.
  for (const idx of [12, 13] as const) {
    b.beams.flyover({
      effect: FX.beamSweepLine,
      position: BEAM_DW,
      path: CELL.dopplerPath,
      land: m.phraseEnd(idx),
      idPrefix: `rapids-roar-${idx}`,
    })
  }
  ;([0, 2, 4, 6] as const).forEach((idx, i) => {
    b.crowd.wave({
      effect: FX.crowdWave,
      position: i % 2 === 0 ? MAST_E : MAST_W,
      from: m.hit('rapid', idx),
      periodBeats: 2,
      dirDeg: i % 2 === 0 ? 90 : 270,
      rgb: RGB.rapids,
      idPrefix: `rapids-crowd-${idx}`,
    })
  })
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelLightning, position: panel, from: rapidsStart })
  }
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserSweep, position: tower, from: rapidsStart, durBeats: 24 })
    b.lasers.pattern({ effect: FX.laserWeb, position: tower, from: m.hit('rapid', 4), durBeats: 16 })
  }
  b.pyro.barrage({
    idPrefix: 'rapids-barrage',
    window: m.climaxRamp(20),
    effectPool: quiet ? BARRAGE_QUIET : BARRAGE_STD,
    positions: BARRAGE_RACKS,
    startRateHz: 0.5,
    endRateHz: quiet ? 2.5 : 4,
  })
}

/** VII — the climax: triple brocade, nine shooters per bank, pillars, bloom. */
function broadVltava(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  const climax = m.climax(0)
  CLIMAX_TRIPLE.forEach((s, i) => {
    fireWithThunder(b, {
      id: `broad-brocade-${i}`,
      effect: quiet ? FX.cometSilver : FX.brocadeGold,
      position: s.rack,
      array: s.array,
      cell: s.cell,
      land: climax,
    })
  })
  b.fountains.mirror({
    effect: FX.fountShooter,
    positions: FOUNTS,
    crest: climax,
    nozzles: 0,
    rgb: RGB.white,
    rgb2: RGB.meadow,
    idPrefix: 'broad-shooters',
  })
  b.lights.mirror({
    effect: FX.lightPillar,
    positions: LIGHTS,
    land: climax,
    rgb: RGB.white,
    idPrefix: 'broad-pillars',
  })
  b.lights.mirror({
    effect: FX.lightChase,
    positions: LIGHTS,
    land: m.phraseEnd(15),
    periodBeats: 3,
    rgb: RGB.meadow,
    idPrefix: 'broad-chase',
  })
  b.drones.formation({
    id: 'broad-bloom',
    effect: FX.droneBloom,
    position: PAD_MAIN,
    by: climax,
    params: { count: 140, scaleM: 55, rgb: RGB.gold },
  })
  for (const mast of [MAST_W, MAST_E]) {
    b.crowd.flood({
      id: `broad-flood-${mast}`,
      effect: FX.crowdFlood,
      position: mast,
      from: climax,
      rgb: RGB.gold,
      intensity: 1,
    })
  }
  b.crowd.haptic({ id: 'broad-haptic', effect: FX.crowdHaptic, position: MAST_E, land: climax })
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelWaveform, position: panel, from: climax, rgb: RGB.gold, rgb2: RGB.white })
  }
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserFan, position: tower, from: climax, durBeats: 24 })
  }
  // Peonies hang over the major statement's phrase end; plumes under them.
  b.pyro.volley({
    effects: quiet ? [FX.cometGold, FX.crossetteSilver] : [FX.peonyGold, FX.peonyWhite],
    positions: BARRAGE_RACKS,
    land: m.phraseEnd(15),
    staggerBeats: 0.5,
    idPrefix: 'broad-peonies',
  })
  b.fountains.mirror({
    effect: FX.fountPlume,
    positions: FOUNTS,
    crest: m.phraseEnd(15),
    rgb: RGB.meadow,
    rgb2: RGB.white,
    idPrefix: 'broad-plumes',
  })
  b.crowd.flood({
    id: 'broad-flood-white',
    effect: FX.crowdFlood,
    position: MAST_W,
    from: m.phraseEnd(15),
    rgb: RGB.white,
    intensity: 0.7,
  })
}

/** VIII — the castle: spire, willows with thunder, VLTAVA, the last wave. */
function vysehrad(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  const castle = m.annotation('accent', 0, 'vysehrad')
  const lastWave = m.hit('lastWave', 0)
  b.lights.converge({
    effect: FX.lightSpire,
    positions: LIGHTS,
    at: SPIRE_POINT,
    land: castle,
    rgb: RGB.meadow,
    idPrefix: 'castle-spire-1',
  })
  b.lights.converge({
    effect: FX.lightSpire,
    positions: LIGHTS,
    at: SPIRE_POINT,
    land: m.offset(castle, 16),
    rgb: RGB.meadow,
    idPrefix: 'castle-spire-2',
  })
  const willowFx = quiet ? ([FX.crossetteSilver, FX.cometGold] as const) : ([FX.willowGold, FX.willowGold] as const)
  fireWithThunder(b, {
    id: 'castle-willow-w',
    effect: willowFx[0],
    position: 'rack-3',
    array: BEAM_NW,
    cell: CELL.center,
    land: castle,
  })
  fireWithThunder(b, {
    id: 'castle-willow-e',
    effect: willowFx[1],
    position: 'rack-6',
    array: BEAM_NE,
    cell: CELL.eastMid,
    land: castle,
  })
  b.drones.formation({
    id: 'castle-text',
    effect: FX.droneText,
    position: PAD_MAIN,
    by: castle,
    holdSec: 24,
    params: { text: 'VLTAVA', count: 120, scaleM: 1.6, rgb: RGB.meadow },
  })
  b.crowd.text('VLTAVA', {
    effect: FX.crowdText,
    position: MAST_W,
    land: castle,
    rgb: RGB.meadow,
    idPrefix: 'castle-text-crowd',
  })
  b.crowd.sparkle({
    id: 'castle-sparkle',
    effect: FX.crowdSparkle,
    position: MAST_E,
    from: castle,
    densityFrac: 0.2,
    twinkleHz: 3,
    rgb: RGB.meadow,
  })
  for (const [k, land] of [
    [1, castle],
    [2, m.offset(castle, 16)],
  ] as const) {
    b.fountains.mirror({
      effect: FX.fountCascade,
      positions: FOUNTS,
      crest: land,
      stepBeats: 1,
      rgb: RGB.meadow,
      rgb2: RGB.white,
      idPrefix: `castle-cascade-${k}`,
    })
  }
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserAurora, position: tower, from: castle, durBeats: 32 })
  }
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelAurora, position: panel, from: castle, rgb: RGB.indigo, rgb2: RGB.meadow })
  }
  // The last wave: one plume, one bank of pillars, one bell, dark.
  b.fountains.jet({
    id: 'last-wave-plume',
    effect: FX.fountPlume,
    position: FOUNT_W,
    crest: lastWave,
    nozzles: 1,
    rgb: RGB.spring,
    rgb2: RGB.white,
  })
  b.lights.figure({
    id: 'last-pillar',
    effect: FX.lightPillar,
    position: LIGHTS_W,
    land: lastWave,
    rgb: RGB.moon,
  })
  b.beams.toll({ effect: FX.beamBell, position: BEAM_DW, land: lastWave, idPrefix: 'last-bell' })
  for (const mast of [MAST_W, MAST_E]) {
    b.crowd.flood({
      id: `lights-out-${mast}`,
      effect: FX.crowdBlackout,
      position: mast,
      from: m.offset(lastWave, 2),
    })
  }
}

// ---------------------------------------------------------------------------
// The show
// ---------------------------------------------------------------------------

function buildVltava(variant: 'standard' | 'quiet'): BuildResult {
  const quiet = variant === 'quiet'
  const tl = riverTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: quiet ? 'vltava-quiet' : 'vltava',
    title: quiet ? 'Vltava — The River (Quiet)' : 'Vltava — The River',
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant,
  })
    .music(tl)
    .preRoll(PRE_ROLL_SEC)
    .quantize('none')
  if (quiet) b.noiseBudget(85)
  programNotes(b, m, quiet)

  twoSprings(b, m)
  theRiver(b, m)
  forestHunt(b, m)
  peasantWedding(b, m, quiet)
  moonlight(b, m)
  rapids(b, m, quiet)
  broadVltava(b, m, quiet)
  vysehrad(b, m, quiet)

  // --- Quiet extras: the report you feel ------------------------------------
  // Wristband thumps stand in for every rapid report and the climax — the
  // rapids felt in the wrist, not the chest. Zone pulses already ride four of
  // the eight hits in both variants.
  if (quiet) {
    RAPIDS.forEach((_, i) => {
      b.crowd.haptic({
        id: `rapid-haptic-${i}`,
        effect: FX.crowdHaptic,
        position: i % 2 === 0 ? MAST_W : MAST_E,
        land: m.hit('rapid', i),
      })
    })
    b.crowd.haptic({ id: 'castle-haptic', effect: FX.crowdHaptic, position: MAST_W, land: m.annotation('accent', 0, 'vysehrad') })
  }

  return b.build()
}

/** Vltava — The River (standard). Throws if any diagnostic is an error. */
export function vltava(): BuildResult {
  return buildVltava('standard')
}

/**
 * The quiet variant: same timeline and structure, no effect above 100 dB at
 * the reference distance, and a summed 85 dB SPL budget at the audience
 * listeners. Fountain, searchlight, crowd, beam, and drone choreography are
 * unchanged — the water and the light were quiet all along.
 */
export function vltavaQuiet(): BuildResult {
  return buildVltava('quiet')
}
