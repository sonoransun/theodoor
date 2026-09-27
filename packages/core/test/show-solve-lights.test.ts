/**
 * Alignment-solver coverage for the searchlight medium: phase-1 slew
 * anticipation, agreement between the phase-1 estimate and the final
 * bank-chain adoption, per-bank chaining through a figure's end aim, and the
 * NEGATIVE_FIRE exemption (squeezed slews warn instead).
 */
import { describe, expect, it } from 'vitest'
import type { Show, Track } from '../src/contracts.js'
import { STARTER_CATALOG_ID, getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import {
  LIGHT_PARK_DIR,
  bankHeadBases,
  figureAimsAt,
} from '../src/choreo/generators/searchlight.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { compile, musicRefs, showBuilder, solve } from '../src/show/index.js'
import { LIGHT_SLEW_MARGIN, deriveLightChains, searchlightSlewSec } from '../src/sim/lights.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)
const site = lakesidePark()
const west = site.assets.find((a) => a.id === 'lights-west')!
const spec = west.searchlightBank!
const park = bankHeadBases(west, spec).map(() => LIGHT_PARK_DIR)

function mkShow(cues: Track['cues'], preRollSec = 6): Show {
  return {
    meta: { id: 'solve-lights', title: 'Solve Lights', variant: 'standard', seed: 5 },
    music: tl,
    site,
    catalogId: STARTER_CATALOG_ID,
    tracks: [{ id: 'lights', medium: 'searchlight', name: 'Searchlights', cues }],
    preRollSec,
  }
}

describe('phase-1 slew anticipation', () => {
  it('equals the worst-head arc from park over the rate × margin, and fireSec = target − that', () => {
    const show = mkShow([
      { id: 'fan', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west' },
    ])
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const fan = cues.find((c) => c.id === 'fan')!
    const expected = (30 / spec.slewRateDegPerSec) * LIGHT_SLEW_MARGIN
    expect(fan.anticipationSec).toBeCloseTo(expected, 9)
    expect(fan.fireSec).toBeCloseTo(4 - expected, 9)
    expect(fan.targetSec).toBe(4)
  })

  it('a converge spire from park anticipates the far head\'s arc', () => {
    const show = mkShow([
      {
        id: 'spire',
        effectId: 'light-converge-spire',
        anchor: m.barBeat(5, 1),
        positionId: 'lights-west',
        params: { aimX: 0, aimZ: 160 },
      },
    ])
    const { cues } = solve(show, catalog)
    const spire = cues.find((c) => c.id === 'spire')!
    // Far head at x = −139 aiming at (0, −4, 160) from z = 1.5.
    const farTilt = (Math.atan2(139, 158.5) * 180) / Math.PI
    expect(spire.anticipationSec).toBeCloseTo((farTilt / spec.slewRateDegPerSec) * LIGHT_SLEW_MARGIN, 9)
  })

  it('chains on one bank: the second figure departs from the first figure\'s END aim', () => {
    const show = mkShow([
      { id: 'fan', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west' },
      // Cross lands at 18 s; the fan holds 4–16 s, so the slew fits.
      { id: 'cross', effectId: 'light-cross-violet', anchor: m.barBeat(10, 1), positionId: 'lights-west' },
    ])
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const fan = cues.find((c) => c.id === 'fan')!
    const cross = cues.find((c) => c.id === 'cross')!
    const fanEnd = figureAimsAt(fan, getEffect('light-fan-gold') as never, west, fan.targetSec + fan.durationSec, {
      beats: tl.beats,
    })
    const crossOpen = figureAimsAt(cross, getEffect('light-cross-violet') as never, west, cross.targetSec, {
      beats: tl.beats,
    })
    const expected = searchlightSlewSec(spec, fanEnd, crossOpen)
    expect(expected).toBeGreaterThan(0)
    expect(cross.anticipationSec).toBeCloseTo(expected, 9)
    // Not the park-relative estimate.
    expect(cross.anticipationSec).not.toBeCloseTo(searchlightSlewSec(spec, park, crossOpen), 6)
  })

  it('banks are independent: the same figure on lights-east anticipates from ITS park', () => {
    const show = mkShow([
      { id: 'w', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west' },
      { id: 'e', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-east' },
    ])
    const { cues } = solve(show, catalog)
    expect(cues.find((c) => c.id === 'w')!.anticipationSec).toBeCloseTo(
      cues.find((c) => c.id === 'e')!.anticipationSec,
      9,
    )
  })
})

describe('final chain adoption', () => {
  it('the phase-1 estimate and the adopted chain departure agree when nothing is squeezed', () => {
    const show = mkShow([
      { id: 'fan', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west' },
      { id: 'cross', effectId: 'light-cross-violet', anchor: m.barBeat(10, 1), positionId: 'lights-west' },
      { id: 'sweep', effectId: 'light-sweep-slow', anchor: m.barBeat(3, 1), positionId: 'lights-east', params: { sweepDeg: 20, periodBeats: 8 } },
    ])
    const compiled = compile(show, catalog)
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(compiled.diagnostics.filter((d) => d.code.startsWith('sim/light'))).toEqual([])
    for (const bank of deriveLightChains(compiled, getEffect)) {
      for (const seg of bank.segments) {
        const cue = compiled.cues.find((c) => c.id === seg.cue.id)!
        expect(cue.fireSec).toBeCloseTo(seg.startSec, 9)
        expect(cue.anticipationSec).toBeCloseTo(seg.slewSec, 9)
        // Re-deriving from the compiled cues is a fixpoint.
        expect(seg.startSec).toBeCloseTo(seg.targetSec - seg.slewSec, 9)
      }
    }
  })

  it('a squeezed chain is adopted as-is: fireSec = release, warning on compiled.diagnostics, no error', () => {
    const show = mkShow([
      { id: 'fan', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west' },
      { id: 'pillar', effectId: 'light-pillar-white', anchor: m.barBeat(9, 1), positionId: 'lights-west' }, // 16 s = fan hold end
    ])
    const compiled = compile(show, catalog)
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const warn = compiled.diagnostics.filter((d) => d.code === 'sim/light-slew-short')
    expect(warn).toHaveLength(1)
    const pillar = compiled.cues.find((c) => c.id === 'pillar')!
    expect(pillar.fireSec).toBe(16)
    expect(pillar.anticipationSec).toBe(0)
  })

  it('compiled cues keep the contract order (fireSec, trackId, id) with the adopted departures', () => {
    const show = mkShow([
      { id: 'b', effectId: 'light-pillar-white', anchor: m.barBeat(5, 1), positionId: 'lights-west' },
      { id: 'a', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-east' },
    ])
    const compiled = compile(show, catalog)
    const order = compiled.cues.map((c) => c.id)
    expect(order).toEqual(['a', 'b'])
    for (let i = 1; i < compiled.cues.length; i++) {
      expect(compiled.cues[i]!.fireSec).toBeGreaterThanOrEqual(compiled.cues[i - 1]!.fireSec)
    }
  })
})

describe('NEGATIVE_FIRE exemption', () => {
  it('a figure landing right after the transport start warns (slew-short) instead of failing', () => {
    // preRoll 0, landing 0.1 s in, ±70° fan needs 1.28 s: a ±2-beat shift (1 s) cannot fix it.
    const show = mkShow(
      [
        {
          id: 'early',
          effectId: 'light-fan-gold',
          anchor: m.time(0.1),
          positionId: 'lights-west',
          params: { spreadDeg: 140 },
        },
      ],
      0,
    )
    const compiled = compile(show, catalog)
    expect(compiled.diagnostics.filter((d) => d.code === 'NEGATIVE_FIRE')).toEqual([])
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(compiled.diagnostics.some((d) => d.code === 'sim/light-slew-short')).toBe(true)
    const early = compiled.cues.find((c) => c.id === 'early')!
    expect(early.fireSec).toBe(0)
    expect(early.anticipationSec).toBeCloseTo(early.targetSec, 9)
  })

  it('a pyro cue in the same position is still a NEGATIVE_FIRE error (the exemption is medium-specific)', () => {
    const show: Show = {
      ...mkShow([], 0),
      tracks: [
        { id: 'pyro', medium: 'pyro', name: 'Pyro', cues: [{ id: 'p', effectId: 'peony-75-red', anchor: m.time(0.1), positionId: 'rack-1' }] },
      ],
    }
    const { diagnostics } = solve(show, catalog)
    expect(diagnostics.some((d) => d.code === 'NEGATIVE_FIRE')).toBe(true)
  })
})

describe('builder round-trip', () => {
  it('the fluent facade compiles the same anticipation the solver reports for a hand-built track', () => {
    const b = showBuilder({ id: 'rt', title: 'RT', seed: 5, site: lakesidePark(), catalog }).music(tl).preRoll(6)
    b.lights.figure({ id: 'fan', effect: 'light-fan-gold', position: 'lights-west', land: m.barBeat(3, 1) })
    const viaBuilder = b.build().compiled.cues.find((c) => c.id === 'fan')!
    const viaSolve = solve(
      mkShow([{ id: 'fan', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west' }]),
      catalog,
    ).cues.find((c) => c.id === 'fan')!
    expect(viaBuilder.fireSec).toBeCloseTo(viaSolve.fireSec, 9)
    expect(viaBuilder.anticipationSec).toBeCloseTo(viaSolve.anticipationSec, 9)
  })
})
