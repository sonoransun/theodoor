import { describe, expect, it } from 'vitest'
import type { EnergyPoint, MusicalTimeline } from '../src/contracts.js'
import { ENERGY_DT_SEC } from '../src/contracts.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import { quietReport } from '../src/acoustics/index.js'
import { generateShowFromAnalysis } from '../src/show/index.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)

/** Uniform 50 ms energy grid from an rms(t) function. */
function energyGrid(duration: number, rms: (t: number) => number): EnergyPoint[] {
  const out: EnergyPoint[] = []
  for (let t = 0; t <= duration + 1e-9; t += ENERGY_DT_SEC) {
    const r = Math.max(0, Math.min(1, rms(t)))
    out.push({ time: Math.round(t * 1e6) / 1e6, rms: r, loudness: r })
  }
  return out
}

/** Synthetic click+crescendo analysis timeline: 120 bpm over 40 s. */
function crescendoTimeline(): MusicalTimeline {
  const beats: number[] = []
  const downbeats: number[] = []
  for (let k = 0; k * 0.5 <= 40; k++) {
    beats.push(k * 0.5)
    if (k % 4 === 0) downbeats.push(k * 0.5)
  }
  return {
    source: 'analysis',
    id: 'click-crescendo',
    title: 'Click Crescendo',
    duration: 40,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats,
    downbeats,
    annotations: [
      { time: 12, kind: 'hit', strength: 0.9, label: 'impact' },
      { time: 24, kind: 'hit', strength: 0.9, label: 'impact' },
      { time: 36, kind: 'climax', strength: 1 },
    ],
    energy: energyGrid(40, (t) => (t < 4 ? 0.1 : 0.15 + (0.85 * t) / 40)),
    tempoConfidence: 0.9,
  }
}

/** Beat-less variant (analysis confidence 0): only energy bumps survive. */
function beatlessTimeline(): MusicalTimeline {
  return {
    ...crescendoTimeline(),
    id: 'beatless',
    title: 'Beatless',
    beats: [],
    downbeats: [],
    tempoConfidence: 0,
    annotations: [{ time: 34, kind: 'climax', strength: 1 }],
    energy: energyGrid(40, (t) => 0.45 + 0.45 * Math.sin((2 * Math.PI * (t - 2)) / 8)),
  }
}

describe('generateShowFromAnalysis', () => {
  it('compiles clean over a beat-gridded analysis timeline', () => {
    const { show, compiled } = generateShowFromAnalysis(crescendoTimeline())
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(compiled.cues.length).toBeGreaterThan(20)
    // Layers present: pyro on downbeats, lasers every 8 beats, panel washes, a finale barrage.
    const media = new Set(compiled.cues.map((c) => c.medium))
    expect(media.has('pyro')).toBe(true)
    expect(media.has('laser')).toBe(true)
    expect(media.has('panel')).toBe(true)
    expect(compiled.cues.some((c) => c.id.startsWith('finale-'))).toBe(true)
    // Low-energy downbeats (t < 4 s, rms 0.1) produce no shells.
    const pyroTargets = compiled.cues.filter((c) => c.medium === 'pyro').map((c) => c.targetSec)
    expect(Math.min(...pyroTargets)).toBeGreaterThanOrEqual(4)
    expect(show.meta.seed).toBe(1)
    expect(show.preRollSec).toBe(5)
  })

  it('respects a noise budget of 85 dB (quiet layers + solver machinery)', () => {
    const { show, compiled } = generateShowFromAnalysis(crescendoTimeline(), { maxSplDb: 85 })
    expect(show.noiseBudget).toEqual({ maxSplDb: 85 })
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const report = quietReport(compiled, getEffect, 85)
    expect(report.pass).toBe(true)
    // Quiet finale: drone bloom instead of a large-caliber barrage.
    expect(compiled.cues.some((c) => c.medium === 'drone' && c.effectId === 'bloom-formation-120')).toBe(true)
    expect(compiled.cues.some((c) => c.id.startsWith('curtain-'))).toBe(true)
    expect(compiled.cues.some((c) => c.id.startsWith('finale-'))).toBe(false)
  })

  it('negative control: the standard show does NOT meet 85 dB', () => {
    const { compiled } = generateShowFromAnalysis(crescendoTimeline())
    const report = quietReport(compiled, getEffect, 85)
    expect(report.pass).toBe(false)
  })

  it('falls back to energy-peak comets when the timeline has no beats', () => {
    const { compiled } = generateShowFromAnalysis(beatlessTimeline())
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const pyro = compiled.cues.filter((c) => c.medium === 'pyro' && !c.id.startsWith('finale-'))
    expect(pyro.length).toBeGreaterThanOrEqual(3)
    // All fallback cues ride 'sec' anchors → land exactly on energy peaks (~2 s + 8 k).
    for (const c of pyro) {
      expect(c.fireSec).toBeCloseTo(c.targetSec - c.anticipationSec, 12)
    }
    expect(compiled.cues.some((c) => c.medium === 'laser')).toBe(false) // no beat grid → no sweeps
  })

  it('is deterministic (two runs JSON-identical) and seedable', () => {
    const a = generateShowFromAnalysis(crescendoTimeline(), { maxSplDb: 85, seed: 9 })
    const b = generateShowFromAnalysis(crescendoTimeline(), { maxSplDb: 85, seed: 9 })
    expect(JSON.stringify(a.compiled)).toBe(JSON.stringify(b.compiled))
    const c = generateShowFromAnalysis(crescendoTimeline(), { maxSplDb: 85, seed: 10 })
    expect(c.compiled.cues[0]!.seed).not.toBe(a.compiled.cues[0]!.seed)
  })
})
