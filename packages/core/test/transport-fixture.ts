/**
 * transport-fixture.ts — minimal inline CompiledShow for transport tests.
 * Effects are opaque catalog references; only timing matters here.
 */
import type {
  CompiledCue,
  CompiledShow,
  MusicalTimeline,
  Show,
  SitePlan,
} from '../src/contracts.js'

export function makeMusic(duration: number): MusicalTimeline {
  return {
    source: 'score',
    id: 'music-test',
    title: 'Transport Test Music',
    duration,
    tempo: {
      segments: [{ beat: 0, bpm: 120 }],
      meters: [{ bar: 1, beatsPerBar: 4 }],
    },
    beats: [],
    downbeats: [],
    annotations: [],
    energy: [],
    tempoConfidence: 1,
  }
}

export function makeSite(): SitePlan {
  return {
    id: 'site-test',
    assets: [],
    audience: [
      { x: -10, y: -50 },
      { x: 10, y: -50 },
    ],
    audienceZone: [
      { x: -10, y: -50 },
      { x: 10, y: -50 },
      { x: 10, y: -80 },
      { x: -10, y: -80 },
    ],
    exclusionZones: [],
    geofence: [
      { x: -100, y: -20 },
      { x: 100, y: -20 },
      { x: 100, y: 200 },
      { x: -100, y: 200 },
    ],
    maxAltitudeM: 120,
    wind: { dirDegFrom: 0, speedMps: 0, limitMps: 10 },
    refListenerPos: [{ x: 0, y: -60 }],
  }
}

/** Build a CompiledCue with explicit fireSec (anticipation defaults to 0). */
export function cue(
  id: string,
  fireSec: number,
  opts: { durationSec?: number; anticipationSec?: number; trackId?: string } = {},
): CompiledCue {
  const anticipationSec = opts.anticipationSec ?? 0
  return {
    id,
    trackId: opts.trackId ?? 'trk-1',
    medium: 'laser',
    effectId: 'fx-test',
    targetSec: fireSec + anticipationSec,
    fireSec,
    anticipationSec,
    durationSec: opts.durationSec ?? 1,
    seed: 42,
  }
}

/**
 * Assemble a CompiledShow around pre-built cues (must already be sorted by
 * fireSec, matching the contract's compiled order).
 */
export function makeCompiled(
  cues: readonly CompiledCue[],
  opts: { preRollSec?: number; musicDuration?: number } = {},
): CompiledShow {
  const show: Show = {
    meta: { id: 'show-test', title: 'Transport Test', variant: 'standard', seed: 7 },
    music: makeMusic(opts.musicDuration ?? 10),
    site: makeSite(),
    catalogId: 'catalog-test',
    tracks: [],
    ...(opts.preRollSec !== undefined ? { preRollSec: opts.preRollSec } : {}),
  }
  return { show, cues, diagnostics: [] }
}

/** Ten cues at known fire times inside [0, 3] — includes a simultaneous pair. */
export function tenCues(): CompiledCue[] {
  return [
    cue('c01', 0.1),
    cue('c02', 0.4),
    cue('c03', 0.75),
    cue('c04', 1.0),
    cue('c05', 1.5),
    cue('c06', 1.5, { trackId: 'trk-2' }), // simultaneous with c05, later in array order
    cue('c07', 2.0),
    cue('c08', 2.2),
    cue('c09', 2.6),
    cue('c10', 2.9),
  ]
}
