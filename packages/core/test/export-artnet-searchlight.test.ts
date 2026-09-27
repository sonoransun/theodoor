/**
 * Searchlight banks as DMX moving heads: the fixed 6-channel-per-head patch
 * (export/artnet searchlightPatch) and the per-step channel blob the sim
 * derives from head states (sim/lights searchlightChannelsAt), rendered
 * through renderDmxPackets like any other fixture.
 */
import { describe, expect, it } from 'vitest'
import type { LightState, PositionedAsset, SearchlightBankSpec } from '../src/contracts.js'
import { dirFromTilt } from '../src/choreo/generators/searchlight.js'
import {
  SEARCHLIGHT_SLOTS,
  renderDmxPackets,
  searchlightPatch,
  type DmxFrame,
} from '../src/export/index.js'
import { lakesidePark } from '../src/site/index.js'
import { SEARCHLIGHT_SLOTS_PER_HEAD, searchlightChannelsAt } from '../src/sim/lights.js'

const site = lakesidePark()
const west = site.assets.find((a) => a.id === 'lights-west')!
const spec: SearchlightBankSpec = west.searchlightBank!

function state(head: number, dir: LightState['dir'], intensity: number, rgb: [number, number, number], assetId = west.id): LightState {
  return {
    cueIdx: 0,
    assetId,
    head,
    base: { x: 0, y: 0, z: 1.5 },
    dir,
    reachM: 600,
    halfAngleDeg: 1,
    r: rgb[0],
    g: rgb[1],
    b: rgb[2],
    intensity,
    slewing: false,
  }
}

describe('searchlightPatch', () => {
  it('lays 6 channels per head, head-major from channel 1, in one universe', () => {
    const patch = searchlightPatch('lights-west', spec, 7)
    expect(SEARCHLIGHT_SLOTS).toEqual(['pan', 'tilt', 'dimmer', 'r', 'g', 'b'])
    expect(SEARCHLIGHT_SLOTS_PER_HEAD).toBe(SEARCHLIGHT_SLOTS.length)
    expect(patch.kind).toBe('searchlight')
    expect(patch.totalChannels).toBe(24)
    expect(patch.slices).toEqual([{ universe: 7, channel: 1, offset: 0, length: 24 }])
  })

  it('rejects out-of-range universes and banks that overflow one universe', () => {
    expect(() => searchlightPatch('x', spec, -1)).toThrow(RangeError)
    expect(() => searchlightPatch('x', spec, 0x8000)).toThrow(RangeError)
    expect(() => searchlightPatch('x', { ...spec, heads: 86 }, 0)).toThrow(/512/)
    expect(searchlightPatch('x', { ...spec, heads: 85 }, 0).totalChannels).toBe(510)
  })
})

describe('searchlightChannelsAt', () => {
  it('encodes pan from the world azimuth, tilt over maxTiltDeg, dimmer, and intensity-scaled color', () => {
    const east30 = dirFromTilt(30, 90) // 30° from vertical toward east
    const blob = searchlightChannelsAt([state(1, east30, 1, [1, 0.5, 0])], west, spec)
    expect(blob.length).toBe(24)
    const o = 1 * SEARCHLIGHT_SLOTS_PER_HEAD
    expect(blob[o]).toBe(Math.round((90 / 360) * 255)) // pan 64
    expect(blob[o + 1]).toBe(Math.round((30 / 75) * 255)) // tilt 102
    expect(blob[o + 2]).toBe(255)
    expect(blob[o + 3]).toBe(255)
    expect(blob[o + 4]).toBe(128)
    expect(blob[o + 5]).toBe(0)
    // Every other head stays dark.
    for (const h of [0, 2, 3]) {
      for (let k = 0; k < 6; k++) expect(blob[h * 6 + k]).toBe(0)
    }
  })

  it('a vertical head has pan 0 and tilt 0; a south-west aim wraps pan into 0..255', () => {
    const up = searchlightChannelsAt([state(0, { x: 0, y: 0, z: 1 }, 1, [1, 1, 1])], west, spec)
    expect(up[0]).toBe(0)
    expect(up[1]).toBe(0)
    expect(up[2]).toBe(255)
    const sw = searchlightChannelsAt([state(0, dirFromTilt(20, -135), 1, [1, 1, 1])], west, spec)
    expect(sw[0]).toBe(Math.round((225 / 360) * 255))
    expect(sw[1]).toBe(Math.round((20 / 75) * 255))
  })

  it('half intensity halves the dimmer and the color bytes', () => {
    const blob = searchlightChannelsAt([state(2, dirFromTilt(10, 0), 0.5, [1, 0.5, 0.25])], west, spec)
    const o = 12
    expect(blob[o + 2]).toBe(128)
    expect(blob[o + 3]).toBe(128)
    expect(blob[o + 4]).toBe(64)
    expect(blob[o + 5]).toBe(32)
  })

  it('MAX-blends concurrent states on one head by dimmer (order-independent) and ignores other assets', () => {
    const dim = state(0, dirFromTilt(10, 90), 0.3, [1, 1, 1])
    const bright = state(0, dirFromTilt(40, 270), 0.9, [0, 1, 0])
    const other = state(0, dirFromTilt(60, 0), 1, [1, 0, 0], 'lights-east')
    const a = searchlightChannelsAt([dim, bright, other], west, spec)
    const b = searchlightChannelsAt([other, bright, dim], west, spec)
    expect([...a]).toEqual([...b])
    expect(a[0]).toBe(Math.round((270 / 360) * 255))
    expect(a[1]).toBe(Math.round((40 / 75) * 255))
    expect(a[2]).toBe(Math.round(0.9 * 255))
    expect(a[3]).toBe(0)
    expect(a[4]).toBe(Math.round(0.9 * 255))
  })

  it('ignores heads outside the bank and a zero maxTiltDeg spec', () => {
    const blob = searchlightChannelsAt([state(9, dirFromTilt(30, 90), 1, [1, 1, 1])], west, spec)
    expect([...blob].every((v) => v === 0)).toBe(true)
    const flat = searchlightChannelsAt([state(0, dirFromTilt(30, 90), 1, [1, 1, 1])], west, { ...spec, maxTiltDeg: 0 })
    expect(flat[1]).toBe(0)
  })
})

describe('renderDmxPackets with a searchlight patch', () => {
  it('emits the bank blob as universe data and diff-skips unchanged frames', () => {
    const patch = searchlightPatch(west.id, spec, 3)
    const blob = searchlightChannelsAt([state(1, dirFromTilt(30, 90), 1, [1, 0.5, 0])], west, spec)
    const frames: DmxFrame[] = [
      { tSec: 0, byAsset: new Map([[west.id, blob]]) },
      { tSec: 1 / 30, byAsset: new Map([[west.id, blob]]) },
      { tSec: 2 / 30, byAsset: new Map([[west.id, new Uint8Array(24)]]) },
    ]
    const out = renderDmxPackets(frames, [patch], 30)
    expect(out).toHaveLength(3)
    expect(out[0]!.packets).toHaveLength(1)
    expect([...out[0]!.packets[0]!.subarray(18, 18 + 24)]).toEqual([...blob])
    expect(out[0]!.packets[0]![14]).toBe(3) // SubUni
    expect(out[1]!.packets).toHaveLength(0) // unchanged → skipped
    expect(out[2]!.packets).toHaveLength(1) // blackout emitted
  })

  it('a bank with no spec is never patched (the CLI only patches spec-bearing banks)', () => {
    const bare: PositionedAsset = { ...west, searchlightBank: undefined }
    expect(bare.searchlightBank).toBeUndefined()
  })
})
