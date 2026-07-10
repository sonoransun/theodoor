import { describe, expect, it } from 'vitest'
import type { SitePlan } from '../src/contracts.js'
import { pointInPolygon, v2 } from '../src/math/index.js'
import { coveredCellIndices, crowdGridFor } from '../src/site/crowdGrid.js'
import { lakesidePark } from '../src/site/presets.js'

describe('crowdGridFor(lakesidePark)', () => {
  it('is deterministic across calls', () => {
    const a = crowdGridFor(lakesidePark())
    const b = crowdGridFor(lakesidePark())
    expect(a).toBeDefined()
    expect(b).toEqual(a)
  })

  it('sizes the grid to the 300×70 m bbox and keeps only in-zone centroids', () => {
    const site = lakesidePark()
    const grid = crowdGridFor(site)
    expect(grid).toBeDefined()
    expect(grid!.cellSizeM).toBe(8)
    expect(grid!.cols).toBe(Math.ceil(300 / 8)) // 38
    expect(grid!.rows).toBe(Math.ceil(70 / 8)) // 9
    expect(grid!.cells.length).toBeGreaterThanOrEqual(250)
    expect(grid!.cells.length).toBeLessThanOrEqual(400)
    for (const cell of grid!.cells) {
      expect(pointInPolygon(cell.centroid, site.audienceZone)).toBe(true)
    }
    // Compact scan-order indices (the bit positions in broadcast masks).
    grid!.cells.forEach((cell, i) => expect(cell.index).toBe(i))
  })

  it('an exclusion zone removes exactly the cells whose centroids fall inside it', () => {
    const base = lakesidePark()
    const baseGrid = crowdGridFor(base)!
    // Poly edges chosen off the centroid lattice (x ∈ …-18,-10…; y ∈ …-224,-216…).
    const poly = [v2(-20, -230), v2(20, -230), v2(20, -210), v2(-20, -210)]
    const site: SitePlan = { ...base, exclusionZones: [{ id: 'mixer-tent', poly }] }
    const grid = crowdGridFor(site)!

    const removed = baseGrid.cells.filter((c) => pointInPolygon(c.centroid, poly))
    expect(removed.length).toBeGreaterThan(0)
    expect(grid.cells.length).toBe(baseGrid.cells.length - removed.length)

    const byRowCol = new Map(grid.cells.map((c) => [`${c.row}:${c.col}`, c]))
    for (const cell of baseGrid.cells) {
      const kept = byRowCol.get(`${cell.row}:${cell.col}`)
      if (pointInPolygon(cell.centroid, poly)) {
        expect(kept).toBeUndefined()
      } else {
        // Identical apart from the compact index: occupancy seeds on (row, col),
        // so editing an exclusion zone never reshuffles unrelated cells.
        expect(kept).toBeDefined()
        expect(kept!.centroid).toEqual(cell.centroid)
        expect(kept!.areaM2).toBe(cell.areaM2)
        expect(kept!.occupancy).toBe(cell.occupancy)
        expect(kept!.wristbands).toBe(cell.wristbands)
        expect(kept!.phones).toBe(cell.phones)
      }
    }
  })

  it('returns undefined without a spec, with a non-positive cell size, or with zero kept cells', () => {
    const base = lakesidePark()
    expect(crowdGridFor({ ...base, crowdGrid: undefined })).toBeUndefined()
    expect(crowdGridFor({ ...base, crowdGrid: { ...base.crowdGrid!, cellSizeM: 0 } })).toBeUndefined()
    const closed = { id: 'closed-lawn', poly: base.audienceZone }
    expect(crowdGridFor({ ...base, exclusionZones: [closed] })).toBeUndefined()
  })

  it('the two lakeside masts cover every derived cell', () => {
    const site = lakesidePark()
    const grid = crowdGridFor(site)!
    const covered = coveredCellIndices(site, grid)
    expect(covered.size).toBe(grid.cells.length)
    for (const cell of grid.cells) expect(covered.has(cell.index)).toBe(true)
  })
})
