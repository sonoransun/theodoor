/**
 * export/beamSteering — golden-byte tests.
 *
 * Fixture: the same showBuilder shape export-crowd.test.ts uses (lakesidePark,
 * 1 crowd flood + 2 beam cues on beam-south-west). A static whisper collapses
 * to exactly start+stop (all keyframes drop at 2-dp resolution); the flyover
 * sweeps a 3-cell path so its keyframes move. Expected pan/tilt strings are
 * computed in-test from acoustics/beams.ts and compared as exact bytes.
 */

import { describe, expect, it } from 'vitest'
import { SPEED_OF_SOUND_MPS } from '../src/contracts.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { crowdGridFor, lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { beamAimAt, sourceGroundResolver } from '../src/acoustics/beams.js'
import { SimEngine } from '../src/sim/index.js'
import {
  BEAM_STEERING_COLUMNS,
  BEAM_STEERING_FORMAT,
  beamSteeringCsv,
  beamSteeringEvents,
  beamSteeringJson,
} from '../src/export/index.js'
import { makeCompiled } from './sim-fixture.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const site = lakesidePark()
const grid = crowdGridFor(site)!
const southWest = site.assets.find((a) => a.id === 'beam-south-west')!

function buildFixture() {
  const score = getScore('odeToJoy')!
  const tl = buildTimelineFromScore(score)
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'export-cb',
    title: 'Export Crowd Beam',
    seed: 42,
    site: lakesidePark(),
    catalog,
  })
    .score(score)
    .preRoll(6)
  b.crowd.flood({
    effect: 'crowd-flood-rgb',
    position: 'mast-west',
    from: m.barBeat(3, 1),
    rgb: [1, 0, 0],
  })
  b.beams
    .whisper({
      effect: 'beam-whisper-narration',
      position: 'beam-south-west',
      target: 267,
      land: m.barBeat(3, 1),
    })
    .flyover({
      effect: 'beam-flyover-whoosh',
      position: 'beam-south-west',
      path: [266, 267, 268],
      land: m.barBeat(11, 1),
    })
  return b.build().compiled
}

const compiled = buildFixture()
const whisper = compiled.cues.find((c) => c.effectId === 'beam-whisper-narration')!
const flyover = compiled.cues.find((c) => c.effectId === 'beam-flyover-whoosh')!

function csvRows(csv: string): string[] {
  const lines = csv.split('\r\n')
  expect(lines.at(-1)).toBe('') // trailing CRLF
  return lines.slice(0, -1)
}

describe('beamSteeringEvents', () => {
  const events = beamSteeringEvents(compiled, getEffect)

  it('fixture compiles clean and fires beam cues one time-of-flight early', () => {
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const aim = beamAimAt(southWest, grid.cells[267]!.centroid)
    expect(whisper.fireSec).toBeCloseTo(whisper.targetSec - aim.slantM / SPEED_OF_SOUND_MPS, 6)
  })

  it('a static whisper collapses to exactly start + stop', () => {
    const rows = events.filter((e) => e.cueId === whisper.id)
    expect(rows.map((e) => e.eventType)).toEqual(['start', 'stop'])
    const aim = beamAimAt(southWest, grid.cells[267]!.centroid)
    for (const e of rows) {
      expect(e.arrayId).toBe('beam-south-west')
      expect(e.panDeg).toBe(Number(aim.panDeg.toFixed(2)))
      expect(e.tiltDeg).toBe(Number(aim.tiltDeg.toFixed(2)))
      expect(e.gainDb).toBe(0)
      expect(e.audibleDb).toBe(66) // beam-whisper-narration noiseDbAt15m
      expect(e.programRef).toBe('beam-whisper-narration')
      expect(e.pairId).toBeUndefined()
      expect(e.role).toBeUndefined()
    }
    expect(rows[0]!.tSec).toBe(whisper.fireSec) // start AT fireSec: honest schedule
    expect(rows[1]!.tSec).toBe(whisper.targetSec + whisper.durationSec)
  })

  it('the flyover sweeps: start at path[0], stop at path[end], moving keyframes between', () => {
    const rows = events.filter((e) => e.cueId === flyover.id)
    expect(rows[0]!.eventType).toBe('start')
    expect(rows.at(-1)!.eventType).toBe('stop')
    const aimStart = beamAimAt(southWest, grid.cells[266]!.centroid)
    const aimEnd = beamAimAt(southWest, grid.cells[268]!.centroid)
    expect(rows[0]!.tSec).toBe(flyover.fireSec)
    expect(rows[0]!.panDeg).toBe(Number(aimStart.panDeg.toFixed(2)))
    expect(rows.at(-1)!.tSec).toBe(flyover.targetSec + flyover.durationSec)
    expect(rows.at(-1)!.panDeg).toBe(Number(aimEnd.panDeg.toFixed(2)))

    // Keyframes sit on the 20 Hz grid strictly inside the window and drop
    // consecutive repeats: every kept keyframe moved at 2-dp resolution.
    const keys = rows.filter((e) => e.eventType === 'keyframe')
    expect(keys.length).toBeGreaterThan(10)
    let prev = rows[0]!
    for (const k of keys) {
      expect(Math.round(k.tSec * 20)).toBeCloseTo(k.tSec * 20, 9)
      expect(k.tSec).toBeGreaterThan(flyover.fireSec)
      expect(k.tSec).toBeLessThan(flyover.targetSec + flyover.durationSec)
      expect(k.panDeg !== prev.panDeg || k.tiltDeg !== prev.tiltDeg).toBe(true)
      prev = k
    }
  })

  it('orders by (tSec, arrayId, start < keyframe < stop, cueId)', () => {
    const rank = { start: 0, keyframe: 1, stop: 2 } as const
    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1]!
      const b = events[i]!
      const cmp =
        a.tSec - b.tSec ||
        a.arrayId.localeCompare(b.arrayId) ||
        rank[a.eventType] - rank[b.eventType] ||
        a.cueId.localeCompare(b.cueId)
      expect(cmp).toBeLessThanOrEqual(0)
    }
  })

  it('throws on a non-positive keyframeHz', () => {
    expect(() => beamSteeringEvents(compiled, getEffect, 0)).toThrow(/keyframeHz/)
    expect(() => beamSteeringCsv(compiled, getEffect, -1)).toThrow(/keyframeHz/)
  })
})

