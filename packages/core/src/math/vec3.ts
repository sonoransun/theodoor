import type { Vec3 } from '../contracts.js'

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

export const add3 = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub3 = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale3 = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s)
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)

export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a)
  return l === 0 ? v3(0, 0, 0) : scale3(a, 1 / l)
}
