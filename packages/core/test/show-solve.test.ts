import { derivePadTimelines } from '../src/sim/drones.js'
import { describe, expect, it } from 'vitest'
import type {
  Cue,
  DronePrimitive,
  MusicalTimeline,
  Show,
  Track,
} from '../src/contracts.js'
import { getEffectFrom, starterCatalog, STARTER_CATALOG_ID } from '../src/catalog/index.js'
import { lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { formationFromEffect, planMorph } from '../src/choreo/index.js'
import { cueSeed } from '../src/math/index.js'
import { quietReport } from '../src/acoustics/index.js'
import {
  compile,
  compiledCueOrder,
  defaultQuietSubstitute,
  droneMorphPlans,
  solve,
} from '../src/show/index.js'

const catalog = starterCatalog()
const odeTl = buildTimelineFromScore(getScore('odeToJoy')!)

function mkShow(tracks: Track[], extra: Partial<Show> = {}, tl: MusicalTimeline = odeTl): Show {
  return {
    meta: { id: 'test-show', title: 'Test Show', variant: 'standard', seed: 7 },
    music: tl,
    site: lakesidePark(),
    catalogId: STARTER_CATALOG_ID,
    tracks,
    ...extra,
  }
}

const pyroTrack = (cues: Cue[]): Track => ({ id: 'pyro', medium: 'pyro', name: 'Pyro', cues })
const droneTrack = (cues: Cue[]): Track => ({ id: 'drones', medium: 'drone', name: 'Drones', cues })

describe('solve — phase 1 identity', () => {
  it('pyro: fireSec = targetSec − riseTimeSec, exactly', () => {
    const show = mkShow([
      pyroTrack([
        { id: 'a', effectId: 'peony-75-red', anchor: { kind: 'barBeat', bar: 6, beat: 1 }, positionId: 'rack-1' },
        { id: 'b', effectId: 'brocade-200-gold', anchor: { kind: 'sec', t: 30 }, positionId: 'rack-2' },
      ]),
    ])
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const a = cues.find((c) => c.id === 'a')!
    const b = cues.find((c) => c.id === 'b')!
    expect(a.targetSec).toBeCloseTo(10, 12) // bar 6 beat 1 = beat 20 @120bpm
    expect(a.anticipationSec).toBe(2.2)
    expect(a.fireSec).toBe(a.targetSec - 2.2)
    expect(b.anticipationSec).toBe(4.2)
    expect(b.fireSec).toBe(30 - 4.2)
    expect(a.seed).toBe(cueSeed(7, 'a'))
    expect(a.durationSec).toBe(1.8)
  })

  it('laser/panel anticipation 0; fabrication 0.1', () => {
    const show = mkShow([
      { id: 'lasers', medium: 'laser', name: 'L', cues: [{ id: 'l', effectId: 'laser-sweep-gold', anchor: { kind: 'sec', t: 10 }, positionId: 'laser-west' }] },
      { id: 'fab', medium: 'fabrication', name: 'F', cues: [{ id: 'f', effectId: 'waterfall-30m', anchor: { kind: 'sec', t: 12 }, positionId: 'rack-3' }] },
    ])
    const { cues } = solve(show, catalog)
    expect(cues.find((c) => c.id === 'l')!.fireSec).toBe(10)
    expect(cues.find((c) => c.id === 'f')!.fireSec).toBeCloseTo(11.9, 12)
  })

  it('unresolvable anchors exclude the cue with ANCHOR_UNRESOLVED', () => {
    const show = mkShow([
      pyroTrack([
        { id: 'bad', effectId: 'peony-75-red', anchor: { kind: 'annotation', type: 'hit', index: 3 }, positionId: 'rack-1' },
        { id: 'ok', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 20 }, positionId: 'rack-1' },
      ]),
    ])
    const { cues, diagnostics } = solve(show, catalog)
    expect(cues.map((c) => c.id)).toEqual(['ok'])
    const diag = diagnostics.find((d) => d.code === 'ANCHOR_UNRESOLVED')!
    expect(diag.severity).toBe('error')
    expect(diag.cueIds).toEqual(['bad'])
  })
})

