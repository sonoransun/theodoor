/**
 * show/solve.ts — THE alignment solver (single owner of cue timing).
 *
 * Keystone identity: fireSec = targetSec − anticipationSec (a cue is fired
 * early so its visible LANDING sits on the musical moment).
 *
 * Two phases:
 *   PHASE 1 (per track in order, per cue in array order): resolve the anchor
 *   to targetSec, derive anticipationSec from the catalog (pyro rise, 0.1 s
 *   fabrication latency, 0 laser/panel), from planMorph() over the pad's
 *   sequential formation chain (drone), from the mast's p95 command latency
 *   for the effect's channel (crowd, {@link crowdLatencyFor}), or from the
 *   acoustic time-of-flight to the landing aim (beam,
 *   {@link beamAnticipationSec}), then fireSec = target − ant. Beam cues
 *   carrying params.sourceCueId are then link-checked on the phase-1
 *   landings: a reference that is not a compiled drone/pyro cue errors
 *   BEAM_SOURCE_UNRESOLVED; disjoint active windows warn
 *   BEAM_SOURCE_NOT_CONCURRENT (the sim falls back to targetCellId).
 *   PHASE 2 (deterministic repair passes, in this order):
 *     a. quantize LANDING times (never fire) to the requested grid;
 *     b. negative fire → shift the landing forward by whole beats (bounded,
 *        never across a 'phrase' annotation) else NEGATIVE_FIRE;
 *     c. rack pin capacity (choreo pinCapacity) → bounded ±beat shift of the
 *        lowest-priority offender, one re-run, else PIN_CAPACITY;
 *     d. drone pad overlap (choreo droneOverlap) → same bounded shift of the
 *        lower-priority cue, one re-run, else DRONE_OVERLAP;
 *     d2. crowd mast bandwidth (choreo crowdBandwidth) → same shift of the
 *        lowest-priority over-cap cue, one re-run, else CROWD_BANDWIDTH;
 *     d3. beam slew (choreo beamSlew) → same shift of the lower-priority /
 *        later cue, one re-run, else BEAM_SLEW;
 *     e. SPL budget (only when show.noiseBudget is set) → substitute quieter
 *        effects (opts.substitute, default defaultQuietSubstitute) or drop
 *        cues, to a fixpoint over at most MAX_SPL_ROUNDS, else SPL_BUDGET.
 *
 * DRONE PLAN INVARIANT: morph plans are NOT stored on CompiledCue. They are
 * pure functions of (compiled drone cues, site fleet limits, per-cue seeds):
 * the sim re-derives byte-identical plans via {@link droneMorphPlans}. The
 * launch state of every pad is {@link launchFormation}(count of the pad's
 * first cue) — a 2 m grid resampled to the cue's drone count. planMorph's
 * assignment/waypoints/minTransitionSec do not depend on its transitionSec
 * argument, so phase-2 landing shifts never change a cue's anticipation.
 * (Corollary: drone cues on one pad must be authored in chronological order.)
 */

import type {
  BeamEffect,
  Beats,
  CompiledCue,
  CompiledShow,
  CrowdChannel,
  CueParams,
  Diagnostic,
  DronePrimitive,
  EffectDef,
  Formation,
  MusicalTimeline,
  Seconds,
  Show,
  SitePlan,
  Vec2,
} from '../contracts.js'
import { SPEED_OF_SOUND_MPS, SPL_REF_DISTANCE_M } from '../contracts.js'
import type { Catalog } from '../catalog/index.js'
import { getEffectFrom } from '../catalog/index.js'
import { clamp, cueSeed, dist2, fnv1a32, v2 } from '../math/index.js'
import type { QuantizeGrid } from '../time/index.js'
import { lowerIndex, quantizeTime } from '../time/index.js'
import type { MorphLimits, MorphResult } from '../choreo/index.js'
import {
  droneOverlap,
  formationFromEffect,
  grid,
  pinCapacity,
  planMorph,
  resampleTo,
} from '../choreo/index.js'
import { beamSlew, crowdBandwidth } from '../choreo/conflicts.js'
import { beamAimAt, beamLandingTofSec, beamSourceAsset, beamTargetAt } from '../acoustics/beams.js'
import { crowdGridFor, crowdMastFor } from '../site/crowdGrid.js'
import { cueSourcePos, splAtDistance, splAtInstant, quietReport } from '../acoustics/index.js'
import { derivePadTimelines } from '../sim/drones.js'
import { annotationsOfKind } from '../music/index.js'
import { resolveAnchor } from './anchors.js'

// ---------------------------------------------------------------------------
// Options & constants
// ---------------------------------------------------------------------------

