/**
 * export/crowdBroadcast.ts — crowd-canvas broadcast frames (CSV, .bin, index
 * JSON) for the wristband/phone mast transmitters.
 *
 * PURE builders: no I/O and no gating here (the CLI gates emission behind the
 * safety machine). Frames are derived by sampling the SAME closed-form crowd
 * model the sim renders (sim/crowd.ts CrowdField — reused, never duplicated)
 * on a fixed transmit-scheduling grid (the `fps` argument, default 30
 * ticks/s), across the union of that mast's crowd cue windows plus one
 * clearing tick past the end. The scheduling grid is deliberately DECOUPLED
 * from CrowdMastSpec.framesPerSec, which is pure transmission CAPACITY:
 * sampling at the frame budget itself would scale tuple fan-out with the cap
 * and gradient patterns would self-overrun at any budget.
 *
 * Frame model (what a mast TRANSMITS, one row/record per frame):
 *   SET   — the cells whose quantized output changed since the previous tick
 *           on that mast, grouped by identical new (r, g, b, intensity)
 *           bytes: one frame per distinct tuple, mask = that tuple's cells.
 *           Ticks where nothing changed emit nothing (diff-skip, the artnet
 *           convention). rgb rides the wristband channel; `intensity` is the
 *           phone/white channel. rampMs is one frame period (devices fade to
 *           the new value over a tick).
 *   PULSE — hapticPulse cues render nothing visual, but the wristband motor
 *           is a real output: one PULSE frame per maskUpdateHz slot across
 *           the cue's active window [fireSec, targetSec + durationSec),
 *           rgb 0, snapped to the scheduling grid. Starting at fireSec keeps
 *           the schedule honest — the solver already baked the p95 latency
 *           lead into fireSec.
 *
 * Masks address compact crowd-grid cell indices; cells outside every mast's
 * coverage never appear. Quantization to 0..255 happens BEFORE diffing, so
 * the stream is byte-stable across float noise. Frames are ordered by
 * (tMs, mastId, SET<PULSE, tuple, cueIds) — a total order, so the emitted
 * bytes are identical across runs.
 *
 * PHYSICAL BANDWIDTH: gradient patterns fan out to one SET frame per distinct
 * tuple per tick, so the scheduled stream can exceed the mast's framesPerSec
 * cap even when the choreo crowdBandwidth demand model (summed per-cue
 * maskUpdateHz) fits. crowdBroadcastMastLoads/crowdBroadcastOverruns audit
 * the ACTUAL stream — worst scheduled frames in any rolling one-second
 * window, per mast — and the CLI refuses to arm on an overrun. Frames are
 * never silently dropped to fit: a truncated stream would render a pattern
 * the sim never showed, so refusal is the only honest degradation.
 */

import type { CompiledShow } from '../contracts.js'
import type { EffectLookup } from '../acoustics/spl.js'
import { buildCrowdCues, CrowdField, type CrowdCueSim } from '../sim/crowd.js'
import { SimBuffers } from '../sim/snapshot.js'
import { csvDocument, guardSpreadsheetInjection, type CsvField } from './csv.js'

/** Index/format tag of the crowd-broadcast artifact family. */
export const CROWD_BROADCAST_FORMAT = 'theodoor-crowd-broadcast'

export const CROWD_BROADCAST_COLUMNS = [
  'tSec',
  'mastId',
  'frameType',
  'cellMaskHex',
  'r',
  'g',
  'b',
  'intensity',
  'rampMs',
  'cueIds',
] as const

export type CrowdFrameType = 'SET' | 'PULSE'

/** Wire codes for the .bin frameType byte. */
export const CROWD_FRAME_TYPE_CODE: Record<CrowdFrameType, number> = { SET: 0, PULSE: 1 }

/** One broadcast frame as transmitted by one mast. */
export interface CrowdBroadcastFrame {
  /** Transmit time on the mast's frame grid, whole milliseconds. */
  tMs: number
  mastId: string
  /** Index into the masts list (site crowdMast asset order). */
  mastIndex: number
  frameType: CrowdFrameType
  /** Compact cell indices covered by the mask, ascending. */
  cells: readonly number[]
  /** Quantized wristband color, 0..255 per channel (0 for PULSE). */
  r: number
  g: number
  b: number
  /** Quantized phone/white channel (SET) or haptic strength (PULSE), 0..255. */
  intensity: number
  rampMs: number
  /** Cue ids active on the mast at this tick (PULSE: the haptic cue). */
  cueIds: readonly string[]
}

