/**
 * Pure beam-audition + exposure-meter math (audio/beamMath.ts, hud scale):
 * gain/pan/delay at a seat, the murmur filter seed math, and the worst-cell
 * summed-carrier sweep on hand-built BeamStates. No AudioContext, no DOM.
 */
import { EAR_HEIGHT_M, SPEED_OF_SOUND_MPS } from '@theodoor/core'
import type { BeamFootprint, Vec2, Vec3 } from '@theodoor/core'
import { describe, expect, it } from 'vitest'
import {
  MAX_BEAM_DELAY_SEC,
  MONITOR_MAX_GAIN,
  MONITOR_REF_DB,
  MONITOR_REF_GAIN,
  monitorGain,
  murmurFcHz,
  seatDelaySec,
  seatLevelDb,
  seatPan,
  seatSlantM,
  worstCellCarrierDb,
} from '../src/audio/beamMath.js'
import {
  EXPOSURE_AMBER_DB,
  EXPOSURE_MAX_DB,
  EXPOSURE_MIN_DB,
  EXPOSURE_RED_DB,
  exposureFrac,
} from '../src/ui/hud.js'

/** Apex at ear height so slant = ground distance (easy exact numbers). */
const earApex: Vec3 = { x: 0, y: 0, z: EAR_HEIGHT_M }
const seat: Vec2 = { x: 0, y: -30 }
/** Footprint centered on the seat. */
const fpAtSeat: BeamFootprint = { cx: 0, cy: -30, a: 5, b: 5, azimuthDeg: 0 }
/** Footprint well away from the seat. */
const fpAway: BeamFootprint = { cx: 0, cy: -200, a: 5, b: 5, azimuthDeg: 0 }

describe('seatSlantM', () => {
  it('is the head-to-ear slant (elevation measured above ear height)', () => {
    expect(seatSlantM(earApex, seat)).toBeCloseTo(30, 9)
    expect(seatSlantM({ x: 0, y: 0, z: 25 }, seat)).toBeCloseTo(Math.hypot(30, 25 - EAR_HEIGHT_M), 9)
  })
})

describe('seatLevelDb / monitorGain', () => {
  it('propagates −6 dB per distance doubling from the 15 m reference', () => {
    const beam = { apex: earApex, footprint: fpAtSeat, audibleDbAtRef: 70 }
    expect(seatLevelDb(beam, seat)).toBeCloseTo(70 - 20 * Math.log10(30 / 15), 9)
  })

  it('in vs out of footprint is 20 dB — a 10× amplitude ratio', () => {
    const inBeam = { apex: earApex, footprint: fpAtSeat, audibleDbAtRef: 70 }
    const outBeam = { apex: earApex, footprint: fpAway, audibleDbAtRef: 70 }
    const inDb = seatLevelDb(inBeam, seat)
    const outDb = seatLevelDb(outBeam, seat)
    expect(inDb - outDb).toBeCloseTo(20, 9)
    expect(monitorGain(inDb) / monitorGain(outDb)).toBeCloseTo(10, 6)
  })

  it('anchors the monitor mapping at the reference and clamps the top', () => {
    expect(monitorGain(MONITOR_REF_DB)).toBeCloseTo(MONITOR_REF_GAIN, 9)
    expect(monitorGain(MONITOR_REF_DB + 20)).toBe(MONITOR_MAX_GAIN) // 2.5 → clamp
    expect(monitorGain(MONITOR_REF_DB - 20)).toBeCloseTo(MONITOR_REF_GAIN / 10, 9)
    expect(monitorGain(-Infinity)).toBe(0)
    expect(monitorGain(Number.NaN)).toBe(0)
  })
})

