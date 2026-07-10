/**
 * fab/bom.ts — aggregated bill of materials for a compiled show + site.
 *
 * Counts staging hardware only: rack frames, mortar tubes, igniters (one
 * per pyro cue), pixel panels, drones (with spares), laser projectors, and
 * fabrication set pieces. Effects are opaque catalog metadata.
 */

import type { CompiledShow, EffectDef, FabricationKind, SitePlan } from '../contracts.js'
import { rackPlan } from './mortarRack.js'

/** Drone spares provisioned on top of the flying count. */
export const DRONE_SPARES_PCT = 15

export interface BomRackLine {
  /** Total tube slots in this rack design. */
  slots: number
  /** Calibers hosted, ascending, mm. */
  calibersMm: readonly number[]
  /** Number of identical racks to build. */
  count: number
}

export interface BomPanelLine {
  wPx: number
  hPx: number
  count: number
}

export interface BomFabPiece {
  kind: FabricationKind
  count: number
}

export interface Bom {
  racks: readonly BomRackLine[]
  /** caliberMm -> total single-shot tubes across all racks. */
  mortarTubesByCaliber: Record<number, number>
  /** One per pyro cue. */
  igniters: number
  panels: readonly BomPanelLine[]
  drones: { flying: number; sparesPct: number; total: number }
  /** Laser projector count (one per laserTower asset). */
  lasers: number
  /** Fabrication set pieces, one per fabrication cue, grouped by kind. */
  fabricationPieces: readonly BomFabPiece[]
}

export function buildBom(
  compiled: CompiledShow,
  site: SitePlan,
  getEffect: (id: string) => EffectDef | undefined,
): Bom {
  // Racks + tubes from the rack planner (identical designs are merged).
  const rackLines = new Map<string, { slots: number; calibersMm: number[]; count: number }>()
  const mortarTubesByCaliber: Record<number, number> = {}
  for (const plan of rackPlan(compiled, site, getEffect)) {
    if (plan.tubeCount === 0) continue
    const calibersMm = plan.groups.map((g) => g.caliberMm)
    const key = `${plan.tubeCount}|${calibersMm.join(',')}`
    const existing = rackLines.get(key)
    if (existing) existing.count += 1
    else rackLines.set(key, { slots: plan.tubeCount, calibersMm, count: 1 })
    for (const g of plan.groups) {
      mortarTubesByCaliber[g.caliberMm] = (mortarTubesByCaliber[g.caliberMm] ?? 0) + g.tubeCount
    }
  }
  const racks = [...rackLines.values()].sort(
    (a, b) => a.slots - b.slots || a.calibersMm.join(',').localeCompare(b.calibersMm.join(',')),
  )

  // Igniters: one per pyro cue (whether or not it maps to a known rack).
  let igniters = 0
  const fabCounts = new Map<FabricationKind, number>()
  for (const cue of compiled.cues) {
    if (cue.medium === 'pyro') igniters += 1
    if (cue.medium === 'fabrication') {
      const eff = getEffect(cue.effectId)
      if (eff && eff.medium === 'fabrication') {
        fabCounts.set(eff.kind, (fabCounts.get(eff.kind) ?? 0) + 1)
      }
    }
  }
  const fabricationPieces = [...fabCounts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => a.kind.localeCompare(b.kind))

  // Panels grouped by pixel dimensions; drones and lasers from site assets.
  const panelLines = new Map<string, BomPanelLine & { count: number }>()
  let flying = 0
  let lasers = 0
  for (const asset of site.assets) {
    if (asset.kind === 'panel' && asset.panel) {
      const { wPx, hPx } = asset.panel
      const key = `${wPx}x${hPx}`
      const existing = panelLines.get(key)
      if (existing) existing.count += 1
      else panelLines.set(key, { wPx, hPx, count: 1 })
    } else if (asset.kind === 'dronePad' && asset.fleet) {
      flying += asset.fleet.count
    } else if (asset.kind === 'laserTower') {
      lasers += 1
    }
  }
  const panels = [...panelLines.values()].sort((a, b) => a.wPx - b.wPx || a.hPx - b.hPx)

  return {
    racks,
    mortarTubesByCaliber,
    igniters,
    panels,
    drones: {
      flying,
      sparesPct: DRONE_SPARES_PCT,
      // Integer-safe ceil(flying * 1.15): avoid float noise near whole numbers.
      total: Math.ceil((flying * (100 + DRONE_SPARES_PCT)) / 100),
    },
    lasers,
    fabricationPieces,
  }
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|')
}

/** Render the BOM as a single markdown table (deterministic row order). */
export function bomMarkdown(bom: Bom): string {
  const rows: [string, string, number][] = []
  for (const r of bom.racks) {
    rows.push(['mortar rack', `${r.slots} slots (${r.calibersMm.join(', ')} mm)`, r.count])
  }
  // Numeric Record keys iterate in ascending integer order — deterministic.
  for (const caliber of Object.keys(bom.mortarTubesByCaliber)) {
    rows.push([
      'mortar tube',
      `${caliber} mm caliber, single-shot`,
      bom.mortarTubesByCaliber[Number(caliber)]!,
    ])
  }
  rows.push(['igniter', 'one per pyro cue', bom.igniters])
  for (const p of bom.panels) {
    rows.push(['pixel panel', `${p.wPx}x${p.hPx} px`, p.count])
  }
  rows.push(['drone', `${bom.drones.flying} flying + ${bom.drones.sparesPct}% spares`, bom.drones.total])
  rows.push(['laser projector', 'one per tower', bom.lasers])
  for (const f of bom.fabricationPieces) {
    rows.push(['set piece', f.kind, f.count])
  }

  const lines = ['| item | spec | qty |', '| --- | --- | ---: |']
  for (const [item, spec, qty] of rows) {
    lines.push(`| ${mdEscape(item)} | ${mdEscape(spec)} | ${qty} |`)
  }
  return lines.join('\n') + '\n'
}
