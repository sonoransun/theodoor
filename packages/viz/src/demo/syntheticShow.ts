/**
 * Synthetic demo show — a deterministic, seamlessly looping SimSnapshot
 * source so the visualizer page is alive before the real sim engine lands.
 *
 * Per DEMO_LOOP_SEC (40 s) loop:
 *   - 3 demo shells (catalog-style metadata only) arc up from the mortar-rack
 *     x positions and burst into ~300 stars each, moving on the closed-form
 *     linear-drag trajectory p(τ) = p₀ + (v₀ − v_T)(1 − e^{−kτ})/k + v_T·τ
 *   - 60 drones trace a slow vertical ring (one revolution per loop)
 *   - one lissajous laser frame on the west tower
 *   - one 64×32 plasma pattern on the LED panel
 *
 * Everything is a pure function of tSec (module-level star tables are
 * precomputed from fixed seeds) — no Date.now(), no Math.random().
 * All time-varying phases are integer multiples of 2π/DEMO_LOOP_SEC so the
 * loop wraps without a visible seam.
 */
import { SIM_STEP_HZ, forkSeed, mulberry32 } from '@theodoor/core'
import type { LaserPoint, PositionedAsset, SimSnapshot } from '@theodoor/core'
import { hashPhase, starAlpha } from '../render/curves.js'

export const DEMO_LOOP_SEC = 40
const DEMO_SEED = 0x54e0d001
const OMEGA = (2 * Math.PI) / DEMO_LOOP_SEC

// --- shells & stars ---------------------------------------------------------

const SHELL_PERIOD_SEC = 8 // divides DEMO_LOOP_SEC → seamless loop
const RISE_SEC = 3
const STAR_LIFE_SEC = 4
export const STARS_PER_SHELL = 300
const DRAG_K = 0.9
const GRAVITY = 9.8
/** Terminal fall speed under linear drag (z component of v_T). */
const TERMINAL_VZ = -GRAVITY / DRAG_K

interface ShellSlot {
  launchX: number
  offsetSec: number
  burstHeightM: number
  driftXM: number
  hue: number
}

const SHELL_SLOTS: readonly ShellSlot[] = [
  { launchX: -80, offsetSec: 0.7, burstHeightM: 120, driftXM: -8, hue: 0.02 },
  { launchX: 0, offsetSec: 3.4, burstHeightM: 150, driftXM: 5, hue: 0.12 },
  { launchX: 80, offsetSec: 6.1, burstHeightM: 110, driftXM: 9, hue: 0.6 },
]

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = (((h % 1) + 1) % 1) * 6
  const i = Math.floor(hh)
  const f = hh - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  switch (i % 6) {
    case 0: return [v, t, p]
    case 1: return [q, v, p]
    case 2: return [p, v, t]
    case 3: return [p, q, v]
    case 4: return [t, p, v]
    default: return [v, p, q]
  }
}

interface SlotStars {
  dir: Float32Array // unit vectors, xyz-interleaved
  speed: Float32Array
  sizeM: Float32Array
  rgb: Float32Array
  freq: Float32Array
  phase: Float32Array
}

function makeSlotStars(slotIdx: number, hue: number): SlotStars {
  const seed = forkSeed(DEMO_SEED, `shell-${slotIdx}`)
  const rng = mulberry32(seed)
  const n = STARS_PER_SHELL
  const s: SlotStars = {
    dir: new Float32Array(n * 3),
    speed: new Float32Array(n),
    sizeM: new Float32Array(n),
    rgb: new Float32Array(n * 3),
    freq: new Float32Array(n),
    phase: new Float32Array(n),
  }
  for (let i = 0; i < n; i++) {
    // Uniform direction on the sphere.
    const zr = 2 * rng() - 1
    const az = 2 * Math.PI * rng()
    const rxy = Math.sqrt(Math.max(0, 1 - zr * zr))
    s.dir[3 * i] = rxy * Math.cos(az)
    s.dir[3 * i + 1] = rxy * Math.sin(az)
    s.dir[3 * i + 2] = zr
    s.speed[i] = 24 + 10 * rng()
    s.sizeM[i] = 0.8 + 0.8 * rng()
    const [r, g, b] = hsvToRgb(hue + (rng() - 0.5) * 0.05, 0.55 + 0.35 * rng(), 1)
    s.rgb[3 * i] = r
    s.rgb[3 * i + 1] = g
    s.rgb[3 * i + 2] = b
    s.freq[i] = 6 + 8 * rng() // twinkle 6..14 Hz
    s.phase[i] = hashPhase(seed, i)
  }
  return s
}

const SLOT_STARS: readonly SlotStars[] = SHELL_SLOTS.map((s, i) => makeSlotStars(i, s.hue))

