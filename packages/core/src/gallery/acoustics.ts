/**
 * gallery/acoustics.ts — acoustics-facing gallery builders: the carrier-
 * exposure heatmap, the quiet-budget SPL chart, the beam footprint-geometry
 * explainer, and the animated beam-flyover loop.
 *
 * Pure string assembly (fixed-precision, explicit colors — see gallery/theme).
 * Real numbers only: callers feed exposureReport()/splTimeline() output and
 * compiled shows; nothing here invents values.
 */

import type { ExposureBudget, PositionedAsset, Seconds, Vec2 } from '../contracts.js'
import type { ExposureReport } from '../acoustics/exposure.js'
import { beamAimAt, beamFootprintAt } from '../acoustics/beams.js'
import type { BeamEffect } from '../contracts.js'
import type { CrowdGrid } from '../site/crowdGrid.js'
import { el, fmtMm, line } from '../fab/svg.js'
import { animate, fmtSmilSec } from './anim.js'
import { galleryDoc, label } from './scene.js'
import { GALLERY_THEME } from './theme.js'
import type { GalleryFrame } from './sample.js'

// ---------------------------------------------------------------------------
// Exposure heatmap
// ---------------------------------------------------------------------------

/** Piecewise color ramp for carrier levels (dB): dark → teal → amber → red. */
export function exposureRampColor(db: number, budget: ExposureBudget): string {
  if (db >= budget.maxCarrierDb) return GALLERY_THEME.climax
  const stops: readonly [number, string][] = [
    [60, '#0a1230'],
    [90, GALLERY_THEME.lanes.beams],
    [budget.dwellDb, GALLERY_THEME.lanes.crowd],
    [budget.maxCarrierDb, GALLERY_THEME.climax],
  ]
  if (db <= stops[0]![0]) return stops[0]![1]
  for (let i = 1; i < stops.length; i++) {
    const [d1, c1] = stops[i]!
    const [d0, c0] = stops[i - 1]!
    if (db <= d1) {
      // Blend in hex space at fixed precision so output is byte-stable.
      const f = (db - d0) / (d1 - d0)
      const mix = (a: number, b: number): number => Math.round(a + (b - a) * f)
      const pa = parseInt(c0.slice(1), 16)
      const pb = parseInt(c1.slice(1), 16)
      const r = mix((pa >> 16) & 0xff, (pb >> 16) & 0xff)
      const g = mix((pa >> 8) & 0xff, (pb >> 8) & 0xff)
      const b = mix(pa & 0xff, pb & 0xff)
      return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
    }
  }
  return GALLERY_THEME.climax
}

export interface ExposureHeatmapOpts {
  widthPx?: number
  title?: string
}

/**
 * Crowd-grid heatmap of per-cell peak carrier level with the budget legend.
 * Cells not present in the report (never inside any footprint sweep) render
 * at the ramp floor.
 */
