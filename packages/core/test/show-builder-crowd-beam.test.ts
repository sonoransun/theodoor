/**
 * b.crowd / b.beams authoring facades + m.offset sugar.
 *
 * Structure-first: most assertions inspect the emitted Show's tracks/cues
 * (pure authoring output), not solver-derived fields, so concurrent solver
 * work cannot invalidate them. One end-to-end integration test at the bottom
 * checks a mixed crowd/beam/drone show compiles with zero error diagnostics
 * and stays clean under the wave-1 conflict passes and the exposure budget.
 *
 * Beam geometry notes (lakesidePark): the south arrays (±140, −182, elev 4 m)
 * only get a bounded footprint on nearby lawn cells (depression must clear
 * halfAngle + 2°, i.e. ground distance ≲ 27 m for 6°-wide programs), while
 * the exposure ceiling wants cells ≳ 18 m out (the carrier reference is 15 m,
 * so closer cells sit above maxCarrierDbAtFocus). All south-array targets
 * therefore sit ~18–21 m from their array in the front corners of the 38×9
 * crowd grid (index = row·38 + col; row 8 is the lawn's north edge, row 7 the
 * 18-m band). Crossed stereo pairs and the zone-wide toll are physically
 * infeasible from the corner arrays, so those tests add an elevated
 * center-stage pair to the site.
 */

import { describe, expect, it } from 'vitest'
import type { Show, SitePlan, Track } from '../src/contracts.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { crowdGridFor, lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { musicRefs, resolveAnchor, showBuilder } from '../src/show/index.js'
import { beamSlew, crowdBandwidth } from '../src/choreo/index.js'
import { exposureReport } from '../src/acoustics/index.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const score = getScore('odeToJoy')!
const tl = buildTimelineFromScore(score)
const m = musicRefs(tl)

const track = (show: Show, id: string): Track => {
  const t = show.tracks.find((x) => x.id === id)
  if (!t) throw new Error(`show has no '${id}' track`)
  return t
}

/**
 * lakesidePark plus an elevated stereo pair at center stage front: 8 m up and
 * only ~40 m from mid-lawn cells, so crossed footprints and the zone-centroid
 * toll clear the horizon margin (the corner arrays cannot).
 */
function siteWithStagePair(): SitePlan {
  const site = lakesidePark()
  const beamArray = {
    panRangeDeg: 120,
    tiltMinDeg: -45,
    tiltMaxDeg: 10,
    steerRateDegPerSec: 45,
    minFocusDistanceM: 5,
  }
  const extra = ([-1, 1] as const).map((side) => ({
    id: side < 0 ? 'beam-stage-west' : 'beam-stage-east',
    kind: 'beamArray' as const,
    pos: { x: 20 * side, y: -185 },
    headingDeg: 180,
    elevationM: 8,
    beamArray: { ...beamArray },
  }))
  return { ...site, assets: [...site.assets, ...extra] }
}

describe('m.offset', () => {
  it('adds offsetBeats to beat / barBeat / annotation anchors', () => {
    expect(m.offset(m.beat(8), 2)).toEqual({ kind: 'beat', beat: 8, offsetBeats: 2 })
    expect(m.offset(m.barBeat(3, 1), -1)).toEqual({ kind: 'barBeat', bar: 3, beat: 1, offsetBeats: -1 })
    expect(m.offset(m.phraseEnd(1), 4)).toEqual({
      kind: 'annotation',
      type: 'phrase',
      label: 'phraseEnd',
      index: 1,
      offsetBeats: 4,
    })
  })

  it('composes with an existing offset', () => {
    expect(m.offset(m.offset(m.barBeat(3, 1), 1), 0.5)).toEqual({
      kind: 'barBeat',
      bar: 3,
      beat: 1,
      offsetBeats: 1.5,
    })
  })

  it('resolves `beats` later through the tempo map', () => {
    const base = resolveAnchor(m.barBeat(3, 1), tl)!
    const shifted = resolveAnchor(m.offset(m.barBeat(3, 1), 2), tl)!
    expect(shifted - base).toBeCloseTo(1, 9) // 2 beats @ 120 bpm
  })

  it('returns seconds anchors unchanged for beats = 0 and throws otherwise', () => {
    expect(m.offset(m.time(5), 0)).toEqual({ kind: 'sec', t: 5 })
    expect(() => m.offset(m.time(5), 1)).toThrow(/seconds anchors/)
  })
})