export interface CrowdBroadcastMast {
  mastId: string
  mastIndex: number
  /** Frame grid this mast was sampled on, frames per second. */
  framesPerSec: number
}

/** The shared derivation all three artifact builders render from. */
export interface CrowdBroadcast {
  /** Compact crowd-grid cell count (mask bit width). 0 without a grid. */
  cellCount: number
  grid: { rows: number; cols: number; cellSizeM: number } | undefined
  masts: readonly CrowdBroadcastMast[]
  frames: readonly CrowdBroadcastFrame[]
}

const quantize = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)))

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function frameOrder(a: CrowdBroadcastFrame, b: CrowdBroadcastFrame): number {
  return (
    a.tMs - b.tMs ||
    cmpStr(a.mastId, b.mastId) ||
    CROWD_FRAME_TYPE_CODE[a.frameType] - CROWD_FRAME_TYPE_CODE[b.frameType] ||
    a.r - b.r ||
    a.g - b.g ||
    a.b - b.b ||
    a.intensity - b.intensity ||
    cmpStr(a.cueIds.join(';'), b.cueIds.join(';'))
  )
}

function assertCellRange(cells: readonly number[], cellCount: number): void {
  for (const c of cells) {
    if (!Number.isInteger(c) || c < 0 || c >= cellCount) {
      throw new RangeError(`crowdBroadcast: cell index ${c} out of 0..${cellCount - 1}`)
    }
  }
}

/**
 * Broadcast mask as lowercase hex, zero-padded to ceil(cellCount/4) nibbles.
 * Bit i of the (big) mask integer is compact cell index i — LSB-first, so
 * cell 0 is the least significant bit of the LAST hex character.
 */
export function cellMaskHex(cells: readonly number[], cellCount: number): string {
  assertCellRange(cells, cellCount)
  const nibbles = Math.ceil(cellCount / 4)
  const nib = new Uint8Array(nibbles)
  for (const c of cells) nib[c >> 2] |= 1 << (c & 3)
  let out = ''
  for (let j = nibbles - 1; j >= 0; j--) out += nib[j]!.toString(16)
  return out
}

/**
 * Broadcast mask as ceil(cellCount/8) bytes, LSB-first: byte k bit b is
 * compact cell index 8k + b (byte 0 first — the .bin mask layout).
 */
export function cellMaskBytes(cells: readonly number[], cellCount: number): Uint8Array {
  assertCellRange(cells, cellCount)
  const bytes = new Uint8Array(Math.ceil(cellCount / 8))
  for (const c of cells) bytes[c >> 3] |= 1 << (c & 7)
  return bytes
}

/**
 * Derive the deterministic broadcast frame stream for a compiled show. This
 * is the single source all three artifact renderers consume, so the CSV,
 * .bin, and index JSON always describe the same frames.
 */
