import { describe, expect, it } from 'vitest'
import { ENERGY_DT_SEC } from '../src/contracts.js'
import type { MusicalTimeline } from '../src/contracts.js'
import { analyzePcm, analyzeWav } from '../src/music/analysis/annotate.js'
import { mulberry32 } from '../src/math/rng.js'
import { addBurst, buildWav, clickTrack } from './analysis-helpers.js'

const SR = 44100

/**
 * Click track at 120 BPM whose click level ramps up, three extra-loud "boom"
 * clicks, and an 880 Hz swell peaking at t = 18 s: a crescendo with outlier
 * hits and one unambiguous climax.
 */
function clickAndCrescendo(): Float32Array {
  const dur = 24
  const n = Math.round(dur * SR)
  const samples = new Float32Array(n)
  const rng = mulberry32(7)
  for (let t = 0.5; t <= dur - 0.5; t += 0.5) {
    const boom = t === 8 || t === 12 || t === 16
    addBurst(samples, SR, t, boom ? 3.0 : 0.3 + 0.4 * (t / dur), rng)
  }
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = t < 18 ? Math.pow(t / 18, 2) : Math.max(0, 1 - (t - 18) / 4)
    samples[i] = samples[i]! + 0.6 * env * Math.sin(2 * Math.PI * 880 * t)
  }
  return samples
}

