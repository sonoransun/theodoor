/**
 * sim/engine.ts — the fixed-timestep simulation engine over a CompiledShow.
 *
 * TIME: fixed accumulator at stepHz (default SIM_STEP_HZ = 120) starting at
 * t0 = −(preRollSec ?? 0). Step k's time is computed by MULTIPLICATION,
 * t0 + k/stepHz — never accumulated — so there is no float drift and any
 * chunking of advanceTo() lands on identical step times.
 *
 * CUE ACTIVATION: the engine derives active cues from compiled.cues directly
 * by time — a cue becomes active at the first step ≥ its fireSec, with birth
 * age offset (age = stepTime − fireSec) cancelling quantization error. It
 * does NOT depend on transport 'fire' events for correctness (the transport
 * contract says passed cues are not re-fired after seek); ticks only pace the
 * engine, and fire events are used as a cross-check warning only. This makes
 * seek and chunked advance trivially consistent.
 *
 * SEEK: any move backward in time triggers a full deterministic re-simulation
 * from t0 (no cache) — stars are closed-form and fleets are small, so this is
 * cheap. reset() rewinds explicitly and re-packs step 0.
 */

import type {
  CompiledShow,
  Diagnostic,
  Seconds,
  SimSnapshot,
  Vec2,
} from '../contracts.js'
import { SIM_STEP_HZ } from '../contracts.js'
import {
  sourceGroundResolver,
  splAtInstant,
  type EffectLookup,
  type SourceGroundResolver,
  type SplBeamOpts,
} from '../acoustics/index.js'
import { getEffectFrom, starterCatalog, STARTER_CATALOG_ID } from '../catalog/index.js'
import type { BusEvent, Transport } from '../transport/index.js'
import { SimBuffers } from './snapshot.js'
import { buildPyroCues, evalPyro, type PyroCueSim } from './pyro.js'
import { derivePadTimelines, DroneFleetSim } from './drones.js'
import { buildLaserCues, laserFramesAt, type LaserCueSim } from './lasers.js'
import { buildPanelCues, PanelRenderer } from './panels.js'
import { buildCrowdCues, countLitCrowdCells, CrowdField, type CrowdCueSim } from './crowd.js'
import { beamLandingErrorSecMax, beamStatesAt, buildBeamCues, type BeamCueSim } from './beams.js'
import type { SimStats } from './stats.js'

export interface SimEngineOptions {
  /** Simulation rate; default SIM_STEP_HZ (120). */
  stepHz?: number
  /**
   * Effect lookup. Defaults to the starter catalog when the show references
   * STARTER_CATALOG_ID; other catalogs must be supplied by the caller.
   */
  getEffect?: EffectLookup
}

/** Guard added when mapping a time to its step index (absorbs float error). */
const STEP_EPS = 1e-6

export class SimEngine {
  readonly stepHz: number
  /** Show time of step 0: −(preRollSec ?? 0). */
  readonly startSec: Seconds

  private readonly compiled: CompiledShow
  private readonly getEffect: EffectLookup
  private readonly buffers = new SimBuffers()
  private readonly pyroCues: readonly PyroCueSim[]
  private readonly droneSim: DroneFleetSim
  private readonly laserCues: readonly LaserCueSim[]
  private readonly panels: PanelRenderer
  private readonly crowdCues: readonly CrowdCueSim[]
  /** Only constructed when the show has ≥ 1 crowd cue (zero-cost otherwise). */
  private readonly crowdField: CrowdField | undefined
  private readonly beamCues: readonly BeamCueSim[]
  /**
   * Per-cue sourceTag ground track (acoustics/beams sourceGroundResolver) —
   * the SAME single owner the steering exporter and the exposure gate use, so
   * the sim, the exported schedule, and the compile gate aim tagged beams at
   * one deterministic trajectory. Shared by the beams channel and the SPL
   * channel so one snapshot never disagrees with itself about a beam's aim.
   */
  private readonly beamOpts: SplBeamOpts & { sourceGroundAt: SourceGroundResolver }
  /** Solver time-of-flight cross-check, computed once at construction. */
  private readonly beamLandingErrSecMax: number
  private readonly listeners: readonly Vec2[]
  private readonly knownCueIds: ReadonlySet<string>
  private readonly staticDiagnostics: readonly Diagnostic[]

