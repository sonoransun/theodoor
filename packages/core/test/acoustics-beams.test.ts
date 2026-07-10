import { describe, expect, it } from 'vitest'
import type {
  BeamEffect,
  CompiledCue,
  CompiledShow,
  DronePrimitive,
  MusicalTimeline,
  PositionedAsset,
  Show,
  Vec2,
} from '../src/contracts.js'
import { SPL_REF_DISTANCE_M } from '../src/contracts.js'
import {
  BEAM_HORIZON_MARGIN_DEG,
  BEAM_LEAKAGE_DB,
  EAR_HEIGHT_M,
  angularDistanceDeg,
  beamAimAt,
  beamAudibleLevelAt,
  beamFootprintAt,
  beamTargetAt,
  inFootprint,
  sourceGroundResolver,
} from '../src/acoustics/beams.js'
import { splAtDistance, splAtInstant } from '../src/acoustics/spl.js'
import { formationFromEffect } from '../src/choreo/generators/fromEffect.js'
import { crowdGridFor, lakesidePark } from '../src/site/index.js'

const whisper: BeamEffect = {
  id: 'b-whisper',
  name: 'Test Whisper',
  medium: 'beam',
  tags: ['low-noise', 'beam'],
  noiseDbAt15m: 66,
  durationSec: 12,
  program: 'whisperZone',
  beamWidthDeg: 6,
  carrierBandLabel: 'u-band-40',
  maxCarrierDbAtFocus: 104,
  contentTag: 'narration',
}

/** Synthetic head for pure-geometry checks: 6 m up, facing south. */
const head: PositionedAsset = {
  id: 'head-1',
  kind: 'beamArray',
  pos: { x: 0, y: 0 },
  headingDeg: 180,
  elevationM: 6,
  beamArray: {
    panRangeDeg: 120,
    tiltMinDeg: -45,
    tiltMaxDeg: 10,
    steerRateDegPerSec: 45,
    minFocusDistanceM: 5,
  },
}

let cueCounter = 0
function beamCue(positionId: string, params: CompiledCue['params'], durationSec = 12): CompiledCue {
  return {
    id: `bcue-${++cueCounter}`,
    trackId: 'beams',
    medium: 'beam',
    effectId: whisper.id,
    positionId,
    targetSec: 10,
    fireSec: 9.5,
    anticipationSec: 0.5,
    durationSec,
    seed: 7,
    params,
  }
}

function makeCompiled(cues: readonly CompiledCue[]): CompiledShow {
  const music: MusicalTimeline = {
    source: 'score',
    id: 'm-1',
    title: 'Test',
    duration: 60,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats: [],
    downbeats: [],
    annotations: [],
    energy: [],
    tempoConfidence: 1,
  }
  const show: Show = {
    meta: { id: 's-1', title: 'Beam Test', variant: 'standard', seed: 7 },
    music,
    site: lakesidePark(),
    catalogId: 'test',
    tracks: [],
  }
  return { show, cues, diagnostics: [] }
}

describe('beamAimAt', () => {
  it('pan/tilt/slant for a straight-downrange target', () => {
    // Target 100 m due south of a south-facing head: pan 0, azimuth 180.
    const aim = beamAimAt(head, { x: 0, y: -100 })
    expect(aim.azimuthDeg).toBeCloseTo(180, 6)
    expect(aim.panDeg).toBeCloseTo(0, 6)
    // h = 6 − 1.6 = 4.4 → depression atan2(4.4, 100) ≈ 2.519°, tilt negative.
    expect(aim.tiltDeg).toBeCloseTo(-Math.atan2(6 - EAR_HEIGHT_M, 100) / (Math.PI / 180), 6)
    expect(aim.slantM).toBeCloseTo(Math.hypot(100, 4.4), 6)
  })

  it('pan wraps relative to heading', () => {
    // Target due east of a south-facing head: azimuth 90 → pan −90.
    const aim = beamAimAt(head, { x: 50, y: 0 })
    expect(aim.azimuthDeg).toBeCloseTo(90, 6)
    expect(aim.panDeg).toBeCloseTo(-90, 6)
  })
})

