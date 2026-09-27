/**
 * catalog.ts — Catalog registry over readonly EffectDef[].
 *
 * SAFETY / CONTENT BOUNDARY: effects are opaque entries carrying performance
 * metadata only (timing, geometry, colors, noise). Nothing in this module
 * describes how any device is built or what it contains.
 *
 * The constructor validates the whole set eagerly and throws a single Error
 * listing every problem, so a bad starter entry fails loudly at module init
 * rather than mid-show.
 */

import type { EffectDef, Medium, Seconds } from '../contracts.js'
import { GRAVITY_MPS2 } from '../contracts.js'

/** Filter for {@link Catalog.query}. All fields optional; conditions AND. */
export interface CatalogQuery {
  medium?: Medium
  /** Keep effects with noiseDbAt15m <= this value. */
  maxNoiseDb?: number
  /** Keep effects whose tags include this tag. */
  tag?: string
}

/**
 * Fixed latency between commanding a fabrication set piece and its visible
 * start (ignition relay + first visible output).
 */
export const FABRICATION_ANTICIPATION_SEC: Seconds = 0.1

/**
 * How early a cue must be fired for its visual to land on the musical moment
 * (fireSec = targetSec − anticipationSec).
 *
 * - pyro:        riseTimeSec — ascent from fire to break. Mines carry a small
 *                riseTimeSec (ground effect, near-instant), so this stays
 *                uniform across all pyro categories.
 * - fabrication: FABRICATION_ANTICIPATION_SEC (0.1 s relay/visible latency).
 * - drone:       0 here. This is a placeholder only: the alignment solver
 *                derives the real drone anticipation from the previous
 *                formation via planMorph().minTransitionSec, which depends on
 *                fleet kinematics and the actual formation pair — data a
 *                catalog entry cannot know.
 * - laser/panel: 0 — electronically instant.
 * - crowd:       0 here — placeholder like drone: the solver derives the real
 *                anticipation from the mast's p95 command latency for the
 *                effect's channel (site data a catalog entry cannot know).
 * - beam:        0 here — placeholder like drone: the solver derives the real
 *                anticipation from the acoustic time-of-flight between the
 *                array asset and the cue's target cell.
 * - fountain:    0 here — placeholder like drone: the solver derives the real
 *                anticipation from the bank's valve latency plus the column's
 *                ballistic rise {@link fountainRiseSec}(crest) (mist stretched,
 *                params.heightM honored) — sim/fountains fountainAnticipationSec
 *                is the single owner, so the catalog never disagrees with a
 *                compiled cue.
 * - searchlight: 0 here — placeholder like drone: the solver derives the real
 *                anticipation from the bank's head slew between consecutive
 *                figures (sim/lights deriveLightChains).
 */
export function anticipationSec(effect: EffectDef): Seconds {
  switch (effect.medium) {
    case 'pyro':
      return effect.riseTimeSec
    case 'fabrication':
      return FABRICATION_ANTICIPATION_SEC
    case 'drone':
    case 'laser':
    case 'panel':
    case 'crowd':
    case 'beam':
    case 'fountain':
    case 'searchlight':
      return 0
  }
}

/** Ballistic rise time of a water column to crest height h: sqrt(2h / g). */
export function fountainRiseSec(heightM: number): Seconds {
  return Math.sqrt((2 * Math.max(0, heightM)) / GRAVITY_MPS2)
}

