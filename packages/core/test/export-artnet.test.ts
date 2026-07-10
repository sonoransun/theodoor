import { describe, expect, it } from 'vitest'
import {
  buildArtDmx,
  laserPatch,
  panelPatch,
  renderDmxPackets,
  type DmxFrame,
} from '../src/export/index.js'
import type { PanelSpec } from '../src/contracts.js'

const hex = (u8: Uint8Array): string =>
  [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('buildArtDmx', () => {
  it('matches the hand-computed golden packet for universe 0x0123', () => {
    const packet = buildArtDmx({
      sequence: 0x07,
      physical: 0x02,
      universe: 0x0123,
      data: new Uint8Array([0x01, 0x02, 0x03]),
    })
    // Hand-computed 18-byte header + 3 data bytes padded to 4:
    //   'Art-Net\0'            41 72 74 2d 4e 65 74 00
    //   OpDmx little-endian    00 50
    //   ProtVer big-endian 14  00 0e
    //   sequence               07
    //   physical               02
    //   SubUni = 0x0123 & 0xff = 23
    //   Net    = 0x0123 >> 8   = 01
    //   length big-endian (4)  00 04
    //   data + pad             01 02 03 00
    expect(hex(packet)).toBe('4172742d4e6574000050000e07022301000401020300')
    expect(packet.length).toBe(22)
  })

  it('writes opcode little-endian but length big-endian (the classic bug)', () => {
    const packet = buildArtDmx({ sequence: 1, universe: 0, data: new Uint8Array(256) })
    expect(packet[8]).toBe(0x00) // OpDmx lo
    expect(packet[9]).toBe(0x50) // OpDmx hi
    expect(packet[16]).toBe(0x01) // length hi — 256 = 0x0100
    expect(packet[17]).toBe(0x00) // length lo
  })

  it('pads odd data lengths to even with a trailing zero', () => {
    const packet = buildArtDmx({ sequence: 1, universe: 0, data: new Uint8Array([9]) })
    expect(packet.length).toBe(20)
    expect(packet[16]).toBe(0)
    expect(packet[17]).toBe(2)
    expect(packet[18]).toBe(9)
    expect(packet[19]).toBe(0)
  })

  it('accepts the 512-channel maximum', () => {
    const packet = buildArtDmx({ sequence: 1, universe: 0, data: new Uint8Array(512) })
    expect(packet.length).toBe(18 + 512)
    expect(packet[16]).toBe(0x02)
    expect(packet[17]).toBe(0x00)
  })

  it('defaults physical to 0', () => {
    const packet = buildArtDmx({ sequence: 1, universe: 0, data: new Uint8Array(2) })
    expect(packet[13]).toBe(0)
  })

  it('throws on out-of-range universe, empty or oversized data, bad sequence', () => {
    const data = new Uint8Array(2)
    expect(() => buildArtDmx({ sequence: 1, universe: 0x8000, data })).toThrow(/universe/)
    expect(() => buildArtDmx({ sequence: 1, universe: -1, data })).toThrow(/universe/)
    expect(() => buildArtDmx({ sequence: 1, universe: 1.5, data })).toThrow(/universe/)
    expect(() => buildArtDmx({ sequence: 1, universe: 0, data: new Uint8Array(0) })).toThrow(/at least 1/)
    expect(() => buildArtDmx({ sequence: 1, universe: 0, data: new Uint8Array(513) })).toThrow(/512/)
    expect(() => buildArtDmx({ sequence: 256, universe: 0, data })).toThrow(/sequence/)
    expect(() => buildArtDmx({ sequence: -1, universe: 0, data })).toThrow(/sequence/)
  })

  it('accepts the 15-bit universe maximum and splits SubUni/Net', () => {
    const packet = buildArtDmx({ sequence: 1, universe: 0x7fff, data: new Uint8Array(2) })
    expect(packet[14]).toBe(0xff) // SubUni
    expect(packet[15]).toBe(0x7f) // Net
  })
})

describe('fixed patch presets', () => {
  const panel: PanelSpec = { wPx: 20, hPx: 10, pitchMm: 30 }

  it('panelPatch maps row-major RGB pixels at 170 px per universe', () => {
    const patch = panelPatch('panel1', panel, 5)
    expect(patch.totalChannels).toBe(600) // 200 px * 3
    expect(patch.slices).toEqual([
      { universe: 5, channel: 1, offset: 0, length: 510 },
      { universe: 6, channel: 1, offset: 510, length: 90 },
    ])
  })

  it('panelPatch throws when universes run past 0x7fff', () => {
    expect(() => panelPatch('panel1', panel, 0x7fff)).toThrow(/universe/)
  })

  it('laserPatch reserves the fixed 8-slot block at channel 1', () => {
    const patch = laserPatch('laser1', 9)
    expect(patch.totalChannels).toBe(8)
    expect(patch.slices).toEqual([{ universe: 9, channel: 1, offset: 0, length: 8 }])
  })
})

describe('renderDmxPackets', () => {
  const laser = laserPatch('laser1', 0)
  const frame = (tSec: number, bytes: number[]): DmxFrame => ({
    tSec,
    byAsset: new Map([['laser1', new Uint8Array(bytes)]]),
  })
  const laserData = (v: number) => [v & 0xff, 0, 0, 0, 0, 0, 0, 0]

  it('wraps per-universe sequence 255 -> 1, never emitting 0', () => {
    const frames = Array.from({ length: 300 }, (_, i) => frame(i / 30, laserData(i)))
    const out = renderDmxPackets(frames, [laser], 30)
    expect(out.length).toBe(300)
    const seqs = out.map((f) => {
      expect(f.packets.length).toBe(1) // data changes every frame
      return f.packets[0]![12]!
    })
    expect(seqs[0]).toBe(1)
    expect(seqs[254]).toBe(255)
    expect(seqs[255]).toBe(1) // wrap skips 0
    expect(seqs[256]).toBe(2)
    expect(seqs).not.toContain(0)
  })

  it('diff-skips universes whose data is unchanged', () => {
    const frames = [frame(0, laserData(1)), frame(1 / 30, laserData(1)), frame(2 / 30, laserData(2))]
    const out = renderDmxPackets(frames, [laser], 30)
    expect(out.map((f) => f.packets.length)).toEqual([1, 0, 1])
    expect(out[0]!.packets[0]![12]).toBe(1) // seq 1
    expect(out[2]!.packets[0]![12]).toBe(2) // seq advanced only on emit
  })

  it('keeps previous channel values when an asset is absent from a frame', () => {
    const empty: DmxFrame = { tSec: 1 / 30, byAsset: new Map() }
    const out = renderDmxPackets([frame(0, laserData(7)), empty], [laser], 30)
    expect(out.map((f) => f.packets.length)).toEqual([1, 0])
  })

  it('snaps frames to the fps grid, last frame on a tick wins', () => {
    const frames = [frame(0.001, laserData(1)), frame(0.002, laserData(9))]
    const out = renderDmxPackets(frames, [laser], 30)
    expect(out.length).toBe(1)
    expect(out[0]!.tSec).toBe(0)
    expect(out[0]!.packets[0]![18]).toBe(9)
  })

  it('renders a panel blob across consecutive universes', () => {
    const patch = panelPatch('panel1', { wPx: 20, hPx: 10, pitchMm: 30 }, 5)
    const blob = new Uint8Array(600)
    blob[0] = 11 // pixel 0 R -> universe 5 channel 1
    blob[510] = 22 // pixel 170 R -> universe 6 channel 1
    blob[599] = 33 // last channel of universe 6
    const out = renderDmxPackets(
      [{ tSec: 0, byAsset: new Map([['panel1', blob]]) }],
      [patch],
      30,
    )
    expect(out[0]!.packets.length).toBe(2)
    const [u5, u6] = out[0]!.packets
    expect(u5![14]).toBe(5) // SubUni
    expect(u5!.length).toBe(18 + 510)
    expect(u5![18]).toBe(11)
    expect(u6![14]).toBe(6)
    expect(u6!.length).toBe(18 + 90)
    expect(u6![18]).toBe(22)
    expect(u6![18 + 89]).toBe(33)
  })

  it('throws when a blob is shorter than the patch expects', () => {
    const short: DmxFrame = { tSec: 0, byAsset: new Map([['laser1', new Uint8Array(4)]]) }
    expect(() => renderDmxPackets([short], [laser], 30)).toThrow(/channel data/)
  })

  it('throws on non-positive fps', () => {
    expect(() => renderDmxPackets([], [laser], 0)).toThrow(/fps/)
  })
})