describe('solve — drone timing adopts the sim pad timelines', () => {
  const ringEffect = catalog.find('ring-formation-60') as DronePrimitive
  const starEffect = catalog.find('star-formation-80') as DronePrimitive
  const params1 = { count: 40, scaleM: 24 }
  const params2 = { count: 40, scaleM: 24, holdSec: 3 }

  it('drone fireSec equals derivePadTimelines segment start (sim is the owner)', () => {
    const show = mkShow([
      droneTrack([
        { id: 'd1', effectId: 'ring-formation-60', anchor: { kind: 'sec', t: 20 }, positionId: 'pad-1', params: params1 },
        { id: 'd2', effectId: 'star-formation-80', anchor: { kind: 'sec', t: 45 }, positionId: 'pad-1', params: params2 },
      ]),
    ])
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const d1 = cues.find((c) => c.id === 'd1')!
    const d2 = cues.find((c) => c.id === 'd2')!
    expect(d1.durationSec).toBe(ringEffect.durationSec) // no holdSec
    expect(d2.durationSec).toBe(starEffect.durationSec + 3) // + holdSec

    // Re-derive with the sim's own function over the solved cues: a fixpoint —
    // the solver already stamped these exact departures.
    const provisional = { show, cues: [...cues].sort(compiledCueOrder), diagnostics: [] }
    const pads = derivePadTimelines(provisional, getEffectFrom(catalog))
    expect(pads).toHaveLength(1)
    const segs = pads[0]!.segments.filter((s) => s.cueId !== undefined)
    expect(segs.map((s) => s.cueId)).toEqual(['d1', 'd2'])
    for (const seg of segs) {
      const c = cues.find((x) => x.id === seg.cueId)!
      expect(c.fireSec).toBeCloseTo(seg.startSec, 12)
      expect(c.anticipationSec).toBeCloseTo(c.targetSec - seg.startSec, 12)
    }
    // Departure never precedes the transport start (clamped, no NEGATIVE_FIRE).
    expect(d1.fireSec).toBeGreaterThanOrEqual(0)
  })

  it('droneMorphPlans still chains formations for phase-1 estimation', () => {
    const show = mkShow([
      droneTrack([
        { id: 'd1', effectId: 'ring-formation-60', anchor: { kind: 'sec', t: 20 }, positionId: 'pad-1', params: params1 },
        { id: 'd2', effectId: 'star-formation-80', anchor: { kind: 'sec', t: 45 }, positionId: 'pad-1', params: params2 },
      ]),
    ])
    const { cues } = solve(show, catalog)
    const plans = droneMorphPlans(cues, show.site, getEffectFrom(catalog))
    expect(plans.size).toBe(2)
    const p1 = plans.get('d1')!
    const p2 = plans.get('d2')!
    expect(p1.from.name).toBe('launch-grid-40')
    expect(p2.from.name).toBe(p1.to.name)
    expect(p1.plan.minTransitionSec).toBeGreaterThan(0)
  })
})

describe('solve — quantize (landings, never fires)', () => {
  it("snaps LANDING times to the grid and recomputes fireSec", () => {
    const show = mkShow([
      pyroTrack([
        { id: 'q', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 10.2 }, positionId: 'rack-1' },
      ]),
    ])
    const beat = solve(show, catalog, { quantize: 'beat' }).cues[0]!
    expect(beat.targetSec).toBe(10) // nearest beat @120bpm
    expect(beat.fireSec).toBe(10 - 2.2)
    const bar = solve(show, catalog, { quantize: 'bar' }).cues[0]!
    expect(bar.targetSec).toBe(10) // bar 6 downbeat
    const none = solve(show, catalog).cues[0]!
    expect(none.targetSec).toBe(10.2)
  })
})

