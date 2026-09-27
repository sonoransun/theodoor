/**
 * review-fixes-water-light.test.ts — regressions pinned by the adversarial
 * review of the fountain / searchlight wave:
 *   1. searchlight slew estimates chain banks in LANDING order, so authoring
 *      order can never move a figure to a later beat;
 *   2. a hold cut for a MOVING previous figure iterates until the slew
 *      measured from the cut aim fits — no spurious 'sim/light-slew-short';
 *   3. the fountain noise window runs from first water to the last staggered
 *      column dry, so the SPL sweep hears what the sim raises.
 */
import { describe, expect, it } from 'vitest'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { cueNoiseWindow, splAtInstant } from '../src/acoustics/index.js'
import { deriveLightChains, lightArrivalLagSecMax } from '../src/sim/lights.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import type { BuildResult } from '../src/show/index.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)

function base(id: string): ReturnType<typeof showBuilder> {
  return showBuilder({ id, title: id, seed: 11, site: lakesidePark(), catalog }).music(tl).preRoll(1)
}

describe('searchlight slew estimates chain in landing order', () => {
  /** Two figures on one bank; `late` lands at 60 s, `early` right after the transport start. */
  function build(id: string, order: 'early-first' | 'late-first'): BuildResult {
    const b = base(id)
    const early = (): void => {
      b.lights.figure({ id: 'early', effect: 'light-fan-gold', position: 'lights-west', land: m.time(0.5), spreadDeg: 60 })
    }
    const late = (): void => {
      b.lights.figure({ id: 'late', effect: 'light-cross-violet', position: 'lights-west', land: m.time(60), spreadDeg: 70 })
    }
    if (order === 'early-first') {
      early()
      late()
    } else {
      late()
      early()
    }
    return b.build()
  }

  it('the early figure keeps its landing whichever order it was authored in', () => {
    const a = build('order-a', 'early-first')
    const b = build('order-b', 'late-first')
    const pick = (r: BuildResult, id: string) => r.compiled.cues.find((c) => c.id === id)!
    // A ±30° fan from park is a 0.55 s slew; the 1 s pre-roll holds it.
    expect(pick(a, 'early').targetSec).toBeCloseTo(0.5, 9)
    expect(pick(b, 'early').targetSec).toBeCloseTo(0.5, 9)
    expect(pick(a, 'early').fireSec).toBeCloseTo(pick(b, 'early').fireSec, 9)
    expect(pick(a, 'late').fireSec).toBeCloseTo(pick(b, 'late').fireSec, 9)
    expect(a.compiled.diagnostics.filter((d) => d.code === 'NEGATIVE_FIRE')).toEqual([])
    expect(b.compiled.diagnostics.filter((d) => d.code === 'NEGATIVE_FIRE')).toEqual([])
  })
})

describe('a hold cut for a moving figure iterates until the slew fits', () => {
  it('a pillar landing inside a sweep departs early enough to arrive on the beat', () => {
    const b = base('cut-iter')
    // Slow sweep ±35° along the row, 16 s hold; a pillar lands 6 s in.
    b.lights.figure({ id: 'sweep', effect: 'light-sweep-slow', position: 'lights-east', land: m.time(4), sweepDeg: 35, periodBeats: 8 })
    b.lights.figure({ id: 'pillar', effect: 'light-pillar-white', position: 'lights-east', land: m.time(10) })
    const { compiled } = b.build()
    const chains = deriveLightChains(compiled, getEffect)
    const bank = chains.find((c) => c.bankId === 'lights-east')!
    const pillar = bank.segments.find((s) => s.cue.id === 'pillar')!
    // The sweep is cut so the pillar's slew, measured from the CUT aim, fits.
    expect(pillar.startSec + pillar.slewSec).toBeLessThanOrEqual(pillar.targetSec + 1e-9)
    expect(bank.diagnostics.map((d) => d.code)).toContain('sim/light-overlap')
    expect(bank.diagnostics.map((d) => d.code)).not.toContain('sim/light-slew-short')
    expect(lightArrivalLagSecMax(chains)).toBe(0)
  })
})

describe('the fountain noise window follows the water', () => {
  it('runs from first water through the rise and past the cascade stagger', () => {
    const b = base('water-window')
    b.fountains.jet({ id: 'shoot', effect: 'fountain-shooter-45m', position: 'fount-west', crest: m.time(20) })
    b.fountains.cascade({ id: 'casc', effect: 'fountain-cascade-25m', position: 'fount-east', crest: m.time(30), stepBeats: 1 })
    const { compiled } = b.build()
    const site = compiled.show.site
    const ctx = { site, beats: compiled.show.music.beats }
    const shoot = compiled.cues.find((c) => c.id === 'shoot')!
    const casc = compiled.cues.find((c) => c.id === 'casc')!
    const shooter = getEffect('fountain-shooter-45m')!
    const cascade = getEffect('fountain-cascade-25m')!
    const wShoot = cueNoiseWindow(shoot, shooter, ctx)
    expect(wShoot.start).toBeCloseTo(shoot.fireSec + 0.15, 9) // first water, not the crest
    expect(wShoot.end).toBeCloseTo(shoot.targetSec + shooter.durationSec, 9)
    const wCasc = cueNoiseWindow(casc, cascade, ctx)
    // Nine nozzles one beat apart at 120 bpm: the last column crests 4 s late.
    expect(wCasc.end).toBeCloseTo(casc.targetSec + cascade.durationSec + 8 * 0.5, 6)
    // Without site context the window still starts at the valve, never the crest.
    expect(cueNoiseWindow(shoot, shooter).start).toBeCloseTo(shoot.fireSec + 0.15, 9)
    // The SPL sweep hears water DURING the rise (before the crest) at the lawn.
    const listener = site.refListenerPos[1]!
    expect(splAtInstant(compiled, getEffect, listener, shoot.targetSec - 1.5)).toBeGreaterThan(30)
    expect(splAtInstant(compiled, getEffect, listener, shoot.fireSec - 0.5)).toBe(-Infinity)
  })
})
