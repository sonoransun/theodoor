/**
 * export/beamSteering.ts — steering schedules for the directional-audio
 * arrays (CSV + JSON). Timing and geometry ONLY: programRef is the effect id;
 * audio content is never exported.
 *
 * PURE string builders: no I/O and no gating here (the CLI gates emission
 * behind the safety machine). Per beam cue the schedule is
 *
 *   start    at fireSec — the acoustic time-of-flight lead is already baked
 *            into fireSec by the solver; exporting fire times keeps the
 *            schedule honest (the wavefront LANDS at targetSec),
 *   keyframe on the keyframeHz grid strictly inside (fireSec, end), sampled
 *            through sim/beams.ts beamStatesAt (the sim's own windowing) with
 *            pan/tilt from acoustics/beams.ts beamAimAt of the state target;
 *            consecutive keyframes whose pan/tilt are unchanged at 2-dp
 *            resolution are dropped (static programs emit start/stop only),
 *   stop     at end = targetSec + durationSec (aim resolved via beamTargetAt,
 *            which clamps outside the active window).
 *
 * Every sampled instant resolves sourceTag aims through the SAME per-cue
 * acoustics/beams sourceGroundResolver the sim engine uses, so the exported
 * hardware schedule and the reviewed simulation aim tagged beams identically
 * (deterministic — the resolver is a pure function of the compiled show).
 *
 * Events are ordered by (tSec, arrayId, start < keyframe < stop, cueId) — a
 * total order, so emitted bytes are identical across runs.
 */

import type { CompiledShow, Seconds } from '../contracts.js'
import { SPEED_OF_SOUND_MPS } from '../contracts.js'
import type { EffectLookup } from '../acoustics/spl.js'
import {
  beamAimAt,
  beamTargetAt,
  sourceGroundResolver,
  type BeamTargetOpts,
} from '../acoustics/beams.js'
import { beamStatesAt, buildBeamCues } from '../sim/beams.js'
import { csvDocument, guardSpreadsheetInjection, type CsvField } from './csv.js'

/** Format tag of the beam-steering artifact family. */
export const BEAM_STEERING_FORMAT = 'theodoor-beam-steering'

export const BEAM_STEERING_COLUMNS = [
  'tSec',
  'arrayId',
  'eventType',
  'panDeg',
  'tiltDeg',
  'gainDb',
  'audibleDb',
  'programRef',
  'cueId',
  'pairId',
  'role',
] as const

export type BeamEventType = 'start' | 'keyframe' | 'stop'

const EVENT_RANK: Record<BeamEventType, number> = { start: 0, keyframe: 1, stop: 2 }

export interface BeamSteeringEvent {
  tSec: Seconds
  arrayId: string
  eventType: BeamEventType
  /** Pan relative to the array heading, degrees, rounded to 2 dp. */
  panDeg: number
  /** Negative below the horizontal, degrees, rounded to 2 dp. */
  tiltDeg: number
  gainDb: number
  /** In-beam audible level at the reference distance: effect + gainDb. */
  audibleDb: number
  /** The effect id — a program reference, never audio content. */
  programRef: string
  cueId: string
  pairId?: string
  role?: 'L' | 'R'
}

const round2 = (v: number): number => Number(v.toFixed(2))
const round3 = (v: number): number => Number(v.toFixed(3))
const round1 = (v: number): number => Number(v.toFixed(1))

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Derive the deterministic steering event list (the single source both
 * renderers consume, so the CSV and JSON always describe the same schedule).
 */
