/** Shared color palettes for flagship programs (CSS hex, catalog convention). */

export const RWB = {
  red: '#b8122a',
  white: '#f2f2f2',
  blue: '#1a3c8f',
} as const

export const GOLD = '#ffb84d'
export const SILVER = '#d9e2ec'
export const AURORA = ['#41d68c', '#3aa7d9', '#8f6fd9'] as const

/** The Unquiet Hour (hallows): spectral greens and violets over bone white. */
export const PHANTOM = {
  ecto: '#59ff9c',
  violet: '#7a3bd9',
  bone: '#e8e4d8',
  ember: '#ff7a1a',
} as const

/** Night of the Spheres (cosmos): deep space blues into starlight. */
export const NEBULA = {
  deep: '#122a66',
  drift: '#3a7bd5',
  bloom: '#8f6fd9',
  star: '#fff7d6',
} as const

/** Midsummer Aurora (aurora): moon silver over indigo night. */
export const MOONLIGHT = {
  moon: '#dfe6f0',
  indigo: '#1c2246',
} as const

/** RGB tuples (0..1) for drone/panel params. */
export const RGB = {
  red: [0.72, 0.07, 0.16],
  white: [0.95, 0.95, 0.95],
  blue: [0.1, 0.24, 0.56],
  gold: [1, 0.72, 0.3],
  silver: [0.85, 0.89, 0.93],
  ecto: [0.35, 1, 0.61],
  violet: [0.48, 0.23, 0.85],
  bone: [0.91, 0.89, 0.85],
  ember: [1, 0.48, 0.1],
  nebula: [0.07, 0.16, 0.4],
  drift: [0.23, 0.48, 0.84],
  starlight: [1, 0.97, 0.84],
  moon: [0.87, 0.9, 0.94],
  indigo: [0.11, 0.13, 0.27],
} as const
