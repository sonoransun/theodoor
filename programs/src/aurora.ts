/**
 * programs/src/aurora.ts — "Midsummer Aurora", the quiet-first flagship: the
 * crowd IS the display, and the sky only joins once the crowd has already
 * painted the aurora on itself.
 *
 * Music: THE MIDSUMMER SUITE — Satie's Gymnopédie No. 1 (~87 s), Debussy's
 * Clair de Lune (~110 s) and the Moonlight Sonata Adagio (~72 s) joined
 * bar-aligned via concatScores; ~4.5 minutes total. The suite's single
 * strength-1 climax is Clair de Lune's 'zenith' (climax index 1).
 *
 * Structure (both variants are the SAME show — see the design principle):
 *   ACT 1 — FIRST LIGHT (gymnopedie1; crowd + beams ONLY, zero sky media)
 *     - a single mid-lawn cell breathes teal on 'firstStar', with a whisper
 *       lullaby visiting that cell region from a delay tower
 *     - the aurora is born: slow teal/blue/violet wavefronts roll the rows
 *       for the whole act (mast-west)
 *     - each 'breath' hit inhales: a dim whole-lawn flood (mast-east)
 *     - a whisper duet leapfrogs the front corners in canon (south arrays)
 *     - curtain folds through the 'lift': column-band chase (mast-east)
 *   ACT 2 — MOONRISE (clairDeLune; the sky finally mirrors the crowd)
 *     - 'moonrise': crescent moon rises from pad-2 while lancework glows on
 *       rack-4 as its earthly reflection; aurora curtains from both laser
 *       towers; aurora ribbons on both panels
 *     - 'shimmer' ×8: single silver whisper comets alternating racks 3/6
 *     - the moon HUMS: a crossed stereo bed from the delay towers plus a
 *       source tag from the north-west array following the crescent
 *     - ZENITH (the strength-1 climax): silver waterfall curtains across the
 *       center racks + maximum crowd sparkle + bright panel aurora — the
 *       loudest the night ever gets (98 dB at 15 m ≈ 76 dB at the lawn)
 *     - post-zenith: the crescent melts into a heart, held 20 s
 *   ACT 3 — SLEEP (moonlightAdagio; the sky retires)
 *     - deep indigo floods; pad-2's 60 drones scatter low as fireflies
 *     - 'heartbeat' ×7: radial pulses contracting toward the birth cell,
 *       dimmer each bar
 *     - goodnight whispers walk the rows back-to-front (delay towers)
 *     - 'lastLight': the birth cell blinks once — then nothing. Silence is
 *       the ending: no cue lands after 'lastLight'.
 *
 * THE DESIGN PRINCIPLE: the standard build is ALREADY quiet-native — no
 * entry above 100 dB at 15 m anywhere (loudest: waterfall-30m at 98) —
 * so auroraQuiet() is the IDENTICAL cue list plus .noiseBudget(85),
 * enforcement only, zero substitutions.
 *
 * Determinism: pure functions of constants only — no Date.now, no
 * Math.random, no module-level caches; every call builds a fresh show.
 */

import type { BuildResult, MusicalTimeline, MusicRefs, ShowBuilder } from '@theodoor/core'
import {
  buildTimelineFromScore,
  clairDeLune,
  concatScores,
  gymnopedie1,
  lakesidePark,
  moonlightAdagio,
  musicRefs,
  showBuilder,
  starterCatalog,
} from '@theodoor/core'
import { RGB } from './palettes.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED = 62166
const PRE_ROLL_SEC = 6

/** lakesidePark asset ids. */
const PAD_2 = 'pad-2'
const COMET_RACKS = ['rack-3', 'rack-6'] as const
/** Center racks carrying the zenith waterfall curtain. */
const WATERFALL_RACKS = ['rack-4', 'rack-5'] as const
const LANCEWORK_RACK = 'rack-4'
const LASERS = ['laser-west', 'laser-east'] as const
const PANELS = ['panel-west', 'panel-east'] as const
const MAST_W = 'mast-west'
const MAST_E = 'mast-east'
const DELAY = ['beam-delay-west', 'beam-delay-east'] as const
const SOUTH = ['beam-south-west', 'beam-south-east'] as const
const NORTH_W = 'beam-north-west'

