/**
 * audio/reportMath.ts — pure listening math for the REPORT audition: what a
 * listener seated at a crowd cell hears of the shells, set pieces, and
 * fountains themselves (as opposed to the steered beams in beamMath.ts).
 *
 * THE PHYSICS THE SHOW NARRATES: a shell's light reaches the seat at once,
 * its report only after slant / 343 s. From the lakeside lawn (190–260 m
 * from the racks, bursts 90–220 m up) that lag is ≈ 0.6–0.9 s — the "old
 * physics" the cosmos program lets you hear before a beam tag repairs it.
 * Every ReportEvent therefore carries BOTH the emit instant (the burst, in
 * show time) and the arrival instant at the seat; the scheduler plays it at
 * the arrival.
 *
 * Level: the catalog's noiseDbAt15m propagates −6 dB per distance doubling
 * over the source-to-ear slant (core splAtDistance) and maps to a monitor
 * gain through beamMath.reportGain — the SAME reference anchor the beams use
 * (66 dB ↔ 0.25), compressed 4:1 above it so a salute peaks near full scale
 * instead of pinning a clamp. Air absorption is a lowpass whose cutoff falls
 * with distance: fc = REPORT_LOWPASS_REF_HZ · exp(−d / REPORT_ABSORPTION_SCALE_M)
 * (16 kHz at the source, ≈ 9.9 kHz at 190 m, ≈ 5.9 kHz at 400 m — a gentle
 * high-frequency roll-off that reads as distance, not as a muffle). Pan is
 * the same sin(azimuth) rule as the beams (the seat faces the stage, +y).
 *
 * No Web Audio here — ReportAudio wires these values to nodes; tests drive
 * them in Node.
 */
import {
  EAR_HEIGHT_M,
  SPEED_OF_SOUND_MPS,
  SPL_REF_DISTANCE_M,
  fountainBankSpecOf,
  fountainCrestM,
  jetEnvelopes,
  splAtDistance,
} from '@theodoor/core'
import type {
  CompiledCue,
  CompiledShow,
  EffectDef,
  PyroEffect,
  Vec2,
  Vec3,
} from '@theodoor/core'
import { reportGain, seatPan } from './beamMath.js'

/** Lowpass cutoff at the source (no air between source and ear), Hz. */
export const REPORT_LOWPASS_REF_HZ = 16_000
/** Distance over which the cutoff falls by 1/e, meters. */
export const REPORT_ABSORPTION_SCALE_M = 400
/** Cutoff floor so very distant sources still read as sound, Hz. */
export const REPORT_LOWPASS_MIN_HZ = 400
/** Caliber that reads as a "full size" boom (size 1); smaller shells scale down. */
export const REPORT_FULL_CALIBER_MM = 200
/** Smallest boom size (a 30 mm comet's report, if it had one). */
export const REPORT_MIN_SIZE = 0.15
/** Comet whooshes ride the ascent; their level is trimmed this many dB (soft). */
export const COMET_TRIM_DB = -6

/** Air absorption as a lowpass cutoff falling with distance (see header). */
export function airAbsorptionFcHz(distM: number): number {
  const d = Math.max(0, distM)
  return Math.max(REPORT_LOWPASS_MIN_HZ, REPORT_LOWPASS_REF_HZ * Math.exp(-d / REPORT_ABSORPTION_SCALE_M))
}

/** Source-to-ear slant distance, meters (ear at EAR_HEIGHT_M above the ground). */
export function sourceSlantM(src: Vec3, seat: Vec2): number {
  return Math.hypot(src.x - seat.x, src.y - seat.y, src.z - EAR_HEIGHT_M)
}

/** Acoustic time-of-flight from a source point to the seat, seconds. */
export function sourceTofSec(src: Vec3, seat: Vec2): number {
  return sourceSlantM(src, seat) / SPEED_OF_SOUND_MPS
}

/** Level at the seat of a source rated noiseDbAt15m, dB (−6 dB per doubling). */
export function sourceLevelDb(noiseDbAt15m: number, src: Vec3, seat: Vec2): number {
  return splAtDistance(noiseDbAt15m, SPL_REF_DISTANCE_M, sourceSlantM(src, seat))
}

