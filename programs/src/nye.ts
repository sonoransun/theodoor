/**
 * programs/src/nye.ts — "New Year's Eve at Lakeside Park".
 *
 * Three passes of Auld Lang Syne joined bar-aligned (verse → buildup →
 * reprise, ~5.6 min). The start of the third pass's final chorus is stamped
 * with a custom 'midnight' accent (strength 1); earlier climaxes are damped
 * to 0.9 so `climaxRamp` targets midnight exactly.
 *
 * Arc:
 *   Act 1 (pass 1)  gentle willows on phrase ends, misty laser fans, a
 *                   'HAPPY NEW YEAR SOON' ticker, a gold drone star held long.
 *   Act 2 (pass 2)  the star morphs into a 60 s clock ring that spans the
 *                   pass boundary, panel chases accelerate, sparse gold
 *                   comets on accents, brocades on the pass-2 climax.
 *   Countdown       drone digits 9…0 land on downbeats marching to midnight.
 *                   NOTE: the digit formation holds 8 s and digit→digit
 *                   morphs need ≈4 s of flight, so consecutive downbeats
 *                   (3.33 s apart) are a hard DRONE_OVERLAP; digits land on
 *                   every 4th downbeat (13.3 s), digit 0 exactly on the last
 *                   downbeat before midnight. Salutes hit the last 3
 *                   downbeats (quiet: panel strobes + laser pulses). Gold
 *                   crowd pulses shadow every digit landing (mast-east), and
 *                   a 10 s whisper count-in beam from the west delay tower
 *                   covers the final three bars into midnight.
 *   Midnight        40 s density-ramped barrage peaking ON the midnight
 *                   annotation, gold brocade layer, 'HAPPY NEW YEAR!' ticker
 *                   + strobes, radial laser burst, drones morph to '2027'
 *                   while the wristband canvas spells '2027' (mast-west)
 *                   over an all-cells white flood pulse (mast-east).
 *   Reprise tail    willows and a gentle gold laser sweep to the end.
 *
 * nyeQuiet() keeps the identical structure with variant 'quiet' and an 85 dB
 * noise budget: low-noise comets/crossettes/mines replace shells, the salute
 * accents become panel strobes + laser pulses, and the midnight barrage is a
 * comet curtain + laser barrage + expanding drone blooms after the '2027'.
 * (The blooms follow '2027' because a single pad flies one morph chain — the
 * digits own the pad through midnight.)
 *
 * Pure and deterministic: no caching, no clocks, no randomness.
 */

import type { Annotation, BuildResult, MusicRefs, MusicalTimeline, ShowBuilder } from '@theodoor/core'
import {
  annotationsOfKind,
  auldLangSyne,
  buildTimelineFromScore,
  concatScores,
  lakesidePark,
  musicRefs,
  showBuilder,
  starterCatalog,
} from '@theodoor/core'
import { RGB } from './palettes.js'

const SEED = 20260101
const MIDNIGHT = 'midnight'
const RACKS = ['rack-1', 'rack-2', 'rack-3', 'rack-4', 'rack-5', 'rack-6', 'rack-7', 'rack-8']

/**
 * Three bar-aligned passes of Auld Lang Syne with a 'midnight' accent on the
 * last pass's final-chorus climax. Only that climax keeps strength 1 (the
 * two earlier finalChorus climaxes are damped to 0.9) so that
 * musicRefs.climaxRamp — which picks the strongest climax, first on ties —
 * resolves to midnight.
 */
function nyeTimeline(): MusicalTimeline {
  const opening = concatScores(auldLangSyne, auldLangSyne, {
    id: 'nye-suite-open',
    title: 'New Year Medley (I–II)',
  })
  const suite = concatScores(opening, auldLangSyne, {
    id: 'nye-suite',
    title: 'New Year Medley',
  })
  const tl = buildTimelineFromScore(suite)
  const climaxes = annotationsOfKind(tl, 'climax')
  const last = climaxes[climaxes.length - 1]!
  const midnight: Annotation = {
    time: last.time,
    ...(last.beat !== undefined ? { beat: last.beat } : {}),
    kind: 'accent',
    strength: 1,
    label: MIDNIGHT,
  }
  const annotations: Annotation[] = [
    ...tl.annotations.map((a) =>
      a.kind === 'climax' && a.time < last.time - 1e-9 ? { ...a, strength: 0.9 } : a,
    ),
    midnight,
  ].sort((a, b) => a.time - b.time)
  return { ...tl, annotations }
}


