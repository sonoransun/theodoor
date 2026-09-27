/**
 * Wind-drifted smoke — pure puff model (no GL; unit-tested in Node).
 *
 * Every pyro cue leaves a cloud where it burst: a few seeded puffs born at
 * the cue's targetSec around (rack x, burst height), carried DOWNWIND by the
 * site wind (only the world-x component matters in the x–z front view; y is
 * the camera's ignored depth), swelling from ~half the burst radius to ~1.4×
 * it and fading over SMOKE_LIFE_SEC (longer for larger calibers). Alpha is
 * deliberately tiny — smoke is lit haze that softens the sky, never a blob.
 *
 * Pure function of (compiled, getEffect, wind, t): identical inputs give
 * identical puffs, so seeking is exact and nothing accumulates.
 */
import { forkSeed, mulberry32 } from '@theodoor/core'
import type { CompiledShow, EffectDef, PyroEffect, Wind } from '@theodoor/core'

/** Fraction of the wind speed the cloud drifts at (aloft it nearly keeps pace). */
export const SMOKE_DRIFT_FACTOR = 0.85
/** Base cloud lifetime, seconds; grows with caliber (see smokeLifeSec). */
export const SMOKE_LIFE_BASE_SEC = 8
/** Extra seconds of life per 100 mm of caliber. */
export const SMOKE_LIFE_PER_100MM_SEC = 2
/** Peak puff alpha (additive, premultiplied) — haze, not a blob. */
export const SMOKE_PEAK_ALPHA = 0.055
/** Alpha rises to its peak over this long after the burst. */
export const SMOKE_RISE_SEC = 0.6
/** Radius at birth / at death as fractions of the burst radius. */
export const SMOKE_R0_FRACTION = 0.5
export const SMOKE_R1_FRACTION = 1.4
/** Puffs per burst: small shells one, big shells three. */
export const SMOKE_PUFFS_LARGE = 3
export const SMOKE_LARGE_CALIBER_MM = 150
/** Warm grey the puffs are tinted (premultiplied by alpha at draw time). */
export const SMOKE_RGB: readonly [number, number, number] = [0.82, 0.78, 0.74]

export interface SmokePuff {
  /** World x (east) and z (up) of the puff center. */
  x: number
  z: number
  radiusM: number
  /** 0..1 additive alpha (already enveloped; multiply by SMOKE_RGB at draw). */
  alpha: number
  /** Stable seed for any per-puff shading jitter. */
  seed: number
}

/** Cloud life for a caliber: base + per-100 mm allowance. */
export function smokeLifeSec(caliberMm: number): number {
  return SMOKE_LIFE_BASE_SEC + (SMOKE_LIFE_PER_100MM_SEC * Math.max(0, caliberMm)) / 100
}

/** Downwind drift along world x after `ageSec`: wind blows TOWARD dirDegFrom + 180. */
export function smokeDriftXM(wind: Wind, ageSec: number): number {
  const dirRad = (wind.dirDegFrom * Math.PI) / 180
  return -Math.sin(dirRad) * wind.speedMps * SMOKE_DRIFT_FACTOR * Math.max(0, ageSec)
}

/** Alpha envelope over the cloud life: quick rise, then (1 − a/life)^1.5 decay. */
export function smokeAlphaAt(ageSec: number, lifeSec: number): number {
  if (!(ageSec >= 0) || ageSec >= lifeSec) return 0
  const rise = Math.min(1, ageSec / SMOKE_RISE_SEC)
  const decay = Math.pow(1 - ageSec / lifeSec, 1.5)
  return SMOKE_PEAK_ALPHA * rise * decay
}

/** Cloud radius over its life: sqrt growth from R0 to R1 fractions of the burst radius. */
export function smokeRadiusAt(burstRadiusM: number, ageSec: number, lifeSec: number): number {
  const u = Math.min(1, Math.max(0, ageSec / Math.max(1e-9, lifeSec)))
  const f = SMOKE_R0_FRACTION + (SMOKE_R1_FRACTION - SMOKE_R0_FRACTION) * Math.sqrt(u)
  return burstRadiusM * f
}

