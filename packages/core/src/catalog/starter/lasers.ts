/**
 * starter/lasers.ts — laser primitives, one per LaserShape.
 *
 * Lasers are near-silent (scanner hum only), so every entry is 'low-noise'.
 * pointsPerFrame is the scan budget the sim samples the parametric curve at.
 * Colors are CSS hex strings.
 */

import type { LaserPrimitive } from '../../contracts.js'

export const LASER_EFFECTS: readonly LaserPrimitive[] = [
  {
    id: 'laser-fan-rgb',
    name: 'RGB Beam Fan',
    medium: 'laser',
    tags: ['low-noise', 'beam', 'red', 'blue'],
    noiseDbAt15m: 56,
    durationSec: 8,
    shape: 'beamFan',
    pointsPerFrame: 64,
    colors: ['#ff2a2a', '#2aff5e', '#2a6bff'],
  },
  {
    id: 'laser-cone-green',
    name: 'Green Sky Cone',
    medium: 'laser',
    tags: ['low-noise', 'aerial'],
    noiseDbAt15m: 55,
    durationSec: 8,
    shape: 'cone',
    pointsPerFrame: 128,
    colors: ['#22ff55'],
  },
  {
    id: 'laser-tunnel-blue',
    name: 'Blue Tunnel',
    medium: 'laser',
    tags: ['low-noise', 'blue', 'aerial'],
    noiseDbAt15m: 55,
    durationSec: 10,
    shape: 'tunnel',
    pointsPerFrame: 256,
    colors: ['#2266ff', '#66ccff'],
  },
  {
    id: 'laser-lissajous-rgb',
    name: 'Lissajous Weave',
    medium: 'laser',
    tags: ['low-noise', 'abstract'],
    noiseDbAt15m: 56,
    durationSec: 12,
    shape: 'lissajous',
    pointsPerFrame: 512,
    colors: ['#ff2a2a', '#ffd24d', '#2a6bff'],
  },
  {
    id: 'laser-sweep-gold',
    name: 'Gold Horizon Sweep',
    medium: 'laser',
    tags: ['low-noise', 'gold'],
    noiseDbAt15m: 55,
    durationSec: 6,
    shape: 'sweep',
    pointsPerFrame: 96,
    colors: ['#ffcc44'],
  },
  {
    id: 'laser-starfield-white',
    name: 'White Starfield',
    medium: 'laser',
    tags: ['low-noise', 'white', 'ambient'],
    noiseDbAt15m: 55,
    durationSec: 12,
    shape: 'starfield',
    pointsPerFrame: 300,
    colors: ['#ffffff'],
  },
  {
    id: 'laser-chevron-red',
    name: 'Red Chevron Pulse',
    medium: 'laser',
    tags: ['low-noise', 'red', 'accent'],
    noiseDbAt15m: 55,
    durationSec: 8,
    shape: 'chevron',
    pointsPerFrame: 120,
    colors: ['#ff3333'],
  },

  // ---- appended entries (append-only: golden fixtures depend on order) -----
  {
    id: 'laser-helix-green',
    name: 'Green Helix Climb',
    medium: 'laser',
    tags: ['low-noise', 'green', 'aerial'],
    noiseDbAt15m: 55,
    durationSec: 10,
    shape: 'helix',
    pointsPerFrame: 256,
    colors: ['#22ff55'],
  },
  {
    id: 'laser-web-violet',
    name: 'Violet Sky Web',
    medium: 'laser',
    tags: ['low-noise', 'violet', 'abstract'],
    noiseDbAt15m: 56,
    durationSec: 10,
    shape: 'web',
    pointsPerFrame: 300,
    colors: ['#8f4dff'],
  },
  {
    id: 'laser-aurora-curtain',
    name: 'Aurora Curtain',
    medium: 'laser',
    tags: ['low-noise', 'green', 'ambient'],
    noiseDbAt15m: 55,
    durationSec: 14,
    shape: 'curtain',
    pointsPerFrame: 200,
    colors: ['#41d68c', '#3aa7d9', '#8f6fd9'],
  },
]
