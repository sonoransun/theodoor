import { describe, expect, it } from 'vitest'
import {
  bloom,
  clockRing,
  digit,
  flag,
  grid,
  heart,
  resampleTo,
  ring,
  scatter,
  star,
  text,
} from '../src/choreo/index.js'
import { textCells } from '../src/text/index.js'
import type { FormationPoint } from '../src/contracts.js'

const RED = [0.7, 0.1, 0.1] as const
const WHITE = [1, 1, 1] as const
const BLUE = [0.1, 0.1, 0.6] as const

function bboxCenter(points: readonly FormationPoint[]): { cx: number; cz: number } {
  const xs = points.map((p) => p.x)
  const zs = points.map((p) => p.z)
  return {
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cz: (Math.min(...zs) + Math.max(...zs)) / 2,
  }
}

describe('grid / ring', () => {
  it('grid has rows*cols points, centered, planar', () => {
    const f = grid(4, 6, 2.5)
    expect(f.points.length).toBe(24)
    const { cx, cz } = bboxCenter(f.points)
    expect(cx).toBeCloseTo(0, 9)
    expect(cz).toBeCloseTo(0, 9)
    for (const p of f.points) expect(p.y).toBe(0)
    // Adjacent columns are one spacing apart.
    expect(f.points[1]!.x - f.points[0]!.x).toBeCloseTo(2.5, 9)
  })

  it('ring points all sit on the radius', () => {
    const f = ring(24, 30)
    expect(f.points.length).toBe(24)
    for (const p of f.points) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(30, 9)
      expect(p.y).toBe(0)
    }
  })
})

describe('star / heart', () => {
  it('star resamples the 10-vertex outline to n points within radii', () => {
    const f = star(50, 40, 16)
    expect(f.points.length).toBe(50)
    for (const p of f.points) {
      const r = Math.hypot(p.x, p.z)
      expect(r).toBeGreaterThanOrEqual(16 - 1e-9)
      expect(r).toBeLessThanOrEqual(40 + 1e-9)
      expect(p.y).toBe(0)
    }
    // Deterministic: identical calls agree exactly.
    expect(star(50, 40, 16).points).toEqual(f.points)
  })

  it('heart has n points, is bbox-centered and x-symmetric', () => {
    const f = heart(80, 1.5)
    expect(f.points.length).toBe(80)
    const { cx, cz } = bboxCenter(f.points)
    expect(cx).toBeCloseTo(0, 6)
    expect(cz).toBeCloseTo(0, 6)
    const maxX = Math.max(...f.points.map((p) => p.x))
    const minX = Math.min(...f.points.map((p) => p.x))
    expect(maxX).toBeCloseTo(-minX, 6)
  })
})

describe('flag', () => {
  it('rows carry band colors top to bottom', () => {
    const f = flag(6, 4, 2, [RED, WHITE])
    expect(f.points.length).toBe(24)
    // Rows: z descends with row index; row 0/1 = RED band, 2/3 = WHITE band.
    const zTop = Math.max(...f.points.map((p) => p.z))
    const zBottom = Math.min(...f.points.map((p) => p.z))
    for (const p of f.points) {
      const expected = p.z > 0 ? RED : WHITE
      expect([p.r, p.g, p.b]).toEqual([...expected])
    }
    expect(zTop).toBeCloseTo(3, 9)
    expect(zBottom).toBeCloseTo(-3, 9)
  })

  it('canton overrides the top-left block (US-style 13 stripes + canton)', () => {
    const stripes = Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? RED : WHITE))
    const f = flag(19, 13, 2, stripes, { cols: 8, rows: 7, rgb: BLUE })
    expect(f.points.length).toBe(19 * 13)
    const xs = [...new Set(f.points.map((p) => p.x))].sort((a, b) => a - b)
    const zs = [...new Set(f.points.map((p) => p.z))].sort((a, b) => b - a)
    // Top-left cell is canton blue; bottom-right is the 13th stripe (red).
    const topLeft = f.points.find((p) => p.x === xs[0] && p.z === zs[0])!
    expect([topLeft.r, topLeft.g, topLeft.b]).toEqual([...BLUE])
    const bottomRight = f.points.find((p) => p.x === xs[18] && p.z === zs[12])!
    expect([bottomRight.r, bottomRight.g, bottomRight.b]).toEqual([...RED])
    // Top-right (outside the canton) is stripe 1 = red.
    const topRight = f.points.find((p) => p.x === xs[18] && p.z === zs[0])!
    expect([topRight.r, topRight.g, topRight.b]).toEqual([...RED])
  })
})

