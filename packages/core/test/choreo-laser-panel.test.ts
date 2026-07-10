import { describe, expect, it } from 'vitest'
import {
  laserFan,
  laserLissajous,
  laserSweep,
  panelChase,
  panelTicker,
  panelWash,
} from '../src/choreo/index.js'
import type { MusicAnchor } from '../src/contracts.js'

const anchor: MusicAnchor = { kind: 'barBeat', bar: 9, beat: 1 }

describe('laser cue generators', () => {
  it('laserFan carries spreadDeg/periodBeats/rgb/headId params', () => {
    const cues = laserFan({
      effectId: 'beam-fan',
      positionId: 'tower1',
      anchor,
      periodBeats: 4,
      spreadDeg: 60,
      rgb: [0, 1, 0.2],
      headId: 'head-2',
      beamCount: 7,
    })
    expect(cues.length).toBe(1)
    const c = cues[0]!
    expect(c.id).toBe('lfan-000')
    expect(c.positionId).toBe('tower1')
    expect(c.params).toEqual({
      periodBeats: 4,
      spreadDeg: 60,
      beamCount: 7,
      rgb: [0, 1, 0.2],
      headId: 'head-2',
    })
  })

  it('repeat emits stepped copies with offset anchors', () => {
    const cues = laserSweep({
      effectId: 'sweep',
      positionId: 'tower1',
      anchor,
      periodBeats: 2,
      spreadDeg: 90,
      repeat: { count: 4, stepBeats: 8 },
    })
    expect(cues.map((c) => c.id)).toEqual(['lsweep-000', 'lsweep-001', 'lsweep-002', 'lsweep-003'])
    cues.forEach((c, i) => {
      expect(c.anchor.kind).toBe('barBeat')
      const a = c.anchor as { offsetBeats?: number }
      expect(a.offsetBeats ?? 0).toBe(i * 8)
    })
  })

  it('laserLissajous defaults its figure ratios', () => {
    const c = laserLissajous({
      effectId: 'liss',
      positionId: 'tower2',
      anchor,
      periodBeats: 8,
    })[0]!
    expect(c.params).toEqual({ periodBeats: 8, ratioA: 3, ratioB: 2, phaseDeg: 90 })
  })
})

describe('panel cue generators', () => {
  it('panelTicker carries text/speedPxPerBeat/rgb per the CueParams doc', () => {
    const c = panelTicker({
      effectId: 'text-scroll',
      positionId: 'panelA',
      anchor,
      text: 'HAPPY NEW YEAR',
      speedPxPerBeat: 6,
      rgb: [1, 0.8, 0],
    })[0]!
    expect(c.id).toBe('ticker-000')
    expect(c.params).toEqual({
      text: 'HAPPY NEW YEAR',
      speedPxPerBeat: 6,
      rgb: [1, 0.8, 0],
    })
  })

  it('panelWash supports two-tone colors, panelChase carries periodBeats', () => {
    const wash = panelWash({
      effectId: 'wash',
      positionId: 'panelA',
      anchor,
      rgb: [1, 0, 0],
      rgb2: [0, 0, 1],
      periodBeats: 4,
    })[0]!
    expect(wash.params).toEqual({ rgb2: [0, 0, 1], periodBeats: 4, rgb: [1, 0, 0] })

    const chase = panelChase({
      effectId: 'chase',
      positionId: 'panelB',
      anchor,
      periodBeats: 1,
      priority: 3,
    })[0]!
    expect(chase.params).toEqual({ periodBeats: 1 })
    expect(chase.priority).toBe(3)
    expect(chase.id).toBe('pchase-000')
  })
})
