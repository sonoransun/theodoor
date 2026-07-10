import { describe, expect, it } from 'vitest'
import {
  FIT_MARGIN,
  WORLD_X_MAX,
  WORLD_X_MIN,
  WORLD_Z_MAX,
  WORLD_Z_MIN,
  makeCamera,
} from '../src/render/camera.js'

const CORNERS: readonly [number, number][] = [
  [WORLD_X_MIN, WORLD_Z_MIN],
  [WORLD_X_MIN, WORLD_Z_MAX],
  [WORLD_X_MAX, WORLD_Z_MIN],
  [WORLD_X_MAX, WORLD_Z_MAX],
]

const SAMPLE_POINTS: readonly [number, number][] = [
  ...CORNERS,
  [0, 122.5],
  [-37.25, 14.5],
  [80.5, 201.75],
  [12.125, -5],
  [-160, 250],
  [300, -80], // outside the fit rect — projection math must still round-trip
]

describe('camera fit + letterbox', () => {
  it('computes the letterbox scale from the limiting dimension', () => {
    // 640/320 = 2, 510/255 = 2 → both limiting equally.
    expect(makeCamera(640, 510).pxPerMeter()).toBeCloseTo(1.9, 12)
    // Wide canvas: height limits. 0.95 * 510/255 = 1.9.
    expect(makeCamera(5000, 510).pxPerMeter()).toBeCloseTo(1.9, 12)
    // Tall canvas: width limits. 0.95 * 320/320 = 0.95.
    expect(makeCamera(320, 5000).pxPerMeter()).toBeCloseTo(0.95, 12)
  })

  it('centers the world rect and letterboxes the extra space', () => {
    const cam = makeCamera(2000, 510)
    const center = cam.worldToScreen(0, 122.5)
    expect(center.x).toBeCloseTo(1000, 9)
    expect(center.y).toBeCloseTo(255, 9)

    // The whole world rect fits inside the canvas with margin on all sides.
    for (const [x, z] of CORNERS) {
      const s = cam.worldToScreen(x, z)
      expect(s.x).toBeGreaterThan(0)
      expect(s.x).toBeLessThan(2000)
      expect(s.y).toBeGreaterThan(0)
      expect(s.y).toBeLessThan(510)
    }

    // Horizontal letterbox: world x extent uses only the middle of the canvas.
    const left = cam.worldToScreen(WORLD_X_MIN, 0).x
    const right = cam.worldToScreen(WORLD_X_MAX, 0).x
    expect(left).toBeCloseTo(1000 - 160 * 1.9, 9)
    expect(right).toBeCloseTo(1000 + 160 * 1.9, 9)
  })

  it('keeps the FIT_MARGIN border when aspect matches exactly', () => {
    const cam = makeCamera(640, 510)
    const s = cam.worldToScreen(WORLD_X_MIN, WORLD_Z_MAX) // top-left corner
    // Margin fraction on each side is (1 - FIT_MARGIN) / 2 of the canvas.
    expect(s.x / 640).toBeCloseTo((1 - FIT_MARGIN) / 2, 12)
    expect(s.y / 510).toBeCloseTo((1 - FIT_MARGIN) / 2, 12)
  })
})

describe('camera round-trips + projection', () => {
  it('screenToWorld(worldToScreen(p)) ~= p', () => {
    const cam = makeCamera(1280, 720)
    for (const [x, z] of SAMPLE_POINTS) {
      const s = cam.worldToScreen(x, z)
      const p = cam.screenToWorld(s.x, s.y)
      expect(p.x).toBeCloseTo(x, 9)
      expect(p.z).toBeCloseTo(z, 9)
    }
  })

  it('project() maps the world rect into clip space with the right signs', () => {
    const cam = makeCamera(640, 510)
    // Center of the fit rect → clip origin.
    expect(cam.project(0, 122.5).x).toBeCloseTo(0, 12)
    expect(cam.project(0, 122.5).y).toBeCloseTo(0, 12)
    // East edge → +x, top edge → +y (up), each at ±FIT_MARGIN.
    expect(cam.project(WORLD_X_MAX, 122.5).x).toBeCloseTo(FIT_MARGIN, 12)
    expect(cam.project(WORLD_X_MIN, 122.5).x).toBeCloseTo(-FIT_MARGIN, 12)
    expect(cam.project(0, WORLD_Z_MAX).y).toBeCloseTo(FIT_MARGIN, 12)
    expect(cam.project(0, WORLD_Z_MIN).y).toBeCloseTo(-FIT_MARGIN, 12)
  })

  it('worldToClipMatrix agrees with project() and is a pure 2D affine', () => {
    const cam = makeCamera(997, 613) // deliberately awkward dimensions
    const m = cam.worldToClipMatrix()
    expect(m).toHaveLength(9)
    // Column-major affine: no rotation/shear terms, homogeneous row intact.
    expect(m[1]).toBe(0)
    expect(m[2]).toBe(0)
    expect(m[3]).toBe(0)
    expect(m[5]).toBe(0)
    expect(m[8]).toBe(1)
    for (const [x, z] of SAMPLE_POINTS) {
      const c = cam.project(x, z)
      expect(m[0] * x + m[3] * z + m[6]).toBeCloseTo(c.x, 12)
      expect(m[1] * x + m[4] * z + m[7]).toBeCloseTo(c.y, 12)
    }
  })
})

describe('camera zoom invariants', () => {
  it('scaling the canvas uniformly scales pxPerMeter linearly', () => {
    const base = makeCamera(640, 510)
    const doubled = makeCamera(1280, 1020)
    expect(doubled.pxPerMeter()).toBeCloseTo(2 * base.pxPerMeter(), 12)
  })

  it('clip coordinates are invariant under uniform canvas scaling', () => {
    const base = makeCamera(640, 510)
    const doubled = makeCamera(1280, 1020)
    for (const [x, z] of SAMPLE_POINTS) {
      const a = base.project(x, z)
      const b = doubled.project(x, z)
      expect(b.x).toBeCloseTo(a.x, 12)
      expect(b.y).toBeCloseTo(a.y, 12)
    }
  })

  it('screen positions scale with the canvas (letterbox stays centered)', () => {
    const base = makeCamera(640, 510)
    const doubled = makeCamera(1280, 1020)
    for (const [x, z] of SAMPLE_POINTS) {
      const a = base.worldToScreen(x, z)
      const b = doubled.worldToScreen(x, z)
      expect(b.x).toBeCloseTo(2 * a.x, 9)
      expect(b.y).toBeCloseTo(2 * a.y, 9)
    }
  })
})