/** Starter-catalog effect ids (see packages/core/src/catalog/starter). */
const FX = {
  crescent: 'crescent-formation-60',
  heart: 'heart-formation-80',
  scatter: 'scatter-formation-100',
  cometSilver: 'comet-30-silver',
  waterfall: 'waterfall-30m',
  lanceworkMoon: 'lancework-moon-6m',
  laserAurora: 'laser-aurora-curtain',
  panelAurora: 'panel-aurora',
  crowdFlood: 'crowd-flood-rgb',
  crowdWave: 'crowd-wave-lateral',
  crowdPulse: 'crowd-pulse-radial',
  crowdChase: 'crowd-chase-sections',
  crowdSparkle: 'crowd-sparkle-gold',
  crowdHeartbeat: 'crowd-heartbeat-red',
  beamWhisper: 'beam-whisper-narration',
  beamStereo: 'beam-stereo-bed',
  beamTag: 'beam-tag-drone',
} as const

/** Crowd grid geometry (38 cols × 9 rows on lakesidePark; index = row·38+col). */
const GRID_COLS = 38
const cellAt = (row: number, col: number): number => row * GRID_COLS + col

/** The cell the aurora is born in (and dies in): mid-lawn, row 4, col 19. */
const BIRTH_CELL = cellAt(4, 19)
/**
 * Front-corner whisper cells: row 7 sits ~18–21 m from the south arrays —
 * far enough to clear the carrier-exposure dwell band, near enough for the
 * 8 m corner masts to hold a bounded footprint.
 */
const DUET_CELLS = [cellAt(7, 1), cellAt(7, 36), cellAt(7, 2), cellAt(7, 35)] as const
/** Goodnight targets: the center cell of each row, back (row 0) to front (row 8). */
const ROW_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((row) => cellAt(row, 19))

/** Aurora device colors (0..1 tuples; hex twins live in palettes.AURORA). */
const AURORA_RGB = [
  [0.25, 0.84, 0.55], // teal
  [0.23, 0.65, 0.85], // sky blue
  [0.56, 0.44, 0.85], // violet
] as const
const ROSE: readonly number[] = [0.92, 0.5, 0.62]

/** Act-1 wave cadence: one wavefront every 12 beats (the 10 s pattern + a breath). */
const WAVE_COUNT = 8
const WAVE_STEP_BEATS = 12
/** Whisper-duet cadence: 15 beats ≈ 13.6 s (the 12 s program + slew headroom). */
const DUET_STEP_BEATS = 15
/** Goodnight cadence: 18 adagio beats = 6.75 s (arrays alternate, 13.5 s per array). */
const GOODNIGHT_STEP_BEATS = 18
const BREATH_COUNT = 6
const SHIMMER_COUNT = 8
/** Contracting pulses ride heartbeats 0..6; heartbeat 7 IS 'lastLight'. */
const PULSE_COUNT = 7

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Fresh suite timeline: Gymnopédie No. 1 → Clair de Lune → Moonlight Adagio. */
function suiteTimeline(): MusicalTimeline {
  return buildTimelineFromScore(
    concatScores(concatScores(gymnopedie1, clairDeLune), moonlightAdagio, {
      id: 'aurora-suite',
      title: 'Midsummer Aurora Suite',
    }),
  )
}

// ---------------------------------------------------------------------------
// Acts (shared verbatim by both variants — every effect here is ≤ 100 dB)
// ---------------------------------------------------------------------------

