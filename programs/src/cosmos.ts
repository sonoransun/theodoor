/**
 * programs/src/cosmos.ts — "Night of the Spheres", the space-night flagship
 * program, plus its quiet variant for noise-sensitive audiences.
 *
 * Music: THE SPHERES SUITE — the Zarathustra sunrise (~94 s) joined
 * bar-aligned to The Blue Danube (~80 s) and the Jupiter hymn (~85 s) via
 * concatScores; ≈ 4.3 minutes. Climaxes in suite order: daybreak 0.95,
 * waltzPeak 0.8, jovian 1.0 — climaxRamp resolves to jovian.
 *
 * THE THEME IS TIME-OF-FLIGHT ITSELF. The lawn sits ~190–260 m from the
 * firing line, so a shell's report trails its flash by ≈ 0.55–0.75 s.
 * Act 1 lets the audience HEAR that lag — one lone comet, no help ("old
 * physics"). Then the show repairs physics: from the third sunrise onward
 * every featured burst is paired with a beam tag (sourceCueId on the shell)
 * whose audio is fired early by exactly slant-distance / 343 m·s⁻¹, so the
 * report lands WITH the light — thunder with flash.
 *
 *   ACT 1 — SUNRISE (zarathustraSunrise, 0–94 s)
 *     phone-starfield opening (the 1.2 s phone latency RAINS the stars in —
 *     honest physics as spectacle), panel/laser starfields, mission-control
 *     whispers roving the front corners from the south arrays. Sunrise 1:
 *     one gold comet, report arriving late. Sunrise 2: a slow dawn wave
 *     west→east across the wristbands. Sunrise 3 + daybreak: white peonies
 *     WITH their thunder + a wristband haptic on the beat — physics repaired.
 *     Timpani pulses ripple gravity waves from the center cell.
 *
 *   ACT 2 — ORBIT (blueDanube, 94–174 s)
 *     liftoff: pad-1 rises into a spiral galaxy while the lancework frame
 *     ignites as the launch gantry; the galaxy morphs into a 60 s planetary
 *     orrery. Pad-2 flies a comet streak chased by its own beam tag plus a
 *     front→back doppler flyover. Crowd waves in 3/4; silver crossettes on
 *     the twirl echoes, answered two beats later by wristband sparkle.
 *     Waltz phrase-end shells — every one thunder-tagged, north arrays
 *     alternating for slew. waltzPeak: green helixes + waveform panels.
 *
 *   ACT 3 — JUPITER (jupiterHymn, 174–260 s)
 *     thaxted: a JUPITER wristband ticker scrolls (7 glyphs on the 38-col
 *     canvas) under aurora curtains while the countermelody sings from the
 *     orrery — crossed stereo beds on the delay towers, retargeted between
 *     statements so no cell dwells. Second statement: gold flood, tagged
 *     willows, wheel spinners on racks 2/7. JOVIAN: a 25 s climax-ramp
 *     barrage into a triple ice-brocade burst — each of the three tagged
 *     from its own array — wristbands strobing white. perihelion: pad-2
 *     spells IO (the moon joke); afterglow sweeps, a farewell whisper walks
 *     the front row cell to cell, and the canvas goes dark.
 *
 * cosmosQuiet(): identical skeleton, variant 'quiet', 85 dB noise budget,
 * shells swapped to the low-noise pool. The thunder-with-flash trick becomes
 * the ONLY "boom" of the night: beam zone pulses and wristband haptics stand
 * in for every report — fireworks you feel in your wrist, not your chest.
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
  blueDanube,
  buildTimelineFromScore,
  concatScores,
  jupiterHymn,
  lakesidePark,
  musicRefs,
  showBuilder,
  starterCatalog,
  zarathustraSunrise,
} from '@theodoor/core'
import { RGB } from './palettes.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED = 19680101
const PRE_ROLL_SEC = 8

/** lakesidePark asset ids. */
const PAD_MAIN = 'pad-1'
const PAD_COMET = 'pad-2'
const LASERS = ['laser-west', 'laser-east'] as const
const PANELS = ['panel-west', 'panel-east'] as const
const MAST_W = 'mast-west'
const MAST_E = 'mast-east'
/** Long-throw arrays on the 25 m masts — the thunder-with-flash pair. */
const BEAM_NW = 'beam-north-west'
const BEAM_NE = 'beam-north-east'
/** Whole-zone delay towers — stereo beds, flyovers, quiet zone pulses. */
const BEAM_DW = 'beam-delay-west'
const BEAM_DE = 'beam-delay-east'
/** Near-field corner arrays — front-corner whispers only. */
const BEAM_SW = 'beam-south-west'
const BEAM_SE = 'beam-south-east'

