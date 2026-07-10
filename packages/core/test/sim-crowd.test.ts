import { describe, expect, it } from 'vitest'
import type { SimSnapshot, SitePlan } from '../src/contracts.js'
import { SPEED_OF_SOUND_MPS } from '../src/contracts.js'
import { beamAimAt } from '../src/acoustics/beams.js'
import {
  coveredCellIndices,
  crowdGridFor,
  crowdMastFor,
  type CrowdGrid,
} from '../src/site/crowdGrid.js'
import { lakesidePark } from '../src/site/presets.js'
import { SimEngine } from '../src/sim/index.js'
import { hashSnapshot, makeCompiled, type CueSpec } from './sim-fixture.js'

const grid = crowdGridFor(lakesidePark())!

function cellAt(g: CrowdGrid, row: number, col: number) {
  const cell = g.cells.find((c) => c.row === row && c.col === col)
  if (!cell) throw new Error(`no crowd cell at (${row}, ${col})`)
  return cell
}

/** Acoustic time-of-flight from a beam array to a crowd cell (test-side solver). */
function tofSec(site: SitePlan, arrayId: string, row: number, col: number): number {
  const asset = site.assets.find((a) => a.id === arrayId)!
  const g = crowdGridFor(site)!
  return beamAimAt(asset, cellAt(g, row, col).centroid).slantM / SPEED_OF_SOUND_MPS
}

function crowdCue(spec: Partial<CueSpec> & { id: string; effectId: string }): CueSpec {
  return {
    trackId: 'trk-crowd',
    medium: 'crowd',
    positionId: 'mast-west',
    targetSec: 5,
    anticipationSec: 0.08, // wristband p95 = 80 ms (the solver's derivation)
    durationSec: 8,
    ...spec,
  } as CueSpec
}

const sumWhite = (s: SimSnapshot): number => {
  let t = 0
  for (let i = 0; i < s.crowd.cellCount; i++) t += s.crowd.white[i]!
  return t
}

const sumRgb = (s: SimSnapshot): number => {
  let t = 0
  for (let i = 0; i < s.crowd.cellCount * 3; i++) t += s.crowd.rgb[i]!
  return t
}

/** A mixed crowd + beam show for the determinism tests. */
function crowdBeamShow() {
  const site = lakesidePark()
  return makeCompiled([
    crowdCue({ id: 'cf1', effectId: 'crowd-flood-rgb', targetSec: 5, params: { rgb: [1, 1, 1] } }),
    crowdCue({ id: 'cw1', effectId: 'crowd-wave-lateral', targetSec: 6, durationSec: 10,
      params: { periodBeats: 8 } }),
    crowdCue({ id: 'cs1', effectId: 'crowd-sparkle-gold', targetSec: 8, durationSec: 12 }),
    crowdCue({ id: 'cp1', effectId: 'crowd-starfield-phone', positionId: 'mast-east',
      targetSec: 6, anticipationSec: 1.2, durationSec: 20 }),
    { id: 'bw1', trackId: 'trk-beam', medium: 'beam', effectId: 'beam-whisper-narration',
      positionId: 'beam-south-west', targetSec: 10,
      anticipationSec: tofSec(site, 'beam-south-west', 8, 1), durationSec: 12,
      params: { targetCellId: cellAt(grid, 8, 1).index } },
    { id: 'bf1', trackId: 'trk-beam', medium: 'beam', effectId: 'beam-flyover-whoosh',
      positionId: 'beam-south-east', targetSec: 12, anticipationSec: 0.03, durationSec: 6,
      params: { pathCellIds: [30, 31, 32, 33, 34, 35, 36].map((c) => cellAt(grid, 8, c).index) } },
  ])
}

