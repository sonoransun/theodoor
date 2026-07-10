import { describe, expect, it } from 'vitest'
import { buildIldaFile } from '../src/export/index.js'
import type { LaserPoint } from '../src/contracts.js'

const hex = (u8: Uint8Array): string =>
  [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')

const pt = (x: number, y: number, r: number, g: number, b: number, blank = false): LaserPoint => ({
  x, y, r, g, b, blank,
})

// Shared hand-computed header pieces (frameName 'TEST', company 'THEODOOR'):
const H_MAGIC = '494c4441' // 'ILDA'
const H_PAD_FMT = '000000' + '05' // 3 zero bytes + format 5
const H_NAME = '5445535420202020' // 'TEST    '
const H_COMPANY = '5448454f444f4f52' // 'THEODOOR'

describe('buildIldaFile (format 5, 2D true color)', () => {
  it('matches hand-computed golden bytes for a 2-frame file', () => {
    const frameA = [
      pt(0, 0, 1, 0, 0), // origin, red
      pt(0.5, -0.5, 0, 1, 0, true), // blanked green travel point
      pt(2, -2, 0, 0, 1), // out of range: clamps to (1, -1), blue
    ]
    const frameB = [pt(-1, 1, 1, 1, 1)] // single white point
    const bytes = buildIldaFile([frameA, frameB], { frameName: 'TEST' })

    // Frame A: 3 source points + 1 leading blank = 4 records.
    const headerA =
      H_MAGIC + H_PAD_FMT + H_NAME + H_COMPANY +
      '0004' + // numRecords = 4
      '0000' + // frameNumber = 0
      '0002' + // totalFrames = 2
      '00' + '00' // projector, reserved
    const recordsA =
      // Leading blanked point copies p0's coords/colors; status 0x40.
      // Records are x:i16BE, y:i16BE, status, B, G, R.
      '00000000' + '40' + '0000ff' +
      // p0 (0,0) red, status 0.
      '00000000' + '00' + '0000ff' +
      // p1: 0.5*32767 rounds to 16384 = 0x4000; -0.5*32767 rounds to -16383
      // = 0xc001 two's complement; blanked -> status 0x40; green.
      '4000c001' + '40' + '00ff00' +
      // p2: clamps to (32767, -32767) = 7fff, 8001; LAST point -> 0x80; blue.
      '7fff8001' + '80' + 'ff0000'

    // Frame B: 1 source point + leading blank = 2 records.
    const headerB =
      H_MAGIC + H_PAD_FMT + H_NAME + H_COMPANY + '0002' + '0001' + '0002' + '0000'
    const recordsB =
      '80017fff' + '40' + 'ffffff' + // leading blank at (-1, 1), white
      '80017fff' + '80' + 'ffffff' // the point itself, last-point bit

    // Trailer: 0-record header terminates the file.
    const trailer =
      H_MAGIC + H_PAD_FMT + H_NAME + H_COMPANY + '0000' + '0002' + '0002' + '0000'

    // Lengths by hand: (32 + 4*8) + (32 + 2*8) + 32 = 64 + 48 + 32 = 144.
    expect(bytes.length).toBe(144)
    expect(hex(bytes)).toBe(headerA + recordsA + headerB + recordsB + trailer)
  })

  it('defaults company to THEODOOR and pads names with spaces', () => {
    const bytes = buildIldaFile([[pt(0, 0, 0, 0, 0)]])
    expect(hex(bytes.subarray(8, 16))).toBe('2020202020202020') // empty name
    expect(hex(bytes.subarray(16, 24))).toBe(H_COMPANY)
  })

  it('sets the blank bit (0x40) and last-point bit (0x80) correctly', () => {
    const bytes = buildIldaFile([[pt(0, 0, 1, 1, 1), pt(0.1, 0.1, 1, 1, 1, true)]])
    const status = (record: number) => bytes[32 + record * 8 + 4]
    expect(status(0)).toBe(0x40) // leading blank
    expect(status(1)).toBe(0x00) // visible point
    expect(status(2)).toBe(0x40 | 0x80) // blanked AND last
  })

  it('single-point frames set the last-point bit on the point record', () => {
    const bytes = buildIldaFile([[pt(0.25, 0.25, 1, 0, 0)]])
    expect(bytes[32 + 4]).toBe(0x40) // leading blank
    expect(bytes[32 + 8 + 4]).toBe(0x80) // the lone point is the last record
  })

  it('clamps out-of-range and NaN coordinates and colors', () => {
    const bytes = buildIldaFile([[pt(5, Number.NaN, 9, -3, Number.NaN)]])
    const view = new DataView(bytes.buffer)
    // Record 1 (after the leading blank at offset 32):
    expect(view.getInt16(40, false)).toBe(32767) // x clamped high
    expect(view.getInt16(42, false)).toBe(0) // NaN -> 0
    expect(bytes[45]).toBe(0) // B: NaN -> 0
    expect(bytes[46]).toBe(0) // G: clamped low
    expect(bytes[47]).toBe(255) // R: clamped high
  })

  it('writes a valid trailer-only file for an empty frame list', () => {
    const bytes = buildIldaFile([])
    expect(bytes.length).toBe(32)
    const view = new DataView(bytes.buffer)
    expect(hex(bytes.subarray(0, 4))).toBe(H_MAGIC)
    expect(view.getUint16(24, false)).toBe(0) // numRecords 0 = EOF
    expect(view.getUint16(28, false)).toBe(0) // totalFrames 0
  })

  it('skips empty source frames (a 0-record body would read as EOF)', () => {
    const bytes = buildIldaFile([[], [pt(0, 0, 1, 1, 1)]])
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(28, false)).toBe(1) // totalFrames = 1
    expect(bytes.length).toBe(32 + 2 * 8 + 32)
  })

  it('splits frames longer than 65534 source points', () => {
    const big: LaserPoint[] = Array.from({ length: 70000 }, (_, i) =>
      pt((i % 200) / 100 - 1, 0, 1, 1, 1),
    )
    const bytes = buildIldaFile([big])
    const view = new DataView(bytes.buffer)
    // Frame 0: 65534 + leading blank = 65535 records.
    expect(view.getUint16(24, false)).toBe(65535)
    expect(view.getUint16(26, false)).toBe(0)
    expect(view.getUint16(28, false)).toBe(2)
    const frame1At = 32 + 65535 * 8
    // Frame 1: 70000 - 65534 = 4466 source points + blank = 4467 records.
    expect(view.getUint16(frame1At + 24, false)).toBe(4467)
    expect(view.getUint16(frame1At + 26, false)).toBe(1)
    // Last record of each output frame carries the last-point bit.
    expect(bytes[frame1At - 8 + 4]! & 0x80).toBe(0x80)
    expect(bytes[frame1At + 32 + 4467 * 8 - 8 + 4]! & 0x80).toBe(0x80)
    // Total size: two frames + trailer.
    expect(bytes.length).toBe(32 + 65535 * 8 + 32 + 4467 * 8 + 32)
  })

  it('is deterministic across runs', () => {
    const frames = [[pt(0.1, 0.2, 0.3, 0.4, 0.5)], [pt(-0.5, 0.5, 1, 0, 1, true)]]
    expect(hex(buildIldaFile(frames))).toBe(hex(buildIldaFile(frames)))
  })
})