/** Collect human-readable range violations for one effect definition. */
function defProblems(def: EffectDef): string[] {
  const p: string[] = []
  const at = `effect '${def.id}' (${def.medium})`

  if (!(def.noiseDbAt15m >= 40 && def.noiseDbAt15m <= 160)) {
    p.push(`${at}: noiseDbAt15m must be in [40, 160], got ${def.noiseDbAt15m}`)
  }

  switch (def.medium) {
    case 'pyro': {
      if (!(def.caliberMm > 0)) p.push(`${at}: caliberMm must be > 0, got ${def.caliberMm}`)
      if (!(def.riseTimeSec > 0)) p.push(`${at}: riseTimeSec must be > 0, got ${def.riseTimeSec}`)
      if (!(def.burstHeightM > 0)) p.push(`${at}: burstHeightM must be > 0, got ${def.burstHeightM}`)
      if (!(def.burstRadiusM > 0)) p.push(`${at}: burstRadiusM must be > 0, got ${def.burstRadiusM}`)
      const minDist = 0.84 * def.caliberMm
      if (!(def.minAudienceDistanceM >= minDist)) {
        p.push(
          `${at}: minAudienceDistanceM must be >= 0.84 * caliberMm ` +
            `(${minDist.toFixed(1)} m for ${def.caliberMm} mm), got ${def.minAudienceDistanceM}`,
        )
      }
      break
    }
    case 'drone': {
      if (!(def.minDrones <= def.maxDrones)) {
        p.push(`${at}: minDrones (${def.minDrones}) must be <= maxDrones (${def.maxDrones})`)
      }
      break
    }
    case 'laser': {
      if (!(def.pointsPerFrame >= 8 && def.pointsPerFrame <= 4096)) {
        p.push(`${at}: pointsPerFrame must be in [8, 4096], got ${def.pointsPerFrame}`)
      }
      break
    }
    case 'panel': {
      if (!(def.fps >= 1 && def.fps <= 60)) {
        p.push(`${at}: fps must be in [1, 60], got ${def.fps}`)
      }
      break
    }
    case 'fabrication':
      break
    case 'crowd': {
      if (!(def.maskUpdateHz >= 1 && def.maskUpdateHz <= 30)) {
        p.push(`${at}: maskUpdateHz must be in [1, 30], got ${def.maskUpdateHz}`)
      }
      if (def.pattern !== 'hapticPulse' && def.colors.length === 0) {
        p.push(`${at}: visual crowd patterns need at least one color`)
      }
      break
    }
    case 'beam': {
      if (!(def.noiseDbAt15m <= 100)) {
        p.push(`${at}: beam audible level (noiseDbAt15m) must be <= 100, got ${def.noiseDbAt15m}`)
      }
      if (!(def.beamWidthDeg >= 1 && def.beamWidthDeg <= 20)) {
        p.push(`${at}: beamWidthDeg must be in [1, 20], got ${def.beamWidthDeg}`)
      }
      if (!(def.maxCarrierDbAtFocus <= 120)) {
        p.push(`${at}: maxCarrierDbAtFocus must be <= 120, got ${def.maxCarrierDbAtFocus}`)
      }
      break
    }
    case 'fountain': {
      if (!(def.heightM > 0 && def.heightM <= 120)) {
        p.push(`${at}: heightM must be in (0, 120], got ${def.heightM}`)
      }
      if (!(Number.isInteger(def.nozzles) && def.nozzles >= 0)) {
        p.push(`${at}: nozzles must be a non-negative integer, got ${def.nozzles}`)
      }
      if (!(def.widthM > 0)) p.push(`${at}: widthM must be > 0, got ${def.widthM}`)
      if (def.colors.length === 0) p.push(`${at}: fountain jets need at least one lighting color`)
      if (!(def.noiseDbAt15m <= 90)) {
        p.push(`${at}: fountain water noise (noiseDbAt15m) must be <= 90, got ${def.noiseDbAt15m}`)
      }
      break
    }
    case 'searchlight': {
      if (!(def.beamWidthDeg >= 0.5 && def.beamWidthDeg <= 8)) {
        p.push(`${at}: beamWidthDeg must be in [0.5, 8], got ${def.beamWidthDeg}`)
      }
      if (!(def.reachM >= 50 && def.reachM <= 2000)) {
        p.push(`${at}: reachM must be in [50, 2000], got ${def.reachM}`)
      }
      if (def.colors.length === 0) p.push(`${at}: searchlight figures need at least one color`)
      if (!(def.noiseDbAt15m <= 70)) {
        p.push(`${at}: searchlight fan noise (noiseDbAt15m) must be <= 70, got ${def.noiseDbAt15m}`)
      }
      break
    }
  }
  return p
}

/**
 * Immutable, validated effect registry.
 *
 * Construction throws on duplicate ids and on any per-medium range violation
 * (all problems reported in one Error message). Lookup is O(1) by id; query
 * preserves the definition order (deterministic).
 */
export class Catalog {
  readonly effects: readonly EffectDef[]
  private readonly byId: ReadonlyMap<string, EffectDef>

  constructor(defs: readonly EffectDef[]) {
    const problems: string[] = []
    const byId = new Map<string, EffectDef>()
    for (const def of defs) {
      if (byId.has(def.id)) problems.push(`duplicate effect id '${def.id}'`)
      else byId.set(def.id, def)
      problems.push(...defProblems(def))
    }
    if (problems.length > 0) {
      throw new Error(
        `Catalog validation failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
          problems.map((m) => `  - ${m}`).join('\n'),
      )
    }
    this.effects = [...defs]
    this.byId = byId
  }

  get size(): number {
    return this.effects.length
  }

  /** Strict lookup: throws with a helpful message when the id is unknown. */
  get(id: string): EffectDef {
    const hit = this.byId.get(id)
    if (hit) return hit
    const head = id.split('-')[0] ?? id
    const near = this.effects
      .filter((e) => e.id.startsWith(head))
      .slice(0, 3)
      .map((e) => `'${e.id}'`)
    const hint =
      near.length > 0
        ? ` Similar ids: ${near.join(', ')}.`
        : ` Known ids include ${this.effects.slice(0, 3).map((e) => `'${e.id}'`).join(', ')}.`
    throw new Error(
      `Effect '${id}' is not in this catalog (${this.effects.length} entries).` +
        `${hint} Use find() when the id may legitimately be absent.`,
    )
  }

  /** Optional lookup: undefined when the id is unknown. */
  find(id: string): EffectDef | undefined {
    return this.byId.get(id)
  }

  /** Filter effects; all given conditions must hold. Order-stable. */
  query(q: CatalogQuery): EffectDef[] {
    return this.effects.filter(
      (e) =>
        (q.medium === undefined || e.medium === q.medium) &&
        (q.maxNoiseDb === undefined || e.noiseDbAt15m <= q.maxNoiseDb) &&
        (q.tag === undefined || e.tags.includes(q.tag)),
    )
  }

  /** See the module-level {@link anticipationSec}. */
  anticipationSec(effect: EffectDef): Seconds {
    return anticipationSec(effect)
  }
}

/**
 * Adapter for modules that must not depend on the catalog directly: they
 * accept a `getEffect: (id: string) => EffectDef | undefined` parameter and
 * callers hand them this.
 */
export function getEffectFrom(catalog: Catalog): (id: string) => EffectDef | undefined {
  return (id) => catalog.find(id)
}
