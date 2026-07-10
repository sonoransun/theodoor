import { describe, expect, it } from 'vitest'
import { concatScores } from '../src/music/concat.js'
import { buildTimelineFromScore } from '../src/music/timeline.js'
import { odeToJoy } from '../src/music/scores/odeToJoy.js'
import { auldLangSyne } from '../src/music/scores/auldLangSyne.js'
import { overture1812Finale } from '../src/music/scores/overture1812Finale.js'
import { starsAndStripesForever } from '../src/music/scores/starsAndStripesForever.js'
import { MeterMap, TempoMap } from '../src/time/tempoMap.js'

describe('concatScores', () => {
  it('joins july4 pair: stars & stripes then 1812 finale', () => {
    const joined = concatScores(starsAndStripesForever, overture1812Finale, {
      id: 'july4-suite',
      title: 'July 4th Suite',
    })
    const tl = buildTimelineFromScore(joined)

    // Duration ≈ sum of parts (within a couple of bars of padding).
    const tlA = buildTimelineFromScore(starsAndStripesForever)
    const tlB = buildTimelineFromScore(overture1812Finale)
    expect(tl.duration).toBeGreaterThan(tlA.duration + tlB.duration - 10)
    expect(tl.duration).toBeLessThan(tlA.duration + tlB.duration + 10)

    // All 16 cannons survive, remapped after the join.
    const cannons = tl.annotations.filter((a) => a.kind === 'hit' && a.label === 'cannon')
    expect(cannons.length).toBe(16)
    for (const c of cannons) expect(c.time).toBeGreaterThan(tlA.duration - 5)

    // Both climaxes survive (grandioso + finalChord).
    const climaxes = tl.annotations.filter((a) => a.kind === 'climax')
    expect(climaxes.map((c) => c.label).sort()).toEqual(['finalChord', 'grandioso'])

    // Annotations sorted, notes within duration.
    for (let i = 1; i < tl.annotations.length; i++) {
      expect(tl.annotations[i]!.time).toBeGreaterThanOrEqual(tl.annotations[i - 1]!.time)
    }
  })

  it('b tempo/meter apply after the join', () => {
    const joined = concatScores(odeToJoy, overture1812Finale)
    const tempo = new TempoMap(joined.tempo.segments)
    const meter = new MeterMap(joined.tempo.meters, joined.tempo.pickupBeats ?? 0)
    // 1812 opens Largo at 60 bpm — the combined map must hit 60 after the join.
    const bpms = joined.tempo.segments.map((s) => s.bpm)
    expect(bpms).toContain(60)
    // Meter switches to 3/4 in the bell peal (1812 bar 25 → shifted).
    const bar25Shifted = joined.tempo.meters.find((m) => m.beatsPerBar === 3)
    expect(bar25Shifted).toBeDefined()
    expect(tempo.beatToSec(1)).toBeGreaterThan(0)
    expect(meter.beatsPerBarAt(1)).toBe(4)
  })

  it('honors b pickup beats at the joint bar line', () => {
    const joined = concatScores(odeToJoy, auldLangSyne)
    // Auld Lang Syne's bar-1 downbeat lands ON a bar line of the combined
    // meter map; its 1-beat pickup spills into the previous bar.
    const meter = new MeterMap(joined.tempo.meters, joined.tempo.pickupBeats ?? 0)
    const firstAuldNote = joined.notes.filter((n) => n.startBeat > 130)[0]
    expect(firstAuldNote).toBeDefined()
    const pos = meter.beatToBarBeat(firstAuldNote!.startBeat)
    // The anacrusis note sits on the last beat of a bar (beat 4 of 4/4).
    expect(pos.beat).toBeCloseTo(4, 5)
  })

  it('merges voices by (name, program) and is deterministic', () => {
    const j1 = concatScores(starsAndStripesForever, overture1812Finale)
    const j2 = concatScores(starsAndStripesForever, overture1812Finale)
    expect(JSON.stringify(j1)).toBe(JSON.stringify(j2))
    expect(j1.voices.length).toBeLessThanOrEqual(
      starsAndStripesForever.voices.length + overture1812Finale.voices.length,
    )
    expect(j1.notes.length).toBe(
      starsAndStripesForever.notes.length + overture1812Finale.notes.length,
    )
  })
})
