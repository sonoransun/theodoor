/**
 * show-builder-fountain.test.ts — the `b.fountains` facade: jet / cascade /
 * wave / mirror / mist emit the documented params and ids onto the
 * 'fountains' track, and the assembled show compiles.
 */
import { describe, expect, it } from 'vitest'
import type { Cue } from '../src/contracts.js'
import { Catalog, STARTER_EFFECTS, starterCatalog } from '../src/catalog/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'

const catalog = starterCatalog()
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)

function fresh(cat: Catalog = catalog) {
  return showBuilder({ id: 'bf', title: 'Builder Fountains', seed: 2, site: lakesidePark(), catalog: cat })
    .music(tl)
    .preRoll(6)
}

const cues = (r: ReturnType<ReturnType<typeof fresh>['build']>): readonly Cue[] =>
  r.show.tracks.find((t) => t.id === 'fountains')!.cues

describe('fountain facade', () => {
  it('jet: auto id, position, crest anchor, and every optional param', () => {
    const b = fresh()
    b.fountains.jet({ effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(3, 1) })
    b.fountains.jet({
      effect: 'fountain-plume-30m',
      position: 'fount-east',
      crest: m.barBeat(5, 1),
      heightM: 40,
      nozzles: 5,
      rgb: [1, 0, 0],
      rgb2: [0, 0, 1],
      priority: 3,
      params: { periodBeats: 2 },
    })
    const r = b.build()
    const track = r.show.tracks.find((t) => t.id === 'fountains')!
    expect(track.medium).toBe('fountain')
    expect(track.name).toBe('Fountains')
    const [a, c] = cues(r)
    expect(a!.id).toBe('fountains-0')
    expect(a!.params).toBeUndefined()
    expect(a!.anchor).toEqual({ kind: 'barBeat', bar: 3, beat: 1 })
    expect(a!.positionId).toBe('fount-west')
    expect(c!.id).toBe('fountains-1')
    expect(c!.priority).toBe(3)
    expect(c!.params).toEqual({ periodBeats: 2, heightM: 40, nozzles: 5, rgb: [1, 0, 0], rgb2: [0, 0, 1] })
    expect(r.compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('cascade / wave carry stepBeats, periodBeats, reverse', () => {
    const b = fresh()
    b.fountains.cascade({ id: 'c', effect: 'fountain-cascade-25m', position: 'fount-east', crest: m.beat(8), stepBeats: 1, reverse: true, heightM: 20 })
    b.fountains.wave({ id: 'w', effect: 'fountain-wave-15m', position: 'fount-west', crest: m.beat(16), periodBeats: 8, reverse: true, rgb: [0, 1, 0] })
    const [c, w] = cues(b.build())
    expect(c!.params).toEqual({ stepBeats: 1, reverse: true, heightM: 20 })
    expect(w!.params).toEqual({ periodBeats: 8, reverse: true, rgb: [0, 1, 0] })
  })

  it('mirror: one cue per bank, ids <prefix>-000/001, outward flow reverses the first bank', () => {
    const b = fresh()
    b.fountains.mirror({
      effect: 'fountain-cascade-25m',
      positions: ['fount-west', 'fount-east'],
      crest: m.beat(24),
      stepBeats: 0.5,
      rgb: [1, 1, 1],
      idPrefix: 'rapids',
    })
    b.fountains.mirror({ effect: 'fountain-wave-15m', positions: ['fount-west', 'fount-east'], crest: m.beat(40), outward: false })
    const r = b.build()
    const [w, e, w2, e2] = cues(r)
    expect([w!.id, e!.id]).toEqual(['rapids-000', 'rapids-001'])
    expect([w!.positionId, e!.positionId]).toEqual(['fount-west', 'fount-east'])
    expect(w!.anchor).toEqual(e!.anchor)
    expect(w!.params).toEqual({ stepBeats: 0.5, reverse: true, rgb: [1, 1, 1] })
    expect(e!.params).toEqual({ stepBeats: 0.5, reverse: false, rgb: [1, 1, 1] })
    // Inward: inverted, auto prefix from the track counter.
    expect([w2!.id, e2!.id]).toEqual(['fountains-0-000', 'fountains-0-001'])
    expect(w2!.params).toEqual({ reverse: false })
    expect(e2!.params).toEqual({ reverse: true })
    // Both banks compile to the same landing.
    const cw = r.compiled.cues.find((c) => c.id === 'rapids-000')!
    const ce = r.compiled.cues.find((c) => c.id === 'rapids-001')!
    expect(cw.targetSec).toBe(ce.targetSec)
    expect(cw.fireSec).toBe(ce.fireSec)
  })

  it('mist: defaults to the catalog mist program, accepts an explicit one, refuses without one', () => {
    const b = fresh()
    b.fountains.mist({ id: 'm1', position: 'fount-west', from: m.time(2) })
    b.fountains.mist({ id: 'm2', effect: 'fountain-mist-screen', position: 'fount-east', from: m.time(4), rgb: [0.5, 0.5, 1] })
    const [m1, m2] = cues(b.build())
    expect(m1!.effectId).toBe('fountain-mist-screen')
    expect(m1!.params).toBeUndefined()
    expect(m2!.params).toEqual({ rgb: [0.5, 0.5, 1] })
    const noMist = new Catalog(STARTER_EFFECTS.filter((e) => !(e.medium === 'fountain' && e.jet === 'mist')))
    expect(() => fresh(noMist).fountains.mist({ position: 'fount-west', from: m.time(2) })).toThrow(/mist/)
  })

  it('the fountains track only appears when used; ids never collide with other tracks', () => {
    const b = fresh()
    b.pyro.fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) })
    expect(b.build().show.tracks.map((t) => t.id)).toEqual(['pyro'])
    const b2 = fresh()
    b2.pyro.fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) })
    b2.fountains.jet({ effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(3, 1) })
    const r = b2.build()
    expect(r.show.tracks.map((t) => t.id)).toEqual(['pyro', 'fountains'])
    expect(new Set(r.compiled.cues.map((c) => c.id)).size).toBe(2)
  })
})