export interface SolveOptions {
  /** Landing-time quantize grid (default 'none'). */
  quantize?: QuantizeGrid
  /** Conflict-resolution shift search radius in whole beats (default 2). */
  maxShiftBeats?: number
  /** Quiet-alternative lookup (default {@link defaultQuietSubstitute}). */
  substitute?: (effectId: string) => string | undefined
}

export interface SolveResult {
  cues: CompiledCue[]
  diagnostics: Diagnostic[]
}

/** Drone anticipation = planMorph().minTransitionSec × this safety margin. */
export const DRONE_ANTICIPATION_MARGIN = 1.1
/** Spacing of the synthetic launch grid every pad chain starts from. */
export const LAUNCH_GRID_SPACING_M = 2
/** Fleet kinematics used when a drone cue's pad carries no FleetSpec. */
export const DEFAULT_FLEET_LIMITS: MorphLimits = { vMaxMps: 6, aMaxMps2: 3, rMinM: 2 }
/** SPL substitution/drop rounds before remaining violations become errors. */
export const MAX_SPL_ROUNDS = 4
/** Two pyro fires on one position closer than this warn RAPID_REFIRE. */
export const RAPID_REFIRE_SEC = 2

const EPS = 1e-9

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Contract order for CompiledShow.cues: (fireSec, trackId, id). */
export const compiledCueOrder = (a: CompiledCue, b: CompiledCue): number =>
  a.fireSec - b.fireSec || cmpStr(a.trackId, b.trackId) || cmpStr(a.id, b.id)

// ---------------------------------------------------------------------------
// Drone helpers (shared with sim via droneMorphPlans)
// ---------------------------------------------------------------------------

/** Cue drone count: params.count clamped to the effect range (formationFromEffect's rule). */
export function droneCountFor(effect: DronePrimitive, params: CueParams | undefined): number {
  return clamp(
    Math.round(typeof params?.count === 'number' ? params.count : effect.maxDrones),
    effect.minDrones,
    effect.maxDrones,
  )
}

/**
 * The synthetic ground/launch formation every pad's morph chain starts from:
 * a near-square 2 m-spaced grid resampled to exactly `count` points
 * (deterministic seed derived from the count only, so any consumer can
 * re-derive it without show context).
 */
export function launchFormation(count: number): Formation {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.max(1, Math.ceil(count / cols))
  return {
    name: `launch-grid-${count}`,
    points: resampleTo(
      grid(rows, cols, LAUNCH_GRID_SPACING_M).points,
      count,
      fnv1a32(`launch:${count}`),
    ),
  }
}

/** Kinematic limits of the pad asset carrying `positionId` (defaults otherwise). */
export function fleetLimitsAt(site: SitePlan, positionId: string | undefined): MorphLimits {
  if (positionId !== undefined) {
    for (const a of site.assets) {
      if (a.id === positionId && a.fleet) {
        return { vMaxMps: a.fleet.vMaxMps, aMaxMps2: a.fleet.aMaxMps2, rMinM: a.fleet.rMinM }
      }
    }
  }
  return DEFAULT_FLEET_LIMITS
}

/** One drone cue's re-derived morph plan (see DRONE PLAN INVARIANT above). */
export interface DroneCuePlan {
  cueId: string
  from: Formation
  to: Formation
  limits: MorphLimits
  plan: MorphResult
}

/**
 * Re-derive every drone cue's morph plan from a compiled cue list —
 * deterministic and identical to what the solver computed (same formation
 * chain, same seeds). Cues are grouped by positionId and chained in
 * (targetSec, id) order from {@link launchFormation}. The plan's transition
 * argument is the cue's actual flight window (anticipationSec); it only
 * affects the `feasible` flag, never the paths.
 */
