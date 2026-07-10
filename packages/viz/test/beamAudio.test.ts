/**
 * Pure lifecycle decision logic for the beam audition (audio/beamAudio.ts):
 * hidden-tab gain gating, the click-free release horizon, and reap-list
 * partitioning. No AudioContext, no DOM — BeamAudio wires these helpers to
 * Web Audio nodes; the decisions themselves are exercised here in Node.
 */
import { describe, expect, it } from 'vitest'
import {
  BEAM_RELEASE_TAU_MULTIPLE,
  BEAM_SMOOTH_TAU_SEC,
  chainGainTarget,
  chainReleaseSec,
  partitionReaping,
} from '../src/audio/beamAudio.js'
import { MAX_BEAM_DELAY_SEC, monitorGain } from '../src/audio/beamMath.js'

describe('chainGainTarget (transport + visibility gating)', () => {
  it('targets the seat monitor gain when playing, visible, and seated', () => {
    expect(chainGainTarget(true, false, 66)).toBeCloseTo(monitorGain(66), 12)
    expect(chainGainTarget(true, false, 40)).toBeCloseTo(monitorGain(40), 12)
  })

  it('mutes when the document is hidden, even mid-cue at an audible seat', () => {
    // Regression (hidden-tab silence): background tabs keep rendering audio
    // while rAF halts, so the visibility path must always target 0 — the
    // looping murmur otherwise drones at its frozen gain for as long as the
    // tab stays hidden.
    expect(chainGainTarget(true, true, 66)).toBe(0)
    expect(chainGainTarget(true, true, 120)).toBe(0)
  })

  it('mutes when paused or seatless regardless of visibility', () => {
    expect(chainGainTarget(false, false, 66)).toBe(0)
    expect(chainGainTarget(false, true, 66)).toBe(0)
    expect(chainGainTarget(true, false, null)).toBe(0)
    expect(chainGainTarget(false, false, null)).toBe(0)
  })
})

describe('chainReleaseSec (click-free release horizon)', () => {
  it('is 8×tau plus the delay-line drain time', () => {
    expect(chainReleaseSec(0)).toBeCloseTo(BEAM_RELEASE_TAU_MULTIPLE * BEAM_SMOOTH_TAU_SEC, 12)
    expect(chainReleaseSec(0.35)).toBeCloseTo(
      BEAM_RELEASE_TAU_MULTIPLE * BEAM_SMOOTH_TAU_SEC + 0.35,
      12,
    )
    expect(chainReleaseSec(MAX_BEAM_DELAY_SEC)).toBeCloseTo(
      BEAM_RELEASE_TAU_MULTIPLE * BEAM_SMOOTH_TAU_SEC + MAX_BEAM_DELAY_SEC,
      12,
    )
  })

  it('is strictly positive: a released chain is never stopped on the same frame', () => {
    // Regression (click-free disposal): the old path called src.stop() the
    // instant a cue left the active set, truncating the waveform while the
    // gain was still at its audible monitor level — a pop at every cue end.
    expect(chainReleaseSec(0)).toBeGreaterThan(0)
  })

  it('decays the release ramp below -60 dB before teardown', () => {
    // setTargetAtTime reaches e^-(t/tau) of the starting gain; the horizon
    // must sit deep enough that stopping the source is inaudible.
    const decay = Math.exp(-chainReleaseSec(0) / BEAM_SMOOTH_TAU_SEC)
    expect(20 * Math.log10(decay)).toBeLessThan(-60)
  })

  it('clamps a negative delay reading to zero drain', () => {
    expect(chainReleaseSec(-1)).toBeCloseTo(BEAM_RELEASE_TAU_MULTIPLE * BEAM_SMOOTH_TAU_SEC, 12)
  })
})

describe('partitionReaping (release-list sweep)', () => {
  const entries = [
    { reapAtSec: 1.0, id: 'a' },
    { reapAtSec: 2.5, id: 'b' },
    { reapAtSec: 4.0, id: 'c' },
  ] as const

  it('keeps every chain that is still draining', () => {
    const { due, keep } = partitionReaping(entries, 0.5)
    expect(due).toEqual([])
    expect(keep.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('reaps exactly the chains whose horizon has elapsed (inclusive)', () => {
    const { due, keep } = partitionReaping(entries, 2.5)
    expect(due.map((e) => e.id)).toEqual(['a', 'b'])
    expect(keep.map((e) => e.id)).toEqual(['c'])
  })

  it('reaps everything after a long gap (seek far ahead, throttled rAF)', () => {
    // Regression: update() must still tear released chains down when the
    // next call arrives long after their horizons, not leak them.
    const { due, keep } = partitionReaping(entries, 1e9)
    expect(due.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(keep).toEqual([])
  })

  it('handles an empty list', () => {
    expect(partitionReaping([], 10)).toEqual({ due: [], keep: [] })
  })
})
