import { describe, expect, it } from 'vitest'
import type {
  CompiledCue,
  LaserPrimitive,
  LaserShape,
  MusicalTimeline,
  PanelPattern,
  PanelPatternKind,
  PanelSpec,
} from '../src/contracts.js'
import { renderLaserFrame, renderPanelFrame } from '../src/sim/index.js'

// Self-contained fixtures (no catalog dependency): a uniform 120 bpm
// timeline and inline effects, mirroring test/sim-fixture.ts conventions.
function makeTimeline(duration: number): MusicalTimeline {
  const beats: number[] = []
  for (let t = 0; t <= duration + 1e-9; t += 0.5) beats.push(Math.round(t * 2) / 2)
  return {
    source: 'score',
    id: 'render-additions-music',
    title: 'Render Additions Music',
    duration,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    annotations: [],
    energy: [{ time: 0, rms: 0.5, loudness: 0.5 }],
    tempoConfidence: 1,
  }
}

const timeline = makeTimeline(40)

function laserEffect(shape: LaserShape): LaserPrimitive {
  return {
    id: `laser-${shape}`, name: `Laser ${shape}`, medium: 'laser', tags: [],
    noiseDbAt15m: 30, durationSec: 10,
    shape, pointsPerFrame: 300, colors: ['#ff4040', '#40ff40', '#4040ff'],
  }
}

function laserCue(effectId: string, params?: CompiledCue['params']): CompiledCue {
  return {
    id: 'lx', trackId: 'trk-laser', medium: 'laser', effectId,
    positionId: 'laser-west', targetSec: 5, fireSec: 5, anticipationSec: 0,
    durationSec: 8, seed: 12345,
    ...(params ? { params } : {}),
  }
}

const NEW_SHAPES: readonly LaserShape[] = ['helix', 'web', 'curtain']