/**
 * Program notes (the printed program), shared by both variants. The five
 * acts sit on the cues' own anchors: the pass-2 verse, the first countdown
 * digit, the midnight accent, and four bars into the reprise.
 */
function programNotes(b: ShowBuilder, m: MusicRefs, quiet: boolean): void {
  b.notes({
    tagline: quiet
      ? 'Three passes of Auld Lang Syne, and a countdown you can wear — the quiet performance, midnight in comets and light.'
      : 'Three passes of Auld Lang Syne, and a countdown you can wear.',
    music: ['Robert Burns (words, 1788) / traditional Scots air — Auld Lang Syne'],
    epilogue: 'Should auld acquaintance be forgot — not tonight.',
  })
  b.act(
    'I — Old Acquaintance',
    m.time(0),
    'The first pass is gentle: gold willows and silver chrysanthemums on the phrase ends, wide ' +
      'slow laser fans that read as mist over the lake, and a gold star of sixty drones held ' +
      'through the verse. The panels already know what is coming.',
  )
  b.act(
    'II — The Clock',
    m.annotation('accent', 1, 'verse1'),
    'On the ritardando the star turns into a clock face of 120 drones and holds it for a full ' +
      'minute across the second pass. Panel chases quicken with every verse, gold comets mark ' +
      'the section starts, and brocades take the pass-two climax.',
  )
  b.act(
    'III — Countdown',
    m.lastDownbeatsBefore(MIDNIGHT, 37)[0]!,
    'Nine to zero in drone digits, one every four bars, each landing exactly on a downbeat: a ' +
      'digit needs eight seconds to hold and three to fly, so the count walks every fourth bar ' +
      'rather than every one. A gold pulse ripples out from the centre of the lawn on every ' +
      'digit, and through the last three bars a single whispered count-in from the tower behind ' +
      'you reaches the mid-lawn seats alone.',
  )
  b.act(
    'IV — Midnight',
    m.annotation('accent', 0, MIDNIGHT),
    'Forty seconds of barrage across all eight racks, densest and largest at the stroke itself. ' +
      'The wristbands spell 2027 while the whole lawn flashes white, the drones spell it in the ' +
      'sky a few bars later, and a radial burst of laser light fans from both towers.',
  )
  b.act(
    'V — The Reprise',
    m.offset(m.annotation('accent', 0, MIDNIGHT), 16),
    'The song comes back one last time under gold willows and a slow gold sweep of laser light, ' +
      'and the show lets go.',
  )
}