export function beamSteeringEvents(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  keyframeHz = 20,
): BeamSteeringEvent[] {
  if (!(keyframeHz > 0) || !Number.isFinite(keyframeHz)) {
    throw new RangeError(
      `beamSteering: keyframeHz must be a positive finite number, got ${keyframeHz}`,
    )
  }
  const site = compiled.show.site
  const beats = compiled.show.music.beats
  const cues = buildBeamCues(compiled, getEffect)
  const sourceGroundAt = sourceGroundResolver(compiled, getEffect)
  const events: BeamSteeringEvent[] = []

  for (const c of cues) {
    const times: { t: Seconds; type: BeamEventType }[] = [{ t: c.startSec, type: 'start' }]
    for (let k = Math.floor(c.startSec * keyframeHz) + 1; ; k++) {
      const t = k / keyframeHz
      if (t >= c.endSec - 1e-9) break
      if (t <= c.startSec + 1e-9) continue
      times.push({ t, type: 'keyframe' })
    }
    times.push({ t: c.endSec, type: 'stop' })

    const params = c.cue.params
    const gainDb = typeof params?.gainDb === 'number' ? params.gainDb : 0
    const pairId = typeof params?.pairId === 'string' ? params.pairId : undefined
    const role = params?.role === 'L' || params?.role === 'R' ? params.role : undefined

    let lastPan: number | undefined
    let lastTilt: number | undefined
    for (const { t, type } of times) {
      // Sample the sim's windowed state; the stop instant sits outside the
      // active window [startSec, endSec), so its aim resolves directly
      // through beamTargetAt (clamped to the final aim). Both paths carry the
      // per-cue sourceTag ground so the schedule matches the sim's aim.
      const state =
        type === 'stop'
          ? undefined
          : beamStatesAt(cues, t, site, { beats, sourceGroundAt }).find(
              (s) => s.cueIdx === c.cueIdx,
            )
      const sourceGround =
        c.effect.program === 'sourceTag' ? sourceGroundAt(c.cue, t) : undefined
      const fallbackOpts: BeamTargetOpts = {
        beats,
        ...(sourceGround ? { sourceGround } : {}),
      }
      const target = state?.target ?? beamTargetAt(c.cue, c.effect, site, t, fallbackOpts)
      const aim = beamAimAt(c.asset, target)
      const panDeg = round2(aim.panDeg)
      const tiltDeg = round2(aim.tiltDeg)
      if (type === 'keyframe' && panDeg === lastPan && tiltDeg === lastTilt) continue
      lastPan = panDeg
      lastTilt = tiltDeg
      events.push({
        tSec: t,
        arrayId: c.asset.id,
        eventType: type,
        panDeg,
        tiltDeg,
        gainDb,
        audibleDb: state?.audibleDbAtRef ?? c.effect.noiseDbAt15m + gainDb,
        programRef: c.effect.id,
        cueId: c.cue.id,
        ...(pairId !== undefined ? { pairId } : {}),
        ...(role !== undefined ? { role } : {}),
      })
    }
  }

  events.sort(
    (a, b) =>
      a.tSec - b.tSec ||
      cmpStr(a.arrayId, b.arrayId) ||
      EVENT_RANK[a.eventType] - EVENT_RANK[b.eventType] ||
      cmpStr(a.cueId, b.cueId),
  )
  return events
}

/**
 * CSV: tSec,arrayId,eventType,panDeg,tiltDeg,gainDb,audibleDb,programRef,
 * cueId,pairId,role — tSec fixed(3), angles fixed(2), dB fixed(1); free-text
 * columns pass the spreadsheet-injection guard.
 */
export function beamSteeringCsv(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  keyframeHz = 20,
): string {
  const rows: CsvField[][] = [[...BEAM_STEERING_COLUMNS]]
  for (const e of beamSteeringEvents(compiled, getEffect, keyframeHz)) {
    rows.push([
      e.tSec.toFixed(3),
      guardSpreadsheetInjection(e.arrayId),
      e.eventType,
      e.panDeg.toFixed(2),
      e.tiltDeg.toFixed(2),
      e.gainDb.toFixed(1),
      e.audibleDb.toFixed(1),
      guardSpreadsheetInjection(e.programRef),
      guardSpreadsheetInjection(e.cueId),
      guardSpreadsheetInjection(e.pairId ?? ''),
      guardSpreadsheetInjection(e.role ?? ''),
    ])
  }
  return csvDocument(rows)
}

/**
 * JSON: `{ format, version, speedOfSoundMps, keyframeHz, arrays: [{ arrayId,
 * events }] }` — arrays sorted by id, events in schedule order.
 */
export function beamSteeringJson(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  keyframeHz = 20,
): string {
  const events = beamSteeringEvents(compiled, getEffect, keyframeHz)
  const arrayIds = [...new Set(events.map((e) => e.arrayId))].sort()
  return JSON.stringify(
    {
      format: BEAM_STEERING_FORMAT,
      version: 1,
      speedOfSoundMps: SPEED_OF_SOUND_MPS,
      keyframeHz,
      arrays: arrayIds.map((arrayId) => ({
        arrayId,
        events: events
          .filter((e) => e.arrayId === arrayId)
          .map((e) => ({
            tSec: round3(e.tSec),
            eventType: e.eventType,
            panDeg: e.panDeg,
            tiltDeg: e.tiltDeg,
            gainDb: round1(e.gainDb),
            audibleDb: round1(e.audibleDb),
            programRef: e.programRef,
            cueId: e.cueId,
            ...(e.pairId !== undefined ? { pairId: e.pairId } : {}),
            ...(e.role !== undefined ? { role: e.role } : {}),
          })),
      })),
    },
    null,
    2,
  )
}
