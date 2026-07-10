/**
 * sim/drones.ts — drone fleet flight: pad timelines derived from compiled
 * cues, semi-implicit Euler point-mass integration, separation checks.
 *
 * SINGLE OWNER — derivePadTimelines(compiled, getEffect) is THE derivation of
 * per-pad flight plans from a CompiledShow. The alignment solver derives its
 * drone anticipation from the same inputs (formationFromEffect + planMorph);
 * solver and sim MUST derive identical plans from identical inputs, and this
 * exported function is the reference the solver is cross-checked against.
 *
 * Sequential pad logic (deterministic, in compiled-cue order):
 * 1. The fleet starts parked on a ground grid at the pad (spacing 2·rMinM).
 * 2. Every drone cue becomes one segment. Its target formation comes from
 *    formationFromEffect(effect, params, cue.seed) — planar x–z points —
 *    translated to the pad position at base altitude 30 m + scale/2. The
 *    formation is fitted to the fleet: if it has fewer points than the fleet,
 *    the remaining drones are targeted back to their ground-grid slots
 *    (PARKED); if more, it is farthest-point downsampled to the fleet size.
 * 3. planMorph(previous fleet state → fitted targets) supplies assignment,
 *    per-drone straight paths and departure delays. Because both formations
 *    are already fleet-sized, planMorph's internal resampling is a no-op —
 *    the plan endpoints ARE the fitted points, so per-drone colors follow the
 *    assignment exactly.
 * 4. Departure is gap-based: startSec = clamp(targetSec − LIFT_MARGIN·T*,
 *    prevHoldEnd, targetSec) — the transition occupies at most the gap since
 *    the previous segment's hold end and never begins after its own target.
 *    A DELAYED drone (duplicated first waypoint, see choreo/morph.ts) holds
 *    until startSec + MORPH_DELAY_FRACTION·transitionSec.
 * 5. After the last cue's hold the fleet holds 5 s more, then descends back
 *    to the ground grid.
 *
 * Integration: per engine step, each drone tracks the TIME-PARAMETERIZED
 * point of its morph path (the "carrot": start → end linearly over
 * [effectiveStart, targetSec], where effectiveStart includes the delay
 * fraction; this is exactly the trajectory planMorph collision-checks, so
 * plan feasibility maps onto real flight). The controller is the carrot's
 * velocity feed-forward plus a braking-parabola correction toward it,
 * vDesired = vCarrot + d̂·min(vMax, sqrt(2·aMax·d)), clamped to vMax, with
 * acceleration clamped to aMax and semi-implicit Euler (vel then pos).
 * Every 10 steps a uniform grid hash (cell = rMinM) collects near pairs;
 * pairs closer than rMinM record a 'warning' Diagnostic (the sim reports,
 * never silently corrects) and the minimum observed separation feeds stats
 * and the snapshot.
 */

import type {
  CompiledCue,
  CompiledShow,
  Diagnostic,
  FleetSpec,
  Formation,
  FormationPoint,
  Seconds,
  Vec3,
} from '../contracts.js'
import type { EffectLookup } from '../acoustics/index.js'
import { forkSeed } from '../math/index.js'
import {
  MORPH_DELAY_FRACTION,
  formationFromEffect,
  planMorph,
  resampleTo,
  type MorphResult,
} from '../choreo/index.js'
import type { SimBuffers } from './snapshot.js'

/** Base altitude a formation's center flies at: DRONE_BASE_ALTITUDE_M + scale/2. */
export { DRONE_BASE_ALTITUDE_M } from '../contracts.js'
import { DRONE_BASE_ALTITUDE_M } from '../contracts.js'
/** Departure margin over the trapezoidal minimum transition time. */
export const LIFT_MARGIN = 1.25
/** Hold at the last formation before returning to the pad. */
export const RETURN_HOLD_SEC = 5
/** Separation is checked every this many sim steps. */
export const SEPARATION_CHECK_EVERY_STEPS = 10
/** Ground-grid spacing as a multiple of rMinM. */
export const PAD_GRID_SPACING_FACTOR = 2
/** Color of drones parked on (or targeted back to) the ground grid. */
export const PARKED_RGB: readonly [number, number, number] = [0.08, 0.08, 0.08]
/** Cap on stored separation warnings (deterministic truncation). */
const MAX_SEPARATION_WARNINGS = 200