/** Starter-catalog effect ids (see packages/core/src/catalog/starter). */
const FX = {
  cometGold: 'comet-30-gold',
  cometSilver: 'comet-30-silver',
  mineGreen: 'mine-50-green',
  mineSilver: 'mine-50-silver',
  crossetteSilver: 'crossette-75-silver',
  peonyWhite: 'peony-100-white',
  peonyBlue: 'peony-75-blue',
  peonyGreen: 'peony-75-green',
  peonyViolet: 'peony-100-violet',
  chrysSilver: 'chrysanthemum-150-silver',
  willowStrobe: 'willow-150-strobe',
  brocadeIce: 'brocade-200-ice',
  droneSpiral: 'spiral-formation-120',
  droneOrrery: 'orrery-formation-140',
  droneComet: 'cometTail-formation-90',
  droneBloom: 'bloom-formation-120',
  droneText: 'text-formation-150',
  laserStarfield: 'laser-starfield-white',
  laserHelix: 'laser-helix-green',
  laserAurora: 'laser-aurora-curtain',
  laserSweep: 'laser-sweep-gold',
  panelStarfield: 'panel-starfield',
  panelWaveform: 'panel-waveform-bars',
  panelAurora: 'panel-aurora',
  panelStrobe: 'panel-strobe',
  fabGantry: 'lancework-frame-10m',
  fabWheel: 'wheel-spinner-4m',
  crowdStarfield: 'crowd-starfield-phone',
  crowdFlood: 'crowd-flood-rgb',
  crowdBlackout: 'crowd-blackout',
  crowdWave: 'crowd-wave-lateral',
  crowdPulse: 'crowd-pulse-radial',
  crowdSparkle: 'crowd-sparkle-gold',
  crowdText: 'crowd-text-marquee',
  crowdHaptic: 'crowd-haptic-thump',
  beamWhisper: 'beam-whisper-narration',
  beamTag: 'beam-tag-drone',
  beamFlyover: 'beam-flyover-whoosh',
  beamStereo: 'beam-stereo-bed',
  beamZonePulse: 'beam-zone-pulse',
} as const

/**
 * Crowd-grid cell indices (38 cols × 9 rows, index = row·38 + col, 8 m
 * cells; row 8 is the FRONT of the lawn at y = −192, row 0 the back at
 * y = −256). Geometry that keeps every aim feasible:
 * - the row-4 mid-lawn band (y = −224) is reachable from the north masts
 *   (≤ ~267 m throw) and the delay towers (≤ ~165 m), and its tag carrier
 *   sits ~24 dB under the exposure dwell threshold;
 * - front-corner row-7 cells (y = −200) sit 18–26 m from the south arrays —
 *   inside their ~73 m horizon and outside their 5 m focus floor.
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

/**
 * Waltz phrase-end shells (Danube suite phraseEnd indices 0..6). Index 3
 * (bar 37) is deliberately absent: the comet crossing IS that arrival.
 * Tag arrays alternate so consecutive tags on one array sit 20 s apart
 * (12 s program + ~7 s idle ≫ the ~0.5 s cross-lawn slew).
 */
const WALTZ_VOLLEYS = [
  { phrase: 0, rack: 'rack-2', effectIdx: 0, array: BEAM_NW, cell: CELL.center },
  { phrase: 1, rack: 'rack-7', effectIdx: 1, array: BEAM_NE, cell: CELL.eastMid },
  { phrase: 2, rack: 'rack-3', effectIdx: 0, array: BEAM_NW, cell: CELL.westMid },
  { phrase: 4, rack: 'rack-6', effectIdx: 1, array: BEAM_NW, cell: CELL.center },
  { phrase: 5, rack: 'rack-4', effectIdx: 0, array: BEAM_NE, cell: CELL.eastMid },
  { phrase: 6, rack: 'rack-5', effectIdx: 1, array: BEAM_NW, cell: CELL.westMid },
] as const

