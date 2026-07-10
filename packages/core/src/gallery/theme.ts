/**
 * gallery/theme.ts — the one color vocabulary for generated documentation
 * imagery (README hero, charts, posters, docs gallery).
 *
 * These are the visualizer's conventions ported to SVG: the night-sky
 * backdrop gradient, the per-lane medium colors from the viz timeline, and
 * the annotation accents — plus two lanes the viz never charts (crowd,
 * beams). Hardcoded here on purpose: core cannot depend on the programs
 * package, and generated images must never inherit `currentColor` (GitHub
 * renders repo SVGs inside <img>, where currentColor resolves to black) —
 * every gallery element passes explicit colors from this table.
 */

export const GALLERY_THEME = {
  /** Opaque page base every galleryDoc paints first. */
  pageBg: '#060a1c',
  /** Night-sky gradient (viz backdrop.ts). */
  bgTop: '#02030f',
  bgBottom: '#0a1230',
  ground: 'rgba(96,116,168,0.45)',
  panelBg: 'rgba(5,8,22,0.92)',
  /** Per-medium lane colors (viz timeline.ts; crowd/beams are gallery-new). */
  lanes: {
    pyro: '#ff9d4d',
    drones: '#4dc3ff',
    lasers: '#7dff8a',
    panels: '#d98cff',
    music: '#ffd24d',
    crowd: '#ffe08a',
    beams: '#5ee6d0',
  },
  hit: '#ffd24d',
  climax: '#ff5252',
  /** Label/axis ink and faint grid strokes. */
  ink: '#c8d4f2',
  inkDim: 'rgba(150,165,205,0.7)',
  grid: 'rgba(96,116,168,0.25)',
  /** General-purpose accents (gold, silver, aurora triple). */
  accents: ['#ffb84d', '#d9e2ec', '#41d68c', '#3aa7d9', '#8f6fd9'],
} as const

export type GalleryTheme = typeof GALLERY_THEME

/** Lane color for a cue medium ('fabrication' charts on the pyro lane). */
export function laneColorFor(medium: string): string {
  switch (medium) {
    case 'pyro':
    case 'fabrication':
      return GALLERY_THEME.lanes.pyro
    case 'drone':
      return GALLERY_THEME.lanes.drones
    case 'laser':
      return GALLERY_THEME.lanes.lasers
    case 'panel':
      return GALLERY_THEME.lanes.panels
    case 'crowd':
      return GALLERY_THEME.lanes.crowd
    case 'beam':
      return GALLERY_THEME.lanes.beams
    default:
      return GALLERY_THEME.ink
  }
}