/** One flight segment of a pad timeline (transition + hold at a formation). */
export interface PadSegment {
  /** Index into CompiledShow.cues; −1 for the final return-to-pad segment. */
  cueIdx: number
  cueId?: string
  /** Transition departure time. */
  startSec: Seconds
  /** When the formation should be reached (cue.targetSec). */
  targetSec: Seconds
  /** targetSec − startSec (≥ a single step). */
  transitionSec: Seconds
  /** Hold ends (next transition may begin): targetSec + durationSec (holdSec is already folded into CompiledCue.durationSec by the solver). */
  holdEndSec: Seconds
  /** Per-drone start/end of the straight path (index = drone id). */
  starts: readonly Vec3[]
  ends: readonly Vec3[]
  /** Per-drone delayed departure (duplicated-first-waypoint convention). */
  delayed: readonly boolean[]
  /** Per-drone target color (formation point r/g/b, white default, PARKED_RGB for grid slots). */
  rgb: Float32Array
  /** True where the drone's assigned target is a formation point (not a parked slot). */
  inFormation: readonly boolean[]
  plan: MorphResult
}

/** Full flight plan for one dronePad asset. */
export interface PadTimeline {
  padId: string
  fleet: FleetSpec
  /** Ground-grid slots (fleet.count points, spacing 2·rMinM, z = pad elevation). */
  slots: readonly Vec3[]
  segments: readonly PadSegment[]
  diagnostics: readonly Diagnostic[]
}

/** Ground parking grid for a pad: N slots centered on (cx, cy) at z. */
export function padGroundGrid(
  cx: number, cy: number, z: number, n: number, spacingM: number,
): Vec3[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.max(1, Math.ceil(n / cols))
  const slots: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    slots.push({
      x: cx + (c - (cols - 1) / 2) * spacingM,
      y: cy + (r - (rows - 1) / 2) * spacingM,
      z,
    })
  }
  return slots
}

interface FittedTargets {
  points: readonly FormationPoint[]
  /** Per point: true = formation point, false = parked ground slot. */
  inFormation: readonly boolean[]
}

/** Fit a translated formation to exactly fleetN points (see module doc). */
function fitToFleet(
  formation: readonly FormationPoint[],
  slots: readonly Vec3[],
  fleetN: number,
  seed: number,
): FittedTargets {
  if (formation.length === fleetN) {
    return { points: formation, inFormation: formation.map(() => true) }
  }
  if (formation.length > fleetN) {
    const points = resampleTo(formation, fleetN, forkSeed(seed, 'fit'))
    return { points, inFormation: points.map(() => true) }
  }
  const points: FormationPoint[] = [...formation]
  const inFormation: boolean[] = formation.map(() => true)
  for (let i = formation.length; i < fleetN; i++) {
    points.push({ ...slots[i]!, r: PARKED_RGB[0], g: PARKED_RGB[1], b: PARKED_RGB[2] })
    inFormation.push(false)
  }
  return { points, inFormation }
}

/**
 * Derive every dronePad's flight timeline from a CompiledShow. Deterministic
 * pure function of (compiled, catalog) — the single source the solver's
 * drone anticipation is validated against. Drone cues with an unknown or
 * missing positionId fly from the first dronePad; shows without a dronePad
 * yield a diagnostic per orphaned cue.
 */
