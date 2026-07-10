/**
 * sim/crowd.ts — deterministic crowd-canvas evaluator (wristband / phone
 * patterns over the derived audience cell grid).
 *
 * Every pattern is a closed-form envelope in show time evaluated per cell, so
 * seek and chunked advance are trivially consistent (no incremental state).
 * Concurrent cues are MAX-blended per channel — max is order-independent, so
 * evaluation order can never perturb determinism.
 *
 * THE LATENCY RAMP (the keystone made visible): a broadcast command leaves the
 * mast at fireSec but reaches each device after a scattered delay. Per
 * (cue, cell) we draw CROWD_LATENCY_DEVICES representative device latencies
 * once — u_i from mulberry32(forkSeed(cue.seed, `lat:${row}:${col}:${i}`))
 * pushed through the piecewise-linear inverse CDF of the mast's LatencySpec
 * for the effect's channel — and the cell's lit fraction at time t is the
 * share of devices whose latency has elapsed since fireSec. The solver sets
 * anticipation = p95, so the ramp is ~95 % complete exactly at targetSec:
 * wristbands shimmer in over tens of milliseconds, phones over seconds.
 *
 * Cell brightness scales by how many devices actually respond relative to the
 * expected population (sparse cells read dimmer); cells outside every mast's
 * coverage stay dark everywhere, matching the broadcast-mask exporters.
 */

import type {
  CompiledCue,
  CompiledShow,
  CrowdEffect,
  CrowdMastSpec,
  LatencySpec,
  Seconds,
  SitePlan,
  Vec2,
} from '../contracts.js'
import type { EffectLookup } from '../acoustics/spl.js'
import { clamp, forkSeed, hexToRgb, mulberry32 } from '../math/index.js'
import {
  CROWD_PHONE_PARTICIPATION,
  CROWD_WRISTBAND_PARTICIPATION,
  coveredCellIndices,
  crowdGridFor,
  crowdMastFor,
  type CrowdCell,
  type CrowdGrid,
} from '../site/crowdGrid.js'
import { FONT_H, textCells } from '../text/font5x7.js'
import { beatPhase } from './lasers.js'
import type { SimBuffers } from './snapshot.js'

/** Representative devices sampled per (cue, cell) for the latency ramp. */
export const CROWD_LATENCY_DEVICES = 16
/** Wave traversal time when no periodBeats param / beat grid locks it. */
export const CROWD_WAVE_PERIOD_SEC = 2
/** Wave travel azimuth default, degrees clockwise from north (west → east). */
export const CROWD_WAVE_DIR_DEG = 90
/** Soft crest width of the traveling wave, in cells. */
export const CROWD_WAVE_CREST_CELLS = 1.5
/** sectionChase default band count. */
export const CROWD_CHASE_SECTIONS = 4
/** sparkle / flashlightStarfield default twinkle slot rate, Hz. */
export const CROWD_TWINKLE_HZ = 3
/** Fraction of cells lit per twinkle slot (sparkle). */
export const CROWD_SPARKLE_DENSITY = 0.25
/** Fraction of cells lit per twinkle slot (flashlightStarfield). */
export const CROWD_STARFIELD_DENSITY = 0.12
/** Heartbeat exponential decay constant, seconds. */
export const CROWD_HEARTBEAT_DECAY_SEC = 0.12
/** Heartbeat dub delay after the lub, seconds. */
export const CROWD_HEARTBEAT_DUB_DELAY_SEC = 0.18
/** Heartbeat dub gain relative to the lub. */
export const CROWD_HEARTBEAT_DUB_GAIN = 0.6
/** A cell counts as lit (stats) when any channel exceeds this. */
export const CROWD_LIT_EPS = 0.05

/** One crowd cue prepared for per-step evaluation. */
export interface CrowdCueSim {
  cueIdx: number
  cue: CompiledCue
  effect: CrowdEffect
  /** Latency envelope of the mast the broadcast rides (undefined → instant). */
  mast?: CrowdMastSpec
  /** Active window start: fireSec (devices light as commands arrive). */
  startSec: Seconds
  /** Active window end: targetSec + durationSec. */
  endSec: Seconds
}

/**
 * Collect crowd cues: the mast is resolved by {@link crowdMastFor} — the
 * single shared owner of the rule (positionId when it names a spec-bearing
 * crowdMast asset, else the site's first), so the solver's anticipation and
 * this ramp always ride the same LatencySpec (validation flags dangling
 * position ids elsewhere).
 */
