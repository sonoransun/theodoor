/**
 * programs/src/july4.ts — "July 4th Spectacular", the flagship Independence
 * Day program, plus its quiet variant for noise-sensitive audiences.
 *
 * Music: THE JULY 4TH SUITE — Sousa's "The Stars and Stripes Forever"
 * (216 s march) joined bar-aligned to the finale of Tchaikovsky's 1812
 * Overture (~113 s) via concatScores; ~5.5 minutes total.
 *
 * Structure (both variants share the same musical skeleton):
 *   ACT 1 — Stars & Stripes
 *     - opening 50-drone US flag, fully formed by the end of phrase 2
 *     - landings on EVERY phrase end of the march (RWB peony volleys /
 *       quiet comet fans + laser chevrons)
 *     - single gold comets on each strain-start accent
 *     - panel flagStripes through the trio, laser fans in the breakstrain
 *     - RWB crowd waves washing the wristband canvas through the trio
 *     - grandioso: layered volley + the flag morphs into a five-point star
 *   ACT 2 — 1812 finale
 *     - willows/brocades (quiet: comet fans) on its phrase ends
 *     - THE 16 CANNONS: hit-annotation-locked pairs on the far racks
 *       (quiet: panel white strobes + low-noise crossette/mine accents +
 *       bass-locked laser chevron hits)
 *     - bell-peal passage: laser lissajous + panel chase
 *     - coda: density/caliber-ramped barrage into the 'finalChord' climax
 *       (quiet: drone bloom + comet curtain), panel strobes, and 60 drones
 *       spelling USA
 *
 * NOTE on the coda window: the suite carries TWO strength-1 climaxes
 * (S&S 'grandioso', 1812 'finalChord'). musicRefs.climaxRamp resolves the
 * strength tie to the FIRST climax, i.e. the grandioso — so the coda barrage
 * anchors its peak explicitly on climax index 1 ('finalChord') instead.
 *
 * NOTE on the finale shells: the plan's "chrysanthemum-200" does not exist in
 * the starter catalog; the 200 mm finale entry is 'brocade-200-gold', used
 * here for the triple finale burst.
 *
 * Quiet-only spectacle: a red-over-blue crowd "flag" flood on the first
 * strain, and a crossed stereo beam bed from the delay towers under the
 * grandioso — two 16 s sections retargeted between mid-lawn cells so no
 * single cell accrues carrier dwell.
 *
 * Determinism: pure functions of constants only — no Date.now, no
 * Math.random, no module-level caches; every call builds a fresh show.
 */

import type { BuildResult, MusicalTimeline, MusicRefs, ShowBuilder } from '@theodoor/core'
import {
  buildTimelineFromScore,
  concatScores,
  lakesidePark,
  musicRefs,
  overture1812Finale,
  showBuilder,
  starsAndStripesForever,
  starterCatalog,
} from '@theodoor/core'
import { RGB } from './palettes.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED = 40714
const PRE_ROLL_SEC = 6

/** lakesidePark asset ids. */
const PAD = 'pad-1'
const RACKS = [
  'rack-1', 'rack-2', 'rack-3', 'rack-4', 'rack-5', 'rack-6', 'rack-7', 'rack-8',
] as const
/** The far ends of the firing line — the cannon racks. */
const CANNON_RACKS = ['rack-1', 'rack-8'] as const
/** Inner six racks used by volleys and the coda barrage. */
const BARRAGE_RACKS = ['rack-2', 'rack-3', 'rack-4', 'rack-5', 'rack-6', 'rack-7'] as const
const VOLLEY_EVEN = ['rack-2', 'rack-4', 'rack-6'] as const
const VOLLEY_ODD = ['rack-3', 'rack-5', 'rack-7'] as const
/** 1812 phrase-end shells walk this rack cycle (never the cannon racks). */
const PHRASE_1812_RACKS = ['rack-2', 'rack-7', 'rack-3', 'rack-6', 'rack-4', 'rack-5'] as const
const LASERS = ['laser-west', 'laser-east'] as const
const PANELS = ['panel-west', 'panel-east'] as const
/** Crowd masts (each covers every cell; the mask budget is per-mast). */
const MAST_WEST = 'mast-west'
const MAST_EAST = 'mast-east'
/** Whole-zone beam towers at the back of the lawn (throw ≤ ~165 m). */
const DELAY_TOWERS = ['beam-delay-west', 'beam-delay-east'] as const

