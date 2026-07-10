import { describe, expect, it } from 'vitest'
import type { PositionedAsset } from '../src/contracts.js'
import { panelFrameSvg } from '../src/fab/panelFrame.js'
import { assertBalancedSvg, makeSite } from './fab-fixture.js'

const panelAsset = (): PositionedAsset =>
  makeSite().assets.find((a) => a.kind === 'panel')!

describe('fab/panelFrame', () => {
  const svg = panelFrameSvg(panelAsset())

  it('is structurally sound (balanced tags)', () => {
    assertBalancedSvg(svg)
  })

  it('sizes the outer frame as wPx*pitch + 2*60 mm', () => {
    // 32*10 + 120 = 440, 16*10 + 120 = 280
    expect(svg).toContain('>440 mm</text>')
    expect(svg).toContain('>280 mm</text>')
    expect(svg).toContain('>pitch 10 mm</text>')
    expect(svg).toContain('width="470mm"') // document = frame + dim room
    expect(svg).toContain('height="310mm"')
  })

  it('drills 8 mounting holes: 4 corners + 4 mid-spans, 8 mm diameter', () => {
    const holes = svg.match(/<circle [^>]*class="mount-hole"/g) ?? []
    expect(holes).toHaveLength(8)
    expect(svg.match(/r="4"/g)).toHaveLength(8)
    // corner + mid-span sample coordinates (30 mm inset)
    expect(svg).toContain('cx="30" cy="30"')
    expect(svg).toContain('cx="410" cy="250"')
    expect(svg).toContain('cx="220" cy="30"')
    expect(svg).toContain('cx="30" cy="140"')
  })

  it('draws interior grid lines with majors every 8 px', () => {
    // 31 vertical + 15 horizontal interior grid lines + 3 dimension lines
    expect(svg.match(/<line /g)).toHaveLength(49)
    // majors: vertical at 8/16/24, horizontal at 8 (heavier stroke)
    expect(svg.match(/stroke-width="0\.6"/g)).toHaveLength(4)
  })

  it('throws on an asset without a PanelSpec', () => {
    const rack = makeSite().assets.find((a) => a.kind === 'mortarRack')!
    expect(() => panelFrameSvg(rack)).toThrow(/PanelSpec/)
  })

  it('is deterministic (two runs byte-identical)', () => {
    expect(panelFrameSvg(panelAsset())).toBe(svg)
  })
})
