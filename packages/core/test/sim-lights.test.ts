/**
 * Searchlight bank chains + per-step head states (sim/lights.ts), the single
 * owner of head slews: departure = landing − slew, honest late arrival when
 * squeezed, hold truncation on overlap, strike/fade envelopes, color cycling,
 * and the engine integration (snapshot.lights, stats, warnings).
 */
import { describe, expect, it } from 'vitest'
import type { CompiledShow, MusicAnchor } from '../src/contracts.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import {
  LIGHT_PARK_DIR,
  angleBetweenDeg,
  bankHeadBases,
  figureAimsAt,
  tiltDegOf,
} from '../src/choreo/generators/searchlight.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import type { ShowBuilder } from '../src/show/index.js'
import { SimEngine, runHeadless } from '../src/sim/index.js'
import {
  LIGHT_FADE_SEC,
  LIGHT_SLEW_MARGIN,
  LIGHT_STRIKE_SEC,
  deriveLightChains,
  lampEnvelope,
  lightArrivalLagSecMax,
  lightStatesAt,
  searchlightSlewSec,
  slewProgress,
} from '../src/sim/lights.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)
const site = lakesidePark()
const west = site.assets.find((a) => a.id === 'lights-west')!
const spec = west.searchlightBank!

/** Fresh builder over lakesidePark + odeToJoy (120 bpm: barBeat(3,1) = 4 s). */
function builder(preRoll = 6): ShowBuilder {
  return showBuilder({ id: 'lights-sim', title: 'Lights Sim', seed: 11, site: lakesidePark(), catalog })
    .music(tl)
    .preRoll(preRoll)
}

/** A fan on lights-west landing at 4 s (park → ±30° = 0.55 s of slew). */
function fanAt4(b: ShowBuilder): void {
  b.lights.figure({ id: 'fan', effect: 'light-fan-gold', position: 'lights-west', land: m.barBeat(3, 1) })
}

const FAN_SLEW = (30 / spec.slewRateDegPerSec) * LIGHT_SLEW_MARGIN // 0.55 s

describe('searchlightSlewSec', () => {
  it('is the worst head arc over the rate with the margin, 0 for an identical aim set', () => {
    const park = bankHeadBases(west, spec).map(() => LIGHT_PARK_DIR)
    const fan = figureAimsAt(
      { id: 'x', trackId: 'lights', medium: 'searchlight', effectId: 'light-fan-gold', positionId: west.id, targetSec: 0, fireSec: 0, anticipationSec: 0, durationSec: 1, seed: 1 },
      catalog.get('light-fan-gold') as never,
      west,
      0,
    )
    expect(searchlightSlewSec(spec, park, fan)).toBeCloseTo(FAN_SLEW, 9)
    expect(searchlightSlewSec(spec, fan, fan)).toBe(0)
    expect(searchlightSlewSec({ ...spec, slewRateDegPerSec: 0 }, park, fan)).toBe(0)
  })
})