describe('sim/crowd — determinism with crowd + beam cues', () => {
  it('chunked advance: one advanceTo(20) vs 7 uneven chunks → identical snapshot', () => {
    const one = new SimEngine(crowdBeamShow())
    one.advanceTo(20)

    const many = new SimEngine(crowdBeamShow())
    for (const t of [0.37, 2.9, 6.05, 9.41, 13.333, 17.2, 20]) many.advanceTo(t)

    expect(many.snapshot().step).toBe(one.snapshot().step)
    expect(many.snapshot().crowd.cellCount).toBe(grid.cells.length)
    expect(hashSnapshot(many.snapshot())).toBe(hashSnapshot(one.snapshot()))
  })

  it('seek back re-simulates deterministically (explicit reset and backward advanceTo)', () => {
    const fresh = new SimEngine(crowdBeamShow())
    fresh.advanceTo(11.5)
    const freshHash = hashSnapshot(fresh.snapshot())

    const reused = new SimEngine(crowdBeamShow())
    reused.advanceTo(30)
    reused.reset()
    reused.advanceTo(11.5)
    expect(hashSnapshot(reused.snapshot())).toBe(freshHash)

    const scrubbed = new SimEngine(crowdBeamShow())
    scrubbed.advanceTo(30)
    scrubbed.advanceTo(11.5) // backward → internal full re-sim from t0
    expect(hashSnapshot(scrubbed.snapshot())).toBe(freshHash)
  }, 60_000) // three 30 s × 120 Hz sims over 342 cells — slow under full-suite load
})

describe('sim/crowd — the latency ramp', () => {
  it('wristband flood: dark before fireSec, ~95% lit at targetSec, full by fireSec + maxMs', () => {
    // fireSec = 5 − 0.08 (p95); mast wristband CDF is {10, 35, 80, 120} ms.
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-flood-rgb', params: { rgb: [1, 1, 1] } }),
    ]))

    engine.advanceTo(4.9) // before fireSec = 4.92
    expect(sumRgb(engine.snapshot())).toBe(0)

    engine.advanceTo(5) // exactly targetSec: ramp ≈ p95 complete
    const atTarget = new Float32Array(engine.snapshot().crowd.rgb)

    engine.advanceTo(5.1) // fireSec + 180 ms > maxMs → every device lit
    const full = new Float32Array(engine.snapshot().crowd.rgb)

    engine.advanceTo(5.5)
    const later = new Float32Array(engine.snapshot().crowd.rgb)
    expect(later).toEqual(full) // flood is constant once the ramp completes

    // Per-cell litFraction at targetSec = value / fully-lit value ≈ 0.95.
    let ratioSum = 0
    let n = 0
    for (const cell of grid.cells) {
      const f = full[cell.index * 3]!
      if (f <= 0) continue
      ratioSum += atTarget[cell.index * 3]! / f
      n++
    }
    expect(n).toBe(grid.cells.length)
    const mean = ratioSum / n
    expect(mean).toBeGreaterThanOrEqual(0.9)
    expect(mean).toBeLessThanOrEqual(1.0)
  })

  it('phone starfield ramps over seconds and writes white, never rgb', () => {
    // fireSec = 6 − 1.2 (phone p95); densityFrac 1 lights every covered cell.
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-starfield-phone', positionId: 'mast-east',
        targetSec: 6, anticipationSec: 1.2, durationSec: 20, params: { densityFrac: 1 } }),
    ]))

    engine.advanceTo(4.9) // fireSec + 100 ms < phone minMs (120) → still dark
    expect(sumWhite(engine.snapshot())).toBe(0)
    expect(sumRgb(engine.snapshot())).toBe(0)

    engine.advanceTo(5.5)
    const early = sumWhite(engine.snapshot())
    engine.advanceTo(6)
    const atTarget = sumWhite(engine.snapshot())
    engine.advanceTo(7.5) // past fireSec + maxMs (2.5 s) → fully lit
    const full = sumWhite(engine.snapshot())

    expect(early).toBeGreaterThan(0)
    expect(atTarget).toBeGreaterThan(early)
    expect(full).toBeGreaterThan(atTarget)
    expect(sumRgb(engine.snapshot())).toBe(0) // phone channel never touches rgb
  })
})

