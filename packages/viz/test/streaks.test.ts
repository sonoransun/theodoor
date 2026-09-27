import { describe, expect, it } from 'vitest'
import type { SimSnapshot } from '@theodoor/core'
import { makeCamera } from '../src/render/camera.js'
import { FloatSink } from '../src/render/glStream.js'
import {
  STREAK_MAX_LEN_M,
  STREAK_MIN_SPEED_MPS,
  STREAK_STRIDE,
  STREAK_TAU_SEC,
  packStreaks,
  streakLengthM,
} from '../src/render/streaks.js'

function snap(stars: { pos: number[]; vel: number[]; b: number; size: number }[]): SimSnapshot {
  const n = stars.length
  const pos = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  const rgb = new Float32Array(n * 3)
  const brightness = new Float32Array(n)
  const sizeM = new Float32Array(n)
  stars.forEach((s, i) => {
    pos.set(s.pos, 3 * i)
    vel.set(s.vel, 3 * i)
    rgb.set([1, 0.5, 0.25], 3 * i)
    brightness[i] = s.b
    sizeM[i] = s.size
  })
  return {
    t: 0,
    step: 0,
    shells: { count: 0, pos: new Float32Array(0), cueIdx: new Int32Array(0) },
    stars: { count: n, pos, vel, rgb, brightness, sizeM },
    drones: { count: 0, pos: new Float32Array(0), vel: new Float32Array(0), rgb: new Float32Array(0), minSeparationM: Infinity },
    laserFrames: [],
    panelFrames: [],
    crowd: { cellCount: 0, rgb: new Float32Array(0), white: new Float32Array(0) },
    beams: [],
    jets: [],
    lights: [],
    splByListener: [-Infinity],
  }
}

describe('streakLengthM', () => {
  it('is 0 at or below the speed floor and v·τ above it, clamped', () => {
    expect(streakLengthM(0)).toBe(0)
    expect(streakLengthM(STREAK_MIN_SPEED_MPS)).toBe(0)
    expect(streakLengthM(30)).toBeCloseTo(30 * STREAK_TAU_SEC, 12)
    expect(streakLengthM(10_000)).toBe(STREAK_MAX_LEN_M)
  })
})

describe('packStreaks', () => {
  const camera = makeCamera(640, 510) // ppm = 1.9

  it('skips slow, dark, and depth-only stars; packs one quad (6 verts) per fast star', () => {
    const s = snap([
      { pos: [0, 0, 100], vel: [40, 0, 0], b: 1, size: 0.4 }, // fast → streak
      { pos: [10, 0, 100], vel: [1, 0, 0], b: 1, size: 0.4 }, // slow → none
      { pos: [20, 0, 100], vel: [0, 40, 0], b: 1, size: 0.4 }, // moving in depth only → none
      { pos: [30, 0, 100], vel: [40, 0, 0], b: 0.01, size: 0.4 }, // too dark → none
    ])
    const p = packStreaks(s, camera)
    expect(p.count).toBe(1)
    expect(p.floats).toBe(6 * STREAK_STRIDE)
    // u runs 0 (tail) → 1 (head); v is ±1 per corner.
    const us = [0, 1, 2, 3, 4, 5].map((k) => p.data[k * STREAK_STRIDE + 2])
    expect(us).toEqual([0, 0, 1, 0, 1, 1])
    const vs = [0, 1, 2, 3, 4, 5].map((k) => p.data[k * STREAK_STRIDE + 3])
    expect(vs).toEqual([-1, 1, -1, 1, 1, -1])
  })

  it('places the head at the star and the tail v·τ behind it along the motion', () => {
    const s = snap([{ pos: [0, 0, 100], vel: [60, 0, 0], b: 1, size: 0.4 }])
    const p = packStreaks(s, camera)
    const head = camera.project(0, 100)
    const tail = camera.project(-60 * STREAK_TAU_SEC, 100)
    // Tail corners (verts 0,1) share x with the tail projection; head corners (2,4,5) with the head.
    expect(p.data[0]).toBeCloseTo(tail.x, 9)
    expect(p.data[2 * STREAK_STRIDE]).toBeCloseTo(head.x, 9)
    expect(p.data[7]).toBeCloseTo(0.55, 5) // alpha = brightness · STREAK_ALPHA (float32)
  })

  it('is deterministic and reuses a caller-provided sink', () => {
    const s = snap([{ pos: [0, 0, 100], vel: [60, 0, 0], b: 1, size: 0.4 }])
    const sink = new FloatSink(8)
    const first = packStreaks(s, camera, sink)
    expect(first.data).toBe(sink.data)
    const again = packStreaks(s, camera, sink)
    expect(again.data).toBe(first.data)
    expect(again.floats).toBe(first.floats)
    expect(Array.from(again.data.subarray(0, again.floats))).toEqual(
      Array.from(first.data.subarray(0, first.floats)),
    )
  })
})
