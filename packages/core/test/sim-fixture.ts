/**
 * sim-fixture.ts — hand-written CompiledShow fixtures for the sim tests.
 *
 * Deliberately built as plain JSON per contracts.ts (no show/ compiler —
 * that is the point of the interchange): cues carry explicit targetSec /
 * fireSec / seed, sorted by (fireSec, trackId, id).
 */

import type {
  CompiledCue,
  CompiledShow,
  CueParams,
  EnergyPoint,
  FleetSpec,
  Medium,
  MusicalTimeline,
  Seconds,
  SimSnapshot,
  SitePlan,
} from '../src/contracts.js'
import { ENERGY_DT_SEC } from '../src/contracts.js'
import { cueSeed } from '../src/math/index.js'
import { lakesidePark } from '../src/site/index.js'
import { STARTER_CATALOG_ID } from '../src/catalog/index.js'

/** Uniform 120 bpm timeline: beats every 0.5 s, downbeats every 2 s. */
export function makeMusic(duration: Seconds): MusicalTimeline {
  const beats: number[] = []
  for (let t = 0; t <= duration + 1e-9; t += 0.5) beats.push(Math.round(t * 2) / 2)
  const downbeats = beats.filter((_, i) => i % 4 === 0)
  const energy: EnergyPoint[] = []
  const bins = Math.floor(duration / ENERGY_DT_SEC) + 1
  for (let i = 0; i < bins; i++) {
    const t = i * ENERGY_DT_SEC
    const rms = 0.2 + 0.8 * (t / duration)
    energy.push({ time: t, rms, loudness: rms })
  }
  return {
    source: 'score',
    id: 'sim-test-music',
    title: 'Sim Test Music',
    duration,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats,
    downbeats,
    annotations: [],
    energy,
    tempoConfidence: 1,
  }
}

export interface CueSpec {
  id: string
  trackId: string
  medium: Medium
  effectId: string
  positionId: string
  targetSec: Seconds
  anticipationSec: Seconds
  durationSec: Seconds
  params?: CueParams
}

/** Assemble a CompiledShow over lakesidePark + the starter catalog. */
export function makeCompiled(
  specs: readonly CueSpec[],
  opts: {
    seed?: number
    musicDuration?: Seconds
    preRollSec?: Seconds
    /** Override pad-1's fleet (fixtures keep fleets small on purpose). */
    fleet?: FleetSpec
    site?: SitePlan
  } = {},
): CompiledShow {
  const seed = opts.seed ?? 7
  const base = opts.site ?? lakesidePark()
  const site: SitePlan = opts.fleet
    ? {
        ...base,
        assets: base.assets.map((a) =>
          a.kind === 'dronePad' ? { ...a, fleet: opts.fleet! } : a,
        ),
      }
    : base
  const cues: CompiledCue[] = specs.map((s) => ({
    id: s.id,
    trackId: s.trackId,
    medium: s.medium,
    effectId: s.effectId,
    positionId: s.positionId,
    targetSec: s.targetSec,
    fireSec: s.targetSec - s.anticipationSec,
    anticipationSec: s.anticipationSec,
    durationSec: s.durationSec,
    seed: cueSeed(seed, s.id),
    ...(s.params ? { params: s.params } : {}),
  }))
  cues.sort(
    (a, b) =>
      a.fireSec - b.fireSec || a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id),
  )
  return {
    show: {
      meta: { id: 'sim-test-show', title: 'Sim Test Show', variant: 'standard', seed },
      music: makeMusic(opts.musicDuration ?? 40),
      site,
      catalogId: STARTER_CATALOG_ID,
      tracks: [],
      ...(opts.preRollSec !== undefined ? { preRollSec: opts.preRollSec } : {}),
    },
    cues,
    diagnostics: [],
  }
}

/**
 * The 6-cue mixed show used across the sim tests (clean: no warnings):
 * two shells, a salute, a drone ring, a laser and a panel ticker.
 */
