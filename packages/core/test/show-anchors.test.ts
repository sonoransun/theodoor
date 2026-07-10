import { describe, expect, it } from 'vitest'
import type { MusicAnchor, MusicalTimeline } from '../src/contracts.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { beatIndexToSec, resolveAnchor, secToBeatIndex } from '../src/show/index.js'

/** Hand-built analysis-like timeline with an IRREGULAR beat grid. */
function analysisTimeline(): MusicalTimeline {
  return {
    source: 'analysis',
    id: 'synthetic-analysis',
    title: 'Synthetic Analysis',
    duration: 5,
    tempo: { segments: [{ beat: 0, bpm: 110 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats: [0, 0.5, 1.0, 1.6, 2.3, 3.1, 4.0],
    downbeats: [0, 2.3],
    annotations: [
      { time: 0.5, kind: 'hit', strength: 0.8, label: 'cannon' },
      { time: 1.6, kind: 'hit', strength: 0.9, label: 'cannon' },
      { time: 2.3, kind: 'phrase', strength: 0.6, label: 'phraseEnd' },
      { time: 3.1, kind: 'climax', strength: 1 },
    ],
    energy: [],
    tempoConfidence: 0.8,
  }
}

const odeTl = buildTimelineFromScore(getScore('odeToJoy')!)

describe('beatIndexToSec', () => {
  it('interpolates the beats ARRAY at fractional indices (beat 4.5 = midpoint of beats[4], beats[5])', () => {
    const tl = analysisTimeline()
    expect(beatIndexToSec(tl, 4.5)).toBeCloseTo((2.3 + 3.1) / 2, 12)
    expect(beatIndexToSec(tl, 3.5)).toBeCloseTo((1.6 + 2.3) / 2, 12)
    expect(beatIndexToSec(tl, 0)).toBe(0)
    expect(beatIndexToSec(tl, 6)).toBe(4.0) // last index, exact
  })

  it('is undefined out of range for analysis timelines (no guessing)', () => {
    const tl = analysisTimeline()
    expect(beatIndexToSec(tl, 6.5)).toBeUndefined()
    expect(beatIndexToSec(tl, -0.5)).toBeUndefined()
    expect(beatIndexToSec(tl, Infinity)).toBeUndefined()
  })

  it('extrapolates via the tempo map for score-sourced timelines only', () => {
    // odeToJoy: 120 bpm → beat k at k/2 seconds; beats array covers 66 s.
    const last = odeTl.beats.length - 1
    expect(beatIndexToSec(odeTl, last)).toBeCloseTo(last / 2, 9)
    // One beat past the array: tempo-map extrapolation.
    expect(beatIndexToSec(odeTl, last + 1)).toBeCloseTo((last + 1) / 2, 9)
    // Below zero (pre-roll region).
    expect(beatIndexToSec(odeTl, -2)).toBeCloseTo(-1, 9)
  })
})

describe('secToBeatIndex', () => {
  it('inverts the array interpolation', () => {
    const tl = analysisTimeline()
    expect(secToBeatIndex(tl, 2.7)).toBeCloseTo(4.5, 12)
    expect(secToBeatIndex(tl, 0)).toBe(0)
    expect(secToBeatIndex(tl, 4.0)).toBe(6)
    expect(secToBeatIndex(tl, 4.5)).toBeUndefined() // analysis, out of range
  })
})

describe('resolveAnchor', () => {
  const tl = analysisTimeline()

  it("'sec' resolves verbatim; offsetBeats on a 'sec' anchor is an error → undefined", () => {
    expect(resolveAnchor({ kind: 'sec', t: 1.25 }, tl)).toBe(1.25)
    const bad = { kind: 'sec', t: 1.25, offsetBeats: 1 } as unknown as MusicAnchor
    expect(resolveAnchor(bad, tl)).toBeUndefined()
  })

  it("'beat' uses the beats array, offsetBeats applied in beat space", () => {
    expect(resolveAnchor({ kind: 'beat', beat: 4.5 }, tl)).toBeCloseTo(2.7, 12)
    expect(resolveAnchor({ kind: 'beat', beat: 4, offsetBeats: 0.5 }, tl)).toBeCloseTo(2.7, 12)
    expect(resolveAnchor({ kind: 'beat', beat: 12 }, tl)).toBeUndefined()
  })

  it("'barBeat' goes through the MeterMap then the beats-array path", () => {
    // bar 2 beat 1 = absolute beat 4 → beats[4] = 2.3 (NOT the tempo-map fit).
    expect(resolveAnchor({ kind: 'barBeat', bar: 2, beat: 1 }, tl)).toBeCloseTo(2.3, 12)
    expect(resolveAnchor({ kind: 'barBeat', bar: 1, beat: 2.5 }, tl)).toBeCloseTo(0.75, 12)
    expect(
      resolveAnchor({ kind: 'barBeat', bar: 2, beat: 1, offsetBeats: 0.5 }, tl),
    ).toBeCloseTo(2.7, 12)
    expect(resolveAnchor({ kind: 'barBeat', bar: 9, beat: 1 }, tl)).toBeUndefined()
    expect(resolveAnchor({ kind: 'barBeat', bar: 0, beat: 1 }, tl)).toBeUndefined()
  })

  it("'annotation' filters by type and label and indexes within the filtered list", () => {
    expect(resolveAnchor({ kind: 'annotation', type: 'hit', index: 0 }, tl)).toBe(0.5)
    expect(
      resolveAnchor({ kind: 'annotation', type: 'hit', index: 1, label: 'cannon' }, tl),
    ).toBe(1.6)
    expect(resolveAnchor({ kind: 'annotation', type: 'climax', index: 0 }, tl)).toBe(3.1)
    expect(resolveAnchor({ kind: 'annotation', type: 'hit', index: 5 }, tl)).toBeUndefined()
    expect(resolveAnchor({ kind: 'annotation', type: 'hit', index: -1 }, tl)).toBeUndefined()
    expect(
      resolveAnchor({ kind: 'annotation', type: 'hit', index: 0, label: 'nope' }, tl),
    ).toBeUndefined()
  })

  it("'annotation' offsetBeats moves in beat space (array steps, not tempo seconds)", () => {
    // hit[1] at 1.6 s = beat index 3; +1 beat → beats[4] = 2.3 s.
    expect(
      resolveAnchor({ kind: 'annotation', type: 'hit', index: 1, offsetBeats: 1 }, tl),
    ).toBeCloseTo(2.3, 12)
    // climax at 3.1 = beat index 5; +2 beats → index 7: out of range → undefined.
    expect(
      resolveAnchor({ kind: 'annotation', type: 'climax', index: 0, offsetBeats: 2 }, tl),
    ).toBeUndefined()
  })

  it('score timelines resolve annotation offsets through the annotation beat', () => {
    // odeToJoy phrase[0] sits at bar 9 beat 1 = beat 32 → t = 16 s; −0.5 beats → 15.75 s.
    expect(
      resolveAnchor({ kind: 'annotation', type: 'phrase', index: 0, offsetBeats: -0.5 }, odeTl),
    ).toBeCloseTo(15.75, 9)
    expect(resolveAnchor({ kind: 'barBeat', bar: 9, beat: 1 }, odeTl)).toBeCloseTo(16, 9)
  })
})