describe('solve — NEGATIVE_FIRE and forward shift', () => {
  it('shifts the landing forward by whole beats when the budget allows', () => {
    const show = mkShow([
      pyroTrack([
        { id: 'early', effectId: 'peony-75-red', anchor: { kind: 'beat', beat: 1 }, positionId: 'rack-1' },
      ]),
    ])
    // beat 1 = 0.5 s, fire = −1.7 s. Default maxShiftBeats 2 (max landing 1.5 s) fails…
    const strict = solve(show, catalog)
    expect(strict.diagnostics.some((d) => d.code === 'NEGATIVE_FIRE')).toBe(true)
    expect(strict.diagnostics.find((d) => d.code === 'NEGATIVE_FIRE')!.message).toContain(
      'earliest feasible landing is t=2.200s',
    )
    // …a budget of 5 beats lands at 2.5 s (fire 0.3 s ≥ 0): resolved.
    const relaxed = solve(show, catalog, { maxShiftBeats: 5 })
    expect(relaxed.diagnostics.filter((d) => d.code === 'NEGATIVE_FIRE')).toEqual([])
    const cue = relaxed.cues.find((c) => c.id === 'early')!
    expect(cue.targetSec).toBeCloseTo(2.5, 12)
    expect(cue.fireSec).toBeCloseTo(0.3, 12)
  })

  it('preRollSec makes early fires legal without shifting', () => {
    const show = mkShow(
      [pyroTrack([{ id: 'early', effectId: 'peony-75-red', anchor: { kind: 'beat', beat: 1 }, positionId: 'rack-1' }])],
      { preRollSec: 3 },
    )
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.code === 'NEGATIVE_FIRE')).toEqual([])
    const cue = cues.find((c) => c.id === 'early')!
    expect(cue.targetSec).toBeCloseTo(0.5, 12)
    expect(cue.fireSec).toBeCloseTo(-1.7, 12)
  })

  it('never shifts across a phrase annotation', () => {
    const tl: MusicalTimeline = {
      source: 'analysis',
      id: 'phrase-guard',
      title: 'Phrase Guard',
      duration: 12,
      tempo: { segments: [{ beat: 0, bpm: 60 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
      beats: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      downbeats: [0, 4, 8],
      annotations: [{ time: 2.5, kind: 'phrase', strength: 0.6, label: 'phraseEnd' }],
      energy: [],
      tempoConfidence: 1,
    }
    const show = mkShow(
      [pyroTrack([{ id: 'pinned', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 2 }, positionId: 'rack-1' }])],
      {},
      tl,
    )
    // fire = −0.2; +1 beat lands at 3.0 which crosses the phrase at 2.5 → refused.
    const { cues, diagnostics } = solve(show, catalog, { maxShiftBeats: 4 })
    expect(diagnostics.some((d) => d.code === 'NEGATIVE_FIRE')).toBe(true)
    expect(cues.find((c) => c.id === 'pinned')!.targetSec).toBe(2)
  })
})

describe('solve — pin capacity', () => {
  const nine = Array.from({ length: 9 }, (_, i): Cue => ({
    id: `p${i}`,
    effectId: 'peony-75-red',
    anchor: { kind: 'sec', t: 10 },
    positionId: 'rack-1',
  }))

  it('9 simultaneous cues on an 8-pin rack: the offender shifts +1 beat, deterministically', () => {
    const show = mkShow([pyroTrack(nine)])
    const { cues, diagnostics } = solve(show, catalog)
    expect(diagnostics.filter((d) => d.code === 'PIN_CAPACITY')).toEqual([])
    // Exact landing times: p0..p7 stay at 10 s, p8 (last in fire-then-id order) at 10.5 s.
    for (let i = 0; i < 8; i++) {
      expect(cues.find((c) => c.id === `p${i}`)!.targetSec).toBe(10)
    }
    expect(cues.find((c) => c.id === 'p8')!.targetSec).toBeCloseTo(10.5, 12)
  })

  it('maxShiftBeats 0 leaves the PIN_CAPACITY error in place', () => {
    const show = mkShow([pyroTrack(nine)])
    const { diagnostics } = solve(show, catalog, { maxShiftBeats: 0 })
    const pin = diagnostics.filter((d) => d.code === 'PIN_CAPACITY')
    expect(pin.length).toBe(1)
    expect(pin[0]!.severity).toBe('error')
    expect(pin[0]!.cueIds).toContain('p8')
  })

  it('emits RAPID_REFIRE warnings for close fires on one position', () => {
    const show = mkShow([
      pyroTrack([
        { id: 'r1', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 10 }, positionId: 'rack-2' },
        { id: 'r2', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 11 }, positionId: 'rack-2' },
      ]),
    ])
    const { diagnostics } = solve(show, catalog)
    const warn = diagnostics.find((d) => d.code === 'RAPID_REFIRE')!
    expect(warn.severity).toBe('warning')
    expect(warn.cueIds).toEqual(['r1', 'r2'])
  })
})

describe('solve — drone overlap', () => {
  it('shifts the lower-priority cue; unresolvable overlaps stay errors', () => {
    // Two 12 s grid formations 1 s apart on one pad — hopeless within ±2 beats.
    const show = mkShow([
      droneTrack([
        { id: 'g1', effectId: 'ring-formation-60', anchor: { kind: 'sec', t: 20 }, positionId: 'pad-1', params: { count: 30, scaleM: 20 }, priority: 5 },
        { id: 'g2', effectId: 'ring-formation-60', anchor: { kind: 'sec', t: 21 }, positionId: 'pad-1', params: { count: 30, scaleM: 20 } },
      ]),
    ])
    const { diagnostics } = solve(show, catalog)
    const overlap = diagnostics.filter((d) => d.code === 'DRONE_OVERLAP')
    expect(overlap.length).toBeGreaterThan(0)
    expect(overlap[0]!.severity).toBe('error')
  })
})