export function exposureHeatmapSvg(
  report: ExposureReport,
  grid: CrowdGrid,
  opts: ExposureHeatmapOpts = {},
): string {
  const w = opts.widthPx ?? 880
  const pad = 14
  const legendH = 46
  const cellPx = Math.floor((w - 2 * pad) / grid.cols)
  const gridW = cellPx * grid.cols
  const gridH = cellPx * grid.rows
  const h = gridH + legendH + 2 * pad + 22
  const byIndex = new Map(report.cells.map((c) => [c.cellIndex, c]))
  const children: string[] = []

  for (const cell of grid.cells) {
    const stat = byIndex.get(cell.index)
    const db = stat ? stat.peakCarrierDb : -Infinity
    const fill = db === -Infinity ? '#0a1230' : exposureRampColor(db, report.budget)
    // Row 0 is the BACK of the lawn; draw it at the top, front row at bottom.
    children.push(
      el('rect', {
        x: pad + cell.col * cellPx,
        y: pad + cell.row * cellPx,
        width: cellPx - 1,
        height: cellPx - 1,
        fill,
      }),
    )
  }
  // Worst cell outline + value.
  const worst = grid.cells.find((c) => c.index === report.worstCellIndex)
  if (worst && report.peakDb > -Infinity) {
    children.push(
      el('rect', {
        x: pad + worst.col * cellPx - 1,
        y: pad + worst.row * cellPx - 1,
        width: cellPx + 1,
        height: cellPx + 1,
        fill: 'none',
        stroke: GALLERY_THEME.climax,
        'stroke-width': 1.5,
      }),
      label(pad + worst.col * cellPx + cellPx + 4, pad + worst.row * cellPx + cellPx - 2,
        `${report.peakDb.toFixed(1)} dB`, { 'font-size': 10 }),
    )
  }
  children.push(
    label(pad + gridW - 2, pad + gridH + 12, 'front', {
      'font-size': 10,
      'text-anchor': 'end',
      fill: GALLERY_THEME.inkDim,
    }),
  )

  // Legend: sampled ramp swatches with tick labels + budget markers.
  const ly = pad + gridH + 20
  const lw = Math.min(320, gridW)
  const steps = 40
  for (let i = 0; i < steps; i++) {
    const db = 60 + (i / (steps - 1)) * (report.budget.maxCarrierDb + 6 - 60)
    children.push(
      el('rect', {
        x: pad + (i * lw) / steps,
        y: ly,
        width: lw / steps + 0.5,
        height: 10,
        fill: exposureRampColor(db, report.budget),
      }),
    )
  }
  const tickX = (db: number): number =>
    pad + ((db - 60) / (report.budget.maxCarrierDb + 6 - 60)) * lw
  for (const db of [90, report.budget.dwellDb, report.budget.maxCarrierDb]) {
    children.push(
      line(tickX(db), ly - 2, tickX(db), ly + 14, { stroke: GALLERY_THEME.ink, 'stroke-width': 1 }),
      label(tickX(db), ly + 26, `${db}`, { 'font-size': 9, 'text-anchor': 'middle' }),
    )
  }
  children.push(
    label(pad + lw + 14, ly + 10,
      `ceiling ${report.budget.maxCarrierDb} dB · dwell ≤ ${report.budget.dwellMaxSec} s/${report.budget.dwellWindowSec} s at ${report.budget.dwellDb} dB · pass: ${report.pass}`,
      { 'font-size': 10 }),
  )

  return galleryDoc(w, h, {
    title: opts.title ?? 'Carrier exposure by crowd cell',
    desc: 'Per-cell peak carrier level from exposureReport(), with the enforced budget legend.',
  }, children)
}

// ---------------------------------------------------------------------------
// SPL comparison chart
// ---------------------------------------------------------------------------

export interface SplTrace {
  label: string
  color: string
  samples: readonly { tSec: Seconds; dB: number }[]
  /** Shade this trace's over-budget area (climax color, 30%). */
  fillOverBudget?: boolean
}

export interface SplCompareOpts {
  budgetDb: number
  widthPx?: number
  heightPx?: number
  title?: string
  /** Optional labelled vertical rule (e.g. midnight). */
  ruleAt?: { tSec: Seconds; label: string }
}

