/**
 * Floor-band mapping tests: the crowd/beam audience layers' pure geometry
 * (render/crowdBand.ts) plus the seat-preset resolver (ui/seat.ts), driven
 * on the real lakeside-park crowd grid — no GL, no DOM.
 */
import { crowdGridFor, lakesidePark } from '@theodoor/core'
import type { BeamFootprint } from '@theodoor/core'
import { describe, expect, it } from 'vitest'
import { makeCamera } from '../src/render/camera.js'
import {
  BAND_FAR_OFFSET_PX,
  BAND_NEAR_OFFSET_PX,
  BEAM_FLIGHT_ALPHA,
  BEAM_LANDING_PULSE_SEC,
  bandFrac,
  bandScreenY,
  beamConeAlpha,
  crowdCellClipPositions,
  footprintPoints,
  footprintXExtentM,
  landingPulse,
  screenYToClipY,
} from '../src/render/crowdBand.js'
import { SEAT_PRESETS, seatCellPos } from '../src/ui/seat.js'

const grid = crowdGridFor(lakesidePark())!
// 640/320 = 2, 510/255 = 2 → pxPerMeter = 0.95 * 2 = 1.9 exactly.
const camera = makeCamera(640, 510)
const groundY = camera.worldToScreen(0, 0).y

describe('lakeside crowd grid (fixture sanity)', () => {
  it('is the documented 38×9 = 342-cell grid', () => {
    expect(grid.cols).toBe(38)
    expect(grid.rows).toBe(9)
    expect(grid.cells.length).toBe(342)
  })
})

describe('bandFrac / bandScreenY', () => {
  it('is 0 at the back row centroid and 1 at the front row centroid', () => {
    expect(bandFrac(grid, -256)).toBeCloseTo(0, 9) // row 0 (back)
    expect(bandFrac(grid, -192)).toBeCloseTo(1, 9) // row 8 (front)
    expect(bandFrac(grid, -224)).toBeCloseTo(0.5, 9) // row 4 (middle)
  })

  it('clamps outside the row span', () => {
    expect(bandFrac(grid, -400)).toBe(0)
    expect(bandFrac(grid, 0)).toBe(1)
  })

  it('maps the FRONT row (8) LOWER on screen than the back row (0)', () => {
    const front = bandScreenY(grid, -192, groundY)
    const back = bandScreenY(grid, -256, groundY)
    expect(front).toBeGreaterThan(back) // screen y grows downward
    expect(front).toBeCloseTo(groundY - BAND_NEAR_OFFSET_PX, 9)
    expect(back).toBeCloseTo(groundY - BAND_FAR_OFFSET_PX, 9)
  })

  it('keeps the whole band above the ground line', () => {
    for (const cell of grid.cells) {
      const y = bandScreenY(grid, cell.centroid.y, groundY)
      expect(y).toBeLessThan(groundY)
      expect(y).toBeGreaterThanOrEqual(groundY - BAND_FAR_OFFSET_PX)
    }
  })
})

describe('crowdCellClipPositions', () => {
  const pos = crowdCellClipPositions(grid, camera)

  it('packs 2 floats per cell', () => {
    expect(pos.length).toBe(grid.cells.length * 2)
  })

  it('clip x follows centroid.x through the camera projection', () => {
    for (const i of [0, 100, 341]) {
      const cell = grid.cells[i]!
      expect(pos[2 * i]).toBeCloseTo(camera.project(cell.centroid.x, 0).x, 6) // Float32
    }
    // Within one row, x ordering follows centroid.x (columns scan west→east).
    const row0 = grid.cells.filter((c) => c.row === 0)
    for (let i = 1; i < row0.length; i++) {
      const a = row0[i - 1]!
      const b = row0[i]!
      expect(a.centroid.x).toBeLessThan(b.centroid.x)
      expect(pos[2 * a.index]!).toBeLessThan(pos[2 * b.index]!)
    }
  })

  it('front-row cells sit lower (smaller clip y) than back-row cells', () => {
    const front = grid.cells.find((c) => c.row === 8)!
    const back = grid.cells.find((c) => c.row === 0)!
    // Clip y is up-positive: lower on screen = smaller clip y.
    expect(pos[2 * front.index + 1]!).toBeLessThan(pos[2 * back.index + 1]!)
  })

  it('screenYToClipY round-trips the camera convention', () => {
    // Screen center → clip 0; top → +1; bottom → −1.
    expect(screenYToClipY(255, 510)).toBeCloseTo(0, 9)
    expect(screenYToClipY(0, 510)).toBeCloseTo(1, 9)
    expect(screenYToClipY(510, 510)).toBeCloseTo(-1, 9)
  })
})

