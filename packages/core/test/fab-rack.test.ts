import { describe, expect, it } from 'vitest'
import type { SitePlan } from '../src/contracts.js'
import { rackPlan, rackSvg, tubeLayout } from '../src/fab/mortarRack.js'
import { assertBalancedSvg, getEffect, makeCompiled, makeSite } from './fab-fixture.js'

describe('fab/mortarRack tubeLayout', () => {
  it('packs rows of min(10, ceil(sqrt(n)))', () => {
    expect(tubeLayout(1)).toEqual({ cols: 1, rows: 1 })
    expect(tubeLayout(8)).toEqual({ cols: 3, rows: 3 })
    expect(tubeLayout(12)).toEqual({ cols: 4, rows: 3 })
    expect(tubeLayout(100)).toEqual({ cols: 10, rows: 10 })
    expect(tubeLayout(101)).toEqual({ cols: 10, rows: 11 })
    expect(tubeLayout(200)).toEqual({ cols: 10, rows: 20 })
    expect(tubeLayout(0)).toEqual({ cols: 0, rows: 0 })
  })
})

describe('fab/mortarRack rackPlan (20-cue two-caliber fixture)', () => {
  const site = makeSite()
  const compiled = makeCompiled(site)
  const plans = rackPlan(compiled, site, getEffect)

  it('plans one rack with one tube per pyro cue, grouped by caliber', () => {
    expect(plans).toHaveLength(1)
    const plan = plans[0]!
    expect(plan.assetId).toBe('rackA')
    expect(plan.tubeCount).toBe(20)
    expect(plan.slots).toHaveLength(20)
    expect(plan.groups.map((g) => g.caliberMm)).toEqual([75, 100])
    expect(plan.groups.map((g) => g.tubeCount)).toEqual([12, 8])
  })

  it('derives bore, pitch, and row packing per caliber group', () => {
    const [g75, g100] = plans[0]!.groups
    expect(g75!.boreMm).toBe(80) // 75 + 5 clearance
    expect(g75!.pitchMm).toBeCloseTo(128, 6) // 80 * 1.6
    expect(g75!.cols).toBe(4) // ceil(sqrt(12)) = 4
    expect(g75!.rows).toBe(3)
    expect(g100!.boreMm).toBe(105)
    expect(g100!.pitchMm).toBeCloseTo(168, 6)
    expect(g100!.cols).toBe(3)
    expect(g100!.rows).toBe(3)
  })

  it('derives outer dimensions with 40 mm margins', () => {
    const plan = plans[0]!
    expect(plan.marginMm).toBe(40)
    // length = 2*40 + max(4*128, 3*168) = 80 + 512
    expect(plan.lengthMm).toBeCloseTo(592, 6)
    // width = 2*40 + 3*128 + 3*168
    expect(plan.widthMm).toBeCloseTo(968, 6)
    const [g75, g100] = plan.groups
    expect(g75!.yOffsetMm).toBeCloseTo(40, 6)
    expect(g100!.yOffsetMm).toBeCloseTo(40 + 3 * 128, 6)
  })

  it('positions tube centers on the pitch grid', () => {
    const plan = plans[0]!
    const first = plan.slots[0]!
    expect(first.cxMm).toBeCloseTo(40 + 64, 6)
    expect(first.cyMm).toBeCloseTo(40 + 64, 6)
    const sixth = plan.slots[5]! // index 5 in a 4-wide group: row 1, col 1
    expect(sixth.row).toBe(1)
    expect(sixth.col).toBe(1)
    expect(sixth.cxMm).toBeCloseTo(40 + 1.5 * 128, 6)
    expect(sixth.cyMm).toBeCloseTo(40 + 1.5 * 128, 6)
    // firing order preserved within a group
    expect(plan.groups[0]!.cueIds[0]).toBe('c75-0')
    expect(plan.groups[1]!.cueIds[7]).toBe('c100-7')
  })

  it('plans an empty rack for a mortarRack asset with no cues', () => {
    const rackB: SitePlan['assets'][number] = {
      id: 'rackB',
      kind: 'mortarRack',
      pos: { x: 5, y: 0 },
      headingDeg: 0,
      elevationM: 0,
      rack: { calibersMm: [75], tiltDeg: 0, pinsPerModule: 32, maxSimultaneousPins: 8 },
    }
    const site2: SitePlan = { ...site, assets: [...site.assets, rackB] }
    const plans2 = rackPlan(compiled, site2, getEffect)
    expect(plans2).toHaveLength(2)
    const empty = plans2[1]!
    expect(empty.tubeCount).toBe(0)
    expect(empty.lengthMm).toBe(80)
    expect(empty.widthMm).toBe(80)
  })
})

describe('fab/mortarRack rackSvg', () => {
  const site = makeSite()
  const compiled = makeCompiled(site)
  const plan = rackPlan(compiled, site, getEffect)[0]!
  const svg = rackSvg(plan)

  it('is structurally sound (balanced tags)', () => {
    assertBalancedSvg(svg)
  })

  it('draws one circle per tube', () => {
    expect(svg.match(/<circle /g)).toHaveLength(20)
  })

  it('labels caliber groups and dimensions', () => {
    expect(svg).toContain('75mm x 12')
    expect(svg).toContain('100mm x 8')
    expect(svg).toContain('>592 mm</text>')
    expect(svg).toContain('>968 mm</text>')
    expect(svg).toContain('>pitch 128 mm</text>')
    expect(svg).toContain('rack rackA (top view)')
  })

  it('is deterministic (two runs byte-identical)', () => {
    const again = rackSvg(rackPlan(makeCompiled(makeSite()), makeSite(), getEffect)[0]!)
    expect(again).toBe(svg)
  })
})