/** Two-or-more SPL timelines against a dashed budget line. */
export function splCompareSvg(traces: readonly SplTrace[], opts: SplCompareOpts): string {
  const w = opts.widthPx ?? 880
  const h = opts.heightPx ?? 280
  const padL = 44
  const padR = 14
  const padT = 18
  const padB = 34
  let tMax = 1
  let dbMax = opts.budgetDb + 6
  const dbMin = 40
  for (const tr of traces) {
    for (const s of tr.samples) {
      if (s.tSec > tMax) tMax = s.tSec
      if (s.dB > dbMax) dbMax = s.dB
    }
  }
  dbMax += 4
  const x = (t: number): number => padL + (t / tMax) * (w - padL - padR)
  const y = (db: number): number =>
    padT + (1 - (Math.max(db, dbMin) - dbMin) / (dbMax - dbMin)) * (h - padT - padB)

  const children: string[] = []
  // Axes + gridlines every 20 dB.
  for (let db = dbMin; db <= dbMax; db += 20) {
    children.push(
      line(padL, y(db), w - padR, y(db), { stroke: GALLERY_THEME.grid, 'stroke-width': 0.5 }),
      label(padL - 6, y(db) + 3, `${db}`, { 'font-size': 9, 'text-anchor': 'end', fill: GALLERY_THEME.inkDim }),
    )
  }
  for (let t = 0; t <= tMax; t += 60) {
    children.push(
      label(x(t), h - padB + 14, `${Math.round(t)}s`, { 'font-size': 9, 'text-anchor': 'middle', fill: GALLERY_THEME.inkDim }),
    )
  }
  // Budget line.
  children.push(
    line(padL, y(opts.budgetDb), w - padR, y(opts.budgetDb), {
      stroke: GALLERY_THEME.climax,
      'stroke-width': 1,
      'stroke-dasharray': '5 4',
    }),
    label(w - padR, y(opts.budgetDb) - 5, `${opts.budgetDb} dB budget`, {
      'font-size': 10,
      'text-anchor': 'end',
      fill: GALLERY_THEME.climax,
    }),
  )
  for (const tr of traces) {
    const finite = tr.samples.filter((s) => Number.isFinite(s.dB))
    if (finite.length === 0) continue
    if (tr.fillOverBudget) {
      // One polygon per contiguous run above the budget.
      let run: { tSec: number; dB: number }[] = []
      const flush = (): void => {
        if (run.length >= 2) {
          const pts = [
            `${fmtMm(x(run[0]!.tSec))},${fmtMm(y(opts.budgetDb))}`,
            ...run.map((s) => `${fmtMm(x(s.tSec))},${fmtMm(y(s.dB))}`),
            `${fmtMm(x(run[run.length - 1]!.tSec))},${fmtMm(y(opts.budgetDb))}`,
          ].join(' ')
          children.push(el('polygon', { points: pts, fill: GALLERY_THEME.climax, opacity: 0.3 }))
        }
        run = []
      }
      for (const s of finite) {
        if (s.dB > opts.budgetDb) run.push(s)
        else flush()
      }
      flush()
    }
    const pts = finite.map((s) => `${fmtMm(x(s.tSec))},${fmtMm(y(s.dB))}`).join(' ')
    children.push(el('polyline', { points: pts, fill: 'none', stroke: tr.color, 'stroke-width': 1.2 }))
  }
  // Legend + optional rule.
  let lx = padL + 6
  for (const tr of traces) {
    children.push(
      line(lx, padT + 4, lx + 16, padT + 4, { stroke: tr.color, 'stroke-width': 2 }),
      label(lx + 20, padT + 8, tr.label, { 'font-size': 10 }),
    )
    lx += 24 + tr.label.length * 7 + 16
  }
  if (opts.ruleAt) {
    children.push(
      line(x(opts.ruleAt.tSec), padT, x(opts.ruleAt.tSec), h - padB, {
        stroke: GALLERY_THEME.hit,
        'stroke-width': 0.8,
        'stroke-dasharray': '2 3',
      }),
      label(x(opts.ruleAt.tSec), padT - 4, opts.ruleAt.label, {
        'font-size': 9,
        'text-anchor': 'middle',
        fill: GALLERY_THEME.hit,
      }),
    )
  }
  return galleryDoc(w, h, {
    title: opts.title ?? 'Summed SPL at the worst listener',
    desc: 'splTimeline() traces against the enforced noise budget.',
  }, children)
}

// ---------------------------------------------------------------------------
// Beam footprint geometry explainer
// ---------------------------------------------------------------------------

export interface BeamGeometryOpts {
  widthPx?: number
  title?: string
}

/**
 * Two-panel explainer computed from the REAL geometry helpers: left, the side
 * view (head height, half-angle cone, depression, near/far footprint edges,
 * plus the dashed horizon-escape case); right, the top-view ellipse with its
 * semi-axes and the out-of-footprint leakage note.
 */