describe('beamFootprintAt', () => {
  it('matches the hand-computed cone/plane ellipse', () => {
    // h = 4.4, d = 30 ⇒ ε ≈ 8.345°, α = 3°:
    //   dNear = h/tan(ε+α) ≈ 21.93, dFar = h/tan(ε−α) ≈ 47.02
    //   a ≈ 12.55, center ≈ (0, −34.48), b = slant·tanα ≈ 1.59
    const fp = beamFootprintAt(head, whisper, { x: 0, y: -30 })
    expect(fp).toBeDefined()
    expect(fp!.azimuthDeg).toBeCloseTo(180, 6)
    expect(fp!.cx).toBeCloseTo(0, 6)
    expect(fp!.cy).toBeCloseTo(-34.48, 1)
    expect(fp!.a).toBeCloseTo(12.55, 1)
    expect(fp!.b).toBeCloseTo(1.59, 1)
  })

  it('is undefined when the upper cone edge nears the horizon', () => {
    // h = 4.4 at 200 m ⇒ depression ≈ 1.26° < α + margin (3 + 2 = 5°).
    expect(beamFootprintAt(head, whisper, { x: 0, y: -200 })).toBeUndefined()
    // Margin boundary sanity: the constant itself is what gates it.
    expect(BEAM_HORIZON_MARGIN_DEG).toBe(2)
  })
})

describe('inFootprint', () => {
  const fp = beamFootprintAt(head, whisper, { x: 0, y: -30 })!

  it('accepts the aim point and the center, rejects far points', () => {
    expect(inFootprint(fp, { x: 0, y: -30 })).toBe(true)
    expect(inFootprint(fp, { x: fp.cx, y: fp.cy })).toBe(true)
    expect(inFootprint(fp, { x: 100, y: -30 })).toBe(false)
  })

  it('respects the rotated (along, cross) frame', () => {
    // Along the 180° azimuth: ±(a·0.99) from center stays in, cross ±(b·1.01) is out.
    expect(inFootprint(fp, { x: fp.cx, y: fp.cy - fp.a * 0.99 })).toBe(true)
    expect(inFootprint(fp, { x: fp.cx, y: fp.cy + fp.a * 0.99 })).toBe(true)
    expect(inFootprint(fp, { x: fp.cx + fp.b * 1.01, y: fp.cy })).toBe(false)
    expect(inFootprint(fp, { x: fp.cx + fp.b * 0.99, y: fp.cy })).toBe(true)
  })
})

describe('beamTargetAt', () => {
  const site = lakesidePark()
  const grid = crowdGridFor(site)!
  const cellCentroid = (i: number): Vec2 => grid.cells[i]!.centroid

  it('targetCellId resolves to that cell centroid', () => {
    const cue = beamCue('beam-south-west', { targetCellId: 100 })
    const p = beamTargetAt(cue, whisper, site, 10)
    expect(p).toEqual(cellCentroid(100))
  })

  it('pathCellIds sweep linearly over the active window and clamp outside', () => {
    const flyover: BeamEffect = { ...whisper, program: 'flyover' }
    const cue = beamCue('beam-north-west', { pathCellIds: [0, 10, 20] }, 4)
    expect(beamTargetAt(cue, flyover, site, 10)).toEqual(cellCentroid(0))
    expect(beamTargetAt(cue, flyover, site, 12)).toEqual(cellCentroid(10))
    const end = beamTargetAt(cue, flyover, site, 14)
    expect(end).toEqual(cellCentroid(20))
    expect(beamTargetAt(cue, flyover, site, 99)).toEqual(cellCentroid(20))
    // Midpoint of the first leg interpolates between cells 0 and 10.
    const mid = beamTargetAt(cue, flyover, site, 11)
    expect(mid.x).toBeCloseTo((cellCentroid(0).x + cellCentroid(10).x) / 2, 6)
    expect(mid.y).toBeCloseTo((cellCentroid(0).y + cellCentroid(10).y) / 2, 6)
  })

  it('pingPong alternates ends every periodBeats on the beat grid', () => {
    const pp: BeamEffect = { ...whisper, program: 'pingPong' }
    const cue = beamCue('beam-south-east', { pathCellIds: [5, 40], periodBeats: 2 }, 12)
    const beats = Array.from({ length: 30 }, (_, i) => i) // 1 s per beat from 0
    expect(beamTargetAt(cue, pp, site, 10.1, { beats })).toEqual(cellCentroid(5))
    expect(beamTargetAt(cue, pp, site, 12.5, { beats })).toEqual(cellCentroid(40))
    expect(beamTargetAt(cue, pp, site, 14.5, { beats })).toEqual(cellCentroid(5))
  })

  it('sourceTag prefers the tagged ground point', () => {
    const tag: BeamEffect = { ...whisper, program: 'sourceTag' }
    const cue = beamCue('beam-north-east', { targetCellId: 3 })
    expect(beamTargetAt(cue, tag, site, 10, { sourceGround: { x: 12, y: -200 } })).toEqual({
      x: 12,
      y: -200,
    })
    expect(beamTargetAt(cue, tag, site, 10)).toEqual(cellCentroid(3))
  })
})

