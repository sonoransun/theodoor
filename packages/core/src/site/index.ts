/**
 * site/ — SitePlan validation rules and demo site presets.
 */
export { validateSite } from './validate.js'
export type { GetEffect } from './validate.js'
export { lakesidePark } from './presets.js'
export {
  crowdGridFor,
  crowdMastFor,
  coveredCellIndices,
  CROWD_CELL_SIZE_M,
  CROWD_DENSITY_PPM2,
  CROWD_WRISTBAND_PARTICIPATION,
  CROWD_PHONE_PARTICIPATION,
} from './crowdGrid.js'
export type { CrowdCell, CrowdGrid } from './crowdGrid.js'
