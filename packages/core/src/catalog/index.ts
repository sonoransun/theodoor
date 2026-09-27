/**
 * catalog — validated effect registry, cue-param validation, and the
 * 'starter-v1' effect set.
 */

export {
  Catalog,
  anticipationSec,
  fountainRiseSec,
  getEffectFrom,
  FABRICATION_ANTICIPATION_SEC,
} from './catalog.js'
export type { CatalogQuery } from './catalog.js'
export { ALLOWED_PARAM_KEYS, validateParams } from './params.js'
export type { ParamKind } from './params.js'
export {
  STARTER_CATALOG_ID,
  STARTER_EFFECTS,
  starterCatalog,
  PYRO_EFFECTS,
  DRONE_EFFECTS,
  LASER_EFFECTS,
  PANEL_EFFECTS,
  FABRICATION_EFFECTS,
  CROWD_EFFECTS,
  BEAM_EFFECTS,
  FOUNTAIN_EFFECTS,
  SEARCHLIGHT_EFFECTS,
} from './starter/index.js'
