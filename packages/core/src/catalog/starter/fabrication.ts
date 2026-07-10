/**
 * starter/fabrication.ts — ground set pieces mounted on staging hardware
 * (racks, frames). "Fabrication" here means the rigging/frame build — these
 * entries carry only stage footprint, loudness, and duration metadata.
 */

import type { FabricationEffect } from '../../contracts.js'

export const FABRICATION_EFFECTS: readonly FabricationEffect[] = [
  {
    id: 'waterfall-30m',
    name: 'Silver Waterfall Curtain',
    medium: 'fabrication',
    tags: ['silver', 'set-piece'],
    noiseDbAt15m: 98,
    durationSec: 25,
    kind: 'waterfall',
    widthM: 30,
    heightM: 15,
    minAudienceDistanceM: 30,
  },
  {
    id: 'lancework-frame-10m',
    name: 'Lancework Picture Frame',
    medium: 'fabrication',
    tags: ['set-piece', 'message', 'low-noise'],
    noiseDbAt15m: 86,
    durationSec: 40,
    kind: 'lancework',
    widthM: 10,
    heightM: 6,
    minAudienceDistanceM: 15,
  },
  {
    id: 'gerb-fan-arc-12m',
    name: 'Gold Gerb Fan Arc',
    medium: 'fabrication',
    tags: ['gold', 'set-piece'],
    noiseDbAt15m: 96,
    durationSec: 18,
    kind: 'gerbFan',
    widthM: 12,
    heightM: 8,
    minAudienceDistanceM: 25,
  },
  {
    id: 'wheel-spinner-4m',
    name: 'Spinning Wheel',
    medium: 'fabrication',
    tags: ['set-piece', 'silver'],
    noiseDbAt15m: 92,
    durationSec: 30,
    kind: 'wheel',
    widthM: 4,
    heightM: 4,
    minAudienceDistanceM: 20,
  },

  // ---- appended entries (append-only: golden fixtures depend on order) -----
  {
    id: 'lancework-moon-6m',
    name: 'Lancework Crescent Moon',
    medium: 'fabrication',
    tags: ['set-piece', 'low-noise'],
    noiseDbAt15m: 84,
    durationSec: 30,
    kind: 'lancework',
    widthM: 6,
    heightM: 4,
    minAudienceDistanceM: 15,
  },
]
