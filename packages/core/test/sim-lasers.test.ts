import { describe, expect, it } from 'vitest'
import { getEffectFrom, starterCatalog, LASER_EFFECTS } from '../src/catalog/index.js'
import type { CompiledCue, LaserPrimitive } from '../src/contracts.js'
import { SimEngine, beatPhase, renderLaserFrame } from '../src/sim/index.js'
import { makeMusic, sixCueShow } from './sim-fixture.js'

const getEffect = getEffectFrom(starterCatalog())
const timeline = makeMusic(40)

function laserCue(effectId: string, params?: CompiledCue['params']): CompiledCue {
  return {
    id: 'lx', trackId: 'trk-laser', medium: 'laser', effectId,
    positionId: 'laser-west', targetSec: 5, fireSec: 5, anticipationSec: 0,
    durationSec: 8, seed: 12345,
    ...(params ? { params } : {}),
  }
}

describe('sim/lasers — beatPhase', () => {
  it('is the fractional index into the beats array, clamped', () => {
    const beats = [0, 0.5, 1.0, 1.5]
    expect(beatPhase(beats, 0)).toBe(0)
    expect(beatPhase(beats, 0.25)).toBeCloseTo(0.5, 9)
    expect(beatPhase(beats, 1.0)).toBeCloseTo(2, 9)
    expect(beatPhase(beats, 1.25)).toBeCloseTo(2.5, 9)
    expect(beatPhase(beats, -5)).toBe(0) // clamped low
    expect(beatPhase(beats, 99)).toBe(3) // clamped high
    expect(beatPhase([], 1)).toBe(0)
    expect(beatPhase([2], 1)).toBe(0)
  })
})

describe('sim/lasers — frames', () => {
  it('every shape emits exactly pointsPerFrame points, all within [-1, 1]', () => {
    for (const effect of LASER_EFFECTS) {
      for (const t of [5, 6.123, 9.9]) {
        const pts = renderLaserFrame(effect, laserCue(effect.id), t, timeline)
        expect(pts.length).toBe(effect.pointsPerFrame)
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(-1)
          expect(p.x).toBeLessThanOrEqual(1)
          expect(p.y).toBeGreaterThanOrEqual(-1)
          expect(p.y).toBeLessThanOrEqual(1)
          expect(p.r).toBeGreaterThanOrEqual(0)
          expect(p.r).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('beamFan has blanked hops between rays (and only there)', () => {
    const effect = getEffect('laser-fan-rgb') as LaserPrimitive
    const pts = renderLaserFrame(effect, laserCue('laser-fan-rgb'), 6, timeline)
    const blanks = pts.filter((p) => p.blank)
    expect(blanks.length).toBe(4) // 5 rays default → 4 hops
    expect(pts[0]!.blank).toBe(false) // first ray needs no hop
  })

  it('beamFan honors the beamCount param', () => {
    const effect = getEffect('laser-fan-rgb') as LaserPrimitive
    const pts = renderLaserFrame(
      effect, laserCue('laser-fan-rgb', { beamCount: 8 }), 6, timeline,
    )
    expect(pts.filter((p) => p.blank).length).toBe(7)
    expect(pts.length).toBe(effect.pointsPerFrame)
  })

  it('periodBeats beat-locks the pattern: same beat phase → same frame', () => {
    const effect = getEffect('laser-lissajous-rgb') as LaserPrimitive
    const cue = laserCue('laser-lissajous-rgb', { periodBeats: 4 })
    // Beats every 0.5 s → beatPhase(t) = 2t; phase = 2t/4. t=6 → 3.0, t=8 → 4.0:
    // both integer cycles → the same figure (up to float ulps in sin).
    const a = renderLaserFrame(effect, cue, 6, timeline)
    const b = renderLaserFrame(effect, cue, 8, timeline)
    for (let i = 0; i < a.length; i++) {
      expect(b[i]!.x).toBeCloseTo(a[i]!.x, 9)
      expect(b[i]!.y).toBeCloseTo(a[i]!.y, 9)
    }
    // Quarter cycle later differs visibly.
    const c = renderLaserFrame(effect, cue, 6.5, timeline)
    const maxDx = Math.max(...c.map((p, i) => Math.abs(p.x - a[i]!.x)))
    expect(maxDx).toBeGreaterThan(0.01)
  })

  it('rendering is pure: identical calls → identical frames', () => {
    const effect = getEffect('laser-starfield-white') as LaserPrimitive
    const cue = laserCue('laser-starfield-white')
    const a = renderLaserFrame(effect, cue, 7.777, timeline)
    const b = renderLaserFrame(effect, cue, 7.777, timeline)
    expect(b).toEqual(a)
  })

  it('the engine snapshot carries frames only while a laser cue is active', () => {
    const engine = new SimEngine(sixCueShow())
    engine.advanceTo(3) // l1 starts at 5
    expect(engine.snapshot().laserFrames.length).toBe(0)
    engine.advanceTo(6)
    const frames = engine.snapshot().laserFrames
    expect(frames.length).toBe(1)
    expect(frames[0]!.assetId).toBe('laser-west')
    expect(frames[0]!.points.length).toBe(512) // lissajous pointsPerFrame
    engine.advanceTo(17.5) // window [5, 17) has closed
    expect(engine.snapshot().laserFrames.length).toBe(0)
  })
})
