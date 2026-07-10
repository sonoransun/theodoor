/**
 * Gallery scene builders: formation stills/sheets/morphs, sky still + loop,
 * crowd loop + latency-ramp explainer. House golden style: substring
 * assertions, balanced-tag checks, two-run byte equality, byte-size
 * ceilings, and never currentColor (GitHub <img> renders it black).
 *
 * The sim fixture is built in-test (core tests must not import programs):
 * lakesidePark minus its east crowd mast -- the single-mast variant leaves the
 * east lawn outside coverage, so the crowd loop provably has never-lit cells.
 */

import { describe, expect, it } from 'vitest'
import type { Formation, SitePlan } from '../src/contracts.js'
import {
  bat,
  bloom,
  clockRing,
  cometTail,
  crescent,
  digit,
  flag,
  ghost,
  grid as gridFormation,
  heart,
  orrery,
  ring,
  saucer,
  scatter,
  snowflake,
  spiral,
  star,
  text as textFormation,
} from '../src/choreo/index.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { crowdGridFor, lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { sampleFrames, type GalleryFrame } from '../src/gallery/sample.js'
import { formationMorphSvg, formationSheetSvg, formationSvg } from '../src/gallery/formations.js'
import { skyLoopSvg, skySceneSvg, type SkyBurst } from '../src/gallery/sky.js'
import { crowdCellHex, crowdLoopSvg, crowdRampSvg } from '../src/gallery/crowd.js'
import { assertBalancedSvg } from './fab-fixture.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const score = getScore('odeToJoy')!
const tl = buildTimelineFromScore(score)
const m = musicRefs(tl)

// ---------------------------------------------------------------------------
// Formations
// ---------------------------------------------------------------------------

/** All 18 formation kinds, each capped at 64 points, labeled by kind. */
function sheetEntries(): { f: Formation; label: string }[] {
  return [
    { f: gridFormation(8, 8, 3), label: 'grid' },
    { f: ring(48, 20), label: 'ring' },
    { f: star(60, 22, 9), label: 'star' },
    { f: heart(60, 1.2), label: 'heart' },
    {
      f: flag(8, 6, 3, [
        [1, 0.25, 0.25],
        [0.95, 0.95, 0.95],
        [0.25, 0.35, 1],
      ]),
      label: 'flag',
    },
    { f: textFormation('OK', 60, 2), label: 'text' },
    { f: digit(7, 40, 2), label: 'digit' },
    { f: clockRing(60, 20), label: 'clockRing' },
    { f: scatter(64, { x: 30, y: 20, z: 18 }, 9), label: 'scatter' },
    { f: bloom(64, 16, 3), label: 'bloom' },
    { f: bat(64, 30), label: 'bat' },
    { f: ghost(64, 30, 4), label: 'ghost' },
    { f: spiral(64, 20, 5), label: 'spiral' },
    { f: cometTail(64, 30, 6), label: 'cometTail' },
    { f: saucer(64, 30), label: 'saucer' },
    { f: orrery(64, 20), label: 'orrery' },
    { f: crescent(48, 16), label: 'crescent' },
    { f: snowflake(60, 30), label: 'snowflake' },
  ]
}

describe('gallery/formations', () => {
  it('formationSvg: balanced still with per-point color and caption', () => {
    const svg = formationSvg(
      flag(8, 6, 3, [
        [1, 0.25, 0.25],
        [0.95, 0.95, 0.95],
        [0.25, 0.35, 1],
      ]),
      { label: 'flag' },
    )
    assertBalancedSvg(svg)
    expect(svg).toContain('>flag</text>')
    expect(svg).toContain('fill="#ff4040"') // top band 1,0.25,0.25
    expect(svg).not.toContain('currentColor')
    expect(
      formationSvg(
        flag(8, 6, 3, [
          [1, 0.25, 0.25],
          [0.95, 0.95, 0.95],
          [0.25, 0.35, 1],
        ]),
        { label: 'flag' },
      ),
    ).toBe(svg)
  })

  it('formationSheetSvg: all 18 kinds, labeled, deterministic, <= 90 KB', () => {
    const entries = sheetEntries()
    const svg = formationSheetSvg(entries, 6)
    assertBalancedSvg(svg)
    for (const e of entries) expect(svg).toContain(`>${e.label}</text>`)
    expect(svg.length).toBeLessThanOrEqual(90 * 1024)
    expect(svg).not.toContain('currentColor')
    expect(formationSheetSvg(sheetEntries(), 6)).toBe(svg)
  })

  it('volumetric depth maps to opacity while planar tiles stay opaque', () => {
    const volumetric = formationSvg(bloom(64, 16, 3))
    expect(volumetric).toContain('opacity="0.4"') // far hemisphere dimmed
    const planar = formationSvg(ring(48, 20))
    expect(planar).not.toContain('opacity=')
  })

  it('formationMorphSvg: one translate per point, hold-and-restart loop, <= 200 KB', () => {
    const build = (): string =>
      formationMorphSvg([ring(60, 20), star(60, 22, 9), heart(60, 1.2)], {
        durSec: 6,
        labels: ['ring', 'star', 'heart'],
      })
    const svg = build()
    assertBalancedSvg(svg)
    expect(svg.match(/<animateTransform /g)).toHaveLength(60)
    expect(svg).toContain('repeatCount="indefinite"')
    // holdLoopKeyTimes(4, 0.08): three keyframes over [0, 0.92], dup pinned to 1.
    expect(svg).toContain('keyTimes="0;0.46;0.92;1"')
    // Captions cross-fade in sync with keyframe arrival (discrete opacity).
    expect(svg).toContain('>ring<animate attributeName="opacity" values="1;0;0;0"')
    expect(svg).toContain('>heart<animate attributeName="opacity" values="0;0;1;1"')
    expect(svg.length).toBeLessThanOrEqual(200 * 1024)
    expect(svg).not.toContain('currentColor')
    expect(build()).toBe(svg)
  })
})