/** The structural contract every analysis timeline must satisfy. */
function expectStructurallyValid(tl: MusicalTimeline): void {
  expect(tl.source).toBe('analysis')
  expect(tl.score).toBeUndefined()
  expect(tl.duration).toBeGreaterThanOrEqual(0)
  expect(tl.tempoConfidence).toBeGreaterThanOrEqual(0)
  expect(tl.tempoConfidence).toBeLessThanOrEqual(1)

  // Tempo map: single segment at beat 0, valid meter.
  expect(tl.tempo.segments.length).toBe(1)
  expect(tl.tempo.segments[0]!.beat).toBe(0)
  expect(tl.tempo.segments[0]!.bpm).toBeGreaterThan(0)
  expect(tl.tempo.meters.length).toBe(1)
  expect(tl.tempo.meters[0]!.bar).toBe(1)
  expect(tl.tempo.meters[0]!.beatsPerBar).toBeGreaterThan(0)

  // Beat arrays sorted ascending within [0, duration]; downbeats ⊆ beats.
  for (let i = 0; i < tl.beats.length; i++) {
    expect(tl.beats[i]!).toBeGreaterThanOrEqual(0)
    expect(tl.beats[i]!).toBeLessThanOrEqual(tl.duration + 1e-9)
    if (i > 0) expect(tl.beats[i]!).toBeGreaterThan(tl.beats[i - 1]!)
  }
  for (let i = 0; i < tl.downbeats.length; i++) {
    expect(tl.beats).toContain(tl.downbeats[i]!)
    if (i > 0) expect(tl.downbeats[i]!).toBeGreaterThan(tl.downbeats[i - 1]!)
  }

  // Annotations sorted, strengths and times in range.
  for (let i = 0; i < tl.annotations.length; i++) {
    const a = tl.annotations[i]!
    expect(a.time).toBeGreaterThanOrEqual(0)
    expect(a.time).toBeLessThanOrEqual(tl.duration + 1e-9)
    expect(a.strength).toBeGreaterThanOrEqual(0)
    expect(a.strength).toBeLessThanOrEqual(1)
    if (i > 0) expect(a.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
  }

  // Energy: uniform 50 ms grid, values normalized.
  expect(tl.energy.length).toBe(Math.ceil(tl.duration / ENERGY_DT_SEC - 1e-9))
  for (let i = 0; i < tl.energy.length; i++) {
    const e = tl.energy[i]!
    expect(e.time).toBeCloseTo(i * ENERGY_DT_SEC, 9)
    expect(e.rms).toBeGreaterThanOrEqual(0)
    expect(e.rms).toBeLessThanOrEqual(1)
    expect(e.loudness).toBeGreaterThanOrEqual(0)
    expect(e.loudness).toBeLessThanOrEqual(1)
  }
}

describe('analyzePcm', () => {
  const tl = analyzePcm(clickAndCrescendo(), SR, { id: 'cres', title: 'Crescendo Test' })

  it('produces a structurally valid analysis timeline', () => {
    expectStructurallyValid(tl)
    expect(tl.id).toBe('cres')
    expect(tl.title).toBe('Crescendo Test')
    expect(tl.duration).toBeCloseTo(24, 9)
  })

  it('recovers the 120 BPM grid with confidence', () => {
    expect(tl.tempoConfidence).toBeGreaterThan(0.5)
    expect(Math.abs(tl.tempo.segments[0]!.bpm - 120)).toBeLessThanOrEqual(2)
    expect(tl.tempo.meters[0]!.beatsPerBar).toBe(4)
    expect(tl.beats.length).toBeGreaterThan(40)
    // Downbeats are every 4th beat.
    expect(tl.downbeats.length).toBeGreaterThanOrEqual(Math.floor(tl.beats.length / 4))
  })

  it('places exactly one strength-1 climax at the crescendo peak', () => {
    const climaxes = tl.annotations.filter((a) => a.kind === 'climax')
    const primary = climaxes.filter((a) => a.strength === 1)
    expect(primary.length).toBe(1)
    expect(Math.abs(primary[0]!.time - 18)).toBeLessThanOrEqual(2.5)
    for (const c of climaxes) expect(c.strength).toBeGreaterThanOrEqual(0.85)
  })

  it('marks outlier onsets as hits', () => {
    const hits = tl.annotations.filter((a) => a.kind === 'hit')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    // Hits sit on the loud boom clicks (8, 12, or 16 s).
    for (const h of hits) {
      const near = [8, 12, 16].some((t) => Math.abs(h.time - t) < 0.05)
      expect(near).toBe(true)
    }
  })

  it('is deterministic', () => {
    const again = analyzePcm(clickAndCrescendo(), SR, { id: 'cres', title: 'Crescendo Test' })
    expect(again).toEqual(tl)
  })

  it('degrades to confidence 0 and empty beats on silence without throwing', () => {
    const silent = analyzePcm(new Float32Array(6 * SR), SR)
    expectStructurallyValid(silent)
    expect(silent.tempoConfidence).toBe(0)
    expect(silent.beats).toEqual([])
    expect(silent.downbeats).toEqual([])
    expect(silent.annotations).toEqual([])
  })

  it('degrades to confidence 0 on sub-4-second audio', () => {
    const { samples } = clickTrack({ bpm: 120, durationSec: 2, sampleRate: SR })
    const short = analyzePcm(samples, SR)
    expectStructurallyValid(short)
    expect(short.tempoConfidence).toBe(0)
    expect(short.beats).toEqual([])
  })

  it('handles empty input', () => {
    const empty = analyzePcm(new Float32Array(0), SR)
    expect(empty.duration).toBe(0)
    expect(empty.beats).toEqual([])
    expect(empty.energy).toEqual([])
    expect(empty.tempoConfidence).toBe(0)
  })

  it('honors meterHint', () => {
    const { samples } = clickTrack({ bpm: 120, durationSec: 8, sampleRate: SR })
    const tl3 = analyzePcm(samples, SR, { meterHint: 3 })
    expect(tl3.tempo.meters[0]!.beatsPerBar).toBe(3)
    if (tl3.downbeats.length >= 2) {
      const beatDur = 60 / tl3.tempo.segments[0]!.bpm
      expect(tl3.downbeats[1]! - tl3.downbeats[0]!).toBeCloseTo(3 * beatDur, 2)
    }
  })
})

describe('analyzeWav', () => {
  it('decodes and analyzes end-to-end from WAV bytes', () => {
    const durationSec = 8
    const { samples } = clickTrack({ bpm: 120, durationSec, sampleRate: 22050 })
    const bytes = buildWav({ sampleRate: 22050, channels: [samples], encoding: 'pcm16' })
    const tl = analyzeWav(bytes, { id: 'wav-e2e' })
    expectStructurallyValid(tl)
    expect(tl.id).toBe('wav-e2e')
    expect(tl.duration).toBeCloseTo(durationSec, 6)
    expect(tl.tempoConfidence).toBeGreaterThan(0.5)
    expect(Math.abs(tl.tempo.segments[0]!.bpm - 120)).toBeLessThanOrEqual(2)
  })
})