/** Act-1 mission-control whispers: array / front-corner cell / 4/4 bar. */
const MISSION_WHISPERS = [
  { array: BEAM_SW, cell: CELL.frontWest[0], bar: 1 },
  { array: BEAM_SE, cell: CELL.frontEast[0], bar: 4 },
  { array: BEAM_SW, cell: CELL.frontWest[2], bar: 7 },
  { array: BEAM_SE, cell: CELL.frontEast[1], bar: 10 },
] as const

/** Jovian triple: three ice brocades, each with its own thunder array. */
const JOVIAN_TRIPLE = [
  { rack: 'rack-2', array: BEAM_NW, cell: CELL.westMid },
  { rack: 'rack-5', array: BEAM_DW, cell: CELL.delayWest },
  { rack: 'rack-7', array: BEAM_DE, cell: CELL.delayEast },
] as const

/** Jovian barrage pools, ramped small → large by the builder. */
const BARRAGE_STD = [
  FX.peonyGreen,
  FX.peonyBlue,
  FX.peonyViolet,
  FX.peonyWhite,
  FX.chrysSilver,
  FX.brocadeIce,
] as const
const BARRAGE_QUIET = [
  FX.cometGold,
  FX.cometSilver,
  FX.mineGreen,
  FX.mineSilver,
  FX.crossetteSilver,
] as const
const BARRAGE_RACKS = ['rack-3', 'rack-4', 'rack-5', 'rack-6'] as const

/** Quiet variant: zone-pulse arrays / haptic masts per waltz phrase end. */
const QUIET_REPORT_ARRAY: Readonly<Record<number, string>> = {
  0: BEAM_DE,
  1: BEAM_DW,
  2: BEAM_DE,
  4: BEAM_DW,
  5: BEAM_DE,
  6: BEAM_DW,
}
const QUIET_REPORT_MAST: Readonly<Record<number, string>> = {
  0: MAST_E,
  1: MAST_W,
  2: MAST_E,
  4: MAST_W,
  5: MAST_E,
  6: MAST_W,
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Fresh suite timeline: Zarathustra sunrise → Blue Danube → Jupiter hymn. */
function suiteTimeline(): MusicalTimeline {
  return buildTimelineFromScore(
    concatScores(
      concatScores(zarathustraSunrise, blueDanube, {
        id: 'cosmos-suite-open',
        title: 'Night of the Spheres (I–II)',
      }),
      jupiterHymn,
      { id: 'cosmos-suite', title: 'Night of the Spheres Suite' },
    ),
  )
}

// ---------------------------------------------------------------------------
// Thunder-with-flash helper
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
// Shared sections (identical in both variants — every effect here is quiet)
// ---------------------------------------------------------------------------

/** Phone starfield raining in from t = −4 s + panel/laser starfields. */
function openingSky(b: ShowBuilder, m: MusicRefs): void {
  // Four chained 20 s starfield broadcasts cover the whole first act; the
  // phone channel's 1.2 s p95 latency is the spectacle — stars trickle in.
  for (let i = 0; i < 4; i++) {
    b.crowd.sparkle({
      id: `starfield-${i}`,
      effect: FX.crowdStarfield,
      position: MAST_W,
      from: m.time(-4 + 18 * i),
      densityFrac: 0.25,
      twinkleHz: 2,
    })
  }
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelStarfield, position: panel, from: m.time(-4) })
  }
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelStarfield, position: panel, from: m.time(30) })
  }
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserStarfield, position: tower, from: m.time(-2), durBeats: 32 })
  }
  for (const tower of LASERS) {
    b.lasers.pattern({
      effect: FX.laserStarfield,
      position: tower,
      from: m.hit('pulse', 1),
      durBeats: 24,
    })
  }
}

/** Mission-control whispers roving the front corners under the organ pedal. */
function missionControl(b: ShowBuilder, m: MusicRefs): void {
  MISSION_WHISPERS.forEach((w, i) => {
    b.beams.whisper({
      effect: FX.beamWhisper,
      position: w.array,
      target: w.cell,
      land: m.barBeat(w.bar, 1),
      gainDb: -2,
      idPrefix: `mission-${i}`,
    })
  })
}