export function derivePadTimelines(
  compiled: CompiledShow,
  getEffect: EffectLookup,
): PadTimeline[] {
  const site = compiled.show.site
  const pads = site.assets.filter((a) => a.kind === 'dronePad' && a.fleet !== undefined)
  const orphanDiagnostics: Diagnostic[] = []

  // Bucket drone cues per pad, preserving compiled order.
  const byPad = new Map<string, { cue: CompiledCue; cueIdx: number }[]>()
  for (const pad of pads) byPad.set(pad.id, [])
  compiled.cues.forEach((cue, cueIdx) => {
    if (cue.medium !== 'drone') return
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'drone') return
    let padId = cue.positionId !== undefined && byPad.has(cue.positionId)
      ? cue.positionId
      : pads[0]?.id
    if (padId === undefined) {
      orphanDiagnostics.push({
        code: 'sim/no-drone-pad',
        severity: 'warning',
        message: `Drone cue '${cue.id}' has no dronePad to fly from`,
        cueIds: [cue.id],
      })
      return
    }
    byPad.get(padId)!.push({ cue, cueIdx })
  })

  const t0 = 0 - (compiled.show.preRollSec ?? 0)
  const timelines: PadTimeline[] = []

  for (const pad of pads) {
    const fleet = pad.fleet!
    const cues = byPad.get(pad.id)!
    if (cues.length === 0) continue

    const n = fleet.count
    const spacing = PAD_GRID_SPACING_FACTOR * Math.max(0.5, fleet.rMinM)
    const slots = padGroundGrid(pad.pos.x, pad.pos.y, pad.elevationM, n, spacing)
    const diagnostics: Diagnostic[] = []
    const limits = { vMaxMps: fleet.vMaxMps, aMaxMps2: fleet.aMaxMps2, rMinM: fleet.rMinM }

    let state: Formation = {
      name: `pad:${pad.id}:ground`,
      points: slots.map((s) => ({ ...s, r: PARKED_RGB[0], g: PARKED_RGB[1], b: PARKED_RGB[2] })),
    }
    let prevHoldEnd = t0
    const segments: PadSegment[] = []

    const buildSegment = (
      to: FittedTargets,
      name: string,
      cueIdx: number,
      cue: CompiledCue | undefined,
      targetSecWanted: Seconds | undefined,
      holdEndOf: (targetSec: Seconds) => Seconds,
    ): void => {
      const toFormation: Formation = { name, points: to.points as FormationPoint[] }
      // transitionSec only gates the feasibility flag — waypoints and delays
      // are independent of it — so plan first, then place the window.
      const plan = planMorph(state, toFormation, Number.MAX_SAFE_INTEGER, limits)
      const lift = LIFT_MARGIN * plan.minTransitionSec
      const targetSec = targetSecWanted ?? prevHoldEnd + lift
      const startSec = Math.min(targetSec, Math.max(prevHoldEnd, targetSec - lift))
      const transitionSec = Math.max(1e-3, targetSec - startSec)
      if (transitionSec < plan.minTransitionSec && cue) {
        diagnostics.push({
          code: 'sim/morph-window-short',
          severity: 'warning',
          message:
            `Drone cue '${cue.id}' transition window ${transitionSec.toFixed(2)} s is shorter ` +
            `than the kinematic minimum ${plan.minTransitionSec.toFixed(2)} s — formation will arrive late`,
          cueIds: [cue.id],
          assetId: pad.id,
          tSec: targetSec,
        })
      }
      if (!plan.feasible || plan.softConflicts > 0) {
        diagnostics.push({
          code: 'sim/morph-conflicts',
          severity: 'warning',
          message:
            `Morph into '${name}' keeps ${plan.softConflicts} pair(s) inside rMin ` +
            `${fleet.rMinM} m${plan.feasible ? '' : ' (some closer than rMin/2)'}`,
          ...(cue ? { cueIds: [cue.id] } : {}),
          assetId: pad.id,
          tSec: targetSec,
        })
      }

      const starts: Vec3[] = []
      const ends: Vec3[] = []
      const delayed: boolean[] = []
      for (const w of plan.waypoints) {
        starts.push(w.path[0]!)
        ends.push(w.path[w.path.length - 1]!)
        delayed.push(w.path.length === 3)
      }
      const rgb = new Float32Array(3 * plan.assignment.length)
      const inFormation: boolean[] = []
      plan.assignment.forEach((j, i) => {
        const p = to.points[j]!
        rgb[i * 3] = p.r ?? 1
        rgb[i * 3 + 1] = p.g ?? 1
        rgb[i * 3 + 2] = p.b ?? 1
        inFormation.push(to.inFormation[j]!)
      })
      const holdEndSec = holdEndOf(targetSec)
      segments.push({
        cueIdx,
        ...(cue ? { cueId: cue.id } : {}),
        startSec, targetSec, transitionSec, holdEndSec,
        starts, ends, delayed, rgb, inFormation, plan,
      })

      state = {
        name: `pad:${pad.id}:after-${cue?.id ?? 'return'}`,
        points: ends.map((e, i) => ({
          ...e,
          r: rgb[i * 3]!, g: rgb[i * 3 + 1]!, b: rgb[i * 3 + 2]!,
        })),
      }
      prevHoldEnd = holdEndSec
    }

    for (const { cue, cueIdx } of cues) {
      const effect = getEffect(cue.effectId)!
      if (effect.medium !== 'drone') continue
      const formation = formationFromEffect(effect, cue.params, cue.seed)
      const scale = typeof cue.params?.scaleM === 'number' ? cue.params.scaleM : effect.scaleM
      const baseAlt = DRONE_BASE_ALTITUDE_M + scale / 2
      const translated: FormationPoint[] = formation.points.map((p) => ({
        ...p,
        x: p.x + pad.pos.x,
        y: p.y + pad.pos.y,
        z: p.z + baseAlt,
      }))
      const fitted = fitToFleet(translated, slots, n, cue.seed)
      // holdSec is already folded into CompiledCue.durationSec by the solver —
      // adding it again would double-count the hold and destroy tight-but-valid
      // pad schedules (the solver adopts these departures as compiled fireSec).
      buildSegment(
        fitted, `${formation.name}@${cue.id}`, cueIdx, cue, cue.targetSec,
        (targetSec) => targetSec + cue.durationSec,
      )
    }

    // Return home: hold 5 s at the last formation, then descend to the grid.
    prevHoldEnd += RETURN_HOLD_SEC
    buildSegment(
      {
        points: slots.map((s) => ({
          ...s, r: PARKED_RGB[0], g: PARKED_RGB[1], b: PARKED_RGB[2],
        })),
        inFormation: slots.map(() => false),
      },
      `pad:${pad.id}:ground`,
      -1,
      undefined,
      undefined,
      () => Infinity,
    )

    timelines.push({ padId: pad.id, fleet, slots, segments, diagnostics })
  }

  if (orphanDiagnostics.length > 0 && timelines.length > 0) {
    // Attach orphan diagnostics to the first timeline for surfacing.
    const first = timelines[0]!
    timelines[0] = { ...first, diagnostics: [...first.diagnostics, ...orphanDiagnostics] }
  } else if (orphanDiagnostics.length > 0) {
    timelines.push({
      padId: '(none)',
      fleet: { count: 0, vMaxMps: 1, aMaxMps2: 1, rMinM: 0 },
      slots: [],
      segments: [],
      diagnostics: orphanDiagnostics,
    })
  }
  return timelines
}

