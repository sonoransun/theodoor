/**
 * export/ — pure byte/string exporters. No I/O and no gating here: builders
 * return Uint8Array or string; the CLI gates emission behind the safety
 * machine.
 */

export {
  CSV_EOL,
  csvDocument,
  csvEscape,
  csvRow,
  guardSpreadsheetInjection,
  type CsvField,
} from './csv.js'

export { FIRING_SCRIPT_COLUMNS, PINS_PER_MODULE, firingScriptCsv } from './firingScript.js'

export {
  ARTDMX_HEADER_LENGTH,
  FOUNTAIN_SLOTS,
  LASER_SLOTS,
  PANEL_PIXELS_PER_UNIVERSE,
  SEARCHLIGHT_SLOTS,
  buildArtDmx,
  fountainPatch,
  laserPatch,
  panelPatch,
  renderDmxPackets,
  searchlightPatch,
  type ArtDmxParams,
  type ChannelPatch,
  type DmxFrame,
  type DmxPacketFrame,
  type PatchSlice,
} from './artnet.js'

export {
  DRONE_WAYPOINT_COLUMNS,
  WAYPOINT_HOLD_FRACTION,
  droneWaypointRows,
  droneWaypointsCsv,
  droneWaypointsJson,
  type DroneCuePlan,
  type DroneWaypointRow,
} from './waypoints.js'

export {
  ILDA_FORMAT_2D_TRUE_COLOR,
  ILDA_HEADER_LENGTH,
  ILDA_RECORD_LENGTH,
  buildIldaFile,
  type IldaOptions,
} from './ilda.js'

export { cueSheetMarkdown, formatMmSsD } from './cueSheet.js'

export {
  actHeading,
  formatClock,
  keystoneParagraph,
  lookForLine,
  programNotesMarkdown,
} from './programNotes.js'

export {
  CROWD_BROADCAST_COLUMNS,
  CROWD_BROADCAST_FORMAT,
  CROWD_FRAME_TYPE_CODE,
  cellMaskBytes,
  cellMaskHex,
  crowdBroadcastBin,
  crowdBroadcastCsv,
  crowdBroadcastFrames,
  crowdBroadcastIndexJson,
  crowdBroadcastMastLoads,
  crowdBroadcastOverruns,
  type CrowdBroadcast,
  type CrowdBroadcastFrame,
  type CrowdBroadcastMast,
  type CrowdBroadcastMastLoad,
  type CrowdFrameType,
} from './crowdBroadcast.js'

export {
  BEAM_STEERING_COLUMNS,
  BEAM_STEERING_FORMAT,
  beamSteeringCsv,
  beamSteeringEvents,
  beamSteeringJson,
  type BeamEventType,
  type BeamSteeringEvent,
} from './beamSteering.js'
