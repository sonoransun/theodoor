import { describe, expect, it } from 'vitest'
import type { CompiledShow, SitePlan } from '../src/contracts.js'
import { SPEED_OF_SOUND_MPS } from '../src/contracts.js'
import {
  BEAM_LEAKAGE_DB,
  beamAimAt,
  inFootprint,
  sourceGroundResolver,
} from '../src/acoustics/beams.js'
import { splAtInstant } from '../src/acoustics/spl.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { formationFromEffect } from '../src/choreo/generators/fromEffect.js'
import { crowdGridFor, type CrowdGrid } from '../src/site/crowdGrid.js'
import { lakesidePark } from '../src/site/presets.js'
import { runHeadless, SimEngine } from '../src/sim/index.js'
import { makeCompiled, sixCueShow, type CueSpec } from './sim-fixture.js'

const site = lakesidePark()
const grid = crowdGridFor(site)!

function cellAt(g: CrowdGrid, row: number, col: number) {
  const cell = g.cells.find((c) => c.row === row && c.col === col)
  if (!cell) throw new Error(`no crowd cell at (${row}, ${col})`)
  return cell
}

/** Acoustic time-of-flight from a beam array to a crowd cell (test-side solver). */
function tofSec(arrayId: string, row: number, col: number): number {
  const asset = site.assets.find((a) => a.id === arrayId)!
  return beamAimAt(asset, cellAt(grid, row, col).centroid).slantM / SPEED_OF_SOUND_MPS
}

function beamCue(spec: Partial<CueSpec> & { id: string; effectId: string }): CueSpec {
  return {
    trackId: 'trk-beam',
    medium: 'beam',
    positionId: 'beam-south-west',
    targetSec: 10,
    anticipationSec: 0.03,
    durationSec: 12,
    ...spec,
  } as CueSpec
}

/** Drone cue d1 [18, 28) + a sourceTag beam [7.95, 20) tagging `sourceCueId`. */
function tagFixture(
  fallbackIndex: number,
  sourceCueId: string,
  siteOverride?: SitePlan,
): CompiledShow {
  return makeCompiled(
    [
      { id: 'd1', trackId: 'trk-drone', medium: 'drone', effectId: 'ring-formation-60',
        positionId: 'pad-1', targetSec: 18, anticipationSec: 0, durationSec: 10,
        params: { count: 24, scaleM: 30 } },
      beamCue({ id: 'b1', effectId: 'beam-tag-drone', targetSec: 8, anticipationSec: 0.05,
        params: { sourceCueId, targetCellId: fallbackIndex } }),
    ],
    {
      fleet: { count: 24, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 },
      ...(siteOverride ? { site: siteOverride } : {}),
    },
  )
}

