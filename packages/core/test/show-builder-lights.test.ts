/**
 * The `b.lights` facade (show/builderLights.ts): param mapping for figure(),
 * the sweep()/chase() sugar, mirror() symmetry across two banks, converge()
 * fan-out, ids, and the emitted track.
 */
import { describe, expect, it } from 'vitest'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { figureAimsAt } from '../src/choreo/generators/searchlight.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import type { ShowBuilder } from '../src/show/index.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)

function builder(): ShowBuilder {
  return showBuilder({ id: 'bl', title: 'Builder Lights', seed: 2, site: lakesidePark(), catalog })
    .music(tl)
    .preRoll(6)
}

describe('figure()', () => {
  it('maps every optional field onto the documented params and auto-ids on the lights track', () => {
    const b = builder()
    b.lights.figure({
      effect: 'light-fan-gold',
      position: 'lights-west',
      land: m.barBeat(3, 1),
      tiltDeg: 10,
      spreadDeg: 50,
      sweepDeg: 12,
      periodBeats: 6,
      rgb: [1, 0.5, 0.25],
      params: { aimZ: 99 },
    })
    b.lights.figure({ effect: 'light-pillar-white', position: 'lights-east', land: m.barBeat(5, 1) })
    const { show } = b.build()
    const track = show.tracks.find((t) => t.id === 'lights')!
    expect(track.medium).toBe('searchlight')
    expect(track.name).toBe('Searchlights')
    expect(track.cues.map((c) => c.id)).toEqual(['lights-0', 'lights-1'])
    expect(track.cues[0]!.params).toEqual({
      aimZ: 99,
      tiltDeg: 10,
      spreadDeg: 50,
      sweepDeg: 12,
      periodBeats: 6,
      rgb: [1, 0.5, 0.25],
    })
    expect(track.cues[1]!.params).toBeUndefined()
    expect(track.cues[1]!.positionId).toBe('lights-east')
  })

  it('honors an explicit id and priority', () => {
    const b = builder()
    b.lights.figure({ id: 'mine', effect: 'light-pillar-white', position: 'lights-west', land: m.barBeat(3, 1), priority: 3 })
    const cue = b.build().show.tracks[0]!.cues[0]!
    expect(cue.id).toBe('mine')
    expect(cue.priority).toBe(3)
  })
})

describe('sweep() and chase() sugar', () => {
  it('sweep() carries sweepDeg / periodBeats / tiltDeg / rgb', () => {
    const b = builder()
    b.lights.sweep({ id: 'sw', effect: 'light-sweep-slow', position: 'lights-west', land: m.barBeat(3, 1), sweepDeg: 25, periodBeats: 4, tiltDeg: 5, rgb: [1, 1, 1] })
    const cue = b.build().show.tracks[0]!.cues[0]!
    expect(cue.params).toEqual({ tiltDeg: 5, sweepDeg: 25, periodBeats: 4, rgb: [1, 1, 1] })
  })

  it('chase() carries periodBeats / tiltDeg / rgb and nothing else', () => {
    const b = builder()
    b.lights.chase({ id: 'ch', effect: 'light-chase-beat', position: 'lights-east', land: m.barBeat(3, 1), periodBeats: 4 })
    const cue = b.build().show.tracks[0]!.cues[0]!
    expect(cue.params).toEqual({ periodBeats: 4 })
    expect(cue.effectId).toBe('light-chase-beat')
  })
})

