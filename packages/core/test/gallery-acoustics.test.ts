import { describe, expect, it } from 'vitest'
import type { BeamEffect } from '../src/contracts.js'
import { DEFAULT_EXPOSURE_BUDGET, exposureReport } from '../src/acoustics/exposure.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import {
  beamFlyoverSvg,
  beamGeometrySvg,
  exposureHeatmapSvg,
  exposureRampColor,
  splCompareSvg,
} from '../src/gallery/acoustics.js'
import { sampleFrames } from '../src/gallery/sample.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { crowdGridFor, lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { assertBalancedSvg } from './fab-fixture.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const site = lakesidePark()
const grid = crowdGridFor(site)!

function beamShow() {
  const score = getScore('odeToJoy')!
  const tl = buildTimelineFromScore(score)
  const m = musicRefs(tl)
  const near = grid.cells.find((c) => c.row === 8 && c.col === 1)!.index
  const b = showBuilder({ id: 'ga-fix', title: 'Acoustics Fixture', seed: 3, site: lakesidePark(), catalog })
    .score(score)
    .preRoll(2)
  b.beams.whisper({ effect: 'beam-whisper-narration', position: 'beam-south-west', target: near, land: m.barBeat(4, 1) })
  // Path cells ~90–145 m east of beam-delay-west (−75, −225): inside the
  // 16 m tower's ~163 m horizon-bounded throw for a 6° beam, and far enough
  // out that the tilt stays above the −45° floor.
  b.beams.flyover({
    effect: 'beam-flyover-whoosh',
    position: 'beam-delay-west',
    path: [4 * 38 + 20, 4 * 38 + 24, 4 * 38 + 27].map((i) => grid.cells[i]!.index),
    land: m.barBeat(12, 1),
  })
  return b.build().compiled
}

describe('exposureRampColor', () => {
  it('is monotone toward the ceiling and red at/above it', () => {
    const b = DEFAULT_EXPOSURE_BUDGET
    expect(exposureRampColor(50, b)).toBe('#0a1230')
    expect(exposureRampColor(b.maxCarrierDb, b)).toBe('#ff5252')
    expect(exposureRampColor(b.maxCarrierDb + 5, b)).toBe('#ff5252')
    expect(exposureRampColor(95, b)).toBe(exposureRampColor(95, b))
  })
})

describe('exposureHeatmapSvg', () => {
  it('renders every cell, the worst-cell outline, and the budget legend', () => {
    const compiled = beamShow()
    const report = exposureReport(compiled, getEffect)
    const svg = exposureHeatmapSvg(report, grid)
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThan(grid.cells.length)
    expect(svg).toContain('pass: true')
    expect(svg).toContain(`${report.peakDb.toFixed(1)} dB`)
    expect(svg).toContain('front')
    expect(svg.length).toBeLessThanOrEqual(90_000)
    expect(svg).toBe(exposureHeatmapSvg(exposureReport(beamShow(), getEffect), grid))
  })
})

describe('splCompareSvg', () => {
  it('draws traces, the dashed budget, and over-budget fills', () => {
    const svg = splCompareSvg(
      [
        {
          label: 'standard',
          color: '#ff9d4d',
          fillOverBudget: true,
          samples: [
            { tSec: 0, dB: 60 },
            { tSec: 10, dB: 92 },
            { tSec: 20, dB: 96 },
            { tSec: 30, dB: 70 },
          ],
        },
        { label: 'quiet', color: '#5ee6d0', samples: [{ tSec: 0, dB: 58 }, { tSec: 30, dB: 74 }] },
      ],
      { budgetDb: 85, ruleAt: { tSec: 20, label: 'midnight' } },
    )
    assertBalancedSvg(svg)
    expect(svg).toContain('85 dB budget')
    expect(svg).toContain('<polygon')
    expect(svg).toContain('midnight')
    expect(svg).toContain('standard')
    expect(svg).toContain('quiet')
    expect(svg).not.toContain('currentColor')
  })
})

describe('beamGeometrySvg', () => {
  it('renders both panels with real footprint numbers', () => {
    const asset = site.assets.find((a) => a.id === 'beam-north-west')!
    const effect = getEffect('beam-whisper-narration') as BeamEffect
    const target = grid.cells.find((c) => c.row === 4 && c.col === 19)!.centroid
    const svg = beamGeometrySvg(asset, effect, target)
    assertBalancedSvg(svg)
    expect(svg).toContain('side view')
    expect(svg).toContain('top view')
    expect(svg).toContain('footprint')
    expect(svg).toContain('outside: −20 dB leakage')
    expect(svg).toContain('head 25 m')
    expect(svg).not.toContain('currentColor')
    expect(svg).toBe(beamGeometrySvg(asset, effect, target))
    // A target with no bounded footprint throws (south array, far cell).
    const south = site.assets.find((a) => a.id === 'beam-south-west')!
    const far = grid.cells.find((c) => c.row === 0 && c.col === 36)!.centroid
    expect(() => beamGeometrySvg(south, effect, far)).toThrow(/bounded/)
  })
})

describe('beamFlyoverSvg', () => {
  it('animates the footprint sweep with a wavefront ring', () => {
    const compiled = beamShow()
    const fly = compiled.cues.find((c) => c.effectId === 'beam-flyover-whoosh')!
    const frames = sampleFrames(compiled, {
      fromSec: fly.fireSec,
      toSec: fly.targetSec + fly.durationSec - 0.25,
      fps: 4,
      getEffect,
    })
    const svg = beamFlyoverSvg(frames, grid, { loopDurSec: 8 })
    assertBalancedSvg(svg)
    expect(svg).toContain('repeatCount="indefinite"')
    expect(svg).toContain('attributeName="cx"')
    expect(svg).toContain('wavefront')
    expect(svg).not.toContain('currentColor')
    expect(svg.length).toBeLessThanOrEqual(120_000)
    expect(svg).toBe(beamFlyoverSvg(frames, grid, { loopDurSec: 8 }))
  })
})
