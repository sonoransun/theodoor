import { describe, expect, it } from 'vitest'
import {
  beamFlyover,
  beamPingPong,
  beamSlew,
  beamStereoPair,
  beamTag,
  beamToll,
  beamWhisper,
  crowdBandwidth,
  crowdHeartbeat,
  crowdRadial,
  crowdSectionChase,
  crowdText,
  crowdWave,
} from '../src/choreo/index.js'
import {
  BEAM_SLEW_MARGIN,
  angularDistanceDeg,
  beamAimAt,
  beamTargetAt,
} from '../src/acoustics/beams.js'
import { crowdGridFor, lakesidePark } from '../src/site/index.js'
import type {
  BeamEffect,
  CompiledCue,
  CrowdEffect,
  EffectDef,
  MusicAnchor,
} from '../src/contracts.js'

// ---------------------------------------------------------------------------
// Local effect stubs (generators/detectors never import the catalog)
// ---------------------------------------------------------------------------

const crowdFx = (id: string, maskUpdateHz: number): CrowdEffect => ({
  id,
  name: id,
  medium: 'crowd',
  tags: ['crowd'],
  noiseDbAt15m: 40,
  durationSec: 8,
  pattern: 'wave',
  channel: 'wristband',
  maskUpdateHz,
  colors: ['#ffffff'],
})

const beamFx = (id: string): BeamEffect => ({
  id,
  name: id,
  medium: 'beam',
  tags: ['beam'],
  noiseDbAt15m: 66,
  durationSec: 4,
  program: 'whisperZone',
  beamWidthDeg: 10,
  carrierBandLabel: 'u-band-40',
  maxCarrierDbAtFocus: 100,
  contentTag: 'narration',
})

const effects = new Map<string, EffectDef>(
  (
    [crowdFx('cw10', 10), crowdFx('cw15', 15), crowdFx('cw12', 12), crowdFx('cw20', 20), beamFx('bw')] as EffectDef[]
  ).map((e) => [e.id, e]),
)
const getEffect = (id: string): EffectDef | undefined => effects.get(id)

type TestCue = CompiledCue & { priority?: number }

function ccue(id: string, over: Partial<TestCue> = {}): TestCue {
  return {
    id,
    trackId: 'trk',
    medium: 'crowd',
    effectId: 'cw10',
    positionId: 'mast-west',
    targetSec: 0.1,
    fireSec: 0,
    anticipationSec: 0.1,
    durationSec: 8,
    seed: 1,
    ...over,
  }
}

// lakesidePark with the masts pinned to a 30 frames/s budget — the bandwidth
// fixtures below hand-stack mask rates against that cap (the venue's real
// masts carry 1500 frames/s of broadcast headroom).
const stock = lakesidePark()
const site = {
  ...stock,
  assets: stock.assets.map((a) =>
    a.crowdMast ? { ...a, crowdMast: { ...a.crowdMast, framesPerSec: 30 } } : a,
  ),
}
const beat = (b: number): MusicAnchor => ({ kind: 'beat', beat: b })

// ---------------------------------------------------------------------------
// crowdBandwidth
// ---------------------------------------------------------------------------

