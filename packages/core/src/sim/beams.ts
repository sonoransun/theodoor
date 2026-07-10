/**
 * sim/beams.ts — per-step steering states for the directional-audio arrays.
 *
 * All aim geometry is owned by acoustics/beams.ts; this module only windows
 * cues by time and packs BeamState objects for the snapshot. States are pure
 * functions of (cues, t, site, opts), so seek and chunked advance are
 * trivially consistent.
 *
 * THE KEYSTONE, AUDIBLY: the solver fires a beam cue one acoustic
 * time-of-flight early (fireSec = targetSec − slant/c), so `landed` — the
 * wavefront reaching the aim — flips exactly at targetSec, the musical
 * moment. beamLandingErrorSecMax() checks that identity once per show.
 */

import type {
  BeamEffect,
  BeamState,
  CompiledCue,
  CompiledShow,
  PositionedAsset,
  Seconds,
  SitePlan,
} from '../contracts.js'
import type { EffectLookup } from '../acoustics/spl.js'
import {
  beamAimAt,
  beamFootprintAt,
  beamLandingTofSec,
  beamSourceAsset,
  beamTargetAt,
  type BeamTargetOpts,
  type SourceGroundResolver,
} from '../acoustics/beams.js'

/** One beam cue prepared for per-step evaluation. */
export interface BeamCueSim {
  cueIdx: number
  cue: CompiledCue
  effect: BeamEffect
  /** The steering asset (ground-level stand-in for dangling position ids). */
  asset: PositionedAsset
  /** Active window start: fireSec (the wavefront is in flight from then). */
  startSec: Seconds
  /** Active window end: targetSec + durationSec. */
  endSec: Seconds
}

/** Collect beam cues with their steering assets and active windows. */
export function buildBeamCues(compiled: CompiledShow, getEffect: EffectLookup): BeamCueSim[] {
  const out: BeamCueSim[] = []
  compiled.cues.forEach((cue, cueIdx) => {
    if (cue.medium !== 'beam') return
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'beam') return
    out.push({
      cueIdx,
      cue,
      effect,
      asset: beamSourceAsset(cue, compiled.show.site),
      startSec: cue.fireSec,
      endSec: cue.targetSec + cue.durationSec,
    })
  })
  return out
}

/** Per-step context for beam state resolution. */
export interface BeamStepOpts {
  /** Beat instants (MusicalTimeline.beats) for periodBeats programs. */
  beats?: readonly Seconds[]
  /**
   * Per-cue source ground track for sourceTag programs — build it with
   * acoustics/beams sourceGroundResolver so the sim, the steering exporter,
   * and the exposure gate all aim tagged beams at the same trajectory.
   * Applied PER CUE: a beam tagging a pyro shell aims at that shell's rack,
   * never at unrelated drones.
   */
  sourceGroundAt?: SourceGroundResolver
}

/**
 * BeamState for every cue active at tSec, in compiled order. An undefined
 * footprint (horizon escape / stand-in asset) packs as a degenerate ellipse
 * (a = b = 0 at the target) that inFootprint() rejects everywhere.
 */
export function beamStatesAt(
  cues: readonly BeamCueSim[],
  tSec: Seconds,
  site: SitePlan,
  opts: BeamStepOpts = {},
): BeamState[] {
  const states: BeamState[] = []
  for (const c of cues) {
    if (tSec < c.startSec || tSec >= c.endSec) continue
    const sourceGround =
      c.effect.program === 'sourceTag' ? opts.sourceGroundAt?.(c.cue, tSec) : undefined
    const targetOpts: BeamTargetOpts = {
      ...(opts.beats ? { beats: opts.beats } : {}),
      ...(sourceGround ? { sourceGround } : {}),
    }
    const target = beamTargetAt(c.cue, c.effect, site, tSec, targetOpts)
    const aim = beamAimAt(c.asset, target)
    const footprint = beamFootprintAt(c.asset, c.effect, target) ?? {
      cx: target.x,
      cy: target.y,
      a: 0,
      b: 0,
      azimuthDeg: aim.azimuthDeg,
    }
    const params = c.cue.params
    const gainDb = typeof params?.gainDb === 'number' ? params.gainDb : 0
    const pairId = typeof params?.pairId === 'string' ? params.pairId : undefined
    const role = params?.role === 'L' || params?.role === 'R' ? params.role : undefined
    const extraDelayMs = typeof params?.extraDelayMs === 'number' ? params.extraDelayMs : undefined
    states.push({
      cueIdx: c.cueIdx,
      assetId: c.asset.id,
      apex: { x: c.asset.pos.x, y: c.asset.pos.y, z: c.asset.elevationM },
      target,
      halfAngleDeg: c.effect.beamWidthDeg / 2,
      footprint,
      audibleDbAtRef: c.effect.noiseDbAt15m + gainDb,
      carrierDbAtRef: c.effect.maxCarrierDbAtFocus,
      ...(pairId !== undefined ? { pairId } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(extraDelayMs !== undefined ? { extraDelayMs } : {}),
      landed: tSec >= c.cue.targetSec,
    })
  }
  return states
}

/**
 * Max over beam cues of |fireSec + timeOfFlight(landing aim) − targetSec| —
 * ≈ 0 when the solver anticipated the acoustic time-of-flight correctly.
 * Delegates to the SAME single-owner landing ToF the solver used
 * (acoustics/beams beamLandingTofSec), so cells:'all' strikes — whose lead
 * is the farthest cell's ToF, not the centroid's — cross-check to ~0 too.
 * Cheap; computed once per show at engine construction.
 */
export function beamLandingErrorSecMax(
  cues: readonly BeamCueSim[],
  site: SitePlan,
): number {
  let worst = 0
  for (const c of cues) {
    const err = Math.abs(
      c.cue.fireSec + beamLandingTofSec(c.cue, c.effect, site) - c.cue.targetSec,
    )
    if (err > worst) worst = err
  }
  return worst
}
