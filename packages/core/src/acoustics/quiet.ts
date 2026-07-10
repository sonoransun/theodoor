/**
 * acoustics/quiet — noise-budget check over a compiled show.
 *
 * v1 semantics (see contracts `NoiseBudget`): peak-only budget evaluated at
 * every SPL reference listener; the show passes iff the peak over ALL
 * listeners stays at or below the budget. Violations are reported for the
 * worst listener as contiguous time windows, each with a substitution hint
 * naming its loudest contributing cue (fed to the quiet-show generator).
 */

import type { CompiledCue, CompiledShow, Seconds, Vec2 } from '../contracts.js'
import { SPL_REF_DISTANCE_M } from '../contracts.js'
import { dist2 } from '../math/index.js'
import type { EffectLookup, SplSample } from './spl.js'
import {
  cueSourcePos,
  isImpulseEffect,
  splAtDistance,
  splTimeline,
} from './spl.js'

/** One contiguous stretch of samples exceeding the budget (worst listener). */
export interface QuietViolation {
  /** First violating sample time. */
  tStart: Seconds
  /** Exclusive end: last violating sample time + dtSec. */
  tEnd: Seconds
  /** Loudest summed level inside the window. */
  peakDb: number
  /** Every cue contributing anywhere in the window, first-heard order. */
  cueIds: readonly string[]
}

/** Suggestion for the quiet-show generator: which cue to swap out and why. */
export interface SubstitutionHint {
  cueId: string
  reason: string
}

export interface QuietReport {
  budgetDb: number
  /** True iff the peak over ALL listeners is ≤ budgetDb. */
  pass: boolean
  /** Peak summed SPL at the worst listener (-Infinity for a silent show). */
  peakDb: number
  peakTSec: Seconds
  /** Index into the evaluated listener list; -1 if it was empty. */
  worstListenerIndex: number
  violations: readonly QuietViolation[]
  /** One hint per violation window (deduped), impulse sources first. */
  substitutionHints: readonly SubstitutionHint[]
}

interface RawWindow {
  tStart: Seconds
  tEnd: Seconds
  peakDb: number
  peakSample: SplSample
  cueIds: string[]
}

/** Coalesce consecutive over-budget samples into contiguous windows. */
function coalesceViolations(
  timeline: readonly SplSample[],
  budgetDb: number,
  dtSec: Seconds,
): RawWindow[] {
  const windows: RawWindow[] = []
  let open: RawWindow | undefined
  let prevViolating = false
  for (const sample of timeline) {
    const violating = sample.dB > budgetDb
    if (violating) {
      if (!prevViolating || !open) {
        open = {
          tStart: sample.tSec,
          tEnd: sample.tSec + dtSec,
          peakDb: sample.dB,
          peakSample: sample,
          cueIds: [],
        }
        windows.push(open)
      }
      open.tEnd = sample.tSec + dtSec
      if (sample.dB > open.peakDb) {
        open.peakDb = sample.dB
        open.peakSample = sample
      }
      for (const id of sample.contributors) {
        if (!open.cueIds.includes(id)) open.cueIds.push(id)
      }
    }
    prevViolating = violating
  }
  return windows
}

/**
 * Evaluate the show against a peak noise budget.
 *
 * Sweeps an SPL timeline for each listener (default: the site's
 * `refListenerPos` points), takes the worst listener's peak for pass/fail,
 * and reports that listener's violations as contiguous windows with
 * substitution hints naming each window's loudest contributing cue.
 */
export function quietReport(
  compiled: CompiledShow,
  getEffect: EffectLookup,
  budgetDb: number,
  listeners: readonly Vec2[] = compiled.show.site.refListenerPos,
  dtSec: Seconds = 0.1,
): QuietReport {
  let worstListenerIndex = -1
  let peakDb = -Infinity
  let peakTSec: Seconds = 0
  let worstTimeline: SplSample[] = []
  let worstListener: Vec2 | undefined

  for (let i = 0; i < listeners.length; i++) {
    const listener = listeners[i]!
    const timeline = splTimeline(compiled, getEffect, listener, dtSec)
    let peak = -Infinity
    let peakT: Seconds = timeline.length > 0 ? timeline[0]!.tSec : 0
    for (const s of timeline) {
      if (s.dB > peak) {
        peak = s.dB
        peakT = s.tSec
      }
    }
    if (i === 0 || peak > peakDb) {
      worstListenerIndex = i
      peakDb = peak
      peakTSec = peakT
      worstTimeline = timeline
      worstListener = listener
    }
  }

  const raw =
    worstListener !== undefined
      ? coalesceViolations(worstTimeline, budgetDb, dtSec)
      : []

  // Per-cue level lookup at the worst listener (time-invariant per cue).
  const cueById = new Map<string, CompiledCue>()
  for (const cue of compiled.cues) cueById.set(cue.id, cue)
  const levelOf = (cueId: string): number => {
    const cue = cueById.get(cueId)
    if (!cue || worstListener === undefined) return -Infinity
    const effect = getEffect(cue.effectId)
    if (!effect) return -Infinity
    const distM = dist2(cueSourcePos(cue, compiled.show.site), worstListener)
    return splAtDistance(effect.noiseDbAt15m, SPL_REF_DISTANCE_M, distM)
  }
  const impulse = (cueId: string): boolean => {
    const cue = cueById.get(cueId)
    const effect = cue ? getEffect(cue.effectId) : undefined
    return effect !== undefined && isImpulseEffect(effect)
  }

  const hints: SubstitutionHint[] = []
  const hinted = new Set<string>()
  for (const w of raw) {
    // Loudest contributor at the window's peak sample; impulse wins ties.
    let loudest: string | undefined
    let loudestLevel = -Infinity
    for (const id of w.peakSample.contributors) {
      const level = levelOf(id)
      if (
        loudest === undefined ||
        level > loudestLevel ||
        (level === loudestLevel && impulse(id) && !impulse(loudest))
      ) {
        loudest = id
        loudestLevel = level
      }
    }
    if (loudest === undefined || hinted.has(loudest)) continue
    hinted.add(loudest)
    hints.push({
      cueId: loudest,
      reason:
        `loudest contributor (${loudestLevel.toFixed(1)} dB) in over-budget ` +
        `window ${w.tStart.toFixed(1)}–${w.tEnd.toFixed(1)} s ` +
        `(peak ${w.peakDb.toFixed(1)} dB vs budget ${budgetDb} dB); ` +
        `substitute a quieter effect`,
    })
  }
  // Impulse sources (salutes) first, otherwise stable.
  hints.sort((a, b) => Number(impulse(b.cueId)) - Number(impulse(a.cueId)))

  return {
    budgetDb,
    pass: peakDb <= budgetDb,
    peakDb,
    peakTSec,
    worstListenerIndex,
    violations: raw.map(({ tStart, tEnd, peakDb: p, cueIds }) => ({
      tStart,
      tEnd,
      peakDb: p,
      cueIds,
    })),
    substitutionHints: hints,
  }
}
