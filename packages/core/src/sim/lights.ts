/**
 * sim/lights.ts — searchlight bank chains and per-step head states.
 *
 * SINGLE OWNER — deriveLightChains(compiled, getEffect) is THE derivation of
 * per-bank head timelines from a CompiledShow. The alignment solver adopts
 * these departures as searchlight fireSecs (the drone pattern: phase 1
 * estimates, the final pass adopts the sim's own chain), so a compiled
 * searchlight cue's fireSec IS the instant its heads begin to slew. The DMX
 * exporter and the gallery read head states through lightStatesAt, so the
 * exported pan/tilt schedule and the reviewed sim never disagree.
 *
 * Sequential bank logic (deterministic, (targetSec, id) order per bank):
 * 1. Heads start PARKED straight up (LIGHT_PARK_DIR).
 * 2. Every cue is one segment: opening aims = figureAimsAt(cue, targetSec);
 *    slewSec = max over heads of angle(prevAim, openingAim) / slewRate ×
 *    LIGHT_SLEW_MARGIN — THE ANTICIPATION (kinematics, like a drone morph).
 * 3. The heads leave their previous aim at
 *      startSec = clamp(targetSec − slewSec, cutSec, targetSec),
 *    never before the transport start, where cutSec is the instant the
 *    previous figure releases them (its hold end, or — when the next landing
 *    falls INSIDE that hold — the later of the previous landing and this
 *    cue's ideal departure; the previous hold is truncated there and
 *    'sim/light-overlap' is reported).
 * 4. A squeezed departure (startSec later than the kinematic ideal) is
 *    reported as 'sim/light-slew-short' and the sim stays HONEST: heads slew
 *    at the bank's rate and simply arrive late — still moving at targetSec,
 *    reaching the figure at startSec + slewSec. The sim reports, never
 *    silently corrects.
 * 5. During the slew a head follows the great circle from its previous aim
 *    toward the figure's CURRENT aim (so it joins a moving sweep without a
 *    seam), lamp LIT — you see the light arrive. From arrival it tracks the
 *    figure through the hold [targetSec, holdEnd); the lamp strikes over
 *    LIGHT_STRIKE_SEC (or the whole slew when that is shorter — a head that
 *    needs no slew simply pops on AT the landing) and fades over the last
 *    LIGHT_FADE_SEC of the hold.
 * 6. The previous aim for the next cue is this figure's aim at the instant it
 *    releases the heads (cutSec).
 */

import type {
  CompiledCue,
  CompiledShow,
  Diagnostic,
  LightState,
  PositionedAsset,
  SearchlightBankSpec,
  SearchlightEffect,
  Seconds,
  Vec3,
} from '../contracts.js'
import type { EffectLookup } from '../acoustics/spl.js'
import {
  LIGHT_PARK_DIR,
  angleBetweenDeg,
  azimuthDegOf,
  bankHeadBases,
  figureAimsAt,
  figureIntensityAt,
  searchlightBankSpecOf,
  slerpDir,
  tiltDegOf,
} from '../choreo/generators/searchlight.js'
import { clamp, hexToRgb } from '../math/index.js'

/** Slew headroom over the kinematic minimum (like DRONE_ANTICIPATION_MARGIN). */
export const LIGHT_SLEW_MARGIN = 1.1
/** Lamp strike ramp after the slew begins, seconds. */
export const LIGHT_STRIKE_SEC = 0.25
/** Lamp fade over the tail of the hold, seconds. */
export const LIGHT_FADE_SEC = 0.5
/** Fixed-point rounds when a hold is cut for a moving figure (see deriveLightChains). */
export const LIGHT_CUT_ITERATIONS = 4
/** Slew progress at or above this counts as arrived (float guard). */
const ARRIVED_EPS = 1e-9

/** One cue's segment on a bank timeline. */
export interface LightSegment {
  cueIdx: number
  cue: CompiledCue
  effect: SearchlightEffect
  /** Slew departure (the compiled fireSec after the solver adopts it). */
  startSec: Seconds
  /** The musical landing (cue.targetSec) — opening aims reached when unsqueezed. */
  targetSec: Seconds
  /** Kinematic arrival on the figure: startSec + slewSec (> targetSec when squeezed). */
  arriveSec: Seconds
  /** Hold end: targetSec + durationSec, truncated when the next figure overlaps. */
  holdEndSec: Seconds
  /** Kinematic slew time the heads need (with margin), seconds. */
  slewSec: Seconds
  /** Per-head aims the slew departs from. */
  fromDirs: readonly Vec3[]
  /** Per-head opening aims of the figure (at targetSec). */
  toDirs: readonly Vec3[]
}