describe('footprint helpers', () => {
  const fp: BeamFootprint = { cx: 0, cy: -220, a: 10, b: 5, azimuthDeg: 0 }

  it('samples the ellipse boundary in the (along, cross) frame', () => {
    const pts = footprintPoints(fp, 4)
    expect(pts.length).toBe(4)
    // t = 0: +a along azimuth 0 (north).
    expect(pts[0]!.x).toBeCloseTo(0, 9)
    expect(pts[0]!.y).toBeCloseTo(-210, 9)
    // t = π/2: +b across (east of the aim line).
    expect(pts[1]!.x).toBeCloseTo(5, 9)
    expect(pts[1]!.y).toBeCloseTo(-220, 9)
    // t = π: −a along.
    expect(pts[2]!.x).toBeCloseTo(0, 9)
    expect(pts[2]!.y).toBeCloseTo(-230, 9)
  })

  it('collapses degenerate ellipses onto the center', () => {
    const degenerate: BeamFootprint = { cx: 3, cy: -200, a: 0, b: 0, azimuthDeg: 45 }
    for (const p of footprintPoints(degenerate, 8)) {
      expect(p.x).toBeCloseTo(3, 9)
      expect(p.y).toBeCloseTo(-200, 9)
    }
  })

  it('x-extent rotates with the azimuth', () => {
    expect(footprintXExtentM(fp)).toBeCloseTo(5, 9) // aim north → cross axis spans x
    expect(footprintXExtentM({ ...fp, azimuthDeg: 90 })).toBeCloseTo(10, 9) // aim east
    expect(footprintXExtentM({ ...fp, azimuthDeg: 45 })).toBeCloseTo(
      Math.hypot(10 * Math.SQRT1_2, 5 * Math.SQRT1_2),
      9,
    )
  })
})

describe('flight/landing visuals', () => {
  it('dims in-flight cones to BEAM_FLIGHT_ALPHA and snaps to 1 on landing', () => {
    expect(beamConeAlpha(false)).toBe(BEAM_FLIGHT_ALPHA)
    expect(BEAM_FLIGHT_ALPHA).toBeCloseTo(0.4, 9)
    expect(beamConeAlpha(true)).toBe(1)
  })

  it('pulses 1 → 0 over BEAM_LANDING_PULSE_SEC', () => {
    expect(landingPulse(0)).toBe(1)
    expect(landingPulse(BEAM_LANDING_PULSE_SEC / 2)).toBeCloseTo(0.5, 9)
    expect(landingPulse(BEAM_LANDING_PULSE_SEC * 2)).toBe(0)
    expect(landingPulse(Number.NaN)).toBe(0) // not landed yet
    expect(landingPulse(-1)).toBe(0)
    expect(landingPulse(Number.POSITIVE_INFINITY)).toBe(0) // seek into landed
  })
})

describe('seatCellPos', () => {
  it('resolves every preset to its exact cell centroid on the full grid', () => {
    for (const preset of SEAT_PRESETS) {
      const p = seatCellPos(grid, preset)!
      expect(p.x).toBeCloseTo(-150 + (preset.col + 0.5) * 8, 9)
      expect(p.y).toBeCloseTo(-260 + (preset.row + 0.5) * 8, 9)
    }
  })

  it('falls back to the nearest kept cell, and undefined without a grid', () => {
    const sparse = { cells: grid.cells.filter((c) => c.row === 0) }
    const p = seatCellPos(sparse, { row: 8, col: 19 })!
    expect(p.y).toBeCloseTo(-256, 9) // nearest surviving row
    expect(seatCellPos(undefined, { row: 8, col: 19 })).toBeUndefined()
    expect(seatCellPos({ cells: [] }, { row: 8, col: 19 })).toBeUndefined()
  })
})
