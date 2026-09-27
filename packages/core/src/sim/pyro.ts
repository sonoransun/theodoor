/**
 * sim/pyro.ts — parametric shell ascent + closed-form star motion.
 *
 * Ascent: z(t) = launchZ + H·(1 − (1 − t/T)²) — decelerating, v → ~0 at
 * apogee, matching the catalog's riseTimeSec and burstHeightM exactly by
 * construction — plus a slight seeded lateral drift. During ascent a bright
 * TRACER STAR rides the shell tip (the viz only renders stars/drones, so this
 * is what makes shells visible) and the shells SoA carries pos + cueIdx.
 *
 * Stars are CLOSED FORM: a star is a birth record (position, velocity, drag,
 * lifetime, color) and its state at any age is a pure function of that record
 * — no per-star mutation, so seek/chunked-advance determinism is free:
 *   p(a) = p0 + (v0 − vT)·(1 − e^(−k·a))/k + vT·a,
 *   vT = (0, 0, −g·gravityBias/k)   (terminal velocity)
 * brightness(a) = (1 − smoothstep(0.6, 1, a/life)) · twinkle, where brocade /
 * willow stars flicker via a stateless fnv1a32(starKey, ⌊a·30⌋) hash.
 *
 * Category shapes:
 * - peony/chrysanthemum/willow/brocade/crossette: burst at t = T spawns
 *   starCount stars, uniform-on-sphere directions, speed v0 = burstRadiusM ·
 *   dragK (drag-limited travel v0/k → burstRadiusM).
 * - comet: no burst — the colored head star rides the ascent, then hangs at
 *   the apex (v0 = 0) fading over durationSec.
 * - mine: no burst — a fast short column of sparks: 8 seeded sub-stars born
 *   at FIRE time at the launch position, cone-up directions, speed
 *   burstHeightM · dragK (drag-limited travel → burstHeightM).
 * - salute (starCount 0): a single large white flash star at the burst point.
 */

import type {
  CompiledCue,
  CompiledShow,
  PyroEffect,
  Seconds,
  Vec3,
} from '../contracts.js'
import { GRAVITY_MPS2 } from '../contracts.js'
import type { EffectLookup } from '../acoustics/index.js'
import { fnv1a32, hexToRgb, mulberry32, smoothstep } from '../math/index.js'
import type { SimBuffers } from './snapshot.js'

export { GRAVITY_MPS2 } from '../contracts.js'
/** Lateral drift at apogee, as a fraction of burst height (per axis, ±). */
export const DRIFT_FRACTION = 0.03
/** Per-star lifetime jitter range around effect.durationSec. */
export const LIFE_JITTER_MIN = 0.85
export const LIFE_JITTER_MAX = 1.15
/** Mines render this many seeded column sub-stars. */
export const MINE_SUBSTARS = 8
/** Mine spark cone half-angle from vertical, radians. */
const MINE_CONE_RAD = (25 * Math.PI) / 180
/** Tracer star look (white-gold, ~0.8 m). */
const TRACER_RGB: readonly [number, number, number] = [1, 0.93, 0.72]
export const TRACER_SIZE_M = 0.8
/** Salute flash star size. */
const FLASH_SIZE_M = 2.5
/** Twinkle flicker rate (hash ticks per second). */
const TWINKLE_HZ = 30

/** Immutable star birth record; star state at any age derives purely from it. */
export interface StarBirth {
  /** World birth position. */
  p0: Vec3
  /** Initial velocity vector, m/s. */
  v0: Vec3
  /** Linear-drag constant (1/s). */
  k: number
  /** Terminal z velocity, m/s (≤ 0). */
  vTz: number
  /** Show time the star is born (burst for shells, fire for mine sparks). */
  birthSec: Seconds
  /** Lifetime, seconds (jittered per star). */
  lifeSec: Seconds
  r: number
  g: number
  b: number
  sizeM: number
  /** Stateless flicker (brocade/willow). */
  twinkle: boolean
  /** Stable per-star key for the flicker hash. */
  twinkleKey: number
}

/** Closed-form star position at age `a` (pure — same inputs, same output). */
export function starPosAt(s: StarBirth, a: Seconds): Vec3 {
  const decay = (1 - Math.exp(-s.k * a)) / s.k
  return {
    x: s.p0.x + s.v0.x * decay,
    y: s.p0.y + s.v0.y * decay,
    z: s.p0.z + (s.v0.z - s.vTz) * decay + s.vTz * a,
  }
}

