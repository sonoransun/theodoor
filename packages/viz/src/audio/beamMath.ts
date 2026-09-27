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
 *
 * The monitor mapping (monitorGain / reportGain) is shared with the report
 * audition (reportMath.ts) so beams and shell reports sit in honest
 * proportion; the Doppler helpers give swept beams the pitch motion of the
 * virtual source they portray.
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

/** Reports compress this many dB of source level into 1 dB of monitor above the anchor. */
export const REPORT_COMPRESS_RATIO = 4
/** Hard cap on a report's linear gain (a salute at the seat peaks about here). */
export const REPORT_MAX_GAIN = 1

/**
 * Monitor gain for shell reports, set pieces, and water — the SAME anchor as
 * the beams (MONITOR_REF_DB ↔ MONITOR_REF_GAIN, so a murmur and a comet sit
 * in honest proportion), but 4:1 compressed above the anchor: fireworks span
 * ~65 dB of source level at the seat (a 30 mm comet's whoosh to a 150 mm
 * salute) and a linear map would pin everything loud to one clamp. Below the
 * anchor it IS monitorGain (identical numbers). -Infinity/NaN map to 0.
 */
export function reportGain(db: number): number {
  if (!Number.isFinite(db)) return 0
  if (db <= MONITOR_REF_DB) return monitorGain(db)
  const compressedDb = MONITOR_REF_DB + (db - MONITOR_REF_DB) / REPORT_COMPRESS_RATIO
  return Math.min(REPORT_MAX_GAIN, MONITOR_REF_GAIN * Math.pow(10, (compressedDb - MONITOR_REF_DB) / 20))
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

// ---------------------------------------------------------------------------
// Doppler-like motion for swept beams
// ---------------------------------------------------------------------------

/** Playback-rate clamp for the Doppler illusion (≈ −2.8 / +2.9 semitones). */
export const DOPPLER_RATE_MIN = 0.85
export const DOPPLER_RATE_MAX = 1.18
/** EMA smoothing factor per rAF frame for the radial-velocity estimate. */
export const DOPPLER_SMOOTHING = 0.25

/**
 * Radial velocity of a beam's aim relative to the seat, m/s, from two
 * successive ground targets dtSec apart: positive = receding, negative =
 * approaching. 0 when dt is not positive.
 */
export function radialVelocityMps(prev: Vec2, next: Vec2, seat: Vec2, dtSec: number): number {
  if (!(dtSec > 0)) return 0
  const d0 = Math.hypot(prev.x - seat.x, prev.y - seat.y)
  const d1 = Math.hypot(next.x - seat.x, next.y - seat.y)
  return (d1 - d0) / dtSec
}

/**
 * Doppler playback rate for a virtual source moving at vRadialMps relative
 * to the listener: c / (c + v) — receding sources drop in pitch, approaching
 * ones rise — clamped to [DOPPLER_RATE_MIN, DOPPLER_RATE_MAX]. A steered
 * array does not physically Doppler-shift (only its aim moves), but a
 * flyover is MEANT to sound like something crossing the lawn, so the
 * audition applies the shift the virtual source would have. 0 → 1.
 */
export function dopplerRate(vRadialMps: number): number {
  if (!Number.isFinite(vRadialMps)) return 1
  const rate = SPEED_OF_SOUND_MPS / (SPEED_OF_SOUND_MPS + vRadialMps)
  return Math.min(DOPPLER_RATE_MAX, Math.max(DOPPLER_RATE_MIN, rate))
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
