/**
 * export-artnet-fountain.test.ts — fountain banks as DMX fixtures: the fixed
 * 4-channel-per-nozzle patch, the channel blob at the crest, and diff-skipped
 * packet rendering over a short frame sequence.
 */
import { describe, expect, it } from 'vitest'
import type { FountainBankSpec, JetState } from '../src/contracts.js'
import {
  FOUNTAIN_SLOTS,
  fountainPatch,
  renderDmxPackets,
  type DmxFrame,
} from '../src/export/index.js'
import { lakesidePark } from '../src/site/index.js'
import { FOUNTAIN_SLOTS_PER_NOZZLE, fountainChannelsAt } from '../src/sim/fountains.js'

const site = lakesidePark()
const bank = site.assets.find((a) => a.id === 'fount-west')!
const spec: FountainBankSpec = bank.fountainBank!

describe('fountainPatch', () => {
  it('maps 9 nozzles × [level, r, g, b] onto 36 consecutive channels of one universe', () => {
    const patch = fountainPatch('fount-west', spec, 3)
    expect(FOUNTAIN_SLOTS).toEqual(['level', 'r', 'g', 'b'])
    expect(FOUNTAIN_SLOTS.length).toBe(FOUNTAIN_SLOTS_PER_NOZZLE)
    expect(patch.kind).toBe('fountain')
    expect(patch.totalChannels).toBe(36)
    expect(patch.slices).toEqual([{ universe: 3, channel: 1, offset: 0, length: 36 }])
  })

  it('rejects universes out of range and rows that overflow a universe', () => {
    expect(() => fountainPatch('x', spec, -1)).toThrow(RangeError)
    expect(() => fountainPatch('x', spec, 0x8000)).toThrow(RangeError)
    expect(() => fountainPatch('x', { ...spec, nozzles: 129 }, 0)).toThrow(/512/)
    expect(fountainPatch('x', { ...spec, nozzles: 128 }, 0).totalChannels).toBe(512)
  })
})

describe('fountainChannelsAt → renderDmxPackets', () => {
  const jet = (nozzle: number, heightM: number): JetState => ({
    cueIdx: 0,
    assetId: 'fount-west',
    nozzle,
    base: { x: 0, y: 14, z: 0 },
    heightM,
    crestM: 30,
    tipDx: 0,
    tipDy: 0,
    widthM: 1.2,
    r: 0x7f / 255,
    g: 0xd4 / 255,
    b: 1,
    phase: 'holding',
    crested: true,
  })

  it('level is 255 · height / maxHeightM at the crest; dry nozzles are zero', () => {
    const blob = fountainChannelsAt([jet(4, 30)], bank, spec)
    expect([...blob.subarray(16, 20)]).toEqual([170, 0x7f, 0xd4, 0xff])
    expect(blob.reduce((s, v) => s + v, 0)).toBe(170 + 0x7f + 0xd4 + 0xff)
    expect([...fountainChannelsAt([jet(4, 45)], bank, spec).subarray(16, 17)]).toEqual([255])
    expect([...fountainChannelsAt([jet(4, 60)], bank, spec).subarray(16, 17)]).toEqual([255]) // clamped
    expect(fountainChannelsAt([], bank, spec).every((v) => v === 0)).toBe(true)
  })

  it('diff-skips unchanged universes and stamps a rolling sequence', () => {
    const patch = fountainPatch('fount-west', spec, 0)
    const dry = new Uint8Array(36)
    const up = fountainChannelsAt([jet(3, 30), jet(4, 30), jet(5, 30)], bank, spec)
    const frames: DmxFrame[] = [
      { tSec: 0, byAsset: new Map([['fount-west', dry]]) },
      { tSec: 1 / 30, byAsset: new Map([['fount-west', up]]) },
      { tSec: 2 / 30, byAsset: new Map([['fount-west', up]]) },
      { tSec: 3 / 30, byAsset: new Map([['fount-west', dry]]) },
    ]
    const out = renderDmxPackets(frames, [patch], 30)
    expect(out.map((f) => f.packets.length)).toEqual([1, 1, 0, 1])
    const second = out[1]!.packets[0]!
    expect(second[12]).toBe(2) // sequence
    expect([...second.subarray(18, 18 + 36)]).toEqual([...up])
    expect(second[14]).toBe(0) // universe 0
  })

  it('a fountain patch coexists with a laser universe without overlap', () => {
    const laserBlob = new Uint8Array(8)
    const patch = fountainPatch('fount-east', spec, 1)
    const frames: DmxFrame[] = [
      { tSec: 0, byAsset: new Map([['fount-east', fountainChannelsAt([{ ...jet(0, 15), assetId: 'fount-east' }], site.assets.find((a) => a.id === 'fount-east')!, spec)]]) },
    ]
    const out = renderDmxPackets(frames, [patch], 30)
    expect(out[0]!.packets).toHaveLength(1)
    expect(out[0]!.packets[0]![14]).toBe(1)
    expect(out[0]!.packets[0]![18]).toBe(Math.round((255 * 15) / 45))
    expect(laserBlob.length).toBe(8)
  })
})
