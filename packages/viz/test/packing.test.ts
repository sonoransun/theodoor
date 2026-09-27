import type { SimSnapshot } from '@theodoor/core'
import { describe, expect, it } from 'vitest'
import { makeCamera } from '../src/render/camera.js'
import {
  DRONE_ALPHA,
  DRONE_SIZE_M,
  PACK_OFF_ALPHA,
  PACK_OFF_B,
  PACK_OFF_CLIP_X,
  PACK_OFF_CLIP_Y,
  PACK_OFF_G,
  PACK_OFF_R,
  PACK_OFF_SIZE,
  STAR_GLARE,
  PACK_STRIDE,
  packSnapshot,
} from '../src/render/curves.js'

/** Hand-built snapshot: 2 stars + 1 drone at easy-to-project positions. */
function makeSnapshot(): SimSnapshot {
  return {
    t: 1.25,
    step: 150,
    shells: { count: 0, pos: new Float32Array(0), cueIdx: new Int32Array(0) },
    stars: {
      count: 2,
      // (x, y, z): world center of fit rect, then east edge; y (depth) ignored.
      pos: new Float32Array([0, 17, 122.5, 160, -4, 122.5]),
      vel: new Float32Array(6),
      rgb: new Float32Array([1, 0.5, 0.25, 0, 1, 0.125]),
      brightness: new Float32Array([0.8, 0.4]),
      sizeM: new Float32Array([2, 4]),
    },
    drones: {
      count: 1,
      pos: new Float32Array([-160, 9, 122.5]),
      vel: new Float32Array([0, 0, 0]),
      rgb: new Float32Array([0, 0.25, 1]),
      minSeparationM: 3,
    },
    laserFrames: [],
    panelFrames: [],
    crowd: { cellCount: 0, rgb: new Float32Array(0), white: new Float32Array(0) },
    beams: [],
    jets: [],
    lights: [],
    splByListener: [-Infinity],
  }
}

describe('packSnapshot', () => {
  // 640/320 = 2, 510/255 = 2 → pxPerMeter = 0.95 * 2 = 1.9 exactly.
  const camera = makeCamera(640, 510)
  const PPM = 1.9

  it('packs stars then drones with PACK_STRIDE floats each', () => {
    const { data, count } = packSnapshot(makeSnapshot(), camera)
    expect(PACK_STRIDE).toBe(7)
    expect(count).toBe(3)
    expect(data.length).toBeGreaterThanOrEqual(count * PACK_STRIDE)
  })

  it('writes clip position, pixel size, color, and alpha at the right offsets', () => {
    const { data } = packSnapshot(makeSnapshot(), camera)

    // Star 0: world (0, ·, 122.5) → clip (0, 0).
    expect(data[PACK_OFF_CLIP_X]).toBeCloseTo(0, 6)
    expect(data[PACK_OFF_CLIP_Y]).toBeCloseTo(0, 6)
    expect(data[PACK_OFF_SIZE]).toBeCloseTo(2 * STAR_GLARE * PPM, 6)
    expect(data[PACK_OFF_R]).toBeCloseTo(1, 6)
    expect(data[PACK_OFF_G]).toBeCloseTo(0.5, 6)
    expect(data[PACK_OFF_B]).toBeCloseTo(0.25, 6)
    expect(data[PACK_OFF_ALPHA]).toBeCloseTo(0.8, 6)

    // Star 1: world (160, ·, 122.5) → clip (0.95, 0).
    const o1 = PACK_STRIDE
    expect(data[o1 + PACK_OFF_CLIP_X]).toBeCloseTo(0.95, 6)
    expect(data[o1 + PACK_OFF_CLIP_Y]).toBeCloseTo(0, 6)
    expect(data[o1 + PACK_OFF_SIZE]).toBeCloseTo(4 * STAR_GLARE * PPM, 6)
    expect(data[o1 + PACK_OFF_R]).toBeCloseTo(0, 6)
    expect(data[o1 + PACK_OFF_G]).toBeCloseTo(1, 6)
    expect(data[o1 + PACK_OFF_B]).toBeCloseTo(0.125, 6)
    expect(data[o1 + PACK_OFF_ALPHA]).toBeCloseTo(0.4, 6)
  })

  it('flags drones with a NEGATIVE packed size and full alpha', () => {
    const { data } = packSnapshot(makeSnapshot(), camera)
    const o2 = 2 * PACK_STRIDE // after the two stars

    expect(data[o2 + PACK_OFF_CLIP_X]).toBeCloseTo(-0.95, 6)
    expect(data[o2 + PACK_OFF_CLIP_Y]).toBeCloseTo(0, 6)
    expect(data[o2 + PACK_OFF_SIZE]).toBeLessThan(0)
    expect(data[o2 + PACK_OFF_SIZE]).toBeCloseTo(-DRONE_SIZE_M * PPM, 6)
    expect(data[o2 + PACK_OFF_R]).toBeCloseTo(0, 6)
    expect(data[o2 + PACK_OFF_G]).toBeCloseTo(0.25, 6)
    expect(data[o2 + PACK_OFF_B]).toBeCloseTo(1, 6)
    expect(data[o2 + PACK_OFF_ALPHA]).toBe(DRONE_ALPHA)

    // Star sizes stay positive — the sign IS the drone flag.
    expect(data[PACK_OFF_SIZE]).toBeGreaterThan(0)
    expect(data[PACK_STRIDE + PACK_OFF_SIZE]).toBeGreaterThan(0)
  })

  it('handles an empty snapshot', () => {
    const empty = makeSnapshot()
    const snapshot: SimSnapshot = {
      ...empty,
      stars: {
        count: 0,
        pos: new Float32Array(0),
        rgb: new Float32Array(0),
        brightness: new Float32Array(0),
        sizeM: new Float32Array(0),
      },
      drones: {
        count: 0,
        pos: new Float32Array(0),
        vel: new Float32Array(0),
        rgb: new Float32Array(0),
        minSeparationM: 0,
      },
    }
    const { count } = packSnapshot(snapshot, camera)
    expect(count).toBe(0)
  })

  it('reuses a caller-provided scratch buffer when it is big enough', () => {
    const scratch = new Float32Array(1024)
    const packed = packSnapshot(makeSnapshot(), camera, scratch)
    expect(packed.data).toBe(scratch)

    const tiny = new Float32Array(4)
    const repacked = packSnapshot(makeSnapshot(), camera, tiny)
    expect(repacked.data).not.toBe(tiny)
    expect(repacked.data.length).toBeGreaterThanOrEqual(3 * PACK_STRIDE)
  })
})
