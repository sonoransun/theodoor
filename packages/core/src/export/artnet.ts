/**
 * export/artnet.ts — Art-Net ArtDmx packet bytes + fixed DMX channel patches.
 *
 * PURE byte builders: packets are Uint8Arrays; nothing here opens sockets or
 * writes files (live emission is gated elsewhere by the safety machine).
 *
 * ArtDmx layout (18-byte header, then data):
 *   off  0..7  : 'Art-Net\0'
 *   off  8..9  : OpDmx 0x5000, LITTLE-endian  (00 50)
 *   off 10..11 : protocol version 14, BIG-endian (00 0E)
 *   off 12     : sequence (0 disables sequencing)
 *   off 13     : physical
 *   off 14     : universe & 0xFF          (SubUni)
 *   off 15     : (universe >> 8) & 0x7F   (Net)
 *   off 16..17 : data length, BIG-endian (even, 2..512)
 *   off 18..   : channel data, zero-padded to even length
 */

import type { FountainBankSpec, PanelSpec, SearchlightBankSpec, Seconds } from '../contracts.js'

export interface ArtDmxParams {
  /** Rolling 1..255 per universe; 0 disables sequence tracking. */
  sequence: number
  /** Physical input port; informational. Default 0. */
  physical?: number
  /** 15-bit port-address: net(7 bits) << 8 | subuni(8 bits). */
  universe: number
  /** 1..512 channel bytes; odd lengths are zero-padded to even. */
  data: Uint8Array
}

const ARTNET_ID = [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00] // 'Art-Net\0'
export const ARTDMX_HEADER_LENGTH = 18

function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`artnet: ${name} must be an integer 0..255, got ${value}`)
  }
}

/** Build one ArtDmx packet (18-byte header + even-padded channel data). */
export function buildArtDmx(p: ArtDmxParams): Uint8Array {
  const { sequence, universe, data } = p
  const physical = p.physical ?? 0
  if (!Number.isInteger(universe) || universe < 0 || universe > 0x7fff) {
    throw new RangeError(`artnet: universe must be an integer 0..0x7fff, got ${universe}`)
  }
  if (data.length === 0) throw new RangeError('artnet: data must contain at least 1 channel')
  if (data.length > 512) {
    throw new RangeError(`artnet: data must be at most 512 channels, got ${data.length}`)
  }
  assertByte(sequence, 'sequence')
  assertByte(physical, 'physical')

  const length = data.length + (data.length % 2) // pad odd to even
  const out = new Uint8Array(ARTDMX_HEADER_LENGTH + length)
  out.set(ARTNET_ID, 0)
  out[8] = 0x00 // OpDmx low byte  (0x5000 little-endian)
  out[9] = 0x50 // OpDmx high byte
  out[10] = 0x00 // ProtVer hi (big-endian 14)
  out[11] = 0x0e // ProtVer lo
  out[12] = sequence
  out[13] = physical
  out[14] = universe & 0xff // SubUni
  out[15] = (universe >> 8) & 0x7f // Net
  out[16] = (length >> 8) & 0xff // length hi (big-endian)
  out[17] = length & 0xff // length lo
  out.set(data, 18) // trailing pad byte (if any) stays 0
  return out
}

// ---------------------------------------------------------------------------
// Channel patches — FIXED presets mapping asset channel blobs onto universes
// ---------------------------------------------------------------------------

export interface PatchSlice {
  universe: number
  /** 1-based DMX start channel within the universe. */
  channel: number
  /** Byte offset into the asset's channel-data blob. */
  offset: number
  /** Number of channels taken from the blob. */
  length: number
}

export interface ChannelPatch {
  assetId: string
  kind: 'panel' | 'laser' | 'fountain' | 'searchlight'
  /** Expected length of the asset's channel-data blob. */
  totalChannels: number
  slices: readonly PatchSlice[]
}

/** RGB pixels per universe (170 px × 3 ch = 510 of 512 channels). */
export const PANEL_PIXELS_PER_UNIVERSE = 170

