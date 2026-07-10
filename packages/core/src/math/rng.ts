/** Deterministic PRNG + hashing. Identical seeds must reproduce identical shows. */

export type Rng = () => number

/** mulberry32 — fast, well-distributed 32-bit PRNG returning [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit string hash. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Per-cue seed derived only from (showSeed, cueId) — replay/seek can't perturb it. */
export function cueSeed(showSeed: number, cueId: string): number {
  return fnv1a32(`${showSeed >>> 0}:${cueId}`)
}

/** Fork an independent labeled stream from a parent seed. */
export function forkSeed(seed: number, label: string): number {
  return fnv1a32(`${seed >>> 0}/${label}`)
}
