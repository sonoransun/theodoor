import { describe, expect, it } from 'vitest'
import { overture1812Finale } from '../src/music/scores/overture1812Finale.js'
import { annotationsOfKind, buildTimelineFromScore, climaxOf } from '../src/music/timeline.js'
import { tempoMapsFrom } from '../src/time/index.js'

const BARS = 56
const TOTAL_BEATS = 8 * 4 + 16 * 4 + 8 * 3 + 8 * 4 + 16 * 4 // 216
const PERC_VOICE = 4
const CANNON_MIDI = 57

const { tempo: tempoMap } = tempoMapsFrom(overture1812Finale.tempo)
const tl = buildTimelineFromScore(overture1812Finale)

describe('overture1812Finale score', () => {
  it('constructs without throwing (all barchecks parse clean)', async () => {
    // The module parses every voice at load; a failed barcheck would throw on
    // import. Re-import to make the assertion explicit.
    await expect(import('../src/music/scores/overture1812Finale.js')).resolves.toHaveProperty(
      'overture1812Finale',
    )
    expect(overture1812Finale.id).toBe('overture1812Finale')
    expect(overture1812Finale.title).toBe('1812 Overture — Finale')
  })

  it('has 5 voices: lead, brass, bass, bells, perc', () => {
    expect(overture1812Finale.voices.map((v) => v.program)).toEqual([
      'lead',
      'brass',
      'bass',
      'bells',
      'perc',
    ])
  })

  it('exercises real tempo and meter variety', () => {
    expect(overture1812Finale.tempo.segments).toEqual([
      { beat: 0, bpm: 60 },
      { beat: 32, bpm: 138 },
      { beat: 152, bpm: 144 },
    ])
    expect(overture1812Finale.tempo.meters).toEqual([
      { bar: 1, beatsPerBar: 4 },
      { bar: 25, beatsPerBar: 3 },
      { bar: 33, beatsPerBar: 4 },
    ])
  })

  // Update these deliberately when the arrangement changes.
  it('note count snapshot: 955 total (277 lead / 133 brass / 177 bass / 186 bells / 182 perc)', () => {
    expect(overture1812Finale.notes.length).toBe(955)
    const byVoice = [0, 1, 2, 3, 4].map(
      (v) => overture1812Finale.notes.filter((n) => n.voice === v).length,
    )
    expect(byVoice).toEqual([277, 133, 177, 186, 182])
  })

  it('spans exactly 56 bars / 216 beats with sane note fields', () => {
    let maxEnd = 0
    for (const n of overture1812Finale.notes) {
      expect(n.startBeat).toBeGreaterThanOrEqual(0)
      expect(n.durBeats).toBeGreaterThan(0)
      expect(n.velocity).toBeGreaterThan(0)
      expect(n.velocity).toBeLessThanOrEqual(1)
      expect(n.midi).toBeGreaterThanOrEqual(12)
      expect(n.midi).toBeLessThanOrEqual(127)
      maxEnd = Math.max(maxEnd, n.startBeat + n.durBeats)
    }
    expect(maxEnd).toBe(TOTAL_BEATS)
    const { meter } = tempoMapsFrom(overture1812Finale.tempo)
    expect(meter.beatToBarBeat(TOTAL_BEATS)).toEqual({ bar: BARS + 1, beat: 1 })
  })

  it('every phrase annotation is labeled phraseEnd', () => {
    const phrases = overture1812Finale.annotations.filter((a) => a.kind === 'phrase')
    expect(phrases.length).toBe(7)
    for (const p of phrases) expect(p.label).toBe('phraseEnd')
  })

  it('has exactly one climax, strength 1, labeled finalChord on the last downbeat', () => {
    const climaxes = overture1812Finale.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes).toHaveLength(1)
    expect(climaxes[0]!.strength).toBe(1)
    expect(climaxes[0]!.label).toBe('finalChord')
    expect(climaxes[0]!.beat).toBe(212) // bar 56 beat 1 — the last downbeat
  })
})

describe('overture1812Finale timeline', () => {
  it('builds and lands in the ~100–130 s target range', () => {
    // 32 beats @60 + 120 beats @138 + 64 beats @144 + 2 s tail.
    expect(tl.duration).toBeGreaterThan(100)
    expect(tl.duration).toBeLessThan(130)
    expect(tl.duration).toBeCloseTo(112.8406, 3)
    expect(tl.source).toBe('score')
    expect(tl.tempoConfidence).toBe(1)
  })

  it('keeps every note inside the timeline duration', () => {
    for (const n of overture1812Finale.notes) {
      expect(tempoMap.beatToSec(n.startBeat)).toBeGreaterThanOrEqual(0)
      expect(tempoMap.beatToSec(n.startBeat + n.durBeats)).toBeLessThanOrEqual(tl.duration)
    }
  })

  it('annotations are sorted by time', () => {
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
  })

  it('climaxOf finds the strength-1 climax', () => {
    const c = climaxOf(tl)
    expect(c?.strength).toBe(1)
    expect(c?.label).toBe('finalChord')
    expect(c?.time).toBeCloseTo(tempoMap.beatToSec(212), 9)
  })

  it('fires exactly 16 cannons, each doubled by a midi-57 perc note within 30 ms', () => {
    const cannons = annotationsOfKind(tl, 'hit', 'cannon')
    expect(cannons).toHaveLength(16)
    for (const c of cannons) expect(c.strength).toBe(1)

    const percCannons = overture1812Finale.notes.filter(
      (n) => n.voice === PERC_VOICE && n.midi === CANNON_MIDI,
    )
    expect(percCannons).toHaveLength(16)
    for (const n of percCannons) expect(n.velocity).toBe(1)

    const cannonTimes = percCannons.map((n) => tempoMap.beatToSec(n.startBeat))
    for (const c of cannons) {
      const nearest = Math.min(...cannonTimes.map((t) => Math.abs(t - c.time)))
      expect(nearest).toBeLessThan(0.03)
    }
  })

  it('places 5 cannons in the Allegro (offbeat) and 11 in the coda', () => {
    const cannons = annotationsOfKind(tl, 'hit', 'cannon')
    const codaStartSec = tempoMap.beatToSec(152) // bar 41
    const allegro = cannons.filter((c) => c.time < codaStartSec)
    const coda = cannons.filter((c) => c.time >= codaStartSec)
    expect(allegro).toHaveLength(5)
    expect(coda).toHaveLength(11)
    // Offbeat placements: no Allegro cannon sits on an integer beat.
    for (const c of allegro) expect(Math.abs(c.beat! - Math.round(c.beat!))).toBeCloseTo(0.5, 9)
  })
})
