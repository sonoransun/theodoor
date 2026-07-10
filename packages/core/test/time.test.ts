import { describe, expect, it } from 'vitest'
import { MeterMap, TempoMap, gridTimes, tempoMapsFrom } from '../src/time/tempoMap.js'
import { nearestInSorted, quantizeTime } from '../src/time/quantize.js'
import { mulberry32 } from '../src/math/rng.js'

describe('TempoMap', () => {
  it('single segment: 120 bpm → 0.5 s per beat', () => {
    const tm = new TempoMap([{ beat: 0, bpm: 120 }])
    expect(tm.beatToSec(0)).toBe(0)
    expect(tm.beatToSec(4)).toBeCloseTo(2)
    expect(tm.secToBeat(2)).toBeCloseTo(4)
  })

  it('multi-segment boundaries are exact', () => {
    // 4 beats at 120 (2 s), then 60 bpm.
    const tm = new TempoMap([
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 60 },
    ])
    expect(tm.beatToSec(4)).toBeCloseTo(2)
    expect(tm.beatToSec(6)).toBeCloseTo(4)
    expect(tm.bpmAtBeat(3.999)).toBe(120)
    expect(tm.bpmAtBeat(4)).toBe(60)
  })

  it('round-trips 1000 random beats across 5 segments (< 1e-9)', () => {
    const tm = new TempoMap([
      { beat: 0, bpm: 88 },
      { beat: 16, bpm: 120 },
      { beat: 48, bpm: 96.5 },
      { beat: 64, bpm: 180 },
      { beat: 128, bpm: 72 },
    ])
    const rng = mulberry32(1234)
    for (let i = 0; i < 1000; i++) {
      const b = rng() * 200 - 8 // include pre-roll extrapolation
      expect(Math.abs(tm.secToBeat(tm.beatToSec(b)) - b)).toBeLessThan(1e-9)
    }
  })

  it('rejects invalid maps', () => {
    expect(() => new TempoMap([])).toThrow()
    expect(() => new TempoMap([{ beat: 1, bpm: 120 }])).toThrow()
    expect(() => new TempoMap([{ beat: 0, bpm: 0 }])).toThrow()
    expect(
      () => new TempoMap([{ beat: 0, bpm: 120 }, { beat: 0, bpm: 90 }]),
    ).toThrow()
  })
})

describe('MeterMap', () => {
  it('4/4 basics with 1-indexed bars and beats', () => {
    const mm = new MeterMap([{ bar: 1, beatsPerBar: 4 }])
    expect(mm.barBeatToBeat(1, 1)).toBe(0)
    expect(mm.barBeatToBeat(2, 1)).toBe(4)
    expect(mm.barBeatToBeat(2, 3.5)).toBe(6.5)
    expect(mm.beatToBarBeat(6.5)).toEqual({ bar: 2, beat: 3.5 })
  })

  it('meter change 3/4 → 4/4 at bar 5', () => {
    const mm = new MeterMap([
      { bar: 1, beatsPerBar: 3 },
      { bar: 5, beatsPerBar: 4 },
    ])
    expect(mm.barBeatToBeat(5, 1)).toBe(12)
    expect(mm.barBeatToBeat(6, 1)).toBe(16)
    expect(mm.beatToBarBeat(12)).toEqual({ bar: 5, beat: 1 })
    expect(mm.beatsPerBarAt(4)).toBe(3)
    expect(mm.beatsPerBarAt(5)).toBe(4)
  })

  it('pickup beats occupy bar 0', () => {
    const mm = new MeterMap([{ bar: 1, beatsPerBar: 4 }], 1)
    expect(mm.barBeatToBeat(1, 1)).toBe(1)
    expect(mm.beatToBarBeat(0).bar).toBe(0)
  })
})

describe('gridTimes', () => {
  it('emits beats and downbeats to duration', () => {
    const { tempo, meter } = tempoMapsFrom({
      segments: [{ beat: 0, bpm: 120 }],
      meters: [{ bar: 1, beatsPerBar: 4 }],
    })
    const { beats, downbeats } = gridTimes(tempo, meter, 4)
    expect(beats.length).toBe(9) // beats 0..8 at 0.5 s
    expect(downbeats).toEqual([0, 2, 4])
  })
})

describe('quantize', () => {
  const beats = [0, 0.5, 1, 1.5, 2]
  const downbeats = [0, 2]

  it('nearestInSorted', () => {
    expect(nearestInSorted(beats, 0.6)).toBe(0.5)
    expect(nearestInSorted(beats, 0.76)).toBe(1)
    expect(nearestInSorted(beats, -5)).toBe(0)
    expect(nearestInSorted(beats, 99)).toBe(2)
    expect(nearestInSorted([], 1)).toBeUndefined()
  })

  it('quantizes to beat, bar, halfBeat, none', () => {
    expect(quantizeTime(beats, downbeats, 0.6, 'beat')).toBe(0.5)
    expect(quantizeTime(beats, downbeats, 0.9, 'bar')).toBe(0)
    expect(quantizeTime(beats, downbeats, 1.1, 'bar')).toBe(2)
    expect(quantizeTime(beats, downbeats, 0.72, 'halfBeat')).toBe(0.75)
    expect(quantizeTime(beats, downbeats, 0.6, 'none')).toBe(0.6)
  })
})
