/**
 * sim/fountains.ts — closed-form water columns for the fountain banks.
 *
 * THE KEYSTONE, IN WATER: a shell is fired riseTimeSec early so its break
 * lands on the beat; a fountain valve is opened its latency plus the
 * column's ballistic rise sqrt(2h/g) early so the column CRESTS on the beat.
 * {@link fountainAnticipationSec} is the SINGLE OWNER of that lead — the
 * solver reads it for fireSec, and {@link fountainCrestErrorSecMax}
 * cross-checks the identity once per show.
 *
 * Like sim/pyro (burst = fireSec + riseTime, never targetSec), the water is
 * FIRE-ANCHORED: the valve opens at fireSec, first water shows valveLatency
 * later, and the column crests one ballistic rise after that. A correctly
 * solved cue therefore crests exactly at targetSec; a mis-solved one visibly
 * crests off the beat — the sim reports, never corrects.
 *
 * Column height is a pure function of show time (no per-step state):
 *   τ  = t − (fireSec + valveLatency + stagger_k)
 *   rising  (0 ≤ τ < T):     h = v₀τ − gτ²/2, v₀ = sqrt(2gH) = H·(2u − u²), u = τ/T
 *   holding (T ≤ τ):         h = H · wave(k, t)            ('wave' only)
 *   falling (last T of the window): h = H·(1 − v²)·wave(k, t) → 0 exactly at the end
 * so every column is dry exactly durationSec after its own crest. Cascades
 * stagger per column (choreo/generators/fountain jetEnvelopes); mist rises
 * MIST_RISE_FACTOR times slower than the ballistic column (a drifting
 * screen, not a shooter) and the anticipation stretches with it.
 */

import type {
  CompiledCue,
  CompiledShow,
  FountainBankSpec,
  FountainEffect,
  JetState,
  PositionedAsset,
  Seconds,
  SitePlan,
} from '../contracts.js'
import { GRAVITY_MPS2 } from '../contracts.js'
import type { EffectLookup } from '../acoustics/spl.js'
import { fountainRiseSec } from '../catalog/catalog.js'
import {
  FOUNTAIN_WAVE_DEPTH,
  fountainBankSpecOf,
  fountainCrestM,
  jetEnvelopes,
  wavePeriodBeats,
  beatsToSecAt,
  type JetEnvelope,
} from '../choreo/generators/fountain.js'
import { clamp, hexToRgb } from '../math/index.js'

/** Mist columns rise this many times slower than the ballistic column (and fall as slowly). */
export const MIST_RISE_FACTOR = 2.5
/**
 * The wave's dip fades in over this fraction of a period after the crest, so
 * every column starts the hold at full height (continuous with the rise).
 */
export const WAVE_RAMP_PERIODS = 0.5

type Rgb = readonly [number, number, number]

/** The bank asset a fountain cue rides (a ground stand-in at the origin when dangling). */
export function fountainBankAsset(cue: CompiledCue, site: SitePlan): PositionedAsset {
  if (cue.positionId !== undefined) {
    for (const a of site.assets) if (a.id === cue.positionId) return a
  }
  return { id: cue.positionId ?? '', kind: 'fountainBank', pos: { x: 0, y: 0 }, headingDeg: 0, elevationM: 0 }
}

/**
 * Rise time of a cue's columns to `crestM`: the ballistic sqrt(2h/g), or
 * MIST_RISE_FACTOR times that for mist. The one place the mist stretch
 * lives — the anticipation and the sim windows both read it.
 */
export function fountainRiseSecFor(effect: FountainEffect, crestM: number): Seconds {
  const rise = fountainRiseSec(crestM)
  return effect.jet === 'mist' ? rise * MIST_RISE_FACTOR : rise
}

/**
 * Anticipation of a fountain cue: the bank's valve latency plus the rise to
 * the requested crest (params.heightM, else the effect's height).
 * SINGLE OWNER — the solver and the sim's cross-check both call this.
 */
export function fountainAnticipationSec(
  site: SitePlan,
  cue: Pick<CompiledCue, 'positionId' | 'params'>,
  effect: FountainEffect,
): Seconds {
  const asset = site.assets.find((a) => a.id === cue.positionId)
  const spec = fountainBankSpecOf(asset)
  return spec.valveLatencySec + fountainRiseSecFor(effect, fountainCrestM(effect, cue.params))
}

