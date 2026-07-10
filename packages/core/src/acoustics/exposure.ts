/**
 * acoustics/exposure — carrier-exposure report over a compiled show's beam
 * cues, the beam counterpart of quiet.ts.
 *
 * The directional arrays ride an inaudible carrier whose level at audience
 * positions is capped independently of the audible program: a conservative
 * public-guidance-style ceiling applied as a hard instant per-cell rule (the
 * same one-number spirit as the quiet budget), plus a rolling dwell rule so
 * no cell sits near the ceiling for long. Levels are evaluated at crowd-grid
 * cell centroids — the grid is derived even when the site declares no
 * crowdGrid spec, because exposure must not depend on whether the show also
 * uses wristbands.
 */

import type {
  BeamEffect,
  BeamFootprint,
  CompiledCue,
  CompiledShow,
  Diagnostic,
  ExposureBudget,
  Seconds,
  Vec2,
} from '../contracts.js'
import { SPL_REF_DISTANCE_M } from '../contracts.js'
import { dist2 } from '../math/index.js'
import { CROWD_CELL_SIZE_M, CROWD_DENSITY_PPM2, crowdGridFor } from '../site/crowdGrid.js'
import {
  BEAM_LEAKAGE_DB,
  EAR_HEIGHT_M,
  beamFootprintAt,
  beamSourceAsset,
  beamTargetAt,
  inFootprint,
  sourceGroundResolver,
  type BeamTargetOpts,
} from './beams.js'
import type { EffectLookup } from './spl.js'
import { splAtDistance, sumSpl } from './spl.js'

/**
 * Default budget, enforced whenever a show has beam cues (a show may override
 * via `Show.exposureBudget`, never disable). Conservative airborne-ultrasound
 * public-guidance-style numbers.
 */
export const DEFAULT_EXPOSURE_BUDGET: ExposureBudget = {
  maxCarrierDb: 110,
  dwellDb: 100,
  dwellWindowSec: 60,
  dwellMaxSec: 30,
}

/** Default sampling step for the exposure sweep, seconds. */
export const EXPOSURE_DT_SEC = 0.1

/** Per-cell exposure stats over the whole show. */
export interface ExposureCellStats {
  cellIndex: number
  /** Loudest summed carrier level seen at the cell, dB. */
  peakCarrierDb: number
  /** Max seconds at/above dwellDb inside any dwellWindowSec window. */
  dwellSec: Seconds
}

export interface ExposureReport {
  budget: ExposureBudget
  /** True iff no cell breaks either the ceiling or the dwell rule. */
  pass: boolean
  /** Peak summed carrier over all cells (-Infinity with no beam cues). */
  peakDb: number
  peakTSec: Seconds
  /** Cell index of the peak; -1 with no beam cues. */
  worstCellIndex: number
  cells: readonly ExposureCellStats[]
  /** EXPOSURE_BUDGET (ceiling) / EXPOSURE_DWELL diagnostics, severity error. */
  violations: readonly Diagnostic[]
}

/** One coalesced run of qualifying samples at a cell, `[tStart, tEnd)`. */
interface Run {
  tStart: Seconds
  tEnd: Seconds
  peakDb: number
  peakT: Seconds
  cueIds: string[]
}

function extendRun(
  open: Run | undefined,
  runs: Run[],
  t: Seconds,
  coverSec: Seconds,
  db: number,
  cueIds: readonly string[],
): Run {
  let run = open
  if (!run || t > run.tEnd + 1e-9) {
    run = { tStart: t, tEnd: t + coverSec, peakDb: db, peakT: t, cueIds: [] }
    runs.push(run)
  }
  run.tEnd = t + coverSec
  if (db > run.peakDb) {
    run.peakDb = db
    run.peakT = t
  }
  for (const id of cueIds) {
    if (!run.cueIds.includes(id)) run.cueIds.push(id)
  }
  return run
}

/**
 * Max total run time inside any `windowSec` window (and that window's start).
 * The optimum is attained with the window's left edge on a run start or its
 * right edge on a run end, so only those candidates are scanned.
 */
function maxWindowOccupancy(
  runs: readonly Run[],
  windowSec: Seconds,
): { occSec: Seconds; windowStart: Seconds } {
  let occSec = 0
  let windowStart = runs.length > 0 ? runs[0]!.tStart : 0
  const candidates: number[] = []
  for (const r of runs) {
    candidates.push(r.tStart)
    candidates.push(r.tEnd - windowSec)
  }
  for (const w of candidates) {
    let occ = 0
    for (const r of runs) {
      occ += Math.max(0, Math.min(r.tEnd, w + windowSec) - Math.max(r.tStart, w))
    }
    if (occ > occSec) {
      occSec = occ
      windowStart = w
    }
  }
  return { occSec, windowStart }
}