/** Timpani strokes ripple gravity waves outward from the center cell. */
function gravityPulses(b: ShowBuilder, m: MusicRefs): void {
  for (let i = 0; i < 4; i++) {
    b.crowd.pulse({
      effect: FX.crowdPulse,
      position: MAST_E,
      land: m.hit('pulse', i),
      originCell: CELL.center,
      periodBeats: 2,
      rgb: RGB.starlight,
      idPrefix: `gravity-${i}`,
    })
  }
}

/** Liftoff gantry + spiral galaxy morphing into the 60 s planetary orrery. */
function liftoffAndOrrery(b: ShowBuilder, m: MusicRefs): void {
  const liftoff = m.annotation('accent', 0, 'liftoff')
  b.drones.formation({
    id: 'galaxy-spiral',
    effect: FX.droneSpiral,
    position: PAD_MAIN,
    by: liftoff,
    params: { count: 120, scaleM: 60, rgb: RGB.drift },
  })
  b.fabrication.cue({
    id: 'launch-gantry',
    effectId: FX.fabGantry,
    anchor: liftoff,
    positionId: 'rack-4',
  })
  // 12 beats (5 s) past the bar-21 phrase boundary buys the 120→140 morph
  // its flight window after the 14 s spiral; the 60 s face then spans the
  // rest of the waltz, the waltzPeak, and the thaxted entrance.
  b.drones.formation({
    id: 'orrery',
    effect: FX.droneOrrery,
    position: PAD_MAIN,
    by: m.offset(m.phraseEnd(1), 12),
    // scaleM 58 keeps the 29 m bounding radius inside the geofence's south
    // edge (pad-1 sits 30 m north of it).
    params: { count: 140, scaleM: 58, rgb: RGB.starlight },
  })
}

/** Pad-2 comet streak, its chasing beam tag, and the doppler flyover. */
function cometCrossing(b: ShowBuilder, m: MusicRefs): void {
  const crossing = m.annotation('accent', 2, 'orbit')
  b.drones.formation({
    id: 'comet-crossing',
    effect: FX.droneComet,
    position: PAD_COMET,
    by: crossing,
    params: { count: 60, scaleM: 50, rgb: RGB.gold },
  })
  b.beams.tag({
    effect: FX.beamTag,
    position: BEAM_NE,
    source: 'comet-crossing',
    fallbackTarget: CELL.center,
    land: crossing,
    idPrefix: 'thunder-comet-crossing',
  })
  b.beams.flyover({
    effect: FX.beamFlyover,
    position: BEAM_DW,
    path: CELL.dopplerPath,
    land: m.offset(crossing, 3),
    idPrefix: 'doppler',
  })
}

/** Crowd orbit waves in 3/4 + twirl crossettes echoed by wristband sparkle. */
function orbitCrowd(b: ShowBuilder, m: MusicRefs): void {
  ;([0, 1, 3] as const).forEach((idx, i) => {
    b.crowd.wave({
      effect: FX.crowdWave,
      position: i % 2 === 0 ? MAST_W : MAST_E,
      from: m.annotation('accent', idx, 'orbit'),
      periodBeats: 3,
      dirDeg: i % 2 === 0 ? 90 : 270,
      rgb: RGB.drift,
      idPrefix: `orbit-wave-${idx}`,
    })
  })
  for (let i = 0; i < 8; i++) {
    b.pyro.fire({
      id: `twirl-${i}`,
      effect: FX.crossetteSilver,
      position: i % 2 === 0 ? 'rack-1' : 'rack-8',
      land: m.hit('twirl', i),
    })
  }
  // One sparkle per echo pair, two beats after its second twirl, masts
  // ping-ponged so no mast carries two 15 Hz sparkles at once.
  ;([1, 3, 5, 7] as const).forEach((idx, i) => {
    b.crowd.sparkle({
      id: `twirl-echo-${idx}`,
      effect: FX.crowdSparkle,
      position: i % 2 === 0 ? MAST_W : MAST_E,
      from: m.offset(m.hit('twirl', idx), 2),
      densityFrac: 0.35,
      twinkleHz: 6,
      rgb: RGB.silver,
    })
  })
}

