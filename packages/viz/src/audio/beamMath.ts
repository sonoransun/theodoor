/**
 * audio/beamMath.ts — pure listening math for the "sit here" beam audition
 * and the HUD carrier-exposure meter. No Web Audio here — BeamAudio and the
 * HUD consume these; tests drive them directly in Node.
 *
 * Level model (client-side mirror of core acoustics/beams.beamAudibleLevelAt,
 * driven from BeamState instead of cues): the in-beam reference level at
 * SPL_REF_DISTANCE_M propagates at −6 dB per distance doubling over the
 * head-to-ear slant, minus BEAM_LEAKAGE_DB when the seat is outside the
 * footprint ellipse (core's inFootprint decides membership).
 */
import {
  BEAM_LEAKAGE_DB,
  EAR_HEIGHT_M,
  SPEED_OF_SOUND_MPS,
  SPL_REF_DISTANCE_M,
  forkSeed,
  inFootprint,
  mulberry32,
  splAtDistance,
  sumSpl,
} from '@theodoor/core'
import type { BeamState, Vec2, Vec3 } from '@theodoor/core'

/** Monitor mapping anchor: this audible dB at the seat plays at REF_GAIN. */
export const MONITOR_REF_DB = 66
export const MONITOR_REF_GAIN = 0.25
/** Hard cap on any single chain's linear gain (comfortable headphones). */
export const MONITOR_MAX_GAIN = 0.5
/** DelayNode maxDelay — also the cap on the modeled arrival delay. */
export const MAX_BEAM_DELAY_SEC = 2

/** The BeamState fields the seat-audition math reads. */
export type SeatBeam = Pick<
  BeamState,
  'apex' | 'footprint' | 'audibleDbAtRef' | 'extraDelayMs'
>

/** Head-to-ear slant distance from the array apex to a seated listener, m. */
export function seatSlantM(apex: Vec3, seat: Vec2): number {
  const ground = Math.hypot(seat.x - apex.x, seat.y - apex.y)
  return Math.hypot(ground, apex.z - EAR_HEIGHT_M)
}

/** Audible level of one beam at the seat, dB (see the level model above). */
export function seatLevelDb(beam: SeatBeam, seat: Vec2): number {
  const level = splAtDistance(beam.audibleDbAtRef, SPL_REF_DISTANCE_M, seatSlantM(beam.apex, seat))
  return inFootprint(beam.footprint, seat) ? level : level - BEAM_LEAKAGE_DB
}

/**
 * Map an audible dB level to a comfortable monitor gain: MONITOR_REF_DB maps
 * to MONITOR_REF_GAIN, ±20 dB is ±10× amplitude, clamped to MONITOR_MAX_GAIN.
 * -Infinity/NaN map to 0.
 */
export function monitorGain(db: number): number {
  if (!Number.isFinite(db)) return 0
  const g = MONITOR_REF_GAIN * Math.pow(10, (db - MONITOR_REF_DB) / 20)
  return Math.min(MONITOR_MAX_GAIN, g)
}

/**
 * Arrival delay at the seat: acoustic slant time-of-flight plus the cue's
 * stereo-pair extraDelayMs, capped at MAX_BEAM_DELAY_SEC (the DelayNode max).
 */
export function seatDelaySec(beam: SeatBeam, seat: Vec2): number {
  const d = seatSlantM(beam.apex, seat) / SPEED_OF_SOUND_MPS + (beam.extraDelayMs ?? 0) / 1000
  return Math.min(MAX_BEAM_DELAY_SEC, Math.max(0, d))
}

/**
 * Stereo pan of the array as heard from the seat. The seat faces the stage
 * (world +y, north), so pan = sin(azimuth of the apex seen from the seat):
 * arrays east of the seat pan right (+), west pan left (−).
 */
export function seatPan(apex: Vec3, seat: Vec2): number {
  return Math.sin(Math.atan2(apex.x - seat.x, apex.y - seat.y))
}

/** Murmur band-pass center frequency floor, Hz. */
export const MURMUR_FC_MIN_HZ = 300
/** Murmur fc octave span above the floor (fc = 300 · 2^(3u)). */
export const MURMUR_FC_OCTAVES = 3

/**
 * Seeded band-pass center for a beam cue's murmur stand-in:
 * fc = 300 · 2^(3u) Hz with u = mulberry32(forkSeed(cueSeed, 'aud'))() —
 * deterministic per cue, spread over 300–2400 Hz (speech-band).
 */
export function murmurFcHz(cueSeed: number): number {
  const u = mulberry32(forkSeed(cueSeed, 'aud'))()
  return MURMUR_FC_MIN_HZ * Math.pow(2, MURMUR_FC_OCTAVES * u)
}

/** The BeamState fields the exposure-meter math reads. */
export type CarrierBeam = Pick<BeamState, 'apex' | 'footprint' | 'carrierDbAtRef'>

/**
 * Worst-cell summed carrier level this frame, dB: at every cell centroid each
 * beam's carrierDbAtRef propagates −6 dB/doubling over the slant, minus
 * BEAM_LEAKAGE_DB outside its footprint; levels power-sum per cell and the
 * loudest cell wins. -Infinity when either list is empty.
 */
export function worstCellCarrierDb(
  beams: readonly CarrierBeam[],
  cells: readonly Vec2[],
): number {
  if (beams.length === 0 || cells.length === 0) return -Infinity
  let worst = -Infinity
  const levels = new Array<number>(beams.length)
  for (const cell of cells) {
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i]!
      const level = splAtDistance(b.carrierDbAtRef, SPL_REF_DISTANCE_M, seatSlantM(b.apex, cell))
      levels[i] = inFootprint(b.footprint, cell) ? level : level - BEAM_LEAKAGE_DB
    }
    const db = sumSpl(levels)
    if (db > worst) worst = db
  }
  return worst
}
