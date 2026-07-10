import { describe, expect, it } from 'vitest'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import type { PyroEffect } from '../src/contracts.js'
import {
  SimEngine,
  buildPyroCues,
  starBrightnessAt,
  starPosAt,
  TRACER_SIZE_M,
} from '../src/sim/index.js'
import { hashNumbers, sixCueShow } from './sim-fixture.js'

const getEffect = getEffectFrom(starterCatalog())

describe('sim/pyro', () => {
  // p1 = peony-75-red on rack-1: fireSec 1.8, riseTime 2.2 → burst at 4.0.
  const compiled = sixCueShow()
  const records = buildPyroCues(compiled, getEffect)
  const p1 = records.find((r) => r.cue.id === 'p1')!
  const peony = getEffect('peony-75-red') as PyroEffect

  it('bursts at the first step >= fireSec + riseTime, with z(T) at burstHeightM', () => {
    const engine = new SimEngine(compiled)

    // One step before the burst: still ascending — shell present, no burst stars.
    engine.advanceTo(4.0 - 1 / 120)
    let snap = engine.snapshot()
    expect(snap.shells.count).toBe(1)
    expect(snap.shells.cueIdx[0]).toBe(compiled.cues.findIndex((c) => c.id === 'p1'))
    // Shell z within one step's climb of the burst height.
    const z = snap.shells.pos[2]!
    expect(Math.abs(z - peony.burstHeightM)).toBeLessThan(0.05)

    // First step >= burst time: shell gone, starCount burst stars born.
    engine.advanceTo(4.0)
    snap = engine.snapshot()
    expect(snap.shells.count).toBe(0)
    expect(snap.stars.count).toBe(peony.starCount)
  })

  it('pushes a bright tracer star at the shell tip during ascent', () => {
    const engine = new SimEngine(compiled)
    engine.advanceTo(3.0) // mid-ascent of p1, before any other effect
    const snap = engine.snapshot()
    expect(snap.shells.count).toBe(1)
    expect(snap.stars.count).toBeGreaterThan(0)
    // The tracer rides the shell tip at full brightness and tracer size.
    expect(snap.stars.pos[0]).toBeCloseTo(snap.shells.pos[0]!, 6)
    expect(snap.stars.pos[2]).toBeCloseTo(snap.shells.pos[2]!, 6)
    expect(snap.stars.brightness[0]).toBe(1)
    expect(snap.stars.sizeM[0]).toBeCloseTo(TRACER_SIZE_M, 6)
  })

  it('star evaluation is a pure closed form (same star, same age, twice)', () => {
    const star = p1.stars[17]!
    const a = 0.937
    const first = starPosAt(star, a)
    const second = starPosAt(star, a)
    expect(second).toEqual(first)
    expect(starBrightnessAt(star, a)).toBe(starBrightnessAt(star, a))
  })

  it('max star distance from the burst center is within 8% of burstRadiusM at end of life', () => {
    let maxDist = 0
    for (const s of p1.stars) {
      const p = starPosAt(s, s.lifeSec)
      const d = Math.hypot(p.x - s.p0.x, p.y - s.p0.y, p.z - s.p0.z)
      if (d > maxDist) maxDist = d
    }
    expect(Math.abs(maxDist - peony.burstRadiusM) / peony.burstRadiusM).toBeLessThan(0.08)
  })

  it('same seed → identical star hash at t=30; different seed → different', () => {
    const hashStarsAt30 = (seed: number): number => {
      const engine = new SimEngine(sixCueShow(seed))
      engine.advanceTo(30) // brocade p2 stars are alive (burst 26, ~7 s life)
      const s = engine.snapshot()
      expect(s.stars.count).toBeGreaterThan(0)
      let h = hashNumbers(0x811c9dc5, s.stars.pos)
      h = hashNumbers(h, s.stars.rgb)
      return h
    }
    const a1 = hashStarsAt30(7)
    const a2 = hashStarsAt30(7)
    const b = hashStarsAt30(8)
    expect(a2).toBe(a1)
    expect(b).not.toBe(a1)
  })

  it('brocade stars twinkle statelessly; peony stars do not', () => {
    const p2 = records.find((r) => r.cue.id === 'p2')!
    expect(p2.stars.every((s) => s.twinkle)).toBe(true)
    expect(p1.stars.every((s) => !s.twinkle)).toBe(true)
    // Twinkle modulates brightness but stays reproducible.
    const s = p2.stars[3]!
    expect(starBrightnessAt(s, 0.5)).toBe(starBrightnessAt(s, 0.5))
  })

  it('salute (starCount 0) renders a single white flash star at the burst', () => {
    const s1 = records.find((r) => r.cue.id === 's1')!
    expect(s1.stars.length).toBe(1)
    const engine = new SimEngine(compiled)
    engine.advanceTo(20.05)
    const snap = engine.snapshot()
    // Salute flash is present (drones + salute are the only visuals at 20.05).
    expect(snap.stars.count).toBeGreaterThan(0)
    const flash = s1.stars[0]!
    expect(flash.v0).toEqual({ x: 0, y: 0, z: 0 })
    expect(flash.lifeSec).toBeCloseTo(0.3, 9)
  })
})