describe('b.crowd facades (track/cue structure)', () => {
  // Staggered so no mast ever carries > 30 Hz of concurrent maskUpdateHz.
  const b = showBuilder({
    id: 'crowd-struct',
    title: 'Crowd Structure',
    seed: 7,
    site: lakesidePark(),
    catalog,
  })
    .score(score)
    .preRoll(6)
  b.crowd
    .flood({
      effect: 'crowd-flood-rgb',
      position: 'mast-west',
      from: m.barBeat(3, 1),
      rgb: [1, 0.2, 0.2],
      rgb2: [0.2, 0.2, 1],
      intensity: 0.8,
    })
    .wave({
      effect: 'crowd-wave-lateral',
      position: 'mast-east',
      from: m.barBeat(3, 1),
      periodBeats: 16,
      dirDeg: 90,
    })
    .pulse({
      effect: 'crowd-pulse-radial',
      position: 'mast-west',
      land: m.barBeat(9, 1),
      originCell: 170,
      periodBeats: 2,
    })
    .chase({
      effect: 'crowd-chase-sections',
      position: 'mast-east',
      startLand: m.barBeat(9, 1),
      stepBeats: 12,
      sections: 3,
    })
    .text('HELLO PARK', {
      effect: 'crowd-text-marquee',
      position: 'mast-west',
      land: m.barBeat(13, 1),
      rgb: [1, 1, 1],
    })
    .sparkle({
      effect: 'crowd-sparkle-gold',
      position: 'mast-east',
      from: m.barBeat(22, 1),
      densityFrac: 0.3,
      twinkleHz: 5,
    })
    .heartbeat({
      effect: 'crowd-heartbeat-red',
      position: 'mast-west',
      land: m.barBeat(22, 1),
      originCell: 152,
    })
    .haptic({ effect: 'crowd-haptic-thump', position: 'mast-east', land: m.barBeat(29, 1) })
    .pulse({ effect: 'crowd-pulse-radial', position: 'mast-west', land: m.barBeat(27, 1) })
  const { show } = b.build()
  const crowd = track(show, 'crowd')
  const byId = new Map(crowd.cues.map((c) => [c.id, c]))

  it("emits one 'crowd' track with medium 'crowd' and all cues", () => {
    expect(show.tracks.map((t) => t.id)).toEqual(['crowd'])
    expect(crowd.medium).toBe('crowd')
    expect(crowd.name).toBe('Crowd')
    expect(crowd.cues).toHaveLength(11) // 8 singles/groups, chase = 3 cues
  })

  it('flood: inline cue with rgb/rgb2/intensity params', () => {
    const c = byId.get('crowd-0')!
    expect(c.effectId).toBe('crowd-flood-rgb')
    expect(c.positionId).toBe('mast-west')
    expect(c.anchor).toEqual({ kind: 'barBeat', bar: 3, beat: 1 })
    expect(c.params).toEqual({ rgb: [1, 0.2, 0.2], rgb2: [0.2, 0.2, 1], intensity: 0.8 })
  })

  it('wave: wraps crowdWave (periodBeats/dirDeg params, prefixed group id)', () => {
    const c = byId.get('crowd-1-000')!
    expect(c.effectId).toBe('crowd-wave-lateral')
    expect(c.positionId).toBe('mast-east')
    expect(c.params).toEqual({ periodBeats: 16, dirDeg: 90 })
  })

  it('pulse: wraps crowdRadial when originCell is given', () => {
    const c = byId.get('crowd-2-000')!
    expect(c.effectId).toBe('crowd-pulse-radial')
    expect(c.params).toEqual({ originCell: 170, periodBeats: 2 })
  })

  it('pulse: omitting originCell emits a bare cue (sim uses the zone center)', () => {
    const c = byId.get('crowd-8-000')!
    expect(c.effectId).toBe('crowd-pulse-radial')
    expect(c.positionId).toBe('mast-west')
    expect(c.params).toBeUndefined()
  })

  it('chase: `sections` cues with anchors stepped by stepBeats', () => {
    const cues = crowd.cues.filter((c) => c.id.startsWith('crowd-3-'))
    expect(cues.map((c) => c.id)).toEqual(['crowd-3-000', 'crowd-3-001', 'crowd-3-002'])
    expect(cues.map((c) => c.anchor)).toEqual([
      { kind: 'barBeat', bar: 9, beat: 1 },
      { kind: 'barBeat', bar: 9, beat: 1, offsetBeats: 12 },
      { kind: 'barBeat', bar: 9, beat: 1, offsetBeats: 24 },
    ])
    for (const c of cues) {
      expect(c.effectId).toBe('crowd-chase-sections')
      expect(c.positionId).toBe('mast-east')
      expect(c.params).toEqual({ sections: 3 })
    }
  })

  it('text: wraps crowdText (params.text + rgb)', () => {
    const c = byId.get('crowd-4-000')!
    expect(c.effectId).toBe('crowd-text-marquee')
    expect(c.params).toEqual({ text: 'HELLO PARK', rgb: [1, 1, 1] })
  })

  it('sparkle: inline cue with densityFrac/twinkleHz params', () => {
    const c = byId.get('crowd-5')!
    expect(c.effectId).toBe('crowd-sparkle-gold')
    expect(c.positionId).toBe('mast-east')
    expect(c.params).toEqual({ densityFrac: 0.3, twinkleHz: 5 })
  })

  it('heartbeat: wraps crowdHeartbeat (optional originCell)', () => {
    const c = byId.get('crowd-6-000')!
    expect(c.effectId).toBe('crowd-heartbeat-red')
    expect(c.params).toEqual({ originCell: 152 })
  })

  it('haptic: bare inline cue (no params)', () => {
    const c = byId.get('crowd-7')!
    expect(c.effectId).toBe('crowd-haptic-thump')
    expect(c.positionId).toBe('mast-east')
    expect(c.anchor).toEqual({ kind: 'barBeat', bar: 29, beat: 1 })
    expect(c.params).toBeUndefined()
  })
})

