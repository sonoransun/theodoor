/**
 * site-validate-fountain.test.ts — fountain-bank site rules: height over the
 * pump maximum, structure (spec-less bank), spray drift toward the audience,
 * and the no-double-report contract with show validation's POSITION_KIND.
 */
import { describe, expect, it } from 'vitest'
import type { Show, SitePlan, Track } from '../src/contracts.js'
import { STARTER_CATALOG_ID, getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark, validateSite } from '../src/site/index.js'
import { SPRAY_CLEARANCE_M, SPRAY_DRIFT_FACTOR } from '../src/site/rules/fountain.js'
import { compile, musicRefs, showBuilder } from '../src/show/index.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const tl = buildTimelineFromScore(getScore('odeToJoy')!)

function mkShow(site: SitePlan, tracks: Track[]): Show {
  return {
    meta: { id: 'v', title: 'Validate Fountains', variant: 'standard', seed: 1 },
    music: tl,
    site,
    catalogId: STARTER_CATALOG_ID,
    tracks,
  }
}

const fountainTrack = (cues: Track['cues']): Track => ({ id: 'fountains', medium: 'fountain', name: 'Fountains', cues })

describe('fountain site rules', () => {
  it('lakesidePark with no show validates clean', () => {
    expect(validateSite(lakesidePark(), null, getEffect)).toEqual([])
  })

  it('a well-formed fountain show carries no fountain diagnostics', () => {
    const compiled = compile(
      mkShow(lakesidePark(), [
        fountainTrack([
          { id: 'a', effectId: 'fountain-plume-30m', anchor: { kind: 'sec', t: 10 }, positionId: 'fount-west' },
          { id: 'b', effectId: 'fountain-shooter-45m', anchor: { kind: 'sec', t: 14 }, positionId: 'fount-east' },
        ]),
      ]),
      catalog,
    )
    expect(compiled.diagnostics.filter((d) => d.code.startsWith('fountain'))).toEqual([])
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it("params.heightM above the bank maximum → 'fountain-height' error, naming the request and the cap", () => {
    const compiled = compile(
      mkShow(lakesidePark(), [
        fountainTrack([
          {
            id: 'too-tall',
            effectId: 'fountain-plume-30m',
            anchor: { kind: 'sec', t: 10 },
            positionId: 'fount-west',
            params: { heightM: 60 },
          },
        ]),
      ]),
      catalog,
    )
    const d = compiled.diagnostics.filter((x) => x.code === 'fountain-height')
    expect(d).toHaveLength(1)
    expect(d[0]!.severity).toBe('error')
    expect(d[0]!.cueIds).toEqual(['too-tall'])
    expect(d[0]!.assetId).toBe('fount-west')
    expect(d[0]!.message).toContain('60 m crest')
    expect(d[0]!.message).toContain('45 m')
  })

  it('the builder refuses to build an over-height cue', () => {
    const m = musicRefs(tl)
    const b = showBuilder({ id: 'x', title: 'X', seed: 1, site: lakesidePark(), catalog }).music(tl).preRoll(6)
    b.fountains.jet({ effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(3, 1), heightM: 50 })
    expect(() => b.build()).toThrow(/fountain-height/)
  })

  it("a fountain cue on a rack is POSITION_KIND (show validation) and is NOT doubled as 'fountain-structure'", () => {
    const compiled = compile(
      mkShow(lakesidePark(), [
        fountainTrack([{ id: 'on-rack', effectId: 'fountain-plume-30m', anchor: { kind: 'sec', t: 10 }, positionId: 'rack-1' }]),
      ]),
      catalog,
    )
    const codes = compiled.diagnostics.map((d) => d.code)
    expect(codes).toContain('POSITION_KIND')
    expect(codes).not.toContain('fountain-structure')
    expect(codes).not.toContain('fountain-height')
  })

  it("a fountainBank asset without a spec → 'fountain-structure' error", () => {
    const site = lakesidePark()
    site.assets = site.assets.map((a) => (a.id === 'fount-west' ? { ...a, fountainBank: undefined } : a))
    const compiled = compile(
      mkShow(site, [
        fountainTrack([{ id: 'bare', effectId: 'fountain-plume-30m', anchor: { kind: 'sec', t: 10 }, positionId: 'fount-west' }]),
      ]),
      catalog,
    )
    const d = compiled.diagnostics.filter((x) => x.code === 'fountain-structure')
    expect(d).toHaveLength(1)
    expect(d[0]!.severity).toBe('error')
    expect(d[0]!.cueIds).toEqual(['bare'])
    // The height rule needs the spec and is skipped, not crashed.
    expect(compiled.diagnostics.map((x) => x.code)).not.toContain('fountain-height')
  })

  it("wind pushing spray to within the clearance of the audience line → 'fountain-drift' warning", () => {
    // Move the west bank to 20 m north of the audience line; a north wind
    // (blowing south, toward the crowd) at 8 m/s carries the 45 m shooter's
    // spray 0.6 × 8 × 3.03 ≈ 14.5 m → lands ≈ 5.5 m from the line.
    const site = lakesidePark()
    site.assets = site.assets.map((a) => (a.id === 'fount-west' ? { ...a, pos: { x: 0, y: -170 } } : a))
    site.wind = { dirDegFrom: 0, speedMps: 8, limitMps: 9 }
    const compiled = compile(
      mkShow(site, [
        fountainTrack([{ id: 'near', effectId: 'fountain-shooter-45m', anchor: { kind: 'sec', t: 10 }, positionId: 'fount-west' }]),
      ]),
      catalog,
    )
    const d = compiled.diagnostics.filter((x) => x.code === 'fountain-drift')
    expect(d).toHaveLength(1)
    expect(d[0]!.severity).toBe('warning')
    expect(d[0]!.cueIds).toEqual(['near'])
    const driftM = 8 * SPRAY_DRIFT_FACTOR * Math.sqrt((2 * 45) / 9.81)
    expect(d[0]!.message).toContain(`${Math.round(driftM * 10) / 10} m downwind`)
    expect(d[0]!.message).toContain(`< ${SPRAY_CLEARANCE_M} m`)
    // Same geometry with the wind from the south (blowing away) stays quiet.
    site.wind = { dirDegFrom: 180, speedMps: 8, limitMps: 9 }
    const away = compile(
      mkShow(site, [
        fountainTrack([{ id: 'near', effectId: 'fountain-shooter-45m', anchor: { kind: 'sec', t: 10 }, positionId: 'fount-west' }]),
      ]),
      catalog,
    )
    expect(away.diagnostics.filter((x) => x.code === 'fountain-drift')).toEqual([])
  })

  it('the flagship banks never drift-warn in the site wind (190 m of lawn between them and the crowd)', () => {
    const compiled = compile(
      mkShow(lakesidePark(), [
        fountainTrack([
          { id: 'w', effectId: 'fountain-shooter-45m', anchor: { kind: 'sec', t: 10 }, positionId: 'fount-west' },
          { id: 'e', effectId: 'fountain-shooter-45m', anchor: { kind: 'sec', t: 10 }, positionId: 'fount-east' },
        ]),
      ]),
      catalog,
    )
    expect(compiled.diagnostics.filter((x) => x.code === 'fountain-drift')).toEqual([])
  })
})
