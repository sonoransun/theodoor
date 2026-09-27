/**
 * gallery-physics.test.ts — the fountain-rise and searchlight-slew explainer
 * charts. House golden style: substring assertions, balanced tags, two-run
 * byte equality, size ceilings, never currentColor.
 */
import { describe, expect, it } from 'vitest'
import type { FountainBankSpec, FountainEffect, SearchlightBankSpec } from '../src/contracts.js'
import { starterCatalog } from '../src/catalog/index.js'
import { fountainRiseSvg, searchlightSlewSvg } from '../src/gallery/physics.js'
import { lakesidePark } from '../src/site/index.js'
import { assertBalancedSvg } from './fab-fixture.js'

const site = lakesidePark()
const bank = site.assets.find((a) => a.id === 'fount-west')!.fountainBank as FountainBankSpec
const lights = site.assets.find((a) => a.id === 'lights-west')!.searchlightBank as SearchlightBankSpec
const shooter = starterCatalog().get('fountain-shooter-45m') as FountainEffect

describe('fountainRiseSvg', () => {
  const svg = fountainRiseSvg(shooter, bank)

  it('is a balanced, currentColor-free gallery document under 40 KB', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.length).toBeLessThan(40_000)
  })

  it('prints the two anticipation terms and the beat rule', () => {
    // 45 m shooter: sqrt(90/9.81) = 3.03 s rise + 0.15 s latency.
    expect(svg).toContain('rise √(2h/g) = 3.03 s')
    expect(svg).toContain('latency 0.15 s')
    expect(svg).toContain('anticipation 3.18 s')
    expect(svg).toContain('the beat (targetSec)')
    expect(svg).toContain('valve opens (fireSec)')
  })

  it('is byte-identical across runs and honors the crest override', () => {
    expect(fountainRiseSvg(shooter, bank)).toBe(svg)
    const low = fountainRiseSvg(shooter, bank, { crestM: 20 })
    expect(low).not.toBe(svg)
    expect(low).toContain('20 m')
  })
})

describe('searchlightSlewSvg', () => {
  const svg = searchlightSlewSvg(lights)

  it('is a balanced, currentColor-free gallery document', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
    expect(svg.length).toBeLessThan(40_000)
  })

  it('shows both slews with the bank rate and the chain margin', () => {
    // 30° from park at 60°/s × 1.1 = 0.55 s; 70° between figures = 1.28 s.
    expect(svg).toContain('slew 30° / 60°·s⁻¹ × 1.1 = 0.55 s')
    expect(svg).toContain('slew 70° / 60°·s⁻¹ × 1.1 = 1.28 s')
    expect(svg).toContain('max tilt 75°')
    expect(svg).toContain('beat 1')
    expect(svg).toContain('beat 2')
    expect(svg).toContain('departs the previous aim, not park')
  })

  it('is byte-identical across runs', () => {
    expect(searchlightSlewSvg(lights)).toBe(svg)
  })
})