describe('beamSteeringEvents — sourceTag ground tracking', () => {
  const round2 = (v: number): number => Number(v.toFixed(2))
  const fallback = grid.cells.find((c) => c.row === 8 && c.col === 1)!
  // Drone d1 holds its formation over [18, 28); the beam (window [7.95, 20))
  // tags it and must jump from the fallback cell to the formation's ground
  // centroid when the source goes active — in the EXPORT and the SIM alike.
  const tagged = makeCompiled(
    [
      { id: 'd1', trackId: 'trk-drone', medium: 'drone', effectId: 'ring-formation-60',
        positionId: 'pad-1', targetSec: 18, anticipationSec: 0, durationSec: 10,
        params: { count: 24, scaleM: 30 } },
      { id: 'b1', trackId: 'trk-beam', medium: 'beam', effectId: 'beam-tag-drone',
        positionId: 'beam-south-west', targetSec: 8, anticipationSec: 0.05, durationSec: 12,
        params: { sourceCueId: 'd1', targetCellId: fallback.index } },
    ],
    { fleet: { count: 24, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 } },
  )
  const b1 = tagged.cues.find((c) => c.id === 'b1')!
  const rows = beamSteeringEvents(tagged, getEffect).filter((e) => e.cueId === 'b1')

  it('starts on the fallback aim while the source window is not yet active', () => {
    const fallbackAim = beamAimAt(southWest, fallback.centroid)
    expect(rows[0]!.eventType).toBe('start')
    expect(rows[0]!.panDeg).toBe(round2(fallbackAim.panDeg))
    expect(rows[0]!.tiltDeg).toBe(round2(fallbackAim.tiltDeg))
  })

  it('keyframes retarget to the tagged source ground — the SAME aim the sim renders', () => {
    const engine = new SimEngine(tagged)
    engine.advanceTo(19) // inside both the beam window and the source window
    const simAim = beamAimAt(southWest, engine.snapshot().beams[0]!.target)
    const key = rows.find((e) => e.eventType === 'keyframe' && e.tSec >= 18)
    expect(key).toBeDefined()
    expect(key!.panDeg).toBe(round2(simAim.panDeg))
    expect(key!.tiltDeg).toBe(round2(simAim.tiltDeg))
    // The retarget is real: it moved off the fallback aim.
    const fallbackAim = beamAimAt(southWest, fallback.centroid)
    expect(
      key!.panDeg !== round2(fallbackAim.panDeg) || key!.tiltDeg !== round2(fallbackAim.tiltDeg),
    ).toBe(true)
    // …and matches the single-owner resolver's ground exactly.
    const ground = sourceGroundResolver(tagged, getEffect)(b1, 19)!
    const srcAim = beamAimAt(southWest, ground)
    expect(key!.panDeg).toBe(round2(srcAim.panDeg))
    expect(key!.tiltDeg).toBe(round2(srcAim.tiltDeg))
  })

  it('the stop event (source still active at the window end) holds the source aim', () => {
    const stop = rows.at(-1)!
    expect(stop.eventType).toBe('stop')
    const ground = sourceGroundResolver(tagged, getEffect)(b1, stop.tSec)!
    const srcAim = beamAimAt(southWest, ground)
    expect(stop.panDeg).toBe(round2(srcAim.panDeg))
    expect(stop.tiltDeg).toBe(round2(srcAim.tiltDeg))
  })
})

