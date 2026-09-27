import { describe, expect, it } from 'vitest'
import { FloatSink, pushQuad } from '../src/render/glStream.js'
import { FOUNTAIN_FALL_DIM, FOUNTAIN_GAIN, jetAlpha } from '../src/render/glFountains.js'
import { LIGHT_DRAW_FRACTION, beamPlanar } from '../src/render/glSearchlights.js'

describe('FloatSink / pushQuad', () => {
  it('grows by doubling, never shrinks, and resets its length only', () => {
    const s = new FloatSink(4)
    s.push(1, 2, 3, 4, 5)
    expect(s.length).toBe(5)
    expect(s.data.length).toBe(8)
    const buf = s.data
    s.reset()
    expect(s.length).toBe(0)
    expect(s.data).toBe(buf)
  })

  it('emits two triangles with (u, v) corners and the shared tail', () => {
    const s = new FloatSink(8)
    const p = (x: number, y: number) => ({ x, y })
    pushQuad(s, p(0, 0), p(0, 1), p(1, 0), p(1, 1), 0, 1, [9, 8])
    expect(s.length).toBe(6 * 6)
    const verts = []
    for (let k = 0; k < 6; k++) verts.push(Array.from(s.data.subarray(k * 6, k * 6 + 6)))
    expect(verts).toEqual([
      [0, 0, 0, -1, 9, 8],
      [0, 1, 0, 1, 9, 8],
      [1, 0, 1, -1, 9, 8],
      [0, 1, 0, 1, 9, 8],
      [1, 1, 1, 1, 9, 8],
      [1, 0, 1, -1, 9, 8],
    ])
  })
})

describe('jetAlpha', () => {
  it('dims falling columns only', () => {
    expect(jetAlpha('rising')).toBe(FOUNTAIN_GAIN)
    expect(jetAlpha('holding')).toBe(FOUNTAIN_GAIN)
    expect(jetAlpha('falling')).toBeCloseTo(FOUNTAIN_GAIN * FOUNTAIN_FALL_DIM, 12)
  })
})

describe('beamPlanar', () => {
  it('projects the beam into the x–z view and shortens depth-pointing heads', () => {
    const up = beamPlanar({ x: 0, y: 0, z: 1 }, 600)
    expect(up).toEqual({ ux: 0, uz: 1, lenM: 600 * LIGHT_DRAW_FRACTION })
    const lean = beamPlanar({ x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }, 600)
    expect(lean.ux).toBeCloseTo(Math.SQRT1_2, 12)
    expect(lean.lenM).toBeCloseTo(600 * LIGHT_DRAW_FRACTION, 9)
    const north = beamPlanar({ x: 0, y: 1, z: 0 }, 600)
    expect(north.lenM).toBeLessThan(600 * LIGHT_DRAW_FRACTION * 0.1)
    const mostlyNorth = beamPlanar({ x: 0, y: 0.8, z: 0.6 }, 600)
    expect(mostlyNorth.lenM).toBeCloseTo(600 * LIGHT_DRAW_FRACTION * 0.6, 9)
    expect(mostlyNorth.uz).toBe(1)
  })
})