/** ACT 1 — FIRST LIGHT: crowd + beams only, zero sky media. */
function actOneFirstLight(b: ShowBuilder, m: MusicRefs): void {
  const firstStar = m.annotation('accent', 0, 'firstStar')

  // A single cell breathes teal — the aurora's birth.
  b.crowd.heartbeat({
    effect: FX.crowdHeartbeat,
    position: MAST_W,
    land: firstStar,
    originCell: BIRTH_CELL,
    rgb: AURORA_RGB[0],
    idPrefix: 'birth-heartbeat',
  })

  // A whisper lullaby visits the birth-cell region from the west delay tower.
  b.beams.whisper({
    effect: FX.beamWhisper,
    position: DELAY[0],
    target: BIRTH_CELL,
    land: m.offset(firstStar, 4),
    gainDb: -2,
    idPrefix: 'lullaby',
  })

  // The aurora rolls the rows for the whole act (mast-west: 10 + 4 Hz).
  for (let i = 0; i < WAVE_COUNT; i++) {
    b.crowd.wave({
      effect: FX.crowdWave,
      position: MAST_W,
      from: m.offset(firstStar, 6 + WAVE_STEP_BEATS * i),
      periodBeats: 6,
      dirDeg: 0,
      rgb: AURORA_RGB[i % 3],
      idPrefix: `aurora-wave-${i}`,
    })
  }

  // Each 'breath' hit: the field inhales — one dim flood, then it relaxes.
  for (let i = 0; i < BREATH_COUNT; i++) {
    b.crowd.flood({
      id: `breath-flood-${i}`,
      effect: FX.crowdFlood,
      position: MAST_E,
      from: m.hit('breath', i),
      rgb: AURORA_RGB[0],
      intensity: 0.35,
    })
  }

  // Whisper duet leapfrogging the front corners in canon (south arrays).
  DUET_CELLS.forEach((cell, i) => {
    b.beams.whisper({
      effect: FX.beamWhisper,
      position: SOUTH[i % 2]!,
      target: cell,
      land: m.offset(m.hit('breath', 1), DUET_STEP_BEATS * i),
      idPrefix: `duet-${i}`,
    })
  })

  // Curtain folds through the lift: alternating column bands (mast-east:
  // 12 Hz chase + 2 Hz breath floods stays well under the 30 Hz cap).
  b.crowd.chase({
    effect: FX.crowdChase,
    position: MAST_E,
    startLand: m.climax(0),
    stepBeats: 12,
    sections: 3,
    rgb: AURORA_RGB[2],
    idPrefix: 'curtain-fold',
  })
}

/** ACT 2 — MOONRISE: the first sky media, mirroring what the crowd has done. */
function actTwoMoonrise(b: ShowBuilder, m: MusicRefs): void {
  const moonrise = m.annotation('accent', 0, 'moonrise')
  const zenith = m.climax(1)
  const hum = m.phraseEnd(4) // Clair de Lune's bar-9 phrase boundary

  // The crescent moon rises from pad-2 and hangs through the act.
  b.drones.formation({
    id: 'moon-crescent',
    effect: FX.crescent,
    position: PAD_2,
    by: moonrise,
    holdSec: 40,
    params: { count: 60, scaleM: 35, rgb: RGB.moon },
  })

  // Its earthly reflection: lancework crescent glowing on rack-4.
  b.fabrication.cue({
    id: 'moon-lancework',
    effectId: FX.lanceworkMoon,
    anchor: moonrise,
    positionId: LANCEWORK_RACK,
  })

  // The sky mirrors the crowd: aurora curtains from both towers (twice),
  // aurora ribbons on both panels.
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserAurora, position: tower, from: moonrise, durBeats: 24 })
  }
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserAurora, position: tower, from: hum, durBeats: 24 })
  }
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelAurora, position: panel, from: moonrise })
  }

  // 'shimmer' ×8: single silver whisper comets alternating racks 3/6.
  for (let i = 0; i < SHIMMER_COUNT; i++) {
    b.pyro.fire({
      id: `shimmer-comet-${i}`,
      effect: FX.cometSilver,
      position: COMET_RACKS[i % 2]!,
      land: m.hit('shimmer', i),
    })
  }

  // The moon HUMS from where it hangs: crossed stereo bed on the birth cell
  // plus a source tag following the crescent from the north-west long-throw
  // array (fallback aim: the birth cell, well inside its ~267 m horizon).
  b.beams.stereo({
    effect: FX.beamStereo,
    positions: [DELAY[0], DELAY[1]],
    target: BIRTH_CELL,
    land: hum,
    idPrefix: 'moon-hum',
  })
  b.beams.tag({
    effect: FX.beamTag,
    position: NORTH_W,
    source: 'moon-crescent',
    fallbackTarget: BIRTH_CELL,
    land: hum,
    idPrefix: 'moon-tag',
  })

  // ZENITH — the loudest the night ever gets (98 dB at 15 m ≈ 76 dB at the
  // 190 m listeners): waterfall curtains + maximum sparkle + bright panels.
  WATERFALL_RACKS.forEach((rack, i) => {
    b.fabrication.cue({
      id: `zenith-waterfall-${i}`,
      effectId: FX.waterfall,
      anchor: zenith,
      positionId: rack,
    })
  })
  b.crowd.sparkle({
    id: 'zenith-sparkle-west',
    effect: FX.crowdSparkle,
    position: MAST_W,
    from: zenith,
    densityFrac: 0.9,
    twinkleHz: 8,
    rgb: RGB.silver,
  })
  b.crowd.sparkle({
    id: 'zenith-sparkle-east',
    effect: FX.crowdSparkle,
    position: MAST_E,
    from: zenith,
    densityFrac: 0.9,
    twinkleHz: 8,
    rgb: RGB.moon,
  })
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelAurora, position: panel, from: zenith, rgb: RGB.moon })
  }

  // Post-zenith: the crescent melts into a heart — held 20 s.
  b.drones.formation({
    id: 'moon-heart',
    effect: FX.heart,
    position: PAD_2,
    by: m.offset(zenith, 18),
    holdSec: 20,
    params: { count: 60, scaleM: 30, rgb: ROSE },
  })
}