/**
 * Fixed panel preset: RGB pixels row-major (y*wPx + x), 3 channels per pixel,
 * 170 pixels per universe, consecutive universes from `startUniverse`.
 */
export function panelPatch(assetId: string, panel: PanelSpec, startUniverse: number): ChannelPatch {
  const pixels = panel.wPx * panel.hPx
  if (pixels <= 0) throw new RangeError(`artnet: panel '${assetId}' has no pixels`)
  const universes = Math.ceil(pixels / PANEL_PIXELS_PER_UNIVERSE)
  const lastUniverse = startUniverse + universes - 1
  if (startUniverse < 0 || lastUniverse > 0x7fff) {
    throw new RangeError(
      `artnet: panel '${assetId}' universes ${startUniverse}..${lastUniverse} out of 0..0x7fff`,
    )
  }
  const slices: PatchSlice[] = []
  for (let u = 0; u < universes; u++) {
    const pxStart = u * PANEL_PIXELS_PER_UNIVERSE
    const px = Math.min(PANEL_PIXELS_PER_UNIVERSE, pixels - pxStart)
    slices.push({ universe: startUniverse + u, channel: 1, offset: pxStart * 3, length: px * 3 })
  }
  return { assetId, kind: 'panel', totalChannels: pixels * 3, slices }
}

/** Fixed laser preset slot order (8 channels starting at channel 1). */
export const LASER_SLOTS = [
  'pan',
  'tilt',
  'r',
  'g',
  'b',
  'intensity',
  'mode',
  'reserved',
] as const

/** Fixed laser preset: 8 slots [pan, tilt, r, g, b, intensity, mode, reserved]. */
export function laserPatch(assetId: string, universe: number): ChannelPatch {
  if (!Number.isInteger(universe) || universe < 0 || universe > 0x7fff) {
    throw new RangeError(`artnet: laser '${assetId}' universe out of 0..0x7fff: ${universe}`)
  }
  return {
    assetId,
    kind: 'laser',
    totalChannels: LASER_SLOTS.length,
    slices: [{ universe, channel: 1, offset: 0, length: LASER_SLOTS.length }],
  }
}

/** Fixed fountain preset slot order per nozzle (4 channels each, nozzle-major). */
export const FOUNTAIN_SLOTS = ['level', 'r', 'g', 'b'] as const

/**
 * Fixed fountain preset: per nozzle [level, r, g, b] (level = column height
 * over the bank maximum), nozzle-major from channel 1 — up to 128 nozzles in
 * one universe.
 */
export function fountainPatch(assetId: string, bank: FountainBankSpec, universe: number): ChannelPatch {
  if (!Number.isInteger(universe) || universe < 0 || universe > 0x7fff) {
    throw new RangeError(`artnet: fountain '${assetId}' universe out of 0..0x7fff: ${universe}`)
  }
  const nozzles = Math.max(1, Math.floor(bank.nozzles))
  const total = nozzles * FOUNTAIN_SLOTS.length
  if (total > 512) {
    throw new RangeError(`artnet: fountain '${assetId}' needs ${total} channels (> 512 in one universe)`)
  }
  return {
    assetId,
    kind: 'fountain',
    totalChannels: total,
    slices: [{ universe, channel: 1, offset: 0, length: total }],
  }
}

/** Fixed moving-head preset slot order per head (6 channels each, head-major). */
export const SEARCHLIGHT_SLOTS = ['pan', 'tilt', 'dimmer', 'r', 'g', 'b'] as const

/**
 * Fixed searchlight preset: per head [pan, tilt, dimmer, r, g, b], head-major
 * from channel 1 — up to 85 heads in one universe.
 */
export function searchlightPatch(
  assetId: string,
  bank: SearchlightBankSpec,
  universe: number,
): ChannelPatch {
  if (!Number.isInteger(universe) || universe < 0 || universe > 0x7fff) {
    throw new RangeError(`artnet: searchlight '${assetId}' universe out of 0..0x7fff: ${universe}`)
  }
  const heads = Math.max(1, Math.floor(bank.heads))
  const total = heads * SEARCHLIGHT_SLOTS.length
  if (total > 512) {
    throw new RangeError(`artnet: searchlight '${assetId}' needs ${total} channels (> 512 in one universe)`)
  }
  return {
    assetId,
    kind: 'searchlight',
    totalChannels: total,
    slices: [{ universe, channel: 1, offset: 0, length: total }],
  }
}