/** Landing accuracy sample for one drone cue. */
export interface LandingSample {
  cueIdx: number
  cueId: string
  /** Mean |pos − target| over in-formation drones at the first step ≥ targetSec. */
  meanErrorM: number
}

interface PadState {
  timeline: PadTimeline
  pos: Float64Array
  vel: Float64Array
  /** Index of the current segment (last with startSec <= t), −1 before any. */
  segCursor: number
  /** Segments whose landing accuracy has been sampled. */
  landed: boolean[]
}

/**
 * Stateful fleet integrator the engine steps at stepHz. All state is rebuilt
 * deterministically by reset() + re-stepping (seek = re-simulate).
 */
export class DroneFleetSim {
  private readonly pads: PadState[]
  private readonly dt: number
  /** Closest pairwise approach observed so far (Infinity = never near). */
  minSeparationM = Infinity
  readonly landings: LandingSample[] = []
  private separationWarnings = 0

  constructor(timelines: readonly PadTimeline[], stepHz: number) {
    this.dt = 1 / stepHz
    this.pads = timelines
      .filter((t) => t.fleet.count > 0 && t.segments.length > 0)
      .map((timeline) => ({
        timeline,
        pos: new Float64Array(timeline.fleet.count * 3),
        vel: new Float64Array(timeline.fleet.count * 3),
        segCursor: -1,
        landed: timeline.segments.map(() => false),
      }))
    this.reset()
  }

  /** Total drones across pads (constant). */
  get droneCount(): number {
    let n = 0
    for (const p of this.pads) n += p.timeline.fleet.count
    return n
  }

  reset(): void {
    this.minSeparationM = Infinity
    this.landings.length = 0
    this.separationWarnings = 0
    for (const p of this.pads) {
      p.segCursor = -1
      p.landed.fill(false)
      p.timeline.slots.forEach((s, i) => {
        p.pos[i * 3] = s.x
        p.pos[i * 3 + 1] = s.y
        p.pos[i * 3 + 2] = s.z
      })
      p.vel.fill(0)
    }
  }

