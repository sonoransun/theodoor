/**
 * gallery/ — deterministic SVG builders for generated documentation imagery
 * (README hero, charts, posters, animated loops). Pure string assembly over
 * fab/svg.ts primitives + SMIL emitters; the CLI `gallery` command drives
 * these against the real engine and writes docs/gallery/*.svg.
 */
export * from './theme.js'
export * from './anim.js'
export * from './scene.js'
export * from './sample.js'
export * from './sitePlan.js'
export * from './timeline.js'
export * from './keystone.js'
export * from './formations.js'
export * from './sky.js'
export * from './crowd.js'
export * from './acoustics.js'
export * from './physics.js'