// ---------------------------------------------------------------------------
// Frame rendering — pure over caller-provided channel data
// ---------------------------------------------------------------------------

export interface DmxFrame {
  tSec: Seconds
  /** Per-asset channel-data blob (layout defined by that asset's patch). */
  byAsset: ReadonlyMap<string, Uint8Array>
}

export interface DmxPacketFrame {
  tSec: Seconds
  packets: Uint8Array[]
}

interface UniverseState {
  /** Channels used in this universe (max slice extent). */
  capacity: number
  current: Uint8Array
  lastSent: Uint8Array | null
  /** Next sequence number to stamp (1..255; 0 never used). */
  sequence: number
}

/**
 * Render ArtDmx packets for a sequence of frames.
 *
 * Frames are snapped to the fps grid (index = round(tSec*fps); when several
 * input frames land on one tick, the last wins) and processed in tick order.
 * Assets absent from a frame's `byAsset` simply keep their previous channel
 * values. Per-universe: unchanged data is diff-skipped (no packet), and each
 * emitted packet advances that universe's sequence counter 1..255, wrapping
 * back to 1 (0 is skipped — it means 'sequence disabled' on the wire).
 */
export function renderDmxPackets(
  frames: readonly DmxFrame[],
  patches: readonly ChannelPatch[],
  fps: number,
): DmxPacketFrame[] {
  if (!(fps > 0) || !Number.isFinite(fps)) {
    throw new RangeError(`artnet: fps must be a positive finite number, got ${fps}`)
  }

  // Universe capacities from the patch set.
  const universes = new Map<number, UniverseState>()
  for (const patch of patches) {
    for (const s of patch.slices) {
      const need = s.channel - 1 + s.length
      if (need > 512) {
        throw new RangeError(
          `artnet: patch '${patch.assetId}' exceeds 512 channels in universe ${s.universe}`,
        )
      }
      const state = universes.get(s.universe)
      if (state) state.capacity = Math.max(state.capacity, need)
      else universes.set(s.universe, { capacity: need, current: new Uint8Array(0), lastSent: null, sequence: 1 })
    }
  }
  const universeOrder = [...universes.keys()].sort((a, b) => a - b)
  for (const u of universeOrder) {
    const state = universes.get(u)!
    state.current = new Uint8Array(state.capacity)
  }

  // Snap frames to the fps grid; last frame on a tick wins.
  const byTick = new Map<number, DmxFrame>()
  for (const frame of frames) byTick.set(Math.round(frame.tSec * fps), frame)
  const ticks = [...byTick.keys()].sort((a, b) => a - b)

  const out: DmxPacketFrame[] = []
  for (const tick of ticks) {
    const frame = byTick.get(tick)!
    for (const patch of patches) {
      const blob = frame.byAsset.get(patch.assetId)
      if (!blob) continue
      if (blob.length < patch.totalChannels) {
        throw new RangeError(
          `artnet: asset '${patch.assetId}' channel data has ${blob.length} bytes, patch needs ${patch.totalChannels}`,
        )
      }
      for (const s of patch.slices) {
        universes.get(s.universe)!.current.set(blob.subarray(s.offset, s.offset + s.length), s.channel - 1)
      }
    }

    const packets: Uint8Array[] = []
    for (const u of universeOrder) {
      const state = universes.get(u)!
      if (state.lastSent && bytesEqual(state.lastSent, state.current)) continue // diff-skip
      packets.push(buildArtDmx({ sequence: state.sequence, universe: u, data: state.current.slice() }))
      state.sequence = state.sequence >= 255 ? 1 : state.sequence + 1
      state.lastSent = state.current.slice()
    }
    out.push({ tSec: tick / fps, packets })
  }
  return out
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