describe('sim/crowd — pattern envelopes', () => {
  it('wave: the crest column moves east over beats', () => {
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-wave-lateral', targetSec: 4, durationSec: 10,
        params: { periodBeats: 8, rgb: [1, 1, 1] } }),
    ]))
    const argmaxCol = (s: SimSnapshot): number => {
      let best = -1
      let bestV = 0
      for (const cell of grid.cells) {
        const v = s.crowd.rgb[cell.index * 3]!
        if (v > bestV) { bestV = v; best = cell.col }
      }
      expect(bestV).toBeGreaterThan(0)
      return best
    }
    engine.advanceTo(5) // u = 2 beats / 8 = 0.25 of the traversal
    const colA = argmaxCol(engine.snapshot())
    engine.advanceTo(6) // u = 0.5
    const colB = argmaxCol(engine.snapshot())
    expect(colA).toBeGreaterThan(0)
    expect(colB).toBeGreaterThan(colA)
  })

  it('sectionChase: the lit band steps per beat', () => {
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-chase-sections', targetSec: 4, durationSec: 12,
        params: { sections: 4, rgb: [1, 1, 1] } }),
    ]))
    const litCols = (s: SimSnapshot): Set<number> => {
      const cols = new Set<number>()
      for (const cell of grid.cells) {
        if (s.crowd.rgb[cell.index * 3]! > 0) cols.add(cell.col)
      }
      return cols
    }
    engine.advanceTo(4.2) // 0 beats elapsed → band 0 (cols 0..9 of 38)
    const band0 = litCols(engine.snapshot())
    expect(band0.size).toBeGreaterThan(0)
    for (const c of band0) expect(c).toBeLessThanOrEqual(9)

    engine.advanceTo(4.7) // 1 beat elapsed → band 1 (cols 10..18)
    const band1 = litCols(engine.snapshot())
    expect(band1.size).toBeGreaterThan(0)
    for (const c of band1) {
      expect(c).toBeGreaterThanOrEqual(10)
      expect(c).toBeLessThanOrEqual(18)
    }
  })

  it('radialPulse: the ring expands away from the origin cell', () => {
    const origin = cellAt(grid, 4, 19) // grid center
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-pulse-radial', targetSec: 5, durationSec: 6,
        params: { originCell: origin.index, periodBeats: 2, rgb: [1, 1, 1] } }),
    ]))
    engine.advanceTo(5) // radius 0 → the origin itself is the ring
    expect(engine.snapshot().crowd.rgb[origin.index * 3]!).toBeGreaterThan(0.3)

    engine.advanceTo(6) // 2 beats / periodBeats 2 → radius 1 cell
    const s = engine.snapshot()
    expect(s.crowd.rgb[origin.index * 3]!).toBe(0)
    expect(s.crowd.rgb[cellAt(grid, 4, 20).index * 3]!).toBeGreaterThan(0.3)
  })

  it('text "OK" lights the expected glyph cells (5×7 font, centered)', () => {
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-text-marquee', targetSec: 4, durationSec: 16,
        params: { text: 'OK', rgb: [1, 1, 1] } }),
    ]))
    engine.advanceTo(5)
    const s = engine.snapshot()
    const r = (row: number, col: number): number => s.crowd.rgb[cellAt(grid, row, col).index * 3]!

    // Width 11 in 38 cols → static, c0 = 13; FONT_H 7 in 9 rows → rows 1..7,
    // glyph row 0 (top) on grid row 7 (north-up plan view).
    // 'O' top row '.XXX.' → cols 14..16 lit, 13 and 17 dark.
    expect(r(7, 13)).toBe(0)
    expect(r(7, 14)).toBeGreaterThan(0.3)
    expect(r(7, 15)).toBeGreaterThan(0.3)
    expect(r(7, 16)).toBeGreaterThan(0.3)
    expect(r(7, 17)).toBe(0)
    // 'O' middle row 'X...X' (glyph y 3 → grid row 4).
    expect(r(4, 13)).toBeGreaterThan(0.3)
    expect(r(4, 15)).toBe(0)
    expect(r(4, 17)).toBeGreaterThan(0.3)
    // 'K' top row 'X...X' at glyph x 6..10 → cols 19 and 23.
    expect(r(7, 19)).toBeGreaterThan(0.3)
    expect(r(7, 23)).toBeGreaterThan(0.3)
    expect(r(7, 20)).toBe(0)
    // Outside the vertical band (rows 0 and 8) stays dark.
    for (let col = 13; col <= 23; col++) {
      expect(r(0, col)).toBe(0)
      expect(r(8, col)).toBe(0)
    }
  })

  it('heartbeat: lub-dub envelope locked to the beat grid', () => {
    const cell = cellAt(grid, 4, 19)
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-heartbeat-red', targetSec: 4, durationSec: 8 }),
    ]))
    const v = (t: number): number => {
      engine.advanceTo(t)
      return engine.snapshot().crowd.rgb[cell.index * 3]!
    }
    const onBeat = v(10) // beat instant (120 bpm → beats on 0.5 s)
    const lubTail = v(10 + 16 / 120) // τ ≈ 0.133 s: lub decayed, dub not yet
    const dub = v(10.2) // τ = 0.2 s: dub peaks (0.18 s delay)
    const late = v(10.45) // τ = 0.45 s: both decayed
    expect(onBeat).toBeGreaterThan(0.3)
    expect(lubTail).toBeLessThan(onBeat)
    expect(dub).toBeGreaterThan(lubTail) // the second thump
    expect(late).toBeLessThan(0.2 * onBeat)
  })

  it('hapticPulse produces no visual output', () => {
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-haptic-thump', targetSec: 5, durationSec: 4 }),
    ]))
    engine.advanceTo(6)
    const s = engine.snapshot()
    expect(s.crowd.cellCount).toBe(grid.cells.length) // arrays are sized …
    expect(sumRgb(s)).toBe(0) // … but stay dark
    expect(sumWhite(s)).toBe(0)
    expect(engine.stats().peakCrowdCellsLit).toBe(0)
  })
})