describe('deriveLightChains', () => {
  it('chains a single fan from park: departure = landing − slew, arrival ON the landing', () => {
    const b = builder()
    fanAt4(b)
    const { compiled } = b.build()
    const chains = deriveLightChains(compiled, getEffect)
    expect(chains).toHaveLength(1)
    const bank = chains[0]!
    expect(bank.bankId).toBe('lights-west')
    expect(bank.diagnostics).toEqual([])
    expect(bank.segments).toHaveLength(1)
    const seg = bank.segments[0]!
    expect(seg.targetSec).toBe(4)
    expect(seg.slewSec).toBeCloseTo(FAN_SLEW, 9)
    expect(seg.startSec).toBeCloseTo(4 - FAN_SLEW, 9)
    expect(seg.arriveSec).toBeCloseTo(4, 9)
    expect(seg.holdEndSec).toBe(16)
    for (const d of seg.fromDirs) expect(d).toEqual(LIGHT_PARK_DIR)
    expect(seg.toDirs.map((d) => Math.round(tiltDegOf(d)))).toEqual([30, 10, 10, 30])
    // The solver adopted this departure as the cue's fireSec.
    const cue = compiled.cues.find((c) => c.id === 'fan')!
    expect(cue.fireSec).toBeCloseTo(seg.startSec, 9)
    expect(cue.anticipationSec).toBeCloseTo(FAN_SLEW, 9)
    expect(lightArrivalLagSecMax(chains)).toBe(0)
  })

  it('a second figure departs from the first figure\'s END aim, unsqueezed when the gap allows', () => {
    const b = builder()
    fanAt4(b)
    // Back to a pillar (fan ends at 16 s): ±30° → up = 0.55 s; landing at 18 s leaves room.
    b.lights.figure({ id: 'pillar', effect: 'light-pillar-white', position: 'lights-west', land: m.barBeat(10, 1) })
    const { compiled } = b.build()
    const [bank] = deriveLightChains(compiled, getEffect)
    expect(bank!.segments).toHaveLength(2)
    const [fan, pillar] = bank!.segments
    expect(pillar!.targetSec).toBe(18)
    expect(pillar!.fromDirs.map((d) => Math.round(tiltDegOf(d)))).toEqual([30, 10, 10, 30])
    expect(pillar!.slewSec).toBeCloseTo(FAN_SLEW, 9)
    expect(pillar!.startSec).toBeCloseTo(18 - FAN_SLEW, 9)
    expect(fan!.holdEndSec).toBe(16) // untouched
    expect(bank!.diagnostics).toEqual([])
    expect(compiled.cues.find((c) => c.id === 'pillar')!.fireSec).toBeCloseTo(pillar!.startSec, 9)
  })

  it('a landing right at the previous hold end squeezes the slew: warned, departs on release, arrives late', () => {
    const b = builder()
    fanAt4(b)
    b.lights.figure({ id: 'pillar', effect: 'light-pillar-white', position: 'lights-west', land: m.barBeat(9, 1) }) // 16 s
    const { compiled } = b.build()
    const [bank] = deriveLightChains(compiled, getEffect)
    const pillar = bank!.segments[1]!
    expect(pillar.startSec).toBe(16) // released only when the fan's hold ends
    expect(pillar.arriveSec).toBeCloseTo(16 + FAN_SLEW, 9)
    expect(bank!.diagnostics.map((d) => d.code)).toEqual(['sim/light-slew-short'])
    expect(bank!.diagnostics[0]!.severity).toBe('warning')
    expect(bank!.diagnostics[0]!.cueIds).toEqual(['pillar'])
    expect(lightArrivalLagSecMax([bank!])).toBeCloseTo(FAN_SLEW, 9)
    // The solver adopted the clamped departure: zero anticipation, no error.
    const cue = compiled.cues.find((c) => c.id === 'pillar')!
    expect(cue.fireSec).toBe(16)
    expect(cue.anticipationSec).toBe(0)
    expect(compiled.diagnostics.some((d) => d.code === 'sim/light-slew-short')).toBe(true)
    // Honest states: still slewing AT the landing, on the figure by arrival.
    const atLanding = lightStatesAt([bank!], 16.1, { beats: tl.beats }).filter((s) => s.cueIdx === pillar.cueIdx)
    expect(atLanding).toHaveLength(4)
    expect(atLanding.every((s) => s.slewing)).toBe(true)
    const arrived = lightStatesAt([bank!], pillar.arriveSec + 1e-6, { beats: tl.beats }).filter(
      (s) => s.cueIdx === pillar.cueIdx,
    )
    expect(arrived.every((s) => !s.slewing && angleBetweenDeg(s.dir, LIGHT_PARK_DIR) < 1e-6)).toBe(true)
  })

  it('a landing INSIDE the previous hold truncates that hold at the ideal departure and warns', () => {
    const b = builder()
    fanAt4(b)
    b.lights.figure({ id: 'pillar', effect: 'light-pillar-white', position: 'lights-west', land: m.barBeat(6, 1) }) // 10 s
    const { compiled } = b.build()
    const [bank] = deriveLightChains(compiled, getEffect)
    const [fan, pillar] = bank!.segments
    expect(fan!.holdEndSec).toBeCloseTo(10 - FAN_SLEW, 9)
    expect(pillar!.startSec).toBeCloseTo(10 - FAN_SLEW, 9)
    expect(pillar!.arriveSec).toBeCloseTo(10, 9)
    expect(bank!.diagnostics.map((d) => d.code)).toEqual(['sim/light-overlap'])
    expect(bank!.diagnostics[0]!.cueIds).toEqual(['fan', 'pillar'])
    // At 9.7 s only the pillar's heads are active (the fan released them).
    const states = lightStatesAt([bank!], 9.7, { beats: tl.beats })
    expect(new Set(states.map((s) => s.cueIdx))).toEqual(new Set([pillar!.cueIdx]))
  })

  it('never departs before the transport start; a squeeze there is warned, not an error', () => {
    // preRoll 0 and a landing 0.1 s in: a ±70° fan needs 1.28 s, more than a
    // ±2-beat landing shift can buy, so the departure clamps to t0.
    const b = builder(0)
    b.lights.figure({ id: 'early', effect: 'light-fan-gold', position: 'lights-west', land: m.time(0.1), spreadDeg: 140 })
    const { compiled } = b.build()
    const [bank] = deriveLightChains(compiled, getEffect)
    const seg = bank!.segments[0]!
    expect(seg.targetSec).toBe(0.1)
    expect(seg.startSec).toBe(0)
    expect(seg.arriveSec).toBeCloseTo((70 / spec.slewRateDegPerSec) * LIGHT_SLEW_MARGIN, 9)
    expect(bank!.diagnostics.map((d) => d.code)).toEqual(['sim/light-slew-short'])
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('groups by bank and orders banks by id', () => {
    const b = builder()
    b.lights.figure({ id: 'e', effect: 'light-pillar-white', position: 'lights-east', land: m.barBeat(5, 1) })
    fanAt4(b)
    const chains = deriveLightChains(b.build().compiled, getEffect)
    expect(chains.map((c) => c.bankId)).toEqual(['lights-east', 'lights-west'])
    expect(chains[0]!.bases[0]!.x).toBe(121)
  })
})

describe('slewProgress / lampEnvelope', () => {
  it('progress runs 0→1 over slewSec and snaps to 1 within float noise; 1 with no slew', () => {
    const seg = { startSec: 3.45, slewSec: 0.55 }
    expect(slewProgress(seg, 3.45)).toBe(0)
    expect(slewProgress(seg, 3.725)).toBeCloseTo(0.5, 9)
    expect(slewProgress(seg, 4 - 1e-12)).toBe(1)
    expect(slewProgress(seg, 9)).toBe(1)
    expect(slewProgress({ startSec: 1, slewSec: 0 }, 1)).toBe(1)
  })

  it('strikes over LIGHT_STRIKE_SEC and fades over the last LIGHT_FADE_SEC', () => {
    const seg = { startSec: 10, targetSec: 11, holdEndSec: 20 }
    expect(lampEnvelope(seg, 10)).toBe(0)
    expect(lampEnvelope(seg, 10 + LIGHT_STRIKE_SEC / 2)).toBeCloseTo(0.5, 9)
    expect(lampEnvelope(seg, 15)).toBe(1)
    expect(lampEnvelope(seg, 20 - LIGHT_FADE_SEC / 2)).toBeCloseTo(0.5, 9)
    expect(lampEnvelope(seg, 20)).toBe(0)
  })

  it('a strike shorter than LIGHT_STRIKE_SEC still completes BY the landing; zero slew pops on at it', () => {
    const quick = { startSec: 10, targetSec: 10.1, holdEndSec: 20 }
    expect(lampEnvelope(quick, 10.05)).toBeCloseTo(0.5, 9)
    expect(lampEnvelope(quick, 10.1)).toBe(1)
    const pop = { startSec: 10, targetSec: 10, holdEndSec: 20 }
    expect(lampEnvelope(pop, 10 - 1e-9)).toBe(0)
    expect(lampEnvelope(pop, 10)).toBe(1)
  })
})

describe('lightStatesAt', () => {
  const b = builder()
  fanAt4(b)
  b.lights.figure({
    id: 'chase',
    effect: 'light-chase-beat',
    position: 'lights-east',
    land: m.barBeat(3, 1),
    periodBeats: 8,
    rgb: [0.2, 0.4, 1],
  })
  const { compiled } = b.build()
  const chains = deriveLightChains(compiled, getEffect)
  const at = (t: number) => lightStatesAt(chains, t, { beats: tl.beats })
  const fanIdx = compiled.cues.findIndex((c) => c.id === 'fan')
  const chaseIdx = compiled.cues.findIndex((c) => c.id === 'chase')

  it('is empty before departure and after the hold; one state per head while active', () => {
    expect(at(3)).toEqual([])
    expect(at(3.5).filter((s) => s.cueIdx === fanIdx)).toHaveLength(4)
    expect(at(15.9).filter((s) => s.cueIdx === fanIdx)).toHaveLength(4)
    expect(at(16).filter((s) => s.cueIdx === fanIdx)).toEqual([])
    const s = at(8).find((x) => x.cueIdx === fanIdx)!
    expect(s.assetId).toBe('lights-west')
    expect(s.reachM).toBe(600)
    expect(s.halfAngleDeg).toBe(1.25)
  })

  it('slews along the great circle from park and is ON the figure at the landing with no seam', () => {
    const start = 4 - FAN_SLEW
    const mid = at(start + FAN_SLEW / 2).filter((s) => s.cueIdx === fanIdx)
    expect(mid.every((s) => s.slewing)).toBe(true)
    expect(tiltDegOf(mid[0]!.dir)).toBeCloseTo(15, 6)
    const justBefore = at(4 - 1e-7).filter((s) => s.cueIdx === fanIdx)
    const landed = at(4).filter((s) => s.cueIdx === fanIdx)
    expect(landed.every((s) => !s.slewing)).toBe(true)
    const figure = figureAimsAt(compiled.cues[fanIdx]!, catalog.get('light-fan-gold') as never, west, 4)
    landed.forEach((s, i) => {
      expect(angleBetweenDeg(s.dir, figure[i]!)).toBeLessThan(1e-9)
      expect(angleBetweenDeg(justBefore[i]!.dir, figure[i]!)).toBeLessThan(1e-3)
    })
  })

  it('applies the strike and fade envelopes to intensity', () => {
    const start = 4 - FAN_SLEW
    expect(at(start + 0.1).find((s) => s.cueIdx === fanIdx)!.intensity).toBeCloseTo(0.1 / LIGHT_STRIKE_SEC, 9)
    expect(at(8).find((s) => s.cueIdx === fanIdx)!.intensity).toBe(1)
    expect(at(16 - 0.25).find((s) => s.cueIdx === fanIdx)!.intensity).toBeCloseTo(0.5, 9)
  })

  it('cycles the effect colors by head, or takes the params.rgb override', () => {
    const fan = at(8).filter((s) => s.cueIdx === fanIdx)
    // light-fan-gold: ['#ffd27a', '#ffb84d'] → heads 0/2 first, 1/3 second.
    expect(fan.map((s) => Math.round(s.g * 255))).toEqual([0xd2, 0xb8, 0xd2, 0xb8])
    const chase = at(8).filter((s) => s.cueIdx === chaseIdx)
    for (const s of chase) {
      expect([s.r, s.g, s.b]).toEqual([0.2, 0.4, 1])
    }
  })

  it('chase: all heads lit while arriving, then one lit head per period/heads and the rest idle', () => {
    // Chase from park needs no slew (pillar aims): arrives at 4 exactly.
    const t4 = at(4).filter((s) => s.cueIdx === chaseIdx)
    expect(t4.map((s) => s.intensity)).toEqual([1, 0.15, 0.15, 0.15])
    const t5 = at(5).filter((s) => s.cueIdx === chaseIdx)
    expect(t5.map((s) => s.intensity)).toEqual([0.15, 1, 0.15, 0.15])
    const t7 = at(7.5).filter((s) => s.cueIdx === chaseIdx)
    expect(t7.map((s) => s.intensity)).toEqual([0.15, 0.15, 0.15, 1])
  })

  it('is deterministic: two independent builds give byte-identical chains and states', () => {
    const build = (): CompiledShow => {
      const bb = builder()
      fanAt4(bb)
      bb.lights.figure({ id: 'chase', effect: 'light-chase-beat', position: 'lights-east', land: m.barBeat(3, 1), periodBeats: 8, rgb: [0.2, 0.4, 1] })
      return bb.build().compiled
    }
    const a = build()
    const c = build()
    const ca = deriveLightChains(a, getEffect)
    const cc = deriveLightChains(c, getEffect)
    expect(JSON.stringify(ca)).toBe(JSON.stringify(cc))
    for (const t of [3.6, 4, 9.25, 15.9]) {
      expect(JSON.stringify(lightStatesAt(ca, t, { beats: a.show.music.beats }))).toBe(
        JSON.stringify(lightStatesAt(cc, t, { beats: c.show.music.beats })),
      )
    }
  })
})

describe('engine integration', () => {
  it('packs snapshot.lights, tracks peakActiveLights, and surfaces chain warnings', () => {
    const b = builder()
    fanAt4(b)
    b.lights.figure({ id: 'pillar', effect: 'light-pillar-white', position: 'lights-west', land: m.barBeat(9, 1) }) // squeezed
    const { compiled } = b.build()
    const engine = new SimEngine(compiled)
    engine.advanceTo(3)
    expect(engine.snapshot().lights).toEqual([])
    engine.advanceTo(8)
    const snap = engine.snapshot()
    expect(snap.lights).toHaveLength(4)
    expect(snap.lights[0]!.assetId).toBe('lights-west')
    expect(engine.warnings().map((d) => d.code)).toContain('sim/light-slew-short')
    const { stats } = runHeadless(compiled, { toSec: 30 })
    expect(stats.peakActiveLights).toBe(4)
    expect(stats.peakActiveJets).toBe(0)
  })

  it('seek and chunked advance agree on head states (pure functions of t)', () => {
    const b = builder()
    fanAt4(b)
    const { compiled } = b.build()
    const a = new SimEngine(compiled)
    a.advanceTo(3.7)
    const chunked = JSON.stringify(a.snapshot().lights)
    const c = new SimEngine(compiled)
    c.advanceTo(12)
    c.advanceTo(3.7) // backward → re-sim from t0
    expect(JSON.stringify(c.snapshot().lights)).toBe(chunked)
  })

  it('an anchor helper is a MusicAnchor (type smoke)', () => {
    const a: MusicAnchor = m.barBeat(3, 1)
    expect(a.kind).toBe('barBeat')
  })
})
