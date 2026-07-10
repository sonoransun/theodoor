/**
 * fab/mortarRack.ts — mortar rack slot planning and dimensioned top-view SVG.
 *
 * Staging hardware only: this module lays out tube positions in a wooden/
 * aluminum rack frame and draws a shop drawing. Effects are opaque catalog
 * metadata; the only property consumed here is `caliberMm`.
 */

import type { CompiledShow, EffectDef, SitePlan } from '../contracts.js'
import { circle, dim, fmtMm, rect, svgDoc, text } from './svg.js'

/** Frame margin added around the tube field on every side. */
export const RACK_MARGIN_MM = 40
/** Tube bore = shell caliber + this clearance. */
export const BORE_CLEARANCE_MM = 5
/** Center-to-center pitch = bore * this factor. */
export const PITCH_FACTOR = 1.6
/** Hard cap on tubes per row regardless of count. */
export const MAX_TUBES_PER_ROW = 10

export interface TubeSlot {
  cueId: string
  caliberMm: number
  boreMm: number
  /** Row/column within this slot's caliber group (0-indexed). */
  row: number
  col: number
  /** Tube center in rack-local mm (x along length, y along width). */
  cxMm: number
  cyMm: number
}

export interface RackCaliberGroup {
  caliberMm: number
  boreMm: number
  pitchMm: number
  tubeCount: number
  rows: number
  cols: number
  /** Top edge of this group's row block, rack-local mm. */
  yOffsetMm: number
  /** Cue ids in firing order (compiled cue order). */
  cueIds: readonly string[]
}

export interface RackPlan {
  assetId: string
  tiltDeg: number
  marginMm: number
  tubeCount: number
  /** Outer frame length (x) and width (y), mm, margins included. */
  lengthMm: number
  widthMm: number
  /** Caliber groups, ascending caliber, stacked along the width. */
  groups: readonly RackCaliberGroup[]
  slots: readonly TubeSlot[]
}

/** Rows of min(10, ceil(sqrt(n))) tubes: cols per row, rows = ceil(n/cols). */
export function tubeLayout(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 0, rows: 0 }
  const cols = Math.min(MAX_TUBES_PER_ROW, Math.ceil(Math.sqrt(n)))
  return { cols, rows: Math.ceil(n / cols) }
}

/**
 * Plan one rack per `mortarRack` asset: one single-shot tube per pyro cue
 * fired from it (no reload), grouped by caliber. Racks that host no cues
 * still get a (tube-less) plan so every site asset is accounted for.
 */
export function rackPlan(
  compiled: CompiledShow,
  site: SitePlan,
  getEffect: (id: string) => EffectDef | undefined,
): RackPlan[] {
  const plans: RackPlan[] = []
  for (const asset of site.assets) {
    if (asset.kind !== 'mortarRack') continue

    // Bucket this rack's pyro cues by caliber, preserving compiled order
    // (already sorted by fireSec, trackId, id — a stable firing order).
    const byCaliber = new Map<number, string[]>()
    for (const cue of compiled.cues) {
      if (cue.medium !== 'pyro' || cue.positionId !== asset.id) continue
      const eff = getEffect(cue.effectId)
      if (!eff || eff.medium !== 'pyro') continue
      const list = byCaliber.get(eff.caliberMm)
      if (list) list.push(cue.id)
      else byCaliber.set(eff.caliberMm, [cue.id])
    }

    const groups: RackCaliberGroup[] = []
    const slots: TubeSlot[] = []
    let yMm = RACK_MARGIN_MM
    let maxRowSpanMm = 0
    for (const caliberMm of [...byCaliber.keys()].sort((a, b) => a - b)) {
      const cueIds = byCaliber.get(caliberMm)!
      const n = cueIds.length
      const { cols, rows } = tubeLayout(n)
      const boreMm = caliberMm + BORE_CLEARANCE_MM
      const pitchMm = boreMm * PITCH_FACTOR
      groups.push({ caliberMm, boreMm, pitchMm, tubeCount: n, rows, cols, yOffsetMm: yMm, cueIds })
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / cols)
        const col = i % cols
        slots.push({
          cueId: cueIds[i]!,
          caliberMm,
          boreMm,
          row,
          col,
          cxMm: RACK_MARGIN_MM + (col + 0.5) * pitchMm,
          cyMm: yMm + (row + 0.5) * pitchMm,
        })
      }
      maxRowSpanMm = Math.max(maxRowSpanMm, cols * pitchMm)
      yMm += rows * pitchMm
    }

    plans.push({
      assetId: asset.id,
      tiltDeg: asset.rack?.tiltDeg ?? 0,
      marginMm: RACK_MARGIN_MM,
      tubeCount: slots.length,
      lengthMm: 2 * RACK_MARGIN_MM + maxRowSpanMm,
      widthMm: yMm + RACK_MARGIN_MM,
      groups,
      slots,
    })
  }
  return plans
}

/**
 * Dimensioned top-view shop drawing: outer frame, per-tube bore circles,
 * caliber group labels, and dim() annotations for overall length, overall
 * width, and tube pitch.
 */
export function rackSvg(plan: RackPlan): string {
  const children: string[] = []
  children.push(rect(0, 0, plan.lengthMm, plan.widthMm, { 'stroke-width': 1 }))
  children.push(text(4, 10, `rack ${plan.assetId} (top view)`, { 'font-size': 6 }))

  for (const g of plan.groups) {
    children.push(
      text(4, g.yOffsetMm + g.pitchMm / 2, `${fmtMm(g.caliberMm)}mm x ${g.tubeCount}`),
    )
  }
  for (const s of plan.slots) {
    children.push(circle(s.cxMm, s.cyMm, s.boreMm / 2))
  }

  // Pitch dimension across the first two tube centers of the first group
  // that has at least two tubes in a row.
  const g0 = plan.groups.find((g) => g.cols >= 2)
  if (g0) {
    const y = g0.yOffsetMm + g0.pitchMm / 2
    const x1 = RACK_MARGIN_MM + 0.5 * g0.pitchMm
    children.push(dim(x1, y, x1 + g0.pitchMm, y, `pitch ${fmtMm(g0.pitchMm)} mm`))
  }

  children.push(dim(0, plan.widthMm + 12, plan.lengthMm, plan.widthMm + 12, `${fmtMm(plan.lengthMm)} mm`))
  children.push(dim(plan.lengthMm + 12, 0, plan.lengthMm + 12, plan.widthMm, `${fmtMm(plan.widthMm)} mm`))

  return svgDoc(plan.lengthMm + 30, plan.widthMm + 30, children)
}
