/**
 * sim/lasers.ts — laser primitive → per-step LaserPoint frames.
 *
 * Every frame is exactly effect.pointsPerFrame points in normalized [−1, 1]²
 * projector space (the same structure the ILDA exporter consumes). Patterns
 * are pure functions of (effect, cue, tSec, timeline): stateless, so seek and
 * chunked advance are trivially consistent.
 *
 * Phase: when cue.params.periodBeats is set, patterns are BEAT-LOCKED —
 * phase = beatPhase(timeline.beats, t) / periodBeats (cycles); otherwise a
 * fixed default period in show seconds applies. `blank` marks beam-off travel
 * (hops between beam-fan rays, tunnel rings, starfield dots).
 */

import type {
  CompiledCue,
  CompiledShow,
  LaserPoint,
  LaserPrimitive,
  MusicalTimeline,
  Seconds,
} from '../contracts.js'
import type { EffectLookup } from '../acoustics/index.js'
import { clamp, hexToRgb, mulberry32 } from '../math/index.js'

/** Pattern period when no periodBeats param locks it to the beat grid. */
export const DEFAULT_LASER_PERIOD_SEC = 2
/** Default beam-fan ray count (cue params beamCount/count override). */
export const DEFAULT_FAN_RAYS = 5
/** Default fan / sweep angular spread, degrees (params.spreadDeg overrides). */
export const DEFAULT_SPREAD_DEG = 60

/**
 * Fractional index of show time `t` in a sorted beat-instant array: beats[k]
 * maps to k, positions between beats interpolate linearly, and t outside the
 * array clamps to [0, beats.length − 1]. Fewer than 2 beats → 0.
 */
export function beatPhase(beats: readonly Seconds[], t: Seconds): number {
  const n = beats.length
  if (n < 2) return 0
  if (t <= beats[0]!) return 0
  if (t >= beats[n - 1]!) return n - 1
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (beats[mid]! <= t) lo = mid
    else hi = mid
  }
  const a = beats[lo]!
  const b = beats[hi]!
  return b === a ? lo : lo + (t - a) / (b - a)
}

/** Triangle wave of one cycle: 0 → 1 → 0 as u goes 0 → 0.5 → 1 (period 1). */
function tri01(u: number): number {
  const f = u - Math.floor(u)
  return 1 - Math.abs(2 * f - 1)
}

const fract = (x: number): number => x - Math.floor(x)

interface Rgb { r: number; g: number; b: number }

/** Cue color override (params.rgb tuple or hex string) or effect palette. */
function palette(effect: LaserPrimitive, cue: CompiledCue): Rgb[] {
  const p = cue.params?.rgb
  if (Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number')) {
    return [{ r: clamp(p[0]!, 0, 1), g: clamp(p[1]!, 0, 1), b: clamp(p[2]!, 0, 1) }]
  }
  if (typeof p === 'string') {
    const [r, g, b] = hexToRgb(p)
    return [{ r, g, b }]
  }
  const out = effect.colors.map((c) => {
    const [r, g, b] = hexToRgb(c)
    return { r, g, b }
  })
  return out.length > 0 ? out : [{ r: 1, g: 1, b: 1 }]
}