export function buildCrowdCues(compiled: CompiledShow, getEffect: EffectLookup): CrowdCueSim[] {
  const out: CrowdCueSim[] = []
  compiled.cues.forEach((cue, cueIdx) => {
    if (cue.medium !== 'crowd') return
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'crowd') return
    const mast = crowdMastFor(compiled.show.site, cue.positionId)
    out.push({
      cueIdx,
      cue,
      effect,
      ...(mast ? { mast: mast.crowdMast! } : {}),
      startSec: cue.fireSec,
      endSec: cue.targetSec + cue.durationSec,
    })
  })
  return out
}

/**
 * Piecewise-linear inverse CDF of a LatencySpec through the quantile knots
 * (0, min) (0.5, p50) (0.95, p95) (1, max). Milliseconds.
 */
export function latencyQuantileMs(spec: LatencySpec, u: number): number {
  const v = clamp(u, 0, 1)
  if (v <= 0.5) return spec.minMs + ((spec.p50Ms - spec.minMs) * v) / 0.5
  if (v <= 0.95) return spec.p50Ms + ((spec.p95Ms - spec.p50Ms) * (v - 0.5)) / 0.45
  return spec.p95Ms + ((spec.maxMs - spec.p95Ms) * (v - 0.95)) / 0.05
}

/** Cells with any rgb/white channel above `eps` (stats helper). */
export function countLitCrowdCells(
  rgb: Float32Array,
  white: Float32Array,
  cellCount: number,
  eps = CROWD_LIT_EPS,
): number {
  let n = 0
  for (let i = 0; i < cellCount; i++) {
    if (
      rgb[i * 3]! > eps || rgb[i * 3 + 1]! > eps || rgb[i * 3 + 2]! > eps ||
      white[i]! > eps
    ) {
      n++
    }
  }
  return n
}

type Rgb = readonly [number, number, number]

/** rgb/rgb2 cue param: [r,g,b] tuple 0..1 or '#rrggbb' hex, else undefined. */
function rgbParam(cue: CompiledCue, key: string): Rgb | undefined {
  const v = cue.params?.[key]
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')) {
    return [clamp(v[0]!, 0, 1), clamp(v[1]!, 0, 1), clamp(v[2]!, 0, 1)]
  }
  if (typeof v === 'string') return hexToRgb(v)
  return undefined
}

/**
 * Cue color override or effect palette: params.rgb alone is a one-color
 * palette; params.rgb2 alongside it makes the two-color palette [rgb, rgb2],
 * alternating per cell via `palette[cell.index % palette.length]` exactly
 * like a two-entry effect.colors list. Without params.rgb the effect's own
 * colors apply (white when the list is empty).
 */
function paletteOf(effect: CrowdEffect, cue: CompiledCue): readonly Rgb[] {
  const rgb = rgbParam(cue, 'rgb')
  if (rgb) {
    const rgb2 = rgbParam(cue, 'rgb2')
    return rgb2 ? [rgb, rgb2] : [rgb]
  }
  const out = effect.colors.map((c) => hexToRgb(c))
  return out.length > 0 ? out : [[1, 1, 1]]
}

/** Rasterized params.bitmap: lit keys (y*width + x), row 0 = the TOP row. */
interface BitmapRaster {
  lit: ReadonlySet<number>
  width: number
  height: number
}

/**
 * params.bitmap — row strings (top row first) where every non-'.' character
 * lights the cell — parsed into a raster; undefined when the param is absent
 * or degenerate (no rows / all rows empty). Rows may have ragged lengths;
 * cells past a row's end are unlit.
 */
function bitmapRasterOf(cue: CompiledCue): BitmapRaster | undefined {
  const rows = cue.params?.bitmap
  if (!Array.isArray(rows) || rows.length === 0) return undefined
  let width = 0
  for (const r of rows) {
    if (typeof r !== 'string') return undefined
    width = Math.max(width, r.length)
  }
  if (width === 0) return undefined
  const lit = new Set<number>()
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] as string
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '.') lit.add(y * width + x)
    }
  }
  return { lit, width, height: rows.length }
}