/** Full head timeline for one searchlightBank asset. */
export interface BankTimeline {
  bankId: string
  asset: PositionedAsset
  spec: SearchlightBankSpec
  bases: readonly Vec3[]
  segments: readonly LightSegment[]
  diagnostics: readonly Diagnostic[]
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Kinematic slew time between two per-head aim sets, seconds (with margin). */
export function searchlightSlewSec(
  spec: SearchlightBankSpec,
  fromDirs: readonly Vec3[],
  toDirs: readonly Vec3[],
): Seconds {
  if (!(spec.slewRateDegPerSec > 0)) return 0
  let worstDeg = 0
  const n = Math.min(fromDirs.length, toDirs.length)
  for (let i = 0; i < n; i++) {
    const d = angleBetweenDeg(fromDirs[i]!, toDirs[i]!)
    if (d > worstDeg) worstDeg = d
  }
  return (worstDeg / spec.slewRateDegPerSec) * LIGHT_SLEW_MARGIN
}

/** The bank asset a searchlight cue rides (a ground stand-in when dangling). */
export function searchlightBankAsset(cue: CompiledCue, assets: readonly PositionedAsset[]): PositionedAsset {
  if (cue.positionId !== undefined) {
    for (const a of assets) if (a.id === cue.positionId) return a
  }
  return { id: cue.positionId ?? '', kind: 'searchlightBank', pos: { x: 0, y: 0 }, headingDeg: 0, elevationM: 0 }
}

/**
 * Derive every bank's head timeline from a compiled show. Cues are grouped by
 * positionId (banks without a spec fall back to DEFAULT_SEARCHLIGHT_BANK) and
 * chained in (targetSec, id) order from the parked state.
 */
export function deriveLightChains(compiled: CompiledShow, getEffect: EffectLookup): BankTimeline[] {
  const site = compiled.show.site
  const beats = compiled.show.music.beats
  const t0 = 0 - (compiled.show.preRollSec ?? 0)
  const byBank = new Map<string, { cue: CompiledCue; cueIdx: number; effect: SearchlightEffect }[]>()
  compiled.cues.forEach((cue, cueIdx) => {
    if (cue.medium !== 'searchlight') return
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'searchlight') return
    const key = cue.positionId ?? ''
    const list = byBank.get(key)
    const entry = { cue, cueIdx, effect }
    if (list) list.push(entry)
    else byBank.set(key, [entry])
  })

