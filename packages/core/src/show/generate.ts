/**
 * show/generate.ts — beat-locked auto-show from an analyzed (or authored)
 * MusicalTimeline. Layers:
 *   - comets / small shells on downbeats, scaled by the energy curve
 *     (downbeats with rms < ENERGY_FLOOR are skipped);
 *   - a laser sweep every 8 beats, alternating towers;
 *   - a panel wash every 8 downbeats, color keyed to energy;
 *   - 'hit' annotations → accent shells (panel strobes instead when a noise
 *     budget is set);
 *   - the strongest climax → a 12 s barrage (quiet variant: drone bloom over
 *     a comet curtain instead of large calibers).
 * When the timeline has no beat grid (analysis tempoConfidence 0), the
 * downbeat/laser layers fall back to energy-peak-timed comets on 'sec'
 * anchors, so silence-of-tempo degrades gracefully instead of failing.
 *
 * maxSplDb flows into show.noiseBudget (the solver's substitution machinery
 * enforces it); the generator ALSO pre-filters its pyro pools to effects that
 * individually fit the budget at the nearest listener, so budgeted builds
 * stay clean instead of leaning on substitutions for every cue.
 */

import type {
  CompiledShow,
  EffectDef,
  MusicalTimeline,
  PositionedAsset,
  PyroEffect,
  Seconds,
  Show,
  SitePlan,
} from '../contracts.js'
import { SPL_REF_DISTANCE_M } from '../contracts.js'
import type { Catalog } from '../catalog/index.js'
import { starterCatalog } from '../catalog/index.js'
import { lakesidePark } from '../site/index.js'
import { splAtDistance } from '../acoustics/index.js'
import { dist2 } from '../math/index.js'
import { annotationsOfKind, climaxOf, energyAt } from '../music/index.js'
import { musicRefs, showBuilder } from './builder.js'

export interface GenerateOptions {
  /** Peak SPL budget → show.noiseBudget + quiet effect selection. */
  maxSplDb?: number
  site?: SitePlan
  catalog?: Catalog
  seed?: number
  title?: string
}

export interface GeneratedShow {
  show: Show
  compiled: CompiledShow
}

/** Downbeats quieter than this rms get no cue. */
export const ENERGY_FLOOR = 0.2
/** Pre-roll of generated shows (covers the largest starter rise time). */
export const GENERATED_PREROLL_SEC = 5
/** Barrage window length before the climax. */
export const GENERATED_BARRAGE_SEC = 12

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Local maxima of the energy rms curve, at least minGapSec apart. */
function energyPeaks(tl: MusicalTimeline, minRms: number, minGapSec: Seconds): Seconds[] {
  const e = tl.energy
  const peaks: Seconds[] = []
  for (let i = 1; i < e.length - 1; i++) {
    const r = e[i]!.rms
    if (r < minRms) continue
    if (r > e[i - 1]!.rms && r >= e[i + 1]!.rms) {
      const t = e[i]!.time
      if (peaks.length === 0 || t - peaks[peaks.length - 1]! >= minGapSec) peaks.push(t)
    }
  }
  return peaks
}

