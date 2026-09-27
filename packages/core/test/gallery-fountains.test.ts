/**
 * gallery-fountains.test.ts — water columns in the sky scene builders: one
 * lit <line> per column with water in the still, one animated line per
 * (cue, nozzle) in the loop; balanced, deterministic, never currentColor.
 */
import { describe, expect, it } from 'vitest'
import type { BuildResult } from '../src/contracts.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { sampleFrames } from '../src/gallery/sample.js'
import { skyLoopSvg, skySceneSvg } from '../src/gallery/sky.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { assertBalancedSvg } from './fab-fixture.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)

function buildShow(): BuildResult {
  const tl = buildTimelineFromScore(getScore('odeToJoy')!)
  const m = musicRefs(tl)
  const b = showBuilder({ id: 'gallery-fountains', title: 'Gallery Fountains', seed: 9, site: lakesidePark(), catalog })
    .music(tl)
    .preRoll(6)
  b.fountains.jet({ id: 'plume', effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(3, 1) }) // 4 s
  b.fountains.cascade({ id: 'casc', effect: 'fountain-cascade-25m', position: 'fount-east', crest: m.barBeat(7, 1) }) // 12 s
  return b.build()
}

const built = buildShow()
const site = built.show.site
const plume = built.compiled.cues.find((c) => c.id === 'plume')!
const casc = built.compiled.cues.find((c) => c.id === 'casc')!

const countOf = (svg: string, needle: string): number => svg.split(needle).length - 1

describe('skySceneSvg with fountains', () => {
  const frame = sampleFrames(built.compiled, { fromSec: plume.targetSec, toSec: plume.targetSec, fps: 4, getEffect })[0]!
  const svg = skySceneSvg(frame, site, { title: 'plume crest' })

  it('owns its jets and draws one line per column with water plus the ground line', () => {
    expect(frame.jets).toHaveLength(3)
    expect(frame.lights).toHaveLength(0)
    expect(countOf(svg, '<line ')).toBe(1 + 3)
    expect(svg).toContain('stroke="#7fd4ff"')
    expect(svg).toContain('stroke="#ffffff"')
    expect(svg).toContain('stroke-opacity="0.9"') // crested columns
  })

  it('is balanced, deterministic, and never leans on currentColor', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
    const again = skySceneSvg(
      sampleFrames(buildShow().compiled, { fromSec: plume.targetSec, toSec: plume.targetSec, fps: 4, getEffect })[0]!,
      lakesidePark(),
      { title: 'plume crest' },
    )
    expect(again).toBe(svg)
    expect(svg.length).toBeLessThan(60_000)
  })

  it('a dry instant draws no water', () => {
    const dry = sampleFrames(built.compiled, { fromSec: 1, toSec: 1, fps: 4, getEffect })[0]!
    expect(dry.jets).toHaveLength(0)
    expect(countOf(skySceneSvg(dry, site), '<line ')).toBe(1)
  })

  it('a rising column draws dimmer than a crested one', () => {
    const rising = sampleFrames(built.compiled, { fromSec: plume.targetSec - 1, toSec: plume.targetSec - 1, fps: 4, getEffect })[0]!
    expect(rising.jets.every((j) => !j.crested && j.heightM > 0)).toBe(true)
    const svgR = skySceneSvg(rising, site)
    expect(countOf(svgR, 'stroke-opacity="0.6"')).toBe(3)
  })
})

describe('skyLoopSvg with a cascade', () => {
  // House style: sample on the 120 Hz step grid (fps 4 divides 120) from a
  // grid-aligned start after the plume has dried (10 s), through the last
  // cascade column's fall (its crest + 8 s ≈ 22 s).
  const fromSec = 10.5
  const toSec = 22.5
  const frames = sampleFrames(built.compiled, { fromSec, toSec, fps: 4, getEffect })
  const svg = skyLoopSvg(frames, site, { loopDurSec: toSec - fromSec, title: 'cascade loop' })

  it('animates one line per (cue, nozzle) that ever carries water — the whole nine-nozzle row', () => {
    const keys = new Set<string>()
    for (const f of frames) for (const j of f.jets) keys.add(`${j.cueIdx}:${j.nozzle}`)
    expect(keys.size).toBe(9)
    expect([...keys].every((k) => k.startsWith(`${built.compiled.cues.indexOf(casc)}:`))).toBe(true)
    expect(countOf(svg, 'attributeName="y2"')).toBe(keys.size)
    expect(countOf(svg, 'attributeName="x2"')).toBe(keys.size)
    expect(svg).toContain('repeatCount="indefinite"')
  })

  it('is balanced, deterministic, and never leans on currentColor', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
    const again = skyLoopSvg(
      sampleFrames(buildShow().compiled, { fromSec, toSec, fps: 4, getEffect }),
      lakesidePark(),
      { loopDurSec: toSec - fromSec, title: 'cascade loop' },
    )
    expect(again).toBe(svg)
    expect(svg.length).toBeLessThan(200_000)
  })

  it('sampled frames land on exact 120 Hz steps and copy their jets', () => {
    for (const f of frames) expect(Math.abs(f.t * 120 - Math.round(f.t * 120))).toBeLessThan(1e-6)
    const withWater = frames.filter((f) => f.jets.length > 0)
    expect(withWater.length).toBeGreaterThan(10)
    expect(Array.isArray(withWater[0]!.jets)).toBe(true)
  })
})
