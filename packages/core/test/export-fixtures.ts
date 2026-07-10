/**
 * Shared fixtures for export-*.test.ts. Not a test file itself.
 * All catalog entries are opaque performance metadata (see contracts.ts).
 */

import type {
  CompiledCue,
  CompiledShow,
  Cue,
  EffectDef,
  MusicalTimeline,
  PyroEffect,
  SitePlan,
  Track,
} from '../src/contracts.js'
import { fnv1a32 } from '../src/math/index.js'

export const peony75: PyroEffect = {
  id: 'peony-75',
  name: 'Red Peony 75',
  medium: 'pyro',
  tags: ['classic'],
  noiseDbAt15m: 110,
  durationSec: 1.8,
  category: 'peony',
  caliberMm: 75,
  riseTimeSec: 2.2,
  burstHeightM: 90,
  burstRadiusM: 35,
  starCount: 120,
  colors: ['#ff0000'],
  dragK: 0.4,
  gravityBias: 0.2,
  minAudienceDistanceM: 63,
}

/** Name deliberately starts with '=' to exercise the injection guard. */
export const trickyComet: PyroEffect = {
  ...peony75,
  id: 'comet-30',
  name: '=HYPERLINK("x"), gold',
  category: 'comet',
  caliberMm: 30,
  riseTimeSec: 1.1,
}

export const CATALOG = new Map<string, EffectDef>([
  [peony75.id, peony75],
  [trickyComet.id, trickyComet],
])

export const getEffect = (id: string): EffectDef | undefined => CATALOG.get(id)

export function makeSite(): SitePlan {
  return {
    id: 'test-site',
    assets: [
      {
        id: 'rackA',
        kind: 'mortarRack',
        pos: { x: 10, y: 0 },
        headingDeg: 0,
        elevationM: 0,
        rack: { calibersMm: [30, 75], tiltDeg: 0, pinsPerModule: 32, maxSimultaneousPins: 8 },
      },
      {
        id: 'rackB',
        kind: 'mortarRack',
        pos: { x: -10, y: 0 },
        headingDeg: 0,
        elevationM: 0,
        rack: { calibersMm: [75], tiltDeg: 0, pinsPerModule: 32, maxSimultaneousPins: 8 },
      },
      {
        id: 'laser1',
        kind: 'laserTower',
        pos: { x: 0, y: 5 },
        headingDeg: 0,
        elevationM: 3,
        laser: { minElevationDeg: 5, scanFovDeg: 60, terminationM: 400 },
      },
    ],
    audience: [
      { x: -50, y: -80 },
      { x: 50, y: -80 },
    ],
    audienceZone: [
      { x: -50, y: -120 },
      { x: 50, y: -120 },
      { x: 50, y: -80 },
      { x: -50, y: -80 },
    ],
    exclusionZones: [],
    geofence: [
      { x: -100, y: -60 },
      { x: 100, y: -60 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
    ],
    maxAltitudeM: 120,
    wind: { dirDegFrom: 270, speedMps: 2, limitMps: 9 },
    refListenerPos: [{ x: 0, y: -80 }],
  }
}

const MUSIC: MusicalTimeline = {
  source: 'score',
  id: 'music-1',
  title: 'Test Suite Overture',
  duration: 120,
  tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
  beats: [],
  downbeats: [],
  annotations: [],
  energy: [],
  tempoConfidence: 1,
}

export function pyroCue(
  id: string,
  fireSec: number,
  positionId: string | undefined,
  effectId = peony75.id,
  trackId = 'trk-pyro',
): CompiledCue {
  const effect = CATALOG.get(effectId)
  const rise = effect && effect.medium === 'pyro' ? effect.riseTimeSec : 0
  return {
    id,
    trackId,
    medium: 'pyro',
    effectId,
    positionId,
    targetSec: fireSec + rise,
    fireSec,
    anticipationSec: rise,
    durationSec: effect?.durationSec ?? 0,
    seed: fnv1a32(`42:${id}`),
  }
}

export function laserCue(id: string, fireSec: number, trackId = 'trk-laser'): CompiledCue {
  return {
    id,
    trackId,
    medium: 'laser',
    effectId: 'laser-fan',
    positionId: 'laser1',
    targetSec: fireSec,
    fireSec,
    anticipationSec: 0,
    durationSec: 4,
    seed: fnv1a32(`42:${id}`),
  }
}

/** Wrap compiled cues into a CompiledShow, sorted by (fireSec, trackId, id). */
export function makeCompiled(cues: CompiledCue[], tracks?: Track[]): CompiledShow {
  const sorted = [...cues].sort(
    (a, b) =>
      a.fireSec - b.fireSec ||
      (a.trackId < b.trackId ? -1 : a.trackId > b.trackId ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const authored = new Map<string, Cue[]>()
  for (const c of sorted) {
    const cue: Cue = {
      id: c.id,
      effectId: c.effectId,
      anchor: { kind: 'sec', t: c.targetSec },
      positionId: c.positionId,
    }
    const list = authored.get(c.trackId)
    if (list) list.push(cue)
    else authored.set(c.trackId, [cue])
  }
  const defaultTracks: Track[] =
    tracks ??
    [...authored.entries()].map(([id, trackCues]) => ({
      id,
      medium: trackCues.length > 0 && id.includes('laser') ? ('laser' as const) : ('pyro' as const),
      name: id,
      cues: trackCues,
    }))
  return {
    show: {
      meta: { id: 'show-test', title: 'Golden Fixture Show', variant: 'standard', seed: 42 },
      music: MUSIC,
      site: makeSite(),
      catalogId: 'catalog-test',
      tracks: defaultTracks,
    },
    cues: sorted,
    diagnostics: [],
  }
}
