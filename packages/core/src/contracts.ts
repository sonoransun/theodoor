/**
 * contracts.ts — FROZEN interchange types for the whole Theodoor suite.
 *
 * Every package and module codes against these shapes. Do not edit during
 * feature work; contract changes go through the integration owner.
 *
 * SAFETY / CONTENT BOUNDARY: pyrotechnic effects are opaque catalog entries
 * carrying performance metadata only (timing, geometry, colors, noise). This
 * codebase never describes energetic materials or device construction, and
 * "fabrication" refers exclusively to staging hardware (racks, frames, BOMs).
 *
 * COORDINATE CONVENTIONS: world frame is meters, x = east, y = north,
 * z = up. `SitePlan` geometry is the ground plane (Vec2 = x,y). The audience
 * looks north (+y) toward the display; the visualizer renders the x–z plane.
 *
 * TIME: seconds (show time) are canonical. Musical positions are resolved to
 * seconds through a tempo map. The keystone identity everywhere:
 *   fireSec = targetSec − anticipationSec
 * (a shell is fired riseTime early so its BREAK lands on the musical moment).
 */

// ---------------------------------------------------------------------------
// Scalars & vectors
// ---------------------------------------------------------------------------

export type Seconds = number
export type Beats = number

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export type Severity = 'error' | 'warning'

/** Unified diagnostic shape for solver, validators, and acoustics reports. */
export interface Diagnostic {
  code: string
  severity: Severity
  message: string
  cueIds?: readonly string[]
  assetId?: string
  tSec?: Seconds
}

// ---------------------------------------------------------------------------
// Effect catalog (metadata only — see safety boundary above)
// ---------------------------------------------------------------------------

export type Medium =
  | 'pyro' | 'drone' | 'laser' | 'panel' | 'fabrication'
  | 'crowd' | 'beam' | 'fountain' | 'searchlight'

export interface EffectBase {
  id: string
  name: string
  medium: Medium
  tags: readonly string[]
  /** Sound pressure level at the reference distance (SPL_REF_DISTANCE_M). */
  noiseDbAt15m: number
  /** Visible duration once the effect lands (post-burst for shells). */
  durationSec: Seconds
}

export type PyroCategory =
  | 'peony' | 'chrysanthemum' | 'willow' | 'brocade' | 'crossette'
  | 'comet' | 'mine' | 'salute'

export interface PyroEffect extends EffectBase {
  medium: 'pyro'
  category: PyroCategory
  caliberMm: number
  /** Ascent time from fire to burst; the solver's anticipation for pyro. */
  riseTimeSec: Seconds
  burstHeightM: number
  burstRadiusM: number
  starCount: number
  colors: readonly string[]
  /** Linear-drag time constant⁻¹ for star motion (see sim/pyro). */
  dragK: number
  /** 0 = spherical peony … 1 = drooping willow (terminal-velocity bias). */
  gravityBias: number
  minAudienceDistanceM: number
}

export type DroneFormationKind =
  | 'grid' | 'ring' | 'star' | 'heart' | 'flag' | 'wave'
  | 'text' | 'digit' | 'scatter' | 'bloom' | 'clockRing'
  | 'bat' | 'ghost' | 'spiral' | 'cometTail' | 'saucer'
  | 'orrery' | 'crescent' | 'snowflake'

export interface DronePrimitive extends EffectBase {
  medium: 'drone'
  formation: DroneFormationKind
  minDrones: number
  maxDrones: number
  scaleM: number
}

export type LaserShape =
  | 'beamFan' | 'cone' | 'tunnel' | 'lissajous' | 'sweep' | 'starfield' | 'chevron'
  | 'helix' | 'web' | 'curtain'

export interface LaserPrimitive extends EffectBase {
  medium: 'laser'
  shape: LaserShape
  pointsPerFrame: number
  colors: readonly string[]
}