  private runtimeDiagnostics: Diagnostic[] = []
  private crossCheckWarned = new Set<string>()
  private stepIdx = -1

  // Running stats trackers (reset with the sim).
  private peakStars = 0
  private peakDrones = 0
  private peakCrowdCellsLit = 0
  private peakActiveBeams = 0
  private splPeak: number[] = []

  constructor(compiled: CompiledShow, opts: SimEngineOptions = {}) {
    this.compiled = compiled
    this.stepHz = opts.stepHz ?? SIM_STEP_HZ
    if (!(this.stepHz > 0)) throw new Error('SimEngine: stepHz must be > 0')
    this.startSec = 0 - (compiled.show.preRollSec ?? 0)

    if (opts.getEffect) {
      this.getEffect = opts.getEffect
    } else if (compiled.show.catalogId === STARTER_CATALOG_ID) {
      this.getEffect = getEffectFrom(starterCatalog())
    } else {
      throw new Error(
        `SimEngine: show references catalog '${compiled.show.catalogId}' — ` +
          `pass opts.getEffect (only '${STARTER_CATALOG_ID}' resolves automatically)`,
      )
    }

    this.pyroCues = buildPyroCues(compiled, this.getEffect)
    const timelines = derivePadTimelines(compiled, this.getEffect)
    this.droneSim = new DroneFleetSim(timelines, this.stepHz)
    this.laserCues = buildLaserCues(compiled, this.getEffect)
    this.panels = new PanelRenderer(buildPanelCues(compiled, this.getEffect), compiled.show.music)
    this.crowdCues = buildCrowdCues(compiled, this.getEffect)
    // Size the crowd arrays only for shows that use them — keeps snapshots of
    // crowd-free shows byte-identical to pre-crowd builds.
    this.crowdField = this.crowdCues.length > 0 ? new CrowdField(compiled.show.site) : undefined
    if (this.crowdField) this.buffers.setCrowdCellCount(this.crowdField.cellCount)
    this.beamCues = buildBeamCues(compiled, this.getEffect)
    this.beamOpts = {
      beats: compiled.show.music.beats,
      sourceGroundAt: sourceGroundResolver(compiled, this.getEffect),
    }
    this.beamLandingErrSecMax = beamLandingErrorSecMax(this.beamCues, compiled.show.site)
    this.listeners = compiled.show.site.refListenerPos
    this.knownCueIds = new Set(compiled.cues.map((c) => c.id))
    this.staticDiagnostics = timelines.flatMap((t) => t.diagnostics)

    this.reset()
  }

  /** Rewind to t0 and deterministically re-pack step 0. */
  reset(): void {
    this.stepIdx = -1
    this.runtimeDiagnostics = []
    this.crossCheckWarned = new Set()
    this.droneSim.reset()
    this.peakStars = 0
    this.peakDrones = 0
    this.peakCrowdCellsLit = 0
    this.peakActiveBeams = 0
    this.splPeak = this.listeners.map(() => -Infinity)
    this.stepOnce(0)
  }

  /** Show time of the last completed step. */
  get timeSec(): Seconds {
    return this.startSec + this.stepIdx / this.stepHz
  }

  /**
   * Simulate every step with stepTime ≤ tSec. Moving backward re-simulates
   * from t0 (deterministic; no cache).
   */
  advanceTo(tSec: Seconds): void {
    const target = Math.max(0, Math.floor((tSec - this.startSec) * this.stepHz + STEP_EPS))
    if (target < this.stepIdx) this.reset()
    while (this.stepIdx < target) this.stepOnce(this.stepIdx + 1)
  }

  /** SoA snapshot of the last completed step (views valid until the next step). */
  snapshot(): SimSnapshot {
    return this.buffers.toSnapshot()
  }

