import { describe, expect, it } from 'vitest'
import type { Show, Track } from '../src/contracts.js'
import { starterCatalog, STARTER_CATALOG_ID } from '../src/catalog/index.js'
import { lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { validateShow } from '../src/show/index.js'

const catalog = starterCatalog()
const tl = buildTimelineFromScore(getScore('odeToJoy')!)

function mkShow(tracks: Track[], variant: 'standard' | 'quiet' = 'standard'): Show {
  return {
    meta: { id: 'v', title: 'Validate', variant, seed: 1 },
    music: tl,
    site: lakesidePark(),
    catalogId: STARTER_CATALOG_ID,
    tracks,
  }
}

const codes = (show: Show): string[] => validateShow(show, catalog).map((d) => d.code)

describe('validateShow', () => {
  it('accepts a well-formed show', () => {
    const show = mkShow([
      {
        id: 'pyro',
        medium: 'pyro',
        name: 'P',
        cues: [{ id: 'a', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 10 }, positionId: 'rack-1' }],
      },
    ])
    expect(validateShow(show, catalog)).toEqual([])
  })

  it('flags duplicate cue ids ACROSS tracks', () => {
    const show = mkShow([
      { id: 'pyro', medium: 'pyro', name: 'P', cues: [{ id: 'dup', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 1 }, positionId: 'rack-1' }] },
      { id: 'lasers', medium: 'laser', name: 'L', cues: [{ id: 'dup', effectId: 'laser-sweep-gold', anchor: { kind: 'sec', t: 2 }, positionId: 'laser-west' }] },
    ])
    expect(codes(show)).toContain('DUPLICATE_CUE_ID')
  })

  it('flags unknown effects and medium mismatches', () => {
    const show = mkShow([
      {
        id: 'pyro',
        medium: 'pyro',
        name: 'P',
        cues: [
          { id: 'a', effectId: 'no-such-effect', anchor: { kind: 'sec', t: 1 }, positionId: 'rack-1' },
          { id: 'b', effectId: 'ring-formation-60', anchor: { kind: 'sec', t: 2 }, positionId: 'rack-1' },
        ],
      },
    ])
    const diags = validateShow(show, catalog)
    expect(diags.find((d) => d.code === 'EFFECT_UNRESOLVED')!.cueIds).toEqual(['a'])
    expect(diags.find((d) => d.code === 'MEDIUM_MISMATCH')!.cueIds).toEqual(['b'])
  })

  it('checks positionId existence and kind suitability per medium', () => {
    const show = mkShow([
      {
        id: 'pyro',
        medium: 'pyro',
        name: 'P',
        cues: [
          { id: 'a', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 1 }, positionId: 'pad-1' },
          { id: 'b', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 2 }, positionId: 'ghost' },
          { id: 'c', effectId: 'peony-75-red', anchor: { kind: 'sec', t: 3 } },
        ],
      },
      {
        id: 'fabrication',
        medium: 'fabrication',
        name: 'F',
        cues: [
          { id: 'f1', effectId: 'waterfall-30m', anchor: { kind: 'sec', t: 4 }, positionId: 'pad-1' },
          { id: 'f2', effectId: 'waterfall-30m', anchor: { kind: 'sec', t: 5 } },
        ],
      },
    ])
    const diags = validateShow(show, catalog)
    const byCue = (id: string) => diags.filter((d) => d.cueIds?.includes(id))
    expect(byCue('a')[0]!.code).toBe('POSITION_KIND')
    expect(byCue('b')[0]!.code).toBe('POSITION_UNRESOLVED')
    expect(byCue('c')[0]!.code).toBe('POSITION_MISSING')
    expect(byCue('c')[0]!.severity).toBe('error')
    // Fabrication mounts anywhere; a missing position is only a warning.
    expect(byCue('f1')).toEqual([])
    expect(byCue('f2')[0]!.code).toBe('POSITION_MISSING')
    expect(byCue('f2')[0]!.severity).toBe('warning')
  })

  it('forwards catalog param diagnostics with the cue id attached', () => {
    const show = mkShow([
      {
        id: 'drones',
        medium: 'drone',
        name: 'D',
        cues: [
          { id: 'd', effectId: 'ring-formation-60', anchor: { kind: 'sec', t: 1 }, positionId: 'pad-1', params: { count: 'forty' } },
        ],
      },
    ])
    const diag = validateShow(show, catalog).find((d) => d.code === 'catalog/param-type')!
    expect(diag.severity).toBe('error')
    expect(diag.cueIds).toEqual(['d'])
  })

  it("quiet variant rejects effects above 100 dB at the reference distance", () => {
    const loud = mkShow(
      [{ id: 'pyro', medium: 'pyro', name: 'P', cues: [{ id: 's', effectId: 'salute-100', anchor: { kind: 'sec', t: 1 }, positionId: 'rack-1' }] }],
      'quiet',
    )
    expect(codes(loud)).toContain('QUIET_VARIANT')
    const soft = mkShow(
      [{ id: 'pyro', medium: 'pyro', name: 'P', cues: [{ id: 'c', effectId: 'crossette-75-silver', anchor: { kind: 'sec', t: 1 }, positionId: 'rack-1' }] }],
      'quiet',
    )
    expect(codes(soft)).not.toContain('QUIET_VARIANT')
  })
})