export type PanelPatternKind =
  | 'solid' | 'gradientWipe' | 'sparkle' | 'flagStripes' | 'waveformBars'
  | 'text' | 'strobe' | 'chase' | 'fireworks'
  | 'embers' | 'starfield' | 'aurora' | 'lightning' | 'eyes'

export interface PanelPattern extends EffectBase {
  medium: 'panel'
  pattern: PanelPatternKind
  fps: number
}

export type FabricationKind = 'waterfall' | 'lancework' | 'gerbFan' | 'wheel'

export interface FabricationEffect extends EffectBase {
  medium: 'fabrication'
  kind: FabricationKind
  widthM: number
  heightM: number
  minAudienceDistanceM: number
}

/** Which audience-device population a crowd broadcast addresses. */
export type CrowdChannel = 'wristband' | 'phone'

export type CrowdPatternKind =
  | 'flood' | 'wave' | 'radialPulse' | 'sectionChase' | 'sparkle'
  | 'text' | 'heartbeat' | 'flashlightStarfield' | 'hapticPulse'

/**
 * Audience-device pattern (LED wristbands / phones as a "crowd canvas" over
 * the audience zone's cell grid). Broadcast-addressed; the solver's
 * anticipation is the mast's p95 command latency for the effect's channel,
 * so the pattern completes exactly on the musical moment.
 */
export interface CrowdEffect extends EffectBase {
  medium: 'crowd'
  pattern: CrowdPatternKind
  channel: CrowdChannel
  /** Broadcast mask updates per second this pattern consumes while active. */
  maskUpdateHz: number
  colors: readonly string[]
}

export type BeamProgramKind =
  | 'whisperZone' | 'flyover' | 'pingPong' | 'stereoPair' | 'sourceTag'
  | 'zonePulse' | 'sweepLine'

/**
 * Steerable directional-audio program (parametric-array "audio spotlight").
 * Performance metadata only — no emitter engineering data. For this medium
 * `noiseDbAt15m` is the AUDIBLE in-beam on-axis level at the reference
 * distance; out-of-beam listeners get that level minus a fixed leakage
 * suppression (see acoustics). The solver's anticipation is the acoustic
 * time-of-flight from the array to the target: sound is fired early so it
 * LANDS on the beat at the listener — the keystone identity, audibly.
 */
export interface BeamEffect extends EffectBase {
  medium: 'beam'
  program: BeamProgramKind
  /** Full cone angle of the audible footprint, degrees. */
  beamWidthDeg: number
  /** Opaque carrier band tag (a name, not engineering data), e.g. 'u-band-40'. */
  carrierBandLabel: string
  /** Carrier level on-axis at SPL_REF_DISTANCE_M; drives the exposure report. */
  maxCarrierDbAtFocus: number
  /** Content label for cue sheets: 'narration', 'whoosh', 'stereo-bed', … */
  contentTag: string
}

export type FountainJetKind = 'plume' | 'fan' | 'wave' | 'cascade' | 'mist'

/**
 * Illuminated water-jet program on a fountain bank (a nozzle row on the lake
 * with underwater RGB lighting). Performance metadata only. The solver's
 * anticipation is honest ballistics: the bank's valve latency plus the
 * column's rise time sqrt(2·heightM / g) — the valve opens early so the
 * column CRESTS on the musical moment (a shell's rise time, in water).
 */
export interface FountainEffect extends EffectBase {
  medium: 'fountain'
  jet: FountainJetKind
  /** Crest height above the nozzle, meters (params.heightM overrides; ≤ bank max). */
  heightM: number
  /** Nozzles engaged per bank, centered on the row; 0 = the whole row. */
  nozzles: number
  /** Column width at the crest, meters (visual + mist footprint). */
  widthM: number
  /** Underwater lighting colors, CSS hex. */
  colors: readonly string[]
}

export type SearchlightFigure = 'pillar' | 'converge' | 'fan' | 'sweep' | 'cross' | 'chase'