// ---------------------------------------------------------------------------
// Sim fixture shared by the sky + crowd suites
// ---------------------------------------------------------------------------

/** lakesidePark with only the west crowd mast (east lawn stays dark). */
function fixtureSite(): SitePlan {
  const site = lakesidePark()
  return { ...site, assets: site.assets.filter((a) => a.id !== 'mast-east') }
}

/**
 * One pyro volley + one 40-drone ring + one crowd flood + one beam whisper on
 * the south array, all landing on bar 12 (late enough for the drone morph
 * anticipation to fit after t=0), sampled over a 6 s window at 4 fps.
 */
function buildFrames(): GalleryFrame[] {
  const b = showBuilder({
    id: 'gallery-scenes-fixture',
    title: 'Gallery Scenes Fixture',
    seed: 21,
    site: fixtureSite(),
    catalog,
  })
    .score(score)
    .preRoll(6)
  b.pyro.volley({
    effects: ['peony-75-red', 'peony-100-white'],
    positions: ['rack-3', 'rack-6'],
    land: m.barBeat(12, 1),
  })
  b.drones.formation({
    id: 'hero-ring',
    effect: 'ring-formation-60',
    position: 'pad-1',
    by: m.barBeat(12, 1),
    holdSec: 8,
    params: { count: 40, scaleM: 24 },
  })
  b.crowd.flood({
    effect: 'crowd-flood-rgb',
    position: 'mast-west',
    from: m.barBeat(12, 1),
    rgb: [1, 0.35, 0.2],
    intensity: 0.8,
  })
  b.beams.whisper({
    effect: 'beam-whisper-narration',
    position: 'beam-south-west',
    target: 267,
    land: m.barBeat(12, 1),
  })
  const { compiled } = b.build()
  const t0 = Math.min(...compiled.cues.map((c) => c.targetSec))
  return sampleFrames(compiled, { fromSec: t0 - 1, toSec: t0 + 5, fps: 4, getEffect })
}

const frames = buildFrames()
const site = fixtureSite()
const grid = crowdGridFor(site)!
/** 25 frames at 4 fps loop cleanly on 25/4 s. */
const LOOP_SEC = frames.length / 4
/** One second after the shared landing: stars lit, ring formed, beam landed. */
const STILL_IDX = 8

const BURSTS: readonly SkyBurst[] = [
  { xM: -40, zM: 90, radiusM: 35, beginSec: 1, durSec: 1.5, colors: ['#ff9d4d', '#ffd24d'], seed: 7 },
  { xM: 50, zM: 110, radiusM: 45, beginSec: 3.5, durSec: 1.8, colors: ['#ff5252'], spokes: 10, seed: 8 },
]