function numParam(cue: CompiledCue, key: string): number | undefined {
  const v = cue.params?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Pattern cycle phase (in cycles) at show time t. */
function phaseAt(effect: LaserPrimitive, cue: CompiledCue, tSec: Seconds, tl: MusicalTimeline): number {
  const periodBeats = numParam(cue, 'periodBeats')
  if (periodBeats !== undefined && periodBeats > 0) {
    return beatPhase(tl.beats, tSec) / periodBeats
  }
  return (tSec - cue.targetSec) / DEFAULT_LASER_PERIOD_SEC
}

const cl = (v: number): number => clamp(v, -1, 1)

/**
 * Render one laser frame (exactly effect.pointsPerFrame points) for a cue at
 * show time tSec. Pure and stateless.
 */
export function renderLaserFrame(
  effect: LaserPrimitive,
  cue: CompiledCue,
  tSec: Seconds,
  timeline: MusicalTimeline,
): LaserPoint[] {
  const n = effect.pointsPerFrame
  const phase = phaseAt(effect, cue, tSec, timeline)
  const colors = palette(effect, cue)
  const pts: LaserPoint[] = []
  const colorAt = (k: number): Rgb => colors[k % colors.length]!

  switch (effect.shape) {
    case 'lissajous': {
      // a = 3, b = 2, phase-advanced on the horizontal term.
      for (let i = 0; i < n; i++) {
        const u = i / n
        const c = colorAt(Math.floor(u * colors.length))
        pts.push({
          x: cl(Math.sin(2 * Math.PI * (3 * u + phase))),
          y: cl(Math.sin(2 * Math.PI * 2 * u)),
          r: c.r, g: c.g, b: c.b, blank: false,
        })
      }
      break
    }

    case 'beamFan': {
      const rays = Math.max(2, Math.min(16, Math.round(
        numParam(cue, 'beamCount') ?? numParam(cue, 'count') ?? DEFAULT_FAN_RAYS,
      )))
      const spread = ((numParam(cue, 'spreadDeg') ?? DEFAULT_SPREAD_DEG) * Math.PI) / 180
      const sway = 0.12 * Math.sin(2 * Math.PI * phase)
      const base = Math.floor(n / rays)
      const extra = n - base * rays
      for (let j = 0; j < rays; j++) {
        const cnt = base + (j < extra ? 1 : 0)
        const th = (j / (rays - 1) - 0.5) * spread + sway
        const tipX = Math.sin(th) * 0.95
        const tipY = -1 + Math.cos(th) * 1.9
        const c = colorAt(j)
        for (let s = 0; s < cnt; s++) {
          const v = cnt === 1 ? 1 : s / (cnt - 1)
          pts.push({
            x: cl(v * tipX),
            y: cl(-1 + v * (tipY + 1)),
            r: c.r, g: c.g, b: c.b,
            blank: s === 0 && j > 0, // hop from the previous ray, beam off
          })
        }
      }
      break
    }

    case 'helix': {
      // Double helix climbing: two half-turn-offset sine strands drawn
      // sequentially, with a blanked hop from the first strand to the second.
      const TURNS = 3
      const nA = Math.ceil(n / 2)
      for (let j = 0; j < 2; j++) {
        const cnt = j === 0 ? nA : n - nA
        const c = colorAt(j)
        for (let s = 0; s < cnt; s++) {
          const u = cnt === 1 ? 1 : s / (cnt - 1)
          pts.push({
            x: cl(Math.sin(2 * Math.PI * (u * TURNS + phase + j * 0.5)) * 0.6),
            y: cl(-1 + 2 * u),
            r: c.r, g: c.g, b: c.b,
            blank: s === 0 && j > 0, // hop between strands, beam off
          })
        }
      }
      break
    }

    case 'sweep': {
      const spread = ((numParam(cue, 'spreadDeg') ?? DEFAULT_SPREAD_DEG) * Math.PI) / 180
      const th = (tri01(phase) - 0.5) * spread
      const tipX = Math.sin(th) * 0.95
      const tipY = -1 + Math.cos(th) * 1.9
      const c = colorAt(0)
      for (let i = 0; i < n; i++) {
        const v = n === 1 ? 1 : i / (n - 1)
        pts.push({
          x: cl(v * tipX),
          y: cl(-1 + v * (tipY + 1)),
          r: c.r, g: c.g, b: c.b, blank: false,
        })
      }
      break
    }

    case 'web': {
      // Concentric rings + radial spokes; the whole web breathes with phase.
      const RINGS = 4
      const SPOKES = 8
      const R = 0.8 * (1 + 0.07 * Math.sin(2 * Math.PI * phase))
      const ringTotal = Math.floor(n * 0.6)
      const spokeTotal = n - ringTotal
      let element = 0
      const drawRing = (radius: number, cnt: number, c: Rgb): void => {
        for (let s = 0; s < cnt; s++) {
          const th = (2 * Math.PI * s) / cnt
          pts.push({
            x: cl(radius * Math.cos(th)),
            y: cl(radius * Math.sin(th)),
            r: c.r, g: c.g, b: c.b,
            blank: s === 0 && element > 0, // hop between elements
          })
        }
        if (cnt > 0) element++
      }
      const ringBase = Math.floor(ringTotal / RINGS)
      const ringExtra = ringTotal - ringBase * RINGS
      for (let j = 0; j < RINGS; j++) {
        drawRing((R * (j + 1)) / RINGS, ringBase + (j < ringExtra ? 1 : 0), colorAt(j))
      }
      const spokeBase = Math.floor(spokeTotal / SPOKES)
      const spokeExtra = spokeTotal - spokeBase * SPOKES
      for (let k = 0; k < SPOKES; k++) {
        const cnt = spokeBase + (k < spokeExtra ? 1 : 0)
        const th = (2 * Math.PI * k) / SPOKES
        const c = colorAt(RINGS + k)
        for (let s = 0; s < cnt; s++) {
          const v = cnt === 1 ? 1 : s / (cnt - 1)
          pts.push({
            x: cl(v * R * Math.cos(th)),
            y: cl(v * R * Math.sin(th)),
            r: c.r, g: c.g, b: c.b,
            blank: s === 0 && element > 0,
          })
        }
        if (cnt > 0) element++
      }
      break
    }

    case 'curtain': {
      // Vertical sheet: x sweeps the width while y traces a sinusoidal hem
      // drifting with phase; color cycles through the palette along the sweep.
      const WAVES = 3
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0.5 : i / (n - 1)
        const c = colorAt(Math.floor(u * colors.length))
        pts.push({
          x: cl(-0.9 + 1.8 * u),
          y: cl(-0.1 + 0.55 * Math.sin(2 * Math.PI * (WAVES * u + phase))),
          r: c.r, g: c.g, b: c.b, blank: false,
        })
      }
      break
    }

    case 'cone': {
      // One circle whose radius breathes with the phase.
      const radius = 0.15 + 0.75 * tri01(phase)
      const c = colorAt(0)
      for (let i = 0; i < n; i++) {
        const th = 2 * Math.PI * (i / n + 0.1 * phase)
        pts.push({
          x: cl(radius * Math.cos(th)),
          y: cl(radius * Math.sin(th)),
          r: c.r, g: c.g, b: c.b, blank: false,
        })
      }
      break
    }

    case 'tunnel': {
      // Nested rings flying outward (radius cycles with phase per ring).
      const rings = 4
      const base = Math.floor(n / rings)
      const extra = n - base * rings
      for (let j = 0; j < rings; j++) {
        const cnt = base + (j < extra ? 1 : 0)
        const radius = 0.1 + 0.85 * fract(0.5 * phase + j / rings)
        const c = colorAt(j)
        for (let s = 0; s < cnt; s++) {
          const th = 2 * Math.PI * (s / Math.max(1, cnt))
          pts.push({
            x: cl(radius * Math.cos(th)),
            y: cl(radius * Math.sin(th)),
            r: c.r, g: c.g, b: c.b,
            blank: s === 0 && j > 0, // hop between rings
          })
        }
      }
      break
    }

    case 'starfield': {
      // Seeded scatter dots, slow drift; travel between dots is blanked.
      const stars = Math.max(1, Math.floor(n / 2))
      const rng = mulberry32(cue.seed)
      const tLocal = tSec - cue.targetSec
      for (let i = 0; i < stars; i++) {
        const x0 = rng() * 2 - 1
        const y0 = rng() * 2 - 1
        const dx = (rng() - 0.5) * 0.06
        const dy = (rng() - 0.5) * 0.06
        // Drift and wrap within (−1, 1).
        const x = ((x0 + dx * tLocal + 1) % 2 + 2) % 2 - 1
        const y = ((y0 + dy * tLocal + 1) % 2 + 2) % 2 - 1
        const c = colorAt(i)
        pts.push({ x: cl(x), y: cl(y), r: c.r, g: c.g, b: c.b, blank: true }) // move
        pts.push({ x: cl(x), y: cl(y), r: c.r, g: c.g, b: c.b, blank: false }) // flash
      }
      while (pts.length < n) {
        const last = pts[pts.length - 1]!
        pts.push({ ...last, blank: true })
      }
      break
    }

    case 'chevron': {
      // Two mirrored sweeps: a ∧ stroke bobbing vertically with the phase.
      const yOff = (tri01(phase) * 2 - 1) * 0.45
      const apexY = yOff + 0.4
      const tipY = yOff - 0.4
      const left = Math.ceil(n / 2)
      const right = n - left
      const c = colorAt(0)
      for (let s = 0; s < left; s++) {
        const v = left === 1 ? 1 : s / (left - 1)
        pts.push({
          x: cl(-0.8 + v * 0.8),
          y: cl(tipY + v * (apexY - tipY)),
          r: c.r, g: c.g, b: c.b, blank: false,
        })
      }
      for (let s = 0; s < right; s++) {
        const v = right === 1 ? 1 : s / (right - 1)
        pts.push({
          x: cl(v * 0.8),
          y: cl(apexY + v * (tipY - apexY)),
          r: c.r, g: c.g, b: c.b, blank: false,
        })
      }
      break
    }
  }

  return pts
}