/** Starter-catalog effect ids (see packages/core/src/catalog/starter). */
const FX = {
  peonyRed: 'peony-75-red',
  peonyBlue: 'peony-75-blue',
  peonyWhite: 'peony-100-white',
  peonyGold: 'peony-150-gold',
  chrysGold: 'chrysanthemum-100-gold',
  chrysSilver: 'chrysanthemum-150-silver',
  willowGold: 'willow-150-gold',
  brocadeGold: 'brocade-200-gold',
  crossetteRed: 'crossette-100-red',
  crossetteSilver: 'crossette-75-silver',
  cometGold: 'comet-30-gold',
  cometRed: 'comet-50-red',
  mineSilver: 'mine-50-silver',
  salute: 'salute-100',
  droneFlag: 'flag-formation-50',
  droneStar: 'star-formation-80',
  droneRing: 'ring-formation-60',
  droneWave: 'wave-formation-100',
  droneBloom: 'bloom-formation-120',
  droneText: 'text-formation-150',
  laserFan: 'laser-fan-rgb',
  laserLissajous: 'laser-lissajous-rgb',
  laserChevron: 'laser-chevron-red',
  panelFlag: 'panel-flag-stripes',
  panelChase: 'panel-chase',
  panelStrobe: 'panel-strobe',
} as const

/** RWB peony rotation for the march phrase volleys. */
const RWB_POOL = [FX.peonyRed, FX.peonyWhite, FX.peonyBlue] as const

/** Stars & Stripes strain-start accent labels, in score order. */
const STRAIN_ACCENTS = [
  'firstStrain', 'secondStrain', 'trio', 'breakstrain', 'grandioso',
] as const

/** Phrase-end indices of the march (Stars & Stripes) in the combined suite. */
const MARCH_PHRASES = { from: 0, to: 11 } as const
/** Phrase-end indices belonging to the 1812 finale (last one is post-chord). */
const PHRASES_1812 = { from: 13, to: 18 } as const

const CANNON_COUNT = 16

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Fresh combined-suite timeline: Stars & Stripes, then the 1812 finale. */
function suiteTimeline(): MusicalTimeline {
  return buildTimelineFromScore(
    concatScores(starsAndStripesForever, overture1812Finale, {
      id: 'july4-suite',
      title: 'July 4th Suite',
    }),
  )
}

// ---------------------------------------------------------------------------
// Shared sections (identical in both variants — every effect here is quiet)
// ---------------------------------------------------------------------------

/** Opening flag (formed by the end of phrase 2) + grandioso star morph. */
function droneFlagAndStar(b: ShowBuilder, m: MusicRefs): void {
  b.drones.formation({
    id: 'flag-open',
    effect: FX.droneFlag,
    position: PAD,
    by: m.phraseEnd(1),
    holdSec: 24,
    params: { count: 50 },
  })
  b.drones.formation({
    id: 'star-grandioso',
    effect: FX.droneStar,
    position: PAD,
    by: m.climax(0),
    holdSec: 10,
    params: { count: 50 },
  })
}

/** Single gold comets on each strain-start accent (alternating center racks). */
function strainComets(b: ShowBuilder, m: MusicRefs): void {
  STRAIN_ACCENTS.forEach((label, i) => {
    b.pyro.fire({
      id: `strain-comet-${i}`,
      effect: FX.cometGold,
      position: i % 2 === 0 ? 'rack-4' : 'rack-5',
      land: m.annotation('accent', 0, label),
    })
  })
}

/** Panel flagStripes through the trio (both panels, two passes). */
function trioPanels(b: ShowBuilder, m: MusicRefs): void {
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelFlag, position: panel, from: m.annotation('accent', 0, 'trio') })
  }
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelFlag, position: panel, from: m.phraseEnd(5) })
  }
}

/** RGB beam fans from both towers through the breakstrain. */
function breakstrainLasers(b: ShowBuilder, m: MusicRefs): void {
  for (const tower of LASERS) {
    b.lasers.pattern({
      effect: FX.laserFan,
      position: tower,
      from: m.annotation('accent', 0, 'breakstrain'),
      durBeats: 32,
    })
  }
}

/**
 * RWB crowd waves washing through the trio: three successive wavefronts
 * (red, white, blue) on ONE mast, periodBeats 4, spaced 24 beats (12 s at
 * 120 bpm) so the 10 s pattern windows never stack — each wave costs 10 of
 * the mast's 30 frames/s mask budget.
 */
