import { describe, expect, it } from 'vitest'
import { detectOnsets } from '../src/music/analysis/onset.js'
import { clickTrack, nearestDist } from './analysis-helpers.js'

const SR = 44100

describe('detectOnsets', () => {
  it('finds every click of a 120 BPM track within ±20 ms and none in silence', () => {
    const { samples, clickTimes } = clickTrack({
      bpm: 120,
      durationSec: 8,
      sampleRate: SR,
      lastClickSec: 6, // ~2 s silent tail
    })
    const { onsets, envelope, hopSec } = detectOnsets(samples, SR)

    expect(hopSec).toBeCloseTo(512 / SR, 12)
    expect(envelope.length).toBe(Math.ceil(samples.length / 512))

    // Every click detected within ±20 ms.
    for (const c of clickTimes) {
      expect(nearestDist(onsets.map((o) => o.t), c)).toBeLessThanOrEqual(0.02)
    }
    // Every onset corresponds to a click (no spurious detections) …
    for (const o of onsets) {
      expect(nearestDist(clickTimes, o.t)).toBeLessThanOrEqual(0.02)
    }
    // … so in particular none in the silent tail.
    expect(onsets.filter((o) => o.t > 6.1).length).toBe(0)
  })

  it('respects the 30 ms minimum spacing', () => {
    // 20 ms burst spacing is below the reporting floor.
    const { samples } = clickTrack({
      bpm: 3000, // 0.02 s period
      durationSec: 5,
      sampleRate: SR,
      lastClickSec: 4,
    })
    const { onsets } = detectOnsets(samples, SR)
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i]!.t - onsets[i - 1]!.t).toBeGreaterThanOrEqual(0.03)
    }
  })

  it('reports onsets sorted with positive strengths', () => {
    const { samples } = clickTrack({ bpm: 90, durationSec: 6, sampleRate: SR })
    const { onsets } = detectOnsets(samples, SR)
    expect(onsets.length).toBeGreaterThan(0)
    for (let i = 0; i < onsets.length; i++) {
      expect(onsets[i]!.strength).toBeGreaterThan(0)
      if (i > 0) expect(onsets[i]!.t).toBeGreaterThan(onsets[i - 1]!.t)
    }
  })

  it('detects nothing in pure silence', () => {
    const silent = new Float32Array(4 * SR)
    const { onsets, envelope } = detectOnsets(silent, SR)
    expect(onsets).toEqual([])
    for (let i = 0; i < envelope.length; i++) expect(envelope[i]).toBe(0)
  })

  it('handles empty and tiny inputs without throwing', () => {
    expect(detectOnsets(new Float32Array(0), SR).onsets).toEqual([])
    expect(detectOnsets(new Float32Array(100), SR).onsets).toEqual([])
  })
})