describe('digit / text', () => {
  it('digit 8 has the glyph cell count and sits centered', () => {
    const cells = textCells('8').cells
    const f = digit(8, cells.length, 1.5)
    expect(f.points.length).toBe(cells.length)
    const { cx, cz } = bboxCenter(f.points)
    expect(cx).toBeCloseTo(0, 9)
    expect(cz).toBeCloseTo(0, 9)
    for (const p of f.points) expect(p.y).toBe(0)
  })

  it('digit 7 is y-flipped: full row at the TOP (max z)', () => {
    const cells = textCells('7').cells
    const f = digit(7, cells.length, 1)
    const zMax = Math.max(...f.points.map((p) => p.z))
    const topRow = f.points.filter((p) => Math.abs(p.z - zMax) < 1e-9)
    expect(topRow.length).toBe(5) // glyph '7' row 0 is 'XXXXX'
  })

  it('text has the summed cell count and is deterministic', () => {
    const cells = textCells('2026').cells
    const f = text('2026', cells.length, 2)
    expect(f.points.length).toBe(cells.length)
    const { cx, cz } = bboxCenter(f.points)
    expect(cx).toBeCloseTo(0, 9)
    expect(cz).toBeCloseTo(0, 9)
    expect(text('2026', cells.length, 2).points).toEqual(f.points)
  })
})

describe('clockRing / scatter / bloom', () => {
  it('clockRing yields exactly n points with and without ticks', () => {
    expect(clockRing(60, 25).points.length).toBe(60)
    expect(clockRing(20, 25).points.length).toBe(20)
    // With ticks: some points sit inside the rim.
    const withTicks = clockRing(60, 25)
    const radii = withTicks.points.map((p) => Math.hypot(p.x, p.z))
    expect(radii.some((r) => r < 25 - 1e-9)).toBe(true)
    // Without ticks: all on the rim.
    for (const p of clockRing(20, 25).points) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(25, 9)
    }
  })

  it('scatter stays inside the box and is seed-deterministic', () => {
    const box = { x: 40, y: 10, z: 20 }
    const a = scatter(100, box, 7)
    const b = scatter(100, box, 7)
    const c = scatter(100, box, 8)
    expect(a.points).toEqual(b.points)
    expect(a.points).not.toEqual(c.points)
    for (const p of a.points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(20)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(5)
      expect(Math.abs(p.z)).toBeLessThanOrEqual(10)
    }
  })

  it('bloom points lie on the sphere surface', () => {
    const f = bloom(64, 12, 3)
    expect(f.points.length).toBe(64)
    for (const p of f.points) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(12, 9)
    }
    expect(bloom(64, 12, 3).points).toEqual(f.points)
  })
})

describe('resampleTo', () => {
  const base = ring(50, 30).points

  it('downsamples to the exact count with points drawn from the input', () => {
    const down = resampleTo(base, 20, 7)
    expect(down.length).toBe(20)
    for (const p of down) {
      expect(base.some((q) => q.x === p.x && q.y === p.y && q.z === p.z)).toBe(true)
    }
    // No duplicates.
    expect(new Set(down.map((p) => `${p.x},${p.z}`)).size).toBe(20)
  })

  it('upsamples to the exact count, originals first, jitter bounded', () => {
    const up = resampleTo(base, 80, 7)
    expect(up.length).toBe(80)
    for (let i = 0; i < base.length; i++) expect(up[i]).toEqual(base[i])
    for (let i = base.length; i < up.length; i++) {
      const src = base[(i - base.length) % base.length]!
      expect(Math.abs(up[i]!.x - src.x)).toBeLessThanOrEqual(0.5 + 1e-12)
      expect(Math.abs(up[i]!.z - src.z)).toBeLessThanOrEqual(0.5 + 1e-12)
      expect(up[i]!.y).toBe(src.y)
    }
  })

  it('is deterministic across runs for the same seed', () => {
    expect(resampleTo(base, 20, 7)).toEqual(resampleTo(base, 20, 7))
    expect(resampleTo(base, 80, 7)).toEqual(resampleTo(base, 80, 7))
    expect(resampleTo(base, 20, 7)).not.toEqual(resampleTo(base, 20, 8))
  })

  it('handles identity, empty, and zero counts', () => {
    expect(resampleTo(base, 50, 1)).toEqual(base)
    expect(resampleTo(base, 0, 1)).toEqual([])
    expect(resampleTo([], 3, 1)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ])
  })

  it('preserves per-point colors through both directions', () => {
    const colored = flag(6, 4, 2, [RED, WHITE]).points
    const down = resampleTo(colored, 10, 5)
    for (const p of down) expect(p.r).toBeDefined()
    const up = resampleTo(colored, 30, 5)
    for (const p of up) expect(p.r).toBeDefined()
  })
})