/** Boom size 0..1 from shell caliber (200 mm = 1; floor REPORT_MIN_SIZE). */
export function boomSize(caliberMm: number): number {
  return Math.min(1, Math.max(REPORT_MIN_SIZE, caliberMm / REPORT_FULL_CALIBER_MM))
}

/** The synthesized timbre a report event plays. */
export type ReportKind =
  | 'salute' // sharp crack + low thump
  | 'boom' // deep boom with a caliber-scaled rumble (peony/chrysanthemum/willow/brocade)
  | 'crackle' // boom + a few seeded crackle ticks (crossette)
  | 'mine' // ground whoosh/hiss from the fire instant
  | 'comet' // soft whoosh riding the ascent
  | 'hiss' // sustained set-piece hiss (fabrication)
  | 'water' // fountain rush from first water to dry

/** One schedulable report: emitted at the source, heard at the seat later. */
export interface ReportEvent {
  cueId: string
  kind: ReportKind
  /** Show time the sound leaves the source (burst / fire / first water). */
  emitSec: number
  /** Show time it reaches the seat: emitSec + slant / c — THE lag you hear. */
  arrivalSec: number
  /** Sounding duration at the source, show seconds (impulses: 0 → timbre length). */
  durSec: number
  /** Monitor gain at the seat (beamMath.reportGain of the propagated level). */
  gain: number
  /** Stereo pan, −1 west … +1 east, from the seat. */
  pan: number
  /** Air-absorption lowpass cutoff at this distance, Hz. */
  lowpassHz: number
  /** Timbre size 0..1 (boom depth/length; water column height fraction). */
  size: number
  /** Deterministic per-cue seed for crackle timing etc. */
  seed: number
}

/** Pyro category → report timbre. */
export function pyroReportKind(category: PyroEffect['category']): ReportKind {
  switch (category) {
    case 'salute':
      return 'salute'
    case 'crossette':
      return 'crackle'
    case 'mine':
      return 'mine'
    case 'comet':
      return 'comet'
    case 'peony':
    case 'chrysanthemum':
    case 'willow':
    case 'brocade':
      return 'boom'
  }
}

/** Ground position of a cue's asset (site origin when the id dangles). */
function assetPos(compiled: CompiledShow, cue: CompiledCue): { x: number; y: number; z: number } {
  const asset = compiled.show.site.assets.find((a) => a.id === cue.positionId)
  return asset ? { x: asset.pos.x, y: asset.pos.y, z: asset.elevationM } : { x: 0, y: 0, z: 0 }
}

/**
 * Where and when one cue's sound is emitted — the report's SOURCE:
 * - salute / boom / crackle: the burst apex (rack pos, z += burstHeightM) at
 *   cue.targetSec (the break — the solver fired the shell riseTimeSec early);
 * - mine: the rack at cue.fireSec (the column is born at fire time);
 * - comet: mid-ascent (z = burstHeightM / 2) from cue.fireSec for riseTimeSec;
 * - fabrication: the mounting asset at cue.targetSec for durationSec;
 * - fountain: the bank (z += crest / 2) from first water (fireSec + valve
 *   latency) until the last column is dry (targetSec + durationSec + stagger).
 * Returns undefined for media without a report (drones, lasers, panels,
 * crowd, beams — beams are the BeamAudio chain — and searchlights).
 */
