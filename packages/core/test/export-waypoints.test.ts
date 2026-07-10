import { describe, expect, it } from 'vitest'
import { CSV_EOL, droneWaypointsCsv, droneWaypointsJson, type DroneCuePlan } from '../src/export/index.js'
import type { MorphPlan } from '../src/contracts.js'

function plan(paths: { droneId: number; path: { x: number; y: number; z: number }[] }[]): MorphPlan {
  return {
    assignment: paths.map((_, i) => i),
    maxPathLenM: 10,
    minTransitionSec: 3,
    feasible: true,
    waypoints: paths,
  }
}

const cue1: DroneCuePlan = {
  cueId: 'c1',
  startSec: 10,
  transitionSec: 4,
  rgb: [1, 0.5, 0],
  plan: plan([
    {
      droneId: 0,
      path: [
        { x: 0, y: 0, z: 10 },
        { x: 5, y: 0, z: 12 },
        { x: 10, y: 0, z: 14 },
      ],
    },
    {
      droneId: 1,
      path: [
        { x: 0, y: 5, z: 10 },
        { x: 10, y: 5, z: 14 },
      ],
    },
  ]),
}

function rows(csv: string): string[][] {
  const lines = csv.split(CSV_EOL)
  expect(lines[lines.length - 1]).toBe('')
  return lines.slice(0, -1).map((l) => l.split(','))
}

describe('droneWaypointsCsv', () => {
  it('row count = sum of path points + one delayed-start hold row per drone', () => {
    const body = rows(droneWaypointsCsv([cue1]))
    expect(body[0]).toEqual(['droneId', 'tSec', 'x', 'y', 'z', 'r', 'g', 'b'])
    // paths: 3 + 2 = 5 points, + 2 hold rows (one per drone) = 7 data rows.
    expect(body.length - 1).toBe(5 + 2)
  })

  it('duplicates the first waypoint to hold until startSec + 0.1*transition', () => {
    const body = rows(droneWaypointsCsv([cue1])).slice(1)
    const d0 = body.filter((r) => r[0] === '0')
    expect(d0.map((r) => r[1])).toEqual(['10.000', '10.400', '12.200', '14.000'])
    // Hold rows share the first waypoint's position.
    expect(d0[0]!.slice(2, 5)).toEqual(['0.000', '0.000', '10.000'])
    expect(d0[1]!.slice(2, 5)).toEqual(['0.000', '0.000', '10.000'])
    // Remaining points spread uniformly, arriving exactly at startSec + T.
    expect(d0[3]!.slice(2, 5)).toEqual(['10.000', '0.000', '14.000'])
    const d1 = body.filter((r) => r[0] === '1')
    expect(d1.map((r) => r[1])).toEqual(['10.000', '10.400', '14.000'])
  })

  it('applies the cue rgb to every row and defaults to white', () => {
    const body = rows(droneWaypointsCsv([cue1])).slice(1)
    for (const r of body) expect(r.slice(5)).toEqual(['1.000', '0.500', '0.000'])
    const noRgb = rows(droneWaypointsCsv([{ ...cue1, rgb: undefined }])).slice(1)
    for (const r of noRgb) expect(r.slice(5)).toEqual(['1.000', '1.000', '1.000'])
  })

  it('sorts rows by droneId then time across multiple plans', () => {
    const cue2: DroneCuePlan = {
      cueId: 'c2',
      startSec: 20,
      transitionSec: 2,
      plan: plan([{ droneId: 0, path: [{ x: 10, y: 0, z: 14 }, { x: 0, y: 0, z: 20 }] }]),
    }
    const body = rows(droneWaypointsCsv([cue1, cue2])).slice(1)
    const ids = body.map((r) => Number(r[0]))
    expect([...ids].sort((a, b) => a - b)).toEqual(ids)
    const d0Times = body.filter((r) => r[0] === '0').map((r) => Number(r[1]))
    expect([...d0Times].sort((a, b) => a - b)).toEqual(d0Times)
    expect(d0Times).toContain(20) // cue2 hold start
    expect(d0Times).toContain(22) // cue2 arrival
  })

  it('emits two rows for a single-point path (hold + duplicate only)', () => {
    const single: DroneCuePlan = {
      cueId: 'c3',
      startSec: 5,
      transitionSec: 3,
      plan: plan([{ droneId: 2, path: [{ x: 1, y: 2, z: 3 }] }]),
    }
    const body = rows(droneWaypointsCsv([single])).slice(1)
    expect(body.length).toBe(2)
    expect(body.map((r) => r[1])).toEqual(['5.000', '5.300'])
  })

  it('is deterministic across runs', () => {
    expect(droneWaypointsCsv([cue1])).toBe(droneWaypointsCsv([cue1]))
  })
})

describe('droneWaypointsJson', () => {
  it('emits parseable JSON grouped per drone with the same hold convention', () => {
    const doc = JSON.parse(droneWaypointsJson([cue1])) as {
      format: string
      version: number
      cueIds: string[]
      drones: { droneId: number; waypoints: { tSec: number; x: number; z: number }[] }[]
    }
    expect(doc.format).toBe('theodoor-drone-waypoints')
    expect(doc.version).toBe(1)
    expect(doc.cueIds).toEqual(['c1'])
    expect(doc.drones.map((d) => d.droneId)).toEqual([0, 1])
    expect(doc.drones[0]!.waypoints.map((w) => w.tSec)).toEqual([10, 10.4, 12.2, 14])
    expect(doc.drones[1]!.waypoints.length).toBe(3)
    expect(doc.drones[0]!.waypoints[3]).toEqual({ tSec: 14, x: 10, y: 0, z: 14, r: 1, g: 0.5, b: 0 })
  })

  it('matches the CSV row count', () => {
    const doc = JSON.parse(droneWaypointsJson([cue1])) as { drones: { waypoints: unknown[] }[] }
    const total = doc.drones.reduce((n, d) => n + d.waypoints.length, 0)
    expect(total).toBe(7)
  })
})
