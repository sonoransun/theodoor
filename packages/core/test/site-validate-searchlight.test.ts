/**
 * Site rules for the searchlight banks (site/rules/searchlight.ts): the bank
 * spec is required, heads never tilt past the bank maximum, and no aim dips
 * below the elevation floor while pointing into the audience — including a
 * sweep's analytic peaks, which are sampled explicitly.
 */
import { describe, expect, it } from 'vitest'
import type { CompiledShow, Show, SitePlan, Track } from '../src/contracts.js'
import { STARTER_CATALOG_ID, getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark, validateSite } from '../src/site/index.js'
import {
  LIGHT_AUDIENCE_AZ_SLACK_DEG,
  audienceAzimuthInterval,
  azimuthTowardAudience,
} from '../src/site/rules/searchlight.js'
import { compile, musicRefs } from '../src/show/index.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)

function mkShow(cues: Track['cues'], site: SitePlan = lakesidePark()): Show {
  return {
    meta: { id: 'lights-site', title: 'Lights Site', variant: 'standard', seed: 3 },
    music: tl,
    site,
    catalogId: STARTER_CATALOG_ID,
    tracks: [{ id: 'lights', medium: 'searchlight', name: 'Searchlights', cues }],
    preRollSec: 6,
  }
}

const codes = (c: CompiledShow): string[] => c.diagnostics.map((d) => d.code)
const errors = (c: CompiledShow) => c.diagnostics.filter((d) => d.severity === 'error')