function numParam(cue: CompiledCue, key: string): number | undefined {
  const v = cue.params?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

const fract = (x: number): number => x - Math.floor(x)
const modInt = (k: number, n: number): number => ((k % n) + n) % n

/** Beats elapsed since `fromSec` on the grid; 1 s/beat without one. */
function beatsSince(beats: readonly Seconds[], fromSec: Seconds, tSec: Seconds): number {
  if (beats.length >= 2) return beatPhase(beats, tSec) - beatPhase(beats, fromSec)
  return tSec - fromSec
}

/** Per-cue data derived once (latency draws, brightness, pattern geometry). */
interface CueRuntime {
  intensity: number
  palette: readonly Rgb[]
  /** Device command-arrival delays, seconds after fireSec: [cellIndex*16 + i]. */
  latSec: Float64Array
  /** Responding-device brightness per cell, 0..1. */
  brightness: Float64Array
  /** wave: unit direction + projection extent over covered cells. */
  wave?: { ux: number; uy: number; sMin: number; sMax: number }
  /** radialPulse / heartbeat origin centroid. */
  origin?: Vec2
  /** text: lit glyph-cell keys (y*width + x) and total raster width. */
  text?: { lit: ReadonlySet<number>; width: number }
  /** flood/text params.bitmap raster (overrides the glyph raster). */
  bitmap?: BitmapRaster
}

/**
 * The crowd-canvas evaluator: derives the grid + coverage once per site and
 * renders active crowd cues into the SimBuffers each step. Stateless in show
 * time (pure closed-form patterns), so the per-cue runtime cache survives
 * engine resets without affecting determinism.
 */
export class CrowdField {
  readonly grid: CrowdGrid | undefined
  readonly covered: ReadonlySet<number>
  private readonly coveredCells: readonly CrowdCell[]
  private readonly densityPPM2: number
  private readonly cache = new Map<CrowdCueSim, CueRuntime>()

  constructor(site: SitePlan) {
    this.grid = crowdGridFor(site)
    this.covered = this.grid ? coveredCellIndices(site, this.grid) : new Set()
    this.coveredCells = this.grid
      ? this.grid.cells.filter((c) => this.covered.has(c.index))
      : []
    this.densityPPM2 = site.crowdGrid?.densityPPM2 ?? 0
  }

  /** Total grid cells (0 without a grid) — the SimBuffers crowd array size. */
  get cellCount(): number {
    return this.grid?.cells.length ?? 0
  }

  /**
   * Render every active cue at show time tSec into out.crowdRgb (wristband)
   * / out.crowdWhite (phone), max-blended per channel. Buffers are zeroed by
   * beginStep; uncovered cells are never written.
   */
  evalStep(
    cues: readonly CrowdCueSim[],
    tSec: Seconds,
    beats: readonly Seconds[],
    out: SimBuffers,
  ): void {
    const grid = this.grid
    if (!grid || this.coveredCells.length === 0 || out.crowdCellCount === 0) return

    for (const c of cues) {
      if (tSec < c.startSec || tSec >= c.endSec) continue
      const pattern = c.effect.pattern
      if (pattern === 'hapticPulse') continue // export-only channel, no visual
      const rt = this.runtime(c)
      const isPhone = c.effect.channel === 'phone'
      const dtFire = tSec - c.cue.fireSec

      const write = (cell: CrowdCell, env: number): void => {
        if (env <= 0) return
        const lit = this.litFraction(rt, cell.index, dtFire)
        if (lit <= 0) return
        const v = clamp(env * lit * rt.brightness[cell.index]! * rt.intensity, 0, 1)
        if (v <= 0) return
        if (isPhone) {
          if (v > out.crowdWhite[cell.index]!) out.crowdWhite[cell.index] = v
        } else {
          const col = rt.palette[cell.index % rt.palette.length]!
          const b3 = cell.index * 3
          const r = col[0] * v
          const g = col[1] * v
          const b = col[2] * v
          if (r > out.crowdRgb[b3]!) out.crowdRgb[b3] = r
          if (g > out.crowdRgb[b3 + 1]!) out.crowdRgb[b3 + 1] = g
          if (b > out.crowdRgb[b3 + 2]!) out.crowdRgb[b3 + 2] = b
        }
      }

      // params.bitmap (flood/text): a static raster centered on the col/row
      // grid — non-'.' characters light the cell, overriding the whole-zone
      // flood / the 5×7 glyph raster (see the contracts.ts param table).
      const bm = rt.bitmap
      if (bm !== undefined) {
        const c0 = Math.floor((grid.cols - bm.width) / 2)
        const r0 = Math.floor((grid.rows - bm.height) / 2)
        for (const cell of this.coveredCells) {
          const gx = cell.col - c0
          // Bitmap row 0 is the TOP: map it to the northmost row of the band
          // so the artwork reads upright on a north-up plan view (same
          // convention as the text glyph raster below).
          const gy = bm.height - 1 - (cell.row - r0)
          if (gx < 0 || gx >= bm.width || gy < 0 || gy >= bm.height) continue
          if (bm.lit.has(gy * bm.width + gx)) write(cell, 1)
        }
        continue
      }

      switch (pattern) {
        case 'flood': {
          for (const cell of this.coveredCells) write(cell, 1)
          break
        }

        case 'wave': {
          const w = rt.wave!
          const periodBeats = numParam(c.cue, 'periodBeats')
          const u = periodBeats !== undefined && periodBeats > 0 && beats.length >= 2
            ? (beatPhase(beats, tSec) - beatPhase(beats, c.cue.targetSec)) / periodBeats
            : (tSec - c.cue.targetSec) / CROWD_WAVE_PERIOD_SEC
          const span = Math.max(w.sMax - w.sMin, grid.cellSizeM)
          const frontS = w.sMin + fract(u) * span
          const half = (CROWD_WAVE_CREST_CELLS / 2) * grid.cellSizeM
          for (const cell of this.coveredCells) {
            const s = cell.centroid.x * w.ux + cell.centroid.y * w.uy
            write(cell, Math.max(0, 1 - Math.abs(s - frontS) / half))
          }
          break
        }

        case 'radialPulse': {
          const origin = rt.origin!
          const periodBeats = numParam(c.cue, 'periodBeats') ?? 1
          const radiusCells = periodBeats > 0
            ? beatsSince(beats, c.cue.targetSec, tSec) / periodBeats
            : 0
          for (const cell of this.coveredCells) {
            const d = Math.hypot(cell.centroid.x - origin.x, cell.centroid.y - origin.y) /
              grid.cellSizeM
            write(cell, Math.max(0, 1 - 2 * Math.abs(d - radiusCells)))
          }
          break
        }

        case 'sectionChase': {
          const raw = numParam(c.cue, 'sections')
          const sections = Math.max(1, Math.round(raw !== undefined && raw > 0 ? raw : CROWD_CHASE_SECTIONS))
          const active = modInt(Math.floor(beatsSince(beats, c.cue.targetSec, tSec)), sections)
          for (const cell of this.coveredCells) {
            const band = Math.min(sections - 1, Math.floor((cell.col * sections) / grid.cols))
            if (band === active) write(cell, 1)
          }
          break
        }

        case 'sparkle':
        case 'flashlightStarfield': {
          const hzRaw = numParam(c.cue, 'twinkleHz')
          const hz = hzRaw !== undefined && hzRaw > 0 ? hzRaw : CROWD_TWINKLE_HZ
          const density = numParam(c.cue, 'densityFrac') ??
            (pattern === 'sparkle' ? CROWD_SPARKLE_DENSITY : CROWD_STARFIELD_DENSITY)
          const slot = Math.floor((tSec - c.cue.targetSec) * hz)
          for (const cell of this.coveredCells) {
            const u = mulberry32(forkSeed(c.cue.seed, `tw:${cell.index}:${slot}`))()
            if (u < density) write(cell, 1)
          }
          break
        }

        case 'text': {
          const tx = rt.text!
          if (tx.width <= 0 || tx.lit.size === 0) break
          const scroll = tx.width > grid.cols
          // Static text centers; wider text enters from the east edge and
          // scrolls west one column per beat (panel-ticker convention).
          const c0 = scroll
            ? grid.cols - modInt(
                Math.floor(beatsSince(beats, c.cue.targetSec, tSec)),
                tx.width + grid.cols,
              )
            : Math.floor((grid.cols - tx.width) / 2)
          const r0 = Math.floor((grid.rows - FONT_H) / 2)
          for (const cell of this.coveredCells) {
            const gx = cell.col - c0
            // Glyph row 0 is the TOP: map it to the northmost row of the band
            // so the text reads upright on a north-up plan view.
            const gy = FONT_H - 1 - (cell.row - r0)
            if (gx < 0 || gx >= tx.width || gy < 0 || gy >= FONT_H) continue
            if (tx.lit.has(gy * tx.width + gx)) write(cell, 1)
          }
          break
        }

        case 'heartbeat': {
          let tau: number
          if (beats.length >= 2) {
            if (tSec < beats[0]!) break
            const k = Math.min(Math.floor(beatPhase(beats, tSec)), beats.length - 1)
            tau = tSec - beats[k]!
          } else {
            tau = fract(tSec - c.cue.targetSec)
          }
          const e = (x: number): number =>
            x < 0 ? 0 : Math.exp(-x / CROWD_HEARTBEAT_DECAY_SEC)
          const env = e(tau) + CROWD_HEARTBEAT_DUB_GAIN * e(tau - CROWD_HEARTBEAT_DUB_DELAY_SEC)
          const radiusCells = numParam(c.cue, 'radiusCells')
          if (radiusCells !== undefined && radiusCells > 0 && rt.origin) {
            const origin = rt.origin
            for (const cell of this.coveredCells) {
              const d = Math.hypot(cell.centroid.x - origin.x, cell.centroid.y - origin.y) /
                grid.cellSizeM
              write(cell, env * clamp(1 - d / radiusCells, 0, 1))
            }
          } else {
            for (const cell of this.coveredCells) write(cell, env)
          }
          break
        }
      }
    }
  }

  /** Share of the cell's sampled devices whose command has arrived. */
  private litFraction(rt: CueRuntime, cellIndex: number, dtSinceFireSec: number): number {
    if (dtSinceFireSec < 0) return 0
    const base = cellIndex * CROWD_LATENCY_DEVICES
    let n = 0
    for (let i = 0; i < CROWD_LATENCY_DEVICES; i++) {
      if (rt.latSec[base + i]! <= dtSinceFireSec) n++
    }
    return n / CROWD_LATENCY_DEVICES
  }

  private runtime(c: CrowdCueSim): CueRuntime {
    const hit = this.cache.get(c)
    if (hit) return hit
    const grid = this.grid!
    const nCells = grid.cells.length
    const isPhone = c.effect.channel === 'phone'
    const participation = isPhone ? CROWD_PHONE_PARTICIPATION : CROWD_WRISTBAND_PARTICIPATION
    const latSpec = c.mast?.[c.effect.channel]

    const latSec = new Float64Array(nCells * CROWD_LATENCY_DEVICES)
    const brightness = new Float64Array(nCells)
    for (const cell of this.coveredCells) {
      const denom = cell.areaM2 * this.densityPPM2 * participation
      const responders = isPhone ? cell.phones : cell.wristbands
      brightness[cell.index] = denom > 0 ? clamp(responders / denom, 0, 1) : 0
      const base = cell.index * CROWD_LATENCY_DEVICES
      for (let i = 0; i < CROWD_LATENCY_DEVICES; i++) {
        const u = mulberry32(forkSeed(c.cue.seed, `lat:${cell.row}:${cell.col}:${i}`))()
        latSec[base + i] = latSpec ? latencyQuantileMs(latSpec, u) / 1000 : 0
      }
    }

    const rt: CueRuntime = {
      intensity: numParam(c.cue, 'intensity') ?? 1,
      palette: paletteOf(c.effect, c.cue),
      latSec,
      brightness,
    }

    if (c.effect.pattern === 'wave') {
      const dirDeg = numParam(c.cue, 'dirDeg') ?? CROWD_WAVE_DIR_DEG
      const th = (dirDeg * Math.PI) / 180
      const ux = Math.sin(th)
      const uy = Math.cos(th)
      let sMin = Infinity
      let sMax = -Infinity
      for (const cell of this.coveredCells) {
        const s = cell.centroid.x * ux + cell.centroid.y * uy
        if (s < sMin) sMin = s
        if (s > sMax) sMax = s
      }
      rt.wave = { ux, uy, sMin, sMax }
    }

    if (c.effect.pattern === 'radialPulse' || c.effect.pattern === 'heartbeat') {
      const raw = numParam(c.cue, 'originCell')
      const cell = (raw !== undefined ? grid.cells[raw] : undefined) ??
        grid.cells[Math.floor(grid.cells.length / 2)]!
      rt.origin = cell.centroid
    }

    if (c.effect.pattern === 'text') {
      const msg = typeof c.cue.params?.text === 'string' ? c.cue.params.text : ''
      const { cells, width } = textCells(msg)
      const lit = new Set<number>()
      for (const g of cells) lit.add(g.y * width + g.x)
      rt.text = { lit, width }
    }

    if (c.effect.pattern === 'flood' || c.effect.pattern === 'text') {
      const bm = bitmapRasterOf(c.cue)
      if (bm) rt.bitmap = bm
    }

    this.cache.set(c, rt)
    return rt
  }
}