describe('b.beams facades (track/cue structure)', () => {
  const b = showBuilder({
    id: 'beam-struct',
    title: 'Beam Structure',
    seed: 11,
    site: siteWithStagePair(),
    catalog,
  })
    .score(score)
    .preRoll(6)
  // The tag facade references this cue (sourceCueId must resolve, and its
  // active window [44, 58) overlaps the tag's).
  b.drones.formation({
    id: 'hero-ring',
    effect: 'ring-formation-60',
    position: 'pad-1',
    by: m.barBeat(23, 1),
    holdSec: 4,
    params: { count: 40, scaleM: 24 },
  })
  b.beams
    .whisper({
      effect: 'beam-whisper-narration',
      position: 'beam-south-west',
      target: 267,
      land: m.barBeat(3, 1),
      gainDb: -2,
    })
    .stereo({
      effect: 'beam-stereo-bed',
      positions: ['beam-stage-west', 'beam-stage-east'],
      target: 94,
      land: m.barBeat(5, 1),
    })
    .flyover({
      effect: 'beam-flyover-whoosh',
      position: 'beam-south-west',
      path: [266, 267, 268],
      land: m.barBeat(11, 1),
    })
    .pingPong({
      effect: 'beam-pingpong-blip',
      position: 'beam-south-west',
      cells: [266, 268],
      periodBeats: 8,
      land: m.barBeat(16, 1),
    })
    .stereo({
      effect: 'beam-stereo-bed',
      positions: ['beam-stage-west', 'beam-stage-east'],
      target: 134,
      land: m.barBeat(19, 1),
      pairId: 'bed-2',
      extraDelayMs: 12,
      gainDb: -3,
    })
    .tag({
      effect: 'beam-tag-drone',
      position: 'beam-south-east',
      source: 'hero-ring',
      fallbackTarget: 302,
      land: m.barBeat(25, 1),
    })
    .toll({ effect: 'beam-toll-bell', position: 'beam-stage-east', land: m.barBeat(29, 1) })
  const { show } = b.build()
  const beams = track(show, 'beams')
  const byId = new Map(beams.cues.map((c) => [c.id, c]))

  it("emits one 'beams' track with medium 'beam' and all cues", () => {
    expect(show.tracks.map((t) => t.id)).toEqual(['drones', 'beams'])
    expect(beams.medium).toBe('beam')
    expect(beams.name).toBe('Beams')
    expect(beams.cues).toHaveLength(9) // 5 singles + 2 stereo pairs
  })

  it('whisper: params.targetCellId + gainDb', () => {
    const c = byId.get('beams-0-000')!
    expect(c.effectId).toBe('beam-whisper-narration')
    expect(c.positionId).toBe('beam-south-west')
    expect(c.anchor).toEqual({ kind: 'barBeat', bar: 3, beat: 1 })
    expect(c.params).toEqual({ targetCellId: 267, gainDb: -2 })
  })

  it('stereo: exactly two cues, roles L/R, auto pairId from the id prefix', () => {
    const l = byId.get('beams-1-000')!
    const r = byId.get('beams-1-001')!
    expect(l.params).toEqual({ targetCellId: 94, pairId: 'beams-1', role: 'L' })
    expect(r.params).toEqual({ targetCellId: 94, pairId: 'beams-1', role: 'R' })
    expect(l.positionId).toBe('beam-stage-west')
    expect(r.positionId).toBe('beam-stage-east')
    expect(l.anchor).toEqual(r.anchor)
    expect(beams.cues.filter((c) => c.params?.pairId === 'beams-1')).toHaveLength(2)
  })

  it('stereo: explicit pairId wins; extraDelayMs rides the R cue only', () => {
    const l = byId.get('beams-4-000')!
    const r = byId.get('beams-4-001')!
    expect(l.params).toEqual({ targetCellId: 134, pairId: 'bed-2', role: 'L', gainDb: -3 })
    expect(r.params).toEqual({
      targetCellId: 134,
      pairId: 'bed-2',
      role: 'R',
      extraDelayMs: 12,
      gainDb: -3,
    })
  })

  it('flyover: params.pathCellIds in order', () => {
    const c = byId.get('beams-2-000')!
    expect(c.effectId).toBe('beam-flyover-whoosh')
    expect(c.params).toEqual({ pathCellIds: [266, 267, 268] })
  })

  it('pingPong: cells become pathCellIds with periodBeats', () => {
    const c = byId.get('beams-3-000')!
    expect(c.effectId).toBe('beam-pingpong-blip')
    expect(c.params).toEqual({ pathCellIds: [266, 268], periodBeats: 8 })
  })

  it('tag: params.sourceCueId + fallback targetCellId', () => {
    const c = byId.get('beams-5-000')!
    expect(c.effectId).toBe('beam-tag-drone')
    expect(c.positionId).toBe('beam-south-east')
    expect(c.params).toEqual({ sourceCueId: 'hero-ring', targetCellId: 302 })
  })

  it("toll: params.cells = 'all'", () => {
    const c = byId.get('beams-6-000')!
    expect(c.effectId).toBe('beam-toll-bell')
    expect(c.positionId).toBe('beam-stage-east')
    expect(c.params).toEqual({ cells: 'all' })
  })
})