function buildNye(variant: 'standard' | 'quiet'): BuildResult {
  const quiet = variant === 'quiet'
  const tl = nyeTimeline()
  const m = musicRefs(tl)
  const midnightT = tl.annotations.find((a) => a.label === MIDNIGHT)!.time

  const b = showBuilder({
    id: quiet ? 'nye-quiet' : 'nye',
    title: quiet
      ? "New Year's Eve at Lakeside Park (Quiet)"
      : "New Year's Eve at Lakeside Park",
    seed: SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant,
  })
    .music(tl)
    .preRoll(6)
  if (quiet) b.noiseBudget(85)
  programNotes(b, m, quiet)

  // ---- Act 1 (pass 1, gentle) ---------------------------------------------
  // Soft shells on the first three phrase ends (bars 9/17/25).
  const softPair = quiet
    ? ['crossette-75-silver', 'mine-50-silver']
    : ['willow-150-gold', 'chrysanthemum-150-silver']
  const softPositions = [
    ['rack-3', 'rack-6'],
    ['rack-4', 'rack-5'],
    ['rack-2', 'rack-7'],
  ] as const
  for (let i = 0; i <= 2; i++) {
    b.pyro.volley({
      effects: softPair,
      positions: softPositions[i]!,
      land: m.phraseEnd(i),
      staggerBeats: 1,
    })
  }
  // Slow, wide laser fans — heavy scatter reads as mist over the lake.
  b.lasers
    .pattern({
      effect: 'laser-fan-rgb',
      position: 'laser-west',
      from: m.barBeat(2, 1),
      durBeats: 16,
      params: { spreadDeg: 100 },
    })
    .pattern({
      effect: 'laser-fan-rgb',
      position: 'laser-east',
      from: m.barBeat(2, 3),
      durBeats: 16,
      params: { spreadDeg: 100 },
    })
    .pattern({
      effect: 'laser-fan-rgb',
      position: 'laser-west',
      from: m.barBeat(17, 1),
      durBeats: 12,
      params: { spreadDeg: 80 },
    })
    .pattern({
      effect: 'laser-fan-rgb',
      position: 'laser-east',
      from: m.barBeat(19, 1),
      durBeats: 12,
      params: { spreadDeg: 80 },
    })
  b.panels
    .ticker('HAPPY NEW YEAR SOON', {
      position: 'panel-west',
      from: m.barBeat(3, 1),
      speedPxPerBeat: 4,
      rgb: RGB.silver,
    })
    .ticker('HAPPY NEW YEAR SOON', {
      position: 'panel-east',
      from: m.barBeat(3, 1),
      speedPxPerBeat: 4,
      rgb: RGB.silver,
    })
  // A rotating gold star, held through most of the first pass.
  b.drones.formation({
    effect: 'star-formation-80',
    position: 'pad-1',
    by: m.phraseEnd(0),
    holdSec: 48,
    priority: 5,
    params: { count: 60, scaleM: 40, rgb: RGB.gold },
  })

  // ---- Act 2 (pass 2, building) -------------------------------------------
  // The star morphs into the midnight clock ring on the pass-1 ritardando;
  // its 60 s face spans the pass boundary and the first half of pass 2.
  b.drones.formation({
    effect: 'clock-ring-formation-100',
    position: 'pad-1',
    by: m.barBeat(31, 1),
    priority: 5,
    params: { count: 120, scaleM: 60, rgb: RGB.silver },
  })
  // Panel chases accelerating across the pass (speed ramps up per cue).
  const chaseBars = [33, 41, 49, 57]
  chaseBars.forEach((bar, i) => {
    const speed = 6 + 4 * i
    b.panels
      .pattern({
        effect: 'panel-chase',
        position: 'panel-west',
        from: m.barBeat(bar, 1),
        rgb: RGB.gold,
        rgb2: RGB.blue,
        params: { speedPxPerBeat: speed },
      })
      .pattern({
        effect: 'panel-chase',
        position: 'panel-east',
        from: m.barBeat(bar, 1),
        rgb: RGB.gold,
        rgb2: RGB.blue,
        params: { speedPxPerBeat: speed },
      })
  })
  // Sparse gold comets on the pass-2 section accents (indices 4–7).
  for (let i = 4; i <= 7; i++) {
    b.pyro.volley({
      effects: ['comet-30-gold', 'comet-50-red'],
      positions: i % 2 === 0 ? ['rack-2', 'rack-7'] : ['rack-7', 'rack-2'],
      land: m.annotation('accent', i),
      staggerBeats: 0.5,
    })
  }
  // Brocades on the pass-2 climax (quiet: silver crossette pair).
  b.pyro.volley({
    effects: quiet ? ['crossette-75-silver', 'comet-50-red'] : ['brocade-200-gold', 'peony-150-gold'],
    positions: ['rack-4', 'rack-5'],
    land: m.climax(1),
    staggerBeats: 1.5,
  })

  // ---- Countdown ------------------------------------------------------------
  // Digits 9…0 on every 4th downbeat, digit 0 exactly on the last downbeat
  // before midnight (see the module doc for why not consecutive downbeats).
  const countdownLandings = m.lastDownbeatsBefore(MIDNIGHT, 37).filter((_, i) => i % 4 === 0)
  b.drones.countdown({
    position: 'pad-1',
    landings: countdownLandings,
    count: 60,
    scaleM: 3,
    idPrefix: 'nye-cd',
    priority: 10,
  })
  // Crowd shadow of the countdown: a gold radial pulse from the zone center
  // on every digit landing. Pulses ride mast-east (10 Hz) so the midnight
  // '2027' marquee keeps mast-west's 20 Hz to itself (Σ maskUpdateHz of
  // concurrent crowd cues per mast ≤ 30 frames/s).
  countdownLandings.forEach((land, i) => {
    b.crowd.pulse({
      effect: 'crowd-pulse-radial',
      position: 'mast-east',
      land,
      rgb: RGB.gold,
      idPrefix: `nye-cdp-${i}`,
    })
  })
  // Accents on the last three downbeats before midnight.
  const lastThree = m.lastDownbeatsBefore(MIDNIGHT, 3)
  lastThree.forEach((land, i) => {
    if (quiet) {
      b.panels
        .pattern({ effect: 'panel-strobe', position: 'panel-west', from: land, rgb: RGB.white })
        .pattern({ effect: 'panel-strobe', position: 'panel-east', from: land, rgb: RGB.white })
      b.lasers.pattern({
        effect: 'laser-chevron-red',
        position: i % 2 === 0 ? 'laser-west' : 'laser-east',
        from: land,
        durBeats: 2,
      })
    } else {
      b.pyro.fire({ effect: 'salute-100', position: i % 2 === 0 ? 'rack-1' : 'rack-8', land })
    }
  })
  // Whisper count-in from the west delay tower: ONE 10 s cue landing on the
  // third-to-last downbeat, so its audible window runs the final three bars
  // into midnight ("nine… eight…"), covering digit 0's landing. Mid-lawn
  // cell 170 sits ~74 m out — well inside the tower's ~165 m throw, with the
  // carrier comfortably below the exposure dwell threshold.
  b.beams.whisper({
    effect: 'beam-whisper-count',
    position: 'beam-delay-west',
    target: 170,
    land: lastThree[0]!,
    idPrefix: 'nye-count',
  })

  // ---- Midnight -------------------------------------------------------------
  // 40 s all-out barrage across all 8 racks, final cue landing ON midnight.
  b.pyro.barrage({
    window: m.climaxRamp(40),
    effectPool: quiet
      ? ['comet-30-gold', 'comet-50-red', 'mine-50-silver', 'crossette-75-silver']
      : [
          'peony-75-red',
          'peony-75-blue',
          'peony-100-white',
          'chrysanthemum-100-gold',
          'crossette-100-red',
          'peony-150-gold',
          'chrysanthemum-150-silver',
          'brocade-200-gold',
        ],
    positions: RACKS,
    startRateHz: quiet ? 0.7 : 1,
    endRateHz: quiet ? 3 : 8,
    idPrefix: 'nye-mid',
  })
  // Gold brocade layer over the peak (quiet: silver crossette layer).
  b.pyro.volley({
    effects: quiet ? ['crossette-75-silver'] : ['brocade-200-gold'],
    positions: ['rack-2', 'rack-7'],
    land: m.climax(2),
    staggerBeats: 0,
    idPrefix: 'nye-crown',
  })
  b.pyro.volley({
    effects: quiet ? ['mine-50-silver', 'crossette-75-silver'] : ['brocade-200-gold', 'peony-150-gold'],
    positions: ['rack-3', 'rack-6'],
    land: m.barBeat(90, 1),
    staggerBeats: 1,
  })
  // Panels: strobes + 'HAPPY NEW YEAR!' ticker (identical in both variants).
  b.panels
    .pattern({ effect: 'panel-strobe', position: 'panel-west', from: m.climax(2), rgb: RGB.white })
    .pattern({ effect: 'panel-strobe', position: 'panel-east', from: m.climax(2), rgb: RGB.white })
    .ticker('HAPPY NEW YEAR!', {
      position: 'panel-west',
      from: m.climax(2),
      speedPxPerBeat: 12,
      rgb: RGB.gold,
    })
    .ticker('HAPPY NEW YEAR!', {
      position: 'panel-east',
      from: m.climax(2),
      speedPxPerBeat: 12,
      rgb: RGB.gold,
    })
  // The crowd at midnight: '2027' across the wristband canvas (mast-west,
  // 20 Hz) plus an all-cells white flood pulse (mast-east, 2 Hz), both
  // landing ON the midnight annotation.
  b.crowd
    .text('2027', {
      effect: 'crowd-text-marquee',
      position: 'mast-west',
      land: m.annotation('accent', 0, MIDNIGHT),
      rgb: RGB.gold,
      idPrefix: 'nye-2027',
    })
    .flood({
      id: 'nye-midnight-flood',
      effect: 'crowd-flood-rgb',
      position: 'mast-east',
      from: m.annotation('accent', 0, MIDNIGHT),
      rgb: RGB.white,
    })
  // Radial laser burst — wide fast fans from both towers.
  b.lasers
    .pattern({
      effect: 'laser-fan-rgb',
      position: 'laser-west',
      from: m.climax(2),
      durBeats: 2,
      params: { spreadDeg: 120 },
    })
    .pattern({
      effect: 'laser-fan-rgb',
      position: 'laser-east',
      from: m.climax(2),
      durBeats: 2,
      params: { spreadDeg: 120 },
    })
  if (quiet) {
    // Laser barrage thickens the quiet midnight.
    b.lasers
      .pattern({
        effect: 'laser-tunnel-blue',
        position: 'laser-west',
        from: m.barBeat(90, 1),
        durBeats: 8,
      })
      .pattern({
        effect: 'laser-lissajous-rgb',
        position: 'laser-east',
        from: m.barBeat(90, 1),
        durBeats: 8,
      })
  }
  // Drones morph from digit 0 to '2027' while the ticker and lasers run.
  // scaleM 2.5 keeps the 4-glyph line inside the pad's 30 m geofence margin;
  // bar 95 gives the ≈13 s digit-0 → text morph its flight window.
  b.drones.formation({
    effect: 'text-formation-150',
    position: 'pad-1',
    by: m.barBeat(95, 1),
    holdSec: quiet ? 0 : 10,
    priority: 5,
    params: { text: '2027', count: 60, scaleM: 2.5, rgb: RGB.gold },
  })
  if (quiet) {
    // Quiet finale: drone fireworks — blooms expanding via successive cues,
    // an afterglow riding past the last chord.
    b.drones.formation({
      effect: 'bloom-formation-120',
      position: 'pad-1',
      by: m.time(midnightT + 44),
      params: { count: 60, scaleM: 34, rgb: RGB.gold },
    })
    b.drones.formation({
      effect: 'bloom-formation-120',
      position: 'pad-1',
      by: m.time(midnightT + 63),
      params: { count: 60, scaleM: 60, rgb: RGB.gold },
    })
  }

  // ---- Reprise tail -----------------------------------------------------------
  const tailSoft = quiet ? 'crossette-75-silver' : 'willow-150-gold'
  b.pyro
    .fire({ effect: tailSoft, position: 'rack-3', land: m.barBeat(92, 1) })
    .fire({ effect: tailSoft, position: 'rack-6', land: m.barBeat(95, 1) })
    .volley({
      effects: quiet ? ['crossette-75-silver', 'mine-50-silver'] : ['willow-150-gold', 'chrysanthemum-150-silver'],
      positions: ['rack-4', 'rack-5'],
      land: m.phraseEnd(11),
      staggerBeats: 1,
    })
  b.lasers
    .pattern({
      effect: 'laser-sweep-gold',
      position: 'laser-west',
      from: m.barBeat(91, 1),
      durBeats: 24,
    })
    .pattern({
      effect: 'laser-sweep-gold',
      position: 'laser-east',
      from: m.barBeat(92, 1),
      durBeats: 24,
    })

  return b.build()
}

/** The standard New Year's Eve show (~190 cues, full-caliber midnight). */
export function nye(): BuildResult {
  return buildNye('standard')
}

/** The quiet variant: same structure, 85 dB budget, no effect over 100 dB. */
export function nyeQuiet(): BuildResult {
  return buildNye('quiet')
}
