/**
 * starter/searchlights.ts — sky-beam figures for the moving-head searchlight
 * banks, performance metadata only (figure, divergence, reach, colors).
 *
 * Searchlights are near-silent (cooling fans, ~55 dB), so every entry is
 * 'low-noise'. The solver's anticipation is the bank's head slew from its
 * previous aim to the figure's opening aim — light commanded early so it
 * ARRIVES on the beat.
 */

import type { SearchlightEffect } from '../../contracts.js'

export const SEARCHLIGHT_EFFECTS: readonly SearchlightEffect[] = [
  {
    id: 'light-pillar-white',
    name: 'Pillars of Light',
    medium: 'searchlight',
    tags: ['low-noise', 'searchlight', 'white', 'calm'],
    noiseDbAt15m: 55,
    durationSec: 12,
    figure: 'pillar',
    beamWidthDeg: 2,
    reachM: 600,
    colors: ['#f6f2e4'],
  },
  {
    id: 'light-converge-spire',
    name: 'Converging Spire',
    medium: 'searchlight',
    tags: ['low-noise', 'searchlight', 'white', 'finale'],
    noiseDbAt15m: 55,
    durationSec: 16,
    figure: 'converge',
    beamWidthDeg: 2,
    reachM: 700,
    colors: ['#fff1a8', '#f6f2e4'],
  },
  {
    id: 'light-fan-gold',
    name: 'Gold Fan',
    medium: 'searchlight',
    tags: ['low-noise', 'searchlight', 'gold'],
    noiseDbAt15m: 55,
    durationSec: 12,
    figure: 'fan',
    beamWidthDeg: 2.5,
    reachM: 600,
    colors: ['#ffd27a', '#ffb84d'],
  },
  {
    id: 'light-sweep-slow',
    name: 'Slow Sky Sweep',
    medium: 'searchlight',
    tags: ['low-noise', 'searchlight', 'motion', 'white'],
    noiseDbAt15m: 55,
    durationSec: 16,
    figure: 'sweep',
    beamWidthDeg: 2,
    reachM: 600,
    colors: ['#dfe6f0'],
  },
  {
    id: 'light-cross-violet',
    name: 'Crossed Violet Beams',
    medium: 'searchlight',
    tags: ['low-noise', 'searchlight', 'violet', 'accent'],
    noiseDbAt15m: 55,
    durationSec: 10,
    figure: 'cross',
    beamWidthDeg: 2,
    reachM: 550,
    colors: ['#8f6fd9', '#3aa7d9'],
  },
  {
    id: 'light-chase-beat',
    name: 'Beat Chase',
    medium: 'searchlight',
    tags: ['low-noise', 'searchlight', 'motion', 'accent'],
    noiseDbAt15m: 55,
    durationSec: 8,
    figure: 'chase',
    beamWidthDeg: 2,
    reachM: 550,
    colors: ['#ffffff', '#ffd27a'],
  },
]