describe('seatDelaySec', () => {
  it('is slant / 343 plus the stereo-pair extraDelayMs', () => {
    const beam = { apex: earApex, footprint: fpAtSeat, audibleDbAtRef: 70 }
    expect(seatDelaySec(beam, seat)).toBeCloseTo(30 / SPEED_OF_SOUND_MPS, 12)
    expect(seatDelaySec({ ...beam, extraDelayMs: 15 }, seat)).toBeCloseTo(
      30 / SPEED_OF_SOUND_MPS + 0.015,
      12,
    )
  })

  it('caps at the DelayNode maxDelay (2 s)', () => {
    const far = { apex: { x: 0, y: 10_000, z: EAR_HEIGHT_M }, footprint: fpAway, audibleDbAtRef: 70 }
    expect(seatDelaySec(far, seat)).toBe(MAX_BEAM_DELAY_SEC)
  })
})

describe('seatPan', () => {
  it('flips sign east/west of the seat (seat faces the stage, +y)', () => {
    expect(seatPan({ x: 60, y: -30, z: 25 }, seat)).toBeCloseTo(1, 9) // due east
    expect(seatPan({ x: -60, y: -30, z: 25 }, seat)).toBeCloseTo(-1, 9) // due west
    expect(seatPan({ x: 0, y: 20, z: 25 }, seat)).toBeCloseTo(0, 9) // dead ahead
    expect(seatPan({ x: 10, y: -20, z: 25 }, seat)).toBeCloseTo(Math.sin(Math.PI / 4), 9)
  })
})

describe('murmurFcHz', () => {
  it('is deterministic per seed and spans the 300–2400 Hz speech band', () => {
    expect(murmurFcHz(1234)).toBe(murmurFcHz(1234))
    const fcs = [1, 2, 3, 99, 0xdead].map(murmurFcHz)
    for (const fc of fcs) {
      expect(fc).toBeGreaterThanOrEqual(300)
      expect(fc).toBeLessThanOrEqual(2400)
    }
    expect(new Set(fcs).size).toBe(fcs.length)
  })
})

describe('worstCellCarrierDb (exposure meter)', () => {
  const cellIn: Vec2 = { x: 0, y: -30 }
  const cellOut: Vec2 = { x: 0, y: -60 }
  const beam = { apex: earApex, footprint: fpAtSeat, carrierDbAtRef: 106 }

  it('propagates the carrier to each cell and takes the loudest', () => {
    const expectedIn = 106 - 20 * Math.log10(30 / 15)
    expect(worstCellCarrierDb([beam], [cellIn])).toBeCloseTo(expectedIn, 9)
    // Out-of-footprint cell is leakage-suppressed 20 dB on top of distance.
    const expectedOut = 106 - 20 * Math.log10(60 / 15) - 20
    expect(worstCellCarrierDb([beam], [cellOut])).toBeCloseTo(expectedOut, 9)
    expect(worstCellCarrierDb([beam], [cellOut, cellIn])).toBeCloseTo(expectedIn, 9)
  })

  it('power-sums concurrent beams (+3 dB for two equal sources)', () => {
    const one = worstCellCarrierDb([beam], [cellIn])
    const two = worstCellCarrierDb([beam, { ...beam }], [cellIn])
    expect(two - one).toBeCloseTo(10 * Math.log10(2), 9)
  })

  it('is -Infinity with no beams or no cells', () => {
    expect(worstCellCarrierDb([], [cellIn])).toBe(-Infinity)
    expect(worstCellCarrierDb([beam], [])).toBe(-Infinity)
  })
})

describe('exposure meter scale', () => {
  it('spans 60–130 dB with guides at 100 (amber) and 110 (red)', () => {
    expect(EXPOSURE_MIN_DB).toBe(60)
    expect(EXPOSURE_MAX_DB).toBe(130)
    expect(EXPOSURE_AMBER_DB).toBe(100)
    expect(EXPOSURE_RED_DB).toBe(110)
    expect(exposureFrac(60)).toBe(0)
    expect(exposureFrac(130)).toBe(1)
    expect(exposureFrac(95)).toBeCloseTo(0.5, 9)
    expect(exposureFrac(-Infinity)).toBe(0)
    expect(exposureFrac(200)).toBe(1)
  })
})