/** waltzPeak: green helixes climbing both towers + waveform panel bars. */
function waltzPeakScenery(b: ShowBuilder, m: MusicRefs): void {
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserHelix, position: tower, from: m.climax(1), durBeats: 24 })
  }
  for (const panel of PANELS) {
    b.panels.pattern({
      effect: FX.panelWaveform,
      position: panel,
      from: m.climax(1),
      rgb: RGB.drift,
      rgb2: RGB.silver,
    })
  }
}

/** thaxted: JUPITER ticker, nebula starlight, aurora, orrery stereo beds. */
function jupiterEntrance(b: ShowBuilder, m: MusicRefs): void {
  const thaxted = m.annotation('accent', 0, 'thaxted')
  b.crowd.text('JUPITER', {
    effect: FX.crowdText,
    position: MAST_W,
    land: thaxted,
    rgb: RGB.starlight,
    idPrefix: 'jupiter-ticker-1',
  })
  b.crowd.text('JUPITER', {
    effect: FX.crowdText,
    position: MAST_W,
    land: m.phraseEnd(10),
    rgb: RGB.starlight,
    idPrefix: 'jupiter-ticker-2',
  })
  b.crowd.sparkle({
    id: 'nebula-starlight',
    effect: FX.crowdSparkle,
    position: MAST_E,
    from: thaxted,
    densityFrac: 0.2,
    twinkleHz: 3,
    rgb: RGB.starlight,
  })
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserAurora, position: tower, from: thaxted, durBeats: 48 })
  }
  for (const panel of PANELS) {
    b.panels.pattern({
      effect: FX.panelAurora,
      position: panel,
      from: thaxted,
      rgb: RGB.nebula,
      rgb2: RGB.violet,
    })
  }
  // The countermelody sings from the orrery: crossed 16 s beds from the
  // delay towers, converging mid-lawn, retargeted between hymn statements
  // (fresh cell per statement — nothing dwells).
  b.beams.stereo({
    effect: FX.beamStereo,
    positions: [BEAM_DW, BEAM_DE],
    target: CELL.center,
    land: m.phraseEnd(8),
    pairId: 'orrery-bed-1',
    idPrefix: 'bed-1',
  })
  b.beams.stereo({
    effect: FX.beamStereo,
    positions: [BEAM_DW, BEAM_DE],
    target: CELL.delayEast,
    land: m.phraseEnd(9),
    pairId: 'orrery-bed-2',
    idPrefix: 'bed-2',
  })
}

/** Second statement scenery: gold flood + wheel spinners on racks 2/7. */
function secondStatement(b: ShowBuilder, m: MusicRefs): void {
  b.crowd.flood({
    id: 'thaxted-gold',
    effect: FX.crowdFlood,
    position: MAST_E,
    from: m.phraseEnd(9),
    rgb: RGB.gold,
    intensity: 0.8,
  })
  b.fabrication.cue({
    id: 'wheel-west',
    effectId: FX.fabWheel,
    anchor: m.phraseEnd(9),
    positionId: 'rack-2',
  })
  b.fabrication.cue({
    id: 'wheel-east',
    effectId: FX.fabWheel,
    anchor: m.phraseEnd(9),
    positionId: 'rack-7',
  })
}

/** Jovian climax crowd: white wristband strobes + haptic + panel strobes. */
function jovianCrowd(b: ShowBuilder, m: MusicRefs): void {
  const jovian = m.climax(2)
  b.crowd.flood({
    id: 'jovian-strobe-west',
    effect: FX.crowdFlood,
    position: MAST_W,
    from: jovian,
    rgb: RGB.white,
    intensity: 1,
  })
  b.crowd.flood({
    id: 'jovian-strobe-east',
    effect: FX.crowdFlood,
    position: MAST_E,
    from: jovian,
    rgb: RGB.white,
    intensity: 1,
  })
  b.crowd.haptic({ id: 'jovian-haptic', effect: FX.crowdHaptic, position: MAST_E, land: jovian })
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelStrobe, position: panel, from: jovian, rgb: RGB.white })
  }
}

