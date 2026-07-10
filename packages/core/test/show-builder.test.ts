import { describe, expect, it } from 'vitest'
import type { Cue, MusicAnchor } from '../src/contracts.js'
import { starterCatalog } from '../src/catalog/index.js'
import { lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { musicRefs, resolveAnchor, showBuilder } from '../src/show/index.js'
import type { BuildResult } from '../src/show/index.js'

const catalog = starterCatalog()
const score = getScore('odeToJoy')!
const tl = buildTimelineFromScore(score)
const m = musicRefs(tl)

/** The ~30-cue mini-show: every builder sugar method exercised once. */
function buildMiniShow(): BuildResult {
  const b = showBuilder({
    id: 'mini',
    title: 'Ode Mini Show',
    seed: 42,
    site: lakesidePark(),
    catalog,
  })
    .score(score)
    .preRoll(6)
    .quantize('none')

  b.pyro
    .fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) })
    .fire({ effect: 'mine-75-red', position: 'rack-8', land: m.beat(10) })
    .volley({
      effects: ['peony-75-red', 'peony-75-blue'],
      positions: ['rack-2', 'rack-3', 'rack-4', 'rack-5'],
      land: m.phraseEnd(0),
      staggerBeats: 0.5,
    })
    .chase({
      effect: 'comet-30-gold',
      positions: ['rack-1', 'rack-3', 'rack-5', 'rack-7'],
      startLand: m.barBeat(13, 1),
      stepBeats: 1,
    })
    .barrage({
      window: m.climaxRamp(12),
      effectPool: ['peony-75-red', 'peony-100-white', 'peony-150-gold'],
      positions: Array.from({ length: 8 }, (_, i) => `rack-${i + 1}`),
      startRateHz: 0.5,
      endRateHz: 2,
      idPrefix: 'fin',
    })

  b.drones
    .formation({
      effect: 'ring-formation-60',
      position: 'pad-1',
      by: m.barBeat(5, 1),
      holdSec: 4,
      params: { count: 40, scaleM: 24 },
    })
    .countdown({
      position: 'pad-1',
      landings: [m.downbeat(15), m.downbeat(23), m.downbeat(31)],
      count: 40,
      scaleM: 3, // meters per font cell: ≈ 15×21 m glyphs

      idPrefix: 'cd',
    })

  b.lasers
    .pattern({ effect: 'laser-sweep-gold', position: 'laser-west', from: m.beat(16), durBeats: 8 })
    .pattern({
      effect: 'laser-lissajous-rgb',
      position: 'laser-east',
      from: m.annotation('accent', 0, 'forte'),
      holdSec: 4,
    })

  b.panels
    .pattern({ effect: 'panel-solid-wash', position: 'panel-west', from: m.time(4), rgb: [1, 0.2, 0.2] })
    .ticker('ODE TO JOY', { position: 'panel-east', from: m.barBeat(9, 1), speedPxPerBeat: 6 })

  b.fabrication.cue({
    effectId: 'waterfall-30m',
    anchor: m.barBeat(17, 1),
    positionId: 'rack-4',
  })

  return b.build()
}

describe('showBuilder end-to-end (Ode to Joy mini-show)', () => {
  const result = buildMiniShow()
  const { show, compiled } = result

  it('builds clean (~30 cues, zero error diagnostics)', () => {
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(compiled.cues.length).toBeGreaterThanOrEqual(28)
    expect(compiled.cues.length).toBeLessThanOrEqual(40)
  })

  it('emits a plain serializable Show (catalog by id, fixed track order)', () => {
    expect(show.catalogId).toBe('starter-v1')
    expect(show.meta).toEqual({ id: 'mini', title: 'Ode Mini Show', variant: 'standard', seed: 42 })
    expect(show.preRollSec).toBe(6)
    expect(show.tracks.map((t) => t.id)).toEqual(['pyro', 'drones', 'lasers', 'panels', 'fabrication'])
    expect(JSON.parse(JSON.stringify(show))).toEqual(show)
  })

  it('|landTime − resolvedAnchorTime| < 1e-9 for every cue', () => {
    const anchorById = new Map<string, MusicAnchor>()
    for (const track of show.tracks) {
      for (const cue of track.cues as readonly Cue[]) anchorById.set(cue.id, cue.anchor)
    }
    expect(compiled.cues.length).toBe(anchorById.size)
    for (const cue of compiled.cues) {
      const anchor = anchorById.get(cue.id)!
      const t = resolveAnchor(anchor, tl)!
      expect(Math.abs(cue.targetSec - t)).toBeLessThan(1e-9)
      expect(Math.abs(cue.fireSec - (cue.targetSec - cue.anticipationSec))).toBeLessThan(1e-12)
    }
  })

  it('two build() calls are deep-equal (deterministic authoring)', () => {
    const again = buildMiniShow()
    expect(again.show).toEqual(show)
    expect(again.compiled).toEqual(compiled)
    expect(JSON.stringify(again.compiled)).toBe(JSON.stringify(compiled))
  })

  it('assigns deterministic ids: <track>-<n> singles, <prefix>-NNN groups', () => {
    const ids = new Set(compiled.cues.map((c) => c.id))
    expect(ids.has('pyro-0')).toBe(true) // first fire
    expect(ids.has('pyro-1')).toBe(true) // second fire
    expect(ids.has('pyro-2-000')).toBe(true) // volley group prefix
    expect(ids.has('fin-000')).toBe(true) // explicit idPrefix
    expect(ids.has('cd-000')).toBe(true)
    expect(ids.has('fabrication-0')).toBe(true)
  })

  it('countdown maps digits to the right downbeats (n−1 … 0)', () => {
    const cd = compiled.cues.filter((c) => c.id.startsWith('cd-'))
    expect(cd.map((c) => c.params?.['text'])).toEqual(['2', '1', '0'])
    expect(cd.map((c) => c.targetSec)).toEqual([tl.downbeats[15], tl.downbeats[23], tl.downbeats[31]])
    expect(cd.every((c) => c.effectId === 'digit-formation-100')).toBe(true)
  })

  it('barrage ramps calibers small → large and ends exactly on the climax', () => {
    const fin = compiled.cues.filter((c) => c.id.startsWith('fin-')).sort((a, b) => a.targetSec - b.targetSec)
    expect(fin.length).toBeGreaterThanOrEqual(8)
    expect(fin[0]!.effectId).toBe('peony-75-red')
    const last = fin[fin.length - 1]!
    expect(last.effectId).toBe('peony-150-gold')
    const climaxT = resolveAnchor(m.climax(0), tl)!
    expect(last.targetSec).toBeCloseTo(climaxT, 9)
    expect(climaxT).toBeCloseTo(56, 9) // bar 29 @120bpm
  })

  it('laser holdSec converts to periodBeats through the tempo map', () => {
    const liss = compiled.cues.find((c) => c.effectId === 'laser-lissajous-rgb')!
    expect(liss.params?.['periodBeats']).toBeCloseTo(8, 9) // 4 s @ 120 bpm
  })

  it('ticker uses the text panel pattern with the given speed', () => {
    const ticker = compiled.cues.find((c) => c.effectId === 'panel-text-marquee')!
    expect(ticker.params?.['text']).toBe('ODE TO JOY')
    expect(ticker.params?.['speedPxPerBeat']).toBe(6)
  })
})