function trioCrowdWaves(b: ShowBuilder, m: MusicRefs): void {
  ;([RGB.red, RGB.white, RGB.blue] as const).forEach((rgb, i) => {
    b.crowd.wave({
      effect: 'crowd-wave-lateral',
      position: MAST_WEST,
      from: m.offset(m.annotation('accent', 0, 'trio'), i * 24),
      periodBeats: 4,
      rgb,
      idPrefix: `trio-wave-${i}`,
    })
  })
}

/** Bell-peal passage (the 3/4 section): laser lissajous + panel chase. */
function bellPeal(b: ShowBuilder, m: MusicRefs): void {
  const from = m.annotation('accent', 0, 'bellPeal')
  for (const tower of LASERS) {
    b.lasers.pattern({ effect: FX.laserLissajous, position: tower, from, durBeats: 24 })
  }
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelChase, position: panel, from, rgb: RGB.gold })
  }
}

/** finalChord: panel strobes + 60 drones spelling USA at 3 m per font cell. */
function finaleUsa(b: ShowBuilder, m: MusicRefs): void {
  for (const panel of PANELS) {
    b.panels.pattern({ effect: FX.panelStrobe, position: panel, from: m.climax(1), rgb: RGB.white })
  }
  b.drones.formation({
    id: 'usa-finale',
    effect: FX.droneText,
    position: PAD,
    by: m.climax(1),
    holdSec: 4,
    params: { count: 60, text: 'USA', scaleM: 3 },
  })
}

// ---------------------------------------------------------------------------
// Program notes (the printed program) — shared by both variants
// ---------------------------------------------------------------------------

/** Tagline, music credits, and five acts anchored on the suite's own marks. */
function programNotes(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  b.notes({
    tagline: quiet
      ? 'A march, a battle, and a sky that keeps time — the quiet performance, where the cannons arrive as light.'
      : 'A march, a battle, and a sky that keeps time.',
    music: [
      'John Philip Sousa — The Stars and Stripes Forever (1896)',
      'Pyotr Ilyich Tchaikovsky — 1812 Overture, finale (1880)',
    ],
    epilogue: 'Sixteen cannons, one flag, and every burst on its beat.',
  })
  b.act(
    'I — Colors',
    m.time(0),
    'Fifty drones rise from behind the firing line and settle into a waving flag by the end of ' +
      'the second phrase. Every phrase of the march ends in a red, white and blue volley — the ' +
      'shells left their mortars two seconds before you see them, so the breaks land on the ' +
      'downbeat, never after it. A single gold comet marks the start of each strain.',
  )
  b.act(
    'II — The Trio',
    m.annotation('accent', 0, 'trio'),
    'Look down. The trio washes across the lawn in red, white and blue waves on the wristbands, ' +
      'each wavefront sent a fraction of a second early so it finishes lighting on the beat. ' +
      'Stripes ripple on the panels, and laser fans open over the water through the break strain.',
  )
  b.act(
    'III — Grandioso',
    m.climax(0),
    'The flag melts into a five-point star over the lake as the band goes grandioso, with gold ' +
      'brocade and red crossettes layered on the very same landing.',
  )
  b.act(
    'IV — 1812',
    m.annotation('accent', 0, 'largoHymn'),
    "Tchaikovsky's finale, with its sixteen cannons on the far ends of the line. Each cannon is " +
      'fired early by its own rise time so it lands exactly on the written hit — in the quiet ' +
      'performance the cannons are white strobes, low silver accents and laser hits. Willows and ' +
      'brocades hang over the phrase ends; the bell peal gets lissajous lasers and chasing panels.',
  )
  b.act(
    'V — Final Chord',
    m.annotation('accent', 0, 'codaHymn'),
    'The coda ramps from one shell every two seconds to eight a second across six racks, the ' +
      'bursts growing as it goes, and lands a triple gold burst on the final chord while sixty ' +
      'drones spell USA.',
  )
}

// ---------------------------------------------------------------------------
// Standard show
// ---------------------------------------------------------------------------