  const out: BankTimeline[] = []
  for (const key of [...byBank.keys()].sort(cmpStr)) {
    const list = byBank.get(key)!
    list.sort((a, b) => a.cue.targetSec - b.cue.targetSec || cmpStr(a.cue.id, b.cue.id))
    const asset = searchlightBankAsset(list[0]!.cue, site.assets)
    const spec = searchlightBankSpecOf(asset)
    const bases = bankHeadBases(asset, spec)
    const diagnostics: Diagnostic[] = []
    const segments: LightSegment[] = []
    let prevDirs: Vec3[] = bases.map(() => ({ ...LIGHT_PARK_DIR }))
    let prev: LightSegment | undefined

    for (const { cue, cueIdx, effect } of list) {
      const toDirs = figureAimsAt(cue, effect, asset, cue.targetSec, { beats })
      // The previous figure's aim is what the heads leave FROM. When the next
      // landing falls inside the previous hold, that hold is cut at the later
      // of its own landing and this cue's ideal departure; the departure aim
      // is re-read at the cut instant (a sweep keeps moving until released).
      let releaseSec = prev ? prev.holdEndSec : t0
      let fromDirs = prevDirs
      let slewSec = searchlightSlewSec(spec, fromDirs, toDirs)
      if (prev && prev.holdEndSec > cue.targetSec) {
        // A moving figure's departure aim depends on WHEN it is cut, and the
        // slew depends on that aim: iterate the cut earlier until the slew
        // measured from the cut aim fits (or the cut reaches the previous
        // landing, where nothing earlier is available).
        let cutSec = Math.max(prev.targetSec, cue.targetSec - slewSec)
        fromDirs = figureAimsAt(prev.cue, prev.effect, asset, cutSec, { beats })
        slewSec = searchlightSlewSec(spec, fromDirs, toDirs)
        for (let iter = 0; iter < LIGHT_CUT_ITERATIONS; iter++) {
          const nextCut = Math.max(prev.targetSec, cue.targetSec - slewSec)
          if (nextCut >= cutSec - 1e-9) break
          cutSec = nextCut
          fromDirs = figureAimsAt(prev.cue, prev.effect, asset, cutSec, { beats })
          slewSec = searchlightSlewSec(spec, fromDirs, toDirs)
        }
        diagnostics.push({
          code: 'sim/light-overlap',
          severity: 'warning',
          message:
            `searchlight bank ${asset.id}: cue ${cue.id} lands at ${cue.targetSec.toFixed(2)}s while ` +
            `cue ${prev.cue.id} still holds until ${prev.holdEndSec.toFixed(2)}s; the earlier hold ` +
            `releases the heads at ${cutSec.toFixed(2)}s`,
          cueIds: [prev.cue.id, cue.id],
          assetId: asset.id,
          tSec: cutSec,
        })
        prev.holdEndSec = cutSec
        releaseSec = cutSec
      }
      const ideal = cue.targetSec - slewSec
      const startSec = clamp(ideal, Math.max(releaseSec, t0), cue.targetSec)
      if (startSec > ideal + 1e-9) {
        diagnostics.push({
          code: 'sim/light-slew-short',
          severity: 'warning',
          message:
            `searchlight bank ${asset.id}: cue ${cue.id} needs ${slewSec.toFixed(2)}s of slew but ` +
            `only ${(cue.targetSec - startSec).toFixed(2)}s are free before its landing; heads arrive ` +
            `${(startSec - ideal).toFixed(2)}s late`,
          cueIds: [cue.id],
          assetId: asset.id,
          tSec: startSec,
        })
      }
      const holdEndSec = cue.targetSec + cue.durationSec
      const seg: LightSegment = {
        cueIdx,
        cue,
        effect,
        startSec,
        targetSec: cue.targetSec,
        arriveSec: startSec + slewSec,
        holdEndSec,
        slewSec,
        fromDirs,
        toDirs,
      }
      segments.push(seg)
      prevDirs = figureAimsAt(cue, effect, asset, holdEndSec, { beats })
      prev = seg
    }
    out.push({ bankId: asset.id, asset, spec, bases, segments, diagnostics })
  }
  return out
}

/**
 * Slew progress of a segment at tSec: 0 at departure, 1 at kinematic arrival
 * (startSec + slewSec); 1 immediately when no slew was needed.
 */
export function slewProgress(seg: Pick<LightSegment, 'startSec' | 'slewSec'>, tSec: Seconds): number {
  if (!(seg.slewSec > 0)) return 1
  const u = (tSec - seg.startSec) / seg.slewSec
  return u >= 1 - ARRIVED_EPS ? 1 : clamp(u, 0, 1)
}

/**
 * Strike × fade envelope of a segment's lamp at tSec (0..1). The strike ramps
 * from departure over min(LIGHT_STRIKE_SEC, targetSec − startSec), so the
 * lamp is always at full by the musical landing — a zero-slew figure pops on
 * exactly ON the beat.
 */
export function lampEnvelope(
  seg: Pick<LightSegment, 'startSec' | 'targetSec' | 'holdEndSec'>,
  tSec: Seconds,
): number {
  const strikeSec = Math.min(LIGHT_STRIKE_SEC, seg.targetSec - seg.startSec)
  const strike = strikeSec > 0 ? clamp((tSec - seg.startSec) / strikeSec, 0, 1) : tSec >= seg.startSec ? 1 : 0
  const fade = clamp((seg.holdEndSec - tSec) / LIGHT_FADE_SEC, 0, 1)
  return strike * fade
}

/** Per-step context for head evaluation. */
export interface LightStepOpts {
  /** Beat instants for periodBeats figures. */
  beats?: readonly Seconds[]
}

