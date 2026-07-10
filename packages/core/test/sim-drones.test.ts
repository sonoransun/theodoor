import { describe, expect, it } from 'vitest'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import {
  DRONE_BASE_ALTITUDE_M,
  PARKED_RGB,
  SimEngine,
  derivePadTimelines,
  padGroundGrid,
  runHeadless,
} from '../src/sim/index.js'
import { makeCompiled } from './sim-fixture.js'

const getEffect = getEffectFrom(starterCatalog())

/** 25 drones flying a 25-point grid formation — reachable well before target. */
function gridShow() {
  return makeCompiled(
    [
      { id: 'd-grid', trackId: 'trk-drone', medium: 'drone', effectId: 'grid-formation-100',
        positionId: 'pad-1', targetSec: 20, anticipationSec: 0, durationSec: 12,
        params: { count: 25, scaleM: 24 } },
    ],
    { fleet: { count: 25, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 }, musicDuration: 45 },
  )
}

/** Two drones squeezed through the middle: wide line → tiny ring (rMin 6). */
function crossShow() {
  return makeCompiled(
    [
      { id: 'd-line', trackId: 'trk-drone', medium: 'drone', effectId: 'wave-formation-100',
        positionId: 'pad-1', targetSec: 20, anticipationSec: 0, durationSec: 10,
        params: { count: 30, scaleM: 40 } },
      { id: 'd-tight', trackId: 'trk-drone', medium: 'drone', effectId: 'ring-formation-60',
        positionId: 'pad-1', targetSec: 45, anticipationSec: 0, durationSec: 10,
        params: { count: 24, scaleM: 4 } },
    ],
    { fleet: { count: 2, vMaxMps: 6, aMaxMps2: 3, rMinM: 6 }, musicDuration: 60 },
  )
}

describe('sim/drones — derivePadTimelines', () => {
  it('derives one timeline per pad with cue segments plus a return-home segment', () => {
    const compiled = gridShow()
    const timelines = derivePadTimelines(compiled, getEffect)
    expect(timelines.length).toBe(1)
    const tl = timelines[0]!
    expect(tl.padId).toBe('pad-1')
    expect(tl.slots.length).toBe(25)
    expect(tl.segments.length).toBe(2) // cue + return home
    const seg = tl.segments[0]!
    expect(seg.cueId).toBe('d-grid')
    expect(seg.targetSec).toBe(20)
    expect(seg.startSec).toBeLessThan(seg.targetSec)
    expect(seg.transitionSec).toBeGreaterThanOrEqual(seg.plan.minTransitionSec)
    // Formation flies at 30 m + scale/2.
    const zs = seg.ends.map((e) => e.z)
    const mid = (Math.min(...zs) + Math.max(...zs)) / 2
    expect(mid).toBeCloseTo(DRONE_BASE_ALTITUDE_M + 12, 6)
    // Return-home descends to the ground grid slots, 5 s after the hold ends.
    const home = tl.segments[1]!
    expect(home.cueIdx).toBe(-1)
    expect(home.startSec).toBeCloseTo(seg.holdEndSec + 5, 9)
    expect(home.inFormation.every((f) => !f)).toBe(true)
  })

  it('is deterministic: identical inputs → identical plans', () => {
    const a = derivePadTimelines(gridShow(), getEffect)
    const b = derivePadTimelines(gridShow(), getEffect)
    expect(b).toEqual(a)
  })

  it('padGroundGrid spaces slots at the requested pitch, centered on the pad', () => {
    const slots = padGroundGrid(10, 20, 0, 4, 4)
    expect(slots.length).toBe(4)
    expect(slots[1]!.x - slots[0]!.x).toBeCloseTo(4, 9)
    const cx = slots.reduce((s, p) => s + p.x, 0) / 4
    const cy = slots.reduce((s, p) => s + p.y, 0) / 4
    expect(cx).toBeCloseTo(10, 9)
    expect(cy).toBeCloseTo(20, 9)
  })
})

describe('sim/drones — flight', () => {
  it('drones reach their targets within 0.1 m by targetSec', () => {
    const compiled = gridShow()
    const timelines = derivePadTimelines(compiled, getEffect)
    const seg = timelines[0]!.segments[0]!

    const engine = new SimEngine(compiled)
    engine.advanceTo(20) // targetSec
    const snap = engine.snapshot()
    expect(snap.drones.count).toBe(25)
    for (let i = 0; i < 25; i++) {
      const e = seg.ends[i]!
      const d = Math.hypot(
        snap.drones.pos[i * 3]! - e.x,
        snap.drones.pos[i * 3 + 1]! - e.y,
        snap.drones.pos[i * 3 + 2]! - e.z,
      )
      expect(d).toBeLessThan(0.1)
    }
    // The aggregate landing-accuracy stat agrees.
    const { stats } = runHeadless(compiled, { toSec: 25 })
    expect(stats.landingAccuracyM).toBeLessThan(0.1)
    expect(stats.peakDrones).toBe(25)
  })

  it('velocity stays within vMax during the whole flight', () => {
    const engine = new SimEngine(gridShow())
    let vMaxSeen = 0
    for (let t = 0; t <= 22; t += 0.25) {
      engine.advanceTo(t)
      const s = engine.snapshot()
      for (let i = 0; i < s.drones.count; i++) {
        const v = Math.hypot(
          s.drones.vel[i * 3]!, s.drones.vel[i * 3 + 1]!, s.drones.vel[i * 3 + 2]!,
        )
        if (v > vMaxSeen) vMaxSeen = v
      }
    }
    expect(vMaxSeen).toBeGreaterThan(1) // they actually flew
    expect(vMaxSeen).toBeLessThanOrEqual(6 + 1e-6)
  })

  it('a crafted head-on squeeze fires the separation warning and lowers minSeparationM', () => {
    const compiled = crossShow()
    const { stats, engine } = runHeadless(compiled, { toSec: 50 })
    const separation = engine
      .warnings()
      .filter((w) => w.code === 'sim/drone-separation')
    expect(separation.length).toBeGreaterThan(0)
    expect(separation[0]!.severity).toBe('warning')
    expect(stats.minSeparationM).toBeLessThan(6)
    expect(stats.warningCount).toBeGreaterThan(0)
  })

  it('drones return to the pad grid after the last cue (hold 5 s, then descend)', () => {
    const compiled = gridShow()
    const timelines = derivePadTimelines(compiled, getEffect)
    const home = timelines[0]!.segments[1]!
    const engine = new SimEngine(compiled)
    engine.advanceTo(home.targetSec + 5)
    const snap = engine.snapshot()
    const slots = timelines[0]!.slots
    for (let i = 0; i < slots.length; i++) {
      const d = Math.hypot(
        snap.drones.pos[i * 3]! - slots[i]!.x,
        snap.drones.pos[i * 3 + 1]! - slots[i]!.y,
        snap.drones.pos[i * 3 + 2]! - slots[i]!.z,
      )
      expect(d).toBeLessThan(0.5)
    }
    // Parked drones read as dim (PARKED_RGB), not formation white.
    expect(snap.drones.rgb[0]).toBeCloseTo(PARKED_RGB[0], 5)
  })
})
