/**
 * export/crowdBroadcast — golden-byte tests.
 *
 * Two fixtures:
 *  - a showBuilder show on lakesidePark (1 crowd flood + 2 beam cues, the
 *    same shape export-beams.test.ts uses) exercises the solver-timed path;
 *    assertions derive expected strings from the compiled cue's own times,
 *    then compare exact bytes.
 *  - hand-written compiled shows (sim-fixture makeCompiled) pin fully
 *    hand-computable literals: haptic PULSE rows, mask encodings, the .bin
 *    layout, injection guarding, and coverage masking.
 */

import { describe, expect, it } from 'vitest'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { coveredCellIndices, crowdGridFor, lakesidePark } from '../src/site/index.js'
import { getScore } from '../src/music/index.js'
import { buildTimelineFromScore } from '../src/music/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import {
  CROWD_BROADCAST_COLUMNS,
  CROWD_BROADCAST_FORMAT,
  cellMaskBytes,
  cellMaskHex,
  crowdBroadcastBin,
  crowdBroadcastCsv,
  crowdBroadcastFrames,
  crowdBroadcastIndexJson,
  crowdBroadcastMastLoads,
  crowdBroadcastOverruns,
  type CrowdBroadcastFrame,
  type CrowdBroadcastMast,
} from '../src/export/index.js'
import { crowdBandwidth } from '../src/choreo/index.js'
import type { SitePlan } from '../src/contracts.js'
import { makeCompiled } from './sim-fixture.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)

/** All 342 lakeside cells set: cells 340/341 land in the top (last) nibble. */
const ALL_CELLS_MASK = '3' + 'f'.repeat(85)

/**
 * lakesidePark with the masts pinned to a 30 frames/s budget: the golden
 * rows/bytes below were hand-computed on the 30 Hz transmit grid, and the
 * overrun pair needs an intentionally undersized cap — both independent of
 * the venue's real broadcast-class headroom (1500 frames/s).
 */
function pinned30(): SitePlan {
  const base = lakesidePark()
  return {
    ...base,
    assets: base.assets.map((a) =>
      a.crowdMast ? { ...a, crowdMast: { ...a.crowdMast, framesPerSec: 30 } } : a,
    ),
  }
}