describe('mirror()', () => {
  it('emits two cues, the second with spreadDeg and sweepDeg negated, ids prefix-000/001', () => {
    const b = builder()
    b.lights.mirror({
      effect: 'light-cross-violet',
      positions: ['lights-west', 'lights-east'],
      land: m.barBeat(3, 1),
      spreadDeg: 35,
      sweepDeg: 12,
      tiltDeg: 8,
      periodBeats: 8,
      rgb: [0.5, 0.2, 0.9],
      idPrefix: 'x',
    })
    const cues = b.build().show.tracks[0]!.cues
    expect(cues.map((c) => c.id)).toEqual(['x-000', 'x-001'])
    expect(cues.map((c) => c.positionId)).toEqual(['lights-west', 'lights-east'])
    expect(cues[0]!.params).toEqual({ tiltDeg: 8, spreadDeg: 35, sweepDeg: 12, periodBeats: 8, rgb: [0.5, 0.2, 0.9] })
    expect(cues[1]!.params).toEqual({ tiltDeg: 8, spreadDeg: -35, sweepDeg: -12, periodBeats: 8, rgb: [0.5, 0.2, 0.9] })
  })

  it('a mirrored cross reflects about the venue center: west head i ↔ east head n−1−i with x negated', () => {
    const b = builder()
    b.lights.mirror({ effect: 'light-cross-violet', positions: ['lights-west', 'lights-east'], land: m.barBeat(3, 1), idPrefix: 'x' })
    const { compiled } = b.build()
    const site = compiled.show.site
    const west = site.assets.find((a) => a.id === 'lights-west')!
    const east = site.assets.find((a) => a.id === 'lights-east')!
    const w = compiled.cues.find((c) => c.id === 'x-000')!
    const e = compiled.cues.find((c) => c.id === 'x-001')!
    const fx = getEffect('light-cross-violet') as never
    const wa = figureAimsAt(w, fx, west, w.targetSec)
    const ea = figureAimsAt(e, fx, east, e.targetSec)
    const n = wa.length
    wa.forEach((d, i) => {
      const twin = ea[n - 1 - i]!
      expect(twin.x).toBeCloseTo(-d.x, 12)
      expect(twin.y).toBeCloseTo(d.y, 12)
      expect(twin.z).toBeCloseTo(d.z, 12)
    })
    // Mirrored sweeps swing opposite ways at the same instant.
    const b2 = builder()
    b2.lights.mirror({ effect: 'light-sweep-slow', positions: ['lights-west', 'lights-east'], land: m.barBeat(3, 1), sweepDeg: 30, periodBeats: 8, idPrefix: 's' })
    const c2 = b2.build().compiled
    const sw = c2.cues.find((c) => c.id === 's-000')!
    const se = c2.cues.find((c) => c.id === 's-001')!
    const sfx = getEffect('light-sweep-slow') as never
    const t = sw.targetSec + 1
    const dw = figureAimsAt(sw, sfx, west, t, { beats: tl.beats })[0]!
    const de = figureAimsAt(se, sfx, east, t, { beats: tl.beats })[0]!
    expect(dw.x).toBeGreaterThan(0)
    expect(de.x).toBeCloseTo(-dw.x, 9)
  })
})

describe('converge()', () => {
  it('fans one cue per bank with aimX/aimZ (and aimY when given) and a shared landing', () => {
    const b = builder()
    b.lights.converge({ effect: 'light-converge-spire', positions: ['lights-west', 'lights-east'], at: { x: 0, z: 160 }, land: m.barBeat(5, 1), idPrefix: 'spire' })
    b.lights.converge({ effect: 'light-converge-spire', positions: ['lights-west'], at: { x: 10, y: 40, z: 120 }, land: m.barBeat(15, 1), rgb: [1, 0.9, 0.5] })
    const { show, compiled } = b.build()
    const cues = show.tracks[0]!.cues
    expect(cues.map((c) => c.id)).toEqual(['spire-000', 'spire-001', 'lights-0-000'])
    expect(cues[0]!.params).toEqual({ aimX: 0, aimZ: 160 })
    expect(cues[2]!.params).toEqual({ aimX: 10, aimZ: 120, aimY: 40, rgb: [1, 0.9, 0.5] })
    const a = compiled.cues.find((c) => c.id === 'spire-000')!
    const e = compiled.cues.find((c) => c.id === 'spire-001')!
    expect(a.targetSec).toBe(e.targetSec)
    // Mirror-symmetric banks slew for the same time toward the shared point.
    expect(a.anticipationSec).toBeCloseTo(e.anticipationSec, 9)
    expect(a.anticipationSec).toBeGreaterThan(0.5)
  })
})

describe('track emission', () => {
  it('a show without light cues emits no lights track; with them, the track sits after beams', () => {
    const none = builder()
    none.pyro.fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) })
    expect(none.build().show.tracks.map((t) => t.id)).toEqual(['pyro'])
    const both = builder()
    both.beams.toll({ effect: 'beam-toll-bell', position: 'beam-delay-west', land: m.barBeat(3, 1) })
    both.lights.figure({ effect: 'light-pillar-white', position: 'lights-west', land: m.barBeat(3, 1) })
    expect(both.build().show.tracks.map((t) => t.id)).toEqual(['beams', 'lights'])
  })
})