export function beamGeometrySvg(
  asset: PositionedAsset,
  effect: BeamEffect,
  target: Vec2,
  opts: BeamGeometryOpts = {},
): string {
  const fp = beamFootprintAt(asset, effect, target)
  if (!fp) throw new Error('beamGeometrySvg: target must have a bounded footprint')
  const aim = beamAimAt(asset, target)
  const w = opts.widthPx ?? 880
  const h = 340
  const half = w / 2 - 20
  const earM = 1.6
  const hM = asset.elevationM - earM
  const groundD = Math.hypot(target.x - asset.pos.x, target.y - asset.pos.y)
  const alpha = (effect.beamWidthDeg / 2) * (Math.PI / 180)
  const eps = Math.atan2(hM, groundD)
  const dNear = hM / Math.tan(eps + alpha)
  const dFar = hM / Math.tan(eps - alpha)

  const children: string[] = []
  // ---- left panel: side view ------------------------------------------------
  const gy = h - 60
  const px = (m: number): number => 30 + (m / (dFar * 1.15)) * (half - 60)
  const py = (m: number): number => gy - (m / (asset.elevationM * 1.3)) * (gy - 40)
  const headX = px(0)
  const headY = py(asset.elevationM)
  children.push(
    line(20, gy, half, gy, { stroke: GALLERY_THEME.ground, 'stroke-width': 1 }),
    // mast + head
    line(headX, gy, headX, headY, { stroke: GALLERY_THEME.inkDim, 'stroke-width': 2 }),
    el('circle', { cx: headX, cy: headY, r: 4, fill: GALLERY_THEME.lanes.beams }),
    // cone edges to near/far ground intersections (ear height plane ~ ground here)
    line(headX, headY, px(dNear), py(earM), { stroke: GALLERY_THEME.lanes.beams, 'stroke-width': 1 }),
    line(headX, headY, px(dFar), py(earM), { stroke: GALLERY_THEME.lanes.beams, 'stroke-width': 1 }),
    // aim centerline
    line(headX, headY, px(groundD), py(earM), {
      stroke: GALLERY_THEME.lanes.beams,
      'stroke-width': 0.6,
      'stroke-dasharray': '3 3',
    }),
    // footprint span on the ground
    line(px(dNear), gy - 3, px(dFar), gy - 3, { stroke: GALLERY_THEME.lanes.crowd, 'stroke-width': 3, opacity: 0.8 }),
    label(px((dNear + dFar) / 2), gy + 16, `footprint ${fmtMm(dNear)}…${fmtMm(dFar)} m`, {
      'font-size': 10,
      'text-anchor': 'middle',
    }),
    label(headX + 8, headY - 8, `head ${fmtMm(asset.elevationM)} m`, { 'font-size': 10 }),
    label(px(groundD * 0.55), py(hM * 0.5) - 6, `half-width ${fmtMm(effect.beamWidthDeg / 2)}°  depression ${fmtMm((eps * 180) / Math.PI)}°`, {
      'font-size': 10,
    }),
    // horizon-escape case: a shallow dashed cone that never closes
    line(headX, headY, half - 4, headY + (gy - headY) * 0.4, {
      stroke: GALLERY_THEME.climax,
      'stroke-width': 0.8,
      'stroke-dasharray': '4 4',
      opacity: 0.7,
    }),
    label(half - 8, headY + (gy - headY) * 0.4 - 6, 'below margin: no bounded footprint', {
      'font-size': 9,
      'text-anchor': 'end',
      fill: GALLERY_THEME.climax,
    }),
    label(30, 24, 'side view', { 'font-size': 11, fill: GALLERY_THEME.inkDim }),
  )
  // ---- right panel: top view -------------------------------------------------
  const cx = w / 2 + half / 2
  const cy = h / 2 - 10
  const scale = Math.min(half * 0.32 / fp.a, 60 / fp.b)
  children.push(
    label(w / 2 + 20, 24, 'top view', { 'font-size': 11, fill: GALLERY_THEME.inkDim }),
    el('ellipse', {
      cx,
      cy,
      rx: fp.a * scale,
      ry: fp.b * scale,
      fill: GALLERY_THEME.lanes.beams,
      opacity: 0.25,
      stroke: GALLERY_THEME.lanes.beams,
      'stroke-width': 1,
      transform: `rotate(${fmtMm(90 - fp.azimuthDeg)} ${fmtMm(cx)} ${fmtMm(cy)})`,
    }),
    line(cx - fp.a * scale, cy, cx + fp.a * scale, cy, {
      stroke: GALLERY_THEME.ink,
      'stroke-width': 0.5,
      'stroke-dasharray': '2 3',
    }),
    label(cx, cy - fp.b * scale - 8, `a ${fmtMm(fp.a)} m · b ${fmtMm(fp.b)} m · slant ${fmtMm(aim.slantM)} m`, {
      'font-size': 10,
      'text-anchor': 'middle',
    }),
    label(cx, cy + fp.b * scale + 18, 'outside: −20 dB leakage', {
      'font-size': 10,
      'text-anchor': 'middle',
      fill: GALLERY_THEME.inkDim,
    }),
  )
  return galleryDoc(w, h, {
    title: opts.title ?? 'Directional-audio footprint geometry',
    desc: 'Cone and ground-plane ellipse computed by the acoustics helpers for a real array and target.',
  }, children)
}