/**
 * Sky-beam figure for a bank of moving-head searchlights. Performance
 * metadata only. The solver's anticipation is the head SLEW: the largest
 * angular distance from the bank's previous aim to this figure's opening aim
 * over the bank's slewRateDegPerSec — heads are commanded early so the light
 * ARRIVES on its aim on the beat (kinematics, like a drone morph).
 */
export interface SearchlightEffect extends EffectBase {
  medium: 'searchlight'
  figure: SearchlightFigure
  /** Full beam divergence, degrees (narrow sky beams: 0.5–8). */
  beamWidthDeg: number
  /** Visible beam length in clear air, meters. */
  reachM: number
  colors: readonly string[]
}

export type EffectDef =
  | PyroEffect | DronePrimitive | LaserPrimitive | PanelPattern | FabricationEffect
  | CrowdEffect | BeamEffect | FountainEffect | SearchlightEffect

/**
 * Documented cue param keys per medium (all optional, validated by catalog):
 *   drone:  count, scaleM, holdSec, text (for 'text'/'digit'), rgb
 *   laser:  headId, spreadDeg, periodBeats, rgb
 *   panel:  text, speedPxPerBeat, rgb, rgb2
 *   pyro:   (none in v1 — everything comes from the effect entry)
 *   crowd:  rgb, rgb2, intensity, periodBeats, originCell, dirDeg, sections,
 *           densityFrac, twinkleHz, text (for 'text'), bitmap (row strings)
 *   beam:   targetCellId, pathCellIds, cells ('all'), pairId, role ('L'|'R'),
 *           extraDelayMs, sourceCueId, periodBeats, gainDb
 *   fountain:    rgb, rgb2, heightM, nozzles, stepBeats, periodBeats, reverse
 *   searchlight: rgb, aimX, aimY, aimZ, spreadDeg, tiltDeg, sweepDeg, periodBeats
 */
export type CueParams = Record<
  string,
  number | string | boolean | readonly number[] | readonly string[]
>

// ---------------------------------------------------------------------------
// Music: ONE downstream representation for authored scores and WAV analysis
// ---------------------------------------------------------------------------

/** Piecewise-constant tempo starting at `beat` (beat 0 must be present). */
export interface TempoSegment { beat: Beats; bpm: number }
/** Meter change taking effect at 1-indexed `bar`. */
export interface MeterSegment { bar: number; beatsPerBar: number }
export interface TempoMapData {
  segments: readonly TempoSegment[]
  meters: readonly MeterSegment[]
  /** Beats before bar 1 (anacrusis). */
  pickupBeats?: Beats
}

export type AnnotationKind =
  | 'beat' | 'downbeat' | 'phrase' | 'accent' | 'hit' | 'climax'

export interface Annotation {
  time: Seconds
  /** Present when the annotation lies on the beat grid (authored scores). */
  beat?: Beats
  kind: AnnotationKind
  /** 0..1 — musical weight; climaxes at 1 drive finale ramps. */
  strength: number
  /** Free label, e.g. 'cannon', 'midnight', 'phraseEnd'. */
  label?: string
}

export type VoiceProgram = 'lead' | 'brass' | 'bass' | 'bells' | 'perc'
export interface Voice { name: string; program: VoiceProgram }

/**
 * One note. `midi` is a MIDI note number; for `perc` voices it selects the
 * drum per General-MIDI convention: 35 kick, 38 snare, 49 cymbal, 57 cannon.
 * velocity 0..1.
 */
export interface NoteEvent {
  voice: number
  startBeat: Beats
  durBeats: Beats
  midi: number
  velocity: number
}

export interface Score {
  id: string
  title: string
  tempo: TempoMapData
  voices: readonly Voice[]
  notes: readonly NoteEvent[]
  annotations: readonly Annotation[]
}

export interface EnergyPoint { time: Seconds; rms: number; loudness: number }

/**
 * THE music interchange. Authored scores and WAV analysis both produce this
 * exact shape (a structural-validator test enforces it); everything
 * downstream — solver, generators, viz — consumes only this.
 */
