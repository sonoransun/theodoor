import { describe, expect, it } from 'vitest'
import type { Annotation, NoteEvent, Score, TempoMapData } from '../src/contracts.js'
import { ENERGY_DT_SEC } from '../src/contracts.js'
import {
  buildTimelineFromScore,
  energyAt,
  annotationsOfKind,
  climaxOf,
} from '../src/music/timeline.js'
import { annotate } from '../src/music/notation.js'

const TEMPO_120: TempoMapData = {
  segments: [{ beat: 0, bpm: 120 }],
  meters: [{ bar: 1, beatsPerBar: 4 }],
}

const note = (startBeat: number, durBeats: number, midi: number, velocity: number, voice = 0): NoteEvent => ({
  voice,
  startBeat,
  durBeats,
  midi,
  velocity,
})

const mkScore = (notes: NoteEvent[], annotations: Annotation[] = []): Score => ({
  id: 'test',
  title: 'Test Score',
  tempo: TEMPO_120,
  voices: [{ name: 'lead', program: 'lead' }],
  notes,
  annotations,
})

describe('buildTimelineFromScore structure', () => {
  const score = mkScore([note(0, 4, 60, 0.7), note(4, 4, 64, 0.7)])
  const tl = buildTimelineFromScore(score)

  it('is a score-sourced timeline with confidence 1 and the score attached', () => {
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
    expect(tl.score).toBe(score)
    expect(tl.id).toBe('test')
    expect(tl.title).toBe('Test Score')
    expect(tl.tempo).toBe(score.tempo)
  })

  it('duration = last note end + 2 s tail', () => {
    // last end beat 8 @ 120 bpm = 4 s
    expect(tl.duration).toBeCloseTo(6)
  })

  it('beats are sorted ascending and within [0, duration]', () => {
    expect(tl.beats.length).toBeGreaterThan(0)
    for (let i = 1; i < tl.beats.length; i++) {
      expect(tl.beats[i]!).toBeGreaterThan(tl.beats[i - 1]!)
    }
    expect(tl.beats[0]!).toBeGreaterThanOrEqual(0)
    expect(tl.beats[tl.beats.length - 1]!).toBeLessThanOrEqual(tl.duration + 1e-9)
  })

  it('downbeats are a subset of beats', () => {
    const set = new Set(tl.beats)
    for (const d of tl.downbeats) expect(set.has(d)).toBe(true)
    expect(tl.downbeats[0]).toBe(0)
  })

  it('energy is a uniform 50 ms grid covering the duration', () => {
    expect(ENERGY_DT_SEC).toBe(0.05)
    expect(tl.energy.length).toBe(Math.floor(tl.duration / 0.05 + 1e-9) + 1)
    for (let i = 0; i < tl.energy.length; i++) {
      expect(tl.energy[i]!.time).toBeCloseTo(i * 0.05, 9)
    }
  })

  it('energy values are normalized to [0, 1] and non-trivial', () => {
    let maxRms = 0
    for (const p of tl.energy) {
      expect(p.rms).toBeGreaterThanOrEqual(0)
      expect(p.rms).toBeLessThanOrEqual(1)
      expect(p.loudness).toBeGreaterThanOrEqual(0)
      expect(p.loudness).toBeLessThanOrEqual(1)
      maxRms = Math.max(maxRms, p.rms)
    }
    expect(maxRms).toBeGreaterThan(0.3)
  })

  it('a silent score still yields a valid (all-zero) energy grid', () => {
    const empty = buildTimelineFromScore(mkScore([]))
    expect(empty.duration).toBeCloseTo(2)
    expect(empty.energy.length).toBe(41)
    expect(empty.energy.every((p) => p.rms === 0 && p.loudness === 0)).toBe(true)
  })
})

