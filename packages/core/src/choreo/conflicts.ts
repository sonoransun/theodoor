/**
 * Pure conflict DETECTORS over compiled cues. These report Diagnostics only;
 * the solver (separate module) decides shifts and substitutions.
 */

import type {
  BeamArraySpec,
  CompiledCue,
  CrowdMastSpec,
  Diagnostic,
  EffectDef,
  PositionedAsset,
  RackSpec,
  Seconds,
  SitePlan,
} from '../contracts.js'
import {
  BEAM_SLEW_MARGIN,
  angularDistanceDeg,
  beamAimAt,
  beamTargetAt,
} from '../acoustics/beams.js'

/** A fired pin cannot re-fire for this long (seconds). */
export const PIN_REFIRE_GAP_SEC = 2

/** Fire instants closer than this are treated as simultaneous. */
const INSTANT_EPS = 1e-6

/** Detectors read an optional working priority (the solver's; default 0). */
type MaybePrioritizedCue = CompiledCue & { priority?: number }

const prioOf = (c: MaybePrioritizedCue): number => c.priority ?? 0

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const byFireThenId = (a: CompiledCue, b: CompiledCue): number =>
  a.fireSec - b.fireSec || cmpId(a.id, b.id)

function groupByPosition<C extends CompiledCue>(
  cues: readonly C[],
  medium: CompiledCue['medium'],
  accept: (positionId: string) => boolean,
): Map<string, C[]> {
  const byPos = new Map<string, C[]>()
  for (const c of cues) {
    if (c.medium !== medium || c.positionId === undefined) continue
    if (!accept(c.positionId)) continue
    const list = byPos.get(c.positionId)
    if (list) list.push(c)
    else byPos.set(c.positionId, [c])
  }
  for (const list of byPos.values()) list.sort(byFireThenId)
  return byPos
}