  /** Static (plan-time) diagnostics followed by runtime warnings, in order. */
  warnings(): Diagnostic[] {
    return [...this.staticDiagnostics, ...this.runtimeDiagnostics]
  }

  /** Aggregate statistics over everything simulated since the last reset. */
  stats(): SimStats {
    const landings = this.droneSim.landings
    const landingAccuracyM = landings.length > 0
      ? landings.reduce((s, l) => s + l.meanErrorM, 0) / landings.length
      : 0
    return {
      peakStars: this.peakStars,
      peakDrones: this.peakDrones,
      minSeparationM: this.droneSim.minSeparationM,
      landingAccuracyM,
      peakCrowdCellsLit: this.peakCrowdCellsLit,
      peakActiveBeams: this.peakActiveBeams,
      beamLandingErrorSecMax: this.beamLandingErrSecMax,
      splPeakByListener: [...this.splPeak],
      warningCount: this.warnings().length,
      steps: this.stepIdx + 1,
    }
  }

  /**
   * Subscribe to a Transport: ticks and seeks drive advanceTo, 'stopped'
   * resets, and 'fire' events are cross-checked against compiled.cues (the
   * engine never depends on them for correctness). Returns unsubscribe.
   * The engine immediately aligns itself to the transport's current time.
   */
  attach(transport: Transport): () => void {
    const un = transport.on((e: BusEvent) => {
      switch (e.type) {
        case 'tick':
          this.advanceTo(e.t)
          break
        case 'seek':
          this.advanceTo(e.t)
          break
        case 'transport':
          if (e.state === 'stopped') this.reset()
          else this.advanceTo(e.t)
          break
        case 'fire':
          if (!this.knownCueIds.has(e.cue.id) && !this.crossCheckWarned.has(e.cue.id)) {
            this.crossCheckWarned.add(e.cue.id)
            this.runtimeDiagnostics.push({
              code: 'sim/fire-unknown-cue',
              severity: 'warning',
              message: `Transport fired cue '${e.cue.id}' that is not in this engine's CompiledShow`,
              cueIds: [e.cue.id],
              tSec: e.cue.fireSec,
            })
          }
          break
        case 'warning':
          break
      }
    })
    this.advanceTo(transport.timeSec)
    return un
  }

  private stepOnce(k: number): void {
    const t = this.startSec + k / this.stepHz
    const out = this.buffers
    out.beginStep(t, k)

    evalPyro(this.pyroCues, t, out)
    this.droneSim.step(k, t, out, this.runtimeDiagnostics)
    out.laserFrames = laserFramesAt(this.laserCues, t, this.compiled.show.music)
    out.panelFrames = this.panels.framesAt(t)

    if (this.crowdField) {
      this.crowdField.evalStep(this.crowdCues, t, this.compiled.show.music.beats, out)
      const lit = countLitCrowdCells(out.crowdRgb, out.crowdWhite, out.crowdCellCount)
      if (lit > this.peakCrowdCellsLit) this.peakCrowdCellsLit = lit
    }
    if (this.beamCues.length > 0) {
      // sourceTag aims resolve PER CUE through the shared sourceGroundResolver
      // (drone tag → that cue's formation-centroid ground, pyro tag → its
      // rack) — the same track the steering exporter and exposure gate use.
      out.beams = beamStatesAt(this.beamCues, t, this.compiled.show.site, this.beamOpts)
      if (out.beams.length > this.peakActiveBeams) this.peakActiveBeams = out.beams.length
    }

    for (let i = 0; i < this.listeners.length; i++) {
      // beamOpts makes the SPL channel resolve beam aims exactly like the
      // beams channel above (same beat grid, same sourceTag ground track).
      const db = splAtInstant(this.compiled, this.getEffect, this.listeners[i]!, t, this.beamOpts)
      out.splByListener.push(db)
      if (db > this.splPeak[i]!) this.splPeak[i] = db
    }

    if (out.starCount > this.peakStars) this.peakStars = out.starCount
    if (out.droneCount > this.peakDrones) this.peakDrones = out.droneCount
    this.stepIdx = k
  }
}