export function sixCueShow(seed = 7): CompiledShow {
  return makeCompiled(
    [
      { id: 'p1', trackId: 'trk-pyro', medium: 'pyro', effectId: 'peony-75-red',
        positionId: 'rack-1', targetSec: 4, anticipationSec: 2.2, durationSec: 1.8 },
      { id: 'l1', trackId: 'trk-laser', medium: 'laser', effectId: 'laser-lissajous-rgb',
        positionId: 'laser-west', targetSec: 5, anticipationSec: 0, durationSec: 12,
        params: { periodBeats: 4 } },
      { id: 'n1', trackId: 'trk-panel', medium: 'panel', effectId: 'panel-text-marquee',
        positionId: 'panel-east', targetSec: 5, anticipationSec: 0, durationSec: 12,
        params: { text: 'HI', speedPxPerBeat: 4 } },
      { id: 'd1', trackId: 'trk-drone', medium: 'drone', effectId: 'ring-formation-60',
        positionId: 'pad-1', targetSec: 18, anticipationSec: 0, durationSec: 10,
        params: { count: 60, scaleM: 50 } },
      { id: 's1', trackId: 'trk-pyro', medium: 'pyro', effectId: 'salute-100',
        positionId: 'rack-8', targetSec: 20, anticipationSec: 2.8, durationSec: 0.3 },
      { id: 'p2', trackId: 'trk-pyro', medium: 'pyro', effectId: 'brocade-200-gold',
        positionId: 'rack-4', targetSec: 26, anticipationSec: 4.2, durationSec: 7 },
    ],
    { seed, fleet: { count: 60, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 } },
  )
}

// ---------------------------------------------------------------------------
// FNV-1a hashing over numeric arrays (float64 bit patterns).
// ---------------------------------------------------------------------------

const dv = new DataView(new ArrayBuffer(8))

export function hashNumbers(
  h: number,
  arr: ArrayLike<number>,
): number {
  for (let i = 0; i < arr.length; i++) {
    dv.setFloat64(0, arr[i]!)
    for (let b = 0; b < 8; b++) {
      h ^= dv.getUint8(b)
      h = Math.imul(h, 0x01000193)
    }
  }
  return h >>> 0
}

/** Order-sensitive FNV-1a hash over an entire snapshot. */
export function hashSnapshot(s: SimSnapshot): number {
  let h = 0x811c9dc5
  h = hashNumbers(h, [s.t, s.step, s.stars.count, s.shells.count, s.drones.count])
  h = hashNumbers(h, s.stars.pos)
  h = hashNumbers(h, s.stars.rgb)
  h = hashNumbers(h, s.stars.brightness)
  h = hashNumbers(h, s.stars.sizeM)
  h = hashNumbers(h, s.shells.pos)
  h = hashNumbers(h, s.shells.cueIdx)
  h = hashNumbers(h, s.drones.pos)
  h = hashNumbers(h, s.drones.vel)
  h = hashNumbers(h, s.drones.rgb)
  h = hashNumbers(h, [s.drones.minSeparationM])
  h = hashNumbers(h, [s.crowd.cellCount])
  h = hashNumbers(h, s.crowd.rgb)
  h = hashNumbers(h, s.crowd.white)
  for (const b of s.beams) {
    h = hashNumbers(h, [
      b.cueIdx, b.apex.x, b.apex.y, b.apex.z, b.target.x, b.target.y,
      b.halfAngleDeg, b.footprint.cx, b.footprint.cy, b.footprint.a,
      b.footprint.b, b.footprint.azimuthDeg, b.audibleDbAtRef,
      b.carrierDbAtRef, b.landed ? 1 : 0,
    ])
  }
  h = hashNumbers(h, s.splByListener)
  for (const f of s.laserFrames) {
    for (const p of f.points) {
      h = hashNumbers(h, [p.x, p.y, p.r, p.g, p.b, p.blank ? 1 : 0])
    }
  }
  for (const f of s.panelFrames) {
    h = hashNumbers(h, [f.w, f.h])
    h = hashNumbers(h, f.rgb)
  }
  return h >>> 0
}