const sortedEntries = <T>(m: Map<string, T>): Array<[string, T]> =>
  [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

/**
 * Rack pin-capacity sweep over compiled PYRO cues grouped by positionId.
 * Two limits per rack (assets carrying a RackSpec):
 * 1. maxSimultaneousPins — cues sharing one fire instant;
 * 2. pinsPerModule with a PIN_REFIRE_GAP_SEC re-fire gap — a fired pin is
 *    busy for 2 s, so more than pinsPerModule fires inside any rolling 2 s
 *    window overflow the module.
 * Emits one 'PIN_CAPACITY' error per (rack, instant) listing the cue ids
 * beyond capacity at that instant. Cues at positions without a rack are
 * ignored (site validation owns that rule).
 */
export function pinCapacity(
  cues: readonly CompiledCue[],
  assets: readonly PositionedAsset[],
): Diagnostic[] {
  const racks = new Map<string, RackSpec>()
  for (const a of assets) if (a.rack) racks.set(a.id, a.rack)
  const byPos = groupByPosition(cues, 'pyro', (id) => racks.has(id))

  const diags: Diagnostic[] = []
  for (const [posId, list] of sortedEntries(byPos)) {
    const rack = racks.get(posId)!
    const overflowAt = new Map<Seconds, Set<string>>()
    const addOverflow = (t: Seconds, ids: readonly string[]): void => {
      if (ids.length === 0) return
      const set = overflowAt.get(t) ?? new Set<string>()
      for (const id of ids) set.add(id)
      overflowAt.set(t, set)
    }

    // 1) Simultaneity clusters vs maxSimultaneousPins.
    let k = 0
    while (k < list.length) {
      let e = k + 1
      while (e < list.length && Math.abs(list[e]!.fireSec - list[k]!.fireSec) < INSTANT_EPS) e++
      const cluster = list.slice(k, e)
      if (cluster.length > rack.maxSimultaneousPins) {
        addOverflow(
          cluster[0]!.fireSec,
          cluster.slice(rack.maxSimultaneousPins).map((c) => c.id),
        )
      }
      k = e
    }

    // 2) Rolling re-fire window vs pinsPerModule.
    for (let i = 0; i < list.length; i++) {
      let busy = 0
      for (let j = 0; j <= i; j++) {
        if (list[i]!.fireSec - list[j]!.fireSec < PIN_REFIRE_GAP_SEC) busy++
      }
      if (busy > rack.pinsPerModule) addOverflow(list[i]!.fireSec, [list[i]!.id])
    }

    for (const [t, ids] of [...overflowAt.entries()].sort((a, b) => a[0] - b[0])) {
      const cueIds = [...ids].sort()
      diags.push({
        code: 'PIN_CAPACITY',
        severity: 'error',
        message:
          `rack ${posId}: pin capacity exceeded at t=${t.toFixed(3)}s ` +
          `(${cueIds.length} cue(s) over the limit of ` +
          `${rack.maxSimultaneousPins} simultaneous / ${rack.pinsPerModule} per ${PIN_REFIRE_GAP_SEC}s)`,
        cueIds,
        assetId: posId,
        tSec: t,
      })
    }
  }
  return diags
}

/**
 * DRONE cue interval-overlap detector: cues sharing a positionId (the pad /
 * fleet) occupy [fireSec, targetSec + durationSec] and must be disjoint.
 * Emits one 'DRONE_OVERLAP' error per overlapping pair (touching endpoints
 * do not overlap). Pure detector — the solver decides shifts.
 */
export function droneOverlap(cues: readonly CompiledCue[]): Diagnostic[] {
  const byPos = groupByPosition(cues, 'drone', () => true)
  const diags: Diagnostic[] = []
  for (const [posId, list] of sortedEntries(byPos)) {
    const active: CompiledCue[] = []
    for (const c of list) {
      for (let i = active.length - 1; i >= 0; i--) {
        const a = active[i]!
        if (a.targetSec + a.durationSec <= c.fireSec + INSTANT_EPS) active.splice(i, 1)
      }
      for (const a of active) {
        diags.push({
          code: 'DRONE_OVERLAP',
          severity: 'error',
          message:
            `drone pad ${posId}: cue ${c.id} starts at ${c.fireSec.toFixed(3)}s ` +
            `while cue ${a.id} is active until ${(a.targetSec + a.durationSec).toFixed(3)}s`,
          cueIds: [a.id, c.id],
          assetId: posId,
          tSec: c.fireSec,
        })
      }
      active.push(c)
    }
  }
  return diags
}

/**
 * Crowd-mast broadcast bandwidth sweep over compiled CROWD cues grouped by
 * positionId (the mast). A cue occupies [fireSec, targetSec + durationSec)
 * and consumes its effect's maskUpdateHz while active; the mast can address
 * framesPerSec mask frames per second in total. The summed rate only rises at
 * a window start, so sweeping the start endpoints visits every overload.
 * Emits one 'CROWD_BANDWIDTH' error per mast at the worst instant, listing
 * the over-cap cue ids lowest priority first (the ones a solver would shed:
 * highest-priority cues fill the cap, the rest overflow). Cues at positions
 * without a mast spec are ignored (site validation owns that rule).
 */
export function crowdBandwidth(
  cues: readonly MaybePrioritizedCue[],
  assets: readonly PositionedAsset[],
  getEffect: (id: string) => EffectDef | undefined,
): Diagnostic[] {
  const masts = new Map<string, CrowdMastSpec>()
  for (const a of assets) if (a.crowdMast) masts.set(a.id, a.crowdMast)
  const byPos = groupByPosition(cues, 'crowd', (id) => masts.has(id))

  const hzOf = (c: CompiledCue): number => {
    const e = getEffect(c.effectId)
    return e !== undefined && e.medium === 'crowd' ? e.maskUpdateHz : 0
  }

  const diags: Diagnostic[] = []
  for (const [posId, list] of sortedEntries(byPos)) {
    const cap = masts.get(posId)!.framesPerSec
    const endOf = (c: CompiledCue): Seconds => c.targetSec + c.durationSec
    const over = new Map<string, number>() // over-cap cue id → priority
    let worstT: Seconds = 0
    let worstHz = -Infinity

    for (const c of list) {
      const t = c.fireSec
      const active = list.filter(
        (a) => a.fireSec <= t + INSTANT_EPS && t < endOf(a) - INSTANT_EPS,
      )
      let sum = 0
      for (const a of active) sum += hzOf(a)
      if (sum <= cap + 1e-9) continue
      // Fill the cap by priority desc (ties: fire order), overflow the rest.
      const ranked = [...active].sort(
        (a, b) => prioOf(b) - prioOf(a) || a.fireSec - b.fireSec || cmpId(a.id, b.id),
      )
      let used = 0
      for (const a of ranked) {
        used += hzOf(a)
        if (used > cap + 1e-9) over.set(a.id, prioOf(a))
      }
      if (sum > worstHz) {
        worstHz = sum
        worstT = t
      }
    }

    if (over.size > 0) {
      const cueIds = [...over.entries()]
        .sort((a, b) => a[1] - b[1] || cmpId(a[0], b[0]))
        .map(([id]) => id)
      diags.push({
        code: 'CROWD_BANDWIDTH',
        severity: 'error',
        message:
          `crowd mast ${posId}: mask bandwidth exceeded at t=${worstT.toFixed(3)}s ` +
          `(${cueIds.length} cue(s) over the ${cap} frames/s cap; ${worstHz} Hz active)`,
        cueIds,
        assetId: posId,
        tSec: worstT,
      })
    }
  }
  return diags
}

/**
 * Beam steering-feasibility sweep over compiled BEAM cues grouped by
 * positionId (the array head), ordered by (targetSec, id). Between
 * consecutive cues the head must slew from the earlier cue's aim at its
 * window end to the later cue's aim at its targetSec, at steerRateDegPerSec
 * with BEAM_SLEW_MARGIN headroom, all inside the idle gap
 * fireSec(next) − (targetSec + durationSec)(prev). Emits one 'BEAM_SLEW'
 * error per infeasible pair. Cues on assets without a beamArray spec are
 * skipped (site validation owns that rule).
 *
 * `beats` (optional, MusicalTimeline.beats) puts periodBeats programs
 * (pingPong) on the show's real beat grid — the clock the sim and the
 * exported steering schedule aim with — so the previous cue's end-of-window
 * aim matches what the head actually points at. Absent, aims fall back to
 * the 1 s/beat clock (prior behavior).
 */
export function beamSlew(
  cues: readonly CompiledCue[],
  site: SitePlan,
  getEffect: (id: string) => EffectDef | undefined,
  beats?: readonly Seconds[],
): Diagnostic[] {
  const arrays = new Map<string, BeamArraySpec>()
  const assetById = new Map<string, PositionedAsset>()
  for (const a of site.assets) {
    assetById.set(a.id, a)
    if (a.beamArray) arrays.set(a.id, a.beamArray)
  }
  const byPos = groupByPosition(cues, 'beam', (id) => arrays.has(id))

  const diags: Diagnostic[] = []
  for (const [posId, list] of sortedEntries(byPos)) {
    const spec = arrays.get(posId)!
    if (!(spec.steerRateDegPerSec > 0)) continue // spec sanity is site validation's rule
    const asset = assetById.get(posId)!
    const ordered = [...list].sort((a, b) => a.targetSec - b.targetSec || cmpId(a.id, b.id))
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1]!
      const next = ordered[i]!
      const prevFx = getEffect(prev.effectId)
      const nextFx = getEffect(next.effectId)
      if (prevFx === undefined || prevFx.medium !== 'beam') continue
      if (nextFx === undefined || nextFx.medium !== 'beam') continue
      const prevEnd = prev.targetSec + prev.durationSec
      const aimOpts = beats ? { beats } : undefined
      const aimPrev = beamAimAt(asset, beamTargetAt(prev, prevFx, site, prevEnd, aimOpts))
      const aimNext = beamAimAt(asset, beamTargetAt(next, nextFx, site, next.targetSec, aimOpts))
      const needSec =
        (angularDistanceDeg(aimPrev, aimNext) / spec.steerRateDegPerSec) * BEAM_SLEW_MARGIN
      const gap = next.fireSec - prevEnd
      if (gap + INSTANT_EPS < needSec) {
        diags.push({
          code: 'BEAM_SLEW',
          severity: 'error',
          message:
            `beam array ${posId}: cue ${next.id} needs ${needSec.toFixed(3)}s to slew ` +
            `from cue ${prev.id}'s end aim but has ${gap.toFixed(3)}s`,
          cueIds: [prev.id, next.id],
          assetId: posId,
          tSec: next.fireSec,
        })
      }
    }
  }
  return diags
}
