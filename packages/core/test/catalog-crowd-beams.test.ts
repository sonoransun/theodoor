import { describe, expect, it } from 'vitest'
import type { BeamProgramKind, CrowdPatternKind } from '../src/contracts.js'
import { Catalog } from '../src/catalog/catalog.js'
import { BEAM_EFFECTS, CROWD_EFFECTS, STARTER_EFFECTS } from '../src/catalog/index.js'

describe('starter crowd + beam effects', () => {
  it('validate as part of the full starter set (constructor throws on any range violation)', () => {
    const cat = new Catalog(STARTER_EFFECTS)
    expect(cat.size).toBe(STARTER_EFFECTS.length)
    expect(cat.get('crowd-flood-rgb').medium).toBe('crowd')
    expect(cat.get('beam-whisper-narration').medium).toBe('beam')
  })

  it('has exactly 10 crowd and 9 beam entries with unique ids', () => {
    expect(CROWD_EFFECTS).toHaveLength(10)
    expect(BEAM_EFFECTS).toHaveLength(9)
    const ids = [...CROWD_EFFECTS, ...BEAM_EFFECTS].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every crowd entry is silent-rated (noiseDbAt15m === 40) and tagged low-noise + crowd', () => {
    for (const e of CROWD_EFFECTS) {
      expect(e.noiseDbAt15m, e.id).toBe(40)
      expect(e.tags, e.id).toContain('low-noise')
      expect(e.tags, e.id).toContain('crowd')
    }
  })

  it('every beam entry stays within the audible and carrier ceilings', () => {
    for (const e of BEAM_EFFECTS) {
      expect(e.noiseDbAt15m, e.id).toBeLessThanOrEqual(100)
      expect(e.maxCarrierDbAtFocus, e.id).toBeLessThanOrEqual(120)
      expect(e.tags, e.id).toContain('low-noise')
      expect(e.tags, e.id).toContain('beam')
      expect(e.carrierBandLabel, e.id).toBe('u-band-40')
    }
  })

  it('covers every crowd pattern kind', () => {
    const all: CrowdPatternKind[] = [
      'flood', 'wave', 'radialPulse', 'sectionChase', 'sparkle',
      'text', 'heartbeat', 'flashlightStarfield', 'hapticPulse',
    ]
    const present = new Set(CROWD_EFFECTS.map((e) => e.pattern))
    for (const kind of all) expect(present.has(kind), `pattern ${kind}`).toBe(true)
  })

  it('covers every beam program kind', () => {
    const all: BeamProgramKind[] = [
      'whisperZone', 'flyover', 'pingPong', 'stereoPair', 'sourceTag',
      'zonePulse', 'sweepLine',
    ]
    const present = new Set(BEAM_EFFECTS.map((e) => e.program))
    for (const kind of all) expect(present.has(kind), `program ${kind}`).toBe(true)
  })

  it('only hapticPulse crowd entries may omit colors; phone channel exists', () => {
    for (const e of CROWD_EFFECTS) {
      if (e.pattern !== 'hapticPulse') expect(e.colors.length, e.id).toBeGreaterThan(0)
    }
    expect(CROWD_EFFECTS.some((e) => e.channel === 'phone')).toBe(true)
    expect(CROWD_EFFECTS.some((e) => e.channel === 'wristband')).toBe(true)
  })
})
