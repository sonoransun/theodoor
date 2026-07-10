/**
 * site/crowdGrid.ts — the derived audience cell grid (the "crowd canvas").
 *
 * Single owner of the SitePlan → cell derivation, shared by site validation,
 * the crowd sim, broadcast-mask exporters, the beam exposure report, and the
 * viz crowd layer. Cells are never stored on the SitePlan: they are a pure,
 * deterministic function of (audienceZone, exclusionZones, crowdGrid spec),
 * so editing the site can never leave a stale grid behind.
 *
 * Derivation: axis-aligned grid of cellSizeM over the audienceZone bbox,
 * scanned row-major (row ascending, then col); a cell is kept iff its
 * centroid is inside the audienceZone and outside every exclusion zone.
 * Kept cells get a compact `index` in scan order (the bit position in
 * broadcast masks). Per-cell occupancy is seeded on (row, col) — NOT the
 * compact index — so editing an exclusion zone never reshuffles unrelated
 * cells.
 */

import type { CrowdGridSpec, PositionedAsset, SitePlan, Vec2 } from '../contracts.js'
import { dist2, forkSeed, mulberry32, pointInPolygon } from '../math/index.js'

/** Default cell edge (≈ 330 cells on the lakeside-park lawn). */
export const CROWD_CELL_SIZE_M = 8
/** Relaxed lawn-concert average (0.5 seated picnic … 2 packed standing). */
export const CROWD_DENSITY_PPM2 = 1.0
/** Wristbands handed out at the gate; small loss to pockets/dead cells. */
export const CROWD_WRISTBAND_PARTICIPATION = 0.85
/** Phone opt-in (web push + screen on at the right moment) — pessimistic. */
export const CROWD_PHONE_PARTICIPATION = 0.35

export interface CrowdCell {
  /** Compact scan-order index (bit position in broadcast masks). */
  index: number
  row: number
  col: number
  centroid: Vec2
  areaM2: number
  /** People in the cell (seeded around areaM2 × densityPPM2). */
  occupancy: number
  /** Responding wristbands in the cell. */
  wristbands: number
  /** Responding phones in the cell. */
  phones: number
}

export interface CrowdGrid {
  cellSizeM: number
  /** Bbox grid dimensions (kept cells may be a subset). */
  rows: number
  cols: number
  /** Kept cells, ascending index. */
  cells: readonly CrowdCell[]
}

/**
 * Derive the crowd grid for a site. Undefined when the site declares no
 * crowdGrid spec or the audienceZone cannot host one (degenerate polygon
 * or non-positive cell size) — validation reports those as 'crowd-structure'.
 */
export function crowdGridFor(site: SitePlan): CrowdGrid | undefined {
  const spec = site.crowdGrid
  if (!spec) return undefined
  if (!(spec.cellSizeM > 0) || site.audienceZone.length < 3) return undefined

  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const p of site.audienceZone) {
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  const s = spec.cellSizeM
  const cols = Math.ceil((xMax - xMin) / s)
  const rows = Math.ceil((yMax - yMin) / s)
  if (cols <= 0 || rows <= 0) return undefined

  const cells: CrowdCell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const centroid = { x: xMin + (c + 0.5) * s, y: yMin + (r + 0.5) * s }
      if (!pointInPolygon(centroid, site.audienceZone)) continue
      if (site.exclusionZones.some((z) => pointInPolygon(centroid, z.poly))) continue
      const rng = mulberry32(forkSeed(spec.seed, `cell:${r}:${c}`))
      const areaM2 = s * s
      const occupancy = Math.round(areaM2 * spec.densityPPM2 * (0.6 + 0.8 * rng()))
      const wristbands = Math.round(occupancy * CROWD_WRISTBAND_PARTICIPATION * (0.9 + 0.2 * rng()))
      const phones = Math.round(occupancy * CROWD_PHONE_PARTICIPATION * (0.8 + 0.4 * rng()))
      cells.push({ index: cells.length, row: r, col: c, centroid, areaM2, occupancy, wristbands, phones })
    }
  }
  if (cells.length === 0) return undefined
  return { cellSizeM: s, rows, cols, cells }
}

/**
 * The crowd mast a cue's broadcast rides — the SINGLE owner of mast
 * resolution, shared by the solver (crowdLatencyFor), the crowd sim
 * (buildCrowdCues) and the broadcast exporters, so every consumer anticipates
 * / ramps / groups against the same LatencySpec.
 *
 * Rule: among spec-bearing crowdMast assets (kind 'crowdMast' AND a crowdMast
 * spec), the one named by `positionId`, else the site's first; undefined when
 * the site has no spec-bearing mast at all.
 */
export function crowdMastFor(
  site: SitePlan,
  positionId: string | undefined,
): PositionedAsset | undefined {
  const masts = site.assets.filter((a) => a.kind === 'crowdMast' && a.crowdMast !== undefined)
  return masts.find((a) => a.id === positionId) ?? masts[0]
}

/**
 * Indices of grid cells inside at least one crowd mast's coverage radius.
 * Broadcast-mask builders and the crowd sim both use this, so a cell outside
 * coverage is consistently dark everywhere (site validation warns about it).
 */
export function coveredCellIndices(site: SitePlan, grid: CrowdGrid): ReadonlySet<number> {
  const masts = site.assets.filter((a) => a.kind === 'crowdMast' && a.crowdMast)
  const covered = new Set<number>()
  for (const cell of grid.cells) {
    for (const m of masts) {
      if (dist2(cell.centroid, m.pos) <= m.crowdMast!.coverageRadiusM) {
        covered.add(cell.index)
        break
      }
    }
  }
  return covered
}
