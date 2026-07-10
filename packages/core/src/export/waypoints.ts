/**
 * export/waypoints.ts — per-drone timed waypoint exports (CSV + JSON).
 *
 * PURE string builders over MorphPlan paths. Timing convention per plan:
 * every drone emits its FIRST waypoint twice — once at `startSec` and once
 * at `startSec + HOLD_FRACTION * transitionSec` (the delayed-start hold: the
 * drone parks on station while stragglers finish the previous formation).
 * The remaining path points are spread uniformly over the rest of the
 * transition, arriving exactly at `startSec + transitionSec`.
 */

import type { MorphPlan, Seconds } from '../contracts.js'
import { csvDocument, type CsvField } from './csv.js'

/** Fraction of the transition spent holding on the duplicated first waypoint. */
export const WAYPOINT_HOLD_FRACTION = 0.1

export interface DroneCuePlan {
  cueId: string
  startSec: Seconds
  transitionSec: Seconds
  plan: MorphPlan
  /** 0..1 per channel; applied to every waypoint of the cue. Default white. */
  rgb?: readonly [number, number, number]
}

export interface DroneWaypointRow {
  droneId: number
  tSec: Seconds
  x: number
  y: number
  z: number
  r: number
  g: number
  b: number
}

export const DRONE_WAYPOINT_COLUMNS = ['droneId', 'tSec', 'x', 'y', 'z', 'r', 'g', 'b'] as const

/**
 * Flatten plans into timed rows, sorted by (droneId, tSec, plan order).
 * Row count = Σ path points + one delayed-start hold row per drone per plan.
 */
export function droneWaypointRows(plans: readonly DroneCuePlan[]): DroneWaypointRow[] {
  const rows: DroneWaypointRow[] = []
  for (const cue of plans) {
    const [r, g, b] = cue.rgb ?? [1, 1, 1]
    const holdSec = WAYPOINT_HOLD_FRACTION * cue.transitionSec
    for (const wp of cue.plan.waypoints) {
      const path = wp.path
      const n = path.length
      if (n === 0) continue
      const first = path[0]
      // Hold: first waypoint duplicated at startSec and at startSec + 0.1*T.
      rows.push({ droneId: wp.droneId, tSec: cue.startSec, x: first.x, y: first.y, z: first.z, r, g, b })
      rows.push({ droneId: wp.droneId, tSec: cue.startSec + holdSec, x: first.x, y: first.y, z: first.z, r, g, b })
      for (let i = 1; i < n; i++) {
        const p = path[i]
        const tSec = cue.startSec + holdSec + (i / (n - 1)) * (cue.transitionSec - holdSec)
        rows.push({ droneId: wp.droneId, tSec, x: p.x, y: p.y, z: p.z, r, g, b })
      }
    }
  }
  // Stable sort: plans are pushed in caller order, so equal keys keep it.
  return rows.sort((a, b) => a.droneId - b.droneId || a.tSec - b.tSec)
}

/** CSV: droneId,tSec,x,y,z,r,g,b — times/coords/colors fixed(3). */
export function droneWaypointsCsv(plans: readonly DroneCuePlan[]): string {
  const rows: CsvField[][] = [[...DRONE_WAYPOINT_COLUMNS]]
  for (const row of droneWaypointRows(plans)) {
    rows.push([
      row.droneId,
      row.tSec.toFixed(3),
      row.x.toFixed(3),
      row.y.toFixed(3),
      row.z.toFixed(3),
      row.r.toFixed(3),
      row.g.toFixed(3),
      row.b.toFixed(3),
    ])
  }
  return csvDocument(rows)
}

const round3 = (v: number): number => Number(v.toFixed(3))

/** JSON: `{ format, version, cueIds, drones: [{ droneId, waypoints }] }`. */
export function droneWaypointsJson(plans: readonly DroneCuePlan[]): string {
  const byDrone = new Map<number, DroneWaypointRow[]>()
  for (const row of droneWaypointRows(plans)) {
    const list = byDrone.get(row.droneId)
    if (list) list.push(row)
    else byDrone.set(row.droneId, [row])
  }
  const drones = [...byDrone.keys()]
    .sort((a, b) => a - b)
    .map((droneId) => ({
      droneId,
      waypoints: byDrone.get(droneId)!.map((row) => ({
        tSec: round3(row.tSec),
        x: round3(row.x),
        y: round3(row.y),
        z: round3(row.z),
        r: round3(row.r),
        g: round3(row.g),
        b: round3(row.b),
      })),
    }))
  return JSON.stringify(
    {
      format: 'theodoor-drone-waypoints',
      version: 1,
      cueIds: plans.map((p) => p.cueId),
      drones,
    },
    null,
    2,
  )
}