/** perihelion + afterglow: IO drones, gold sweeps, farewell whisper walk. */
function afterglow(b: ShowBuilder, m: MusicRefs): void {
  const perihelion = m.hit('perihelion', 0)
  b.drones.formation({
    id: 'io-moons',
    effect: FX.droneText,
    position: PAD_COMET,
    by: perihelion,
    holdSec: 4,
    params: { text: 'IO', count: 60, scaleM: 3, rgb: RGB.moon },
  })
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserSweep, position: tower, from: perihelion, durBeats: 12 })
  }
  // The farewell whisper walks the front row outward toward the west corner
  // — a whisper program on a cell path sweeps piecewise-linearly.
  b.beams.flyover({
    effect: FX.beamWhisper,
    position: BEAM_SW,
    path: [...CELL.frontWest].reverse(),
    land: m.offset(perihelion, 2),
    gainDb: -4,
    idPrefix: 'farewell',
  })
  b.crowd.flood({
    id: 'lights-out-west',
    effect: FX.crowdBlackout,
    position: MAST_W,
    from: m.offset(perihelion, 5),
  })
  b.crowd.flood({
    id: 'lights-out-east',
    effect: FX.crowdBlackout,
    position: MAST_E,
    from: m.offset(perihelion, 5),
  })
}

// ---------------------------------------------------------------------------
// The show
// ---------------------------------------------------------------------------