/** The July 4th Spectacular (standard variant). Throws if any diagnostic is an error. */
export function july4(): BuildResult {
  const tl = suiteTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'july4',
    title: 'July 4th Spectacular',
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant: 'standard',
  })
    .music(tl)
    .preRoll(PRE_ROLL_SEC)
    .quantize('none')
  programNotes(b, m, false)

  // --- ACT 1: Stars & Stripes ----------------------------------------------
  droneFlagAndStar(b, m)
  strainComets(b, m)

  // RWB peony volleys landing on EVERY phrase end of the march, colors
  // rotated and positions alternated per phrase.
  m.everyPhraseEnd(MARCH_PHRASES).forEach((land, i) => {
    b.pyro.volley({
      idPrefix: `rwb-${i}`,
      effects: [RWB_POOL[i % 3]!, RWB_POOL[(i + 1) % 3]!, RWB_POOL[(i + 2) % 3]!],
      positions: i % 2 === 0 ? VOLLEY_EVEN : VOLLEY_ODD,
      land,
    })
  })

  trioPanels(b, m)
  breakstrainLasers(b, m)
  trioCrowdWaves(b, m)

  // Grandioso: brocade + crossette layered volley (the drone flag morphs into
  // a star on the same climax — see droneFlagAndStar).
  b.pyro.volley({
    idPrefix: 'grandioso',
    effects: [FX.brocadeGold, FX.crossetteRed],
    positions: ['rack-3', 'rack-5', 'rack-7'],
    land: m.climax(0),
  })

  // --- ACT 2: 1812 finale ---------------------------------------------------
  // Willows / brocades hanging over the finale's phrase ends.
  m.everyPhraseEnd(PHRASES_1812).forEach((land, i) => {
    b.pyro.fire({
      id: `phrase1812-${i}`,
      effect: i % 2 === 0 ? FX.willowGold : FX.brocadeGold,
      position: PHRASE_1812_RACKS[i % PHRASE_1812_RACKS.length]!,
      land,
    })
  })

  // THE 16 CANNONS: salute-100 + chrysanthemum-150 pairs on the far racks,
  // sides alternating — the longest anticipation lead-ins in the show.
  for (let i = 0; i < CANNON_COUNT; i++) {
    const land = m.hit('cannon', i)
    const [near, far] = i % 2 === 0 ? CANNON_RACKS : [CANNON_RACKS[1], CANNON_RACKS[0]]
    b.pyro.fire({ id: `cannon-${i}-salute`, effect: FX.salute, position: near!, land })
    b.pyro.fire({ id: `cannon-${i}-chrys`, effect: FX.chrysSilver, position: far!, land })
  }

  bellPeal(b, m)

  // Coda barrage: 0.5 → 8 Hz across the six inner racks, calibers ramping
  // 75 → 200 mm, final cue landing ON the 'finalChord' climax. (climaxRamp
  // would tie-break to the grandioso — see the module doc — so the peak is
  // anchored on climax index 1 explicitly.)
  b.pyro.barrage({
    idPrefix: 'coda-barrage',
    window: { peak: m.climax(1), windowSec: 20 },
    effectPool: [
      FX.peonyRed, FX.peonyBlue, FX.peonyWhite, FX.chrysGold,
      FX.peonyGold, FX.chrysSilver, FX.brocadeGold,
    ],
    positions: BARRAGE_RACKS,
    startRateHz: 0.5,
    endRateHz: 8,
  })

  // Finale: triple 200 mm gold burst ON the finalChord.
  ;(['rack-2', 'rack-4', 'rack-6'] as const).forEach((rack, i) => {
    b.pyro.fire({ id: `finale-${i}`, effect: FX.brocadeGold, position: rack, land: m.climax(1) })
  })

  finaleUsa(b, m)
  return b.build()
}

// ---------------------------------------------------------------------------
// Quiet show
// ---------------------------------------------------------------------------

/**
 * The quiet variant: same timeline and structure, no effect above 100 dB at
 * the reference distance, and a summed 85 dB SPL budget at the audience
 * listeners. Flag / star / USA drone moments are unchanged.
 */
