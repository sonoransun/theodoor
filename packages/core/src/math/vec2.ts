import type { Vec2 } from '../contracts.js'

export const v2 = (x: number, y: number): Vec2 => ({ x, y })

export const sub2 = (a: Vec2, b: Vec2): Vec2 => v2(a.x - b.x, a.y - b.y)
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Distance from point p to the segment a–b. */
export function distPointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return dist2(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
}

/** Distance from point p to a polyline (≥ 1 point; single point = point distance). */
export function distPointToPolyline(p: Vec2, line: readonly Vec2[]): number {
  if (line.length === 0) return Infinity
  const first = line[0]!
  if (line.length === 1) return dist2(p, first)
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    best = Math.min(best, distPointToSegment(p, line[i]!, line[i + 1]!))
  }
  return best
}

/** Ray-cast point-in-polygon (boundary counts as inside for our purposes). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (distPointToSegment(p, a, b) < 1e-9) return true
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

/** Distance from point p to the polygon boundary (0 only on the boundary). */
export function distPointToPolygonBoundary(p: Vec2, poly: readonly Vec2[]): number {
  if (poly.length < 2) return Infinity
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, distPointToSegment(p, poly[i]!, poly[j]!))
  }
  return best
}

/** True if a circle (center c, radius r) intersects or lies inside the polygon. */
export function circleIntersectsPolygon(c: Vec2, r: number, poly: readonly Vec2[]): boolean {
  if (poly.length < 3) return false
  if (pointInPolygon(c, poly)) return true
  return distPointToPolygonBoundary(c, poly) <= r
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** Proper or touching segment intersection. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  if (o1 * o2 < 0 && o3 * o4 < 0) return true
  const on = (p: Vec2, q: Vec2, r: Vec2) =>
    orient(p, q, r) === 0 &&
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y)
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)
}