  /**
   * Advance every drone one step to show time tSec and pack the SoA. Records
   * separation warnings (every SEPARATION_CHECK_EVERY_STEPS steps) and
   * landing-accuracy samples as segments cross their targetSec.
   */
  step(stepIdx: number, tSec: Seconds, out: SimBuffers, warnings: Diagnostic[]): void {
    for (const p of this.pads) {
      const segs = p.timeline.segments
      while (p.segCursor + 1 < segs.length && segs[p.segCursor + 1]!.startSec <= tSec) {
        p.segCursor++
      }
      const seg = p.segCursor >= 0 ? segs[p.segCursor]! : undefined
      const fleet = p.timeline.fleet
      const n = fleet.count
      const vMax = fleet.vMaxMps
      const aMax = fleet.aMaxMps2
      const dt = this.dt

      for (let i = 0; i < n; i++) {
        // Carrot: the time-parameterized point of the morph path. A delayed
        // drone's carrot holds at the start for the delay fraction, then
        // flies start → end linearly, arriving exactly at targetSec.
        let tx: number
        let ty: number
        let tz: number
        let cvx = 0
        let cvy = 0
        let cvz = 0
        if (!seg) {
          const s = p.timeline.slots[i]!
          tx = s.x; ty = s.y; tz = s.z
        } else {
          const effStart = seg.startSec +
            (seg.delayed[i] ? MORPH_DELAY_FRACTION * seg.transitionSec : 0)
          const start = seg.starts[i]!
          const end = seg.ends[i]!
          if (tSec <= effStart) {
            tx = start.x; ty = start.y; tz = start.z
          } else if (tSec >= seg.targetSec) {
            tx = end.x; ty = end.y; tz = end.z
          } else {
            const window = seg.targetSec - effStart
            const u = (tSec - effStart) / window
            tx = start.x + (end.x - start.x) * u
            ty = start.y + (end.y - start.y) * u
            tz = start.z + (end.z - start.z) * u
            cvx = (end.x - start.x) / window
            cvy = (end.y - start.y) / window
            cvz = (end.z - start.z) / window
          }
        }

        const px = p.pos[i * 3]!
        const py = p.pos[i * 3 + 1]!
        const pz = p.pos[i * 3 + 2]!
        const dx = tx - px
        const dy = ty - py
        const dz = tz - pz
        const dist = Math.hypot(dx, dy, dz)

        // Desired velocity: carrot feed-forward + braking-parabola correction
        // toward the carrot, the sum clamped to vMax.
        let dvx = cvx
        let dvy = cvy
        let dvz = cvz
        if (dist > 1e-9) {
          const vCorr = Math.min(vMax, Math.sqrt(2 * aMax * dist))
          dvx += (dx / dist) * vCorr
          dvy += (dy / dist) * vCorr
          dvz += (dz / dist) * vCorr
        }
        const dvLen = Math.hypot(dvx, dvy, dvz)
        if (dvLen > vMax) {
          const s = vMax / dvLen
          dvx *= s; dvy *= s; dvz *= s
        }

        // Acceleration clamped to aMax; semi-implicit Euler.
        let ax = (dvx - p.vel[i * 3]!) / dt
        let ay = (dvy - p.vel[i * 3 + 1]!) / dt
        let az = (dvz - p.vel[i * 3 + 2]!) / dt
        const aLen = Math.hypot(ax, ay, az)
        if (aLen > aMax) {
          const s = aMax / aLen
          ax *= s; ay *= s; az *= s
        }
        const vx = p.vel[i * 3]! + ax * dt
        const vy = p.vel[i * 3 + 1]! + ay * dt
        const vz = p.vel[i * 3 + 2]! + az * dt
        let nx = px + vx * dt
        let ny = py + vy * dt
        let nz = pz + vz * dt

        // Deterministic settle: kill the terminal limit cycle at a
        // stationary target (never snap onto a moving carrot).
        const carrotStill = cvx === 0 && cvy === 0 && cvz === 0
        if (carrotStill && dist < 1e-3 && Math.hypot(vx, vy, vz) * dt < 1e-3) {
          nx = tx; ny = ty; nz = tz
          p.vel[i * 3] = 0; p.vel[i * 3 + 1] = 0; p.vel[i * 3 + 2] = 0
        } else {
          p.vel[i * 3] = vx; p.vel[i * 3 + 1] = vy; p.vel[i * 3 + 2] = vz
        }
        p.pos[i * 3] = nx; p.pos[i * 3 + 1] = ny; p.pos[i * 3 + 2] = nz

        const rgb = seg ? seg.rgb : undefined
        out.pushDrone(
          nx, ny, nz,
          p.vel[i * 3]!, p.vel[i * 3 + 1]!, p.vel[i * 3 + 2]!,
          rgb ? rgb[i * 3]! : PARKED_RGB[0],
          rgb ? rgb[i * 3 + 1]! : PARKED_RGB[1],
          rgb ? rgb[i * 3 + 2]! : PARKED_RGB[2],
        )
      }

      // Landing accuracy: first step at/after each cue segment's targetSec.
      for (let si = 0; si <= p.segCursor; si++) {
        const s = segs[si]!
        if (p.landed[si] || tSec < s.targetSec || s.cueIdx < 0) continue
        p.landed[si] = true
        let sum = 0
        let count = 0
        for (let i = 0; i < n; i++) {
          if (!s.inFormation[i]) continue
          const e = s.ends[i]!
          sum += Math.hypot(p.pos[i * 3]! - e.x, p.pos[i * 3 + 1]! - e.y, p.pos[i * 3 + 2]! - e.z)
          count++
        }
        if (count > 0) {
          this.landings.push({ cueIdx: s.cueIdx, cueId: s.cueId ?? '', meanErrorM: sum / count })
        }
      }

      if (stepIdx % SEPARATION_CHECK_EVERY_STEPS === 0 && n > 1 && fleet.rMinM > 0) {
        this.checkSeparation(p, tSec, warnings)
      }
    }
    out.minSeparationM = this.minSeparationM
  }

