/**
 * starter/index.ts — the assembled starter catalog ('starter-v1').
 */

import type { EffectDef } from '../../contracts.js'
import { Catalog } from '../catalog.js'
import { PYRO_EFFECTS } from './pyro.js'
import { DRONE_EFFECTS } from './drones.js'
import { LASER_EFFECTS } from './lasers.js'
import { PANEL_EFFECTS } from './panels.js'
import { FABRICATION_EFFECTS } from './fabrication.js'
import { CROWD_EFFECTS } from './crowd.js'
import { BEAM_EFFECTS } from './beams.js'

export { PYRO_EFFECTS } from './pyro.js'
export { DRONE_EFFECTS } from './drones.js'
export { LASER_EFFECTS } from './lasers.js'
export { PANEL_EFFECTS } from './panels.js'
export { FABRICATION_EFFECTS } from './fabrication.js'
export { CROWD_EFFECTS } from './crowd.js'
export { BEAM_EFFECTS } from './beams.js'

/** Shows reference the catalog by this id (Show.catalogId). */
export const STARTER_CATALOG_ID = 'starter-v1'

/**
 * Every starter effect, in stable order: pyro, drone, laser, panel,
 * fabrication, crowd, beam (append-only — golden fixtures depend on it).
 */
export const STARTER_EFFECTS: readonly EffectDef[] = [
  ...PYRO_EFFECTS,
  ...DRONE_EFFECTS,
  ...LASER_EFFECTS,
  ...PANEL_EFFECTS,
  ...FABRICATION_EFFECTS,
  ...CROWD_EFFECTS,
  ...BEAM_EFFECTS,
]

/** Build a validated Catalog over the starter effects. */
export function starterCatalog(): Catalog {
  return new Catalog(STARTER_EFFECTS)
}