/** Closed-form star velocity at age `a`, m/s: v = (v₀ − v_T)·e^(−k·a) + v_T. */
export function starVelAt(s: StarBirth, a: Seconds): Vec3 {
  const e = Math.exp(-s.k * a)
  return { x: s.v0.x * e, y: s.v0.y * e, z: (s.v0.z - s.vTz) * e + s.vTz }
}

/** Closed-form star brightness at age `a` (0 outside [0, life)). */
export function starBrightnessAt(s: StarBirth, a: Seconds): number {
  if (a < 0 || a >= s.lifeSec) return 0
  let b = 1 - smoothstep(0.6, 1, a / s.lifeSec)
  if (s.twinkle) {
    const tick = Math.floor(a * TWINKLE_HZ)
    const u = fnv1a32(`${s.twinkleKey}:${tick}`) / 4294967296
    b *= 0.55 + 0.45 * u
  }
  return b
}

/** One compiled pyro cue prepared for pure per-step evaluation. */
export interface PyroCueSim {
  /** Index into CompiledShow.cues (shells SoA cueIdx). */
  cueIdx: number
  cue: CompiledCue
  effect: PyroEffect
  /** Mortar position (asset pos + elevation), world frame. */
  launch: Vec3
  /** Seeded lateral drift reached at apogee (world dx/dy). */
  driftX: number
  driftY: number
  /** Ascent duration (riseTimeSec). */
  T: Seconds
  fireSec: Seconds
  burstSec: Seconds
  /** Burst center = ascent apex. */
  apex: Vec3
  stars: readonly StarBirth[]
  /** Nothing of this cue is visible outside [fireSec, doneSec). */
  doneSec: Seconds
}

/** Shell tip position during ascent (pure), t clamped to [0, T]. */
export function shellPosAt(p: PyroCueSim, tSinceFire: Seconds): Vec3 {
  const u = Math.min(1, Math.max(0, tSinceFire / p.T))
  const rise = 1 - (1 - u) * (1 - u)
  return {
    x: p.launch.x + p.driftX * u,
    y: p.launch.y + p.driftY * u,
    z: p.launch.z + p.effect.burstHeightM * rise,
  }
}

/** Shell tip velocity during ascent (pure): d/dt of shellPosAt, m/s. */
export function shellVelAt(p: PyroCueSim, tSinceFire: Seconds): Vec3 {
  const u = Math.min(1, Math.max(0, tSinceFire / p.T))
  const du = p.T > 0 ? 1 / p.T : 0
  return {
    x: p.driftX * du,
    y: p.driftY * du,
    z: p.effect.burstHeightM * 2 * (1 - u) * du,
  }
}

function starSizeM(effect: PyroEffect): number {
  return 0.25 + effect.caliberMm * 0.002
}

/**
 * Precompute every pyro cue's birth records. RNG draw order per cue (from
 * mulberry32(cue.seed)): driftX, driftY, then per star (u, v, colorPick,
 * lifeJitter) — fixed, so identical seeds give identical shows.
 */