describe('sourceGroundResolver', () => {
  const site = lakesidePark()
  const tag: BeamEffect = { ...whisper, id: 'b-tag', program: 'sourceTag' }

  const droneFx: DronePrimitive = {
    id: 'd-ring',
    name: 'Test Ring',
    medium: 'drone',
    tags: ['low-noise'],
    noiseDbAt15m: 58,
    durationSec: 10,
    formation: 'ring',
    minDrones: 8,
    maxDrones: 60,
    scaleM: 30,
  }
  const getEffect = (id: string) => (id === droneFx.id ? droneFx : id === tag.id ? tag : undefined)

  const droneCue: CompiledCue = {
    id: 'd1', trackId: 'trk', medium: 'drone', effectId: 'd-ring', positionId: 'pad-1',
    targetSec: 18, fireSec: 12, anticipationSec: 6, durationSec: 10, seed: 5,
    params: { count: 12, scaleM: 30 },
  }
  const pyroCue: CompiledCue = {
    id: 'p1', trackId: 'trk', medium: 'pyro', effectId: 'shell-x', positionId: 'rack-4',
    targetSec: 20, fireSec: 18, anticipationSec: 2, durationSec: 2, seed: 5,
  }
  const tagCue = (sourceCueId?: string): CompiledCue => ({
    id: 'b1', trackId: 'trk', medium: 'beam', effectId: tag.id, positionId: 'beam-north-east',
    targetSec: 10, fireSec: 9.5, anticipationSec: 0.5, durationSec: 20, seed: 7,
    params: { ...(sourceCueId !== undefined ? { sourceCueId } : {}), targetCellId: 3 },
  })

  function compiledWith(cues: readonly CompiledCue[]): CompiledShow {
    return makeCompiled(cues)
  }

  it('drone source: pad pos + formation ground centroid, only during its window', () => {
    const resolve = sourceGroundResolver(compiledWith([droneCue, tagCue('d1')]), getEffect)
    const pts = formationFromEffect(droneFx, droneCue.params, droneCue.seed).points
    const pad = site.assets.find((a) => a.id === 'pad-1')! // (0, 40)
    const gx = pad.pos.x + pts.reduce((s, p) => s + p.x, 0) / pts.length
    const gy = pad.pos.y + pts.reduce((s, p) => s + p.y, 0) / pts.length
    const at18 = resolve(tagCue('d1'), 18)!
    expect(at18.x).toBeCloseTo(gx, 9)
    expect(at18.y).toBeCloseTo(gy, 9)
    expect(resolve(tagCue('d1'), 27.999)).toBeDefined()
    // Half-open window [18, 28): outside → undefined (fallback in callers).
    expect(resolve(tagCue('d1'), 17.999)).toBeUndefined()
    expect(resolve(tagCue('d1'), 28)).toBeUndefined()
  })

  it('pyro source: the rack asset position during its window (no effect lookup needed)', () => {
    const resolve = sourceGroundResolver(compiledWith([pyroCue, tagCue('p1')]), getEffect)
    const rack = site.assets.find((a) => a.id === 'rack-4')!
    expect(resolve(tagCue('p1'), 20)).toEqual({ x: rack.pos.x, y: rack.pos.y })
    expect(resolve(tagCue('p1'), 21.999)).toEqual({ x: rack.pos.x, y: rack.pos.y })
    expect(resolve(tagCue('p1'), 22)).toBeUndefined()
    expect(resolve(tagCue('p1'), 19.999)).toBeUndefined()
  })

  it('dangling / absent / non-source references resolve to undefined', () => {
    const laserish: CompiledCue = { ...pyroCue, id: 'l1', medium: 'laser' }
    const resolve = sourceGroundResolver(compiledWith([laserish, tagCue('d1')]), getEffect)
    expect(resolve(tagCue('nope'), 18)).toBeUndefined() // dangling id
    expect(resolve(tagCue(), 18)).toBeUndefined() // no sourceCueId param
    expect(resolve(tagCue('l1'), 20)).toBeUndefined() // laser cue: not a source medium
  })

  it('beamTargetAt falls back to targetCellId when the resolver yields undefined', () => {
    const compiled = compiledWith([droneCue, tagCue('d1')])
    const resolve = sourceGroundResolver(compiled, getEffect)
    const cue = tagCue('d1')
    const grid = crowdGridFor(site)!
    // t=10: source inactive → resolver undefined → the fallback cell.
    const ground10 = resolve(cue, 10)
    expect(ground10).toBeUndefined()
    expect(beamTargetAt(cue, tag, site, 10, { ...(ground10 ? { sourceGround: ground10 } : {}) }))
      .toEqual(grid.cells[3]!.centroid)
    // t=20: source active → the resolved ground wins.
    const ground20 = resolve(cue, 20)!
    expect(beamTargetAt(cue, tag, site, 20, { sourceGround: ground20 })).toEqual(ground20)
  })
})

