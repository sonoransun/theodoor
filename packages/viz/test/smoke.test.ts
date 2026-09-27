import { describe, expect, it } from 'vitest'
import type { CompiledShow, EffectDef, Wind } from '@theodoor/core'
import { getEffectFrom, lakesidePark, starterCatalog } from '@theodoor/core'
import {
  SMOKE_DRIFT_FACTOR,
  SMOKE_PEAK_ALPHA,
  SMOKE_PUFFS_LARGE,
  smokeAlphaAt,
  smokeDriftXM,
  smokeLifeSec,
  smokePuffsAt,
  smokeRadiusAt,
} from '../src/render/smoke.js'

const getEffect = getEffectFrom(starterCatalog())

function compiledWith(cues: { id: string; effectId: string; positionId: string; targetSec: number }[]): CompiledShow {
  const site = lakesidePark()
  return {
    show: {
      meta: { id: 's', title: 'S', variant: 'standard', seed: 1 },
      music: {
        source: 'score', id: 'm', title: 'M', duration: 60,
        tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
        beats: [], downbeats: [], annotations: [], energy: [], tempoConfidence: 1,
      },
      site,
      catalogId: 'starter-v1',
      tracks: [],
    },
    cues: cues.map((c, i) => ({
      id: c.id, trackId: 'pyro', medium: 'pyro' as const, effectId: c.effectId, positionId: c.positionId,
      targetSec: c.targetSec, fireSec: c.targetSec - 2, anticipationSec: 2, durationSec: 2, seed: 1000 + i,
    })),
    diagnostics: [],
  }
}

const westerly: Wind = { dirDegFrom: 270, speedMps: 3, limitMps: 9 }

describe('smoke envelopes', () => {
  it('life grows with caliber', () => {
    expect(smokeLifeSec(75)).toBeCloseTo(9.5, 9)
    expect(smokeLifeSec(200)).toBeCloseTo(12, 9)
  })

  it('alpha is 0 before the burst and after the life, peaks early, decays monotonically', () => {
    expect(smokeAlphaAt(-1, 10)).toBe(0)
    expect(smokeAlphaAt(10, 10)).toBe(0)
    expect(smokeAlphaAt(0.6, 10)).toBeGreaterThan(smokeAlphaAt(0.1, 10))
    let prev = smokeAlphaAt(0.6, 10)
    for (let a = 1; a < 10; a += 0.5) {
      const v = smokeAlphaAt(a, 10)
      expect(v).toBeLessThan(prev)
      expect(v).toBeLessThanOrEqual(SMOKE_PEAK_ALPHA)
      prev = v
    }
  })

  it('radius grows from half to 1.4× the burst radius', () => {
    expect(smokeRadiusAt(40, 0, 10)).toBeCloseTo(20, 9)
    expect(smokeRadiusAt(40, 10, 10)).toBeCloseTo(56, 9)
    expect(smokeRadiusAt(40, 5, 10)).toBeGreaterThan(20)
    expect(smokeRadiusAt(40, 5, 10)).toBeLessThan(56)
  })

  it('drifts downwind: a westerly (from 270°) pushes smoke east (+x)', () => {
    expect(smokeDriftXM(westerly, 4)).toBeCloseTo(3 * SMOKE_DRIFT_FACTOR * 4, 9)
    expect(smokeDriftXM({ dirDegFrom: 90, speedMps: 3, limitMps: 9 }, 4)).toBeCloseTo(-3 * SMOKE_DRIFT_FACTOR * 4, 9)
    // A northerly moves smoke only in depth — invisible in the x–z view.
    expect(smokeDriftXM({ dirDegFrom: 0, speedMps: 3, limitMps: 9 }, 4)).toBeCloseTo(0, 9)
  })
})

describe('smokePuffsAt', () => {
  const compiled = compiledWith([
    { id: 'a', effectId: 'peony-75-red', positionId: 'rack-1', targetSec: 10 },
    { id: 'b', effectId: 'brocade-200-gold', positionId: 'rack-8', targetSec: 12 },
  ])

  it('emits nothing before the first burst and nothing once every cloud has died', () => {
    expect(smokePuffsAt(compiled, getEffect, westerly, 9.9)).toEqual([])
    expect(smokePuffsAt(compiled, getEffect, westerly, 12 + smokeLifeSec(200) + 0.01)).toEqual([])
  })

  it('places a small shell puff at its rack x + drift and burst height, big shells as several puffs', () => {
    const t = 11
    const puffs = smokePuffsAt(compiled, getEffect, westerly, t)
    expect(puffs).toHaveLength(1)
    const p = puffs[0]!
    const fx = getEffect('peony-75-red')!
    expect(fx.medium).toBe('pyro')
    if (fx.medium !== 'pyro') return
    expect(p.z).toBeCloseTo(fx.burstHeightM, 9)
    expect(p.x).toBeCloseTo(-120 + smokeDriftXM(westerly, 1), 9)
    expect(p.alpha).toBeGreaterThan(0)
    const later = smokePuffsAt(compiled, getEffect, westerly, 13)
    expect(later).toHaveLength(1 + SMOKE_PUFFS_LARGE)
  })

  it('is a pure function of t (seek-exact, deterministic)', () => {
    const a = smokePuffsAt(compiled, getEffect, westerly, 14.25)
    const b = smokePuffsAt(compiled, getEffect, westerly, 14.25)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.length).toBeGreaterThan(0)
  })

  it('ignores non-pyro cues and unknown effects', () => {
    const odd: CompiledShow = {
      ...compiled,
      cues: [
        { ...compiled.cues[0]!, medium: 'drone', effectId: 'ring-formation-60' },
        { ...compiled.cues[1]!, effectId: 'nope' },
      ],
    }
    const noop = (id: string): EffectDef | undefined => getEffect(id)
    expect(smokePuffsAt(odd, noop, westerly, 13)).toEqual([])
  })
})
