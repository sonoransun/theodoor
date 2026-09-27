/**
 * Doppler-like motion for swept beams (audio/beamMath.ts): the aim's radial
 * velocity from successive targets and the c/(c+v) playback rate with its
 * clamp. Pure math — BeamAudio applies it to the murmur source and filter.
 */
import { describe, expect, it } from 'vitest'
import { SPEED_OF_SOUND_MPS } from '@theodoor/core'
import {
  DOPPLER_RATE_MAX,
  DOPPLER_RATE_MIN,
  dopplerRate,
  radialVelocityMps,
} from '../src/audio/beamMath.js'

const seat = { x: 0, y: -200 }

describe('radialVelocityMps', () => {
  it('is positive when the aim recedes from the seat, negative when it approaches', () => {
    // Aim moves from 40 m north of the seat to 80 m north over 1 s.
    expect(radialVelocityMps({ x: 0, y: -160 }, { x: 0, y: -120 }, seat, 1)).toBeCloseTo(40, 9)
    expect(radialVelocityMps({ x: 0, y: -120 }, { x: 0, y: -160 }, seat, 1)).toBeCloseTo(-40, 9)
  })

  it('scales with dt and is 0 for a static aim or a non-positive dt', () => {
    expect(radialVelocityMps({ x: 0, y: -160 }, { x: 0, y: -120 }, seat, 0.5)).toBeCloseTo(80, 9)
    expect(radialVelocityMps({ x: 5, y: -150 }, { x: 5, y: -150 }, seat, 0.1)).toBe(0)
    expect(radialVelocityMps({ x: 0, y: -160 }, { x: 0, y: -120 }, seat, 0)).toBe(0)
    expect(radialVelocityMps({ x: 0, y: -160 }, { x: 0, y: -120 }, seat, -1)).toBe(0)
  })

  it('a tangential sweep at constant distance has no radial velocity', () => {
    const r = 50
    const a = { x: r * Math.sin(0.3), y: seat.y + r * Math.cos(0.3) }
    const b = { x: r * Math.sin(0.6), y: seat.y + r * Math.cos(0.6) }
    expect(radialVelocityMps(a, b, seat, 1)).toBeCloseTo(0, 9)
  })
})

describe('dopplerRate', () => {
  it('is c/(c+v): receding lowers the pitch, approaching raises it', () => {
    expect(dopplerRate(0)).toBe(1)
    expect(dopplerRate(40)).toBeCloseTo(SPEED_OF_SOUND_MPS / (SPEED_OF_SOUND_MPS + 40), 12)
    expect(dopplerRate(-40)).toBeCloseTo(SPEED_OF_SOUND_MPS / (SPEED_OF_SOUND_MPS - 40), 12)
    expect(dopplerRate(40)).toBeLessThan(1)
    expect(dopplerRate(-40)).toBeGreaterThan(1)
  })

  it('clamps to the audible-but-sane range and ignores non-finite input', () => {
    expect(dopplerRate(1e6)).toBe(DOPPLER_RATE_MIN)
    expect(dopplerRate(-300)).toBe(DOPPLER_RATE_MAX)
    expect(dopplerRate(Number.NaN)).toBe(1)
    expect(dopplerRate(Infinity)).toBe(1)
    expect(DOPPLER_RATE_MIN).toBeLessThan(1)
    expect(DOPPLER_RATE_MAX).toBeGreaterThan(1)
  })

  it('a lakeside flyover (~40 m/s across the lawn) shifts about ±2 semitones', () => {
    const semis = (r: number): number => 12 * Math.log2(r)
    expect(Math.abs(semis(dopplerRate(40)))).toBeGreaterThan(1.5)
    expect(Math.abs(semis(dopplerRate(40)))).toBeLessThan(2.5)
  })
})