/** ACT 3 — SLEEP: the sky retires; the aurora contracts to its birth cell. */
function actThreeSleep(b: ShowBuilder, m: MusicRefs): void {
  const adagio = m.annotation('accent', 0, 'adagio')

  // Deep indigo floods hold the lawn dark through the act (mast-east, 2 Hz).
  for (let i = 0; i < 7; i++) {
    b.crowd.flood({
      id: `indigo-flood-${i}`,
      effect: FX.crowdFlood,
      position: MAST_E,
      from: m.offset(adagio, 24 * i),
      rgb: RGB.indigo,
      intensity: 0.25,
    })
  }

  // Fireflies: pad-2's 60 drones scatter low over the lake through the adagio.
  b.drones.formation({
    id: 'fireflies',
    effect: FX.scatter,
    position: PAD_2,
    by: m.offset(adagio, 32),
    holdSec: 40,
    params: { count: 60, scaleM: 30, rgb: RGB.gold },
  })

  // Goodnight whispers row by row, BACK rows first, delay towers alternating.
  ROW_CELLS.forEach((cell, i) => {
    b.beams.whisper({
      effect: FX.beamWhisper,
      position: DELAY[i % 2]!,
      target: cell,
      land: m.offset(adagio, 6 + GOODNIGHT_STEP_BEATS * i),
      idPrefix: `goodnight-row-${i}`,
    })
  })

  // 'heartbeat' ×7: pulses contracting to the birth cell, dimmer each bar.
  for (let i = 0; i < PULSE_COUNT; i++) {
    const dim = 1 - i * 0.12
    b.crowd.pulse({
      effect: FX.crowdPulse,
      position: MAST_W,
      land: m.hit('heartbeat', i),
      originCell: BIRTH_CELL,
      periodBeats: 12 - i,
      rgb: [0.25 * dim, 0.84 * dim, 0.55 * dim],
      idPrefix: `contract-pulse-${i}`,
    })
  }

  // 'lastLight': the birth cell blinks once — then nothing.
  b.crowd.pulse({
    effect: FX.crowdPulse,
    position: MAST_W,
    land: m.hit('lastLight', 0),
    originCell: BIRTH_CELL,
    periodBeats: 3,
    rgb: [0.05, 0.17, 0.11],
    idPrefix: 'last-blink',
  })
}

/** The whole show — shared verbatim by both variants. */
function authorAurora(b: ShowBuilder, m: MusicRefs): void {
  actOneFirstLight(b, m)
  actTwoMoonrise(b, m)
  actThreeSleep(b, m)
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** Midsummer Aurora (standard variant — already quiet-native). Throws on any error diagnostic. */
export function aurora(): BuildResult {
  const tl = suiteTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'aurora',
    title: 'Midsummer Aurora',
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant: 'standard',
  })
    .music(tl)
    .preRoll(PRE_ROLL_SEC)
    .quantize('none')
  authorAurora(b, m)
  return b.build()
}

/**
 * The quiet variant: the IDENTICAL cue list plus the enforced 85 dB budget.
 * No substitutions expected — proof that the standard design is quiet-native.
 */
export function auroraQuiet(): BuildResult {
  const tl = suiteTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'aurora-quiet',
    title: 'Midsummer Aurora (Quiet)',
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant: 'quiet',
  })
    .music(tl)
    .preRoll(PRE_ROLL_SEC)
    .quantize('none')
    .noiseBudget(85)
  authorAurora(b, m)
  return b.build()
}
