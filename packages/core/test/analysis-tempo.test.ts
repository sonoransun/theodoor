import { describe, expect, it } from 'vitest'
import { detectOnsets } from '../src/music/analysis/onset.js'
import { estimateTempo } from '../src/music/analysis/tempoEst.js'
import { clickTrack, nearestDist } from './analysis-helpers.js'

const SR = 44100

function estimateFor(bpm: number, durationSec = 10, seed = 42) {
  const track = clickTrack({ bpm, durationSec, sampleRate: SR, seed })
  const onset = detectOnsets(track.samples, SR)
  return { est: estimateTempo(onset, durationSec), ...track }
}

describe('estimateTempo', () => {
  for (const bpm of [60, 90, 120, 144, 180]) {
    it(`recovers ${bpm} BPM within ±2 and phase within ±30 ms`, () => {
      const { est, clickTimes } = estimateFor(bpm)
      expect(Math.abs(est.bpm - bpm)).toBeLessThanOrEqual(2)
      expect(est.confidence).toBeGreaterThan(0.5)
      // Every fitted beat inside the click span lies within 30 ms of a click.
      const inSpan = est.beats.filter(
        (b) => b >= clickTimes[0]! - 0.05 && b <= clickTimes[clickTimes.length - 1]! + 0.05,
      )
      expect(inSpan.length).toBeGreaterThan(clickTimes.length * 0.8)
      for (const b of inSpan) {
        expect(nearestDist(clickTimes, b)).toBeLessThanOrEqual(0.03)
      }
    })
  }

  it('log-Gaussian prior picks 120 over 240 on a 240 BPM click train', () => {
    const { est } = estimateFor(240)
    expect(Math.abs(est.bpm - 120)).toBeLessThanOrEqual(2)
  })

  it('produces a sorted beat grid covering [0, duration] with every meterHint-th downbeat', () => {
    const { est } = estimateFor(120)
    expect(est.beats.length).toBeGreaterThan(0)
    for (let i = 0; i < est.beats.length; i++) {
      expect(est.beats[i]!).toBeGreaterThanOrEqual(0)
      expect(est.beats[i]!).toBeLessThanOrEqual(10)
      if (i > 0) expect(est.beats[i]!).toBeGreaterThan(est.beats[i - 1]!)
    }
    expect(est.downbeats.length).toBe(
      Math.ceil((est.beats.length - est.downbeatOffset) / 4),
    )
    // Downbeats are actual beats, 4 beat-steps apart.
    for (const d of est.downbeats) expect(est.beats).toContain(d)
    for (let i = 1; i < est.downbeats.length; i++) {
      expect(est.downbeats[i]! - est.downbeats[i - 1]!).toBeCloseTo(4 * est.periodSec, 3)
    }
  })

  it('locks downbeats to accented clicks (every 4th click louder)', () => {
    const durationSec = 10
    const accented: number[] = []
    const track = clickTrack({
      bpm: 120,
      durationSec,
      sampleRate: SR,
      seed: 11,
      firstClickSec: 0.75,
      amp: (i) => (i % 4 === 1 ? 1.0 : 0.3),
    })
    track.clickTimes.forEach((t, i) => {
      if (i % 4 === 1) accented.push(t)
    })
    const est = estimateTempo(detectOnsets(track.samples, SR), durationSec)
    expect(Math.abs(est.bpm - 120)).toBeLessThanOrEqual(2)
    for (const d of est.downbeats) {
      expect(nearestDist(accented, d)).toBeLessThanOrEqual(0.03)
    }
  })

  it('supports meterHint 3', () => {
    const durationSec = 10
    const track = clickTrack({
      bpm: 120,
      durationSec,
      sampleRate: SR,
      seed: 13,
      amp: (i) => (i % 3 === 0 ? 1.0 : 0.3),
    })
    const est = estimateTempo(detectOnsets(track.samples, SR), durationSec, { meterHint: 3 })
    expect(Math.abs(est.bpm - 120)).toBeLessThanOrEqual(2)
    for (let i = 1; i < est.downbeats.length; i++) {
      expect(est.downbeats[i]! - est.downbeats[i - 1]!).toBeCloseTo(3 * est.periodSec, 3)
    }
  })

  it('returns confidence 0 and empty beats for silence', () => {
    const silent = new Float32Array(8 * SR)
    const est = estimateTempo(detectOnsets(silent, SR), 8)
    expect(est.confidence).toBe(0)
    expect(est.beats).toEqual([])
    expect(est.downbeats).toEqual([])
  })

  it('returns confidence 0 for envelopes too short to autocorrelate', () => {
    const { samples } = clickTrack({ bpm: 120, durationSec: 1, sampleRate: SR })
    const est = estimateTempo(detectOnsets(samples, SR), 1)
    expect(est.confidence).toBe(0)
    expect(est.beats).toEqual([])
  })
})