describe('site/crowdGrid — crowdMastFor (single owner of mast resolution)', () => {
  it('named mast, else first spec-bearing mast; undefined only without any mast', () => {
    const site = lakesidePark()
    expect(crowdMastFor(site, 'mast-east')!.id).toBe('mast-east')
    expect(crowdMastFor(site, 'mast-west')!.id).toBe('mast-west')
    // No positionId / a non-mast asset id → the site's first spec-bearing mast.
    expect(crowdMastFor(site, undefined)!.id).toBe('mast-west')
    expect(crowdMastFor(site, 'rack-1')!.id).toBe('mast-west')
    // A kind:'crowdMast' asset WITHOUT a crowdMast spec is never resolved.
    const bare: SitePlan = {
      ...lakesidePark(),
      assets: [
        ...lakesidePark().assets,
        { id: 'mast-bare', kind: 'crowdMast', pos: { x: 0, y: -185 }, headingDeg: 180, elevationM: 8 },
      ],
    }
    expect(crowdMastFor(bare, 'mast-bare')!.id).toBe('mast-west')
    const none: SitePlan = {
      ...site,
      assets: site.assets.filter((a) => a.kind !== 'crowdMast'),
    }
    expect(crowdMastFor(none, 'mast-west')).toBeUndefined()
  })
})