describe('auto accent annotations', () => {
  it('adds accent (strength = velocity) for notes with velocity >= 0.85', () => {
    const tl = buildTimelineFromScore(mkScore([note(0, 1, 60, 0.7), note(2, 1, 64, 0.9)]))
    const accents = annotationsOfKind(tl, 'accent')
    expect(accents).toHaveLength(1)
    expect(accents[0]!.beat).toBe(2)
    expect(accents[0]!.time).toBeCloseTo(1)
    expect(accents[0]!.strength).toBe(0.9)
  })

  it('does not accent notes below the threshold', () => {
    const tl = buildTimelineFromScore(mkScore([note(0, 1, 60, 0.84)]))
    expect(annotationsOfKind(tl, 'accent')).toHaveLength(0)
  })

  it('collapses chords to a single accent with the max velocity', () => {
    const tl = buildTimelineFromScore(
      mkScore([note(0, 1, 60, 0.9), note(0, 1, 64, 0.95, 1)]),
    )
    const accents = annotationsOfKind(tl, 'accent')
    expect(accents).toHaveLength(1)
    expect(accents[0]!.strength).toBe(0.95)
  })

  it('suppresses auto accents where an authored accent/hit/climax already sits', () => {
    const climax = annotate(TEMPO_120, 'climax', 1, 1, 1)
    const tl = buildTimelineFromScore(mkScore([note(0, 1, 60, 0.95)], [climax]))
    expect(annotationsOfKind(tl, 'accent')).toHaveLength(0)
    expect(annotationsOfKind(tl, 'climax')).toHaveLength(1)
  })

  it('does not suppress accents for non-emphasis annotations (phrase)', () => {
    const phrase = annotate(TEMPO_120, 'phrase', 1, 1, 0.5, 'phraseEnd')
    const tl = buildTimelineFromScore(mkScore([note(0, 1, 60, 0.95)], [phrase]))
    expect(annotationsOfKind(tl, 'accent')).toHaveLength(1)
  })

  it('keeps annotations sorted by time even when authored out of order', () => {
    const late = annotate(TEMPO_120, 'phrase', 2, 1, 0.5)
    const early = annotate(TEMPO_120, 'hit', 1, 2, 0.8)
    const tl = buildTimelineFromScore(mkScore([note(0, 8, 60, 0.9)], [late, early]))
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
    expect(tl.annotations[0]!.kind).toBe('accent') // the auto accent at t = 0
  })
})

describe('energy loudness weighting', () => {
  it('weights bass notes (midi < 45) 1.2x in loudness', () => {
    // Bass note early, treble peak later: both curves normalize at the treble
    // peak, so the bass region must read relatively louder in `loudness`.
    const tl = buildTimelineFromScore(
      mkScore([note(0, 2, 36, 0.5), note(4, 2, 72, 1.0)]),
    )
    const p0 = tl.energy[0]!
    expect(p0.loudness).toBeGreaterThan(p0.rms)
    expect(p0.rms).toBeCloseTo(0.5, 5)
    expect(p0.loudness).toBeCloseTo(0.6, 5)
    for (const p of tl.energy) expect(p.loudness).toBeGreaterThanOrEqual(p.rms - 1e-12)
  })
})

describe('query helpers', () => {
  const tl = buildTimelineFromScore(
    mkScore(
      [note(0, 8, 60, 0.7)],
      [
        annotate(TEMPO_120, 'phrase', 1, 1, 0.5, 'phraseEnd'),
        annotate(TEMPO_120, 'phrase', 2, 1, 0.4, 'other'),
        annotate(TEMPO_120, 'climax', 2, 1, 0.8),
        annotate(TEMPO_120, 'climax', 3, 1, 1, 'finale'),
      ],
    ),
  )

  it('energyAt interpolates linearly between bins and clamps at the ends', () => {
    const a = tl.energy[0]!
    const b = tl.energy[1]!
    const mid = energyAt(tl, 0.025)
    expect(mid.rms).toBeCloseTo((a.rms + b.rms) / 2, 9)
    expect(mid.loudness).toBeCloseTo((a.loudness + b.loudness) / 2, 9)
    expect(energyAt(tl, -5).rms).toBeCloseTo(a.rms, 12)
    const last = tl.energy[tl.energy.length - 1]!
    expect(energyAt(tl, 1e9).rms).toBeCloseTo(last.rms, 12)
    expect(energyAt(tl, 0.05).rms).toBeCloseTo(b.rms, 12)
  })

  it('annotationsOfKind filters by kind and optional label', () => {
    expect(annotationsOfKind(tl, 'phrase')).toHaveLength(2)
    expect(annotationsOfKind(tl, 'phrase', 'phraseEnd')).toHaveLength(1)
    expect(annotationsOfKind(tl, 'beat')).toHaveLength(0)
  })

  it('climaxOf picks the strongest climax', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.label).toBe('finale')
  })

  it('climaxOf is undefined when there is no climax', () => {
    const bare = buildTimelineFromScore(mkScore([note(0, 1, 60, 0.5)]))
    expect(climaxOf(bare)).toBeUndefined()
  })
})

describe('determinism', () => {
  it('two builds of the same score are deep-equal', () => {
    const score = mkScore([note(0, 2, 60, 0.9), note(2, 2, 48, 0.6)])
    expect(buildTimelineFromScore(score)).toEqual(buildTimelineFromScore(score))
  })
})