  /**
   * Uniform grid hash (cell = rMinM): any pair closer than rMinM shares a
   * cell or neighboring cells, so violations are detected exactly; the
   * minimum over candidate pairs also tightens minSeparationM.
   */
  private checkSeparation(p: PadState, tSec: Seconds, warnings: Diagnostic[]): void {
    const fleet = p.timeline.fleet
    const cell = fleet.rMinM
    const n = fleet.count
    const buckets = new Map<string, number[]>()
    for (let i = 0; i < n; i++) {
      const key =
        `${Math.floor(p.pos[i * 3]! / cell)},` +
        `${Math.floor(p.pos[i * 3 + 1]! / cell)},` +
        `${Math.floor(p.pos[i * 3 + 2]! / cell)}`
      const b = buckets.get(key)
      if (b) b.push(i)
      else buckets.set(key, [i])
    }
    let violations = 0
    let minSep = Infinity
    for (const [key, ids] of buckets) {
      const [cx, cy, cz] = key.split(',').map(Number) as [number, number, number]
      // Own cell plus forward half-neighborhood (each unordered cell pair once).
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const isSelf = ox === 0 && oy === 0 && oz === 0
            const forward = ox > 0 || (ox === 0 && (oy > 0 || (oy === 0 && oz > 0)))
            if (!isSelf && !forward) continue
            const other = isSelf ? ids : buckets.get(`${cx + ox},${cy + oy},${cz + oz}`)
            if (!other) continue
            for (let a = 0; a < ids.length; a++) {
              const startB = isSelf ? a + 1 : 0
              for (let b = startB; b < other.length; b++) {
                const i = ids[a]!
                const j = other[b]!
                const d = Math.hypot(
                  p.pos[i * 3]! - p.pos[j * 3]!,
                  p.pos[i * 3 + 1]! - p.pos[j * 3 + 1]!,
                  p.pos[i * 3 + 2]! - p.pos[j * 3 + 2]!,
                )
                if (d < minSep) minSep = d
                if (d < fleet.rMinM) violations++
              }
            }
          }
        }
      }
    }
    if (minSep < this.minSeparationM) this.minSeparationM = minSep
    if (violations > 0 && this.separationWarnings < MAX_SEPARATION_WARNINGS) {
      this.separationWarnings++
      warnings.push({
        code: 'sim/drone-separation',
        severity: 'warning',
        message:
          `${violations} drone pair(s) on pad '${p.timeline.padId}' closer than ` +
          `${fleet.rMinM} m (min ${minSep.toFixed(2)} m)`,
        assetId: p.timeline.padId,
        tSec,
      })
    }
  }
}