/** One laser cue prepared for per-step evaluation. */
export interface LaserCueSim {
  cueIdx: number
  cue: CompiledCue
  effect: LaserPrimitive
  assetId: string
  startSec: Seconds
  endSec: Seconds
}

/** Collect laser cues (lasers land instantly: active [targetSec, targetSec + durationSec)). */
export function buildLaserCues(compiled: CompiledShow, getEffect: EffectLookup): LaserCueSim[] {
  const out: LaserCueSim[] = []
  compiled.cues.forEach((cue, cueIdx) => {
    if (cue.medium !== 'laser') return
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'laser') return
    out.push({
      cueIdx,
      cue,
      effect,
      assetId: cue.positionId ?? cue.id,
      startSec: cue.targetSec,
      endSec: cue.targetSec + cue.durationSec,
    })
  })
  return out
}

/**
 * Frames for every laser asset with an active cue at t (last active cue in
 * compiled order wins per asset; output ordered by first activation).
 */
export function laserFramesAt(
  cues: readonly LaserCueSim[],
  tSec: Seconds,
  timeline: MusicalTimeline,
): { assetId: string; points: readonly LaserPoint[] }[] {
  const byAsset = new Map<string, LaserCueSim>()
  for (const c of cues) {
    if (tSec >= c.startSec && tSec < c.endSec) byAsset.set(c.assetId, c)
  }
  const frames: { assetId: string; points: readonly LaserPoint[] }[] = []
  for (const [assetId, c] of byAsset) {
    frames.push({ assetId, points: renderLaserFrame(c.effect, c.cue, tSec, timeline) })
  }
  return frames
}