export interface MusicalTimeline {
  source: 'score' | 'analysis'
  id: string
  title: string
  duration: Seconds
  tempo: TempoMapData
  /** All beat instants, seconds, sorted ascending. */
  beats: readonly Seconds[]
  downbeats: readonly Seconds[]
  annotations: readonly Annotation[]
  /** Uniform 50 ms grid. */
  energy: readonly EnergyPoint[]
  /** 1 for authored scores; analysis confidence otherwise. */
  tempoConfidence: number
  /** Present iff source === 'score' (the viz synth renders it). */
  score?: Score
}

// ---------------------------------------------------------------------------
// Anchors & show model
// ---------------------------------------------------------------------------

export type MusicAnchor =
  | { kind: 'sec'; t: Seconds }
  | { kind: 'beat'; beat: Beats; offsetBeats?: Beats }
  | { kind: 'barBeat'; bar: number; beat: number; offsetBeats?: Beats }
  | {
      kind: 'annotation'
      type: AnnotationKind
      /** Index within annotations of `type` (and `label`, when given). */
      index: number
      label?: string
      offsetBeats?: Beats
    }

export interface Cue {
  id: string
  effectId: string
  anchor: MusicAnchor
  /** SitePlan asset the cue fires from / plays on. */
  positionId?: string
  params?: CueParams
  /** Higher wins conflicts; default 0. */
  priority?: number
}

export interface Track {
  id: string
  medium: Medium
  name: string
  cues: readonly Cue[]
}

/** Peak-only noise budget (v1) at the worst SPL listener position. */
export interface NoiseBudget { maxSplDb: number }

/**
 * Ultrasonic-carrier exposure ceiling at audience cells (beam medium).
 * Unlike the opt-in noise budget, compile() enforces a default budget
 * whenever a show has beam cues — the ceiling is always on.
 */
export interface ExposureBudget {
  /** Hard instantaneous ceiling on summed carrier level at any cell, dB. */
  maxCarrierDb: number
  /** Level from which dwell time accrues, dB. */
  dwellDb: number
  /** Rolling window for the dwell rule, seconds. */
  dwellWindowSec: Seconds
  /** Max seconds at/above dwellDb within any window, per cell. */
  dwellMaxSec: Seconds
}

export interface ShowMeta {
  id: string
  title: string
  variant: 'standard' | 'quiet'
  seed: number
}

/** One act of the program notes: a titled span of the show with a guest-facing note. */
export interface ShowAct {
  title: string
  /** Where the act begins (resolved against the timeline by compile()). */
  from: MusicAnchor
  /** What to watch and listen for — written for the audience, not the crew. */
  note: string
}

/**
 * Narrative metadata: the printed program a guest receives and the caption
 * the visualizer shows. Pure data; compile() resolves the acts to seconds.
 */
export interface ShowNotes {
  /** One line under the title. */
  tagline: string
  /** Music credit lines, e.g. 'Bedřich Smetana — Vltava (1874)'. */
  music: readonly string[]
  acts: readonly ShowAct[]
  /** Optional closing line. */
  epilogue?: string
}

/** An act with its span resolved to show seconds (compile() output). */
export interface CompiledAct {
  title: string
  fromSec: Seconds
  /** Start of the next act, or the show's end. */
  toSec: Seconds
  note: string
}

/** Authored show — plain serializable data; catalog referenced by id. */
export interface Show {
  meta: ShowMeta
  music: MusicalTimeline
  site: SitePlan
  catalogId: string
  tracks: readonly Track[]
  /** Transport may start below 0 to fit early anticipation; ≥ 0. */
  preRollSec?: Seconds
  noiseBudget?: NoiseBudget
  /** Overrides the default carrier-exposure budget (never disables it). */
  exposureBudget?: ExposureBudget
  /** Program notes (acts, credits) for the printed program and the caption. */
  notes?: ShowNotes
}

