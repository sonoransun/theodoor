/**
 * starter/fountains.ts — illuminated water-jet programs for the fountain
 * banks, performance metadata only (crest height, nozzle count, column
 * width, lighting colors, water noise).
 *
 * Water is quiet: a 40 m shooter reads ~70 dB at the reference distance, so
 * every entry is 'low-noise' and legal in quiet variants. The solver's
 * anticipation is the valve latency plus sqrt(2·heightM / g) — the column is
 * commanded early so it CRESTS on the beat.
 */

import type { FountainEffect } from '../../contracts.js'

export const FOUNTAIN_EFFECTS: readonly FountainEffect[] = [
  {
    id: 'fountain-plume-30m',
    name: 'Lit Plume 30 m',
    medium: 'fountain',
    tags: ['low-noise', 'fountain', 'water', 'calm'],
    noiseDbAt15m: 66,
    durationSec: 6,
    jet: 'plume',
    heightM: 30,
    nozzles: 3,
    widthM: 1.2,
    colors: ['#7fd4ff', '#ffffff'],
  },
  {
    id: 'fountain-shooter-45m',
    name: 'Sky Shooter 45 m',
    medium: 'fountain',
    tags: ['low-noise', 'fountain', 'water', 'accent'],
    noiseDbAt15m: 72,
    durationSec: 4,
    jet: 'plume',
    heightM: 45,
    nozzles: 1,
    widthM: 1.6,
    colors: ['#ffffff', '#cfe8ff'],
  },
  {
    id: 'fountain-fan-20m',
    name: 'Peacock Fan 20 m',
    medium: 'fountain',
    tags: ['low-noise', 'fountain', 'water', 'gold'],
    noiseDbAt15m: 68,
    durationSec: 8,
    jet: 'fan',
    heightM: 20,
    nozzles: 7,
    widthM: 1.0,
    colors: ['#ffd27a', '#ff9d4d', '#ffffff'],
  },
  {
    id: 'fountain-wave-15m',
    name: 'Rolling Wave 15 m',
    medium: 'fountain',
    tags: ['low-noise', 'fountain', 'water', 'blue', 'ambient'],
    noiseDbAt15m: 64,
    durationSec: 12,
    jet: 'wave',
    heightM: 15,
    nozzles: 0,
    widthM: 0.8,
    colors: ['#3aa7d9', '#8f6fd9'],
  },
  {
    id: 'fountain-cascade-25m',
    name: 'Running Cascade 25 m',
    medium: 'fountain',
    tags: ['low-noise', 'fountain', 'water', 'motion'],
    noiseDbAt15m: 68,
    durationSec: 8,
    jet: 'cascade',
    heightM: 25,
    nozzles: 0,
    widthM: 1.0,
    colors: ['#7fd4ff', '#41d68c', '#ffffff'],
  },
  {
    id: 'fountain-mist-screen',
    name: 'Mist Screen',
    medium: 'fountain',
    tags: ['low-noise', 'fountain', 'water', 'ambient', 'screen'],
    noiseDbAt15m: 60,
    durationSec: 20,
    jet: 'mist',
    heightM: 4,
    nozzles: 0,
    widthM: 6,
    colors: ['#dfe6f0', '#3aa7d9'],
  },
]
