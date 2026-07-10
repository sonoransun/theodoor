import { describe, expect, it } from 'vitest'
import type {
  DroneFormationKind,
  LaserShape,
  PanelPatternKind,
  PyroEffect,
} from '../src/contracts.js'
import {
  BEAM_EFFECTS,
  CROWD_EFFECTS,
  DRONE_EFFECTS,
  FABRICATION_EFFECTS,
  LASER_EFFECTS,
  PANEL_EFFECTS,
  PYRO_EFFECTS,
  STARTER_CATALOG_ID,
  STARTER_EFFECTS,
  anticipationSec,
  starterCatalog,
} from '../src/catalog/index.js'

const cat = starterCatalog()

describe('starter catalog', () => {
  it('has the frozen catalog id', () => {
    expect(STARTER_CATALOG_ID).toBe('starter-v1')
  })

  it('validates and has the expected per-medium counts', () => {
    expect(cat.size).toBe(STARTER_EFFECTS.length)
    expect(PYRO_EFFECTS).toHaveLength(23)
    expect(DRONE_EFFECTS).toHaveLength(19)
    expect(LASER_EFFECTS).toHaveLength(10)
    expect(PANEL_EFFECTS).toHaveLength(14)
    expect(FABRICATION_EFFECTS).toHaveLength(5)
    expect(CROWD_EFFECTS).toHaveLength(10)
    expect(BEAM_EFFECTS).toHaveLength(9)
    expect(cat.size).toBe(90)
  })

  it('contains the canonical example ids', () => {
    expect(cat.get('peony-75-red').medium).toBe('pyro')
    expect(cat.get('salute-100').medium).toBe('pyro')
    expect(cat.get('comet-30-gold').medium).toBe('pyro')
    expect(cat.get('flag-formation-50').medium).toBe('drone')
    expect(cat.get('crowd-flood-rgb').medium).toBe('crowd')
    expect(cat.get('beam-whisper-narration').medium).toBe('beam')
  })

  it('uses the documented caliber → performance table', () => {
    const p75 = cat.get('peony-75-red') as PyroEffect
    expect(p75.riseTimeSec).toBeCloseTo(2.2, 5)
    expect(p75.burstHeightM).toBe(90)
    expect(p75.burstRadiusM).toBe(35)

    const p100 = cat.get('peony-100-white') as PyroEffect
    expect(p100.riseTimeSec).toBeCloseTo(2.8, 5)
    expect(p100.burstHeightM).toBe(120)

    const p150 = cat.get('peony-150-gold') as PyroEffect
    expect(p150.riseTimeSec).toBeCloseTo(3.6, 5)
    expect(p150.burstHeightM).toBe(170)

    const b200 = cat.get('brocade-200-gold') as PyroEffect
    expect(b200.riseTimeSec).toBeCloseTo(4.2, 5)
    expect(b200.burstHeightM).toBe(220)
  })

  it('salutes are very loud; drones/lasers/panels near-silent', () => {
    for (const p of PYRO_EFFECTS.filter((e) => e.category === 'salute')) {
      expect(p.noiseDbAt15m).toBeGreaterThanOrEqual(148)
      expect(p.noiseDbAt15m).toBeLessThanOrEqual(155)
    }
    for (const e of [...DRONE_EFFECTS, ...LASER_EFFECTS, ...PANEL_EFFECTS]) {
      expect(e.noiseDbAt15m).toBeGreaterThanOrEqual(55)
      expect(e.noiseDbAt15m).toBeLessThanOrEqual(65)
    }
  })

  it('query({ maxNoiseDb: 85 }) drops salutes and peonies but keeps drones, lasers, comets', () => {
    const quiet = cat.query({ maxNoiseDb: 85 })
    const quietPyro = quiet.filter((e): e is PyroEffect => e.medium === 'pyro')
    expect(quietPyro.some((e) => e.category === 'salute')).toBe(false)
    expect(quietPyro.some((e) => e.category === 'peony')).toBe(false)
    expect(quiet.some((e) => e.medium === 'drone')).toBe(true)
    expect(quiet.some((e) => e.medium === 'laser')).toBe(true)
    expect(quietPyro.some((e) => e.category === 'comet')).toBe(true)
  })

  it('anticipationSec equals riseTimeSec for every pyro entry', () => {
    for (const p of PYRO_EFFECTS) {
      expect(anticipationSec(p)).toBe(p.riseTimeSec)
      expect(cat.anticipationSec(p)).toBe(p.riseTimeSec)
    }
  })

  it('mines have small rise times (ground effects)', () => {
    const mines = PYRO_EFFECTS.filter((e) => e.category === 'mine')
    expect(mines.length).toBeGreaterThan(0)
    for (const m of mines) expect(m.riseTimeSec).toBeLessThanOrEqual(0.5)
  })

  it('offers low-noise pyro options usable in quiet shows (≤ 100 dB)', () => {
    const lowNoisePyro = cat.query({ medium: 'pyro', tag: 'low-noise' }) as PyroEffect[]
    expect(lowNoisePyro.length).toBeGreaterThanOrEqual(3)
    const categories = new Set(lowNoisePyro.map((e) => e.category))
    expect(categories.has('comet')).toBe(true)
    expect(categories.has('crossette')).toBe(true)
    expect(categories.has('mine')).toBe(true)
    for (const e of lowNoisePyro) expect(e.noiseDbAt15m).toBeLessThanOrEqual(100)
  })

  it('covers the July 4th / NYE palette tags', () => {
    for (const tag of ['red', 'white', 'blue', 'gold', 'silver']) {
      expect(cat.query({ tag }).length).toBeGreaterThan(0)
    }
    expect(cat.query({ tag: 'july4' }).length).toBeGreaterThan(0)
    expect(cat.query({ tag: 'nye' }).length).toBeGreaterThan(0)
  })

  it('covers every drone formation kind', () => {
    const all: DroneFormationKind[] = [
      'grid', 'ring', 'star', 'heart', 'flag', 'wave',
      'text', 'digit', 'scatter', 'bloom', 'clockRing',
      'bat', 'ghost', 'spiral', 'cometTail', 'saucer',
      'orrery', 'crescent', 'snowflake',
    ]
    const present = new Set(DRONE_EFFECTS.map((e) => e.formation))
    for (const kind of all) expect(present.has(kind), `formation ${kind}`).toBe(true)
  })

  it('covers every laser shape', () => {
    const all: LaserShape[] = [
      'beamFan', 'cone', 'tunnel', 'lissajous', 'sweep', 'starfield', 'chevron',
      'helix', 'web', 'curtain',
    ]
    const present = new Set(LASER_EFFECTS.map((e) => e.shape))
    for (const shape of all) expect(present.has(shape), `shape ${shape}`).toBe(true)
  })

  it('covers every panel pattern kind', () => {
    const all: PanelPatternKind[] = [
      'solid', 'gradientWipe', 'sparkle', 'flagStripes', 'waveformBars',
      'text', 'strobe', 'chase', 'fireworks',
      'embers', 'starfield', 'aurora', 'lightning', 'eyes',
    ]
    const present = new Set(PANEL_EFFECTS.map((e) => e.pattern))
    for (const kind of all) expect(present.has(kind), `pattern ${kind}`).toBe(true)
  })

  it('has five fabrication set pieces covering all kinds', () => {
    expect(FABRICATION_EFFECTS).toHaveLength(5)
    expect(new Set(FABRICATION_EFFECTS.map((e) => e.kind))).toEqual(
      new Set(['waterfall', 'lancework', 'gerbFan', 'wheel']),
    )
  })

  it('every pyro entry respects the audience distance rule', () => {
    for (const p of PYRO_EFFECTS) {
      expect(p.minAudienceDistanceM).toBeGreaterThanOrEqual(0.84 * p.caliberMm)
    }
  })
})