export interface CompiledCue {
  id: string
  trackId: string
  medium: Medium
  effectId: string
  positionId?: string
  /** When the visual lands (musical moment), show seconds. */
  targetSec: Seconds
  /** When it is fired: targetSec − anticipationSec. May be < 0 (pre-roll). */
  fireSec: Seconds
  anticipationSec: Seconds
  durationSec: Seconds
  /** Deterministic per-cue seed: fnv1a32(`${show.meta.seed}:${cue.id}`). */
  seed: number
  params?: CueParams
}

/** Plain-JSON interchange consumed by sim, viz, CLI, exporters, validators. */
export interface CompiledShow {
  show: Show
  /** Sorted by (fireSec, trackId, id) — a total, stable order. */
  cues: readonly CompiledCue[]
  diagnostics: readonly Diagnostic[]
  /** Program-note acts resolved to seconds, ascending; present iff show.notes is. */
  acts?: readonly CompiledAct[]
}

// ---------------------------------------------------------------------------
// Site plan (canonical site model — validation, solver, sim, fab all use it)
// ---------------------------------------------------------------------------

export type AssetKind =
  | 'mortarRack' | 'dronePad' | 'laserTower' | 'panel'
  | 'crowdMast' | 'beamArray' | 'fountainBank' | 'searchlightBank'

export interface RackSpec {
  calibersMm: readonly number[]
  /** Tilt from vertical, degrees (0 = straight up). */
  tiltDeg: number
  pinsPerModule: number
  maxSimultaneousPins: number
}

export interface FleetSpec {
  count: number
  vMaxMps: number
  aMaxMps2: number
  /** Minimum pairwise separation. */
  rMinM: number
}

export interface LaserSpec {
  minElevationDeg: number
  scanFovDeg: number
  /** Beam termination distance. */
  terminationM: number
}

export interface PanelSpec { wPx: number; hPx: number; pitchMm: number }

/**
 * Broadcast command latency as a piecewise-linear CDF through four quantiles
 * (milliseconds). The solver's crowd anticipation is p95; the sim scatters
 * per-device arrival inside this envelope so cells shimmer in realistically.
 */
export interface LatencySpec { minMs: number; p50Ms: number; p95Ms: number; maxMs: number }

/** Crowd-broadcast transmitter (RF/IR mast for wristbands, push relay for phones). */
export interface CrowdMastSpec {
  /** Ground radius the broadcast reliably reaches; cells beyond every mast's radius are excluded from masks. */
  coverageRadiusM: number
  /** Broadcast mask frames this mast can address per second (bandwidth cap). */
  framesPerSec: number
  wristband: LatencySpec
  phone: LatencySpec
}

/** Steerable parametric-array head. Steering limits only — no emitter data. */
export interface BeamArraySpec {
  /** Total pan sweep, degrees, centered on the asset's headingDeg. */
  panRangeDeg: number
  tiltMinDeg: number
  tiltMaxDeg: number
  steerRateDegPerSec: number
  /** No target (or footprint cell) may sit nearer than this slant distance. */
  minFocusDistanceM: number
}

/**
 * A row of illuminated water nozzles on the water surface (staging only:
 * pumps, nozzle bar, underwater lights). Nozzles are spaced evenly over
 * spanM, centered on the asset position, along the asset's headingDeg + 90°.
 */
export interface FountainBankSpec {
  nozzles: number
  spanM: number
  /** Highest column the pumps can raise, meters. */
  maxHeightM: number
  /** Valve-open → first visible water, seconds (part of the anticipation). */
  valveLatencySec: Seconds
}

/**
 * A row of moving-head sky beams. Steering limits only — no lamp data.
 * Heads are spaced evenly over spanM along headingDeg + 90°, centered on pos.
 */
export interface SearchlightBankSpec {
  heads: number
  spanM: number
  slewRateDegPerSec: number
  /** Maximum tilt from vertical, degrees. */
  maxTiltDeg: number
  /** Beams never aim below this elevation toward the audience azimuths. */
  minElevationDeg: number
}