// ---------------------------------------------------------------------------
// Animated beam flyover (top-down)
// ---------------------------------------------------------------------------

export interface BeamFlyoverOpts {
  loopDurSec: number
  widthPx?: number
  title?: string
}

/**
 * Top-down lawn loop: the crowd grid as a dim field, the beam footprint
 * ellipse animated along its sampled sweep, and a landing flash when the
 * wavefront arrives (BeamState.landed flips). One beam per figure — pass
 * frames whose window covers exactly one flyover cue.
 */
export function beamFlyoverSvg(
  frames: readonly GalleryFrame[],
  grid: CrowdGrid,
  opts: BeamFlyoverOpts,
): string {
  const w = opts.widthPx ?? 880
  const pad = 14
  const cellPx = Math.floor((w - 2 * pad) / grid.cols)
  const gridW = cellPx * grid.cols
  const gridH = cellPx * grid.rows
  const h = gridH + 2 * pad + 18
  const worldToX = (xM: number): number => {
    const c0 = grid.cells[0]!
    const xMin = c0.centroid.x - (c0.col + 0.5) * grid.cellSizeM
    return pad + ((xM - xMin) / grid.cellSizeM) * cellPx
  }
  const worldToY = (yM: number): number => {
    const c0 = grid.cells[0]!
    const yMin = c0.centroid.y - (c0.row + 0.5) * grid.cellSizeM
    return pad + ((yM - yMin) / grid.cellSizeM) * cellPx
  }
  const children: string[] = []
  for (const cell of grid.cells) {
    children.push(
      el('rect', {
        x: pad + cell.col * cellPx,
        y: pad + cell.row * cellPx,
        width: cellPx - 1,
        height: cellPx - 1,
        fill: GALLERY_THEME.lanes.crowd,
        opacity: 0.08,
      }),
    )
  }
  // Track the first beam present across frames.
  const beamFrames = frames.map((f) => f.beams[0])
  const active = beamFrames.filter((b) => b !== undefined)
  if (active.length >= 2) {
    const cxs = beamFrames.map((b) => fmtMm(b ? worldToX(b.footprint.cx) : -100))
    const cys = beamFrames.map((b) => fmtMm(b ? worldToY(b.footprint.cy) : -100))
    const first = active[0]!
    const landedIdx = beamFrames.findIndex((b) => b?.landed)
    const rx = first.footprint.a > 0 ? (first.footprint.a / grid.cellSizeM) * cellPx : cellPx
    const ry = first.footprint.b > 0 ? (first.footprint.b / grid.cellSizeM) * cellPx : cellPx / 2
    children.push(
      el(
        'ellipse',
        { cx: 0, cy: 0, rx, ry, fill: GALLERY_THEME.lanes.beams, opacity: 0.3, stroke: GALLERY_THEME.lanes.beams, 'stroke-width': 1 },
        animate('cx', { values: cxs, durSec: opts.loopDurSec }) +
          animate('cy', { values: cys, durSec: opts.loopDurSec }) +
          (landedIdx > 0
            ? animate('opacity', {
                values: ['0.15', '0.15', '0.55', '0.35'],
                keyTimes: [0, landedIdx / (beamFrames.length - 1), Math.min(1, landedIdx / (beamFrames.length - 1) + 0.04), 1],
                durSec: opts.loopDurSec,
                calcMode: 'discrete',
              })
            : ''),
      ),
    )
    // Expanding wavefront ring from the array head at loop start.
    const apexX = worldToX(first.apex.x)
    const apexY = worldToY(first.apex.y)
    children.push(
      el(
        'circle',
        { cx: apexX, cy: apexY, r: 2, fill: 'none', stroke: GALLERY_THEME.lanes.beams, 'stroke-width': 1 },
        animate('r', { values: ['2', fmtMm(gridW * 0.9)], durSec: opts.loopDurSec, }) +
          animate('opacity', { values: ['0.7', '0'], durSec: opts.loopDurSec }),
      ),
      label(pad, h - 4, `loop ${fmtSmilSec(opts.loopDurSec)}s — footprint sweeps its cell path; the ring is the wavefront`, {
        'font-size': 9,
        fill: GALLERY_THEME.inkDim,
      }),
    )
  }
  return galleryDoc(w, h, {
    title: opts.title ?? 'Beam flyover',
    desc: 'Sampled steering states: the audible footprint sweeping the lawn.',
  }, children)
}