describe('solve — SPL budget', () => {
  const salutes = (['rack-1', 'rack-2', 'rack-3'] as const).map(
    (rack, i): Cue => ({
      id: `s${i}`,
      effectId: 'salute-100',
      anchor: { kind: 'sec', t: 10 + 10 * i },
      positionId: rack,
    }),
  )

  it('defaultQuietSubstitute picks the low-noise entry (lowest noise, ≤ caliber)', () => {
    const sub = defaultQuietSubstitute(catalog)
    expect(sub('salute-100')).toBe('comet-30-gold')
    expect(sub('comet-30-gold')).toBeUndefined() // nothing ≥10 dB quieter
  })

  it('budget 85 at the 190 m listeners: salutes are substituted and the show passes', () => {
    const show = mkShow([pyroTrack(salutes)], { noiseBudget: { maxSplDb: 85 } })
    const compiled = compile(show, catalog)
    expect(compiled.diagnostics.filter((d) => d.code === 'SPL_BUDGET' && d.severity === 'error')).toEqual([])
    const warns = compiled.diagnostics.filter((d) => d.code === 'SPL_BUDGET')
    expect(warns.length).toBe(3)
    for (const w of warns) expect(w.message).toContain("→ 'comet-30-gold'")
    for (const c of compiled.cues) expect(c.effectId).toBe('comet-30-gold')
    // The result genuinely meets the budget.
    const report = quietReport(compiled, getEffectFrom(catalog), 85)
    expect(report.pass).toBe(true)
  })

  it('negative control: without the budget the salutes stay and 85 dB fails', () => {
    const show = mkShow([pyroTrack(salutes)])
    const compiled = compile(show, catalog)
    expect(compiled.cues.every((c) => c.effectId === 'salute-100')).toBe(true)
    const report = quietReport(compiled, getEffectFrom(catalog), 85)
    expect(report.pass).toBe(false)
    expect(report.peakDb).toBeGreaterThan(100)
  })

  it('a substitute-less pipeline drops the cue with a warning instead', () => {
    const show = mkShow([pyroTrack([salutes[0]!])], { noiseBudget: { maxSplDb: 85 } })
    const { cues, diagnostics } = solve(show, catalog, { substitute: () => undefined })
    expect(cues).toEqual([])
    const warn = diagnostics.find((d) => d.code === 'SPL_BUDGET')!
    expect(warn.severity).toBe('warning')
    expect(warn.message).toContain('dropped')
  })
})

describe('solve — determinism', () => {
  it('two identical solves are JSON-identical', () => {
    const show = mkShow([
      pyroTrack([
        { id: 'a', effectId: 'peony-75-red', anchor: { kind: 'barBeat', bar: 6, beat: 1 }, positionId: 'rack-1' },
      ]),
      droneTrack([
        { id: 'd1', effectId: 'bloom-formation-120', anchor: { kind: 'sec', t: 30 }, positionId: 'pad-1', params: { count: 50, scaleM: 24 } },
      ]),
    ])
    expect(JSON.stringify(solve(show, catalog))).toBe(JSON.stringify(solve(show, catalog)))
  })
})

describe('solve — hardware gates re-verified after SPL substitution (phase 2f)', () => {
  it('substitution that recreates a pin-capacity violation surfaces as a diagnostic', () => {
    // rack-1 allows 8 simultaneous pins. Pre-substitution fires: salute at
    // 7.2 s (2.8 s rise) + 8 comets at 8.8 s (1.2 s rise) — exactly 8
    // simultaneous, so phase 2c passes. The 85 dB budget then substitutes
    // the salute for a comet, moving its fire to 8.8 s: NINE simultaneous.
    // Before the phase-2f re-check this compiled with ZERO pin diagnostics.
    const cues: Cue[] = [
      { id: 'boom', effectId: 'salute-100', anchor: { kind: 'sec', t: 10 }, positionId: 'rack-1' },
    ]
    for (let i = 0; i < 8; i++) {
      cues.push({
        id: `c${i}`,
        effectId: 'comet-30-gold',
        anchor: { kind: 'sec', t: 10 },
        positionId: 'rack-1',
      })
    }
    const show = mkShow([pyroTrack(cues)], { noiseBudget: { maxSplDb: 85 } })
    const { cues: compiled, diagnostics } = solve(show, catalog, { maxShiftBeats: 0 })
    const boom = compiled.find((c) => c.id === 'boom')!
    expect(boom.effectId).toBe('comet-30-gold') // substitution happened
    expect(boom.fireSec).toBeCloseTo(8.8, 9)
    expect(diagnostics.some((d) => d.code === 'PIN_CAPACITY')).toBe(true)
  })
})