// --- drones ------------------------------------------------------------------

export const DRONE_COUNT = 60
const DRONE_RING_R = 45
const DRONE_RING_CZ = 110

// --- laser & panel -----------------------------------------------------------

const LASER_ASSET_ID = 'laser-west'
const LASER_POINTS = 128
const PANEL_ASSET_ID = 'panel-main'
export const PANEL_W = 64
export const PANEL_H = 32

// --- site assets consumed by the renderer (beam/panel/backdrop anchors) ------

export const SYNTHETIC_ASSETS: readonly PositionedAsset[] = [
  { id: 'rack-west', kind: 'mortarRack', pos: { x: -80, y: 0 }, headingDeg: 0, elevationM: 0 },
  { id: 'rack-center', kind: 'mortarRack', pos: { x: 0, y: 0 }, headingDeg: 0, elevationM: 0 },
  { id: 'rack-east', kind: 'mortarRack', pos: { x: 80, y: 0 }, headingDeg: 0, elevationM: 0 },
  {
    id: 'pad-north', kind: 'dronePad', pos: { x: 0, y: 40 }, headingDeg: 0, elevationM: 0,
    fleet: { count: DRONE_COUNT, vMaxMps: 6, aMaxMps2: 3, rMinM: 3 },
  },
  {
    id: LASER_ASSET_ID, kind: 'laserTower', pos: { x: -60, y: 10 }, headingDeg: 0, elevationM: 2,
    laser: { minElevationDeg: 15, scanFovDeg: 60, terminationM: 300 },
  },
  {
    // Coarse demo-scale jumbotron: 64 × 32 px at 250 mm pitch → 16 m × 8 m.
    id: PANEL_ASSET_ID, kind: 'panel', pos: { x: 50, y: 5 }, headingDeg: 180, elevationM: 5,
    panel: { wPx: PANEL_W, hPx: PANEL_H, pitchMm: 250 },
  },
]

// --- snapshot ----------------------------------------------------------------

const mod = (a: number, m: number): number => ((a % m) + m) % m