export function buildPyroCues(compiled: CompiledShow, getEffect: EffectLookup): PyroCueSim[] {
  const out: PyroCueSim[] = []
  const assets = compiled.show.site.assets
  compiled.cues.forEach((cue, cueIdx) => {
    if (cue.medium !== 'pyro') return
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'pyro') return

    let launch: Vec3 = { x: 0, y: 0, z: 0 }
    if (cue.positionId !== undefined) {
      const asset = assets.find((a) => a.id === cue.positionId)
      if (asset) launch = { x: asset.pos.x, y: asset.pos.y, z: asset.elevationM }
    }

    const rng = mulberry32(cue.seed)
    const driftX = (rng() * 2 - 1) * DRIFT_FRACTION * effect.burstHeightM
    const driftY = (rng() * 2 - 1) * DRIFT_FRACTION * effect.burstHeightM
    const T = effect.riseTimeSec
    const fireSec = cue.fireSec
    const burstSec = fireSec + T
    const apex: Vec3 = {
      x: launch.x + driftX,
      y: launch.y + driftY,
      z: launch.z + effect.burstHeightM,
    }

    const twinkle = effect.category === 'brocade' || effect.category === 'willow'
    const isMine = effect.category === 'mine'
    const isComet = effect.category === 'comet'
    const colorRgb = effect.colors.map((c) => hexToRgb(c))
    const size = starSizeM(effect)
    const kSafe = Math.max(0.01, effect.dragK)
    const vTz = -(GRAVITY_MPS2 * effect.gravityBias) / kSafe

    const stars: StarBirth[] = []
    const n = isMine ? MINE_SUBSTARS : effect.starCount
    const speed = isComet
      ? 0 // comet head hangs at the apex — no burst
      : isMine
        ? effect.burstHeightM * kSafe // drag-limited travel → column height
        : effect.burstRadiusM * kSafe // drag-limited travel → burst radius

    for (let i = 0; i < n; i++) {
      const u = rng()
      const v = rng()
      const colorU = rng()
      const lifeU = rng()
      let dir: Vec3
      if (isMine) {
        // Cone around +z: tilt = u·cone, phi = 2πv.
        const tilt = u * MINE_CONE_RAD
        const phi = 2 * Math.PI * v
        const st = Math.sin(tilt)
        dir = { x: st * Math.cos(phi), y: st * Math.sin(phi), z: Math.cos(tilt) }
      } else {
        // Uniform on sphere: z = 2u − 1, phi = 2πv.
        const z = 2 * u - 1
        const phi = 2 * Math.PI * v
        const s = Math.sqrt(Math.max(0, 1 - z * z))
        dir = { x: s * Math.cos(phi), y: s * Math.sin(phi), z }
      }
      const [r, g, b] = colorRgb.length > 0
        ? colorRgb[Math.min(colorRgb.length - 1, Math.floor(colorU * colorRgb.length))]!
        : [1, 1, 1]
      const life =
        effect.durationSec * (LIFE_JITTER_MIN + (LIFE_JITTER_MAX - LIFE_JITTER_MIN) * lifeU)
      stars.push({
        p0: isMine ? launch : apex,
        v0: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
        k: kSafe,
        vTz,
        birthSec: isMine ? fireSec : burstSec,
        lifeSec: life,
        r, g, b,
        sizeM: size,
        twinkle,
        twinkleKey: (cue.seed + i * 2654435761) >>> 0,
      })
    }

    if (n === 0) {
      // Salute-style flash: starCount 0 still shows a brief bright point.
      stars.push({
        p0: apex,
        v0: { x: 0, y: 0, z: 0 },
        k: kSafe,
        vTz: 0,
        birthSec: burstSec,
        lifeSec: effect.durationSec,
        r: 1, g: 1, b: 1,
        sizeM: FLASH_SIZE_M,
        twinkle: false,
        twinkleKey: cue.seed >>> 0,
      })
    }

    let doneSec = burstSec
    for (const s of stars) doneSec = Math.max(doneSec, s.birthSec + s.lifeSec)
    out.push({
      cueIdx, cue, effect, launch, driftX, driftY, T, fireSec, burstSec, apex, stars, doneSec,
    })
  })
  return out
}

/**
 * Evaluate every pyro cue at show time t into the SoA buffers: ascending
 * shells push a shell entry + a bright tracer star; live stars evaluate the
 * closed form. Stars below ground (z < 0) are extinguished. Pure w.r.t. t.
 */
export function evalPyro(cues: readonly PyroCueSim[], t: Seconds, out: SimBuffers): void {
  for (const p of cues) {
    if (t < p.fireSec || t >= p.doneSec) continue

    // Ascent: shell + tracer star at the tip.
    if (t < p.burstSec) {
      const pos = shellPosAt(p, t - p.fireSec)
      out.pushShell(pos.x, pos.y, pos.z, p.cueIdx)
      const isHead = p.effect.category === 'comet' || p.effect.category === 'mine'
      const [r, g, b] = isHead && p.effect.colors.length > 0
        ? hexToRgb(p.effect.colors[0]!)
        : TRACER_RGB
      const vel = shellVelAt(p, t - p.fireSec)
      out.pushStar(pos.x, pos.y, pos.z, r, g, b, 1, TRACER_SIZE_M, vel.x, vel.y, vel.z)
    }

    // Stars (burst / comet hang / mine column) — closed form per star.
    for (const s of p.stars) {
      const a = t - s.birthSec
      if (a < 0 || a >= s.lifeSec) continue
      const brightness = starBrightnessAt(s, a)
      if (brightness <= 0) continue
      const pos = starPosAt(s, a)
      if (pos.z < 0) continue // hit the ground — extinguished
      const vel = starVelAt(s, a)
      out.pushStar(pos.x, pos.y, pos.z, s.r, s.g, s.b, brightness, s.sizeM, vel.x, vel.y, vel.z)
    }
  }
}