export function crowdBroadcastFrames(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  fps = 30,
): CrowdBroadcast {
  if (!(fps > 0) || !Number.isFinite(fps)) {
    throw new RangeError(`crowdBroadcast: fps must be a positive finite number, got ${fps}`)
  }
  const site = compiled.show.site
  const beats = compiled.show.music.beats
  const mastAssets = site.assets.filter((a) => a.kind === 'crowdMast' && a.crowdMast !== undefined)
  const field = new CrowdField(site)
  const cellCount = field.cellCount
  const gridInfo = field.grid
    ? { rows: field.grid.rows, cols: field.grid.cols, cellSizeM: field.grid.cellSizeM }
    : undefined
  const masts: CrowdBroadcastMast[] = mastAssets.map((a, i) => ({
    mastId: a.id,
    mastIndex: i,
    framesPerSec: a.crowdMast!.framesPerSec > 0 ? a.crowdMast!.framesPerSec : fps,
  }))

  const cues = buildCrowdCues(compiled, getEffect)
  if (!gridInfo || cellCount === 0 || cues.length === 0 || masts.length === 0) {
    return { cellCount, grid: gridInfo, masts, frames: [] }
  }

  // Covered cells, ascending compact index — the only cells masks may address.
  const covered = [...field.covered].sort((a, b) => a - b)

  // Group cues per mast, mirroring buildCrowdCues' resolution: the cue's
  // positionId when it names a crowdMast asset, else the site's first mast.
  const byMast: CrowdCueSim[][] = masts.map(() => [])
  for (const c of cues) {
    const idx = mastAssets.findIndex((a) => a.id === c.cue.positionId)
    byMast[idx >= 0 ? idx : 0]!.push(c)
  }

  const frames: CrowdBroadcastFrame[] = []
  const buf = new SimBuffers()
  buf.setCrowdCellCount(cellCount)

  for (const mast of masts) {
    const mastCues = byMast[mast.mastIndex]!
    const visual = mastCues.filter((c) => c.effect.pattern !== 'hapticPulse')
    const haptic = mastCues.filter((c) => c.effect.pattern === 'hapticPulse')
    // The transmit-SCHEDULING grid (`fps`, default 30 ticks/s) is deliberately
    // decoupled from the mast's framesPerSec CAPACITY: sampling at the full
    // frame budget would scale the tuple fan-out with the cap and any
    // gradient pattern would self-overrun no matter how large the budget.
    const rate = fps
    const rampMs = Math.round(1000 / rate)

    // --- SET frames: sample the sim's crowd model, diff quantized bytes ----
    if (visual.length > 0) {
      let start = Infinity
      let end = -Infinity
      for (const c of visual) {
        if (c.startSec < start) start = c.startSec
        if (c.endSec > end) end = c.endSec
      }
      start = Math.max(0, start) // tMs is unsigned; nothing transmits before t=0
      const kStart = Math.ceil(start * rate - 1e-9)
      // One tick at/after the window end so the clearing (all-dark) frame is
      // emitted; ticks after it diff-skip forever.
      const kEnd = Math.ceil(end * rate - 1e-9)
      const prev = new Uint8Array(cellCount * 4)
      const cur = new Uint8Array(cellCount * 4)
      for (let k = kStart; k <= kEnd; k++) {
        const t = k / rate
        buf.beginStep(t, k)
        field.evalStep(visual, t, beats, buf)
        cur.fill(0)
        for (const ci of covered) {
          const b4 = ci * 4
          cur[b4] = quantize(buf.crowdRgb[ci * 3]!)
          cur[b4 + 1] = quantize(buf.crowdRgb[ci * 3 + 1]!)
          cur[b4 + 2] = quantize(buf.crowdRgb[ci * 3 + 2]!)
          cur[b4 + 3] = quantize(buf.crowdWhite[ci]!)
        }
        // Changed cells, grouped by their new (r, g, b, intensity) tuple.
        const groups = new Map<number, number[]>()
        for (const ci of covered) {
          const b4 = ci * 4
          if (
            cur[b4] === prev[b4] &&
            cur[b4 + 1] === prev[b4 + 1] &&
            cur[b4 + 2] === prev[b4 + 2] &&
            cur[b4 + 3] === prev[b4 + 3]
          ) {
            continue
          }
          const key = ((cur[b4]! * 256 + cur[b4 + 1]!) * 256 + cur[b4 + 2]!) * 256 + cur[b4 + 3]!
          const list = groups.get(key)
          if (list) list.push(ci)
          else groups.set(key, [ci])
        }
        if (groups.size > 0) {
          const tMs = Math.round(t * 1000)
          const cueIds = visual
            .filter((c) => t >= c.startSec && t < c.endSec)
            .map((c) => c.cue.id)
          for (const key of [...groups.keys()].sort((a, b) => a - b)) {
            const intensity = key % 256
            const b = Math.floor(key / 256) % 256
            const g = Math.floor(key / 65536) % 256
            const r = Math.floor(key / 16777216) % 256
            frames.push({
              tMs,
              mastId: mast.mastId,
              mastIndex: mast.mastIndex,
              frameType: 'SET',
              cells: groups.get(key)!,
              r,
              g,
              b,
              intensity,
              rampMs,
              cueIds,
            })
          }
        }
        prev.set(cur)
      }
    }

    // --- PULSE frames: the haptic motor schedule ---------------------------
    for (const c of haptic) {
      const hz = c.effect.maskUpdateHz > 0 ? c.effect.maskUpdateHz : rate
      const raw = c.cue.params?.intensity
      const strength =
        typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1
      for (let i = 0; ; i++) {
        const tRaw = c.startSec + i / hz
        if (tRaw >= c.endSec - 1e-9) break
        if (tRaw < 0) continue
        const k = Math.round(tRaw * rate) // snap to the mast frame grid
        frames.push({
          tMs: Math.round((k / rate) * 1000),
          mastId: mast.mastId,
          mastIndex: mast.mastIndex,
          frameType: 'PULSE',
          cells: covered,
          r: 0,
          g: 0,
          b: 0,
          intensity: quantize(strength),
          rampMs: 0,
          cueIds: [c.cue.id],
        })
      }
    }
  }

  frames.sort(frameOrder)
  return { cellCount, grid: gridInfo, masts, frames }
}

