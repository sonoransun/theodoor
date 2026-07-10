/**
 * Formation generators — pure functions producing drone point clouds.
 *
 * Deterministic: any randomness comes from explicit seeds (mulberry32); the
 * same inputs always yield the same Formation.
 *
 * Conventions:
 * - Planar formations (grid, ring, star, heart, flag, digit, text, clockRing,
 *   bat, ghost, spiral, cometTail, saucer, orrery, crescent, snowflake) lie in
 *   the x–z plane (y = 0, z up) centered on the origin; callers
 *   translate/elevate them into the sky box.
 *   - Outline shapes with a natural center (ring, star, clockRing) are
 *     centered on their circumcenter; filled/asymmetric shapes (heart,
 *     digit, text) are centered on their bounding-box midpoint.
 * - scatter and bloom are volumetric (y varies), also centered on the origin.
 * - Optional per-point r/g/b (0..1) carries color (flag bands, canton).
 */

import type { Formation, FormationPoint, Vec3 } from '../../contracts.js'
import { fnv1a32, mulberry32 } from '../../math/index.js'
import { textCells } from '../../text/index.js'

/** Jitter half-range (meters, per axis) used when upsampling duplicates. */
export const RESAMPLE_JITTER_M = 0.5

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Evenly resample a CLOSED outline (verts joined last→first) by arc length. */
function resampleClosedOutline(verts: readonly FormationPoint[], n: number): FormationPoint[] {
  const m = verts.length
  const out: FormationPoint[] = []
  if (n <= 0 || m === 0) return out
  const edgeLen: number[] = []
  let total = 0
  for (let i = 0; i < m; i++) {
    const a = verts[i]!
    const b = verts[(i + 1) % m]!
    const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    edgeLen.push(l)
    total += l
  }
  if (total === 0) {
    for (let i = 0; i < n; i++) out.push({ ...verts[0]! })
    return out
  }
  let edge = 0
  let edgeStart = 0
  for (let i = 0; i < n; i++) {
    const s = (i * total) / n
    while (edge < m - 1 && edgeStart + edgeLen[edge]! < s - 1e-12) {
      edgeStart += edgeLen[edge]!
      edge++
    }
    const a = verts[edge]!
    const b = verts[(edge + 1) % m]!
    const l = edgeLen[edge]!
    const t = l === 0 ? 0 : Math.min(1, Math.max(0, (s - edgeStart) / l))
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
  }
  return out
}

const fract = (x: number): number => x - Math.floor(x)

/** Golden-angle increment used by the deterministic disc fill. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Deterministic elliptical disc fill (phyllotaxis / sunflower spiral): count
 * points quasi-evenly covering an ellipse with half-axes rx (x) and rz (z),
 * centered at (cx, cz) in the x–z plane. No seed needed — the golden-angle
 * spiral is already uniform and irregular-looking.
 */
function disc(count: number, rx: number, rz: number, cx = 0, cz = 0): FormationPoint[] {
  const points: FormationPoint[] = []
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count)
    const th = i * GOLDEN_ANGLE
    points.push({ x: cx + rx * r * Math.cos(th), y: 0, z: cz + rz * r * Math.sin(th) })
  }
  return points
}

/** Translate points so the x/z bounding-box midpoint sits on the origin. */
function centerXZ(points: FormationPoint[]): FormationPoint[] {
  if (points.length === 0) return points
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  return points.map((p) => ({ ...p, x: p.x - cx, z: p.z - cz }))
}

// ---------------------------------------------------------------------------
// Formations
// ---------------------------------------------------------------------------

/** rows × cols lattice in the x–z plane; row 0 is the TOP row (max z). */
export function grid(rows: number, cols: number, spacingM: number): Formation {
  const points: FormationPoint[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({
        x: (c - (cols - 1) / 2) * spacingM,
        y: 0,
        z: ((rows - 1) / 2 - r) * spacingM,
      })
    }
  }
  return { name: `grid-${rows}x${cols}`, points }
}