describe('crowdBandwidth', () => {
  it('passes when concurrent mask rates sum exactly to the mast cap', () => {
    // lakesidePark masts address 30 frames/s; 15 + 15 = 30 is fine.
    const cues = [
      ccue('a', { effectId: 'cw15', fireSec: 0, targetSec: 0.1, durationSec: 10 }),
      ccue('b', { effectId: 'cw15', fireSec: 1, targetSec: 1.1, durationSec: 10 }),
    ]
    expect(crowdBandwidth(cues, site.assets, getEffect)).toEqual([])
  })

  it('flags the over-cap cue at the worst instant', () => {
    const cues = [
      ccue('a', { effectId: 'cw15', fireSec: 0, targetSec: 0.1, durationSec: 10 }),
      ccue('b', { effectId: 'cw15', fireSec: 1, targetSec: 1.1, durationSec: 10 }),
      ccue('c', { effectId: 'cw12', fireSec: 2, targetSec: 2.1, durationSec: 10 }),
    ]
    const diags = crowdBandwidth(cues, site.assets, getEffect)
    expect(diags.length).toBe(1)
    const d = diags[0]!
    expect(d.code).toBe('CROWD_BANDWIDTH')
    expect(d.severity).toBe('error')
    expect(d.assetId).toBe('mast-west')
    expect(d.tSec).toBe(2) // 15 + 15 + 12 = 42 Hz first exceeds 30 at c's start
    expect(d.cueIds).toEqual(['c'])
  })

  it('sheds the lowest-priority cues first and lists them in that order', () => {
    const cues = [
      ccue('high', { effectId: 'cw20', priority: 9, durationSec: 5 }),
      ccue('mid', { effectId: 'cw20', priority: 1, durationSec: 5 }),
      ccue('low', { effectId: 'cw20', priority: 0, durationSec: 5 }),
    ]
    const diags = crowdBandwidth(cues, site.assets, getEffect)
    expect(diags.length).toBe(1)
    // 'high' (20 Hz) fits under the 30 Hz cap; 'mid' and 'low' overflow.
    expect(diags[0]!.cueIds).toEqual(['low', 'mid'])
    expect(diags[0]!.tSec).toBe(0)
  })

  it('emits one diagnostic per overloaded mast', () => {
    const cues = [
      ccue('w1', { effectId: 'cw20' }),
      ccue('w2', { effectId: 'cw20' }),
      ccue('e1', { effectId: 'cw20', positionId: 'mast-east' }),
      ccue('e2', { effectId: 'cw20', positionId: 'mast-east' }),
    ]
    const diags = crowdBandwidth(cues, site.assets, getEffect)
    expect(diags.map((d) => d.assetId)).toEqual(['mast-east', 'mast-west'])
  })

  it('ignores non-crowd cues and positions without a mast spec', () => {
    const cues = [
      ccue('a', { medium: 'pyro', effectId: 'cw20' }),
      ccue('b', { medium: 'pyro', effectId: 'cw20' }),
      ccue('c', { effectId: 'cw20', positionId: 'rack-1' }),
      ccue('d', { effectId: 'cw20', positionId: 'rack-1' }),
    ]
    expect(crowdBandwidth(cues, site.assets, getEffect)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// beamSlew
// ---------------------------------------------------------------------------

describe('beamSlew', () => {
  const grid = crowdGridFor(site)!
  const westCell = grid.cells[0]! // row 0, far west of the lawn
  let eastCell = westCell
  for (const c of grid.cells) {
    if (c.row === 0 && c.centroid.x > eastCell.centroid.x) eastCell = c
  }

  const bcue = (
    id: string,
    cell: { index: number },
    fireSec: number,
    targetSec: number,
    durationSec: number,
  ): CompiledCue => ({
    id,
    trackId: 'trk',
    medium: 'beam',
    effectId: 'bw',
    positionId: 'beam-north-west',
    targetSec,
    fireSec,
    anticipationSec: targetSec - fireSec,
    durationSec,
    seed: 1,
    params: { targetCellId: cell.index },
  })

  // The slew the detector must require for the west→east retarget.
  const asset = site.assets.find((a) => a.id === 'beam-north-west')!
  const prev = bcue('b-000', westCell, 9.2, 10, 2) // window ends at 12
  const mkNext = (fireSec: number): CompiledCue =>
    bcue('b-001', eastCell, fireSec, fireSec + 0.8, 2)
  const fx = beamFx('bw')
  const needSec =
    (angularDistanceDeg(
      beamAimAt(asset, beamTargetAt(prev, fx, site, 12)),
      beamAimAt(asset, beamTargetAt(mkNext(12.2), fx, site, 13)),
    ) /
      asset.beamArray!.steerRateDegPerSec) *
    BEAM_SLEW_MARGIN

  it('spans a real cross-stage arc on the demo site', () => {
    expect(needSec).toBeGreaterThan(0.5) // ~57° at 45°/s with margin ≈ 1.4 s
  })

  it('passes consecutive retargets with a generous gap', () => {
    const cues = [prev, mkNext(12 + needSec + 0.5)]
    expect(beamSlew(cues, site, getEffect)).toEqual([])
  })

  it('flags a cross-stage retarget 0.2 s after the previous window ends', () => {
    const next = mkNext(12.2)
    const diags = beamSlew([prev, next], site, getEffect)
    expect(diags.length).toBe(1)
    const d = diags[0]!
    expect(d.code).toBe('BEAM_SLEW')
    expect(d.severity).toBe('error')
    expect(d.cueIds).toEqual(['b-000', 'b-001'])
    expect(d.assetId).toBe('beam-north-west')
    expect(d.tSec).toBe(12.2)
    expect(d.message).toContain(needSec.toFixed(3))
  })

  it('skips cues on assets without a beamArray spec', () => {
    const cues = [
      { ...prev, positionId: 'laser-west' },
      { ...mkNext(12.2), positionId: 'laser-west' },
    ]
    expect(beamSlew(cues, site, getEffect)).toEqual([])
  })

  it('beats put pingPong end-of-window aims on the real beat grid', () => {
    // periodBeats=1 pingPong over [west, east], window [10, 11). On the
    // 120 bpm grid (0.5 s/beat) two beats elapse by the window end → the head
    // parks on WEST (path[0]); the legacy 1 s/beat fallback says EAST. The
    // next cue re-targets east 0.2 s later — feasible only under the fallback
    // clock, so the detector must flag it once it is given the beat grid.
    const ppFx: BeamEffect = { ...beamFx('bpp'), program: 'pingPong' }
    const getFx = (id: string): EffectDef | undefined => (id === 'bpp' ? ppFx : getEffect(id))
    const ppPrev: CompiledCue = {
      ...bcue('pp-000', westCell, 9.2, 10, 1),
      effectId: 'bpp',
      params: { pathCellIds: [westCell.index, eastCell.index], periodBeats: 1 },
    }
    const nextEast = bcue('pp-001', eastCell, 11.2, 11.4, 2)
    const beats: number[] = []
    for (let t = 0; t <= 30; t += 0.5) beats.push(t) // 120 bpm
    // Without beats (prior behavior): end aim = east = next aim → no finding.
    expect(beamSlew([ppPrev, nextEast], site, getFx)).toEqual([])
    // With the real beat grid: end aim = west, a cross-stage arc in 0.2 s.
    const diags = beamSlew([ppPrev, nextEast], site, getFx, beats)
    expect(diags.length).toBe(1)
    expect(diags[0]!.code).toBe('BEAM_SLEW')
    expect(diags[0]!.cueIds).toEqual(['pp-000', 'pp-001'])
  })
})

// ---------------------------------------------------------------------------
// crowd generators
// ---------------------------------------------------------------------------

describe('crowd generators', () => {
  it('crowdWave emits one deterministic cue with wave params', () => {
    const spec = {
      effect: 'cw15',
      mastId: 'mast-west',
      from: beat(16),
      periodBeats: 8,
      rgb: [0.1, 0.4, 1],
      dirDeg: 90,
    }
    const cues = crowdWave(spec)
    expect(cues).toEqual(crowdWave(spec)) // pure & deterministic
    expect(cues).toEqual([
      {
        id: 'cwave-000',
        effectId: 'cw15',
        anchor: beat(16),
        positionId: 'mast-west',
        params: { periodBeats: 8, dirDeg: 90, rgb: [0.1, 0.4, 1] },
      },
    ])
  })

  it('crowdRadial carries originCell (and honors idPrefix/priority)', () => {
    const cues = crowdRadial({
      effect: 'cw12',
      mastId: 'mast-east',
      land: beat(4),
      originCell: 42,
      periodBeats: 2,
      idPrefix: 'boom',
      priority: 3,
    })
    expect(cues.length).toBe(1)
    expect(cues[0]!.id).toBe('boom-000')
    expect(cues[0]!.priority).toBe(3)
    expect(cues[0]!.params).toEqual({ originCell: 42, periodBeats: 2 })
  })

  it('crowdSectionChase emits one cue per section, stepped in beats', () => {
    const cues = crowdSectionChase({
      effect: 'cw12',
      mastId: 'mast-west',
      startLand: beat(8),
      stepBeats: 2,
      sections: 4,
    })
    expect(cues.map((c) => c.id)).toEqual(['cchase-000', 'cchase-001', 'cchase-002', 'cchase-003'])
    expect(cues.map((c) => c.anchor)).toEqual([
      beat(8),
      { kind: 'beat', beat: 8, offsetBeats: 2 },
      { kind: 'beat', beat: 8, offsetBeats: 4 },
      { kind: 'beat', beat: 8, offsetBeats: 6 },
    ])
    for (const c of cues) expect(c.params).toEqual({ sections: 4 })
    expect(() =>
      crowdSectionChase({ effect: 'cw12', mastId: 'mast-west', startLand: beat(0), stepBeats: 1, sections: 0 }),
    ).toThrow()
  })

  it('crowdText puts the marquee string in params.text', () => {
    const cues = crowdText('THANK YOU', { effect: 'cw20', mastId: 'mast-west', land: beat(64) })
    expect(cues.length).toBe(1)
    expect(cues[0]!.id).toBe('ctext-000')
    expect(cues[0]!.params).toEqual({ text: 'THANK YOU' })
  })

  it('crowdHeartbeat emits a single cue, originCell optional', () => {
    expect(crowdHeartbeat({ effect: 'cw10', mastId: 'mast-east', land: beat(32) })).toEqual([
      { id: 'cheart-000', effectId: 'cw10', anchor: beat(32), positionId: 'mast-east', params: {} },
    ])
    const withOrigin = crowdHeartbeat({
      effect: 'cw10',
      mastId: 'mast-east',
      land: beat(32),
      originCell: 7,
    })
    expect(withOrigin[0]!.params).toEqual({ originCell: 7 })
  })
})

// ---------------------------------------------------------------------------
// beam generators
// ---------------------------------------------------------------------------

describe('beam generators', () => {
  it('beamWhisper emits one cue with targetCellId and gainDb', () => {
    const cues = beamWhisper({
      effect: 'bw',
      arrayId: 'beam-south-west',
      targetCellId: 12,
      land: beat(24),
      gainDb: -6,
    })
    expect(cues).toEqual([
      {
        id: 'whisper-000',
        effectId: 'bw',
        anchor: beat(24),
        positionId: 'beam-south-west',
        params: { targetCellId: 12, gainDb: -6 },
      },
    ])
  })

  it('beamFlyover carries the cell path and rejects an empty one', () => {
    const cues = beamFlyover({
      effect: 'bw',
      arrayId: 'beam-north-east',
      pathCellIds: [3, 40, 77],
      land: beat(12),
    })
    expect(cues.length).toBe(1)
    expect(cues[0]!.id).toBe('flyover-000')
    expect(cues[0]!.params).toEqual({ pathCellIds: [3, 40, 77] })
    expect(() =>
      beamFlyover({ effect: 'bw', arrayId: 'beam-north-east', pathCellIds: [], land: beat(12) }),
    ).toThrow()
  })

  it('beamStereoPair emits exactly two cues, roles L/R, sharing pairId and anchor', () => {
    const spec = {
      effect: 'bw',
      arrayIds: ['beam-south-west', 'beam-south-east'] as const,
      targetCellId: 150,
      land: beat(48),
      pairId: 'duet-1',
      extraDelayMs: 12,
    }
    const cues = beamStereoPair(spec)
    expect(cues).toEqual(beamStereoPair(spec)) // deterministic
    expect(cues.length).toBe(2)
    const [l, r] = [cues[0]!, cues[1]!]
    expect(l.id).toBe('stereo-000')
    expect(r.id).toBe('stereo-001')
    expect(l.positionId).toBe('beam-south-west')
    expect(r.positionId).toBe('beam-south-east')
    expect(l.params!.role).toBe('L')
    expect(r.params!.role).toBe('R')
    expect(l.params!.pairId).toBe('duet-1')
    expect(r.params!.pairId).toBe('duet-1')
    expect(l.anchor).toEqual(r.anchor)
    expect(l.anchor).toEqual(beat(48))
    expect(l.params!.extraDelayMs).toBeUndefined() // the delay rides the R channel
    expect(r.params!.extraDelayMs).toBe(12)
    expect(l.params!.targetCellId).toBe(150)
    expect(r.params!.targetCellId).toBe(150)
  })

  it('beamPingPong maps cellIds onto params.pathCellIds with periodBeats', () => {
    const cues = beamPingPong({
      effect: 'bw',
      arrayId: 'beam-north-west',
      cellIds: [5, 300],
      land: beat(16),
      periodBeats: 2,
    })
    expect(cues.length).toBe(1)
    expect(cues[0]!.id).toBe('pingpong-000')
    expect(cues[0]!.params).toEqual({ pathCellIds: [5, 300], periodBeats: 2 })
  })

  it('beamTag names the source cue (targetCellId as fallback)', () => {
    const cues = beamTag({
      effect: 'bw',
      arrayId: 'beam-north-east',
      sourceCueId: 'finale-012',
      targetCellId: 9,
      land: beat(96),
    })
    expect(cues.length).toBe(1)
    expect(cues[0]!.id).toBe('btag-000')
    expect(cues[0]!.params).toEqual({ sourceCueId: 'finale-012', targetCellId: 9 })
  })

  it('beamToll addresses every cell at once', () => {
    const cues = beamToll({ effect: 'bw', arrayId: 'beam-south-east', land: beat(0) })
    expect(cues).toEqual([
      {
        id: 'toll-000',
        effectId: 'bw',
        anchor: beat(0),
        positionId: 'beam-south-east',
        params: { cells: 'all' },
      },
    ])
  })
})