export function droneMorphPlans(
  cues: readonly CompiledCue[],
  site: SitePlan,
  getEffect: (id: string) => EffectDef | undefined,
): Map<string, DroneCuePlan> {
  const byPad = new Map<string, CompiledCue[]>()
  for (const c of cues) {
    if (c.medium !== 'drone') continue
    const key = c.positionId ?? ''
    const list = byPad.get(key)
    if (list) list.push(c)
    else byPad.set(key, [c])
  }
  const out = new Map<string, DroneCuePlan>()
  for (const key of [...byPad.keys()].sort(cmpStr)) {
    const list = byPad.get(key)!
    list.sort((a, b) => a.targetSec - b.targetSec || cmpStr(a.id, b.id))
    const limits = fleetLimitsAt(site, key === '' ? undefined : key)
    let prev: Formation | undefined
    for (const cue of list) {
      const effect = getEffect(cue.effectId)
      if (!effect || effect.medium !== 'drone') continue
      const from = prev ?? launchFormation(droneCountFor(effect, cue.params))
      const to = formationFromEffect(effect, cue.params, cue.seed)
      const plan = planMorph(from, to, cue.anticipationSec, limits)
      out.set(cue.id, { cueId: cue.id, from, to, limits, plan })
      prev = to
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Crowd & beam anticipation (phase-1 inputs, exported like the drone helpers)
// ---------------------------------------------------------------------------

/** Fallback p95 command latency per channel when no mast spec is available. */
export const DEFAULT_CROWD_LATENCY_SEC: Readonly<Record<CrowdChannel, Seconds>> = {
  wristband: 0.05,
  phone: 1.0,
}

/**
 * Crowd anticipation = the mast's p95 command latency for the effect's
 * channel: the broadcast is commanded early so the p95 device lands ON the
 * beat. The mast is resolved by {@link crowdMastFor} — the SAME rule the
 * sim's buildCrowdCues and the broadcast exporters use — so the anticipation
 * is always the p95 of the latency distribution the broadcast actually
 * rides. Only a site with no spec-bearing mast at all falls back to
 * {@link DEFAULT_CROWD_LATENCY_SEC}.
 */
export function crowdLatencyFor(
  site: SitePlan,
  positionId: string | undefined,
  channel: CrowdChannel,
): Seconds {
  const mast = crowdMastFor(site, positionId)
  if (mast?.crowdMast) return mast.crowdMast[channel].p95Ms / 1000
  return DEFAULT_CROWD_LATENCY_SEC[channel]
}

/**
 * Beam anticipation = acoustic time-of-flight from the array head to the
 * cue's LANDING aim (beamTargetAt at the resolved targetSec): slant / c.
 * This is the purest instance of the keystone identity — the sound is fired
 * early by exactly distance/SPEED_OF_SOUND so the wavefront itself arrives
 * on the musical moment.
 *
 * Special case `params.cells === 'all'` (the everywhere-at-once toll): the
 * MAX slant over ALL crowd-grid cells — fired early enough that even the
 * farthest cell hears it on the beat.
 */
export function beamAnticipationSec(
  site: SitePlan,
  cue: CompiledCue,
  effect: BeamEffect,
): Seconds {
  return beamLandingTofSec(cue, effect, site)
}

// ---------------------------------------------------------------------------
// Quiet substitution
// ---------------------------------------------------------------------------

/** The per-medium "shape" field used for substitution similarity. */
function categoryOf(e: EffectDef): string {
  switch (e.medium) {
    case 'pyro':
      return e.category
    case 'drone':
      return e.formation
    case 'laser':
      return e.shape
    case 'panel':
      return e.pattern
    case 'fabrication':
      return e.kind
    case 'crowd':
      return e.pattern
    case 'beam':
      return e.program
  }
}

const sharesTag = (a: EffectDef, b: EffectDef): boolean => a.tags.some((t) => b.tags.includes(t))

/**
 * Default quiet-alternative lookup used by the SPL pass: for an effect id,
 * pick a same-medium catalog entry at least 10 dB quieter at the reference
 * distance, never a larger caliber (pyro). Ranking is deterministic:
 * 'low-noise'-tagged entries first, then category/tag-similar entries, then
 * lowest noiseDbAt15m, then lexicographic id. Returns undefined when nothing
 * qualifies (the solver then drops the cue).
 */
export function defaultQuietSubstitute(catalog: Catalog): (effectId: string) => string | undefined {
  return (effectId) => {
    const effect = catalog.find(effectId)
    if (!effect) return undefined
    const candidates = catalog.effects.filter((e) => {
      if (e.medium !== effect.medium || e.id === effect.id) return false
      if (e.noiseDbAt15m > effect.noiseDbAt15m - 10) return false
      if (e.medium === 'pyro' && effect.medium === 'pyro' && e.caliberMm > effect.caliberMm) {
        return false
      }
      return true
    })
    if (candidates.length === 0) return undefined
    const score = (e: EffectDef): [number, number, number, string] => [
      e.tags.includes('low-noise') ? 0 : 1,
      categoryOf(e) === categoryOf(effect) || sharesTag(e, effect) ? 0 : 1,
      e.noiseDbAt15m,
      e.id,
    ]
    candidates.sort((a, b) => {
      const sa = score(a)
      const sb = score(b)
      return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2] || cmpStr(sa[3], sb[3])
    })
    return candidates[0]!.id
  }
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/** Internal working cue: CompiledCue plus solver-only priority. */
interface WorkCue extends CompiledCue {
  priority: number
}

/** Deterministic phase-2 processing order: priority desc, targetSec, id. */
const solverOrder = (a: WorkCue, b: WorkCue): number =>
  b.priority - a.priority || a.targetSec - b.targetSec || cmpStr(a.id, b.id)

function nearestBeatIndex(beats: readonly number[], t: Seconds): number {
  const n = beats.length
  const i = lowerIndex(beats, t)
  if (i < 0) return 0
  if (i >= n - 1) return n - 1
  return t - beats[i]! <= beats[i + 1]! - t ? i : i + 1
}

/**
 * `t` shifted by `k` whole beats of the timeline's beat grid, preserving any
 * off-grid offset; undefined when the grid is too short or the step leaves it.
 */
function stepByBeats(tl: MusicalTimeline, t: Seconds, k: number): Seconds | undefined {
  const beats = tl.beats
  if (beats.length < 2) return undefined
  const i = nearestBeatIndex(beats, t)
  const j = i + k
  if (j < 0 || j > beats.length - 1) return undefined
  return t + (beats[j]! - beats[i]!)
}

/** True when moving a landing from `a` to `b` crosses a 'phrase' annotation. */
function crossesPhrase(tl: MusicalTimeline, a: Seconds, b: Seconds): boolean {
  for (const p of annotationsOfKind(tl, 'phrase')) {
    if ((p.time - a) * (p.time - b) < 0) return true
  }
  return false
}

/**
 * Solve a show against a catalog: resolve anchors, derive anticipations,
 * quantize/shift/substitute per {@link SolveOptions}. Pure and deterministic:
 * identical inputs produce identical (deep-equal) outputs. Returned cues are
 * sorted by (fireSec, trackId, id).
 */
export function solve(show: Show, catalog: Catalog, opts: SolveOptions = {}): SolveResult {
  const tl = show.music
  const quantize = opts.quantize ?? 'none'
  const maxShiftBeats = opts.maxShiftBeats ?? 2
  const preRoll = show.preRollSec ?? 0
  const diagnostics: Diagnostic[] = []
  const cues: WorkCue[] = []

  // ---- PHASE 1: anchors + anticipation --------------------------------------
  const droneState = new Map<string, { formation: Formation; targetEnd: Seconds }>()

  for (const track of show.tracks) {
    for (const cue of track.cues) {
      const effect = catalog.find(cue.effectId)
      if (!effect) {
        diagnostics.push({
          code: 'EFFECT_UNRESOLVED',
          severity: 'error',
          message: `cue '${cue.id}': effect '${cue.effectId}' is not in the catalog; cue excluded`,
          cueIds: [cue.id],
        })
        continue
      }
      const targetSec = resolveAnchor(cue.anchor, tl)
      if (targetSec === undefined) {
        diagnostics.push({
          code: 'ANCHOR_UNRESOLVED',
          severity: 'error',
          message:
            `cue '${cue.id}': anchor ${JSON.stringify(cue.anchor)} does not resolve ` +
            `against timeline '${tl.id}' (source ${tl.source}); cue excluded`,
          cueIds: [cue.id],
        })
        continue
      }

      let anticipationSec: Seconds
      let durationSec = effect.durationSec
      if (effect.medium === 'drone') {
        const padKey = cue.positionId ?? ''
        const state = droneState.get(padKey)
        const count = droneCountFor(effect, cue.params)
        const from = state?.formation ?? launchFormation(count)
        const prevEnd = state?.targetEnd ?? 0
        const seed = cueSeed(show.meta.seed, cue.id)
        const to = formationFromEffect(effect, cue.params, seed)
        const gap = targetSec - prevEnd
        const limits = fleetLimitsAt(show.site, cue.positionId)
        const plan = planMorph(from, to, Math.max(gap, 1), limits)
        anticipationSec = plan.minTransitionSec * DRONE_ANTICIPATION_MARGIN
        const holdSec = typeof cue.params?.['holdSec'] === 'number' ? cue.params['holdSec'] : 0
        durationSec = effect.durationSec + holdSec
        droneState.set(padKey, { formation: to, targetEnd: targetSec + durationSec })
      } else if (effect.medium === 'crowd') {
        // Broadcast commanded early so the p95 device lands ON the beat.
        anticipationSec = crowdLatencyFor(show.site, cue.positionId, effect.channel)
      } else if (effect.medium === 'beam') {
        // beamTargetAt reads a CompiledCue, so build a stand-in around the
        // resolved landing (mirrors the drone branch pre-building work data).
        const standIn: CompiledCue = {
          id: cue.id,
          trackId: track.id,
          medium: track.medium,
          effectId: cue.effectId,
          targetSec,
          fireSec: targetSec,
          anticipationSec: 0,
          durationSec,
          seed: cueSeed(show.meta.seed, cue.id),
        }
        if (cue.positionId !== undefined) standIn.positionId = cue.positionId
        if (cue.params !== undefined) standIn.params = cue.params
        anticipationSec = beamAnticipationSec(show.site, standIn, effect)
      } else {
        anticipationSec = catalog.anticipationSec(effect)
      }

      const work: WorkCue = {
        id: cue.id,
        trackId: track.id,
        medium: track.medium,
        effectId: cue.effectId,
        targetSec,
        fireSec: targetSec - anticipationSec,
        anticipationSec,
        durationSec,
        seed: cueSeed(show.meta.seed, cue.id),
        priority: cue.priority ?? 0,
      }
      if (cue.positionId !== undefined) work.positionId = cue.positionId
      if (cue.params !== undefined) work.params = cue.params
      cues.push(work)
    }
  }

  const setTarget = (c: WorkCue, t: Seconds): void => {
    c.targetSec = t
    c.fireSec = t - c.anticipationSec
  }

  /** Bounded ±beat shift used by the pin/overlap passes: first admissible of +1, −1, +2, −2. */
  const tryShift = (c: WorkCue): boolean => {
    for (const k of [1, -1, 2, -2]) {
      if (Math.abs(k) > maxShiftBeats) continue
      const cand = stepByBeats(tl, c.targetSec, k)
      if (cand === undefined) continue
      if (crossesPhrase(tl, c.targetSec, cand)) continue
      if (cand - c.anticipationSec < -preRoll - EPS) continue
      setTarget(c, cand)
      return true
    }
    return false
  }

  const byId = new Map<string, WorkCue>()
  for (const c of cues) byId.set(c.id, c)

  const getEffect = getEffectFrom(catalog)

  // ---- sourceCueId linkage (sourceTag program) --------------------------------
  // Checked right after phase 1, when both the beam cue and its referenced
  // source carry resolved landings. A reference that does not resolve to a
  // compiled drone/pyro cue is an error; disjoint active windows only warn —
  // the sim falls back to targetCellId (see acoustics beamTargetAt).
  for (const c of cues) {
    if (c.medium !== 'beam') continue
    const ref = c.params?.['sourceCueId']
    if (ref === undefined) continue
    const src = typeof ref === 'string' ? byId.get(ref) : undefined
    if (src === undefined || (src.medium !== 'drone' && src.medium !== 'pyro')) {
      diagnostics.push({
        code: 'BEAM_SOURCE_UNRESOLVED',
        severity: 'error',
        message:
          src === undefined
            ? `beam cue '${c.id}': sourceCueId '${String(ref)}' does not resolve to a compiled cue`
            : `beam cue '${c.id}': sourceCueId '${String(ref)}' is a ${src.medium} cue; ` +
              `source tagging follows drone or pyro cues only`,
        cueIds: [c.id],
        tSec: c.targetSec,
      })
      continue
    }
    const overlaps =
      src.targetSec < c.targetSec + c.durationSec - EPS &&
      c.targetSec < src.targetSec + src.durationSec - EPS
    if (!overlaps) {
      diagnostics.push({
        code: 'BEAM_SOURCE_NOT_CONCURRENT',
        severity: 'warning',
        message:
          `beam cue '${c.id}' active [${c.targetSec.toFixed(3)}, ` +
          `${(c.targetSec + c.durationSec).toFixed(3)})s does not overlap source cue ` +
          `'${src.id}' [${src.targetSec.toFixed(3)}, ` +
          `${(src.targetSec + src.durationSec).toFixed(3)})s; the sim falls back to targetCellId`,
        cueIds: [c.id, src.id],
        tSec: c.targetSec,
      })
    }
  }

  // ---- PHASE 2a: quantize landings ------------------------------------------
  if (quantize !== 'none') {
    for (const c of [...cues].sort(solverOrder)) {
      setTarget(c, quantizeTime(tl.beats, tl.downbeats, c.targetSec, quantize))
    }
  }

  // ---- PHASE 2b: negative fire ----------------------------------------------
  // Drone cues are exempt from the error when a pad exists: the FINAL drone
  // pass clamps their departure to the transport start (squeezed windows
  // surface as 'sim/morph-window-short' warnings). The forward shift attempt
  // still runs — it genuinely widens the flight window when it succeeds.
  const hasDronePad = show.site.assets.some(
    (a) => a.kind === 'dronePad' && a.fleet !== undefined,
  )
  for (const c of [...cues].sort(solverOrder)) {
    if (c.fireSec >= -preRoll - EPS) continue
    let fixed = false
    for (let k = 1; k <= maxShiftBeats; k++) {
      const cand = stepByBeats(tl, c.targetSec, k)
      if (cand === undefined) break
      if (crossesPhrase(tl, c.targetSec, cand)) break
      if (cand - c.anticipationSec >= -preRoll - EPS) {
        setTarget(c, cand)
        fixed = true
        break
      }
    }
    if (!fixed && c.medium === 'drone' && hasDronePad) continue
    if (!fixed) {
      const earliest = c.anticipationSec - preRoll
      diagnostics.push({
        code: 'NEGATIVE_FIRE',
        severity: 'error',
        message:
          `cue '${c.id}' fires at ${c.fireSec.toFixed(3)}s, before the transport start ` +
          `${(-preRoll).toFixed(3)}s; earliest feasible landing is t=${earliest.toFixed(3)}s ` +
          `(anticipation ${c.anticipationSec.toFixed(3)}s)`,
        cueIds: [c.id],
        tSec: c.fireSec,
      })
    }
  }

  // ---- PHASE 2c: rack pin capacity ------------------------------------------
  let pinDiags = pinCapacity(cues, show.site.assets)
  if (pinDiags.length > 0 && maxShiftBeats > 0) {
    for (const d of pinDiags) {
      const offenders = (d.cueIds ?? [])
        .map((id) => byId.get(id))
        .filter((c): c is WorkCue => c !== undefined)
        .sort((a, b) => a.priority - b.priority || cmpStr(a.id, b.id))
      const victim = offenders[0]
      if (victim) tryShift(victim)
    }
    pinDiags = pinCapacity(cues, show.site.assets)
  }
  diagnostics.push(...pinDiags)

  // ---- PHASE 2d: drone pad overlap ------------------------------------------
  let overlapDiags = droneOverlap(cues)
  if (overlapDiags.length > 0 && maxShiftBeats > 0) {
    for (const d of overlapDiags) {
      const pair = (d.cueIds ?? [])
        .map((id) => byId.get(id))
        .filter((c): c is WorkCue => c !== undefined)
        .sort((a, b) => a.priority - b.priority || b.targetSec - a.targetSec || cmpStr(b.id, a.id))
      const victim = pair[0]
      if (victim) tryShift(victim)
    }
    overlapDiags = droneOverlap(cues)
  }
  diagnostics.push(...overlapDiags)

  // ---- PHASE 2d2: crowd mast bandwidth ----------------------------------------
  let crowdDiags = crowdBandwidth(cues, show.site.assets, getEffect)
  if (crowdDiags.length > 0 && maxShiftBeats > 0) {
    for (const d of crowdDiags) {
      const offenders = (d.cueIds ?? [])
        .map((id) => byId.get(id))
        .filter((c): c is WorkCue => c !== undefined)
        .sort((a, b) => a.priority - b.priority || cmpStr(a.id, b.id))
      const victim = offenders[0]
      if (victim) tryShift(victim)
    }
    crowdDiags = crowdBandwidth(cues, show.site.assets, getEffect)
  }
  diagnostics.push(...crowdDiags)

  // ---- PHASE 2d3: beam slew -----------------------------------------------------
  let slewDiags = beamSlew(cues, show.site, getEffect, show.music.beats)
  if (slewDiags.length > 0 && maxShiftBeats > 0) {
    for (const d of slewDiags) {
      const pair = (d.cueIds ?? [])
        .map((id) => byId.get(id))
        .filter((c): c is WorkCue => c !== undefined)
        .sort((a, b) => a.priority - b.priority || b.targetSec - a.targetSec || cmpStr(b.id, a.id))
      const victim = pair[0]
      if (victim) tryShift(victim)
    }
    slewDiags = beamSlew(cues, show.site, getEffect, show.music.beats)
  }
  diagnostics.push(...slewDiags)

  // ---- PHASE 2e: SPL budget ---------------------------------------------------
  const dropped = new Set<string>()
  if (show.noiseBudget !== undefined) {
    const budget = show.noiseBudget.maxSplDb
    const substitute = opts.substitute ?? defaultQuietSubstitute(catalog)
    const active = (): WorkCue[] => cues.filter((c) => !dropped.has(c.id))
    const interim = () => ({
      show,
      cues: active()
        .slice()
        .sort(compiledCueOrder),
      diagnostics: [] as Diagnostic[],
    })
    const listeners = show.site.refListenerPos
    const levelAt = (c: WorkCue, listener: Vec2): number => {
      const effect = catalog.find(c.effectId)
      if (!effect) return -Infinity
      const distM = dist2(cueSourcePos(c, show.site), listener)
      return splAtDistance(effect.noiseDbAt15m, SPL_REF_DISTANCE_M, distM)
    }

    const applySubstitution = (c: WorkCue, newEffect: EffectDef): void => {
      c.effectId = newEffect.id
      if (newEffect.medium === 'drone') {
        // Keep the phase-1 anticipation (the morph chain is already laid);
        // only the display duration follows the new entry.
        const holdSec = typeof c.params?.['holdSec'] === 'number' ? c.params['holdSec'] : 0
        c.durationSec = newEffect.durationSec + holdSec
      } else {
        // Recompute the anticipation per medium exactly as phase 1 does —
        // catalog.anticipationSec is a documented 0-placeholder for beam and
        // crowd, and taking it here would collapse fireSec to targetSec and
        // break the keystone identity for the substituted cue.
        if (newEffect.medium === 'beam') {
          c.anticipationSec = beamAnticipationSec(show.site, c, newEffect)
        } else if (newEffect.medium === 'crowd') {
          c.anticipationSec = crowdLatencyFor(show.site, c.positionId, newEffect.channel)
        } else {
          c.anticipationSec = catalog.anticipationSec(newEffect)
        }
        c.durationSec = newEffect.durationSec
        c.fireSec = c.targetSec - c.anticipationSec
      }
    }

    let report = quietReport(interim(), getEffect, budget)
    for (let round = 0; round < MAX_SPL_ROUNDS && !report.pass; round++) {
      const worst = listeners[report.worstListenerIndex] ?? listeners[0] ?? v2(0, 0)
      let changed = false
      for (const violation of report.violations) {
        // The report is stale within a round: an earlier substitution/drop
        // may already have resolved this window — re-check before targeting
        // (else we substitute/drop the loudest BYSTANDER of a fixed window).
        if (changed) {
          const snapshot = interim()
          let stillOver = false
          for (let t = violation.tStart; t < violation.tEnd - EPS && !stillOver; t += 0.1) {
            stillOver = splAtInstant(snapshot, getEffect, worst, t) > budget
          }
          if (!stillOver) continue
        }
        const contributors = violation.cueIds
          .map((id) => byId.get(id))
          .filter((c): c is WorkCue => c !== undefined && !dropped.has(c.id))
        if (contributors.length === 0) continue
        // Walk ascending priority, but only cues that are individually over
        // budget (substituting an inaudible bystander cannot fix a window);
        // when the violation is a pure summation, take the loudest.
        const loud = contributors
          .filter((c) => levelAt(c, worst) > budget)
          .sort((a, b) => a.priority - b.priority || a.targetSec - b.targetSec || cmpStr(a.id, b.id))
        const target =
          loud[0] ??
          [...contributors].sort(
            (a, b) => levelAt(b, worst) - levelAt(a, worst) || cmpStr(a.id, b.id),
          )[0]!
        const subId = substitute(target.effectId)
        const subEffect = subId !== undefined ? catalog.find(subId) : undefined
        const currentEffect = catalog.find(target.effectId)
        if (
          subEffect !== undefined &&
          currentEffect !== undefined &&
          subEffect.medium === currentEffect.medium &&
          subEffect.id !== target.effectId
        ) {
          const old = target.effectId
          applySubstitution(target, subEffect)
          diagnostics.push({
            code: 'SPL_BUDGET',
            severity: 'warning',
            message:
              `cue '${target.id}': substituted effect '${old}' → '${subEffect.id}' to meet ` +
              `the ${budget} dB budget (window ${violation.tStart.toFixed(1)}–` +
              `${violation.tEnd.toFixed(1)}s peaked at ${violation.peakDb.toFixed(1)} dB)`,
            cueIds: [target.id],
            tSec: violation.tStart,
          })
        } else {
          dropped.add(target.id)
          diagnostics.push({
            code: 'SPL_BUDGET',
            severity: 'warning',
            message:
              `cue '${target.id}' ('${target.effectId}') dropped: no quieter substitute for ` +
              `the ${budget} dB budget (window ${violation.tStart.toFixed(1)}–` +
              `${violation.tEnd.toFixed(1)}s peaked at ${violation.peakDb.toFixed(1)} dB)`,
            cueIds: [target.id],
            tSec: violation.tStart,
          })
        }
        changed = true
      }
      if (!changed) break
      report = quietReport(interim(), getEffect, budget)
    }
    if (!report.pass) {
      diagnostics.push({
        code: 'SPL_BUDGET',
        severity: 'error',
        message:
          `noise budget ${budget} dB still exceeded after ${MAX_SPL_ROUNDS} substitution ` +
          `rounds: peak ${report.peakDb.toFixed(1)} dB at t=${report.peakTSec.toFixed(2)}s ` +
          `(listener ${report.worstListenerIndex})`,
        tSec: report.peakTSec,
      })
    }
  }

  // ---- PHASE 2f: re-verify hardware gates after the SPL pass -----------------
  // Substitution rewrites fireSec (new anticipation) and durationSec AFTER
  // phases 2c/2d/2d2/2d3 validated them, so a swap can silently create a
  // pin-capacity, pad-overlap, crowd-bandwidth, or beam-slew violation.
  // Detection only — a repair shift here could reopen the SPL budget;
  // anything new surfaces as an error diagnostic.
  {
    const surviving = cues.filter((c) => !dropped.has(c.id))
    const diagKey = (d: Diagnostic): string =>
      `${d.code}|${d.assetId ?? ''}|${d.tSec ?? ''}|${(d.cueIds ?? []).join(',')}`
    const seen = new Set(diagnostics.map(diagKey))
    for (const d of [
      ...pinCapacity(surviving, show.site.assets),
      ...droneOverlap(surviving),
      ...crowdBandwidth(surviving, show.site.assets, getEffect),
      ...beamSlew(surviving, show.site, getEffect, show.music.beats),
    ]) {
      if (!seen.has(diagKey(d))) diagnostics.push(d)
    }
  }

  // ---- FINAL drone timing: adopt the sim's own pad-timeline departures -------
  // Phase 1's per-cue estimate only feeds the shift/overlap decisions above.
  // The authoritative departure comes from sim/derivePadTimelines — the exact
  // derivation the engine flies — so a compiled drone cue's fireSec IS its
  // flight-plan start. derivePadTimelines clamps departures to the transport
  // start, so drone cues can never be NEGATIVE_FIRE; squeezed windows surface
  // as 'sim/morph-window-short' warnings instead.
  {
    const surviving = cues.filter((c) => !dropped.has(c.id))
    if (surviving.some((c) => c.medium === 'drone')) {
      const provisional: CompiledShow = {
        show,
        cues: surviving.slice().sort(compiledCueOrder),
        diagnostics: [],
      }
      for (const padTl of derivePadTimelines(provisional, getEffect)) {
        for (const seg of padTl.segments) {
          if (seg.cueId === undefined) continue
          const c = byId.get(seg.cueId)
          if (c === undefined || dropped.has(c.id)) continue
          c.anticipationSec = c.targetSec - seg.startSec
          c.fireSec = seg.startSec
        }
        diagnostics.push(...padTl.diagnostics)
      }
    }
  }

  // ---- RAPID_REFIRE warnings --------------------------------------------------
  const finalCues = cues.filter((c) => !dropped.has(c.id))
  const byPos = new Map<string, WorkCue[]>()
  for (const c of finalCues) {
    if (c.medium !== 'pyro' || c.positionId === undefined) continue
    const list = byPos.get(c.positionId)
    if (list) list.push(c)
    else byPos.set(c.positionId, [c])
  }
  for (const posId of [...byPos.keys()].sort(cmpStr)) {
    const list = byPos.get(posId)!
    list.sort((a, b) => a.fireSec - b.fireSec || cmpStr(a.id, b.id))
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!
      const next = list[i]!
      const delta = next.fireSec - prev.fireSec
      if (delta < RAPID_REFIRE_SEC) {
        diagnostics.push({
          code: 'RAPID_REFIRE',
          severity: 'warning',
          message:
            `position '${posId}': cues '${prev.id}' and '${next.id}' fire ` +
            `${delta.toFixed(3)}s apart (< ${RAPID_REFIRE_SEC}s)`,
          cueIds: [prev.id, next.id],
          assetId: posId,
          tSec: next.fireSec,
        })
      }
    }
  }

  // ---- output: strip solver-internal priority, contract sort -------------------
  const out: CompiledCue[] = finalCues
    .map((c) => {
      const cue: CompiledCue = {
        id: c.id,
        trackId: c.trackId,
        medium: c.medium,
        effectId: c.effectId,
        targetSec: c.targetSec,
        fireSec: c.fireSec,
        anticipationSec: c.anticipationSec,
        durationSec: c.durationSec,
        seed: c.seed,
      }
      if (c.positionId !== undefined) cue.positionId = c.positionId
      if (c.params !== undefined) cue.params = c.params
      return cue
    })
    .sort(compiledCueOrder)

  return { cues: out, diagnostics }
}
