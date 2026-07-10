import { describe, expect, it } from 'vitest'
import type { CompiledShow, SitePlan } from '../src/contracts.js'
import { bomMarkdown, buildBom } from '../src/fab/bom.js'
import { getEffect, makeCompiled, makeSite } from './fab-fixture.js'

describe('fab/bom buildBom', () => {
  const site = makeSite()
  const compiled = makeCompiled(site)
  const bom = buildBom(compiled, site, getEffect)

  it('aggregates racks by identical design', () => {
    expect(bom.racks).toEqual([{ slots: 20, calibersMm: [75, 100], count: 1 }])
  })

  it('totals mortar tubes per caliber', () => {
    expect(bom.mortarTubesByCaliber).toEqual({ 75: 12, 100: 8 })
  })

  it('counts one igniter per pyro cue', () => {
    expect(bom.igniters).toBe(20)
  })

  it('groups identical panels', () => {
    expect(bom.panels).toEqual([{ wPx: 32, hPx: 16, count: 2 }])
  })

  it('provisions drone spares: ceil(200 * 1.15) = 230', () => {
    expect(bom.drones).toEqual({ flying: 200, sparesPct: 15, total: 230 })
  })

  it('counts laser towers and fabrication set pieces', () => {
    expect(bom.lasers).toBe(2)
    expect(bom.fabricationPieces).toEqual([{ kind: 'waterfall', count: 2 }])
  })

  it('handles an empty show/site', () => {
    const emptySite: SitePlan = { ...site, assets: [] }
    const emptyCompiled: CompiledShow = {
      show: { ...compiled.show, site: emptySite },
      cues: [],
      diagnostics: [],
    }
    const empty = buildBom(emptyCompiled, emptySite, getEffect)
    expect(empty.racks).toEqual([])
    expect(empty.mortarTubesByCaliber).toEqual({})
    expect(empty.igniters).toBe(0)
    expect(empty.panels).toEqual([])
    expect(empty.drones).toEqual({ flying: 0, sparesPct: 15, total: 0 })
    expect(empty.lasers).toBe(0)
    expect(empty.fabricationPieces).toEqual([])
  })

  it('is deterministic (two runs deep-equal and markdown byte-identical)', () => {
    const again = buildBom(makeCompiled(makeSite()), makeSite(), getEffect)
    expect(again).toEqual(bom)
    expect(bomMarkdown(again)).toBe(bomMarkdown(bom))
  })
})

describe('fab/bom bomMarkdown', () => {
  const site = makeSite()
  const bom = buildBom(makeCompiled(site), site, getEffect)
  const md = bomMarkdown(bom)

  it('renders a single markdown table with all line items', () => {
    const lines = md.trimEnd().split('\n')
    expect(lines[0]).toBe('| item | spec | qty |')
    expect(lines[1]).toBe('| --- | --- | ---: |')
    expect(md).toContain('| mortar rack | 20 slots (75, 100 mm) | 1 |')
    expect(md).toContain('| mortar tube | 75 mm caliber, single-shot | 12 |')
    expect(md).toContain('| mortar tube | 100 mm caliber, single-shot | 8 |')
    expect(md).toContain('| igniter | one per pyro cue | 20 |')
    expect(md).toContain('| pixel panel | 32x16 px | 2 |')
    expect(md).toContain('| drone | 200 flying + 15% spares | 230 |')
    expect(md).toContain('| laser projector | one per tower | 2 |')
    expect(md).toContain('| set piece | waterfall | 2 |')
    // every body row has exactly 3 cells
    for (const row of lines.slice(2)) {
      expect(row.split(' | ')).toHaveLength(3)
    }
  })
})
