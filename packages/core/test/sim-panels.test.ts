import { describe, expect, it } from 'vitest'
import { getEffectFrom, starterCatalog, PANEL_EFFECTS } from '../src/catalog/index.js'
import type { CompiledCue, PanelPattern, PanelSpec } from '../src/contracts.js'
import { SimEngine, renderPanelFrame } from '../src/sim/index.js'
import { makeMusic, sixCueShow } from './sim-fixture.js'

const getEffect = getEffectFrom(starterCatalog())
const timeline = makeMusic(40)
const dims: PanelSpec = { wPx: 64, hPx: 32, pitchMm: 40 }

function panelCue(effectId: string, params?: CompiledCue['params']): CompiledCue {
  return {
    id: 'nx', trackId: 'trk-panel', medium: 'panel', effectId,
    positionId: 'panel-east', targetSec: 5, fireSec: 5, anticipationSec: 0,
    durationSec: 12, seed: 999,
    ...(params ? { params } : {}),
  }
}

describe('sim/panels — renderPanelFrame', () => {
  it('every pattern renders w*h*3 bytes', () => {
    for (const effect of PANEL_EFFECTS) {
      const frame = renderPanelFrame(effect, panelCue(effect.id), 3, dims, timeline)
      expect(frame.length).toBe(64 * 32 * 3)
    }
  })

  it('frames are deterministic per frame index', () => {
    for (const effect of PANEL_EFFECTS) {
      const a = renderPanelFrame(effect, panelCue(effect.id), 7, dims, timeline)
      const b = renderPanelFrame(effect, panelCue(effect.id), 7, dims, timeline)
      expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true)
    }
  })

  it('text ticker renders a known glyph column at a known frame', () => {
    // Cue n1 conventions: text 'HI', speedPxPerBeat 4, fps 20, targetSec 5.
    // Beats every 0.5 s → beatPhase(t) = 2t → offsetPx = floor(8·tShow).
    // Frame 25 → tShow = 5 + 25/20 = 6.25 → offsetPx = 50.
    // 'HI' is 11 cells wide → cycle 11 + 64 = 75 → xoff = 50.
    // Glyph cell (cx, cy) lands at screen x = 64 − 50 + cx = 14 + cx,
    // y = (32−7)/2 + cy = 12 + cy.
    const effect = getEffect('panel-text-marquee') as PanelPattern
    const cue = panelCue('panel-text-marquee', { text: 'HI', speedPxPerBeat: 4 })
    const frame = renderPanelFrame(effect, cue, 25, dims, timeline)
    const at = (x: number, y: number): number => frame[(y * 64 + x) * 3]!
    // 'H' column 0 is fully lit (rows 0..6) at x = 14.
    for (let cy = 0; cy < 7; cy++) expect(at(14, 12 + cy)).toBe(255)
    // 'H' column 1 is lit only on the crossbar row (row 3).
    expect(at(15, 12 + 3)).toBe(255)
    expect(at(15, 12)).toBe(0)
    expect(at(15, 18)).toBe(0)
    // Above and below the glyph band stays dark.
    expect(at(14, 11)).toBe(0)
    expect(at(14, 19)).toBe(0)
  })

  it('strobe alternates full-on and dark half-periods at 8 Hz', () => {
    const effect = getEffect('panel-strobe') as PanelPattern // fps 12
    const on = renderPanelFrame(effect, panelCue('panel-strobe'), 0, dims, timeline)
    expect(on[0]).toBe(255)
    // frame 3 → tLocal = 0.25 s → phase = 2.0 → first half → on;
    // frame 1 → tLocal = 1/12 → phase 0.667 → second half → dark.
    const off = renderPanelFrame(effect, panelCue('panel-strobe'), 1, dims, timeline)
    expect(off.every((b) => b === 0)).toBe(true)
  })

  it('sparkle is seed-dependent', () => {
    const effect = getEffect('panel-sparkle') as PanelPattern
    const a = renderPanelFrame(effect, panelCue('panel-sparkle'), 4, dims, timeline)
    const b = renderPanelFrame(
      effect, { ...panelCue('panel-sparkle'), seed: 1000 }, 4, dims, timeline,
    )
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(false)
  })

  it('the engine snapshot carries cached panel frames while the cue is active', () => {
    const engine = new SimEngine(sixCueShow())
    engine.advanceTo(3) // n1 starts at 5
    expect(engine.snapshot().panelFrames.length).toBe(0)
    engine.advanceTo(6)
    const frames = engine.snapshot().panelFrames
    expect(frames.length).toBe(1)
    expect(frames[0]!.assetId).toBe('panel-east')
    expect(frames[0]!.w).toBe(64)
    expect(frames[0]!.h).toBe(32)
    expect(frames[0]!.rgb.length).toBe(64 * 32 * 3)
    // Same frame index → the cache returns the identical buffer instance.
    const again = engine.snapshot().panelFrames[0]!.rgb
    expect(again).toBe(frames[0]!.rgb)
    engine.advanceTo(17.5) // window [5, 17) closed
    expect(engine.snapshot().panelFrames.length).toBe(0)
  })
})