describe('beamSteeringCsv', () => {
  const csv = beamSteeringCsv(compiled, getEffect)
  const rows = csvRows(csv)

  it('golden header and exact whisper start/stop rows', () => {
    expect(rows[0]).toBe(BEAM_STEERING_COLUMNS.join(','))
    expect(rows[0]).toBe('tSec,arrayId,eventType,panDeg,tiltDeg,gainDb,audibleDb,programRef,cueId,pairId,role')
    const aim = beamAimAt(southWest, grid.cells[267]!.centroid)
    const pan = aim.panDeg.toFixed(2)
    const tilt = aim.tiltDeg.toFixed(2)
    expect(rows).toContain(
      `${whisper.fireSec.toFixed(3)},beam-south-west,start,${pan},${tilt},0.0,66.0,` +
        `beam-whisper-narration,${whisper.id},,`,
    )
    expect(rows).toContain(
      `${(whisper.targetSec + whisper.durationSec).toFixed(3)},beam-south-west,stop,` +
        `${pan},${tilt},0.0,66.0,beam-whisper-narration,${whisper.id},,`,
    )
  })

  it('one row per event, byte-identical across calls', () => {
    expect(rows).toHaveLength(beamSteeringEvents(compiled, getEffect).length + 1)
    expect(beamSteeringCsv(compiled, getEffect)).toBe(csv)
  })

  it('guards spreadsheet injection on cueId (and other free-text columns)', () => {
    const tricky = makeCompiled([
      { id: '=HYPERLINK("x")', trackId: 'trk-beam', medium: 'beam',
        effectId: 'beam-whisper-narration', positionId: 'beam-south-west',
        targetSec: 10, anticipationSec: 0.06, durationSec: 12,
        params: { targetCellId: 267, gainDb: -2 } },
    ])
    const trows = csvRows(beamSteeringCsv(tricky, getEffect))
    expect(trows).toHaveLength(3) // header + start + stop (static target)
    // Guarded (leading ') THEN RFC-4180-quoted (the id contains quotes).
    expect(trows[1]).toContain(`,"'=HYPERLINK`)
    expect(trows[1]!.includes(',=HYPERLINK')).toBe(false)
    // gainDb rides both the gain column and the audible level (66 - 2).
    expect(trows[1]).toContain(',-2.0,64.0,')
  })
})

describe('beamSteeringJson', () => {
  interface EventJson {
    tSec: number
    eventType: string
    panDeg: number
    tiltDeg: number
    gainDb: number
    audibleDb: number
    programRef: string
    cueId: string
    pairId?: string
    role?: string
  }

  it('carries the format tag, speed of sound, and per-array event lists', () => {
    const doc = JSON.parse(beamSteeringJson(compiled, getEffect)) as {
      format: string
      version: number
      speedOfSoundMps: number
      keyframeHz: number
      arrays: { arrayId: string; events: EventJson[] }[]
    }
    expect(doc.format).toBe(BEAM_STEERING_FORMAT)
    expect(doc.format).toBe('theodoor-beam-steering')
    expect(doc.version).toBe(1)
    expect(doc.speedOfSoundMps).toBe(343)
    expect(doc.keyframeHz).toBe(20)
    expect(doc.arrays.map((a) => a.arrayId)).toEqual(['beam-south-west'])
    const events = doc.arrays[0]!.events
    expect(events).toHaveLength(beamSteeringEvents(compiled, getEffect).length)
    // Same schedule as the CSV: first whisper event at fireSec.
    const first = events.find((e) => e.cueId === whisper.id)!
    expect(first.eventType).toBe('start')
    expect(first.tSec).toBeCloseTo(whisper.fireSec, 3)
    expect(first.audibleDb).toBe(66)
    expect(first.programRef).toBe('beam-whisper-narration')
  })

  it('stereo params (pairId, role, extraDelay pattern) survive into events', () => {
    const stereo = makeCompiled([
      { id: 'sL', trackId: 'trk-beam', medium: 'beam', effectId: 'beam-whisper-narration',
        positionId: 'beam-south-west', targetSec: 10, anticipationSec: 0.06, durationSec: 12,
        params: { targetCellId: 267, pairId: 'bed-1', role: 'L' } },
    ])
    const doc = JSON.parse(beamSteeringJson(stereo, getEffect)) as {
      arrays: { arrayId: string; events: EventJson[] }[]
    }
    for (const e of doc.arrays[0]!.events) {
      expect(e.pairId).toBe('bed-1')
      expect(e.role).toBe('L')
    }
    const rows = csvRows(beamSteeringCsv(stereo, getEffect))
    expect(rows[1]!.endsWith(',bed-1,L')).toBe(true)
  })
})