describe('crowd + beams end-to-end (lakesidePark, south arrays only)', () => {
  // Documents the geometry the beam targets rely on.
  it('the lakeside crowd grid is the documented 38×9 = 342-cell canvas', () => {
    const grid = crowdGridFor(lakesidePark())!
    expect(grid.cols).toBe(38)
    expect(grid.rows).toBe(9)
    expect(grid.cells).toHaveLength(342)
    // Front-corner cells used as beam targets: ~18 m from the south arrays.
    expect(grid.cells[267]!.centroid).toEqual({ x: -138, y: -200 }) // west
    expect(grid.cells[302]!.centroid).toEqual({ x: 142, y: -200 }) // east
  })

  function buildIntegrationShow() {
    const b = showBuilder({
      id: 'crowd-beam-e2e',
      title: 'Crowd & Beams',
      seed: 404,
      site: lakesidePark(),
      catalog,
    })
      .score(score)
      .preRoll(6)

    b.drones.formation({
      id: 'hero-ring',
      effect: 'ring-formation-60',
      position: 'pad-1',
      by: m.barBeat(23, 1),
      holdSec: 4,
      params: { count: 40, scaleM: 24 },
    })

    // Alternating masts, ≤ 30 Hz concurrent maskUpdateHz per mast.
    b.crowd
      .flood({ effect: 'crowd-flood-rgb', position: 'mast-west', from: m.barBeat(3, 1) })
      .wave({
        effect: 'crowd-wave-lateral',
        position: 'mast-east',
        from: m.barBeat(6, 1),
        periodBeats: 16,
      })
      .pulse({
        effect: 'crowd-pulse-radial',
        position: 'mast-west',
        land: m.barBeat(12, 1),
        originCell: 170,
      })
      .chase({
        effect: 'crowd-chase-sections',
        position: 'mast-east',
        startLand: m.barBeat(16, 1),
        stepBeats: 12,
        sections: 2,
      })
      .text('THEODOOR', {
        effect: 'crowd-text-marquee',
        position: 'mast-west',
        land: m.barBeat(24, 1),
      })
      .sparkle({ effect: 'crowd-sparkle-gold', position: 'mast-east', from: m.barBeat(25, 1) })
      .heartbeat({ effect: 'crowd-heartbeat-red', position: 'mast-west', land: m.barBeat(27, 1) })
      .haptic({ effect: 'crowd-haptic-thump', position: 'mast-east', land: m.barBeat(29, 1) })

    // South arrays only: row-7 corner cells sit in the ~18–21 m band that
    // clears both the horizon margin and the carrier-exposure ceiling.
    b.beams
      .whisper({
        effect: 'beam-whisper-narration',
        position: 'beam-south-west',
        target: 267,
        land: m.barBeat(3, 1),
      })
      .flyover({
        effect: 'beam-flyover-whoosh',
        position: 'beam-south-west',
        path: [266, 267, 268],
        land: m.barBeat(11, 1),
      })
      .pingPong({
        effect: 'beam-pingpong-blip',
        position: 'beam-south-west',
        cells: [266, 268],
        periodBeats: 8,
        land: m.barBeat(16, 1),
      })
      .tag({
        effect: 'beam-tag-drone',
        position: 'beam-south-east',
        source: 'hero-ring',
        fallbackTarget: 302,
        land: m.barBeat(24, 1),
      })

    return b.build()
  }

  it('builds with zero error diagnostics and the expected track layout', () => {
    const { show, compiled } = buildIntegrationShow()
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(show.tracks.map((t) => t.id)).toEqual(['drones', 'crowd', 'beams'])
    expect(compiled.cues).toHaveLength(14) // 1 drone + 9 crowd + 4 beam
    const byMedium = new Map<string, number>()
    for (const c of compiled.cues) byMedium.set(c.medium, (byMedium.get(c.medium) ?? 0) + 1)
    expect(byMedium.get('drone')).toBe(1)
    expect(byMedium.get('crowd')).toBe(9)
    expect(byMedium.get('beam')).toBe(4)
  })

  it('stays clean under the wave-1 conflict passes and the exposure budget', () => {
    const { show, compiled } = buildIntegrationShow()
    expect(crowdBandwidth(compiled.cues, show.site.assets, getEffect)).toEqual([])
    expect(beamSlew(compiled.cues, show.site, getEffect)).toEqual([])
    const report = exposureReport(compiled, getEffect)
    expect(report.violations).toEqual([])
    expect(report.pass).toBe(true)
  })
})