/** n points evenly spaced on a circle of the given radius. */
export function ring(n: number, radiusM: number): Formation {
  const points: FormationPoint[] = []
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n
    points.push({ x: radiusM * Math.cos(th), y: 0, z: radiusM * Math.sin(th) })
  }
  return { name: `ring-${n}`, points }
}

/**
 * Five-pointed star: the classic 10-vertex outline (alternating outer/inner
 * radii, one point straight up) evenly resampled by arc length to n points.
 */
export function star(n: number, outerR: number, innerR: number): Formation {
  const verts: FormationPoint[] = []
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? outerR : innerR
    const th = Math.PI / 2 + (k * Math.PI) / 5
    verts.push({ x: r * Math.cos(th), y: 0, z: r * Math.sin(th) })
  }
  return { name: `star-${n}`, points: resampleClosedOutline(verts, n) }
}

/**
 * Parametric heart outline x = 16·sin³t, z = 13·cos t − 5·cos 2t − 2·cos 3t
 * − cos 4t, multiplied by `scale` (raw curve is ~32 units wide), arc-length
 * resampled to n points and bounding-box centered.
 */
export function heart(n: number, scale: number): Formation {
  const M = 512
  const raw: FormationPoint[] = []
  for (let i = 0; i < M; i++) {
    const t = (2 * Math.PI * i) / M
    const x = 16 * Math.sin(t) ** 3
    const z = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    raw.push({ x: x * scale, y: 0, z: z * scale })
  }
  return { name: `heart-${n}`, points: centerXZ(resampleClosedOutline(raw, n)) }
}

/** Optional corner block (e.g. a flag canton) occupying the top-left cells. */
export interface CantonSpec {
  cols: number
  rows: number
  rgb: readonly [number, number, number]
}

/**
 * Filled cols × rows flag with horizontal color bands. `bandColors` are
 * listed top-to-bottom; row r (0 = top) takes band ⌊r·bands/rows⌋. A canton
 * overrides the top-left `canton.cols × canton.rows` cells (e.g. a US flag is
 * 13 stripe bands plus a canton block).
 */
export function flag(
  cols: number,
  rows: number,
  spacingM: number,
  bandColors: readonly (readonly [number, number, number])[],
  canton?: CantonSpec,
): Formation {
  const points: FormationPoint[] = []
  const bands = bandColors.length
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inCanton = canton !== undefined && r < canton.rows && c < canton.cols
      const band = bands === 0 ? undefined : bandColors[Math.min(bands - 1, Math.floor((r * bands) / rows))]
      const rgb = inCanton ? canton.rgb : band
      const p: FormationPoint = {
        x: (c - (cols - 1) / 2) * spacingM,
        y: 0,
        z: ((rows - 1) / 2 - r) * spacingM,
      }
      if (rgb) {
        p.r = rgb[0]
        p.g = rgb[1]
        p.b = rgb[2]
      }
      points.push(p)
    }
  }
  return { name: `flag-${rows}x${cols}`, points }
}

/**
 * Text rendered with the shared 5×7 font: lit cells become points, y-flipped
 * (font y grows down, world z grows up), scaled by `scale` meters per cell,
 * centered on the lit-cell bounding box, then resampled to exactly n points
 * (deterministic seed derived from the string and n).
 */
export function text(s: string, n: number, scale: number): Formation {
  const { cells } = textCells(s)
  const pts: FormationPoint[] = []
  if (cells.length > 0) {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const c of cells) {
      if (c.x < minX) minX = c.x
      if (c.x > maxX) maxX = c.x
      if (c.y < minY) minY = c.y
      if (c.y > maxY) maxY = c.y
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    for (const c of cells) {
      pts.push({ x: (c.x - cx) * scale, y: 0, z: (cy - c.y) * scale })
    }
  }
  return { name: `text-${s}`, points: resampleTo(pts, n, fnv1a32(`text:${s}:${n}`)) }
}

