/**
 * show/ — the KEYSTONE: anchor resolution, the two-phase alignment solver
 * (fireSec = targetSec − anticipationSec), show validation, compile() to the
 * CompiledShow interchange, the fluent authoring builder, and the
 * analysis-driven show generator.
 */

export { beatIndexToSec, resolveAnchor, secToBeatIndex } from './anchors.js'
export {
  DEFAULT_CROWD_LATENCY_SEC,
  DEFAULT_FLEET_LIMITS,
  DRONE_ANTICIPATION_MARGIN,
  LAUNCH_GRID_SPACING_M,
  MAX_SPL_ROUNDS,
  RAPID_REFIRE_SEC,
  beamAnticipationSec,
  compiledCueOrder,
  crowdLatencyFor,
  defaultQuietSubstitute,
  droneCountFor,
  droneMorphPlans,
  fleetLimitsAt,
  launchFormation,
  solve,
} from './solve.js'
// Aliased: 'DroneCuePlan' is already exported from export/waypoints.ts.
export type { DroneCuePlan as SolverDroneCuePlan, SolveOptions, SolveResult } from './solve.js'
export { QUIET_VARIANT_MAX_DB, validateShow } from './validate.js'
export { compile } from './compile.js'
export { musicRefs, showBuilder } from './builder.js'
// Aliased: choreo/generators/pyro.ts already exports ChaseSpec / VolleySpec,
// and generators/crowd.ts / beam.ts export their own same-named cue specs.
export type {
  BarrageSpec,
  BarrageWindow,
  BeamFlyoverSpec as BuilderBeamFlyoverSpec,
  BeamPingPongSpec as BuilderBeamPingPongSpec,
  BeamStereoSpec as BuilderBeamStereoSpec,
  BeamTagSpec as BuilderBeamTagSpec,
  BeamTollSpec as BuilderBeamTollSpec,
  BeamWhisperSpec as BuilderBeamWhisperSpec,
  BuildResult,
  ChaseSpec as BuilderChaseSpec,
  CountdownSpec,
  CrowdChaseSpec as BuilderCrowdChaseSpec,
  CrowdFloodSpec as BuilderCrowdFloodSpec,
  CrowdHapticSpec as BuilderCrowdHapticSpec,
  CrowdHeartbeatSpec as BuilderCrowdHeartbeatSpec,
  CrowdPulseSpec as BuilderCrowdPulseSpec,
  CrowdSparkleSpec as BuilderCrowdSparkleSpec,
  CrowdTextSpec as BuilderCrowdTextSpec,
  CrowdWaveSpec as BuilderCrowdWaveSpec,
  FireSpec,
  FormationSpec,
  LaserPatternSpec,
  MusicRefs,
  PanelPatternSpec,
  RawCue,
  ShowBuilder,
  ShowBuilderOptions,
  TickerSpec,
  VolleySpec as BuilderVolleySpec,
} from './builder.js'
export { ENERGY_FLOOR, GENERATED_BARRAGE_SEC, GENERATED_PREROLL_SEC, generateShowFromAnalysis } from './generate.js'
export type { GenerateOptions, GeneratedShow } from './generate.js'
