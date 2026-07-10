import { describe, expect, it } from 'vitest'
import type {
  DronePrimitive,
  FabricationEffect,
  LaserPrimitive,
  PanelPattern,
  PyroEffect,
} from '../src/contracts.js'
import {
  Catalog,
  FABRICATION_ANTICIPATION_SEC,
  anticipationSec,
  getEffectFrom,
} from '../src/catalog/index.js'

function pyro(over: Partial<PyroEffect> = {}): PyroEffect {
  return {
    id: 'test-peony',
    name: 'Test Peony',
    medium: 'pyro',
    tags: ['red'],
    noiseDbAt15m: 120,
    durationSec: 2,
    category: 'peony',
    caliberMm: 75,
    riseTimeSec: 2.2,
    burstHeightM: 90,
    burstRadiusM: 35,
    starCount: 80,
    colors: ['#ff0000'],
    dragK: 1.4,
    gravityBias: 0.15,
    minAudienceDistanceM: 65,
    ...over,
  }
}

function drone(over: Partial<DronePrimitive> = {}): DronePrimitive {
  return {
    id: 'test-ring',
    name: 'Test Ring',
    medium: 'drone',
    tags: ['low-noise'],
    noiseDbAt15m: 60,
    durationSec: 10,
    formation: 'ring',
    minDrones: 20,
    maxDrones: 200,
    scaleM: 50,
    ...over,
  }
}

function laser(over: Partial<LaserPrimitive> = {}): LaserPrimitive {
  return {
    id: 'test-laser',
    name: 'Test Laser',
    medium: 'laser',
    tags: ['low-noise'],
    noiseDbAt15m: 55,
    durationSec: 8,
    shape: 'sweep',
    pointsPerFrame: 128,
    colors: ['#00ff00'],
    ...over,
  }
}

function panel(over: Partial<PanelPattern> = {}): PanelPattern {
  return {
    id: 'test-panel',
    name: 'Test Panel',
    medium: 'panel',
    tags: ['low-noise'],
    noiseDbAt15m: 55,
    durationSec: 8,
    pattern: 'solid',
    fps: 30,
    ...over,
  }
}

function fabrication(over: Partial<FabricationEffect> = {}): FabricationEffect {
  return {
    id: 'test-waterfall',
    name: 'Test Waterfall',
    medium: 'fabrication',
    tags: ['set-piece'],
    noiseDbAt15m: 98,
    durationSec: 20,
    kind: 'waterfall',
    widthM: 30,
    heightM: 15,
    minAudienceDistanceM: 30,
    ...over,
  }
}

describe('Catalog construction', () => {
  it('accepts a valid set spanning all media', () => {
    const cat = new Catalog([pyro(), drone(), laser(), panel(), fabrication()])
    expect(cat.size).toBe(5)
    expect(cat.effects).toHaveLength(5)
  })

  it('throws on duplicate ids', () => {
    expect(() => new Catalog([pyro(), pyro()])).toThrowError(/duplicate effect id 'test-peony'/)
  })

  it('throws on non-positive caliberMm', () => {
    expect(() => new Catalog([pyro({ caliberMm: 0 })])).toThrowError(/caliberMm/)
  })

  it('throws on non-positive riseTimeSec', () => {
    expect(() => new Catalog([pyro({ riseTimeSec: 0 })])).toThrowError(/riseTimeSec/)
  })

  it('throws on non-positive burst dimensions', () => {
    expect(() => new Catalog([pyro({ burstHeightM: 0 })])).toThrowError(/burstHeightM/)
    expect(() => new Catalog([pyro({ burstRadiusM: -1 })])).toThrowError(/burstRadiusM/)
  })

  it('throws on noiseDbAt15m outside [40, 160] for any medium', () => {
    expect(() => new Catalog([pyro({ noiseDbAt15m: 39 })])).toThrowError(/noiseDbAt15m/)
    expect(() => new Catalog([pyro({ noiseDbAt15m: 161 })])).toThrowError(/noiseDbAt15m/)
    expect(() => new Catalog([drone({ noiseDbAt15m: 20 })])).toThrowError(/noiseDbAt15m/)
    expect(() => new Catalog([laser({ noiseDbAt15m: NaN })])).toThrowError(/noiseDbAt15m/)
  })

  it('throws when minAudienceDistanceM < 0.84 * caliberMm', () => {
    // 0.84 * 75 = 63 m: 62 must fail, 63 must pass.
    expect(() => new Catalog([pyro({ minAudienceDistanceM: 62 })])).toThrowError(
      /minAudienceDistanceM/,
    )
    expect(() => new Catalog([pyro({ minAudienceDistanceM: 63 })])).not.toThrow()
  })

  it('throws when minDrones > maxDrones', () => {
    expect(() => new Catalog([drone({ minDrones: 300, maxDrones: 200 })])).toThrowError(
      /minDrones/,
    )
  })

  it('throws on pointsPerFrame outside [8, 4096]', () => {
    expect(() => new Catalog([laser({ pointsPerFrame: 4 })])).toThrowError(/pointsPerFrame/)
    expect(() => new Catalog([laser({ pointsPerFrame: 5000 })])).toThrowError(/pointsPerFrame/)
    expect(() => new Catalog([laser({ pointsPerFrame: 8 })])).not.toThrow()
    expect(() => new Catalog([laser({ pointsPerFrame: 4096 })])).not.toThrow()
  })

  it('throws on fps outside [1, 60]', () => {
    expect(() => new Catalog([panel({ fps: 0 })])).toThrowError(/fps/)
    expect(() => new Catalog([panel({ fps: 61 })])).toThrowError(/fps/)
    expect(() => new Catalog([panel({ fps: 1 })])).not.toThrow()
    expect(() => new Catalog([panel({ fps: 60 })])).not.toThrow()
  })

  it('reports every problem in one error', () => {
    let message = ''
    try {
      new Catalog([pyro({ caliberMm: -1 }), pyro({ riseTimeSec: 0 }), drone({ noiseDbAt15m: 10 })])
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/duplicate effect id/)
    expect(message).toMatch(/caliberMm/)
    expect(message).toMatch(/riseTimeSec/)
    expect(message).toMatch(/noiseDbAt15m/)
  })
})