export interface PositionedAsset {
  id: string
  kind: AssetKind
  pos: Vec2
  headingDeg: number
  elevationM: number
  rack?: RackSpec
  fleet?: FleetSpec
  laser?: LaserSpec
  panel?: PanelSpec
  crowdMast?: CrowdMastSpec
  beamArray?: BeamArraySpec
  fountainBank?: FountainBankSpec
  searchlightBank?: SearchlightBankSpec
}

export interface Wind {
  /** Direction the wind blows FROM, degrees clockwise from north. */
  dirDegFrom: number
  speedMps: number
  limitMps: number
}

export interface SitePlan {
  id: string
  assets: readonly PositionedAsset[]
  /** Audience front line (polyline, ≥ 2 points). */
  audience: readonly Vec2[]
  /** Audience-occupied polygon. */
  audienceZone: readonly Vec2[]
  exclusionZones: readonly { id: string; poly: readonly Vec2[] }[]
  /** Drone containment polygon (ground projection). */
  geofence: readonly Vec2[]
  maxAltitudeM: number
  wind: Wind
  /** SPL evaluation points (≥ 1); quiet budgets check the worst one. */
  refListenerPos: readonly Vec2[]
  /** Optional crowd-canvas cell grid over audienceZone (crowd + beam targeting). */
  crowdGrid?: CrowdGridSpec
}

/**
 * Parameters of the derived audience cell grid. Cells themselves are never
 * stored: site/crowdGrid.ts derives them deterministically (axis-aligned
 * cellSizeM grid over the audienceZone bbox, keeping cells whose centroid is
 * inside the zone and outside every exclusion zone).
 */
export interface CrowdGridSpec {
  /** Cell edge length, meters. */
  cellSizeM: number
  /** Mean audience surface density, people per m². */
  densityPPM2: number
  /** Site-owned seed for per-cell occupancy (show-independent). */
  seed: number
}

// ---------------------------------------------------------------------------
// Choreography interchange (formations & morphs)
// ---------------------------------------------------------------------------

export interface FormationPoint extends Vec3 {
  r?: number
  g?: number
  b?: number
}

export interface Formation { name: string; points: readonly FormationPoint[] }

/** Output of planMorph(); sim flies these paths, the waypoint exporter dumps them. */
export interface MorphPlan {
  /** assignment[i] = index into `to.points` for drone i. */
  assignment: readonly number[]
  maxPathLenM: number
  /** Trapezoidal-profile minimum transition (drone anticipation source). */
  minTransitionSec: Seconds
  feasible: boolean
  waypoints: readonly { droneId: number; path: readonly Vec3[] }[]
}

// ---------------------------------------------------------------------------
// Simulation interchange
// ---------------------------------------------------------------------------

/** x,y in [-1,1] projector space; r,g,b 0..1; blank = beam off while moving. */
export interface LaserPoint {
  x: number
  y: number
  r: number
  g: number
  b: number
  blank: boolean
}

/**
 * SoA snapshot of one completed sim step. Positions are xyz-interleaved
 * Float32Arrays of length count*3 (world frame). Consumed by viz (one GL
 * upload) and by headless stats.
 */
export interface SimSnapshot {
  t: Seconds
  step: number
  shells: {
    count: number
    pos: Float32Array
    /** Index into CompiledShow.cues for each shell. */
    cueIdx: Int32Array
  }
  stars: {
    count: number
    pos: Float32Array
    /** Closed-form star velocity, m/s (xyz-interleaved) — the viz draws streaks from it. */
    vel: Float32Array
    rgb: Float32Array
    brightness: Float32Array
    sizeM: Float32Array
  }
  drones: {
    count: number
    pos: Float32Array
    vel: Float32Array
    rgb: Float32Array
    minSeparationM: number
  }
  laserFrames: readonly { assetId: string; points: readonly LaserPoint[] }[]
  panelFrames: readonly { assetId: string; w: number; h: number; rgb: Uint8Array }[]
  /**
   * Crowd-canvas state per derived audience cell (site/crowdGrid.ts cell
   * order). rgb is the wristband color channel (cellCount*3), white the
   * phone-flashlight channel (cellCount). Empty arrays when the show has no
   * crowd cues or the site has no crowdGrid.
   */
  crowd: {
    cellCount: number
    rgb: Float32Array
    white: Float32Array
  }
  /** Active directional-audio beams this step (≤ a handful; plain objects). */
  beams: readonly BeamState[]
  /** Water columns above the nozzles this step, one per engaged nozzle. */
  jets: readonly JetState[]
  /** Searchlight heads lit this step, one per head. */
  lights: readonly LightState[]
  /** Instantaneous dB per SitePlan.refListenerPos entry (-Infinity when silent). */
  splByListener: readonly number[]
}