describe('sim/beams — windows & state fields', () => {
  it('a beam state exists only inside [fireSec, targetSec + durationSec)', () => {
    // Cell (8, 1) sits ~10 m from beam-south-west: short throw, bounded footprint.
    const cell = cellAt(grid, 8, 1)
    const tof = tofSec('beam-south-west', 8, 1)
    const engine = new SimEngine(makeCompiled([
      beamCue({ id: 'b1', effectId: 'beam-whisper-narration', anticipationSec: tof,
        params: { targetCellId: cell.index, gainDb: 3 } }),
    ]))

    engine.advanceTo(9.9) // before fireSec ≈ 9.969
    expect(engine.snapshot().beams).toEqual([])

    engine.advanceTo(9.98) // wavefront in flight
    const beams = engine.snapshot().beams
    expect(beams.length).toBe(1)
    const b = beams[0]!
    expect(b.cueIdx).toBe(0)
    expect(b.assetId).toBe('beam-south-west')
    expect(b.apex).toEqual({ x: -140, y: -182, z: 8 })
    expect(b.halfAngleDeg).toBe(3) // beamWidthDeg 6
    expect(b.audibleDbAtRef).toBe(66 + 3) // noiseDbAt15m + gainDb
    expect(b.carrierDbAtRef).toBe(104)
    expect(b.target.x).toBeCloseTo(cell.centroid.x, 9)
    expect(b.target.y).toBeCloseTo(cell.centroid.y, 9)
    expect(b.footprint.a).toBeGreaterThan(0) // short throw → bounded ellipse
    expect(b.footprint.b).toBeGreaterThan(0)
    expect(inFootprint(b.footprint, cell.centroid)).toBe(true)
    expect(b.landed).toBe(false)

    engine.advanceTo(21.99) // still active (window ends at 22)
    expect(engine.snapshot().beams.length).toBe(1)
    engine.advanceTo(22)
    expect(engine.snapshot().beams).toEqual([])
  })

  it('landed flips false → true exactly at targetSec', () => {
    const tof = tofSec('beam-south-west', 8, 1)
    const engine = new SimEngine(makeCompiled([
      beamCue({ id: 'b1', effectId: 'beam-whisper-narration', anticipationSec: tof,
        params: { targetCellId: cellAt(grid, 8, 1).index } }),
    ]))
    engine.advanceTo(10 - 1 / 120) // last step before targetSec
    expect(engine.snapshot().beams[0]!.landed).toBe(false)
    engine.advanceTo(10) // the wavefront lands on the musical moment
    expect(engine.snapshot().beams[0]!.landed).toBe(true)
  })

  it('stereo pair: pairId / role / extraDelayMs pass through per cue', () => {
    const cell = cellAt(grid, 8, 3)
    const engine = new SimEngine(makeCompiled([
      beamCue({ id: 'sL', effectId: 'beam-stereo-bed', positionId: 'beam-south-west',
        durationSec: 16, params: { targetCellId: cell.index, pairId: 'sp1', role: 'L' } }),
      beamCue({ id: 'sR', effectId: 'beam-stereo-bed', positionId: 'beam-south-east',
        durationSec: 16, params: { targetCellId: cell.index, pairId: 'sp1', role: 'R',
          extraDelayMs: 8 } }),
    ]))
    engine.advanceTo(12)
    const beams = engine.snapshot().beams
    expect(beams.length).toBe(2)
    const left = beams.find((b) => b.assetId === 'beam-south-west')!
    const right = beams.find((b) => b.assetId === 'beam-south-east')!
    expect(left.pairId).toBe('sp1')
    expect(right.pairId).toBe('sp1')
    expect(left.role).toBe('L')
    expect(right.role).toBe('R')
    expect(left.extraDelayMs).toBeUndefined()
    expect(right.extraDelayMs).toBe(8)
    // Both aimed (crossed) on the same cell.
    expect(left.target).toEqual(right.target)
  })
})

