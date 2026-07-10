/**
 * export/ilda.ts — ILDA image-data file bytes, format 5 (2D true color).
 *
 * PURE byte builder from sampled LaserPoint frames.
 *
 * Per frame: a 32-byte big-endian header —
 *   bytes  0..3  : 'ILDA'
 *   bytes  4..6  : zero
 *   byte   7     : format code (5)
 *   bytes  8..15 : frame name, ASCII, space-padded
 *   bytes 16..23 : company name, ASCII, space-padded (default 'THEODOOR')
 *   bytes 24..25 : number of records, u16 BE
 *   bytes 26..27 : frame number, u16 BE
 *   bytes 28..29 : total frames, u16 BE
 *   byte  30     : projector number
 *   byte  31     : zero
 * — then numRecords 8-byte records: x i16 BE, y i16 BE, status, B, G, R.
 * Status bit6 (0x40) = blanked, bit7 (0x80) = last point of the frame.
 * Coordinates map [-1,1] → round(clamp(v)*32767); colors 0..1 → 0..255.
 *
 * Every output frame gets a leading BLANKED record at its first coordinate
 * (hides the inter-frame jump). Source frames longer than 65534 points are
 * split across output frames. A trailing 0-record header terminates the file.
 */

import type { LaserPoint } from '../contracts.js'
import { clamp } from '../math/index.js'

export const ILDA_HEADER_LENGTH = 32
export const ILDA_RECORD_LENGTH = 8
export const ILDA_FORMAT_2D_TRUE_COLOR = 5
/** u16 record count minus the leading blanked point we add per frame. */
const MAX_SOURCE_POINTS_PER_FRAME = 65534

const STATUS_BLANK = 0x40
const STATUS_LAST_POINT = 0x80

export interface IldaOptions {
  /** ≤ 8 ASCII chars; space-padded. Default ''. */
  frameName?: string
  /** ≤ 8 ASCII chars; space-padded. Default 'THEODOOR'. */
  company?: string
  /** Projector number byte. Default 0. */
  projector?: number
}

function ascii8(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < 8; i++) {
    const code = i < s.length ? s.charCodeAt(i) : 0x20
    out.push(code >= 0x20 && code <= 0x7e ? code : 0x3f) // non-ASCII → '?'
  }
  return out
}

function coordToI16(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.round(clamp(v, -1, 1) * 32767)
}

function colorToByte(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.round(clamp(v, 0, 1) * 255)
}

interface OutFrame {
  points: readonly LaserPoint[]
}

function writeHeader(
  view: DataView,
  offset: number,
  name: number[],
  company: number[],
  numRecords: number,
  frameNumber: number,
  totalFrames: number,
  projector: number,
): void {
  view.setUint8(offset + 0, 0x49) // I
  view.setUint8(offset + 1, 0x4c) // L
  view.setUint8(offset + 2, 0x44) // D
  view.setUint8(offset + 3, 0x41) // A
  // bytes 4..6 stay zero
  view.setUint8(offset + 7, ILDA_FORMAT_2D_TRUE_COLOR)
  for (let i = 0; i < 8; i++) {
    view.setUint8(offset + 8 + i, name[i])
    view.setUint8(offset + 16 + i, company[i])
  }
  view.setUint16(offset + 24, numRecords, false)
  view.setUint16(offset + 26, frameNumber, false)
  view.setUint16(offset + 28, totalFrames, false)
  view.setUint8(offset + 30, projector)
  // byte 31 stays zero
}

/**
 * Build a complete ILDA format-5 file from point frames. Empty source frames
 * are skipped; an empty frame list still yields a valid trailer-only file.
 */
export function buildIldaFile(frames: readonly (readonly LaserPoint[])[], opts: IldaOptions = {}): Uint8Array {
  const name = ascii8(opts.frameName ?? '')
  const company = ascii8(opts.company ?? 'THEODOOR')
  const projector = opts.projector ?? 0
  if (!Number.isInteger(projector) || projector < 0 || projector > 255) {
    throw new RangeError(`ilda: projector must be an integer 0..255, got ${projector}`)
  }

  // Split oversized frames; drop empty ones.
  const outFrames: OutFrame[] = []
  for (const frame of frames) {
    for (let start = 0; start < frame.length; start += MAX_SOURCE_POINTS_PER_FRAME) {
      outFrames.push({ points: frame.slice(start, start + MAX_SOURCE_POINTS_PER_FRAME) })
    }
  }
  const totalFrames = outFrames.length
  if (totalFrames > 65535) throw new RangeError(`ilda: too many frames (${totalFrames} > 65535)`)

  let byteLength = ILDA_HEADER_LENGTH // trailer
  for (const f of outFrames) byteLength += ILDA_HEADER_LENGTH + (f.points.length + 1) * ILDA_RECORD_LENGTH

  const bytes = new Uint8Array(byteLength)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (let fi = 0; fi < outFrames.length; fi++) {
    const points = outFrames[fi].points
    const numRecords = points.length + 1 // leading blanked point
    writeHeader(view, offset, name, company, numRecords, fi, totalFrames, projector)
    offset += ILDA_HEADER_LENGTH
    for (let ri = 0; ri < numRecords; ri++) {
      // Record 0 duplicates the first point, blanked, to hide the jump.
      const p = points[ri === 0 ? 0 : ri - 1]
      let status = 0
      if (ri === 0 || p.blank) status |= STATUS_BLANK
      if (ri === numRecords - 1) status |= STATUS_LAST_POINT
      view.setInt16(offset + 0, coordToI16(p.x), false)
      view.setInt16(offset + 2, coordToI16(p.y), false)
      view.setUint8(offset + 4, status)
      view.setUint8(offset + 5, colorToByte(p.b))
      view.setUint8(offset + 6, colorToByte(p.g))
      view.setUint8(offset + 7, colorToByte(p.r))
      offset += ILDA_RECORD_LENGTH
    }
  }
  // Trailing 0-record header terminates the file.
  writeHeader(view, offset, name, company, 0, totalFrames, totalFrames, projector)
  return bytes
}