/** One water column's state for a sim step (closed form in show time). */
export interface JetState {
  /** Index into CompiledShow.cues. */
  cueIdx: number
  assetId: string
  /** Nozzle index within the bank row. */
  nozzle: number
  /** Nozzle position (z = the bank's elevation, the water surface). */
  base: Vec3
  /** Current column height above the base, meters. */
  heightM: number
  /** Crest height this column rises to, meters. */
  crestM: number
  /** Lateral crest offset for fanned jets, world meters (0 for vertical columns). */
  tipDx: number
  tipDy: number
  widthM: number
  r: number
  g: number
  b: number
  phase: 'rising' | 'holding' | 'falling'
  /** True once the column has crested (t ≥ targetSec) — the keystone landing. */
  crested: boolean
}

/** One searchlight head's state for a sim step. */
export interface LightState {
  /** Index into CompiledShow.cues. */
  cueIdx: number
  assetId: string
  /** Head index within the bank row. */
  head: number
  base: Vec3
  /** Unit beam direction, world frame. */
  dir: Vec3
  reachM: number
  halfAngleDeg: number
  r: number
  g: number
  b: number
  /** Lamp intensity 0..1 (fade-in on strike, fade-out at the hold's tail). */
  intensity: number
  /** True while the head is still slewing toward its opening aim (t < targetSec). */
  slewing: boolean
}

/** Audible footprint ellipse on the audience plane (meters, world frame). */
export interface BeamFootprint {
  cx: number
  cy: number
  /** Semi-axis along the beam's ground azimuth. */
  a: number
  /** Semi-axis across it. */
  b: number
  azimuthDeg: number
}

/** One active beam cue's steering/audibility state for a sim step. */
export interface BeamState {
  /** Index into CompiledShow.cues. */
  cueIdx: number
  assetId: string
  /** Array head position (z = elevationM). */
  apex: Vec3
  /** Slew-limited actual ground aim. */
  target: Vec2
  halfAngleDeg: number
  footprint: BeamFootprint
  /** Audible in-beam level at SPL_REF_DISTANCE_M (effect level + gainDb). */
  audibleDbAtRef: number
  /** Carrier level at SPL_REF_DISTANCE_M (exposure model). */
  carrierDbAtRef: number
  pairId?: string
  role?: 'L' | 'R'
  extraDelayMs?: number
  /** True once the wavefront has arrived at the aim (t ≥ fireSec + ToF). */
  landed: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SIM_STEP_HZ = 120
/** Dry air at 20 °C — beam time-of-flight anticipation (fireSec = targetSec − d/c). */
export const SPEED_OF_SOUND_MPS = 343
/** Standard gravity — shell star fall, and the fountain column rise sqrt(2h/g). */
export const GRAVITY_MPS2 = 9.81
/** Altitude a drone formation's center flies at is this base + scale/2. */
export const DRONE_BASE_ALTITUDE_M = 30
export const SPL_REF_DISTANCE_M = 15
/** Salutes and other impulse sources contribute SPL for this window. */
export const IMPULSE_WINDOW_SEC = 0.5
/** Energy curve sampling interval (MusicalTimeline.energy). */
export const ENERGY_DT_SEC = 0.05
