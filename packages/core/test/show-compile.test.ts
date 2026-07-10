import { describe, expect, it } from 'vitest'
import type { Show, Track } from '../src/contracts.js'
import { starterCatalog, STARTER_CATALOG_ID } from '../src/catalog/index.js'
import { lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { compile } from '../src/show/index.js'

const catalog = starterCatalog()
const tl = buildTimelineFromScore(getScore('odeToJoy')!)

function mkShow(tracks: Track[]): Show {
  return {
    meta: { id: 'c', title: 'Compile', variant: 'standard', seed: 11 },
    music: tl,
    site: lakesidePark(),
    catalogId: STARTER_CATALOG_ID,
    tracks,
    preRollSec: 5,
  }
}

const mixedShow = (): Show =>
  mkShow([
    {
      id: 'pyro',
      medium: 'pyro',
      name: 'P',
      cues: [
        { id: 'z-late', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 30 }, positionId: 'rack-1' },
        { id: 'a-early', effectId: 'peony-100-white', anchor: { kind: 'sec', t: 10 }, positionId: 'rack-2' },
      ],
    },
    {
      id: 'drones',
      medium: 'drone',
      name: 'D',
      cues: [
        { id: 'd1', effectId: 'ring-formation-60', anchor: { kind: 'sec', t: 20 }, positionId: 'pad-1', params: { count: 40, scaleM: 24 } },
      ],
    },
    {
      id: 'lasers',
      medium: 'laser',
      name: 'L',
      cues: [{ id: 'l1', effectId: 'laser-sweep-gold', anchor: { kind: 'sec', t: 10 }, positionId: 'laser-east' }],
    },
  ])

describe('compile', () => {
  it('is pure and deterministic: two calls are JSON-identical', () => {
    const a = compile(mixedShow(), catalog)
    const b = compile(mixedShow(), catalog)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a).toEqual(b)
  })

  it('sorts cues by (fireSec, trackId, id)', () => {
    const compiled = compile(mixedShow(), catalog)
    const order = [...compiled.cues].sort(
      (x, y) =>
        x.fireSec - y.fireSec ||
        (x.trackId < y.trackId ? -1 : x.trackId > y.trackId ? 1 : 0) ||
        (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
    )
    expect(compiled.cues).toEqual(order)
    // Spot check: the drone cue departs first — its pad-timeline transition
    // (fleet grid -> formation, LIFT_MARGIN 1.25) starts before the peony's
    // 7.2 s rise-time fire. Sim-derived drone timing owns drone fireSec.
    expect(compiled.cues[0]!.id).toBe('d1')
    expect(compiled.cues[0]!.medium).toBe('drone')
  })

  it('appends validateSite diagnostics (oversized formation trips the geofence rule)', () => {
    const show = mkShow([
      {
        id: 'drones',
        medium: 'drone',
        name: 'D',
        cues: [
          // ring scaleM 70 -> footprint radius 35 m > the 30 m inset of pad-1.
          { id: 'big', effectId: 'ring-formation-60', anchor: { kind: 'sec', t: 20 }, positionId: 'pad-1', params: { count: 60, scaleM: 70 } },
        ],
      },
    ])
    const compiled = compile(show, catalog)
    expect(compiled.diagnostics.some((d) => d.code === 'geofence')).toBe(true)
  })

  it('validation errors accompany the result instead of aborting', () => {
    const show = mkShow([
      {
        id: 'pyro',
        medium: 'pyro',
        name: 'P',
        cues: [
          { id: 'bad', effectId: 'no-such', anchor: { kind: 'sec', t: 10 }, positionId: 'rack-1' },
          { id: 'good', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 12 }, positionId: 'rack-2' },
        ],
      },
    ])
    const compiled = compile(show, catalog)
    expect(compiled.cues.map((c) => c.id)).toEqual(['good'])
    expect(compiled.diagnostics.filter((d) => d.code === 'EFFECT_UNRESOLVED').length).toBe(2) // validate + solve
  })

  it('carries the original show object through', () => {
    const show = mixedShow()
    const compiled = compile(show, catalog)
    expect(compiled.show).toBe(show)
  })
})