/** Per-mast worst-case scheduled transmission load (rolling 1 s window). */
export interface CrowdBroadcastMastLoad {
  mastId: string
  mastIndex: number
  /** The mast's bandwidth cap (its frame grid rate), frames per second. */
  framesPerSec: number
  /** Most frames scheduled in any rolling 1000 ms window (SET and PULSE). */
  peakFramesPerSec: number
  /** Start (ms) of the worst window; 0 when the mast schedules no frames. */
  peakWindowStartMs: number
}

/**
 * Physical-bandwidth audit of a built frame stream: for each mast, the worst
 * number of scheduled frames in any rolling one-second window [t, t+1000).
 * This measures the transmissions the exporter actually scheduled — the
 * choreo crowdBandwidth detector only models per-cue maskUpdateHz demand and
 * cannot see gradient tuple fan-out. Pure and deterministic; tolerates
 * frames in any order. The worst window always starts at some frame's tMs,
 * so sweeping frame starts visits every peak.
 */
export function crowdBroadcastMastLoads(
  frames: readonly CrowdBroadcastFrame[],
  masts: readonly CrowdBroadcastMast[],
): CrowdBroadcastMastLoad[] {
  return masts.map((mast) => {
    const times = frames
      .filter((f) => f.mastId === mast.mastId)
      .map((f) => f.tMs)
      .sort((a, b) => a - b)
    let peak = 0
    let peakAt = 0
    let j = 0
    for (let i = 0; i < times.length; i++) {
      if (j < i) j = i
      while (j < times.length && times[j]! < times[i]! + 1000) j++
      if (j - i > peak) {
        peak = j - i
        peakAt = times[i]!
      }
    }
    return {
      mastId: mast.mastId,
      mastIndex: mast.mastIndex,
      framesPerSec: mast.framesPerSec,
      peakFramesPerSec: peak,
      peakWindowStartMs: peakAt,
    }
  })
}

/**
 * Masts whose scheduled stream exceeds their framesPerSec cap in some rolling
 * one-second window — schedules the transmitter physically cannot keep up
 * with. Empty means every mast fits. The CLI feeds this (alongside the
 * choreo crowdBandwidth detector) into the broadcast-bandwidth arm interlock.
 */
export function crowdBroadcastOverruns(
  frames: readonly CrowdBroadcastFrame[],
  masts: readonly CrowdBroadcastMast[],
): CrowdBroadcastMastLoad[] {
  return crowdBroadcastMastLoads(frames, masts).filter(
    (l) => l.peakFramesPerSec > l.framesPerSec,
  )
}

/**
 * CSV: tSec,mastId,frameType,cellMaskHex,r,g,b,intensity,rampMs,cueIds.
 * tSec fixed(3); free-text columns pass the spreadsheet-injection guard;
 * cueIds are ';'-joined.
 */