describe('musicRefs', () => {
  it('builds the documented anchor shapes', () => {
    expect(m.time(12.5)).toEqual({ kind: 'sec', t: 12.5 })
    expect(m.beat(3.5)).toEqual({ kind: 'beat', beat: 3.5 })
    expect(m.barBeat(4, 2)).toEqual({ kind: 'barBeat', bar: 4, beat: 2 })
    expect(m.downbeat(2)).toEqual({ kind: 'sec', t: tl.downbeats[2] })
    expect(m.annotation('accent', 1, 'forte')).toEqual({ kind: 'annotation', type: 'accent', index: 1, label: 'forte' })
    expect(m.phraseEnd(2)).toEqual({ kind: 'annotation', type: 'phrase', label: 'phraseEnd', index: 2 })
    expect(m.hit('cannon', 3)).toEqual({ kind: 'annotation', type: 'hit', label: 'cannon', index: 3 })
    expect(m.climax()).toEqual({ kind: 'annotation', type: 'climax', index: 0 })
    expect(m.climaxRamp()).toEqual({ peak: { kind: 'annotation', type: 'climax', index: 0 }, windowSec: 20 })
  })

  it('lastDownbeatsBefore returns the count downbeats before the label, ascending', () => {
    // climax 'finalRefrain' at t=56; downbeats every 2 s → 50, 52, 54.
    const anchors = m.lastDownbeatsBefore('finalRefrain', 3)
    expect(anchors).toEqual([
      { kind: 'sec', t: 50 },
      { kind: 'sec', t: 52 },
      { kind: 'sec', t: 54 },
    ])
    expect(() => m.lastDownbeatsBefore('missing-label', 1)).toThrow(/no annotation/)
    expect(() => m.lastDownbeatsBefore('finalRefrain', 999)).toThrow(/only .* downbeats/)
  })

  it('everyPhraseEnd expands an inclusive index range', () => {
    const anchors = m.everyPhraseEnd({ from: 0, to: 2 })
    expect(anchors.length).toBe(3)
    expect(anchors[2]).toEqual({ kind: 'annotation', type: 'phrase', label: 'phraseEnd', index: 2 })
    expect(() => m.everyPhraseEnd({ from: 0, to: 99 })).toThrow(/phraseEnd/)
  })

  it('downbeat() throws out of range', () => {
    expect(() => m.downbeat(9999)).toThrow(/downbeats/)
  })
})

describe('showBuilder guards', () => {
  it('build() throws listing error diagnostics', () => {
    const b = showBuilder({ id: 'bad', title: 'Bad', seed: 1, site: lakesidePark(), catalog })
      .score(score)
    // Landing at t=0.5 with a 2.2 s rise and no pre-roll cannot be fixed within 2 beats.
    b.pyro.fire({ effect: 'peony-75-red', position: 'rack-1', land: m.beat(1) })
    expect(() => b.build()).toThrow(/NEGATIVE_FIRE/)
  })

  it('build() requires music', () => {
    const b = showBuilder({ id: 'nomusic', title: 'X', seed: 1, site: lakesidePark(), catalog })
    expect(() => b.build()).toThrow(/\.music\(timeline\)/)
  })
})