/** Single decimal digit (d taken mod 10) via the text formation. */
export function digit(d: number, n: number, scale: number): Formation {
  const ch = String(Math.trunc(Math.abs(d)) % 10)
  const f = text(ch, n, scale)
  return { name: `digit-${ch}`, points: f.points }
}

/**
 * Clock-face ring: when n allows (n ≥ 48), 12 hour marks get two inner tick
 * points each (radii 0.8·R and 0.9·R, 12 o'clock straight up) and the rest
 * spread evenly on the rim; otherwise a plain rim ring.
 */
export function clockRing(n: number, radiusM: number): Formation {
  const HOURS = 12
  const points: FormationPoint[] = []
  if (n >= HOURS * 4) {
    for (let h = 0; h < HOURS; h++) {
      const th = Math.PI / 2 - (2 * Math.PI * h) / HOURS
      for (const f of [0.8, 0.9] as const) {
        points.push({ x: radiusM * f * Math.cos(th), y: 0, z: radiusM * f * Math.sin(th) })
      }
    }
  }
  const rest = n - points.length
  for (let i = 0; i < rest; i++) {
    const th = Math.PI / 2 - (2 * Math.PI * i) / rest
    points.push({ x: radiusM * Math.cos(th), y: 0, z: radiusM * Math.sin(th) })
  }
  return { name: `clockRing-${n}`, points }
}

/** n seeded-uniform points inside a centered box of the given extents. */
export function scatter(n: number, box: Vec3, seed: number): Formation {
  const rng = mulberry32(seed)
  const points: FormationPoint[] = []
  for (let i = 0; i < n; i++) {
    points.push({ x: (rng() - 0.5) * box.x, y: (rng() - 0.5) * box.y, z: (rng() - 0.5) * box.z })
  }
  return { name: `scatter-${n}`, points }
}

/** n seeded points uniformly distributed on a sphere surface of radius R. */
export function bloom(n: number, radiusM: number, seed: number): Formation {
  const rng = mulberry32(seed)
  const points: FormationPoint[] = []
  for (let i = 0; i < n; i++) {
    const w = 2 * rng() - 1
    const phi = 2 * Math.PI * rng()
    const s = Math.sqrt(Math.max(0, 1 - w * w))
    points.push({
      x: radiusM * s * Math.cos(phi),
      y: radiusM * s * Math.sin(phi),
      z: radiusM * w,
    })
  }
  return { name: `bloom-${n}`, points }
}

/**
 * Bat silhouette: a small elliptical body cluster plus two mirrored swept
 * triangular wings. Wing points crowd the leading (upper) edge — the chord
 * offset uses a squared low-discrepancy sequence so density falls off toward
 * the trailing edge. Planar, ~`scale` wide, bounding-box centered.
 */
export function bat(n: number, scale: number): Formation {
  const S = scale
  const PHI = 0.6180339887498949
  const nBody = Math.min(n, Math.max(3, Math.round(n * 0.14)))
  const rest = n - nBody
  const nRight = Math.ceil(rest / 2)
  const nLeft = rest - nRight
  const points: FormationPoint[] = disc(nBody, 0.07 * S, 0.11 * S)
  const wing = (m: number, side: 1 | -1): void => {
    for (let i = 0; i < m; i++) {
      const a = (i + 0.5) / m // span fraction, shoulder → tip
      const v = fract(i * PHI)
      const zLead = (0.06 + 0.1 * a) * S // leading edge sweeps up and out
      const depth = 0.3 * (1 - 0.75 * a) * S // chord shrinks → triangular tip
      points.push({ x: side * (0.06 + 0.44 * a) * S, y: 0, z: zLead - v * v * depth })
    }
  }
  wing(nRight, 1)
  wing(nLeft, -1)
  return { name: `bat-${n}`, points: centerXZ(points) }
}

/**
 * Draped-sheet ghost: a closed outline (semicircular dome, straight sides,
 * wavy hem with 3–4 seeded scallops) plus three wavy interior fold lines,
 * with two eye voids left dark by dropping any point inside the eye discs
 * (centers (±0.13, 0.22)·scale, radius 0.07·scale), then resampled to n.
 * The raw cloud always exceeds n so resampling only ever subsamples.
 */