/**
 * Evaluate the show's beam cues against a carrier-exposure budget.
 *
 * Sweeps the dt grid over the union of beam noise windows PLUS every window
 * start/end breakpoint (mirroring splTimeline), so a sub-dtSec window can
 * never hide between two grid samples; each sample's dwell coverage is the
 * gap to the next sample, so occupancy stays exact on the mixed grid. Beam
 * aims resolve on the show's beat grid and through the per-cue sourceTag
 * ground resolver — the SAME clock and track the sim and the steering
 * exporter use. At every crowd cell centroid the summed carrier is each
 * active cue's `maxCarrierDbAtFocus` propagated over the head-to-cell slant,
 * minus BEAM_LEAKAGE_DB outside that cue's footprint. Rule 1 (ceiling): any
 * sample above `maxCarrierDb` violates. Rule 2 (dwell): more than
 * `dwellMaxSec` at/above `dwellDb` inside any `dwellWindowSec` window at one
 * cell violates. Cells come from the site's crowd grid, a default-spec grid
 * over the audienceZone when none is declared, or `refListenerPos` as a last
 * resort.
 */
export function exposureReport(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  budget: ExposureBudget = DEFAULT_EXPOSURE_BUDGET,
  dtSec: Seconds = EXPOSURE_DT_SEC,
): ExposureReport {
  const site = compiled.show.site

  interface BeamSource {
    cue: CompiledCue
    effect: BeamEffect
    start: Seconds
    end: Seconds
  }
  const beams: BeamSource[] = []
  for (const cue of compiled.cues) {
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'beam') continue
    const start = cue.targetSec
    const end = cue.targetSec + effect.durationSec
    if (!(end > start)) continue
    beams.push({ cue, effect, start, end })
  }
  if (beams.length === 0) {
    return {
      budget,
      pass: true,
      peakDb: -Infinity,
      peakTSec: 0,
      worstCellIndex: -1,
      cells: [],
      violations: [],
    }
  }

  // Evaluation points: the site's crowd grid, or a default-spec grid derived
  // over the audienceZone (the occupancy seed is irrelevant — only centroids
  // are used), or refListenerPos when the zone is degenerate.
  const grid =
    crowdGridFor(site) ??
    crowdGridFor({
      ...site,
      crowdGrid: { cellSizeM: CROWD_CELL_SIZE_M, densityPPM2: CROWD_DENSITY_PPM2, seed: 0 },
    })
  const points: readonly { cellIndex: number; p: Vec2 }[] = grid
    ? grid.cells.map((c) => ({ cellIndex: c.index, p: c.centroid }))
    : site.refListenerPos.map((p, i) => ({ cellIndex: i, p }))
  const nPts = points.length

  // Per (cue, cell) the in-footprint carrier level is constant — only the
  // footprint membership varies with time.
  const assets = beams.map((b) => beamSourceAsset(b.cue, site))
  const levelIn: Float64Array[] = beams.map((b, bi) => {
    const arr = new Float64Array(nPts)
    const asset = assets[bi]!
    const h = asset.elevationM - EAR_HEIGHT_M
    for (let pi = 0; pi < nPts; pi++) {
      const slantM = Math.hypot(dist2(asset.pos, points[pi]!.p), h)
      arr[pi] = splAtDistance(b.effect.maxCarrierDbAtFocus, SPL_REF_DISTANCE_M, slantM)
    }
    return arr
  })

  let tMin = Infinity
  let tMax = -Infinity
  for (const b of beams) {
    tMin = Math.min(tMin, b.start)
    tMax = Math.max(tMax, b.end)
  }
  const steps = Math.max(0, Math.ceil((tMax - tMin) / dtSec - 1e-9))

  // Sample times: the uniform tMin-anchored dt grid PLUS every beam window
  // start and end (windows are half-open, so the start sample itself sits
  // inside even a sub-dtSec window), sorted with exact-duplicate collapse —
  // the same breakpoint discipline splTimeline uses so slivers cannot hide.
  const rawTimes: number[] = []
  for (let i = 0; i <= steps; i++) rawTimes.push(tMin + i * dtSec)
  for (const b of beams) {
    rawTimes.push(b.start)
    rawTimes.push(b.end)
  }
  rawTimes.sort((a, b) => a - b)
  const times: number[] = []
  for (const t of rawTimes) {
    if (times.length === 0 || t !== times[times.length - 1]) times.push(t)
  }

  const beats = compiled.show.music.beats
  const resolveSourceGround = sourceGroundResolver(compiled, getEffect)

  const peakDbAt = new Float64Array(nPts).fill(-Infinity)
  const peakTAt = new Float64Array(nPts)
  const dwellRuns: Run[][] = points.map(() => [])
  const ceilRuns: Run[][] = points.map(() => [])
  const openDwell: (Run | undefined)[] = points.map(() => undefined)
  const openCeil: (Run | undefined)[] = points.map(() => undefined)

  for (let si = 0; si < times.length; si++) {
    const t = times[si]!
    // Dwell coverage of this sample: up to the next sample time (breakpoints
    // shorten the covering grid sample, keeping occupancy exact); the final
    // sample sits at/after every window end, so its coverage never matters.
    const coverSec = si + 1 < times.length ? times[si + 1]! - t : dtSec
    const activeIdx: number[] = []
    const activeFp: (BeamFootprint | undefined)[] = []
    const activeIds: string[] = []
    for (let bi = 0; bi < beams.length; bi++) {
      const b = beams[bi]!
      if (t >= b.start && t < b.end) {
        const sourceGround =
          b.effect.program === 'sourceTag' ? resolveSourceGround(b.cue, t) : undefined
        const aimOpts: BeamTargetOpts = {
          beats,
          ...(sourceGround ? { sourceGround } : {}),
        }
        activeIdx.push(bi)
        activeFp.push(
          beamFootprintAt(assets[bi]!, b.effect, beamTargetAt(b.cue, b.effect, site, t, aimOpts)),
        )
        activeIds.push(b.cue.id)
      }
    }
    if (activeIdx.length === 0) {
      openDwell.fill(undefined)
      openCeil.fill(undefined)
      continue
    }
    for (let pi = 0; pi < nPts; pi++) {
      const levels: number[] = []
      for (let ai = 0; ai < activeIdx.length; ai++) {
        const fp = activeFp[ai]
        const base = levelIn[activeIdx[ai]!]![pi]!
        levels.push(fp !== undefined && inFootprint(fp, points[pi]!.p) ? base : base - BEAM_LEAKAGE_DB)
      }
      const db = sumSpl(levels)
      if (db > peakDbAt[pi]!) {
        peakDbAt[pi] = db
        peakTAt[pi] = t
      }
      openDwell[pi] =
        db >= budget.dwellDb
          ? extendRun(openDwell[pi], dwellRuns[pi]!, t, coverSec, db, activeIds)
          : undefined
      openCeil[pi] =
        db > budget.maxCarrierDb
          ? extendRun(openCeil[pi], ceilRuns[pi]!, t, coverSec, db, activeIds)
          : undefined
    }
  }

  const cells: ExposureCellStats[] = []
  const violations: Diagnostic[] = []
  let peakDb = -Infinity
  let peakTSec: Seconds = 0
  let worstCellIndex = -1

  for (let pi = 0; pi < nPts; pi++) {
    const cellIndex = points[pi]!.cellIndex
    if (peakDbAt[pi]! > peakDb) {
      peakDb = peakDbAt[pi]!
      peakTSec = peakTAt[pi]!
      worstCellIndex = cellIndex
    }
    for (const run of ceilRuns[pi]!) {
      violations.push({
        code: 'EXPOSURE_BUDGET',
        severity: 'error',
        message:
          `summed carrier ${run.peakDb.toFixed(1)} dB at cell ${cellIndex} exceeds the ` +
          `${budget.maxCarrierDb} dB ceiling (${run.tStart.toFixed(1)}–${run.tEnd.toFixed(1)} s)`,
        cueIds: run.cueIds,
        tSec: run.peakT,
      })
    }
    const dwell = maxWindowOccupancy(dwellRuns[pi]!, budget.dwellWindowSec)
    if (dwell.occSec > budget.dwellMaxSec) {
      const cueIds: string[] = []
      for (const run of dwellRuns[pi]!) {
        for (const id of run.cueIds) if (!cueIds.includes(id)) cueIds.push(id)
      }
      violations.push({
        code: 'EXPOSURE_DWELL',
        severity: 'error',
        message:
          `cell ${cellIndex} sits at/above ${budget.dwellDb} dB for ` +
          `${dwell.occSec.toFixed(1)} s within a ${budget.dwellWindowSec} s window ` +
          `(max ${budget.dwellMaxSec} s)`,
        cueIds,
        tSec: dwell.windowStart,
      })
    }
    cells.push({ cellIndex, peakCarrierDb: peakDbAt[pi]!, dwellSec: dwell.occSec })
  }

  return {
    budget,
    pass: violations.length === 0,
    peakDb,
    peakTSec,
    worstCellIndex,
    cells,
    violations,
  }
}
