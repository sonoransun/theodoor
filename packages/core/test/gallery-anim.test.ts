import { describe, expect, it } from 'vitest'
import {
  animate,
  animateTransform,
  fmtKeyTime,
  fmtSmilSec,
  holdLoopKeyTimes,
  translateValues,
} from '../src/gallery/anim.js'
import { GALLERY_PROVENANCE, galleryDoc, label, nightBackdrop, skyProject } from '../src/gallery/scene.js'
import { GALLERY_THEME, laneColorFor } from '../src/gallery/theme.js'
import { rgbToHex } from '../src/math/color.js'
import { sampleFrames } from '../src/gallery/sample.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { assertBalancedSvg } from './fab-fixture.js'

describe('rgbToHex', () => {
  it('quantizes 0..1 channels stably and clamps', () => {
    expect(rgbToHex(1, 0, 0)).toBe('#ff0000')
    expect(rgbToHex(0, 0.5, 1)).toBe('#0080ff')
    expect(rgbToHex(-0.5, 2, 0)).toBe('#00ff00')
    expect(rgbToHex(0.501, 0.501, 0.501)).toBe(rgbToHex(0.501, 0.501, 0.501))
  })
})

describe('SMIL time formatting', () => {
  it('fmtSmilSec rounds to 0.01 and never emits -0', () => {
    expect(fmtSmilSec(12)).toBe('12')
    expect(fmtSmilSec(12.5)).toBe('12.5')
    expect(fmtSmilSec(12.345)).toBe('12.35')
    expect(fmtSmilSec(-0.001)).toBe('0')
  })

  it('fmtKeyTime pins exact endpoints and trims to 4 dp', () => {
    expect(fmtKeyTime(0)).toBe('0')
    expect(fmtKeyTime(1)).toBe('1')
    expect(fmtKeyTime(1.0001)).toBe('1')
    expect(fmtKeyTime(0.123456)).toBe('0.1235')
  })
})

describe('animate / animateTransform', () => {
  it('emits values, dur, and an indefinite loop by default', () => {
    const a = animate('opacity', { values: ['0', '1'], durSec: 2 })
    expect(a).toContain('attributeName="opacity"')
    expect(a).toContain('values="0;1"')
    expect(a).toContain('dur="2s"')
    expect(a).toContain('repeatCount="indefinite"')
    expect(a).not.toContain('begin=')
    expect(a).not.toContain('keyTimes=')
  })

  it('joins keyTimes with formatted endpoints and honors discrete/begin', () => {
    const a = animate('fill', {
      values: ['#000000', '#ffffff', '#ffffff'],
      durSec: 4,
      keyTimes: [0, 0.5, 1],
      calcMode: 'discrete',
      beginSec: 1.25,
      repeat: 3,
    })
    expect(a).toContain('keyTimes="0;0.5;1"')
    expect(a).toContain('calcMode="discrete"')
    expect(a).toContain('begin="1.25s"')
    expect(a).toContain('repeatCount="3"')
  })

  it('animateTransform carries the transform attribute and type', () => {
    const a = animateTransform('translate', { values: translateValues([{ x: 1.23, y: 4.56 }, { x: 2, y: 4 }]), durSec: 1 })
    expect(a).toContain('attributeName="transform"')
    expect(a).toContain('type="translate"')
    expect(a).toContain('values="1.2 4.6;2 4"')
  })

  it('rejects malformed keyTimes deterministically', () => {
    expect(() => animate('x', { values: ['0', '1'], durSec: 1, keyTimes: [0] })).toThrow(/length/)
    expect(() => animate('x', { values: ['0', '1'], durSec: 1, keyTimes: [0.1, 1] })).toThrow(/start at 0/)
    expect(() => animate('x', { values: ['0', '1', '2'].map(String), durSec: 1, keyTimes: [0, 0.9, 0.5] })).toThrow(/non-decreasing/)
    expect(() => animate('x', { values: [], durSec: 1 })).toThrow(/non-empty/)
  })
})