export function ghost(n: number, scale: number, seed: number): Formation {
  const S = scale
  const rng = mulberry32(seed)
  const scallops = 3 + Math.floor(rng() * 2)
  const R = 0.35 * S // half width
  const topZ = 0.15 * S // dome center height
  const hemZ = -0.35 * S
  const budget = Math.max(96, 2 * n)

  // Closed outline: left side up, dome across, right side down, hem back.
  const verts: FormationPoint[] = []
  const SIDE = 12
  for (let i = 0; i < SIDE; i++) {
    verts.push({ x: -R, y: 0, z: hemZ + ((topZ - hemZ) * i) / SIDE })
  }
  const DOME = 40
  for (let i = 0; i < DOME; i++) {
    const th = Math.PI - (Math.PI * i) / DOME
    verts.push({ x: R * Math.cos(th), y: 0, z: topZ + R * Math.sin(th) })
  }
  for (let i = 0; i < SIDE; i++) {
    verts.push({ x: R, y: 0, z: topZ - ((topZ - hemZ) * i) / SIDE })
  }
  const HEM = 40
  for (let i = 0; i < HEM; i++) {
    const u = i / HEM
    verts.push({ x: R - 2 * R * u, y: 0, z: hemZ + 0.07 * S * Math.abs(Math.sin(scallops * Math.PI * u)) })
  }
  const raw = resampleClosedOutline(verts, Math.round(budget * 0.7))

  // Three interior fold lines (the drape), each with its own seeded waviness.
  const nFold = Math.floor((budget - raw.length) / 3)
  for (const fx of [-0.15, 0, 0.15] as const) {
    const phase = rng() * 2 * Math.PI
    for (let i = 0; i < nFold; i++) {
      const v = (i + 0.5) / nFold
      raw.push({
        x: fx * S + 0.02 * S * Math.sin(3 * Math.PI * v + phase),
        y: 0,
        z: 0.32 * S - v * 0.62 * S,
      })
    }
  }

  const kept = raw.filter((p) => {
    for (const ex of [-0.13 * S, 0.13 * S]) {
      if (Math.hypot(p.x - ex, p.z - 0.22 * S) < 0.07 * S) return false
    }
    return true
  })
  return { name: `ghost-${n}`, points: resampleTo(kept, n, fnv1a32(`ghost:${seed}:${n}`)) }
}

/**
 * Two-arm logarithmic spiral, ~2 turns per arm, arms offset by π, with a
 * slight seeded radial jitter (±4%) so the arms read as dusty rather than
 * drafted. Outer radius = `radius`; planar.
 */
export function spiral(n: number, radius: number, seed: number): Formation {
  const rng = mulberry32(seed)
  const TURNS = 2
  const r0 = radius * 0.05
  const k = Math.log(radius / r0) / (TURNS * 2 * Math.PI)
  const points: FormationPoint[] = []
  const arm = (m: number, offset: number): void => {
    for (let i = 0; i < m; i++) {
      const t = ((i + 0.5) / m) * TURNS * 2 * Math.PI
      const r = r0 * Math.exp(k * t) * (1 + (rng() - 0.5) * 0.08)
      points.push({ x: r * Math.cos(t + offset), y: 0, z: r * Math.sin(t + offset) })
    }
  }
  const half = Math.ceil(n / 2)
  arm(half, 0)
  arm(n - half, Math.PI)
  return { name: `spiral-${n}`, points }
}

/**
 * Comet: a tight seeded-gaussian head (~30% of points) with a tail streaming
 * behind along −x, its scatter widening with distance from the head. Total
 * length ≈ `scale`; planar, bounding-box centered.
 */