describe('sim/crowd — rgb2 and bitmap cue params', () => {
  it('rgb + rgb2 make a two-color palette alternating per cell index', () => {
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-flood-rgb',
        params: { rgb: [1, 0, 0], rgb2: [0, 0, 1] } }),
    ]))
    engine.advanceTo(6) // flood fully ramped
    const s = engine.snapshot()
    const covered = coveredCellIndices(lakesidePark(), grid)
    let reds = 0
    let blues = 0
    for (const cell of grid.cells) {
      if (!covered.has(cell.index)) continue
      const b3 = cell.index * 3
      const r = s.crowd.rgb[b3]!
      const b = s.crowd.rgb[b3 + 2]!
      expect(s.crowd.rgb[b3 + 1]).toBe(0) // green never written
      if (cell.index % 2 === 0) {
        expect(r).toBeGreaterThan(0) // even cells: params.rgb (red)
        expect(b).toBe(0)
        reds++
      } else {
        expect(b).toBeGreaterThan(0) // odd cells: params.rgb2 (blue)
        expect(r).toBe(0)
        blues++
      }
    }
    expect(reds).toBeGreaterThan(0)
    expect(blues).toBeGreaterThan(0)
  })

  it('rgb2 also parses the hex-string form', () => {
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-flood-rgb',
        params: { rgb: '#ff0000', rgb2: '#0000ff' } }),
    ]))
    engine.advanceTo(6)
    const s = engine.snapshot()
    const even = grid.cells.find((c) => c.index % 2 === 0)!
    const odd = grid.cells.find((c) => c.index % 2 === 1)!
    expect(s.crowd.rgb[even.index * 3]!).toBeGreaterThan(0)
    expect(s.crowd.rgb[even.index * 3 + 2]!).toBe(0)
    expect(s.crowd.rgb[odd.index * 3 + 2]!).toBeGreaterThan(0)
    expect(s.crowd.rgb[odd.index * 3]!).toBe(0)
  })

  it('flood with params.bitmap lights only the rasterized cells (centered, row 0 = north)', () => {
    // 3×5 raster centered on the 38×9 lawn grid: c0 = 16, r0 = 3; bitmap
    // row 0 is the TOP → grid row 5; non-'.' characters light the cell.
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-flood-rgb',
        params: { rgb: [1, 1, 1], bitmap: ['XXXXX', '..X..', 'X...X'] } }),
    ]))
    engine.advanceTo(6)
    const s = engine.snapshot()
    const r = (row: number, col: number): number =>
      s.crowd.rgb[cellAt(grid, row, col).index * 3]!

    for (let col = 16; col <= 20; col++) expect(r(5, col)).toBeGreaterThan(0) // 'XXXXX'
    expect(r(4, 18)).toBeGreaterThan(0) // '..X..'
    expect(r(4, 16)).toBe(0)
    expect(r(4, 17)).toBe(0)
    expect(r(4, 19)).toBe(0)
    expect(r(4, 20)).toBe(0)
    expect(r(3, 16)).toBeGreaterThan(0) // 'X...X'
    expect(r(3, 17)).toBe(0)
    expect(r(3, 18)).toBe(0)
    expect(r(3, 19)).toBe(0)
    expect(r(3, 20)).toBeGreaterThan(0)
    // Outside the raster stays dark — the whole-zone flood is overridden.
    expect(r(6, 18)).toBe(0)
    expect(r(2, 18)).toBe(0)
    expect(r(5, 15)).toBe(0)
    expect(r(5, 21)).toBe(0)
  })

  it('text with params.bitmap overrides the glyph raster', () => {
    const engine = new SimEngine(makeCompiled([
      crowdCue({ id: 'c1', effectId: 'crowd-text-marquee', targetSec: 4, durationSec: 16,
        params: { text: 'OK', rgb: [1, 1, 1], bitmap: ['X'] } }),
    ]))
    engine.advanceTo(5)
    const s = engine.snapshot()
    // Single lit cell at the grid center: c0 = floor((38−1)/2) = 18,
    // r0 = floor((9−1)/2) = 4.
    let lit = 0
    for (const cell of grid.cells) {
      if (s.crowd.rgb[cell.index * 3]! > 0) lit++
    }
    expect(lit).toBe(1)
    expect(s.crowd.rgb[cellAt(grid, 4, 18).index * 3]!).toBeGreaterThan(0)
    // The 'OK' glyph cells (see the text pattern test above) stay dark.
    expect(s.crowd.rgb[cellAt(grid, 7, 14).index * 3]!).toBe(0)
  })
})

describe('sim/crowd — coverage', () => {
  it('cells beyond every mast radius stay dark', () => {
    const base = lakesidePark()
    const site: SitePlan = {
      ...base,
      assets: base.assets.map((a) =>
        a.kind === 'crowdMast' && a.crowdMast
          ? { ...a, crowdMast: { ...a.crowdMast, coverageRadiusM: 60 } }
          : a,
      ),
    }
    const g = crowdGridFor(site)!
    const covered = coveredCellIndices(site, g)
    expect(covered.size).toBeGreaterThan(0)
    expect(covered.size).toBeLessThan(g.cells.length)

    const engine = new SimEngine(makeCompiled(
      [crowdCue({ id: 'c1', effectId: 'crowd-flood-rgb', params: { rgb: [1, 1, 1] } })],
      { site },
    ))
    engine.advanceTo(6) // flood fully ramped
    const s = engine.snapshot()
    let litCovered = 0
    for (const cell of g.cells) {
      const b3 = cell.index * 3
      if (covered.has(cell.index)) {
        if (s.crowd.rgb[b3]! > 0.3) litCovered++
      } else {
        expect(s.crowd.rgb[b3]).toBe(0)
        expect(s.crowd.rgb[b3 + 1]).toBe(0)
        expect(s.crowd.rgb[b3 + 2]).toBe(0)
        expect(s.crowd.white[cell.index]).toBe(0)
      }
    }
    expect(litCovered).toBeGreaterThan(0)
  })

  it('a show without crowd cues keeps crowd arrays empty (cellCount 0)', () => {
    const engine = new SimEngine(makeCompiled([
      { id: 'p1', trackId: 'trk-pyro', medium: 'pyro', effectId: 'peony-75-red',
        positionId: 'rack-1', targetSec: 4, anticipationSec: 2.2, durationSec: 1.8 },
    ]))
    engine.advanceTo(5)
    expect(engine.snapshot().crowd.cellCount).toBe(0)
    expect(engine.snapshot().crowd.rgb.length).toBe(0)
  })
})
