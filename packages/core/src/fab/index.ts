/**
 * fab/ — fabrication drawings (dimensioned SVG shop drawings for staging
 * hardware: mortar racks, panel mounting frames) and the aggregated bill
 * of materials.
 */
// `text` is aliased to `svgText`: the bare name belongs to the choreo text
// formation in the package barrel.
export {
  DIM_ARROW_ID,
  circle,
  dim,
  el,
  escapeAttr,
  escapeText,
  fmtMm,
  group,
  line,
  rect,
  svgDoc,
  text as svgText,
} from './svg.js'
export type { SvgAttrValue, SvgAttrs } from './svg.js'
export * from './mortarRack.js'
export * from './panelFrame.js'
export * from './bom.js'
