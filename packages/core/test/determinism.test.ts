/**
 * determinism.test.ts — end-to-end determinism over the full pipeline:
 * builder → compile → sim → exporters. One ~25-cue mixed show (all five
 * media, drone formation chain) built twice from scratch must produce
 * byte-identical results everywhere; changing ONLY the seed must not.
 */
import { describe, expect, it } from 'vitest'
import { starterCatalog, getEffectFrom } from '../src/catalog/index.js'
import { lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import type { BuildResult } from '../src/show/index.js'
import { SimEngine, runHeadless } from '../src/sim/index.js'
import { buildIldaFile, cueSheetMarkdown, firingScriptCsv } from '../src/export/index.js'
import type { SimSnapshot } from '../src/contracts.js'

// ---------------------------------------------------------------------------
// fnv1a-32 over raw Float32Array bytes
// ---------------------------------------------------------------------------

function fnv1aBytes(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ bytes[i]!) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function hashFloat32(arrays: readonly Float32Array[]): number {
  let h = 0x811c9dc5
  for (const a of arrays) {
    h = fnv1aBytes(h, new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
  }
  return h >>> 0
}

const starHash = (s: SimSnapshot): number =>
  hashFloat32([s.stars.pos, s.stars.rgb, s.stars.brightness, s.stars.sizeM])
const droneHash = (s: SimSnapshot): number =>
  hashFloat32([s.drones.pos, s.drones.vel, s.drones.rgb])

// ---------------------------------------------------------------------------
// The show: ~25 cues, all five media, one drone formation chain
// ---------------------------------------------------------------------------

/** Build the whole show from scratch (fresh site/catalog/timeline objects). */
function buildShow(seed: number): BuildResult {
  const catalog = starterCatalog()
  const tl = buildTimelineFromScore(getScore('odeToJoy')!)
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'determinism-e2e',
    title: 'Determinism End-to-End',
    seed,
    site: lakesidePark(),
    catalog,
  })
    .music(tl)
    .preRoll(2)

  b.pyro
    .fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) }) // lands 4 s
    .fire({ effect: 'willow-150-gold', position: 'rack-4', land: m.time(26) }) // stars alive at 30 s
    .fire({ effect: 'mine-50-silver', position: 'rack-8', land: m.downbeat(14) }) // 28 s
    .volley({
      effects: ['peony-75-red', 'peony-75-blue'],
      positions: ['rack-2', 'rack-3', 'rack-5', 'rack-6'],
      land: m.phraseEnd(0), // 16 s
      staggerBeats: 0.5,
    })
    .chase({
      effect: 'comet-30-gold',
      positions: ['rack-1', 'rack-3', 'rack-5', 'rack-7'],
      startLand: m.beat(40), // 20 s
      stepBeats: 1,
    })
    .barrage({
      window: m.climaxRamp(12), // peak at the 56 s climax
      effectPool: ['peony-75-red', 'peony-100-white', 'brocade-200-gold'],
      positions: ['rack-1', 'rack-2', 'rack-3', 'rack-4', 'rack-5', 'rack-6', 'rack-7', 'rack-8'],
      startRateHz: 0.5,
      endRateHz: 1.5,
      idPrefix: 'fin',
    })

  // Formation chain on one pad: ring, then morph into a star held past 30 s.
  b.drones
    .formation({
      effect: 'ring-formation-60',
      position: 'pad-1',
      by: m.barBeat(5, 1), // 8 s
      holdSec: 4,
      params: { count: 40, scaleM: 24 },
    })
    .formation({
      effect: 'star-formation-80',
      position: 'pad-1',
      by: m.time(26),
      holdSec: 6,
      params: { count: 40, scaleM: 30 },
    })

  b.lasers
    .pattern({ effect: 'laser-lissajous-rgb', position: 'laser-east', from: m.time(20), durBeats: 24 })
    .pattern({ effect: 'laser-fan-rgb', position: 'laser-west', from: m.beat(44), durBeats: 16 }) // 22 s

  b.panels
    .pattern({ effect: 'panel-flag-stripes', position: 'panel-west', from: m.downbeat(2) })
    .ticker('THEODOOR', { position: 'panel-east', from: m.time(10) })

  b.fabrication.cue({ effectId: 'waterfall-30m', anchor: m.time(12), positionId: 'rack-6' })

  return b.build()
}

