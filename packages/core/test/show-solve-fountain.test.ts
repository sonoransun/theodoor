/**
 * show-solve-fountain.test.ts — the keystone in water: the solver fires a
 * fountain valve early by the bank's latency plus the ballistic rise, so the
 * column crests on the beat; params.heightM changes the lead; mist stretches
 * it; water noise flows through the SPL pipeline like every other medium.
 */
import { describe, expect, it } from 'vitest'
import type { BuildResult } from '../src/contracts.js'
import { GRAVITY_MPS2, SPL_REF_DISTANCE_M } from '../src/contracts.js'
import { splAtDistance, splAtInstant } from '../src/acoustics/index.js'
import { fountainRiseSec, getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { MIST_RISE_FACTOR } from '../src/sim/fountains.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const VALVE = 0.15

function build(author: (b: ReturnType<typeof showBuilder>, m: ReturnType<typeof musicRefs>) => void, variant: 'standard' | 'quiet' = 'standard'): BuildResult {
  const tl = buildTimelineFromScore(getScore('odeToJoy')!)
  const m = musicRefs(tl)
  const b = showBuilder({ id: 'solve-fountain', title: 'Solve Fountain', seed: 11, site: lakesidePark(), catalog, variant })
    .music(tl)
    .preRoll(6)
  if (variant === 'quiet') b.noiseBudget(85)
  author(b, m)
  return b.build()
}

describe('fountain anticipation = valve latency + sqrt(2h/g)', () => {
  const r = build((b, m) => {
    b.fountains.jet({ id: 'plume', effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(3, 1) })
    b.fountains.jet({ id: 'shooter', effect: 'fountain-shooter-45m', position: 'fount-east', crest: m.barBeat(5, 1) })
    b.fountains.jet({ id: 'fan', effect: 'fountain-fan-20m', position: 'fount-west', crest: m.barBeat(7, 1) })
    b.fountains.cascade({ id: 'casc', effect: 'fountain-cascade-25m', position: 'fount-east', crest: m.barBeat(9, 1) })
    b.fountains.wave({ id: 'wave', effect: 'fountain-wave-15m', position: 'fount-west', crest: m.barBeat(11, 1) })
    b.fountains.jet({ id: 'tall', effect: 'fountain-plume-30m', position: 'fount-east', crest: m.barBeat(13, 1), heightM: 40 })
    b.fountains.mist({ id: 'mist', position: 'fount-west', from: m.barBeat(15, 1) })
  })
  const cue = (id: string) => r.compiled.cues.find((c) => c.id === id)!

  it('compiles clean', () => {
    expect(r.compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(r.show.tracks.map((t) => t.id)).toEqual(['fountains'])
  })

  it.each([
    ['plume', 30],
    ['shooter', 45],
    ['fan', 20],
    ['casc', 25],
    ['wave', 15],
  ])('%s: fireSec = targetSec − (0.15 + sqrt(2·%d/g))', (id, h) => {
    const c = cue(id)
    const rise = Math.sqrt((2 * h) / GRAVITY_MPS2)
    expect(c.anticipationSec).toBeCloseTo(VALVE + rise, 9)
    expect(c.fireSec).toBeCloseTo(c.targetSec - VALVE - rise, 9)
  })

  it('lands on the authored beat and keeps the effect duration', () => {
    const c = cue('plume')
    expect(c.targetSec).toBeCloseTo(4, 9) // bar 3 beat 1 at 120 bpm
    expect(c.durationSec).toBe(6)
    expect(cue('shooter').anticipationSec).toBeCloseTo(0.15 + 3.029, 3)
  })

  it('params.heightM changes the lead (taller crest, longer rise)', () => {
    const tall = cue('tall')
    expect(tall.anticipationSec).toBeCloseTo(VALVE + Math.sqrt(80 / GRAVITY_MPS2), 9)
    expect(tall.anticipationSec).toBeGreaterThan(cue('plume').anticipationSec)
    expect(tall.params?.['heightM']).toBe(40)
  })

  it('mist rises MIST_RISE_FACTOR times slower and is anticipated accordingly', () => {
    const mist = cue('mist')
    expect(mist.effectId).toBe('fountain-mist-screen')
    expect(mist.anticipationSec).toBeCloseTo(VALVE + MIST_RISE_FACTOR * fountainRiseSec(4), 9)
  })

  it('a bank with a slower valve leads longer (site data, not catalog data)', () => {
    const tl = buildTimelineFromScore(getScore('odeToJoy')!)
    const m = musicRefs(tl)
    const site = lakesidePark()
    site.assets = site.assets.map((a) =>
      a.id === 'fount-west' && a.fountainBank
        ? { ...a, fountainBank: { ...a.fountainBank, valveLatencySec: 0.6 } }
        : a,
    )
    const b = showBuilder({ id: 'slow-valve', title: 'Slow Valve', seed: 1, site, catalog }).music(tl).preRoll(6)
    b.fountains.jet({ id: 'p', effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(3, 1) })
    const c = b.build().compiled.cues[0]!
    expect(c.anticipationSec).toBeCloseTo(0.6 + fountainRiseSec(30), 9)
  })
})

describe('fountains in quiet variants and the SPL pipeline', () => {
  it('every fountain program is legal in a quiet variant with an 85 dB budget', () => {
    const r = build((b, m) => {
      b.fountains.jet({ effect: 'fountain-shooter-45m', position: 'fount-west', crest: m.barBeat(3, 1) })
      b.fountains.mirror({ effect: 'fountain-cascade-25m', positions: ['fount-west', 'fount-east'], crest: m.barBeat(7, 1) })
    }, 'quiet')
    expect(r.show.meta.variant).toBe('quiet')
    expect(r.compiled.diagnostics.filter((d) => d.code === 'SPL_BUDGET')).toEqual([])
    expect(r.compiled.cues).toHaveLength(3)
  })

  it('water noise propagates to the reference listeners from first water until the column is dry', () => {
    const r = build((b, m) => {
      b.fountains.jet({ id: 'plume', effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(3, 1) })
    })
    const c = r.compiled.cues[0]!
    const listener = r.show.site.refListenerPos[1]! // (0, −190)
    const bank = r.show.site.assets.find((a) => a.id === 'fount-west')!
    const dist = Math.hypot(bank.pos.x - listener.x, bank.pos.y - listener.y)
    const expected = splAtDistance(66, SPL_REF_DISTANCE_M, dist)
    expect(expected).toBeCloseTo(66 - 20 * Math.log10(dist / 15), 9)
    expect(splAtInstant(r.compiled, getEffect, listener, c.targetSec)).toBeCloseTo(expected, 9)
    expect(splAtInstant(r.compiled, getEffect, listener, c.targetSec + 5.9)).toBeCloseTo(expected, 9)
    // The pumps are audible through the RISE (from fireSec + the 0.15 s valve
    // latency), not just from the crest — the window the sim raises water in.
    expect(splAtInstant(r.compiled, getEffect, listener, c.targetSec - 0.01)).toBeCloseTo(expected, 9)
    expect(splAtInstant(r.compiled, getEffect, listener, c.fireSec + 0.16)).toBeCloseTo(expected, 9)
    expect(splAtInstant(r.compiled, getEffect, listener, c.fireSec + 0.14)).toBe(-Infinity)
    expect(splAtInstant(r.compiled, getEffect, listener, c.targetSec + 6)).toBe(-Infinity)
    // Far quieter than any shell — under 50 dB at the lawn.
    expect(expected).toBeLessThan(50)
  })
})
