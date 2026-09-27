/**
 * Gallery coverage for searchlight heads: the sky still and loop draw one
 * beam stroke per lit head from engine-sampled frames. House golden style:
 * substring assertions, balanced tags, two-run byte equality, size ceilings,
 * never currentColor.
 */
import { describe, expect, it } from 'vitest'
import { starterCatalog } from '../src/catalog/index.js'
import { sampleFrames } from '../src/gallery/sample.js'
import { skyLoopSvg, skySceneSvg } from '../src/gallery/sky.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import type { BuildResult } from '../src/show/index.js'
import { assertBalancedSvg } from './fab-fixture.js'

const catalog = starterCatalog()
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)

/** A fan on the west bank (gold/orange heads) and a sweep on the east bank. */
function build(): BuildResult {
  const b = showBuilder({ id: 'gallery-lights', title: 'Gallery Lights', seed: 9, site: lakesidePark(), catalog })
    .music(tl)
    .preRoll(6)
  b.lights.figure({ id: 'fan', effect: 'light-fan-gold', position: 'lights-west', land: m.barBeat(3, 1) })
  b.lights.sweep({ id: 'sweep', effect: 'light-sweep-slow', position: 'lights-east', land: m.barBeat(3, 1), sweepDeg: 30, periodBeats: 8 })
  return b.build()
}

describe('skySceneSvg with searchlights', () => {
  const { compiled } = build()
  const frame = sampleFrames(compiled, { fromSec: 8, toSec: 8, fps: 4 })[0]!
  const svg = skySceneSvg(frame, compiled.show.site, { title: 'lights still' })

  it('samples eight lit heads and draws one stroke per head in its lamp color', () => {
    expect(frame.lights).toHaveLength(8)
    // light-fan-gold cycles #ffd27a / #ffb84d over the west heads; the sweep is #dfe6f0.
    expect(svg.match(/stroke="#ffd27a"/g)).toHaveLength(2)
    expect(svg.match(/stroke="#ffb84d"/g)).toHaveLength(2)
    expect(svg.match(/stroke="#dfe6f0"/g)).toHaveLength(4)
    expect(svg).toContain('searchlight beams')
  })

  it('is structurally sound, deterministic, and never leans on currentColor', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
    expect(svg.startsWith('<svg')).toBe(true)
    const again = skySceneSvg(sampleFrames(build().compiled, { fromSec: 8, toSec: 8, fps: 4 })[0]!, lakesidePark(), { title: 'lights still' })
    expect(again).toBe(svg)
    expect(svg.length).toBeLessThan(90_000)
  })

  it('a frame before the heads depart draws no beam strokes', () => {
    const dark = sampleFrames(compiled, { fromSec: 2, toSec: 2, fps: 4 })[0]!
    expect(dark.lights).toEqual([])
    const darkSvg = skySceneSvg(dark, compiled.show.site)
    expect(darkSvg).not.toContain('stroke="#ffd27a"')
  })
})

describe('skyLoopSvg with searchlights', () => {
  const { compiled } = build()
  const frames = sampleFrames(compiled, { fromSec: 3, toSec: 11, fps: 4 })
  const svg = skyLoopSvg(frames, compiled.show.site, { loopDurSec: 8, title: 'lights loop' })

  it('animates one line per (cue, head) with x2/y2 and opacity tracks', () => {
    // Eight heads, each with x2, y2, opacity animates.
    expect(svg.match(/attributeName="x2"/g)!.length).toBeGreaterThanOrEqual(8)
    expect(svg.match(/attributeName="y2"/g)!.length).toBeGreaterThanOrEqual(8)
    expect(svg).toContain('repeatCount="indefinite"')
    expect(svg).toContain('searchlights')
    // The sweep moves: its x2 track is not constant.
    const x2Tracks = [...svg.matchAll(/attributeName="x2" values="([^"]+)"/g)].map((mm) => mm[1]!)
    expect(x2Tracks.some((v) => new Set(v.split(';')).size > 1)).toBe(true)
  })

  it('is balanced, byte-identical across runs, and within the animated size budget', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
    const again = skyLoopSvg(sampleFrames(build().compiled, { fromSec: 3, toSec: 11, fps: 4 }), lakesidePark(), { loopDurSec: 8, title: 'lights loop' })
    expect(again).toBe(svg)
    expect(svg.length).toBeLessThan(600_000)
  })
})
