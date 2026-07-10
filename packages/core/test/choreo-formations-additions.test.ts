import { describe, expect, it } from 'vitest'
import {
  bat,
  cometTail,
  crescent,
  formationFromEffect,
  ghost,
  orrery,
  ring,
  saucer,
  snowflake,
  spiral,
} from '../src/choreo/index.js'
import type { DroneFormationKind, DronePrimitive, Formation, FormationPoint } from '../src/contracts.js'

function bboxSpan(points: readonly FormationPoint[]): { dx: number; dz: number } {
  const xs = points.map((p) => p.x)
  const zs = points.map((p) => p.z)
  return {
    dx: Math.max(...xs) - Math.min(...xs),
    dz: Math.max(...zs) - Math.min(...zs),
  }
}

/** Every new factory, closed over fixed args so calls can repeat verbatim. */
const FACTORIES: readonly [string, (n: number) => Formation][] = [
  ['bat', (n) => bat(n, 40)],
  ['ghost', (n) => ghost(n, 40, 11)],
  ['spiral', (n) => spiral(n, 20, 11)],
  ['cometTail', (n) => cometTail(n, 40, 11)],
  ['saucer', (n) => saucer(n, 40)],
  ['orrery', (n) => orrery(n, 20)],
  ['crescent', (n) => crescent(n, 20)],
  ['snowflake', (n) => snowflake(n, 40)],
]

describe('new formation factories', () => {
  it('return exactly n points for varied n', () => {
    for (const [name, make] of FACTORIES) {
      for (const n of [24, 60, 97]) {
        expect(make(n).points.length, `${name}(${n})`).toBe(n)
      }
    }
  })

  it('are deterministic: two identical calls agree exactly', () => {
    for (const [name, make] of FACTORIES) {
      expect(make(60), name).toEqual(make(60))
    }
  })

  it('are non-degenerate (positive bbox span) and planar (y = 0)', () => {
    for (const [name, make] of FACTORIES) {
      const f = make(60)
      const { dx, dz } = bboxSpan(f.points)
      expect(dx, `${name} x span`).toBeGreaterThan(0)
      expect(dz, `${name} z span`).toBeGreaterThan(0)
      for (const p of f.points) expect(p.y, `${name} planar`).toBe(0)
    }
  })

  it('names follow the kind-n convention', () => {
    for (const [name, make] of FACTORIES) {
      expect(make(60).name).toBe(`${name}-60`)
    }
  })

  it('spiral stays within the outer radius (with jitter headroom) and seed matters', () => {
    const R = 20
    const f = spiral(80, R, 11)
    for (const p of f.points) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(R * 1.05)
    }
    expect(spiral(80, R, 12).points).not.toEqual(f.points)
  })

  it('cometTail concentrates ~30% of points near the head', () => {
    const f = cometTail(100, 40, 11)
    // The head sits at the +x end after centering; count points in the
    // rightmost fifth of the bbox — the tight head cluster lands there.
    const xs = f.points.map((p) => p.x)
    const cut = Math.min(...xs) + 0.8 * (Math.max(...xs) - Math.min(...xs))
    const nearHead = f.points.filter((p) => p.x >= cut).length
    expect(nearHead).toBeGreaterThanOrEqual(25)
  })

  it('crescent leaves the offset disc as a void and keeps points on the rim', () => {
    const R = 30
    const f = crescent(60, R)
    for (const p of f.points) {
      // On the original rim…
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(R, 9)
      // …and never inside the same-size disc offset by 0.55·R in +x.
      expect(Math.hypot(p.x - 0.55 * R, p.z)).toBeGreaterThanOrEqual(R - 1e-9)
    }
  })

  it('orrery has points on all three nested rings plus a hub', () => {
    const R = 20
    const f = orrery(80, R)
    const radii = f.points.map((p) => Math.hypot(p.x, p.z))
    for (const fr of [0.45, 0.7, 1]) {
      expect(radii.some((r) => Math.abs(r - fr * R) < 1e-9), `ring ${fr}`).toBe(true)
    }
    expect(radii.some((r) => r < 0.2 * R), 'hub').toBe(true)
  })

  it('snowflake is six-fold: rotating by 60 degrees maps the set onto itself', () => {
    const f = snowflake(90, 40) // 90 = 15 per arm → symmetric split
    const c = Math.cos(Math.PI / 3)
    const s = Math.sin(Math.PI / 3)
    for (const p of f.points) {
      const rx = p.x * c - p.z * s
      const rz = p.x * s + p.z * c
      const hit = f.points.some((q) => Math.hypot(q.x - rx, q.z - rz) < 1e-6)
      expect(hit).toBe(true)
    }
  })

  it('bat is denser toward the wing leading edges than the trailing edges', () => {
    const f = bat(120, 40)
    const zs = f.points.map((p) => p.z)
    const mid = (Math.max(...zs) + Math.min(...zs)) / 2
    const upper = f.points.filter((p) => p.z >= mid).length
    expect(upper).toBeGreaterThan(120 - upper)
  })

  it('ghost keeps both eye voids dark (no points inside the eye discs)', () => {
    const S = 40
    const f = ghost(120, S, 11)
    for (const p of f.points) {
      for (const ex of [-0.13 * S, 0.13 * S]) {
        expect(Math.hypot(p.x - ex, p.z - 0.22 * S)).toBeGreaterThanOrEqual(0.07 * S - 1e-9)
      }
    }
  })
})

describe('formationFromEffect — new kinds', () => {
  function droneEffect(formation: DroneFormationKind): DronePrimitive {
    return {
      id: `drone-${formation}`, name: `Drone ${formation}`, medium: 'drone',
      tags: [], noiseDbAt15m: 52, durationSec: 10,
      formation, minDrones: 10, maxDrones: 200, scaleM: 40,
    }
  }

  const KINDS: readonly DroneFormationKind[] = [
    'bat', 'ghost', 'spiral', 'cometTail', 'saucer', 'orrery', 'crescent', 'snowflake',
  ]

  it('maps each kind to its factory (name matches) with the requested count', () => {
    for (const kind of KINDS) {
      const f = formationFromEffect(droneEffect(kind), { count: 80 }, 42)
      expect(f.name).toBe(`${kind}-80`)
      expect(f.points.length).toBe(80)
    }
  })

  it('is deterministic for identical (effect, params, seed)', () => {
    for (const kind of KINDS) {
      const a = formationFromEffect(droneEffect(kind), { count: 60 }, 42)
      const b = formationFromEffect(droneEffect(kind), { count: 60 }, 42)
      expect(b).toEqual(a)
    }
  })

  it('applies the rgb param to every point', () => {
    const f = formationFromEffect(droneEffect('saucer'), { count: 40, rgb: [0.2, 0.9, 0.4] }, 42)
    for (const p of f.points) {
      expect([p.r, p.g, p.b]).toEqual([0.2, 0.9, 0.4])
    }
  })

  it('sanity: existing ring mapping is untouched by the additions', () => {
    const f = formationFromEffect(droneEffect('ring' as DroneFormationKind), { count: 24 }, 42)
    expect(f.name).toBe('ring-24')
    expect(f.points).toEqual(ring(24, 20).points)
  })
})