const getEffect = getEffectFrom(starterCatalog())

describe('end-to-end determinism', () => {
  const a = buildShow(1)
  const b = buildShow(1)

  it('the show is the intended shape (~25 cues, all five media)', () => {
    const media = new Set(a.compiled.cues.map((c) => c.medium))
    expect([...media].sort()).toEqual(['drone', 'fabrication', 'laser', 'panel', 'pyro'])
    expect(a.compiled.cues.length).toBeGreaterThanOrEqual(25)
    expect(a.compiled.cues.filter((c) => c.medium === 'drone').length).toBe(2)
  })

  it('compile twice → byte-identical CompiledShow JSON', () => {
    expect(JSON.stringify(a.compiled)).toBe(JSON.stringify(b.compiled))
    expect(JSON.stringify(a.show)).toBe(JSON.stringify(b.show))
  })

  it('runHeadless to 30 s twice → identical star and drone snapshot hashes', () => {
    const runA = runHeadless(a.compiled, { toSec: 30 })
    const runB = runHeadless(b.compiled, { toSec: 30 })

    const snapA = runA.engine.snapshot()
    const snapB = runB.engine.snapshot()
    // The hashes must be over real content: willow stars and the held star
    // formation are both alive at t = 30 s.
    expect(snapA.t).toBe(30)
    expect(snapA.stars.count).toBeGreaterThan(0)
    expect(snapA.drones.count).toBeGreaterThan(0)

    expect(starHash(snapA)).toBe(starHash(snapB))
    expect(droneHash(snapA)).toBe(droneHash(snapB))
    expect(JSON.stringify(runA.stats)).toBe(JSON.stringify(runB.stats))
  })

  it('firingScriptCsv and cueSheetMarkdown are byte-identical across runs', () => {
    const csvA = firingScriptCsv(a.compiled, getEffect)
    const csvB = firingScriptCsv(b.compiled, getEffect)
    expect(csvA.length).toBeGreaterThan(0)
    expect(csvA).toBe(csvB)

    const mdA = cueSheetMarkdown(a.compiled, getEffect)
    const mdB = cueSheetMarkdown(b.compiled, getEffect)
    expect(mdA.length).toBeGreaterThan(0)
    expect(mdA).toBe(mdB)
  })

  it('buildIldaFile over 2 laser frames is byte-identical across runs', () => {
    const frames = (compiled: BuildResult['compiled']): Uint8Array => {
      const engine = new SimEngine(compiled)
      engine.advanceTo(24) // both laser cues active: lissajous 20 s→, fan 22 s→
      const laserFrames = engine.snapshot().laserFrames
      expect(laserFrames.length).toBe(2)
      expect(laserFrames[0]!.points.length).toBeGreaterThan(0)
      return buildIldaFile(
        [laserFrames[0]!.points, laserFrames[1]!.points],
        { frameName: 'DET-E2E' },
      )
    }
    const bytesA = frames(a.compiled)
    const bytesB = frames(b.compiled)
    expect(bytesA.length).toBe(bytesB.length)
    expect(Buffer.from(bytesA).equals(Buffer.from(bytesB))).toBe(true)
  })

  it('sensitivity control: changing ONLY meta.seed changes the star hash', () => {
    const other = buildShow(2)
    expect(other.show.meta.seed).toBe(2)
    // Identical authoring apart from the seed:
    expect(JSON.stringify({ ...other.show, meta: { ...other.show.meta, seed: 1 } })).toBe(
      JSON.stringify(a.show),
    )
    const runA = runHeadless(a.compiled, { toSec: 30 })
    const runOther = runHeadless(other.compiled, { toSec: 30 })
    expect(starHash(runOther.engine.snapshot())).not.toBe(starHash(runA.engine.snapshot()))
  })
})