/** Lamp color of a head: params.rgb override, else the effect colors cycled by head. */
export function headColor(
  cue: CompiledCue,
  effect: SearchlightEffect,
  head: number,
): readonly [number, number, number] {
  const rgbParam = cue.params?.['rgb']
  if (Array.isArray(rgbParam) && rgbParam.length === 3 && rgbParam.every((x) => typeof x === 'number')) {
    const p = rgbParam as readonly number[]
    return [clamp(p[0]!, 0, 1), clamp(p[1]!, 0, 1), clamp(p[2]!, 0, 1)]
  }
  const n = effect.colors.length
  return hexToRgb(n > 0 ? effect.colors[head % n]! : '#ffffff')
}

/**
 * LightState for every head of every segment active at tSec, bank order then
 * segment order then head order. Pure in (chains, tSec, opts).
 */
export function lightStatesAt(
  chains: readonly BankTimeline[],
  tSec: Seconds,
  opts: LightStepOpts = {},
): LightState[] {
  const out: LightState[] = []
  for (const bank of chains) {
    for (const seg of bank.segments) {
      if (tSec < seg.startSec || tSec >= seg.holdEndSec) continue
      const u = slewProgress(seg, tSec)
      const slewing = u < 1
      // The figure's aim NOW: the slew target while en route, the aim itself
      // once arrived — so a head joins a moving sweep without a seam.
      const figureDirs = figureAimsAt(seg.cue, seg.effect, bank.asset, tSec, opts)
      const env = lampEnvelope(seg, tSec)
      bank.bases.forEach((base, head) => {
        const aim = figureDirs[head] ?? LIGHT_PARK_DIR
        const dir = slewing ? slerpDir(seg.fromDirs[head] ?? LIGHT_PARK_DIR, aim, u) : aim
        const [r, g, b] = headColor(seg.cue, seg.effect, head)
        const figureI = slewing ? 1 : figureIntensityAt(seg.cue, seg.effect, bank.asset, head, tSec, opts)
        out.push({
          cueIdx: seg.cueIdx,
          assetId: bank.bankId,
          head,
          base,
          dir,
          reachM: seg.effect.reachM,
          halfAngleDeg: seg.effect.beamWidthDeg / 2,
          r,
          g,
          b,
          intensity: env * figureI,
          slewing,
        })
      })
    }
  }
  return out
}

/**
 * Max over searchlight cues of (arriveSec − targetSec): 0 when every head is
 * on its figure by the musical landing (the keystone held), positive seconds
 * of late arrival otherwise. A stats cross-check, computed once per show.
 */
export function lightArrivalLagSecMax(chains: readonly BankTimeline[]): Seconds {
  let worst = 0
  for (const bank of chains) {
    for (const seg of bank.segments) {
      const lag = seg.arriveSec - seg.targetSec
      if (lag > worst) worst = lag
    }
  }
  return worst
}

/** DMX channel slots per head: pan, tilt, dimmer, r, g, b. */
export const SEARCHLIGHT_SLOTS_PER_HEAD = 6

/**
 * Channel blob for one bank at a step from the head states: per head
 * [pan, tilt, dimmer, r, g, b] with pan = world azimuth / 360 (0 = north,
 * wrapping; 0 for a vertical head) and tilt = tilt-from-vertical /
 * maxTiltDeg. Colors are pre-scaled by the lamp intensity. Concurrent states
 * on one head MAX-blend by dimmer (order-independent); unlit heads are zero.
 */
export function searchlightChannelsAt(
  states: readonly LightState[],
  asset: PositionedAsset,
  spec: SearchlightBankSpec,
): Uint8Array {
  const n = Math.max(1, Math.floor(spec.heads))
  const out = new Uint8Array(n * SEARCHLIGHT_SLOTS_PER_HEAD)
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)))
  for (const s of states) {
    if (s.assetId !== asset.id || s.head < 0 || s.head >= n) continue
    const o = s.head * SEARCHLIGHT_SLOTS_PER_HEAD
    const dimmer = byte(s.intensity)
    if (dimmer < out[o + 2]!) continue
    const tiltDeg = tiltDegOf(s.dir)
    const az = tiltDeg < 1e-6 ? 0 : ((azimuthDegOf(s.dir) % 360) + 360) % 360
    const tilt = spec.maxTiltDeg > 0 ? tiltDeg / spec.maxTiltDeg : 0
    out[o] = byte(az / 360)
    out[o + 1] = byte(clamp(tilt, 0, 1))
    out[o + 2] = dimmer
    out[o + 3] = byte(s.r * s.intensity)
    out[o + 4] = byte(s.g * s.intensity)
    out[o + 5] = byte(s.b * s.intensity)
  }
  return out
}