describe('gallery/sky', () => {
  it('fixture window has stars, drones, crowd cells, and a beam', () => {
    expect(frames).toHaveLength(25)
    const still = frames[STILL_IDX]!
    expect(still.stars.count).toBeGreaterThan(0)
    expect(still.drones.count).toBe(200) // whole pad-1 fleet; 40 of them fly
    expect(still.crowd.cellCount).toBe(342)
    expect(still.beams.length).toBeGreaterThan(0)
  })

  it('skySceneSvg: balanced still with stars, drones, lawn band, beam footprint', () => {
    const svg = skySceneSvg(frames[STILL_IDX]!, site)
    assertBalancedSvg(svg)
    // 40 drones + stars + crowd band; the band bg uses the panel color.
    expect((svg.match(/<circle /g) ?? []).length).toBeGreaterThan(40)
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThan(342)
    expect(svg).toContain('rgba(5,8,22,0.92)')
    expect(svg).toContain('<ellipse ')
    expect(svg).toContain('r="2"')
    expect(svg).not.toContain('currentColor')
  })

  it('skyLoopSvg: per-drone translates, burst begins, beam animates, <= 400 KB', () => {
    const svg = skyLoopSvg(frames, site, { loopDurSec: LOOP_SEC, bursts: BURSTS })
    assertBalancedSvg(svg)
    // One translate per drone that actually moves in the window (the 40
    // formation flyers plus staging shuffles) -- never more than the fleet.
    const translates = (svg.match(/type="translate"/g) ?? []).length
    expect(translates).toBeGreaterThanOrEqual(40)
    expect(translates).toBeLessThanOrEqual(200)
    // Burst glyphs repeat on the loop from their begin offsets.
    expect(svg).toContain('begin="1s"')
    expect(svg).toContain('begin="3.5s"')
    expect(svg).toContain('type="scale"')
    // Beam footprint ellipse animates cx/rx and steps opacity at landing.
    expect(svg).toContain('attributeName="cx"')
    expect(svg).toContain('attributeName="rx"')
    expect(svg).toContain('calcMode="discrete"')
    expect(svg).toContain('repeatCount="indefinite"')
    expect(svg.length).toBeLessThanOrEqual(400 * 1024)
    expect(svg).not.toContain('currentColor')
  })

  it('sky builders are byte-identical across independent sim runs', () => {
    const frames2 = buildFrames()
    const site2 = fixtureSite()
    expect(skySceneSvg(frames2[STILL_IDX]!, site2)).toBe(skySceneSvg(frames[STILL_IDX]!, site))
    expect(skyLoopSvg(frames2, site2, { loopDurSec: LOOP_SEC, bursts: BURSTS })).toBe(
      skyLoopSvg(frames, site, { loopDurSec: LOOP_SEC, bursts: BURSTS }),
    )
    expect(crowdLoopSvg(frames2, { cols: grid.cols, rows: grid.rows }, { loopDurSec: LOOP_SEC })).toBe(
      crowdLoopSvg(frames, { cols: grid.cols, rows: grid.rows }, { loopDurSec: LOOP_SEC }),
    )
  })
})

// ---------------------------------------------------------------------------
// Crowd
// ---------------------------------------------------------------------------

describe('gallery/crowd', () => {
  it('crowdLoopSvg: one rect per cell, animates only where colors change', () => {
    const svg = crowdLoopSvg(frames, { cols: grid.cols, rows: grid.rows }, { loopDurSec: LOOP_SEC })
    assertBalancedSvg(svg)
    expect(svg).toContain('calcMode="discrete"')
    // Recompute the expected animate set straight from the frames.
    let changing = 0
    let neverLit = 0
    for (let i = 0; i < frames[0]!.crowd.cellCount; i++) {
      const hexes = frames.map((f) => crowdCellHex(f, i))
      if (hexes.some((x) => x !== hexes[0])) changing++
      else if (hexes[0] === '#000000') neverLit++
    }
    expect(changing).toBeGreaterThan(0)
    expect(neverLit).toBeGreaterThan(0) // east lawn sits outside the single mast
    expect((svg.match(/<animate /g) ?? []).length).toBe(changing)
    // 342 cells + the galleryDoc page background.
    expect((svg.match(/<rect /g) ?? []).length).toBe(342 + 1)
    expect(svg).not.toContain('currentColor')
  })

  it('crowdRampSvg: begin offsets via fmtSmilSec, ruler labels, <= 120 KB', () => {
    const cells = Array.from({ length: 40 }, (_, i) => ({
      col: i % grid.cols,
      row: Math.floor(i / grid.cols),
      delaySec: 0.05 * (i + 1),
    }))
    const build = (): string =>
      crowdRampSvg(cells, { cols: grid.cols, rows: grid.rows }, { fireToLandSec: 2.5, loopDurSec: 6 })
    const svg = build()
    assertBalancedSvg(svg)
    // 0.05 * 7 carries float noise; fmtSmilSec pins it to two decimals.
    expect(svg).toContain('begin="0.35s"')
    expect(svg).toContain('begin="0.3s"')
    expect(svg).toContain('begin="2s"')
    expect(svg).not.toContain('0.35000')
    expect(svg).toContain('>fire</text>')
    expect(svg).toContain('>land (beat)</text>')
    expect((svg.match(/<animate /g) ?? []).length).toBe(40)
    expect(svg.length).toBeLessThanOrEqual(120 * 1024)
    expect(svg).not.toContain('currentColor')
    expect(build()).toBe(svg)
  })
})