export function cometTail(n: number, scale: number, seed: number): Formation {
  const rng = mulberry32(seed)
  const gauss = (): number =>
    Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())
  const nHead = Math.min(n, Math.max(1, Math.round(n * 0.3)))
  const points: FormationPoint[] = []
  for (let i = 0; i < nHead; i++) {
    points.push({ x: gauss() * 0.045 * scale, y: 0, z: gauss() * 0.045 * scale })
  }
  const nTail = n - nHead
  for (let i = 0; i < nTail; i++) {
    const u = (i + 0.5) / nTail
    points.push({
      x: -u * 0.95 * scale + gauss() * 0.02 * scale,
      y: 0,
      z: gauss() * (0.03 + 0.12 * u) * scale,
    })
  }
  return { name: `cometTail-${n}`, points: centerXZ(points) }
}

/**
 * Lenticular saucer: a dense elliptical rim ring (half the points), a sparse
 * elliptical body fill, and a small dome arc on top. Planar, `scale` wide.
 */
export function saucer(n: number, scale: number): Formation {
  const a = 0.5 * scale
  const b = 0.16 * scale
  const nRim = Math.min(n, Math.max(6, Math.round(n * 0.5)))
  const nDome = Math.max(0, Math.min(n - nRim, Math.max(3, Math.round(n * 0.15))))
  const nBody = n - nRim - nDome
  const points: FormationPoint[] = []
  for (let i = 0; i < nRim; i++) {
    const th = (2 * Math.PI * i) / nRim
    points.push({ x: a * Math.cos(th), y: 0, z: b * Math.sin(th) })
  }
  points.push(...disc(nBody, 0.8 * a, 0.8 * b))
  for (let i = 0; i < nDome; i++) {
    const th = (Math.PI * (i + 0.5)) / nDome // upper half-arc only
    points.push({ x: 0.18 * scale * Math.cos(th), y: 0, z: 0.1 * scale + 0.14 * scale * Math.sin(th) })
  }
  return { name: `saucer-${n}`, points }
}

/**
 * Orrery: a central hub cluster (~15% of points) inside three nested rings at
 * 0.45/0.7/1.0 of `radius` (a generalization of clockRing; ring points come
 * from ring()). Ring counts split proportionally to circumference.
 */
export function orrery(n: number, radius: number): Formation {
  const nHub = Math.min(n, Math.max(3, Math.round(n * 0.15)))
  const rest = n - nHub
  const FR = [0.45, 0.7, 1] as const
  const wSum = FR[0] + FR[1] + FR[2]
  const c0 = Math.round((rest * FR[0]) / wSum)
  const c1 = Math.round((rest * FR[1]) / wSum)
  const c2 = rest - c0 - c1
  const points: FormationPoint[] = disc(nHub, 0.12 * radius, 0.12 * radius)
  for (const [count, fr] of [[c0, FR[0]], [c1, FR[1]], [c2, FR[2]]] as const) {
    points.push(...ring(count, fr * radius).points)
  }
  return { name: `orrery-${n}`, points }
}

/**
 * Crescent moon: points on a ring of the given radius, keeping only those NOT
 * inside the same-size disc offset by 0.55·radius in +x, then resampled to
 * exactly n (deterministic seed from n). Every output point sits on the
 * original rim, so the offset disc is a guaranteed void.
 */
export function crescent(n: number, radius: number): Formation {
  const M = Math.max(24, 3 * n)
  const kept = ring(M, radius).points.filter(
    (p) => Math.hypot(p.x - 0.55 * radius, p.z) >= radius,
  )
  return { name: `crescent-${n}`, points: resampleTo(kept, n, fnv1a32(`crescent:${n}`)) }
}

/**
 * Six-fold dendrite snowflake: 6 main arms (spokes of length scale/2), each
 * with two pairs of mirrored side branches at 45% and 70% of the spine.
 * Points are spread over all segments proportionally to length via cumulative
 * rounding, so the total is exactly n. Planar.
 */
