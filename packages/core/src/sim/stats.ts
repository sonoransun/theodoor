/**
 * sim/stats.ts — headless simulation runs and aggregate statistics.
 *
 * runHeadless drives a SimEngine straight to the end of the show (or an
 * explicit toSec) with advanceTo — no transport, no events — and returns the
 * engine plus its aggregate SimStats. Deterministic: identical inputs yield
 * byte-identical stats.
 */

import type { CompiledShow, Seconds } from '../contracts.js'
import type { EffectLookup } from '../acoustics/index.js'
import { showDurationSec } from '../transport/index.js'
import { SimEngine } from './engine.js'

/** Aggregate statistics for one simulated run. */
export interface SimStats {
  /** Peak concurrent star count across all steps. */
  peakStars: number
  /** Peak concurrent drone count across all steps. */
  peakDrones: number
  /** Closest pairwise drone approach observed (Infinity = never near). */
  minSeparationM: number
  /** Mean over drone cues of mean |pos − target| at each cue's targetSec (m). */
  landingAccuracyM: number
  /** Peak count of crowd cells with any rgb/white channel above CROWD_LIT_EPS. */
  peakCrowdCellsLit: number
  /** Peak concurrent active beam cues across all steps. */
  peakActiveBeams: number
  /** Peak concurrent water columns (engaged nozzles with water up). */
  peakActiveJets: number
  /** Peak concurrent lit searchlight heads. */
  peakActiveLights: number
  /**
   * Max late arrival of searchlight heads past their landing, s — 0 when every
   * slew fit its window (the keystone held); > 0 when a squeezed chain made
   * heads arrive late ('sim/light-slew-short').
   */
  lightArrivalLagSecMax: number
  /**
   * Max over fountain cues of |fireSec + (valve latency + ballistic rise) −
   * targetSec| (s) — ≈ 0 when the solver anticipated the crest; 0 without
   * fountain cues.
   */
  fountainCrestErrorSecMax: number
  /**
   * Max over beam cues of |fireSec + timeOfFlight − targetSec| (s) — ≈ 0 when
   * the solver anticipated the acoustic time-of-flight; 0 without beam cues.
   */
  beamLandingErrorSecMax: number
  /** Peak instantaneous SPL per SitePlan.refListenerPos entry (dB). */
  splPeakByListener: readonly number[]
  /** Total warnings (plan-time + runtime). */
  warningCount: number
  /** Steps simulated (including step 0). */
  steps: number
}

export interface RunHeadlessOptions {
  /** Simulation rate; default SIM_STEP_HZ (120). */
  stepHz?: number
  /** Simulate up to this show time; default = full show duration. */
  toSec?: Seconds
  /** Effect lookup override (see SimEngineOptions.getEffect). */
  getEffect?: EffectLookup
}

/** Simulate the whole show headlessly and collect aggregate stats. */
export function runHeadless(
  compiled: CompiledShow,
  opts: RunHeadlessOptions = {},
): { stats: SimStats; engine: SimEngine } {
  const engine = new SimEngine(compiled, {
    ...(opts.stepHz !== undefined ? { stepHz: opts.stepHz } : {}),
    ...(opts.getEffect !== undefined ? { getEffect: opts.getEffect } : {}),
  })
  engine.advanceTo(opts.toSec ?? showDurationSec(compiled))
  return { stats: engine.stats(), engine }
}
