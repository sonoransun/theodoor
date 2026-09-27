/**
 * sim/snapshot.ts — growable SoA buffers packed once per completed sim step.
 *
 * The SimSnapshot contract (contracts.ts) is xyz-interleaved Float32Arrays;
 * viz uploads them in one bufferData call and headless stats read them
 * directly. Buffers grow by doubling and NEVER shrink, so a long show settles
 * into zero steady-state allocation. `toSnapshot()` hands out exact-length
 * subarray VIEWS over the backing stores — valid until the next step is
 * packed (the SoA snapshot is authoritative; consumers read it immediately
 * or copy).
 */

import type { BeamState, JetState, LaserPoint, LightState, Seconds, SimSnapshot } from '../contracts.js'

const INITIAL_STARS = 256
const INITIAL_SHELLS = 16
const INITIAL_DRONES = 64

function growF32(buf: Float32Array<ArrayBuffer>, needed: number): Float32Array<ArrayBuffer> {
  let cap = buf.length
  while (cap < needed) cap *= 2
  if (cap === buf.length) return buf
  const next = new Float32Array(cap)
  next.set(buf)
  return next
}

function growI32(buf: Int32Array<ArrayBuffer>, needed: number): Int32Array<ArrayBuffer> {
  let cap = buf.length
  while (cap < needed) cap *= 2
  if (cap === buf.length) return buf
  const next = new Int32Array(cap)
  next.set(buf)
  return next
}

/** Mutable SoA staging area the engine fills each step. */
export class SimBuffers {
  t: Seconds = 0
  step = 0

  starCount = 0
  starPos = new Float32Array(INITIAL_STARS * 3)
  starVel = new Float32Array(INITIAL_STARS * 3)
  starRgb = new Float32Array(INITIAL_STARS * 3)
  starBrightness = new Float32Array(INITIAL_STARS)
  starSizeM = new Float32Array(INITIAL_STARS)

  shellCount = 0
  shellPos = new Float32Array(INITIAL_SHELLS * 3)
  shellCueIdx = new Int32Array(INITIAL_SHELLS)

  droneCount = 0
  dronePos = new Float32Array(INITIAL_DRONES * 3)
  droneVel = new Float32Array(INITIAL_DRONES * 3)
  droneRgb = new Float32Array(INITIAL_DRONES * 3)
  /** Running minimum pairwise separation observed so far (Infinity = never near). */
  minSeparationM = Infinity

  laserFrames: { assetId: string; points: readonly LaserPoint[] }[] = []
  panelFrames: { assetId: string; w: number; h: number; rgb: Uint8Array }[] = []
  splByListener: number[] = []

  /** Crowd canvas: fixed cell count per show (0 without a crowd grid). */
  crowdCellCount = 0
  crowdRgb = new Float32Array(0)
  crowdWhite = new Float32Array(0)
  beams: BeamState[] = []
  jets: JetState[] = []
  lights: LightState[] = []

  /** Size the crowd arrays once per show (cell count is constant). */
  setCrowdCellCount(n: number): void {
    this.crowdCellCount = n
    if (this.crowdRgb.length !== n * 3) this.crowdRgb = new Float32Array(n * 3)
    if (this.crowdWhite.length !== n) this.crowdWhite = new Float32Array(n)
  }

  /** Reset the per-step contents (counts and frame lists; capacity is kept). */
  beginStep(t: Seconds, step: number): void {
    this.t = t
    this.step = step
    this.starCount = 0
    this.shellCount = 0
    this.droneCount = 0
    this.laserFrames = []
    this.panelFrames = []
    this.splByListener = []
    this.crowdRgb.fill(0)
    this.crowdWhite.fill(0)
    this.beams = []
    this.jets = []
    this.lights = []
  }

  pushStar(
    x: number, y: number, z: number,
    r: number, g: number, b: number,
    brightness: number, sizeM: number,
    vx = 0, vy = 0, vz = 0,
  ): void {
    const i = this.starCount
    this.starPos = growF32(this.starPos, (i + 1) * 3)
    this.starVel = growF32(this.starVel, (i + 1) * 3)
    this.starRgb = growF32(this.starRgb, (i + 1) * 3)
    this.starBrightness = growF32(this.starBrightness, i + 1)
    this.starSizeM = growF32(this.starSizeM, i + 1)
    this.starPos[i * 3] = x
    this.starPos[i * 3 + 1] = y
    this.starPos[i * 3 + 2] = z
    this.starVel[i * 3] = vx
    this.starVel[i * 3 + 1] = vy
    this.starVel[i * 3 + 2] = vz
    this.starRgb[i * 3] = r
    this.starRgb[i * 3 + 1] = g
    this.starRgb[i * 3 + 2] = b
    this.starBrightness[i] = brightness
    this.starSizeM[i] = sizeM
    this.starCount = i + 1
  }

  pushShell(x: number, y: number, z: number, cueIdx: number): void {
    const i = this.shellCount
    this.shellPos = growF32(this.shellPos, (i + 1) * 3)
    this.shellCueIdx = growI32(this.shellCueIdx, i + 1)
    this.shellPos[i * 3] = x
    this.shellPos[i * 3 + 1] = y
    this.shellPos[i * 3 + 2] = z
    this.shellCueIdx[i] = cueIdx
    this.shellCount = i + 1
  }

  pushDrone(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
  ): void {
    const i = this.droneCount
    this.dronePos = growF32(this.dronePos, (i + 1) * 3)
    this.droneVel = growF32(this.droneVel, (i + 1) * 3)
    this.droneRgb = growF32(this.droneRgb, (i + 1) * 3)
    this.dronePos[i * 3] = x
    this.dronePos[i * 3 + 1] = y
    this.dronePos[i * 3 + 2] = z
    this.droneVel[i * 3] = vx
    this.droneVel[i * 3 + 1] = vy
    this.droneVel[i * 3 + 2] = vz
    this.droneRgb[i * 3] = r
    this.droneRgb[i * 3 + 1] = g
    this.droneRgb[i * 3 + 2] = b
    this.droneCount = i + 1
  }

  /** Exact-length views over the backing stores for the last packed step. */
  toSnapshot(): SimSnapshot {
    return {
      t: this.t,
      step: this.step,
      shells: {
        count: this.shellCount,
        pos: this.shellPos.subarray(0, this.shellCount * 3),
        cueIdx: this.shellCueIdx.subarray(0, this.shellCount),
      },
      stars: {
        count: this.starCount,
        pos: this.starPos.subarray(0, this.starCount * 3),
        vel: this.starVel.subarray(0, this.starCount * 3),
        rgb: this.starRgb.subarray(0, this.starCount * 3),
        brightness: this.starBrightness.subarray(0, this.starCount),
        sizeM: this.starSizeM.subarray(0, this.starCount),
      },
      drones: {
        count: this.droneCount,
        pos: this.dronePos.subarray(0, this.droneCount * 3),
        vel: this.droneVel.subarray(0, this.droneCount * 3),
        rgb: this.droneRgb.subarray(0, this.droneCount * 3),
        minSeparationM: this.minSeparationM,
      },
      laserFrames: this.laserFrames,
      panelFrames: this.panelFrames,
      crowd: {
        cellCount: this.crowdCellCount,
        rgb: this.crowdRgb.subarray(0, this.crowdCellCount * 3),
        white: this.crowdWhite.subarray(0, this.crowdCellCount),
      },
      beams: this.beams,
      jets: this.jets,
      lights: this.lights,
      splByListener: this.splByListener,
    }
  }
}