export function snowflake(n: number, scale: number): Formation {
  const L = scale / 2
  const BR = (50 * Math.PI) / 180 // branch angle off the spine
  type Seg = readonly [number, number, number, number] // x0, z0, x1, z1
  const arm: Seg[] = [[0, 0, 0, L]]
  for (const [at, len] of [[0.45, 0.3], [0.7, 0.2]] as const) {
    for (const side of [1, -1] as const) {
      arm.push([0, at * L, side * Math.sin(BR) * len * L, at * L + Math.cos(BR) * len * L])
    }
  }
  const segs: Seg[] = []
  for (let k = 0; k < 6; k++) {
    const th = (k * Math.PI) / 3
    const cos = Math.cos(th)
    const sin = Math.sin(th)
    for (const [x0, z0, x1, z1] of arm) {
      segs.push([x0 * cos - z0 * sin, x0 * sin + z0 * cos, x1 * cos - z1 * sin, x1 * sin + z1 * cos])
    }
  }
  const lens = segs.map(([x0, z0, x1, z1]) => Math.hypot(x1 - x0, z1 - z0))
  const total = lens.reduce((s, l) => s + l, 0)
  const points: FormationPoint[] = []
  let acc = 0
  let placed = 0
  for (let j = 0; j < segs.length; j++) {
    acc += lens[j]!
    const upto = Math.round((acc / total) * n)
    const cnt = upto - placed
    const [x0, z0, x1, z1] = segs[j]!
    for (let s = 0; s < cnt; s++) {
      const t = (s + 0.5) / cnt
      points.push({ x: x0 + (x1 - x0) * t, y: 0, z: z0 + (z1 - z0) * t })
    }
    placed = upto
  }
  return { name: `snowflake-${n}`, points }
}

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------

/**
 * Resample a point set to exactly n points, deterministically:
 * - n < |points|: farthest-point subsample (seeded start index, then greedily
 *   add the point maximizing its minimum distance to the chosen set; ties go
 *   to the lowest index). Every output point is one of the inputs.
 * - n > |points|: duplicate-with-jitter — cycle the inputs appending copies
 *   offset by seeded uniform jitter of ±RESAMPLE_JITTER_M on x and z (y kept,
 *   so planar formations stay planar). The first |points| outputs are the
 *   unmodified inputs.
 * - n === |points|: shallow copies in input order.
 * - Empty input with n > 0 yields n origin points (degenerate but total).
 * Per-point colors (r/g/b) are preserved.
 */
export function resampleTo(
  points: readonly FormationPoint[],
  n: number,
  seed: number,
): FormationPoint[] {
  if (n <= 0) return []
  if (points.length === 0) {
    return Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }))
  }
  if (n === points.length) return points.map((p) => ({ ...p }))
  const rng = mulberry32(seed)
  if (n < points.length) {
    const m = points.length
    const start = Math.floor(rng() * m) % m
    const used: boolean[] = new Array(m).fill(false)
    used[start] = true
    const chosen: number[] = [start]
    const d2To = (a: FormationPoint, b: FormationPoint): number => {
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dz = a.z - b.z
      return dx * dx + dy * dy + dz * dz
    }
    const minD: number[] = points.map((p) => d2To(p, points[start]!))
    while (chosen.length < n) {
      let best = -1
      let bestD = -1
      for (let i = 0; i < m; i++) {
        if (!used[i] && minD[i]! > bestD) {
          bestD = minD[i]!
          best = i
        }
      }
      used[best] = true
      chosen.push(best)
      for (let i = 0; i < m; i++) {
        if (!used[i]) {
          const d = d2To(points[i]!, points[best]!)
          if (d < minD[i]!) minD[i] = d
        }
      }
    }
    return chosen.map((i) => ({ ...points[i]! }))
  }
  // Upsample: duplicate with jitter.
  const out: FormationPoint[] = points.map((p) => ({ ...p }))
  let i = 0
  while (out.length < n) {
    const p = points[i % points.length]!
    out.push({
      ...p,
      x: p.x + (rng() * 2 - 1) * RESAMPLE_JITTER_M,
      z: p.z + (rng() * 2 - 1) * RESAMPLE_JITTER_M,
    })
    i++
  }
  return out
}