/** One fountain cue prepared for per-step evaluation. */
export interface FountainCueSim {
  cueIdx: number
  cue: CompiledCue
  effect: FountainEffect
  asset: PositionedAsset
  spec: FountainBankSpec
  jets: readonly JetEnvelope[]
  /** Rise time of the crest (seconds; mist stretched). */
  riseSec: Seconds
  /** First water visible: fireSec + valve latency (the first column's rise start). */
  startSec: Seconds
  /** Last column dry: its crest + durationSec (fire-anchored). */
  endSec: Seconds
  /** Wave period in seconds on the show's beat grid at the landing. */
  wavePeriodSec: Seconds
  /** Wave travels from the high-index end when params.reverse is set. */
  waveReverse: boolean
  /** Lighting colors, alternated across the engaged nozzles. */
  colors: readonly Rgb[]
}

/** Crest instant of one column: valve + rise + stagger after fireSec. */
export function jetCrestSec(c: Pick<FountainCueSim, 'cue' | 'spec' | 'riseSec'>, j: JetEnvelope): Seconds {
  return c.cue.fireSec + c.spec.valveLatencySec + c.riseSec + j.delaySec
}

/** rgb / rgb2 params → colors list (effect palette when neither is given). */
function cueColors(cue: CompiledCue, effect: FountainEffect): Rgb[] {
  const tuple = (v: unknown): Rgb | undefined =>
    Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')
      ? [clamp(v[0] as number, 0, 1), clamp(v[1] as number, 0, 1), clamp(v[2] as number, 0, 1)]
      : undefined
  const a = tuple(cue.params?.['rgb'])
  const b = tuple(cue.params?.['rgb2'])
  if (a) return b ? [a, b] : [a]
  const fromEffect = effect.colors.map((c) => hexToRgb(c) as Rgb)
  return fromEffect.length > 0 ? fromEffect : [[1, 1, 1]]
}

/** Collect fountain cues with their bank geometry and time windows. */
export function buildFountainCues(
  compiled: CompiledShow,
  getEffect: EffectLookup,
): FountainCueSim[] {
  const out: FountainCueSim[] = []
  const beats = compiled.show.music.beats
  compiled.cues.forEach((cue, cueIdx) => {
    if (cue.medium !== 'fountain') return
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'fountain') return
    const asset = fountainBankAsset(cue, compiled.show.site)
    const spec = fountainBankSpecOf(asset)
    const jets = jetEnvelopes(cue, effect, asset, { beats })
    const riseSec = fountainRiseSecFor(effect, fountainCrestM(effect, cue.params))
    const partial = { cue, spec, riseSec }
    let lastCrest = -Infinity
    for (const j of jets) lastCrest = Math.max(lastCrest, jetCrestSec(partial, j))
    out.push({
      cueIdx,
      cue,
      effect,
      asset,
      spec,
      jets,
      riseSec,
      startSec: cue.fireSec + spec.valveLatencySec,
      endSec: (jets.length > 0 ? lastCrest : cue.fireSec + spec.valveLatencySec + riseSec) + cue.durationSec,
      wavePeriodSec: beatsToSecAt(beats, cue.targetSec, wavePeriodBeats(cue.params)),
      waveReverse: cue.params?.['reverse'] === true,
      colors: cueColors(cue, effect),
    })
  })
  return out
}

/**
 * Wave modulation factor for column k of n, `tSinceCrest` seconds after ITS
 * crest, with the wave period in seconds: a raised-cosine dip of depth
 * FOUNTAIN_WAVE_DEPTH traveling from nozzle 0 to nozzle n−1 once per period
 * (column k dips deepest at phase k/n + 1/2). The dip fades in over
 * WAVE_RAMP_PERIODS so the factor is exactly 1 at the crest for every
 * column — continuous with the rise — and never below 1 − depth.
 */
export function waveFactor(
  k: number,
  n: number,
  tSinceCrest: Seconds,
  periodSec: Seconds,
): number {
  if (!(periodSec > 0) || n <= 0 || !(tSinceCrest > 0)) return 1
  const phase = tSinceCrest / periodSec - k / n
  const ramp = clamp(tSinceCrest / (periodSec * WAVE_RAMP_PERIODS), 0, 1)
  return 1 - FOUNTAIN_WAVE_DEPTH * ramp * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase))
}

/**
 * Column height above the nozzle at show time t, plus its phase. Pure.
 * `crestSec` is when this column crests; `endSec` is when it must be dry
 * again (crest + the cue's visible duration). Rising is the normalized
 * ballistic arc H·(2u − u²) (h(T/2) = 0.75 H); the fall mirrors it over the
 * last `riseSec` of the window (or the whole window when shorter).
 */