/** Generate a complete show from a musical timeline. See the module doc. */
export function generateShowFromAnalysis(
  tl: MusicalTimeline,
  opts: GenerateOptions = {},
): GeneratedShow {
  const site = opts.site ?? lakesidePark()
  const catalog = opts.catalog ?? starterCatalog()
  const seed = opts.seed ?? 1
  const budget = opts.maxSplDb

  const racks: PositionedAsset[] = site.assets.filter((a) => a.kind === 'mortarRack').sort(byId)
  const pads: PositionedAsset[] = site.assets.filter((a) => a.kind === 'dronePad').sort(byId)
  const towers: PositionedAsset[] = site.assets.filter((a) => a.kind === 'laserTower').sort(byId)
  const panels: PositionedAsset[] = site.assets.filter((a) => a.kind === 'panel').sort(byId)

  // Nearest (rack, listener) distance — the loudest place a shell can be heard.
  let minRackListenerM = Infinity
  for (const r of racks) {
    for (const l of site.refListenerPos) {
      const d = dist2(r.pos, l)
      if (d < minRackListenerM) minRackListenerM = d
    }
  }

  /** Pyro entry fits the budget on its own at the nearest listener. */
  const fitsBudget = (e: EffectDef): boolean => {
    if (budget === undefined) return true
    if (!Number.isFinite(minRackListenerM)) return true
    return splAtDistance(e.noiseDbAt15m, SPL_REF_DISTANCE_M, minRackListenerM) <= budget
  }

  const pyro = catalog.effects.filter(
    (e): e is PyroEffect => e.medium === 'pyro' && fitsBudget(e),
  )
  const byCaliber = (a: PyroEffect, b: PyroEffect): number =>
    a.caliberMm - b.caliberMm || byId(a, b)
  const comets = pyro.filter((e) => e.category === 'comet').sort(byCaliber)
  const smallShells = pyro
    .filter((e) => e.category !== 'salute' && e.category !== 'comet' && e.caliberMm <= 100)
    .sort(byCaliber)
  const accents = pyro
    .filter((e) => e.category !== 'salute' && e.caliberMm >= 100)
    .sort((a, b) => b.caliberMm - a.caliberMm || byId(a, b))
  const barragePool = pyro
    .filter((e) => e.category !== 'salute')
    .sort(byCaliber)
    .slice(-4)
  const ladder = [...comets, ...smallShells]

  const b = showBuilder({
    id: `generated-${tl.id}`,
    title: opts.title ?? `Generated: ${tl.title}`,
    seed,
    site,
    catalog,
  })
    .music(tl)
    .preRoll(GENERATED_PREROLL_SEC)
  if (budget !== undefined) b.noiseBudget(budget)
  const m = musicRefs(tl)

  const hasBeats = tl.beats.length > 0 && tl.tempoConfidence > 0

  // ---- rhythm layer: downbeat shells / energy-peak comets --------------------
  if (racks.length > 0 && ladder.length > 0) {
    if (hasBeats) {
      tl.downbeats.forEach((t, i) => {
        const e = energyAt(tl, t).rms
        if (e < ENERGY_FLOOR) return
        const idx = Math.min(
          ladder.length - 1,
          Math.floor(((e - ENERGY_FLOOR) / (1 - ENERGY_FLOOR)) * ladder.length),
        )
        b.pyro.fire({
          effect: ladder[idx]!.id,
          position: racks[i % racks.length]!.id,
          land: m.time(t),
        })
      })
    } else {
      // No beat grid: comets on energy peaks instead.
      const pool = comets.length > 0 ? comets : ladder
      energyPeaks(tl, ENERGY_FLOOR, 2).forEach((t, i) => {
        b.pyro.fire({
          effect: pool[i % pool.length]!.id,
          position: racks[i % racks.length]!.id,
          land: m.time(t),
        })
      })
    }
  }

  // ---- laser layer: a sweep every 8 beats -------------------------------------
  if (towers.length > 0 && hasBeats) {
    const laserEffect =
      catalog.effects.find((e) => e.medium === 'laser' && e.shape === 'sweep') ??
      catalog.effects.find((e) => e.medium === 'laser')
    if (laserEffect) {
      for (let k = 0, n = 0; k < tl.beats.length; k += 8, n++) {
        b.lasers.pattern({
          effect: laserEffect.id,
          position: towers[n % towers.length]!.id,
          from: m.time(tl.beats[k]!),
          durBeats: 8,
        })
      }
    }
  }

  // ---- panel layer: energy-keyed wash every 8 downbeats -----------------------
  if (panels.length > 0) {
    const washEffect =
      catalog.effects.find((e) => e.medium === 'panel' && e.pattern === 'gradientWipe') ??
      catalog.effects.find((e) => e.medium === 'panel' && e.pattern === 'solid')
    if (washEffect) {
      const washTimes: Seconds[] = hasBeats
        ? tl.downbeats.filter((_, i) => i % 8 === 0)
        : tl.energy.length > 0
          ? [tl.energy[0]!.time]
          : []
      washTimes.forEach((t, n) => {
        const e = energyAt(tl, t).rms
        b.panels.pattern({
          effect: washEffect.id,
          position: panels[n % panels.length]!.id,
          from: m.time(t),
          rgb: [0.2 + 0.8 * e, 0.25, 1 - 0.8 * e],
        })
      })
    }
  }

  // ---- hits: accent shells, or panel strobes under a budget -------------------
  const hits = annotationsOfKind(tl, 'hit')
  if (hits.length > 0) {
    const strobe = catalog.effects.find((e) => e.medium === 'panel' && e.pattern === 'strobe')
    hits.forEach((h, i) => {
      if (budget === undefined && accents.length > 0 && racks.length > 0) {
        b.pyro.fire({
          effect: accents[i % accents.length]!.id,
          position: racks[(i * 3) % racks.length]!.id,
          land: m.time(h.time),
        })
      } else if (strobe && panels.length > 0) {
        b.panels.pattern({
          effect: strobe.id,
          position: panels[i % panels.length]!.id,
          from: m.time(h.time),
          rgb: [1, 1, 1],
        })
      }
    })
  }

  // ---- climax: barrage (standard) or drone bloom + comet curtain (quiet) ------
  const climax = climaxOf(tl)
  if (climax && racks.length > 0) {
    const climaxes = annotationsOfKind(tl, 'climax')
    const peakIndex = climaxes.indexOf(climax)
    const peak = m.climax(peakIndex >= 0 ? peakIndex : 0)
    if (budget === undefined && barragePool.length > 0) {
      b.pyro.barrage({
        window: { peak, windowSec: GENERATED_BARRAGE_SEC },
        effectPool: barragePool.map((e) => e.id),
        positions: racks.map((r) => r.id),
        startRateHz: 0.6,
        endRateHz: 3,
        idPrefix: 'finale',
      })
    } else {
      // Quiet finale: drone bloom over a comet curtain.
      const bloom = catalog.effects.find((e) => e.medium === 'drone' && e.formation === 'bloom')
      if (bloom && pads.length > 0) {
        b.drones.formation({
          effect: bloom.id,
          position: pads[0]!.id,
          by: peak,
          holdSec: 4,
          params: { count: 80, scaleM: 24 },
        })
      }
      if (comets.length > 0) {
        const t0 = Math.max(0, climax.time - GENERATED_BARRAGE_SEC)
        let n = 0
        for (let t = t0; t <= climax.time + 1e-9; t += 1.5, n++) {
          b.pyro.fire({
            effect: comets[n % comets.length]!.id,
            position: racks[n % racks.length]!.id,
            land: m.time(t),
            id: `curtain-${String(n).padStart(3, '0')}`,
          })
        }
      }
    }
  }

  return b.build()
}