export function reportSource(
  compiled: CompiledShow,
  cue: CompiledCue,
  effect: EffectDef,
): { src: Vec3; emitSec: number; durSec: number; kind: ReportKind; size: number; levelDb: number } | undefined {
  const base = assetPos(compiled, cue)
  switch (effect.medium) {
    case 'pyro': {
      const kind = pyroReportKind(effect.category)
      const size = boomSize(effect.caliberMm)
      if (kind === 'mine') {
        return { src: base, emitSec: cue.fireSec, durSec: 0, kind, size, levelDb: effect.noiseDbAt15m }
      }
      if (kind === 'comet') {
        return {
          src: { ...base, z: base.z + effect.burstHeightM / 2 },
          emitSec: cue.fireSec,
          durSec: Math.max(0.4, effect.riseTimeSec),
          kind,
          size,
          levelDb: effect.noiseDbAt15m + COMET_TRIM_DB,
        }
      }
      return {
        src: { ...base, z: base.z + effect.burstHeightM },
        emitSec: cue.targetSec,
        durSec: 0,
        kind,
        size,
        levelDb: effect.noiseDbAt15m,
      }
    }
    case 'fabrication':
      return {
        src: { ...base, z: base.z + effect.heightM / 2 },
        emitSec: cue.targetSec,
        durSec: cue.durationSec,
        kind: 'hiss',
        size: Math.min(1, effect.widthM / 30),
        levelDb: effect.noiseDbAt15m,
      }
    case 'fountain': {
      const asset = compiled.show.site.assets.find((a) => a.id === cue.positionId)
      const spec = fountainBankSpecOf(asset)
      const crest = fountainCrestM(effect, cue.params)
      let maxDelay = 0
      if (asset) {
        for (const j of jetEnvelopes(cue, effect, asset, { beats: compiled.show.music.beats })) {
          if (j.delaySec > maxDelay) maxDelay = j.delaySec
        }
      }
      const emitSec = cue.fireSec + spec.valveLatencySec
      const endSec = cue.targetSec + cue.durationSec + maxDelay
      return {
        src: { ...base, z: base.z + crest / 2 },
        emitSec,
        durSec: Math.max(0.1, endSec - emitSec),
        kind: 'water',
        size: Math.min(1, crest / Math.max(1, spec.maxHeightM)),
        levelDb: effect.noiseDbAt15m,
      }
    }
    case 'drone':
    case 'laser':
    case 'panel':
    case 'crowd':
    case 'beam':
    case 'searchlight':
      return undefined
  }
}

/**
 * Every report of a compiled show as heard from `seat`, sorted by ARRIVAL
 * time (stable on ties by cue id). Pure and deterministic: identical inputs
 * → identical tables; moving the seat re-derives delays, levels, and pans.
 */
export function precomputeReports(
  compiled: CompiledShow,
  getEffect: (id: string) => EffectDef | undefined,
  seat: Vec2,
): ReportEvent[] {
  const out: ReportEvent[] = []
  for (const cue of compiled.cues) {
    const effect = getEffect(cue.effectId)
    if (!effect) continue
    const s = reportSource(compiled, cue, effect)
    if (!s) continue
    const dist = sourceSlantM(s.src, seat)
    out.push({
      cueId: cue.id,
      kind: s.kind,
      emitSec: s.emitSec,
      arrivalSec: s.emitSec + dist / SPEED_OF_SOUND_MPS,
      durSec: s.durSec,
      gain: reportGain(sourceLevelDb(s.levelDb, s.src, seat)),
      pan: seatPan(s.src, seat),
      lowpassHz: airAbsorptionFcHz(dist),
      size: s.size,
      seed: cue.seed,
    })
  }
  out.sort((a, b) => a.arrivalSec - b.arrivalSec || (a.cueId < b.cueId ? -1 : a.cueId > b.cueId ? 1 : 0))
  return out
}

/**
 * All events with arrivalSec in the half-open window (fromSec, toSec].
 * `sorted` must be sorted by arrivalSec ascending. Pure; O(log n + k).
 */
export function reportsInWindow<T extends { arrivalSec: number }>(
  sorted: readonly T[],
  fromSec: number,
  toSec: number,
): T[] {
  if (!(toSec > fromSec)) return []
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid]!.arrivalSec <= fromSec) lo = mid + 1
    else hi = mid
  }
  const out: T[] = []
  for (let i = lo; i < sorted.length && sorted[i]!.arrivalSec <= toSec; i++) out.push(sorted[i]!)
  return out
}

/** True when a compiled show has any cue that makes a report (drives the seat control). */
export function hasReportableCues(
  compiled: CompiledShow,
  getEffect: (id: string) => EffectDef | undefined,
): boolean {
  for (const cue of compiled.cues) {
    const effect = getEffect(cue.effectId)
    if (effect && reportSource(compiled, cue, effect) !== undefined) return true
  }
  return false
}