function buildCosmos(variant: 'standard' | 'quiet'): BuildResult {
  const quiet = variant === 'quiet'
  const tl = suiteTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: quiet ? 'cosmos-quiet' : 'cosmos',
    title: quiet ? 'Night of the Spheres (Quiet)' : 'Night of the Spheres',
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant,
  })
    .music(tl)
    .preRoll(PRE_ROLL_SEC)
    .quantize('none')
  if (quiet) b.noiseBudget(85)

  // --- ACT 1: SUNRISE --------------------------------------------------------
  openingSky(b, m)
  missionControl(b, m)
  gravityPulses(b, m)

  // Sunrise 1 — old physics: one lone comet, its report ~0.55 s late.
  b.pyro.fire({
    id: 'sunrise-lag-comet',
    effect: FX.cometGold,
    position: 'rack-8',
    land: m.hit('sunrise', 0),
  })

  // Sunrise 2 — dawn gradient rolling west→east across the wristbands.
  b.crowd.wave({
    effect: FX.crowdWave,
    position: MAST_E,
    from: m.hit('sunrise', 1),
    periodBeats: 8,
    dirDeg: 90,
    rgb: RGB.starlight,
    idPrefix: 'dawn-wave',
  })

  // Sunrise 3 — the SAME comet from the SAME rack, physics repaired: its
  // report rides a beam tag and lands with the flash.
  fireWithThunder(b, {
    id: 'sunrise-repaired-comet',
    effect: FX.cometGold,
    position: 'rack-8',
    array: BEAM_NW,
    cell: CELL.center,
    land: m.hit('sunrise', 2),
  })

  // Daybreak (climax 0, damped 0.95): white peony pair with thunder from
  // both north masts + a wristband haptic + the dawn flood.
  const daybreak = m.climax(0)
  const daybreakFx = quiet
    ? ([FX.mineSilver, FX.crossetteSilver] as const)
    : ([FX.peonyWhite, FX.peonyWhite] as const)
  fireWithThunder(b, {
    id: 'daybreak-a',
    effect: daybreakFx[0],
    position: 'rack-4',
    array: BEAM_NW,
    cell: CELL.westMid,
    land: daybreak,
  })
  fireWithThunder(b, {
    id: 'daybreak-b',
    effect: daybreakFx[1],
    position: 'rack-5',
    array: BEAM_NE,
    cell: CELL.eastMid,
    land: daybreak,
  })
  b.crowd.haptic({
    id: 'daybreak-haptic',
    effect: FX.crowdHaptic,
    position: MAST_W,
    land: daybreak,
  })
  b.crowd.flood({
    id: 'daybreak-flood',
    effect: FX.crowdFlood,
    position: MAST_W,
    from: daybreak,
    rgb: RGB.drift,
    rgb2: RGB.starlight,
    intensity: 0.9,
  })

  // --- ACT 2: ORBIT ----------------------------------------------------------
  liftoffAndOrrery(b, m)
  cometCrossing(b, m)
  orbitCrowd(b, m)

  // Waltz phrase-end shells — every burst thunder-tagged.
  const waltzFx = quiet
    ? ([FX.mineGreen, FX.crossetteSilver] as const)
    : ([FX.peonyBlue, FX.chrysSilver] as const)
  for (const v of WALTZ_VOLLEYS) {
    fireWithThunder(b, {
      id: `waltz-shell-${v.phrase}`,
      effect: waltzFx[v.effectIdx],
      position: v.rack,
      array: v.array,
      cell: v.cell,
      land: m.phraseEnd(v.phrase),
    })
  }

  waltzPeakScenery(b, m)

  // --- ACT 3: JUPITER --------------------------------------------------------
  jupiterEntrance(b, m)
  secondStatement(b, m)

  // Tagged willows hang over the second statement's phrase ends.
  const willowFx = quiet
    ? ([FX.crossetteSilver, FX.cometGold] as const)
    : ([FX.willowStrobe, FX.willowStrobe] as const)
  fireWithThunder(b, {
    id: 'hymn-willow-9',
    effect: willowFx[0],
    position: 'rack-3',
    array: BEAM_NW,
    cell: CELL.center,
    land: m.phraseEnd(9),
  })
  fireWithThunder(b, {
    id: 'hymn-willow-10',
    effect: willowFx[1],
    position: 'rack-6',
    array: BEAM_NE,
    cell: CELL.eastMid,
    land: m.phraseEnd(10),
  })

  // JOVIAN: 25 s climax-ramp barrage (climaxRamp resolves to the strength-1
  // jovian) ending in the triple ice burst — each tagged from its own array.
  b.pyro.barrage({
    idPrefix: 'jovian-barrage',
    window: m.climaxRamp(25),
    effectPool: quiet ? BARRAGE_QUIET : BARRAGE_STD,
    positions: BARRAGE_RACKS,
    startRateHz: 0.5,
    endRateHz: quiet ? 2.5 : 6,
  })
  const jovian = m.climax(2)
  JOVIAN_TRIPLE.forEach((s, i) => {
    fireWithThunder(b, {
      id: `jovian-ice-${i}`,
      effect: quiet ? FX.cometSilver : FX.brocadeIce,
      position: s.rack,
      array: s.array,
      cell: s.cell,
      land: jovian,
    })
  })
  // Galaxy blooms gold over the summit (pad-1's last morph).
  b.drones.formation({
    id: 'jovian-bloom',
    effect: FX.droneBloom,
    position: PAD_MAIN,
    by: jovian,
    params: { count: 140, scaleM: 55, rgb: RGB.gold },
  })
  jovianCrowd(b, m)

  afterglow(b, m)

  // --- Quiet extras: the boom you FEEL --------------------------------------
  // Zone pulses (whole-lawn thumps from the delay towers) + wristband
  // haptics stand in for every act-1/act-2 report — fireworks you feel in
  // your wrist, not your chest.
  if (quiet) {
    b.beams.toll({
      effect: FX.beamZonePulse,
      position: BEAM_DW,
      land: daybreak,
      idPrefix: 'zone-pulse-daybreak',
    })
    for (const v of WALTZ_VOLLEYS) {
      b.beams.toll({
        effect: FX.beamZonePulse,
        position: QUIET_REPORT_ARRAY[v.phrase]!,
        land: m.phraseEnd(v.phrase),
        idPrefix: `zone-pulse-${v.phrase}`,
      })
      b.crowd.haptic({
        id: `report-haptic-${v.phrase}`,
        effect: FX.crowdHaptic,
        position: QUIET_REPORT_MAST[v.phrase]!,
        land: m.phraseEnd(v.phrase),
      })
    }
  }

  return b.build()
}

/** Night of the Spheres (standard). Throws if any diagnostic is an error. */
export function cosmos(): BuildResult {
  return buildCosmos('standard')
}

/**
 * The quiet variant: same timeline and structure, no effect above 100 dB at
 * the reference distance, and a summed 85 dB SPL budget at the audience
 * listeners. Crowd, beam, and drone choreography are unchanged.
 */
export function cosmosQuiet(): BuildResult {
  return buildCosmos('quiet')
}