describe('sim/beams — steering programs', () => {
  it('flyover: the target sweeps monotonically along the path cells', () => {
    const path = [30, 31, 32, 33, 34, 35, 36].map((c) => cellAt(grid, 8, c))
    const engine = new SimEngine(makeCompiled([
      beamCue({ id: 'b1', effectId: 'beam-flyover-whoosh', positionId: 'beam-south-east',
        targetSec: 12, durationSec: 6, params: { pathCellIds: path.map((c) => c.index) } }),
    ]))
    let prevX = -Infinity
    const xs: number[] = []
    for (const t of [12, 13, 14, 15, 16, 17, 17.9]) {
      engine.advanceTo(t)
      const b = engine.snapshot().beams[0]!
      expect(b.target.x).toBeGreaterThanOrEqual(prevX)
      prevX = b.target.x
      xs.push(b.target.x)
    }
    expect(xs[0]!).toBeCloseTo(path[0]!.centroid.x, 9) // starts on the first cell
    expect(xs[xs.length - 1]!).toBeGreaterThan(xs[0]!) // and actually travels
  })

  it('sourceTag follows the tagged DRONE cue during its window, fallback outside', () => {
    const fallback = cellAt(grid, 8, 1)
    const compiled = tagFixture(fallback.index, 'd1')
    // Expected ground: pad-1 pos + the tagged formation's ground centroid —
    // the single-owner math sourceGroundResolver shares with sim/drones.
    const getEffect = getEffectFrom(starterCatalog())
    const droneFx = getEffect('ring-formation-60')!
    if (droneFx.medium !== 'drone') throw new Error('fixture effect must be a drone primitive')
    const d1 = compiled.cues.find((c) => c.id === 'd1')!
    const pts = formationFromEffect(droneFx, d1.params, d1.seed).points
    const gx = 0 + pts.reduce((s, p) => s + p.x, 0) / pts.length // pad-1 at (0, 40)
    const gy = 40 + pts.reduce((s, p) => s + p.y, 0) / pts.length

    const engine = new SimEngine(compiled)
    // Before the SOURCE window [18, 28): the fallback cell, never the fleet.
    engine.advanceTo(9)
    let b = engine.snapshot().beams[0]!
    expect(b.target.x).toBeCloseTo(fallback.centroid.x, 9)
    expect(b.target.y).toBeCloseTo(fallback.centroid.y, 9)
    // Inside the source window: the tagged formation's ground point.
    engine.advanceTo(19)
    b = engine.snapshot().beams[0]!
    expect(b.target.x).toBeCloseTo(gx, 9)
    expect(b.target.y).toBeCloseTo(gy, 9)
    // …and NOT the static fallback cell.
    expect(Math.hypot(b.target.x - fallback.centroid.x, b.target.y - fallback.centroid.y))
      .toBeGreaterThan(50)
  })

  it('sourceTag tagging a PYRO cue aims at its rack, not the airborne drone fleet', () => {
    const fallback = cellAt(grid, 8, 1)
    // Drones fly [18, 28) while the beam tags the pyro shell on rack-4
    // (window [19, 20.8)) — the aim must be the rack, never the fleet.
    const compiled = makeCompiled(
      [
        { id: 'd1', trackId: 'trk-drone', medium: 'drone', effectId: 'ring-formation-60',
          positionId: 'pad-1', targetSec: 18, anticipationSec: 0, durationSec: 10,
          params: { count: 24, scaleM: 30 } },
        { id: 'p1', trackId: 'trk-pyro', medium: 'pyro', effectId: 'peony-75-red',
          positionId: 'rack-4', targetSec: 19, anticipationSec: 2.2, durationSec: 1.8 },
        beamCue({ id: 'b1', effectId: 'beam-tag-drone', targetSec: 8, anticipationSec: 0.05,
          params: { sourceCueId: 'p1', targetCellId: fallback.index } }),
      ],
      { fleet: { count: 24, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 } },
    )
    const rack = site.assets.find((a) => a.id === 'rack-4')!
    const engine = new SimEngine(compiled)
    engine.advanceTo(19.5) // beam active, pyro source active, drones airborne
    const s = engine.snapshot()
    expect(s.drones.count).toBe(24)
    const b = s.beams[0]!
    expect(b.target.x).toBeCloseTo(rack.pos.x, 9)
    expect(b.target.y).toBeCloseTo(rack.pos.y, 9)
    // The old global-fleet plumbing would have aimed near pad-1 at (0, 40).
    expect(Math.hypot(b.target.x - 0, b.target.y - 40)).toBeGreaterThan(30)
  })

  it("the SPL channel and the beams channel of one snapshot share the sourceTag aim", () => {
    const fallback = cellAt(grid, 8, 1)
    // Listener parked on the fallback cell: the OLD static-aim SPL path put
    // it in-footprint (~20 dB hot) while the beams channel chased the source.
    const listener = fallback.centroid
    const compiled = tagFixture(fallback.index, 'd1', {
      ...lakesidePark(),
      refListenerPos: [listener],
    })
    const engine = new SimEngine(compiled)
    engine.advanceTo(19) // beam active, source window [18, 28) active
    const s = engine.snapshot()

    const getEffect = getEffectFrom(starterCatalog())
    const opts = {
      beats: compiled.show.music.beats,
      sourceGroundAt: sourceGroundResolver(compiled, getEffect),
    }
    const withOpts = splAtInstant(compiled, getEffect, listener, 19, opts)
    expect(s.splByListener[0]).toBeCloseTo(withOpts, 9)
    // Without opts the beam resolves the fallback aim (listener in-footprint):
    // the two channels would disagree by ~BEAM_LEAKAGE_DB.
    const withoutOpts = splAtInstant(compiled, getEffect, listener, 19)
    expect(withoutOpts - s.splByListener[0]!).toBeGreaterThan(BEAM_LEAKAGE_DB - 5)
  })

  it('an over-the-horizon aim packs a degenerate footprint (never in-footprint)', () => {
    // The 8 m corner mast throws ~73 m; the far-east lawn corner is ~285 m
    // away, so the upper cone edge escapes the horizon margin.
    const cell = cellAt(grid, 4, 36)
    const engine = new SimEngine(makeCompiled([
      beamCue({ id: 'b1', effectId: 'beam-whisper-narration', positionId: 'beam-south-west',
        targetSec: 6, anticipationSec: 0.83, params: { targetCellId: cell.index } }),
    ]))
    engine.advanceTo(7)
    const b = engine.snapshot().beams[0]!
    expect(b.apex).toEqual({ x: -140, y: -182, z: 8 })
    expect(b.footprint.a).toBe(0) // horizon escape → degenerate ellipse
    expect(b.footprint.b).toBe(0)
    expect(b.footprint.cx).toBeCloseTo(cell.centroid.x, 9)
    expect(b.footprint.cy).toBeCloseTo(cell.centroid.y, 9)
    expect(inFootprint(b.footprint, b.target)).toBe(false)
    expect(inFootprint(b.footprint, { x: b.footprint.cx, y: b.footprint.cy })).toBe(false)
  })
})