export function jetHeightAt(
  tSec: Seconds,
  crestM: number,
  riseSec: Seconds,
  crestSec: Seconds,
  endSec: Seconds,
): { heightM: number; phase: JetState['phase'] } {
  const start = crestSec - riseSec
  if (tSec < start || tSec >= endSec) return { heightM: 0, phase: 'falling' }
  if (tSec < crestSec) {
    const u = (tSec - start) / Math.max(1e-9, riseSec)
    return { heightM: crestM * (2 * u - u * u), phase: 'rising' }
  }
  const fallStart = Math.max(crestSec, endSec - riseSec)
  if (tSec < fallStart) return { heightM: crestM, phase: 'holding' }
  const v = (tSec - fallStart) / Math.max(1e-9, endSec - fallStart)
  return { heightM: crestM * Math.max(0, 1 - v * v), phase: 'falling' }
}

/** Per-step context for jet evaluation (reserved; the wave period is fixed at build time). */
export interface FountainStepOpts {
  /** Beat instants (MusicalTimeline.beats); accepted for symmetry with the other channels. */
  beats?: readonly Seconds[]
}

/**
 * JetState for every engaged nozzle of every cue with water up at tSec, in
 * compiled-cue then nozzle order. Columns are fire-anchored (jetCrestSec);
 * `crested` flips exactly at each column's crest instant.
 */
export function jetStatesAt(
  cues: readonly FountainCueSim[],
  tSec: Seconds,
  _opts: FountainStepOpts = {},
): JetState[] {
  const out: JetState[] = []
  for (const c of cues) {
    if (tSec < c.startSec || tSec >= c.endSec) continue
    const n = c.jets.length
    c.jets.forEach((j, k) => {
      const crestSec = jetCrestSec(c, j)
      const endSec = crestSec + c.cue.durationSec
      const { heightM: hRaw, phase } = jetHeightAt(tSec, j.crestM, c.riseSec, crestSec, endSec)
      if (hRaw <= 0) return
      const waveK = c.waveReverse ? n - 1 - k : k
      const mod =
        c.effect.jet === 'wave' && phase !== 'rising'
          ? waveFactor(waveK, n, tSec - crestSec, c.wavePeriodSec)
          : 1
      const heightM = hRaw * mod
      const [r, g, b] = c.colors[k % c.colors.length]!
      const lean = j.crestM > 0 ? heightM / j.crestM : 0
      out.push({
        cueIdx: c.cueIdx,
        assetId: c.asset.id,
        nozzle: j.nozzle,
        base: j.base,
        heightM,
        crestM: j.crestM,
        tipDx: j.tipDx * lean,
        tipDy: j.tipDy * lean,
        widthM: c.effect.widthM,
        r,
        g,
        b,
        phase,
        crested: tSec >= crestSec,
      })
    })
  }
  return out
}

/**
 * Max over fountain cues of |fireSec + anticipation − targetSec| — ≈ 0 when
 * the solver anticipated the valve latency plus the rise correctly (the
 * first column then crests exactly on targetSec). Delegates to the same
 * single-owner lead the solver used.
 */
export function fountainCrestErrorSecMax(cues: readonly FountainCueSim[], site: SitePlan): number {
  let worst = 0
  for (const c of cues) {
    const err = Math.abs(c.cue.fireSec + fountainAnticipationSec(site, c.cue, c.effect) - c.cue.targetSec)
    if (err > worst) worst = err
  }
  return worst
}

/** DMX channel slots per nozzle: level (column height / bank max), r, g, b. */
export const FOUNTAIN_SLOTS_PER_NOZZLE = 4

/**
 * Channel blob for one bank at a step from the jet states: per nozzle
 * [level, r, g, b], level = height / maxHeightM (clamped to full scale).
 * Dry nozzles are zero. Concurrent cues on one nozzle MAX-blend per channel
 * (order-independent, like the crowd canvas).
 */
export function fountainChannelsAt(
  states: readonly JetState[],
  asset: PositionedAsset,
  spec: FountainBankSpec,
): Uint8Array {
  const n = Math.max(1, Math.floor(spec.nozzles))
  const out = new Uint8Array(n * FOUNTAIN_SLOTS_PER_NOZZLE)
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)))
  for (const s of states) {
    if (s.assetId !== asset.id || s.nozzle < 0 || s.nozzle >= n) continue
    if (!(s.heightM > 0)) continue
    const o = s.nozzle * FOUNTAIN_SLOTS_PER_NOZZLE
    const level = spec.maxHeightM > 0 ? s.heightM / spec.maxHeightM : 0
    out[o] = Math.max(out[o]!, byte(level))
    out[o + 1] = Math.max(out[o + 1]!, byte(s.r))
    out[o + 2] = Math.max(out[o + 2]!, byte(s.g))
    out[o + 3] = Math.max(out[o + 3]!, byte(s.b))
  }
  return out
}

/** Launch speed a column needs to crest at heightM: sqrt(2gh), m/s (pump sizing sanity). */
export function crestLaunchSpeedMps(heightM: number): number {
  return Math.sqrt(2 * GRAVITY_MPS2 * Math.max(0, heightM))
}
