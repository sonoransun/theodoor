import { describe, expect, it } from 'vitest'
import { chase, fan, finaleBarrage, offsetAnchor, ripple, volley } from '../src/choreo/index.js'
import type { EffectDef, MusicAnchor, MusicalTimeline, PyroEffect } from '../src/contracts.js'

const beatAnchor = (beat: number): MusicAnchor => ({ kind: 'beat', beat })

const offsetOf = (a: MusicAnchor): number =>
  a.kind === 'sec' ? 0 : (a.offsetBeats ?? 0)

function makeTimeline(annotations: MusicalTimeline['annotations']): MusicalTimeline {
  return {
    source: 'score',
    id: 'test',
    title: 'Test',
    duration: 70,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats: [],
    downbeats: [],
    annotations,
    energy: [],
    tempoConfidence: 1,
  }
}

const pyroFx = (id: string, caliberMm: number): PyroEffect => ({
  id,
  name: id,
  medium: 'pyro',
  tags: [],
  noiseDbAt15m: 100,
  durationSec: 2,
  category: 'peony',
  caliberMm,
  riseTimeSec: 2,
  burstHeightM: 100,
  burstRadiusM: 30,
  starCount: 100,
  colors: ['#ffffff'],
  dragK: 0.5,
  gravityBias: 0,
  minAudienceDistanceM: 100,
})

describe('offsetAnchor', () => {
  it('accumulates offsets on beat-like anchors and rejects sec anchors', () => {
    const a = offsetAnchor({ kind: 'beat', beat: 8, offsetBeats: 1 }, 0.5)
    expect(a).toEqual({ kind: 'beat', beat: 8, offsetBeats: 1.5 })
    expect(offsetAnchor({ kind: 'sec', t: 10 }, 0)).toEqual({ kind: 'sec', t: 10 })
    expect(() => offsetAnchor({ kind: 'sec', t: 10 }, 1)).toThrow()
  })
})

describe('volley / fan / chase / ripple', () => {
  it('chase steps by stepBeats with sequential ids', () => {
    const cues = chase({
      effect: 'comet-s',
      positionIds: ['p1', 'p2', 'p3', 'p4'],
      startLand: beatAnchor(32),
      stepBeats: 0.5,
    })
    expect(cues.map((c) => c.id)).toEqual(['chase-000', 'chase-001', 'chase-002', 'chase-003'])
    cues.forEach((c, i) => {
      expect(c.effectId).toBe('comet-s')
      expect(c.positionId).toBe(`p${i + 1}`)
      expect(c.anchor.kind).toBe('beat')
      expect(offsetOf(c.anchor)).toBeCloseTo(i * 0.5, 12)
    })
  })

  it('volley cycles effects and staggers landings', () => {
    const cues = volley({
      effects: ['peony-a', 'peony-b'],
      positionIds: ['r1', 'r2', 'r3'],
      land: beatAnchor(16),
      staggerBeats: 0.25,
      priority: 2,
    })
    expect(cues.map((c) => c.effectId)).toEqual(['peony-a', 'peony-b', 'peony-a'])
    expect(cues.map((c) => offsetOf(c.anchor))).toEqual([0, 0.25, 0.5])
    for (const c of cues) expect(c.priority).toBe(2)
  })

  it('fan lands every position on the same anchor', () => {
    const cues = fan({ effect: 'comet-w', positionIds: ['a', 'b', 'c'], land: beatAnchor(4) })
    for (const c of cues) expect(c.anchor).toEqual(beatAnchor(4))
    expect(cues.map((c) => c.id)).toEqual(['fan-000', 'fan-001', 'fan-002'])
  })

  it('ripple spreads outward from the center position', () => {
    const cues = ripple({
      effect: 'mine-s',
      positionIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      land: beatAnchor(8),
      stepBeats: 1,
    })
    expect(cues.map((c) => offsetOf(c.anchor))).toEqual([2, 1, 0, 1, 2])
  })
})

describe('finaleBarrage', () => {
  const timeline = makeTimeline([
    { time: 30, kind: 'climax', strength: 0.9 },
    { time: 10, kind: 'accent', strength: 0.5 },
    { time: 60, kind: 'climax', strength: 1 },
  ])
  const calibers: Record<string, number> = { 'sh-050': 50, 'sh-100': 100, 'sh-150': 150 }
  const getEffect = (id: string): EffectDef | undefined =>
    id in calibers ? pyroFx(id, calibers[id]!) : undefined

  const cues = finaleBarrage({
    timeline,
    effectPool: ['sh-150', 'sh-050', 'sh-100'], // deliberately unordered
    positionIds: ['r1', 'r2', 'r3'],
    windowSec: 20,
    startRateHz: 1,
    endRateHz: 8,
    getEffect,
  })

  it('density is monotone nondecreasing toward the climax', () => {
    const times: number[] = []
    for (const c of cues) {
      if (c.anchor.kind === 'sec') times.push(c.anchor.t)
    }
    times.push(60) // the final annotation-anchored cue lands on the climax
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!)
    const gaps = times.slice(1).map((t, i) => t - times[i]!)
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]!).toBeLessThanOrEqual(gaps[i - 1]! + 1e-9)
    }
    // Roughly integral of d(t) over the window: 20 * (1 + 7/3) = 66 cues.
    expect(cues.length).toBeGreaterThan(50)
  })

  it('last cue lands exactly on the max-strength climax annotation', () => {
    const last = cues[cues.length - 1]!
    expect(last.anchor).toEqual({ kind: 'annotation', type: 'climax', index: 1 })
    expect(last.effectId).toBe('sh-150') // largest caliber
  })

  it('ramps calibers small to large and cycles positions', () => {
    expect(cues[0]!.effectId).toBe('sh-050') // smallest after getEffect sort
    expect(cues[0]!.anchor).toEqual({ kind: 'sec', t: 40 })
    cues.forEach((c, i) => expect(c.positionId).toBe(`r${(i % 3) + 1}`))
    // Caliber sequence is nondecreasing across the window.
    const order = cues.map((c) => calibers[c.effectId]!)
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!).toBeGreaterThanOrEqual(order[i - 1]!)
    }
    expect(cues.map((c) => c.id.startsWith('finale-')).every(Boolean)).toBe(true)
  })

  it('is deterministic and validates inputs', () => {
    const again = finaleBarrage({
      timeline,
      effectPool: ['sh-150', 'sh-050', 'sh-100'],
      positionIds: ['r1', 'r2', 'r3'],
      windowSec: 20,
      startRateHz: 1,
      endRateHz: 8,
      getEffect,
    })
    expect(again).toEqual(cues)
    expect(() =>
      finaleBarrage({
        timeline: makeTimeline([]),
        effectPool: ['sh-050'],
        positionIds: ['r1'],
        windowSec: 10,
        startRateHz: 1,
        endRateHz: 4,
      }),
    ).toThrow(/climax/)
  })

  it('clamps the window at t = 0 for early climaxes', () => {
    const early = makeTimeline([{ time: 3, kind: 'climax', strength: 1 }])
    const c = finaleBarrage({
      timeline: early,
      effectPool: ['sh-050', 'sh-100'],
      positionIds: ['r1'],
      windowSec: 20,
      startRateHz: 1,
      endRateHz: 4,
    })
    for (const cue of c) {
      if (cue.anchor.kind === 'sec') expect(cue.anchor.t).toBeGreaterThanOrEqual(0)
    }
    expect(c[c.length - 1]!.anchor.kind).toBe('annotation')
  })
})
