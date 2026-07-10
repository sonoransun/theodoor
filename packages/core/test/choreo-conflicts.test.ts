import { describe, expect, it } from 'vitest'
import { PIN_REFIRE_GAP_SEC, droneOverlap, pinCapacity } from '../src/choreo/index.js'
import type { CompiledCue, PositionedAsset } from '../src/contracts.js'

const rackAsset = (id: string, pins: number, maxSimul: number): PositionedAsset => ({
  id,
  kind: 'mortarRack',
  pos: { x: 0, y: 0 },
  headingDeg: 0,
  elevationM: 0,
  rack: { calibersMm: [75], tiltDeg: 0, pinsPerModule: pins, maxSimultaneousPins: maxSimul },
})

const padAsset = (id: string): PositionedAsset => ({
  id,
  kind: 'dronePad',
  pos: { x: 0, y: 0 },
  headingDeg: 0,
  elevationM: 0,
  fleet: { count: 100, vMaxMps: 8, aMaxMps2: 4, rMinM: 3 },
})

function cue(id: string, over: Partial<CompiledCue> = {}): CompiledCue {
  return {
    id,
    trackId: 'trk',
    medium: 'pyro',
    effectId: 'fx',
    positionId: 'rackA',
    targetSec: 12,
    fireSec: 10,
    anticipationSec: 2,
    durationSec: 1,
    seed: 1,
    ...over,
  }
}

describe('pinCapacity', () => {
  it('flags 9 simultaneous cues on an 8-pin rack', () => {
    const cues = Array.from({ length: 9 }, (_, i) => cue(`c-${String(i).padStart(3, '0')}`))
    const diags = pinCapacity(cues, [rackAsset('rackA', 8, 8)])
    expect(diags.length).toBe(1)
    const d = diags[0]!
    expect(d.code).toBe('PIN_CAPACITY')
    expect(d.severity).toBe('error')
    expect(d.assetId).toBe('rackA')
    expect(d.tSec).toBe(10)
    expect(d.cueIds).toContain('c-008') // the overflowing 9th cue
  })

  it('passes exactly 8 simultaneous cues on an 8-pin rack', () => {
    const cues = Array.from({ length: 8 }, (_, i) => cue(`c-${String(i).padStart(3, '0')}`))
    expect(pinCapacity(cues, [rackAsset('rackA', 8, 8)])).toEqual([])
  })

  it(`enforces the ${PIN_REFIRE_GAP_SEC}s re-fire gap across the module`, () => {
    // 8 pins all fired at t=10; a 9th cue at t=11 finds every pin still busy.
    const cues = [
      ...Array.from({ length: 8 }, (_, i) =>
        cue(`c-${String(i).padStart(3, '0')}`, { fireSec: 10, targetSec: 12 }),
      ),
      cue('d-000', { fireSec: 11, targetSec: 13 }),
      // After the gap has elapsed, firing again is fine.
      cue('e-000', { fireSec: 12.5, targetSec: 14.5 }),
    ]
    const diags = pinCapacity(cues, [rackAsset('rackA', 8, 8)])
    expect(diags.length).toBe(1)
    expect(diags[0]!.cueIds).toEqual(['d-000'])
    expect(diags[0]!.tSec).toBe(11)
  })

  it('ignores non-pyro cues and positions without racks', () => {
    const cues = [
      cue('a', { medium: 'drone', positionId: 'rackA' }),
      cue('b', { positionId: 'unknown-position' }),
      cue('c', {}),
    ]
    expect(pinCapacity(cues, [rackAsset('rackA', 8, 8)])).toEqual([])
  })
})

describe('droneOverlap', () => {
  it('flags overlapping formation cues on the same pad', () => {
    const cues = [
      cue('m-001', {
        medium: 'drone',
        positionId: 'padA',
        fireSec: 10,
        targetSec: 20,
        durationSec: 10, // occupies [10, 30]
      }),
      cue('m-002', {
        medium: 'drone',
        positionId: 'padA',
        fireSec: 25,
        targetSec: 30,
        durationSec: 5, // occupies [25, 35] — overlaps m-001
      }),
    ]
    const diags = droneOverlap(cues)
    expect(diags.length).toBe(1)
    const d = diags[0]!
    expect(d.code).toBe('DRONE_OVERLAP')
    expect(d.severity).toBe('error')
    expect(d.cueIds).toEqual(['m-001', 'm-002'])
    expect(d.assetId).toBe('padA')
    expect(d.tSec).toBe(25)
  })

  it('allows disjoint and touching intervals, and separate pads', () => {
    const cues = [
      cue('m-001', { medium: 'drone', positionId: 'padA', fireSec: 10, targetSec: 20, durationSec: 10 }),
      cue('m-002', { medium: 'drone', positionId: 'padA', fireSec: 30, targetSec: 35, durationSec: 5 }), // touches at 30
      cue('m-003', { medium: 'drone', positionId: 'padB', fireSec: 12, targetSec: 22, durationSec: 10 }),
    ]
    expect(droneOverlap(cues)).toEqual([])
  })

  it('reports every overlapping pair when three cues stack up', () => {
    const mk = (id: string, fire: number): CompiledCue =>
      cue(id, { medium: 'drone', positionId: 'padA', fireSec: fire, targetSec: fire + 40, durationSec: 10 })
    const diags = droneOverlap([mk('m-1', 0), mk('m-2', 5), mk('m-3', 10)])
    expect(diags.length).toBe(3) // (1,2), (1,3), (2,3)
    for (const d of diags) expect(d.code).toBe('DRONE_OVERLAP')
  })

  it('ignores pyro cues entirely', () => {
    const cues = [cue('p-1', { fireSec: 10 }), cue('p-2', { fireSec: 10 })]
    expect(droneOverlap(cues)).toEqual([])
  })
})