describe('venue baseline', () => {
  it('lakesidePark validates clean with no show and with a feasible figure', () => {
    expect(validateSite(lakesidePark(), null, getEffect)).toEqual([])
    const compiled = compile(
      mkShow([{ id: 'fan', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west' }]),
      catalog,
    )
    expect(errors(compiled)).toEqual([])
    expect(codes(compiled).filter((c) => c.startsWith('light-'))).toEqual([])
  })

  it('audienceAzimuthInterval from lights-west spans the southern lawn; toward-tests honor the slack', () => {
    const site = lakesidePark()
    const west = site.assets.find((a) => a.id === 'lights-west')!
    const zone = audienceAzimuthInterval(west.pos, site)!
    // The lawn (x −150…150, y −260…−190) seen from (−130, −4): south-south-east.
    expect(zone.centerDeg).toBeGreaterThan(120)
    expect(zone.centerDeg).toBeLessThan(180)
    expect(zone.halfDeg).toBeGreaterThan(15)
    expect(zone.halfDeg).toBeLessThan(45)
    expect(azimuthTowardAudience(180, zone)).toBe(true) // due south
    expect(azimuthTowardAudience(0, zone)).toBe(false) // north, away
    expect(azimuthTowardAudience(-90, zone)).toBe(false) // west along the row
    expect(azimuthTowardAudience(zone.centerDeg + zone.halfDeg + LIGHT_AUDIENCE_AZ_SLACK_DEG - 0.1, zone)).toBe(true)
    expect(azimuthTowardAudience(zone.centerDeg + zone.halfDeg + LIGHT_AUDIENCE_AZ_SLACK_DEG + 0.1, zone)).toBe(false)
    // Standing inside the zone every azimuth is "toward".
    const inside = audienceAzimuthInterval({ x: 0, y: -225 }, site)!
    expect(inside.halfDeg).toBe(180)
    expect(audienceAzimuthInterval({ x: 0, y: 0 }, { ...site, audienceZone: [] })).toBeUndefined()
  })
})

describe('light-tilt', () => {
  it('a fan wider than 2 × maxTiltDeg tilts its end heads past the limit', () => {
    const compiled = compile(
      mkShow([
        { id: 'wide', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { spreadDeg: 170 } },
      ]),
      catalog,
    )
    const d = compiled.diagnostics.filter((x) => x.code === 'light-tilt')
    expect(d).toHaveLength(1) // one report per cue, not per head/sample
    expect(d[0]!.severity).toBe('error')
    expect(d[0]!.cueIds).toEqual(['wide'])
    expect(d[0]!.assetId).toBe('lights-west')
    expect(d[0]!.message).toContain('85°')
  })

  it('a cross leaning past the limit and a spire converging too low both fail; at the limit passes', () => {
    const cross = compile(
      mkShow([{ id: 'x', effectId: 'light-cross-violet', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { spreadDeg: 80 } }]),
      catalog,
    )
    expect(codes(cross)).toContain('light-tilt')
    // Far head at x = −139 → (0, −4, 20): tilt ≈ 82°.
    const low = compile(
      mkShow([{ id: 's', effectId: 'light-converge-spire', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { aimX: 0, aimZ: 20 } }]),
      catalog,
    )
    expect(codes(low)).toContain('light-tilt')
    const atLimit = compile(
      mkShow([{ id: 'p', effectId: 'light-pillar-white', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { tiltDeg: 75 } }]),
      catalog,
    )
    expect(codes(atLimit)).not.toContain('light-tilt')
  })

  it('a sweep whose PEAK exceeds the limit is caught even when the grid samples straddle it', () => {
    // Amplitude just over the limit; the 8 interior samples of a 16 s hold
    // with a 4 s period land at phases whose |sin| tops out below 75/75.4,
    // so only the analytic extreme sampling can see the 75.4° peak.
    const compiled = compile(
      mkShow([
        {
          id: 'sw',
          effectId: 'light-sweep-slow',
          anchor: m.barBeat(3, 1),
          positionId: 'lights-west',
          params: { sweepDeg: 75.4, periodBeats: 8 },
        },
      ]),
      catalog,
    )
    expect(codes(compiled)).toContain('light-tilt')
    const fine = compile(
      mkShow([
        { id: 'ok', effectId: 'light-sweep-slow', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { sweepDeg: 70, periodBeats: 8 } },
      ]),
      catalog,
    )
    expect(codes(fine).filter((c) => c.startsWith('light-'))).toEqual([])
  })
})

describe('light-elevation', () => {
  it('a pillar leaned south into the lawn below the 20° floor is an error; leaned north it is not', () => {
    // tiltDeg −75 toward heading 0 = 75° toward south: elevation 15° into the crowd.
    const south = compile(
      mkShow([{ id: 'south', effectId: 'light-pillar-white', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { tiltDeg: -75 } }]),
      catalog,
    )
    const d = south.diagnostics.filter((x) => x.code === 'light-elevation')
    expect(d).toHaveLength(1)
    expect(d[0]!.severity).toBe('error')
    expect(d[0]!.message).toContain('15°')
    expect(codes(south)).not.toContain('light-tilt') // 75° is exactly the limit
    // The same tilt away from the audience (north) is fine.
    const north = compile(
      mkShow([{ id: 'north', effectId: 'light-pillar-white', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { tiltDeg: 75 } }]),
      catalog,
    )
    expect(codes(north)).not.toContain('light-elevation')
    // Leaned south but still above the floor (30° elevation) is fine too.
    const shallow = compile(
      mkShow([{ id: 'ok', effectId: 'light-pillar-white', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { tiltDeg: -60 } }]),
      catalog,
    )
    expect(codes(shallow).filter((c) => c.startsWith('light-'))).toEqual([])
  })

  it('a wide fan along the row grazes the horizon but never the crowd: tilt error only', () => {
    const compiled = compile(
      mkShow([{ id: 'wide', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { spreadDeg: 170 } }]),
      catalog,
    )
    expect(codes(compiled)).toContain('light-tilt')
    expect(codes(compiled)).not.toContain('light-elevation')
  })
})

describe('light-structure and placement', () => {
  it('a searchlight cue on a bank whose spec is missing is a light-structure error', () => {
    const stock = lakesidePark()
    const site: SitePlan = {
      ...stock,
      assets: stock.assets.map((a) => {
        if (a.id !== 'lights-west') return a
        const { searchlightBank: _drop, ...rest } = a
        return rest
      }),
    }
    const compiled = compile(
      mkShow([{ id: 'nospec', effectId: 'light-pillar-white', anchor: m.barBeat(3, 1), positionId: 'lights-west' }], site),
      catalog,
    )
    const d = compiled.diagnostics.filter((x) => x.code === 'light-structure')
    expect(d).toHaveLength(1)
    expect(d[0]!.cueIds).toEqual(['nospec'])
  })

  it('a searchlight cue placed on a mortar rack fails both show validation (POSITION_KIND) and the bank rule', () => {
    const compiled = compile(
      mkShow([{ id: 'wrong', effectId: 'light-pillar-white', anchor: m.barBeat(3, 1), positionId: 'rack-1' }]),
      catalog,
    )
    expect(codes(compiled)).toContain('POSITION_KIND')
    // Like 'beam-structure', the site rule reports any spec-less asset — a rack
    // cannot steer heads no matter what kind it claims to be.
    expect(codes(compiled).filter((c) => c.startsWith('light-'))).toEqual(['light-structure'])
    // A dangling positionId is show validation's alone.
    const dangling = compile(
      mkShow([{ id: 'ghost', effectId: 'light-pillar-white', anchor: m.barBeat(3, 1), positionId: 'no-such-bank' }]),
      catalog,
    )
    expect(codes(dangling)).toContain('POSITION_UNRESOLVED')
    expect(codes(dangling).filter((c) => c.startsWith('light-'))).toEqual([])
  })

  it('reports one diagnostic per rule per cue even across many heads and samples', () => {
    const compiled = compile(
      mkShow([
        { id: 'a', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-west', params: { spreadDeg: 170 } },
        { id: 'b', effectId: 'light-fan-gold', anchor: m.barBeat(3, 1), positionId: 'lights-east', params: { spreadDeg: 170 } },
      ]),
      catalog,
    )
    expect(compiled.diagnostics.filter((x) => x.code === 'light-tilt')).toHaveLength(2)
  })
})