describe('beamAudibleLevelAt + spl integration', () => {
  const site = lakesidePark()
  const grid = crowdGridFor(site)!

  // A short-throw cell close to beam-south-west at (−140, −182), elev 4 m:
  // row 8 / col 1 centroid (−138, −192) is ~10.2 m downrange, depression ~13°.
  const nearIndex = grid.cells.find((c) => c.row === 8 && c.col === 1)!.index
  const nearCell = grid.cells.find((c) => c.row === 8 && c.col === 1)!.centroid
  const farIndex = grid.cells.find((c) => c.row === 0 && c.col === 36)!.index

  it('same listener: in-footprint vs out-of-footprint differ by exactly the leakage', () => {
    const atListener = (targetCellId: number): number =>
      beamAudibleLevelAt(beamCue('beam-south-west', { targetCellId }), whisper, site, nearCell, 10)
    const inLevel = atListener(nearIndex)
    const outLevel = atListener(farIndex)
    expect(inLevel - outLevel).toBeCloseTo(BEAM_LEAKAGE_DB, 6)
    // And the in-beam level is the slant-propagated reference level
    // (beam-south-west sits on an 8 m corner mast).
    const h = 8 - EAR_HEIGHT_M
    const slant = Math.hypot(Math.hypot(nearCell.x + 140, nearCell.y + 182), h)
    expect(inLevel).toBeCloseTo(splAtDistance(66, SPL_REF_DISTANCE_M, slant), 6)
  })

  it('gainDb rides on top of the effect level', () => {
    const base = beamAudibleLevelAt(
      beamCue('beam-south-west', { targetCellId: nearIndex }),
      whisper, site, nearCell, 10,
    )
    const boosted = beamAudibleLevelAt(
      beamCue('beam-south-west', { targetCellId: nearIndex, gainDb: 6 }),
      whisper, site, nearCell, 10,
    )
    expect(boosted - base).toBeCloseTo(6, 6)
  })

  it('splAtInstant routes beam cues through the time-varying level', () => {
    const cue = beamCue('beam-south-west', { targetCellId: nearIndex })
    const compiled = makeCompiled([cue])
    const getEffect = (id: string): BeamEffect | undefined => (id === whisper.id ? whisper : undefined)
    const inDb = splAtInstant(compiled, getEffect, nearCell, 11)
    const h = 8 - EAR_HEIGHT_M
    const slant = Math.hypot(Math.hypot(nearCell.x + 140, nearCell.y + 182), h)
    expect(inDb).toBeCloseTo(splAtDistance(66, SPL_REF_DISTANCE_M, slant), 6)
    // Outside the active window the beam is silent.
    expect(splAtInstant(compiled, getEffect, nearCell, 30)).toBe(-Infinity)
  })

  it('splAtInstant opts forward the sourceTag ground track to the beam gate', () => {
    const tag: BeamEffect = { ...whisper, id: 'b-tag', program: 'sourceTag' }
    const source: CompiledCue = {
      id: 'p1', trackId: 'trk', medium: 'pyro', effectId: 'shell-x', positionId: 'rack-4',
      targetSec: 10, fireSec: 8, anticipationSec: 2, durationSec: 12, seed: 1,
    }
    const cue: CompiledCue = {
      ...beamCue('beam-south-west', { sourceCueId: 'p1', targetCellId: nearIndex }),
      effectId: tag.id,
    }
    const compiled = makeCompiled([source, cue])
    const getEffect = (id: string): BeamEffect | undefined => (id === tag.id ? tag : undefined)
    const resolver = sourceGroundResolver(compiled, getEffect)
    // With the resolver the beam aims at rack-4 (over the horizon), so the
    // near-cell listener is leakage-suppressed; without opts it resolves the
    // fallback cell and reads exactly BEAM_LEAKAGE_DB hotter.
    const withTrack = splAtInstant(compiled, getEffect, nearCell, 11, { sourceGroundAt: resolver })
    const fallback = splAtInstant(compiled, getEffect, nearCell, 11)
    expect(fallback - withTrack).toBeCloseTo(BEAM_LEAKAGE_DB, 6)
  })

  it('splAtInstant opts forward the beat grid to pingPong programs', () => {
    const pp: BeamEffect = { ...whisper, id: 'b-pp', program: 'pingPong' }
    const cue: CompiledCue = {
      ...beamCue('beam-south-west', { pathCellIds: [farIndex, nearIndex], periodBeats: 1 }),
      effectId: pp.id,
    }
    const compiled = makeCompiled([cue])
    const getEffect = (id: string): BeamEffect | undefined => (id === pp.id ? pp : undefined)
    const beats: number[] = []
    for (let t = 0; t <= 60; t += 0.25) beats.push(t) // 240 bpm
    // At t = 10.3 the beat clock has flipped to the near cell (in-footprint);
    // the 1 s/beat fallback still parks on the far, over-horizon end.
    const onGrid = splAtInstant(compiled, getEffect, nearCell, 10.3, { beats })
    const offGrid = splAtInstant(compiled, getEffect, nearCell, 10.3)
    expect(onGrid - offGrid).toBeCloseTo(BEAM_LEAKAGE_DB, 6)
  })
})

describe('angularDistanceDeg', () => {
  it('matches simple arcs', () => {
    expect(angularDistanceDeg({ panDeg: 0, tiltDeg: 0 }, { panDeg: 90, tiltDeg: 0 })).toBeCloseTo(90, 6)
    expect(angularDistanceDeg({ panDeg: 0, tiltDeg: 0 }, { panDeg: 0, tiltDeg: 45 })).toBeCloseTo(45, 6)
    expect(angularDistanceDeg({ panDeg: -30, tiltDeg: 5 }, { panDeg: -30, tiltDeg: 5 })).toBeCloseTo(0, 6)
  })
})