export function makeSyntheticSnapshot(tSec: number): SimSnapshot {
  const t = mod(tSec, DEMO_LOOP_SEC)

  // Which slots are rising, which are bursting?
  const rising: { slot: ShellSlot; frac: number }[] = []
  const bursting: { slotIdx: number; slot: ShellSlot; age: number }[] = []
  for (let s = 0; s < SHELL_SLOTS.length; s++) {
    const slot = SHELL_SLOTS[s]
    const tau = mod(t - slot.offsetSec, SHELL_PERIOD_SEC)
    if (tau < RISE_SEC) rising.push({ slot, frac: tau / RISE_SEC })
    else if (tau < RISE_SEC + STAR_LIFE_SEC) bursting.push({ slotIdx: s, slot, age: tau - RISE_SEC })
  }

  // Shells (SoA) — the ascending demo shells.
  const shellCount = rising.length
  const shellPos = new Float32Array(shellCount * 3)
  const shellCue = new Int32Array(shellCount)
  for (let i = 0; i < shellCount; i++) {
    const { slot, frac } = rising[i]
    const ease = 1 - (1 - frac) * (1 - frac) // decelerating ascent
    shellPos[3 * i] = slot.launchX + slot.driftXM * frac
    shellPos[3 * i + 1] = 0
    shellPos[3 * i + 2] = slot.burstHeightM * ease
    shellCue[i] = SHELL_SLOTS.indexOf(slot) // demo stand-in for a cue index
  }

  // Stars: one warm tracer per rising shell + full burst clouds.
  const starCount = shellCount + bursting.length * STARS_PER_SHELL
  const starPos = new Float32Array(starCount * 3)
  const starRgb = new Float32Array(starCount * 3)
  const starBrightness = new Float32Array(starCount)
  const starSize = new Float32Array(starCount)
  let w = 0
  for (let i = 0; i < shellCount; i++) {
    starPos[3 * w] = shellPos[3 * i]
    starPos[3 * w + 1] = shellPos[3 * i + 1]
    starPos[3 * w + 2] = shellPos[3 * i + 2]
    starRgb[3 * w] = 1
    starRgb[3 * w + 1] = 0.9
    starRgb[3 * w + 2] = 0.7
    starBrightness[w] = 0.9
    starSize[w] = 1
    w++
  }
  for (const { slotIdx, slot, age } of bursting) {
    const stars = SLOT_STARS[slotIdx]
    const u = age / STAR_LIFE_SEC
    const bx = slot.launchX + slot.driftXM
    const bz = slot.burstHeightM
    const decay = (1 - Math.exp(-DRAG_K * age)) / DRAG_K
    for (let i = 0; i < STARS_PER_SHELL; i++) {
      const v0x = stars.dir[3 * i] * stars.speed[i]
      const v0y = stars.dir[3 * i + 1] * stars.speed[i]
      const v0z = stars.dir[3 * i + 2] * stars.speed[i]
      starPos[3 * w] = bx + v0x * decay
      starPos[3 * w + 1] = v0y * decay
      starPos[3 * w + 2] = bz + (v0z - TERMINAL_VZ) * decay + TERMINAL_VZ * age
      starRgb[3 * w] = stars.rgb[3 * i]
      starRgb[3 * w + 1] = stars.rgb[3 * i + 1]
      starRgb[3 * w + 2] = stars.rgb[3 * i + 2]
      starBrightness[w] = starAlpha(u, t, stars.freq[i], stars.phase[i])
      starSize[w] = stars.sizeM[i]
      w++
    }
  }

  // Drones: slow vertical ring, one revolution per loop.
  const dronePos = new Float32Array(DRONE_COUNT * 3)
  const droneVel = new Float32Array(DRONE_COUNT * 3)
  const droneRgb = new Float32Array(DRONE_COUNT * 3)
  for (let i = 0; i < DRONE_COUNT; i++) {
    const theta = (i / DRONE_COUNT) * 2 * Math.PI + t * OMEGA
    dronePos[3 * i] = DRONE_RING_R * Math.cos(theta)
    dronePos[3 * i + 1] = 30
    dronePos[3 * i + 2] = DRONE_RING_CZ + DRONE_RING_R * Math.sin(theta)
    droneVel[3 * i] = -DRONE_RING_R * Math.sin(theta) * OMEGA
    droneVel[3 * i + 1] = 0
    droneVel[3 * i + 2] = DRONE_RING_R * Math.cos(theta) * OMEGA
    const [r, g, b] = hsvToRgb(i / DRONE_COUNT + t / DEMO_LOOP_SEC, 0.8, 1)
    droneRgb[3 * i] = r
    droneRgb[3 * i + 1] = g
    droneRgb[3 * i + 2] = b
  }

  // Laser: one lissajous frame in projector space [-1, 1]².
  const points: LaserPoint[] = []
  for (let i = 0; i < LASER_POINTS; i++) {
    const a = (i / LASER_POINTS) * 2 * Math.PI
    const [r, g, b] = hsvToRgb(0.45 + 0.1 * Math.sin(a + 2 * OMEGA * t), 0.85, 1)
    points.push({
      x: Math.sin(3 * a + 4 * OMEGA * t),
      y: 0.85 * Math.sin(2 * a + 6 * OMEGA * t),
      r, g, b,
      blank: i % 32 === 0, // a few blanked hops exercise segment splitting
    })
  }

  // Panel: 64×32 plasma, RGB bytes.
  const panelRgb = new Uint8Array(PANEL_W * PANEL_H * 3)
  for (let y = 0; y < PANEL_H; y++) {
    for (let x = 0; x < PANEL_W; x++) {
      const v =
        Math.sin(x * 0.35 + 8 * OMEGA * t) +
        Math.sin(y * 0.5 - 6 * OMEGA * t) +
        Math.sin((x + y) * 0.22 + 4 * OMEGA * t)
      const n = v / 6 + 0.5 // → [0, 1]
      const [r, g, b] = hsvToRgb(0.55 + 0.35 * n, 0.75, 0.25 + 0.75 * n)
      const o = (y * PANEL_W + x) * 3
      panelRgb[o] = Math.round(r * 255)
      panelRgb[o + 1] = Math.round(g * 255)
      panelRgb[o + 2] = Math.round(b * 255)
    }
  }

  // Single demo listener: bursts dominate, silence otherwise.
  let spl = -Infinity
  for (const { age } of bursting) {
    spl = Math.max(spl, 94 - 30 * (age / STAR_LIFE_SEC))
  }

  return {
    t,
    step: Math.round(t * SIM_STEP_HZ),
    shells: { count: shellCount, pos: shellPos, cueIdx: shellCue },
    stars: {
      count: starCount,
      pos: starPos,
      rgb: starRgb,
      brightness: starBrightness,
      sizeM: starSize,
    },
    drones: {
      count: DRONE_COUNT,
      pos: dronePos,
      vel: droneVel,
      rgb: droneRgb,
      minSeparationM: 4.5,
    },
    laserFrames: [{ assetId: LASER_ASSET_ID, points }],
    panelFrames: [{ assetId: PANEL_ASSET_ID, w: PANEL_W, h: PANEL_H, rgb: panelRgb }],
    crowd: { cellCount: 0, rgb: new Float32Array(0), white: new Float32Array(0) },
    beams: [],
    splByListener: [spl],
  }
}