describe('Catalog lookup and query', () => {
  const cat = new Catalog([pyro(), drone(), laser(), panel(), fabrication()])

  it('get returns the entry; find returns undefined for unknown ids', () => {
    expect(cat.get('test-peony').medium).toBe('pyro')
    expect(cat.find('test-ring')?.medium).toBe('drone')
    expect(cat.find('nope')).toBeUndefined()
  })

  it('get throws a helpful message naming the missing id', () => {
    expect(() => cat.get('test-nonexistent')).toThrowError(/test-nonexistent/)
    expect(() => cat.get('test-nonexistent')).toThrowError(/find\(\)/)
  })

  it('query by medium', () => {
    expect(cat.query({ medium: 'pyro' }).map((e) => e.id)).toEqual(['test-peony'])
    expect(cat.query({ medium: 'drone' })).toHaveLength(1)
  })

  it('query by maxNoiseDb is inclusive', () => {
    expect(cat.query({ maxNoiseDb: 60 }).map((e) => e.id)).toEqual([
      'test-ring',
      'test-laser',
      'test-panel',
    ])
  })

  it('query by tag', () => {
    expect(cat.query({ tag: 'low-noise' })).toHaveLength(3)
    expect(cat.query({ tag: 'set-piece' }).map((e) => e.id)).toEqual(['test-waterfall'])
  })

  it('query with combined filters ANDs them', () => {
    expect(cat.query({ medium: 'laser', tag: 'low-noise', maxNoiseDb: 60 })).toHaveLength(1)
    expect(cat.query({ medium: 'laser', maxNoiseDb: 50 })).toHaveLength(0)
  })

  it('query with no filters returns everything', () => {
    expect(cat.query({})).toHaveLength(5)
  })
})

describe('anticipationSec', () => {
  it('pyro anticipation equals riseTimeSec (shells and mines alike)', () => {
    const shell = pyro({ riseTimeSec: 3.6 })
    const mine = pyro({ id: 'test-mine', category: 'mine', riseTimeSec: 0.2 })
    expect(anticipationSec(shell)).toBe(3.6)
    expect(anticipationSec(mine)).toBe(0.2)
  })

  it('fabrication anticipation is the fixed 0.1 s latency', () => {
    expect(anticipationSec(fabrication())).toBe(FABRICATION_ANTICIPATION_SEC)
    expect(FABRICATION_ANTICIPATION_SEC).toBe(0.1)
  })

  it('drone, laser, and panel anticipation is 0', () => {
    expect(anticipationSec(drone())).toBe(0)
    expect(anticipationSec(laser())).toBe(0)
    expect(anticipationSec(panel())).toBe(0)
  })

  it('is also exposed as a Catalog method', () => {
    const cat = new Catalog([pyro()])
    expect(cat.anticipationSec(cat.get('test-peony'))).toBe(2.2)
  })
})

describe('getEffectFrom', () => {
  it('adapts a Catalog into an optional-lookup function', () => {
    const cat = new Catalog([pyro(), drone()])
    const getEffect = getEffectFrom(cat)
    expect(getEffect('test-peony')?.id).toBe('test-peony')
    expect(getEffect('missing')).toBeUndefined()
  })
})