export function july4Quiet(): BuildResult {
  const tl = suiteTimeline()
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'july4-quiet',
    title: 'July 4th Spectacular (Quiet)',
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

  // --- Drones: flag and star unchanged, plus color pulses and the coda bloom.
  droneFlagAndStar(b, m)
  b.drones.formation({
    id: 'pulse-largo',
    effect: FX.droneRing,
    position: PAD,
    by: m.phraseEnd(12),
    params: { count: 50, rgb: RGB.red },
  })
  b.drones.formation({
    id: 'pulse-allegro',
    effect: FX.droneWave,
    position: PAD,
    by: m.phraseEnd(13),
    params: { count: 50, scaleM: 50, rgb: RGB.blue },
  })
  b.drones.formation({
    id: 'bloom-coda',
    effect: FX.droneBloom,
    position: PAD,
    by: m.annotation('accent', 0, 'codaHymn'),
    params: { count: 60, scaleM: 40, rgb: RGB.gold },
  })

  // --- ACT 1 -----------------------------------------------------------------
  strainComets(b, m)

  // March phrase ends: comet fans + laser chevrons instead of peony volleys.
  m.everyPhraseEnd(MARCH_PHRASES).forEach((land, i) => {
    b.pyro.volley({
      idPrefix: `fan-${i}`,
      effects: i % 2 === 0 ? [FX.cometGold, FX.cometRed] : [FX.cometRed, FX.cometGold],
      positions: i % 2 === 0 ? VOLLEY_EVEN : VOLLEY_ODD,
      land,
    })
    b.lasers.pattern({
      id: `chevron-${i}`,
      effect: FX.laserChevron,
      position: LASERS[i % 2]!,
      from: land,
      durBeats: 8,
    })
  })

  trioPanels(b, m)
  breakstrainLasers(b, m)
  trioCrowdWaves(b, m)

  // Quiet-mode spectacle, Act 1: a red-over-blue "flag" flood across every
  // wristband on the first strain (mast-east — the trio waves own mast-west,
  // and the 2 Hz flood leaves that mast's budget essentially untouched).
  b.crowd.flood({
    id: 'flag-flood',
    effect: 'crowd-flood-rgb',
    position: MAST_EAST,
    from: m.annotation('accent', 0, 'firstStrain'),
    rgb: RGB.red,
    rgb2: RGB.blue,
  })

  // Grandioso: low-noise crossette / mine layered volley under the star morph.
  b.pyro.volley({
    idPrefix: 'grandioso',
    effects: [FX.crossetteSilver, FX.mineSilver],
    positions: ['rack-1', 'rack-3', 'rack-5', 'rack-7'],
    land: m.climax(0),
  })

  // Grandioso stereo bed: two 16 s crossed-pair sections from the delay
  // towers, retargeted between sections (cell 170 → cell 95) so no single
  // cell accrues carrier dwell. Both cells sit mid-lawn, ~70–85 m from
  // either tower — inside the ~165 m throw with > 5° of horizon margin —
  // and section 2 lands 36 beats (18 s) after section 1, leaving ~2 s of
  // idle gap for the (small) cross-cell slew.
  b.beams.stereo({
    effect: 'beam-stereo-bed',
    positions: DELAY_TOWERS,
    target: 170,
    land: m.climax(0),
    idPrefix: 'bed-grandioso-0',
  })
  b.beams.stereo({
    effect: 'beam-stereo-bed',
    positions: DELAY_TOWERS,
    target: 95,
    land: m.offset(m.climax(0), 36),
    idPrefix: 'bed-grandioso-1',
  })

  // --- ACT 2 -----------------------------------------------------------------
  // 1812 phrase ends: more comet fans + chevrons.
  m.everyPhraseEnd(PHRASES_1812).forEach((land, i) => {
    b.pyro.volley({
      idPrefix: `fan1812-${i}`,
      effects: i % 2 === 0 ? [FX.cometRed, FX.cometGold] : [FX.cometGold, FX.cometRed],
      positions: i % 2 === 0 ? VOLLEY_ODD : VOLLEY_EVEN,
      land,
    })
    b.lasers.pattern({
      id: `chevron1812-${i}`,
      effect: FX.laserChevron,
      position: LASERS[(i + 1) % 2]!,
      from: land,
      durBeats: 8,
    })
  })

  // THE 16 CANNONS, quiet: panel white strobes + low-noise crossette/mine
  // accents on the far racks + bass-locked laser chevron hits.
  for (let i = 0; i < CANNON_COUNT; i++) {
    const land = m.hit('cannon', i)
    b.panels.pattern({
      id: `cannon-${i}-strobe`,
      effect: FX.panelStrobe,
      position: PANELS[i % 2]!,
      from: land,
      rgb: RGB.white,
    })
    b.pyro.fire({
      id: `cannon-${i}-accent`,
      effect: i % 2 === 0 ? FX.crossetteSilver : FX.mineSilver,
      position: CANNON_RACKS[i % 2]!,
      land,
    })
    b.lasers.pattern({
      id: `cannon-${i}-hit`,
      effect: FX.laserChevron,
      position: LASERS[i % 2]!,
      from: land,
      durBeats: 4,
    })
  }

  bellPeal(b, m)

  // Climax: comet curtain across the whole rack line ON the finalChord
  // (the drone bloom heralds the coda hymn — see 'bloom-coda' above).
  b.pyro.volley({
    idPrefix: 'curtain',
    effects: [FX.cometRed, FX.cometGold],
    positions: RACKS,
    land: m.climax(1),
  })

  finaleUsa(b, m)
  return b.build()
}