describe('holdLoopKeyTimes', () => {
  it('spreads n−1 frames over 1−holdFrac and pins the duplicate to 1', () => {
    const kt = holdLoopKeyTimes(4, 0.1)
    expect(kt).toHaveLength(4)
    expect(kt[0]).toBe(0)
    expect(kt[2]).toBeCloseTo(0.9, 9)
    expect(kt[3]).toBe(1)
    expect(() => holdLoopKeyTimes(1, 0.1)).toThrow()
    expect(() => holdLoopKeyTimes(4, 0)).toThrow()
  })
})

describe('galleryDoc / scene scaffolding', () => {
  it('builds a balanced, titled, provenance-stamped document with an opaque page', () => {
    const svg = galleryDoc(400, 200, { title: 'Test Card', desc: 'a test' }, [
      nightBackdrop(0, 0, 400, 150),
      label(10, 20, 'hello <world>'),
    ])
    assertBalancedSvg(svg)
    expect(svg).toContain('<title>Test Card</title>')
    expect(svg).toContain('<desc>a test</desc>')
    expect(svg).toContain(GALLERY_PROVENANCE)
    expect(svg).toContain(`fill="${GALLERY_THEME.pageBg}"`)
    expect(svg).toContain('viewBox="0 0 400 200"')
    expect(svg).toContain('hello &lt;world&gt;')
    expect(svg).not.toContain('currentColor')
    expect(svg).toBe(galleryDoc(400, 200, { title: 'Test Card', desc: 'a test' }, [
      nightBackdrop(0, 0, 400, 150),
      label(10, 20, 'hello <world>'),
    ]))
  })

  it('skyProject maps world x/z into panel pixels with the ground pinned', () => {
    const p = skyProject(800, 300, 200, 150, 20)
    expect(p.toX(0)).toBe(400)
    expect(p.toX(-200)).toBe(0)
    expect(p.toY(0)).toBe(300)
    expect(p.toY(150)).toBe(20)
  })

  it('laneColorFor covers every medium with fabrication on the pyro lane', () => {
    expect(laneColorFor('fabrication')).toBe(GALLERY_THEME.lanes.pyro)
    expect(laneColorFor('beam')).toBe(GALLERY_THEME.lanes.beams)
    expect(laneColorFor('crowd')).toBe(GALLERY_THEME.lanes.crowd)
  })
})

describe('sampleFrames', () => {
  const catalog = starterCatalog()

  function smallShow() {
    const score = getScore('odeToJoy')!
    const tl = buildTimelineFromScore(score)
    const m = musicRefs(tl)
    const b = showBuilder({ id: 'gal-fix', title: 'Gallery Fixture', seed: 5, site: lakesidePark(), catalog })
      .score(score)
      .preRoll(2)
    b.drones.formation({ effect: 'ring-formation-60', position: 'pad-1', by: m.barBeat(3, 1), params: { count: 24 }, holdSec: 20 })
    b.crowd.flood({ effect: 'crowd-flood-rgb', position: 'mast-west', from: m.barBeat(3, 1), rgb: [1, 0, 0] })
    return b.build().compiled
  }

  it('returns owned copies on the requested grid, deterministically', () => {
    const compiled = smallShow()
    const frames = sampleFrames(compiled, { fromSec: 4, toSec: 8, fps: 4, getEffect: getEffectFrom(catalog) })
    expect(frames).toHaveLength(17)
    expect(frames[0]!.t).toBe(4)
    expect(frames.at(-1)!.t).toBe(8)
    // Frames own their buffers: mutating one does not perturb a re-sample.
    frames[3]!.drones.pos.fill(0)
    const again = sampleFrames(compiled, { fromSec: 4, toSec: 8, fps: 4, getEffect: getEffectFrom(catalog) })
    expect(again[3]!.drones.pos.some((v) => v !== 0)).toBe(true)
    expect(again[5]!.crowd.cellCount).toBeGreaterThan(300)
    expect(() => sampleFrames(compiled, { fromSec: 2, toSec: 1, fps: 4 })).toThrow()
  })
})