describe('sim/lasers — new shapes', () => {
  it('emit exactly pointsPerFrame points, all coords within [-1, 1]', () => {
    for (const shape of NEW_SHAPES) {
      const effect = laserEffect(shape)
      for (const t of [5, 6.123, 9.9]) {
        const pts = renderLaserFrame(effect, laserCue(effect.id), t, timeline)
        expect(pts.length, `${shape}@${t}`).toBe(300)
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(-1)
          expect(p.x).toBeLessThanOrEqual(1)
          expect(p.y).toBeGreaterThanOrEqual(-1)
          expect(p.y).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('are deterministic: identical calls yield identical frames', () => {
    for (const shape of NEW_SHAPES) {
      const effect = laserEffect(shape)
      const a = renderLaserFrame(effect, laserCue(effect.id), 6.789, timeline)
      const b = renderLaserFrame(effect, laserCue(effect.id), 6.789, timeline)
      expect(b, shape).toEqual(a)
    }
  })

  it('animate: frames a third of a period apart differ', () => {
    for (const shape of NEW_SHAPES) {
      const effect = laserEffect(shape)
      const a = renderLaserFrame(effect, laserCue(effect.id), 6, timeline)
      const b = renderLaserFrame(effect, laserCue(effect.id), 6.3, timeline)
      expect(b, shape).not.toEqual(a)
    }
  })

  it('helix draws two strands with a single blanked hop between them', () => {
    const pts = renderLaserFrame(laserEffect('helix'), laserCue('laser-helix'), 6, timeline)
    expect(pts[0]!.blank).toBe(false)
    const blanks = pts.map((p, i) => [p.blank, i] as const).filter(([b]) => b)
    expect(blanks.length).toBe(1)
    expect(blanks[0]![1]).toBe(150) // strand B starts at n/2
    // Both strand endpoints reach the top and bottom of the frame.
    expect(pts[0]!.y).toBeCloseTo(-1, 9)
    expect(pts[149]!.y).toBeCloseTo(1, 9)
  })

  it('web hops between its 12 elements (4 rings + 8 spokes)', () => {
    const pts = renderLaserFrame(laserEffect('web'), laserCue('laser-web'), 6, timeline)
    expect(pts[0]!.blank).toBe(false) // first ring needs no hop
    expect(pts.filter((p) => p.blank).length).toBe(11)
  })

  it('curtain sweeps the full width with no blanking', () => {
    const pts = renderLaserFrame(laserEffect('curtain'), laserCue('laser-curtain'), 6, timeline)
    expect(pts.every((p) => !p.blank)).toBe(true)
    const xs = pts.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(-0.9, 9)
    expect(Math.max(...xs)).toBeCloseTo(0.9, 9)
  })

  it('periodBeats beat-locks the new shapes: integer cycles repeat', () => {
    const effect = laserEffect('helix')
    const cue = laserCue('laser-helix', { periodBeats: 4 })
    // Beats every 0.5 s → beatPhase(t) = 2t; t=6 → phase 3.0, t=8 → 4.0.
    const a = renderLaserFrame(effect, cue, 6, timeline)
    const b = renderLaserFrame(effect, cue, 8, timeline)
    for (let i = 0; i < a.length; i++) {
      expect(b[i]!.x).toBeCloseTo(a[i]!.x, 9)
      expect(b[i]!.y).toBeCloseTo(a[i]!.y, 9)
    }
  })
})

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const dims: PanelSpec = { wPx: 64, hPx: 32, pitchMm: 40 }

function panelEffect(pattern: PanelPatternKind): PanelPattern {
  return {
    id: `panel-${pattern}`, name: `Panel ${pattern}`, medium: 'panel', tags: [],
    noiseDbAt15m: 30, durationSec: 12, pattern, fps: 20,
  }
}

function panelCue(effectId: string, seed = 999): CompiledCue {
  return {
    id: 'nx', trackId: 'trk-panel', medium: 'panel', effectId,
    positionId: 'panel-east', targetSec: 5, fireSec: 5, anticipationSec: 0,
    durationSec: 12, seed,
    params: { rgb: [1, 0.6, 0.2], rgb2: [0.2, 0.2, 0.6] },
  }
}

const NEW_PATTERNS: readonly PanelPatternKind[] = [
  'embers', 'starfield', 'aurora', 'lightning', 'eyes',
]

describe('sim/panels — new patterns', () => {
  it('fill exactly w*h*3 bytes', () => {
    for (const pattern of NEW_PATTERNS) {
      const effect = panelEffect(pattern)
      const frame = renderPanelFrame(effect, panelCue(effect.id), 3, dims, timeline)
      expect(frame.length, pattern).toBe(64 * 32 * 3)
    }
  })

  it('are deterministic for the same (seed, frame index)', () => {
    for (const pattern of NEW_PATTERNS) {
      const effect = panelEffect(pattern)
      const a = renderPanelFrame(effect, panelCue(effect.id), 7, dims, timeline)
      const b = renderPanelFrame(effect, panelCue(effect.id), 7, dims, timeline)
      expect(Buffer.from(b).equals(Buffer.from(a)), pattern).toBe(true)
    }
  })

  it('animate: frames 0..79 (4 s at 20 fps) are not all identical', () => {
    for (const pattern of NEW_PATTERNS) {
      const effect = panelEffect(pattern)
      const cue = panelCue(effect.id)
      const first = renderPanelFrame(effect, cue, 0, dims, timeline)
      let differs = false
      for (let f = 1; f < 80 && !differs; f++) {
        const frame = renderPanelFrame(effect, cue, f, dims, timeline)
        if (!Buffer.from(frame).equals(Buffer.from(first))) differs = true
      }
      expect(differs, pattern).toBe(true)
    }
  })

  it('embers and starfield layouts are seed-dependent', () => {
    for (const pattern of ['embers', 'starfield'] as const) {
      const effect = panelEffect(pattern)
      const a = renderPanelFrame(effect, panelCue(effect.id, 999), 4, dims, timeline)
      const b = renderPanelFrame(effect, panelCue(effect.id, 1000), 4, dims, timeline)
      expect(Buffer.from(b).equals(Buffer.from(a)), pattern).toBe(false)
    }
  })

  it('lightning is dark between strikes and lit during a flash', () => {
    const effect = panelEffect('lightning')
    const cue = panelCue(effect.id)
    let sawDark = false
    let sawLit = false
    for (let f = 0; f < 80; f++) {
      const frame = renderPanelFrame(effect, cue, f, dims, timeline)
      if (frame.every((b) => b === 0)) sawDark = true
      else sawLit = true
    }
    expect(sawDark).toBe(true)
    expect(sawLit).toBe(true)
  })

  it('eyes light small blocks that blink over time', () => {
    const effect = panelEffect('eyes')
    const cue = panelCue(effect.id)
    const litCount = (frame: Uint8Array): number => {
      let count = 0
      for (let i = 0; i < frame.length; i += 3) if (frame[i]! > 0) count++
      return count
    }
    // Some frame shows eyes; the lit-pixel count varies as pairs blink.
    const counts = new Set<number>()
    let maxLit = 0
    for (let f = 0; f < 120; f++) {
      const lit = litCount(renderPanelFrame(effect, cue, f, dims, timeline))
      counts.add(lit)
      if (lit > maxLit) maxLit = lit
    }
    expect(maxLit).toBeGreaterThan(0)
    expect(maxLit).toBeLessThanOrEqual(6 * 8) // ≤ 6 pairs × two 2×2 blocks
    expect(counts.size).toBeGreaterThan(1)
  })

  it('aurora blends rgb at the top toward rgb2 at the bottom', () => {
    const effect = panelEffect('aurora')
    const frame = renderPanelFrame(effect, panelCue(effect.id), 3, dims, timeline)
    // Compare a bright column's top and bottom pixels: red dominates the top
    // band (rgb = [1, .6, .2]), blue the bottom (rgb2 = [.2, .2, .6]).
    let x = 0
    let best = -1
    for (let cx = 0; cx < 64; cx++) {
      const v = frame[cx * 3]!
      if (v > best) {
        best = v
        x = cx
      }
    }
    const at = (y: number, ch: number): number => frame[(y * 64 + x) * 3 + ch]!
    expect(at(0, 0)).toBeGreaterThan(at(0, 2)) // top: red > blue
    expect(at(31, 2)).toBeGreaterThan(at(31, 0)) // bottom: blue > red
  })
})
