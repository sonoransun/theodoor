import { describe, expect, it } from 'vitest'
import {
  DIM_ARROW_ID,
  circle,
  dim,
  el,
  escapeAttr,
  escapeText,
  fmtMm,
  group,
  line,
  rect,
  svgDoc,
  text,
} from '../src/fab/svg.js'
import { assertBalancedSvg } from './fab-fixture.js'

describe('fab/svg fmtMm', () => {
  it('rounds to 0.1 mm', () => {
    expect(fmtMm(1.234)).toBe('1.2')
    expect(fmtMm(1.25)).toBe('1.3')
    expect(fmtMm(40)).toBe('40')
    expect(fmtMm(127.96)).toBe('128')
    expect(fmtMm(0.04)).toBe('0')
  })

  it('never emits -0', () => {
    expect(fmtMm(-0.04)).toBe('0')
    expect(fmtMm(-0)).toBe('0')
    expect(fmtMm(-1.26)).toBe('-1.3')
  })
})

describe('fab/svg escaping', () => {
  it('escapes attribute values', () => {
    expect(escapeAttr('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
    const r = rect(0, 0, 1, 1, { 'data-label': '5" <bore> & more' })
    expect(r).toContain('data-label="5&quot; &lt;bore&gt; &amp; more"')
    assertBalancedSvg(svgDoc(10, 10, [r]))
  })

  it('escapes text content', () => {
    expect(escapeText('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d')
    const t = text(0, 0, 'w < 3 & h > 2')
    expect(t).toContain('>w &lt; 3 &amp; h &gt; 2</text>')
  })
})

describe('fab/svg elements', () => {
  it('el self-closes without children and skips undefined attrs', () => {
    expect(el('line', { x1: 0, x2: 5, foo: undefined })).toBe('<line x1="0" x2="5"/>')
    expect(el('g', {}, '<rect/>')).toBe('<g><rect/></g>')
  })

  it('rounds numeric attributes to 0.1 mm', () => {
    const c = circle(1.234, 5.678, 2.55)
    expect(c).toContain('cx="1.2"')
    expect(c).toContain('cy="5.7"')
    expect(c).toContain('r="2.6"')
  })

  it('line/rect/group compose', () => {
    const g = group([line(0, 0, 10, 0), rect(0, 0, 10, 5)], { class: 'frame' })
    expect(g.startsWith('<g class="frame">')).toBe(true)
    expect(g.endsWith('</g>')).toBe(true)
  })
})

describe('fab/svg dim', () => {
  it('draws a marker-tipped line with a centered label', () => {
    const d = dim(0, 100, 200, 100, '200 mm')
    expect(d).toContain(`marker-start="url(#${DIM_ARROW_ID})"`)
    expect(d).toContain(`marker-end="url(#${DIM_ARROW_ID})"`)
    expect(d).toContain('>200 mm</text>')
    expect(d).toContain('text-anchor="middle"')
    // Centered label: x at the midpoint, offset above a left-to-right line.
    expect(d).toContain('x="100"')
    expect(d).toContain('y="97.5"')
  })
})

describe('fab/svg svgDoc', () => {
  it('emits mm units, matching viewBox, and arrow marker defs', () => {
    const doc = svgDoc(300, 200.04, [rect(0, 0, 300, 200)])
    expect(doc).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(doc).toContain('width="300mm"')
    expect(doc).toContain('height="200mm"')
    expect(doc).toContain('viewBox="0 0 300 200"')
    expect(doc).toContain(`<marker id="${DIM_ARROW_ID}"`)
    assertBalancedSvg(doc)
  })

  it('is deterministic', () => {
    const build = () => svgDoc(120, 80, [dim(0, 70, 120, 70, '120 mm'), circle(60, 40, 10)])
    expect(build()).toBe(build())
  })
})