/** Per-cue constants a burst's cloud never changes: precomputed once per show. */
export interface SmokeSource {
  /** Burst instant (the cue's landing). */
  burstSec: number
  lifeSec: number
  /** Rack x and burst height (world), the cloud's birth point. */
  x0: number
  z0: number
  burstRadiusM: number
  /** Per puff: seeded lateral/vertical offsets (0,0 for single-puff clouds) and shading seed. */
  puffs: readonly { ox: number; oz: number; seed: number }[]
}

/**
 * Precompute the smoke plan for a compiled show — rack lookups, catalog
 * lookups, life, and per-puff seeded offsets are fixed per cue, so the render
 * loop never re-derives them. Cues are kept in compiled (fire) order.
 */
export function prepareSmoke(
  compiled: CompiledShow,
  getEffect: (id: string) => EffectDef | undefined,
): SmokeSource[] {
  const out: SmokeSource[] = []
  const assets = compiled.show.site.assets
  for (const cue of compiled.cues) {
    if (cue.medium !== 'pyro') continue
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'pyro') continue
    const fx = effect as PyroEffect
    const rack = cue.positionId !== undefined ? assets.find((a) => a.id === cue.positionId) : undefined
    const n = fx.caliberMm >= SMOKE_LARGE_CALIBER_MM ? SMOKE_PUFFS_LARGE : 1
    const rng = mulberry32(forkSeed(cue.seed, 'smoke'))
    const puffs: { ox: number; oz: number; seed: number }[] = []
    for (let k = 0; k < n; k++) {
      const ox = n === 1 ? 0 : (rng() - 0.5) * fx.burstRadiusM * 0.8
      const oz = n === 1 ? 0 : (rng() - 0.5) * fx.burstRadiusM * 0.5
      puffs.push({ ox, oz, seed: forkSeed(cue.seed, `puff:${k}`) })
    }
    out.push({
      burstSec: cue.targetSec,
      lifeSec: smokeLifeSec(fx.caliberMm),
      x0: rack?.pos.x ?? 0,
      z0: (rack?.elevationM ?? 0) + fx.burstHeightM,
      burstRadiusM: fx.burstRadiusM,
      puffs,
    })
  }
  return out
}

/** Every live puff at show time t from a precomputed plan (the render-loop path). */
export function smokePuffsFromPlan(plan: readonly SmokeSource[], wind: Wind, t: number): SmokePuff[] {
  const out: SmokePuff[] = []
  for (const src of plan) {
    const age = t - src.burstSec
    if (age < 0 || age >= src.lifeSec) continue
    const alpha = smokeAlphaAt(age, src.lifeSec)
    if (alpha <= 0) continue
    const x0 = src.x0 + smokeDriftXM(wind, age)
    const radius = smokeRadiusAt(src.burstRadiusM, age, src.lifeSec)
    const single = src.puffs.length === 1
    for (const p of src.puffs) {
      out.push({
        x: x0 + p.ox,
        z: src.z0 + p.oz,
        radiusM: single ? radius : radius * 0.75,
        alpha: single ? alpha : alpha * 0.8,
        seed: p.seed,
      })
    }
  }
  return out
}

/**
 * Every live puff at show time t. Racks resolve through the site assets by
 * positionId (unknown → x = 0); puff offsets are seeded per cue (forkSeed
 * of cue.seed) so the cloud shape is stable across seeks and reloads.
 * Convenience over {@link prepareSmoke} + {@link smokePuffsFromPlan}.
 */
export function smokePuffsAt(
  compiled: CompiledShow,
  getEffect: (id: string) => EffectDef | undefined,
  wind: Wind,
  t: number,
): SmokePuff[] {
  return smokePuffsFromPlan(prepareSmoke(compiled, getEffect), wind, t)
}