function buildFixture() {
  const score = getScore('odeToJoy')!
  const tl = buildTimelineFromScore(score)
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'export-cb',
    title: 'Export Crowd Beam',
    seed: 42,
    site: pinned30(),
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

function csvRows(csv: string): string[] {
  const lines = csv.split('\r\n')
  expect(lines.at(-1)).toBe('') // trailing CRLF
  return lines.slice(0, -1)
}

/** Decode a mask hex string back to ascending compact cell indices. */
function maskCells(hex: string): number[] {
  const out: number[] = []
  for (let j = 0; j < hex.length; j++) {
    const v = parseInt(hex[hex.length - 1 - j]!, 16)
    for (let b = 0; b < 4; b++) if (v & (1 << b)) out.push(j * 4 + b)
  }
  return out
}

describe('cellMaskHex / cellMaskBytes', () => {
  it('LSB-first: cell 0 is the least significant bit of the LAST hex char', () => {
    expect(cellMaskHex([0], 342)).toBe('0'.repeat(85) + '1')
    expect(cellMaskHex([1], 342)).toBe('0'.repeat(85) + '2')
    expect(cellMaskHex([4], 342)).toBe('0'.repeat(84) + '10')
    expect(cellMaskHex([341], 342)).toBe('2' + '0'.repeat(85))
    expect(cellMaskHex([], 342)).toBe('0'.repeat(86))
    expect(cellMaskHex([0, 1, 2, 3], 8)).toBe('0f')
  })

  it('pads to ceil(cellCount/4) nibbles and round-trips through the decoder', () => {
    expect(cellMaskHex([], 342)).toHaveLength(86) // ceil(342/4)
    const cells = [0, 7, 33, 128, 341]
    expect(maskCells(cellMaskHex(cells, 342))).toEqual(cells)
  })

  it('bytes: byte k bit b is cell 8k+b, ceil(cellCount/8) bytes long', () => {
    expect([...cellMaskBytes([0], 16)]).toEqual([1, 0])
    expect([...cellMaskBytes([8], 16)]).toEqual([0, 1])
    expect([...cellMaskBytes([7, 15], 16)]).toEqual([0x80, 0x80])
    expect(cellMaskBytes([], 342)).toHaveLength(43)
    const all = cellMaskBytes(Array.from({ length: 342 }, (_, i) => i), 342)
    expect(all[0]).toBe(0xff)
    expect(all[41]).toBe(0xff)
    expect(all[42]).toBe(0x3f) // cells 336..341 → bits 0..5
  })

  it('throws on out-of-range cell indices', () => {
    expect(() => cellMaskHex([342], 342)).toThrow(/out of/)
    expect(() => cellMaskBytes([-1], 342)).toThrow(/out of/)
  })
})

describe('crowdBroadcastFrames — haptic PULSE schedule (hand-computed)', () => {
  // crowd-haptic-thump: maskUpdateHz 4, durationSec 4. Window [4.92, 9):
  // pulses at 4.92 + k/4 for k = 0..16 (17 pulses), snapped to the 30 Hz grid.
  const compiled = makeCompiled(
    [
      { id: 'h1', trackId: 'trk-crowd', medium: 'crowd', effectId: 'crowd-haptic-thump',
        positionId: 'mast-east', targetSec: 5, anticipationSec: 0.08, durationSec: 4 },
    ],
    { site: pinned30() },
  )

  it('emits one PULSE per maskUpdateHz slot across [fireSec, end)', () => {
    const b = crowdBroadcastFrames(compiled, getEffect)
    expect(b.cellCount).toBe(342)
    expect(b.grid).toEqual({ rows: 9, cols: 38, cellSizeM: 8 })
    expect(b.masts).toEqual([
      { mastId: 'mast-west', mastIndex: 0, framesPerSec: 30 },
      { mastId: 'mast-east', mastIndex: 1, framesPerSec: 30 },
    ])
    expect(b.frames).toHaveLength(17)
    for (const f of b.frames) {
      expect(f.frameType).toBe('PULSE')
      expect(f.mastId).toBe('mast-east')
      expect(f.mastIndex).toBe(1)
      expect([f.r, f.g, f.b]).toEqual([0, 0, 0])
      expect(f.intensity).toBe(255)
      expect(f.rampMs).toBe(0)
      expect(f.cueIds).toEqual(['h1'])
      expect(f.cells).toHaveLength(342) // whole covered canvas thumps
    }
    // Snapped transmit times: round(round((4.92 + k/4)·30)/30·1000).
    expect(b.frames[0]!.tMs).toBe(4933)
    expect(b.frames[1]!.tMs).toBe(5167)
    expect(b.frames.at(-1)!.tMs).toBe(8933)
  })

  it('CSV: exact golden rows', () => {
    const rows = csvRows(crowdBroadcastCsv(compiled, getEffect))
    expect(rows[0]).toBe(CROWD_BROADCAST_COLUMNS.join(','))
    expect(rows[0]).toBe('tSec,mastId,frameType,cellMaskHex,r,g,b,intensity,rampMs,cueIds')
    expect(rows).toHaveLength(18)
    expect(rows[1]).toBe(`4.933,mast-east,PULSE,${ALL_CELLS_MASK},0,0,0,255,0,h1`)
    expect(rows[2]).toBe(`5.167,mast-east,PULSE,${ALL_CELLS_MASK},0,0,0,255,0,h1`)
    expect(rows[17]).toBe(`8.933,mast-east,PULSE,${ALL_CELLS_MASK},0,0,0,255,0,h1`)
  })

  it('.bin: exact golden bytes for the first length-prefixed record', () => {
    const bin = crowdBroadcastBin(compiled, getEffect)
    // Record = u32 length prefix + payload (12 + ceil(342/8)=43 mask bytes).
    expect(bin).toHaveLength(17 * (4 + 55))
    expect([...bin.slice(0, 4)]).toEqual([0, 0, 0, 55]) // payload length BE
    expect([...bin.slice(4, 8)]).toEqual([0x00, 0x00, 0x13, 0x45]) // tMs 4933 BE
    expect(bin[8]).toBe(1) // mastIndex: mast-east
    expect(bin[9]).toBe(1) // frameType PULSE
    expect([...bin.slice(10, 14)]).toEqual([0, 0, 0, 255]) // r g b intensity
    expect([...bin.slice(14, 16)]).toEqual([0, 0]) // rampMs
    expect(bin[16]).toBe(0xff) // mask byte 0 (cells 0..7)
    expect(bin[16 + 42]).toBe(0x3f) // mask byte 42 (cells 336..341)
  })

  it('index JSON carries the format tag, grid, masts, and per-frame extents', () => {
    const idx = JSON.parse(crowdBroadcastIndexJson(compiled, getEffect)) as {
      format: string
      version: number
      cellCount: number
      grid: { rows: number; cols: number; cellSizeM: number }
      masts: { mastId: string; mastIndex: number; framesPerSec: number; peakFramesPerSec: number }[]
      frames: { tSec: number; byteOffset: number; byteLength: number }[]
    }
    expect(idx.format).toBe(CROWD_BROADCAST_FORMAT)
    expect(idx.format).toBe('theodoor-crowd-broadcast')
    expect(idx.version).toBe(1)
    expect(idx.cellCount).toBe(342)
    expect(idx.grid).toEqual({ rows: 9, cols: 38, cellSizeM: 8 })
    expect(idx.masts).toHaveLength(2)
    // Each mast reports its worst rolling-1s scheduled load beside its cap.
    expect(idx.masts).toEqual([
      { mastId: 'mast-west', mastIndex: 0, framesPerSec: 30, peakFramesPerSec: 0 },
      { mastId: 'mast-east', mastIndex: 1, framesPerSec: 30, peakFramesPerSec: 4 },
    ])
    expect(idx.frames[0]).toEqual({ tSec: 4.933, byteOffset: 0, byteLength: 59 })
    expect(idx.frames[1]).toEqual({ tSec: 5.167, byteOffset: 59, byteLength: 59 })
    expect(idx.frames).toHaveLength(17)
  })
})

describe('crowdBroadcast — showBuilder fixture (flood on mast-west)', () => {
  const compiled = buildFixture()
  const crowdCue = compiled.cues.find((c) => c.medium === 'crowd')!

  it('fixture compiles clean', () => {
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('streams the latency ramp-in, diff-skips the steady state, and clears at the end', () => {
    const rows = csvRows(crowdBroadcastCsv(compiled, getEffect))
    const rate = 30
    const kStart = Math.ceil(Math.max(0, crowdCue.fireSec) * rate - 1e-9)
    const kEnd = Math.ceil((crowdCue.targetSec + crowdCue.durationSec) * rate - 1e-9)

    // First frame on the first grid tick at/after fireSec.
    const firstT = (Math.round((kStart / rate) * 1000) / 1000).toFixed(3)
    expect(rows[1]!.startsWith(`${firstT},mast-west,SET,`)).toBe(true)

    // The flood saturates within the wristband latency envelope (120 ms), so
    // steady-state ticks diff-skip entirely: of the ~242 grid ticks in the
    // window only the ramp-in ticks plus the clearing tick emit frames.
    const distinctTicks = new Set(rows.slice(1).map((r) => r.split(',')[0]!))
    expect(distinctTicks.size).toBeLessThanOrEqual(8)
    expect(distinctTicks.size).toBeLessThan((kEnd - kStart) / 4)

    // Exact clearing frame: every cell drops to (0,0,0,0) one tick past the
    // window; no cue is active, so cueIds is empty.
    const lastT = (Math.round((kEnd / rate) * 1000) / 1000).toFixed(3)
    expect(rows.at(-1)).toBe(`${lastT},mast-west,SET,${ALL_CELLS_MASK},0,0,0,0,33,`)

    // Flood rgb [1,0,0]: every SET frame has g = b = intensity = 0 and rides
    // mast-west with the cue id (except the clearing frame).
    for (const row of rows.slice(1, -1)) {
      const f = row.split(',')
      expect(f[1]).toBe('mast-west')
      expect(f[2]).toBe('SET')
      expect(f[6]).toBe('0') // b
      expect(f[7]).toBe('0') // intensity
      expect(f[8]).toBe('33') // rampMs = one 30 Hz frame period
      expect(f[9]).toBe(crowdCue.id)
    }

    // tSec never decreases (total ordering by tMs, mastId, tuple).
    const times = rows.slice(1).map((r) => Number(r.split(',')[0]))
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!)
  })

  it('is byte-identical across calls (deterministic)', () => {
    expect(crowdBroadcastCsv(compiled, getEffect)).toBe(crowdBroadcastCsv(compiled, getEffect))
    expect([...crowdBroadcastBin(compiled, getEffect)]).toEqual([
      ...crowdBroadcastBin(compiled, getEffect),
    ])
  })

  it('.bin framing round-trips: length prefixes walk exactly to the end, index matches', () => {
    const bin = crowdBroadcastBin(compiled, getEffect)
    const idx = JSON.parse(crowdBroadcastIndexJson(compiled, getEffect)) as {
      frames: { tSec: number; byteOffset: number; byteLength: number }[]
    }
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
    let off = 0
    let count = 0
    while (off < bin.length) {
      const len = view.getUint32(off, false)
      expect(len).toBe(55) // 12 fixed payload bytes + 43 mask bytes
      const entry = idx.frames[count]!
      expect(entry.byteOffset).toBe(off)
      expect(entry.byteLength).toBe(4 + len)
      expect(entry.tSec).toBeCloseTo(view.getUint32(off + 4, false) / 1000, 9)
      off += 4 + len
      count++
    }
    expect(off).toBe(bin.length)
    expect(count).toBe(idx.frames.length)
    // CSV rows (minus header) describe the same frames.
    expect(csvRows(crowdBroadcastCsv(compiled, getEffect))).toHaveLength(count + 1)
  })
})

describe('crowdBroadcastMastLoads / crowdBroadcastOverruns — physical bandwidth', () => {
  const mast = (mastId: string, mastIndex: number, framesPerSec: number): CrowdBroadcastMast => ({
    mastId,
    mastIndex,
    framesPerSec,
  })
  const frameAt = (tMs: number, mastId: string, mastIndex: number): CrowdBroadcastFrame => ({
    tMs,
    mastId,
    mastIndex,
    frameType: 'SET',
    cells: [0],
    r: 255,
    g: 0,
    b: 0,
    intensity: 0,
    rampMs: 33,
    cueIds: ['c'],
  })

  it('finds the worst ROLLING window, not calendar seconds', () => {
    // 500/900/1400 ms: both calendar seconds hold <= 2 frames, but the
    // rolling window [500, 1500) holds all 3 — over a 2 frames/s cap.
    const masts = [mast('m', 0, 2)]
    const frames = [500, 900, 1400].map((t) => frameAt(t, 'm', 0))
    expect(crowdBroadcastMastLoads(frames, masts)).toEqual([
      {
        mastId: 'm',
        mastIndex: 0,
        framesPerSec: 2,
        peakFramesPerSec: 3,
        peakWindowStartMs: 500,
      },
    ])
    expect(crowdBroadcastOverruns(frames, masts)).toHaveLength(1)
  })

  it('half-open window: a frame exactly 1000 ms later starts a new window', () => {
    const masts = [mast('m', 0, 1)]
    expect(
      crowdBroadcastOverruns([frameAt(0, 'm', 0), frameAt(1000, 'm', 0)], masts),
    ).toEqual([])
    expect(
      crowdBroadcastOverruns([frameAt(0, 'm', 0), frameAt(999, 'm', 0)], masts),
    ).toHaveLength(1)
  })

  it('exactly at the cap is NOT an overrun; one over is', () => {
    const masts = [mast('m', 0, 3)]
    const atCap = [0, 400, 800].map((t) => frameAt(t, 'm', 0))
    expect(crowdBroadcastOverruns(atCap, masts)).toEqual([])
    const overCap = [...atCap, frameAt(900, 'm', 0)]
    const over = crowdBroadcastOverruns(overCap, masts)
    expect(over).toHaveLength(1)
    expect(over[0]!.peakFramesPerSec).toBe(4)
  })

  it('attributes frames per mast and reports zero for idle masts', () => {
    const masts = [mast('a', 0, 1), mast('b', 1, 30)]
    const frames = [
      frameAt(100, 'a', 0),
      frameAt(200, 'a', 0),
      frameAt(100, 'b', 1),
    ]
    const loads = crowdBroadcastMastLoads(frames, masts)
    expect(loads[0]).toEqual({
      mastId: 'a',
      mastIndex: 0,
      framesPerSec: 1,
      peakFramesPerSec: 2,
      peakWindowStartMs: 100,
    })
    expect(loads[1]!.peakFramesPerSec).toBe(1)
    expect(crowdBroadcastOverruns(frames, masts).map((o) => o.mastId)).toEqual(['a'])
    expect(crowdBroadcastMastLoads([], masts)).toEqual([
      { mastId: 'a', mastIndex: 0, framesPerSec: 1, peakFramesPerSec: 0, peakWindowStartMs: 0 },
      { mastId: 'b', mastIndex: 1, framesPerSec: 30, peakFramesPerSec: 0, peakWindowStartMs: 0 },
    ])
  })

  it('tolerates unsorted frame input', () => {
    const masts = [mast('m', 0, 2)]
    const frames = [1400, 500, 900].map((t) => frameAt(t, 'm', 0))
    expect(crowdBroadcastMastLoads(frames, masts)[0]!.peakFramesPerSec).toBe(3)
  })

  it('a gradient wave show overruns the mast cap even though the choreo demand model passes', () => {
    const score = getScore('odeToJoy')!
    const tl = buildTimelineFromScore(score)
    const m = musicRefs(tl)
    const b = showBuilder({
      id: 'export-cb-wave',
      title: 'Export Crowd Wave',
      seed: 42,
      site: pinned30(),
      catalog,
    })
      .score(score)
      .preRoll(6)
    b.crowd.wave({
      effect: 'crowd-wave-lateral',
      position: 'mast-west',
      from: m.barBeat(3, 1),
      periodBeats: 8,
    })
    const compiled = b.build().compiled
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    // The demand model (summed maskUpdateHz: 10 Hz vs the 30 frames/s cap)
    // sees no problem…
    expect(crowdBandwidth(compiled.cues, compiled.show.site.assets, getEffect)).toEqual([])
    // …but the actual stream fans out to one frame per distinct tuple per
    // tick and overruns the cap by an order of magnitude.
    const stream = crowdBroadcastFrames(compiled, getEffect)
    const over = crowdBroadcastOverruns(stream.frames, stream.masts)
    expect(over.map((o) => o.mastId)).toEqual(['mast-west'])
    expect(over[0]!.framesPerSec).toBe(30)
    expect(over[0]!.peakFramesPerSec).toBeGreaterThan(30)
  })

  it('the haptic-only fixture fits: PULSE at 4 Hz never nears the 30 frames/s cap', () => {
    const compiled = makeCompiled(
      [
        { id: 'h1', trackId: 'trk-crowd', medium: 'crowd', effectId: 'crowd-haptic-thump',
          positionId: 'mast-east', targetSec: 5, anticipationSec: 0.08, durationSec: 4 },
      ],
      { site: pinned30() },
    )
    const stream = crowdBroadcastFrames(compiled, getEffect)
    expect(crowdBroadcastOverruns(stream.frames, stream.masts)).toEqual([])
    expect(crowdBroadcastMastLoads(stream.frames, stream.masts)).toEqual([
      { mastId: 'mast-west', mastIndex: 0, framesPerSec: 30, peakFramesPerSec: 0, peakWindowStartMs: 0 },
      { mastId: 'mast-east', mastIndex: 1, framesPerSec: 30, peakFramesPerSec: 4, peakWindowStartMs: 4933 },
    ])
  })
})

describe('crowdBroadcast — coverage and guards', () => {
  it('cells outside every mast coverage radius never appear in masks', () => {
    const base = lakesidePark()
    const site: SitePlan = {
      ...base,
      assets: base.assets.map((a) =>
        a.kind === 'crowdMast'
          ? { ...a, crowdMast: { ...a.crowdMast!, coverageRadiusM: 60 } }
          : a,
      ),
    }
    const grid = crowdGridFor(site)!
    const covered = coveredCellIndices(site, grid)
    expect(covered.size).toBeGreaterThan(0)
    expect(covered.size).toBeLessThan(grid.cells.length) // some cells uncovered

    const compiled = makeCompiled(
      [
        { id: 'c1', trackId: 'trk-crowd', medium: 'crowd', effectId: 'crowd-flood-rgb',
          positionId: 'mast-west', targetSec: 5, anticipationSec: 0.08, durationSec: 8,
          params: { rgb: [1, 1, 1] } },
        { id: 'h1', trackId: 'trk-crowd', medium: 'crowd', effectId: 'crowd-haptic-thump',
          positionId: 'mast-east', targetSec: 5, anticipationSec: 0.08, durationSec: 4 },
      ],
      { site },
    )
    const rows = csvRows(crowdBroadcastCsv(compiled, getEffect))
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows.slice(1)) {
      for (const cell of maskCells(row.split(',')[3]!)) {
        expect(covered.has(cell)).toBe(true)
      }
    }
  })

  it('guards spreadsheet injection on the cueIds column', () => {
    const compiled = makeCompiled([
      { id: '=SUM(A1)', trackId: 'trk-crowd', medium: 'crowd', effectId: 'crowd-haptic-thump',
        positionId: 'mast-west', targetSec: 5, anticipationSec: 0.08, durationSec: 4 },
    ])
    const rows = csvRows(crowdBroadcastCsv(compiled, getEffect))
    expect(rows[1]!.endsWith(`,'=SUM(A1)`)).toBe(true)
    expect(rows.some((r) => r.includes(',=SUM'))).toBe(false)
  })

  it('a show without crowd cues yields a header-only CSV and an empty bin', () => {
    const compiled = makeCompiled([])
    expect(csvRows(crowdBroadcastCsv(compiled, getEffect))).toHaveLength(1)
    expect(crowdBroadcastBin(compiled, getEffect)).toHaveLength(0)
    const idx = JSON.parse(crowdBroadcastIndexJson(compiled, getEffect)) as { frames: unknown[] }
    expect(idx.frames).toEqual([])
  })

  it('throws on a non-positive fps', () => {
    const compiled = makeCompiled([])
    expect(() => crowdBroadcastCsv(compiled, getEffect, 0)).toThrow(/fps/)
    expect(() => crowdBroadcastCsv(compiled, getEffect, -30)).toThrow(/fps/)
  })
})