describe('sim/beams — stats', () => {
  it('populates peakActiveBeams / peakCrowdCellsLit / beamLandingErrorSecMax', () => {
    const tof = tofSec('beam-south-west', 8, 1)
    const compiled = makeCompiled([
      { id: 'c1', trackId: 'trk-crowd', medium: 'crowd', effectId: 'crowd-flood-rgb',
        positionId: 'mast-west', targetSec: 5, anticipationSec: 0.08, durationSec: 8,
        params: { rgb: [1, 1, 1] } },
      beamCue({ id: 'b1', effectId: 'beam-whisper-narration', anticipationSec: tof,
        params: { targetCellId: cellAt(grid, 8, 1).index } }),
    ])
    const { stats } = runHeadless(compiled, { toSec: 25 })
    expect(stats.peakActiveBeams).toBe(1)
    // Flood over a fully covered lawn lights (nearly) every cell.
    expect(stats.peakCrowdCellsLit).toBeGreaterThan(300)
    // fireSec = targetSec − slant/c → the wavefront lands on the beat.
    expect(stats.beamLandingErrorSecMax).toBeLessThan(1e-9)
  })

  it('stays zero for shows without crowd or beam cues', () => {
    const { stats } = runHeadless(sixCueShow(), { toSec: 10 })
    expect(stats.peakCrowdCellsLit).toBe(0)
    expect(stats.peakActiveBeams).toBe(0)
    expect(stats.beamLandingErrorSecMax).toBe(0)
  })

  it('landing error reflects a mis-anticipated beam cue', () => {
    const tof = tofSec('beam-south-west', 8, 1)
    const compiled = makeCompiled([
      beamCue({ id: 'b1', effectId: 'beam-whisper-narration', anticipationSec: 0,
        params: { targetCellId: cellAt(grid, 8, 1).index } }),
    ])
    const engine = new SimEngine(compiled)
    expect(engine.stats().beamLandingErrorSecMax).toBeCloseTo(tof, 12)
  })
})

describe('sim/beams — site typing sanity', () => {
  it('the fixture site is the flagship venue (guards the hand-built cues above)', () => {
    const arrays = site.assets.filter((a) => a.kind === 'beamArray')
    expect(arrays.map((a) => a.id).sort()).toEqual([
      'beam-delay-east', 'beam-delay-west',
      'beam-north-east', 'beam-north-west',
      'beam-south-east', 'beam-south-west',
    ])
    const south = site.assets.find((a) => a.id === 'beam-south-west')!
    expect(south.elevationM).toBe(8)
    const sitePlan: SitePlan = site // type-level: presets return a SitePlan
    expect(sitePlan.crowdGrid?.cellSizeM).toBe(8)
    expect(grid.cols * grid.rows).toBe(38 * 9)
  })
})