export function crowdBroadcastCsv(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  fps = 30,
): string {
  const b = crowdBroadcastFrames(compiled, getEffect, fps)
  const rows: CsvField[][] = [[...CROWD_BROADCAST_COLUMNS]]
  for (const f of b.frames) {
    rows.push([
      (f.tMs / 1000).toFixed(3),
      guardSpreadsheetInjection(f.mastId),
      f.frameType,
      cellMaskHex(f.cells, b.cellCount),
      f.r,
      f.g,
      f.b,
      f.intensity,
      f.rampMs,
      guardSpreadsheetInjection(f.cueIds.join(';')),
    ])
  }
  return csvDocument(rows)
}

interface BinIndexEntry {
  tSec: number
  byteOffset: number
  byteLength: number
}

const round3 = (v: number): number => Number(v.toFixed(3))

/** Render frames to length-prefixed records + the per-frame byte index. */
function renderBin(b: CrowdBroadcast): { bin: Uint8Array; index: BinIndexEntry[] } {
  const maskLen = Math.ceil(b.cellCount / 8)
  const payloadLen = 12 + maskLen // u32 tMs, u8 mastIndex, u8 type, 4×u8, u16 rampMs, mask
  const recordLen = 4 + payloadLen // u32 BE length prefix (artnet .bin convention)
  const bin = new Uint8Array(recordLen * b.frames.length)
  const view = new DataView(bin.buffer)
  const index: BinIndexEntry[] = []
  let off = 0
  for (const f of b.frames) {
    if (!Number.isInteger(f.tMs) || f.tMs < 0 || f.tMs > 0xffffffff) {
      throw new RangeError(`crowdBroadcast: tMs out of u32 range: ${f.tMs}`)
    }
    if (f.mastIndex < 0 || f.mastIndex > 255) {
      throw new RangeError(`crowdBroadcast: mastIndex out of u8 range: ${f.mastIndex}`)
    }
    if (f.rampMs < 0 || f.rampMs > 0xffff) {
      throw new RangeError(`crowdBroadcast: rampMs out of u16 range: ${f.rampMs}`)
    }
    view.setUint32(off, payloadLen, false)
    view.setUint32(off + 4, f.tMs, false)
    bin[off + 8] = f.mastIndex
    bin[off + 9] = CROWD_FRAME_TYPE_CODE[f.frameType]
    bin[off + 10] = f.r
    bin[off + 11] = f.g
    bin[off + 12] = f.b
    bin[off + 13] = f.intensity
    view.setUint16(off + 14, f.rampMs, false)
    bin.set(cellMaskBytes(f.cells, b.cellCount), off + 16)
    index.push({ tSec: round3(f.tMs / 1000), byteOffset: off, byteLength: recordLen })
    off += recordLen
  }
  return { bin, index }
}

/**
 * Binary stream: per frame a u32 BE length prefix, then the payload
 * u32 tMs BE | u8 mastIndex | u8 frameType (0 SET, 1 PULSE) |
 * u8 r,g,b,intensity | u16 rampMs BE | mask bytes (ceil(cellCount/8),
 * LSB-first).
 */
export function crowdBroadcastBin(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  fps = 30,
): Uint8Array {
  return renderBin(crowdBroadcastFrames(compiled, getEffect, fps)).bin
}

/**
 * Index JSON over the .bin stream (the artnet index pattern): format tag,
 * grid geometry, the mast table (each mast carrying its measured
 * peakFramesPerSec — worst rolling-1 s scheduled load — beside its cap), and
 * per-frame byte extents.
 */
export function crowdBroadcastIndexJson(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  fps = 30,
): string {
  const b = crowdBroadcastFrames(compiled, getEffect, fps)
  const { index } = renderBin(b)
  const loads = crowdBroadcastMastLoads(b.frames, b.masts)
  return JSON.stringify(
    {
      format: CROWD_BROADCAST_FORMAT,
      version: 1,
      cellCount: b.cellCount,
      grid: b.grid ?? null,
      masts: loads.map((l) => ({
        mastId: l.mastId,
        mastIndex: l.mastIndex,
        framesPerSec: l.framesPerSec,
        peakFramesPerSec: l.peakFramesPerSec,
      })),
      frames: index,
    },
    null,
    2,
  )
}
