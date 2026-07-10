/**
 * show/builder.ts — typed fluent authoring facade. Emits a plain serializable
 * `Show` (catalog referenced by id) and its compiled result; wave-3 program
 * agents code against exactly this surface.
 *
 * const b = showBuilder({ id, title, seed, site, catalog })
 *   .score(odeToJoy)              // or .music(timeline)
 *   .preRoll(6)
 * const m = musicRefs(timeline)
 * b.pyro.fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) })
 * b.crowd.wave({ effect: 'crowd-wave-lateral', position: 'mast-west', from: m.beat(8), periodBeats: 16 })
 * b.beams.whisper({ effect: 'beam-whisper-narration', position: 'beam-south-west', target: 305, land: m.beat(12) })
 * const { show, compiled } = b.build()   // throws when any diagnostic is an error
 *
 * Cue ids are deterministic: '<trackId>-<n>' for singles, '<idPrefix>-NNN'
 * (or '<trackId>-<n>-NNN') for generated groups.
 */

import type {
  AnnotationKind,
  Beats,
  CompiledShow,
  Cue,
  CueParams,
  MusicAnchor,
  MusicalTimeline,
  Score,
  Seconds,
  Show,
  SitePlan,
  Track,
} from '../contracts.js'
import type { Catalog } from '../catalog/index.js'
import { STARTER_CATALOG_ID } from '../catalog/index.js'
import { buildTimelineFromScore, annotationsOfKind } from '../music/index.js'
import type { QuantizeGrid } from '../time/index.js'
import { tempoMapsFrom } from '../time/index.js'
import { volley as choreoVolley, chase as choreoChase } from '../choreo/index.js'
import {
  crowdHeartbeat,
  crowdRadial,
  crowdSectionChase,
  crowdText,
  crowdWave,
} from '../choreo/generators/crowd.js'
import {
  beamFlyover,
  beamPingPong,
  beamStereoPair,
  beamTag,
  beamToll,
  beamWhisper,
} from '../choreo/generators/beam.js'
import { offsetAnchor } from '../choreo/generators/pyro.js'
import { resolveAnchor } from './anchors.js'
import { compile } from './compile.js'

const pad3 = (k: number): string => String(k).padStart(3, '0')

// ---------------------------------------------------------------------------
// Music refs
// ---------------------------------------------------------------------------

/** Anchor factory bound to one timeline; see {@link musicRefs}. */
export interface MusicRefs {
  /** Absolute show seconds. */
  time(t: Seconds): MusicAnchor
  /** Fractional index into the timeline's beats array. */
  beat(b: Beats): MusicAnchor
  /** 1-indexed bar and in-bar beat. */
  barBeat(bar: number, beat: number): MusicAnchor
  /** The nth entry of the downbeats array (as a seconds anchor). Throws when out of range. */
  downbeat(n: number): MusicAnchor
  /** Generic annotation anchor. */
  annotation(kind: AnnotationKind, index: number, label?: string): MusicAnchor
  /** nth 'phrase' annotation labelled 'phraseEnd'. */
  phraseEnd(n: number): MusicAnchor
  /** nth 'hit' annotation with the given label. */
  hit(label: string, index: number): MusicAnchor
  /** nth 'climax' annotation (default 0). */
  climax(index?: number): MusicAnchor
  /**
   * `anchor` shifted `beats` later (negative shifts earlier), composing with
   * any offsetBeats already on the anchor. Beat offsets need tempo context,
   * so a 'sec' anchor throws (except beats === 0, which returns the anchor
   * unchanged) — reach for m.time(t ± sec) instead.
   */
  offset(anchor: MusicAnchor, beats: Beats): MusicAnchor
  /**
   * The `count` downbeats immediately before the first annotation carrying
   * `label`, ordered ascending. Throws when the label is missing or fewer
   * than `count` downbeats precede it.
   */
  lastDownbeatsBefore(label: string, count: number): MusicAnchor[]
  /** phraseEnd anchors for indices from..to inclusive. Throws when out of range. */
  everyPhraseEnd(range: { from: number; to: number }): MusicAnchor[]
  /**
   * Barrage window ending on the strongest climax (first on ties). Feed the
   * result straight into pyro.barrage({ window: m.climaxRamp() , ... }).
   */
  climaxRamp(windowSec?: Seconds): { peak: MusicAnchor; windowSec: Seconds }
}

/** Build a {@link MusicRefs} helper over a timeline. */
export function musicRefs(tl: MusicalTimeline): MusicRefs {
  const strongestClimaxIndex = (): number => {
    const climaxes = annotationsOfKind(tl, 'climax')
    if (climaxes.length === 0) {
      throw new Error(`musicRefs: timeline '${tl.id}' has no climax annotation`)
    }
    let best = 0
    for (let i = 1; i < climaxes.length; i++) {
      if (climaxes[i]!.strength > climaxes[best]!.strength) best = i
    }
    return best
  }
  return {
    time: (t) => ({ kind: 'sec', t }),
    beat: (b) => ({ kind: 'beat', beat: b }),
    barBeat: (bar, beat) => ({ kind: 'barBeat', bar, beat }),
    downbeat: (n) => {
      const t = tl.downbeats[n]
      if (t === undefined) {
        throw new Error(
          `musicRefs.downbeat(${n}): timeline '${tl.id}' has ${tl.downbeats.length} downbeats`,
        )
      }
      return { kind: 'sec', t }
    },
    annotation: (kind, index, label) =>
      label === undefined
        ? { kind: 'annotation', type: kind, index }
        : { kind: 'annotation', type: kind, index, label },
    phraseEnd: (n) => ({ kind: 'annotation', type: 'phrase', label: 'phraseEnd', index: n }),
    hit: (label, index) => ({ kind: 'annotation', type: 'hit', label, index }),
    climax: (index = 0) => ({ kind: 'annotation', type: 'climax', index }),
    offset: (anchor, beats) => offsetAnchor(anchor, beats),
    lastDownbeatsBefore: (label, count) => {
      const marker = tl.annotations.find((a) => a.label === label)
      if (!marker) {
        throw new Error(`musicRefs.lastDownbeatsBefore: no annotation labelled '${label}'`)
      }
      const before = tl.downbeats.filter((t) => t < marker.time)
      if (before.length < count) {
        throw new Error(
          `musicRefs.lastDownbeatsBefore('${label}', ${count}): only ${before.length} ` +
            `downbeats precede t=${marker.time.toFixed(3)}s`,
        )
      }
      return before.slice(before.length - count).map((t) => ({ kind: 'sec', t }))
    },
    everyPhraseEnd: ({ from, to }) => {
      const n = annotationsOfKind(tl, 'phrase', 'phraseEnd').length
      if (from < 0 || to >= n || to < from) {
        throw new Error(
          `musicRefs.everyPhraseEnd(${from}..${to}): timeline has ${n} phraseEnd annotations`,
        )
      }
      const out: MusicAnchor[] = []
      for (let i = from; i <= to; i++) {
        out.push({ kind: 'annotation', type: 'phrase', label: 'phraseEnd', index: i })
      }
      return out
    },
    climaxRamp: (windowSec = 20) => ({
      peak: { kind: 'annotation', type: 'climax', index: strongestClimaxIndex() },
      windowSec,
    }),
  }
}

// ---------------------------------------------------------------------------
// Sugar specs
// ---------------------------------------------------------------------------

export interface FireSpec {
  id?: string
  effect: string
  position: string
  land: MusicAnchor
  priority?: number
}

export interface VolleySpec {
  effects: readonly string[]
  positions: readonly string[]
  land: MusicAnchor
  staggerBeats?: Beats
  idPrefix?: string
  priority?: number
}

export interface ChaseSpec {
  effect: string
  positions: readonly string[]
  startLand: MusicAnchor
  stepBeats: Beats
  idPrefix?: string
  priority?: number
}

/** Barrage window: [start, peak]. Start = startSec | fromAnchor | peak − windowSec (default 20). */
export interface BarrageWindow {
  peak: MusicAnchor
  startSec?: Seconds
  fromAnchor?: MusicAnchor
  windowSec?: Seconds
}

export interface BarrageSpec {
  window: BarrageWindow
  /** Effect ids ramped small → large (ordered by caliber via the catalog). */
  effectPool: readonly string[]
  positions: readonly string[]
  startRateHz: number
  endRateHz: number
  idPrefix?: string
  priority?: number
}

export interface FormationSpec {
  id?: string
  effect: string
  position: string
  /** Landing anchor — the formation is fully formed BY this moment. */
  by: MusicAnchor
  holdSec?: Seconds
  params?: CueParams
  priority?: number
}

export interface CountdownSpec {
  position: string
  /** One digit per landing: digits count landings.length−1 … 0. */
  landings: readonly MusicAnchor[]
  /** Drones per digit (params.count). */
  count?: number
  /**
   * Digit glyph scale (params.scaleM). NOTE: for 'digit'/'text' formations
   * scaleM is meters PER FONT CELL — a glyph is ≈ 5×7 cells, so scaleM 3
   * yields a ≈ 15×21 m digit.
   */
  scaleM?: number
  idPrefix?: string
  priority?: number
}

export interface LaserPatternSpec {
  id?: string
  effect: string
  position: string
  from: MusicAnchor
  /** Pattern cycle length in beats (params.periodBeats). */
  durBeats?: Beats
  /** Alternative to durBeats: seconds, converted through the tempo map. */
  holdSec?: Seconds
  params?: CueParams
  priority?: number
}

export interface PanelPatternSpec {
  id?: string
  effect: string
  position: string
  from: MusicAnchor
  rgb?: readonly number[]
  rgb2?: readonly number[]
  params?: CueParams
  priority?: number
}

export interface TickerSpec {
  id?: string
  position: string
  from: MusicAnchor
  speedPxPerBeat?: number
  rgb?: readonly number[]
  priority?: number
}

export interface CrowdFloodSpec {
  id?: string
  /** Catalog id of a crowd 'flood' pattern. */
  effect: string
  /** Crowd-mast asset id the broadcast rides. */
  position: string
  from: MusicAnchor
  /** Device color 0..1 [r, g, b] (params.rgb). */
  rgb?: readonly number[]
  /** Secondary color (params.rgb2). */
  rgb2?: readonly number[]
  /** Brightness scale 0..1 (params.intensity). */
  intensity?: number
  priority?: number
}

export interface CrowdWaveSpec {
  effect: string
  position: string
  /** Anchor the wavefront crosses the first cells on. */
  from: MusicAnchor
  /** Beats for one full traversal of the lawn. */
  periodBeats: Beats
  /** Travel azimuth, degrees clockwise from north (sim default when omitted). */
  dirDeg?: number
  rgb?: readonly number[]
  idPrefix?: string
  priority?: number
}

export interface CrowdPulseSpec {
  effect: string
  position: string
  land: MusicAnchor
  /** Crowd-grid cell the pulse radiates from (zone center when omitted). */
  originCell?: number
  /** Beats per pulse ring (sim default when omitted). */
  periodBeats?: Beats
  rgb?: readonly number[]
  idPrefix?: string
  priority?: number
}

export interface CrowdChaseSpec {
  effect: string
  position: string
  /** Landing anchor of the first section. */
  startLand: MusicAnchor
  /** Beats between successive sections. */
  stepBeats: Beats
  /** Number of lawn sections chased across (one cue each). */
  sections: number
  rgb?: readonly number[]
  idPrefix?: string
  priority?: number
}

export interface CrowdTextSpec {
  effect: string
  position: string
  land: MusicAnchor
  rgb?: readonly number[]
  idPrefix?: string
  priority?: number
}

export interface CrowdSparkleSpec {
  id?: string
  effect: string
  position: string
  from: MusicAnchor
  /** Fraction of devices lit at any instant (params.densityFrac). */
  densityFrac?: number
  /** Twinkle refresh rate (params.twinkleHz). */
  twinkleHz?: number
  rgb?: readonly number[]
  priority?: number
}

export interface CrowdHeartbeatSpec {
  effect: string
  position: string
  land: MusicAnchor
  /** Cell the beat radiates from (zone center when omitted). */
  originCell?: number
  rgb?: readonly number[]
  idPrefix?: string
  priority?: number
}

export interface CrowdHapticSpec {
  id?: string
  effect: string
  position: string
  land: MusicAnchor
  priority?: number
}

export interface BeamWhisperSpec {
  /** Catalog id of a beam program. */
  effect: string
  /** Beam-array asset id that steers the cue. */
  position: string
  /** Crowd-grid cell the whisper zone sits on (params.targetCellId). */
  target: number
  /** Landing anchor — when the audio arrives at the listener. */
  land: MusicAnchor
  /** Level trim on the effect's in-beam reference, dB. */
  gainDb?: number
  idPrefix?: string
  priority?: number
}

export interface BeamFlyoverSpec {
  effect: string
  position: string
  /** Cell centroids swept in order over the active window (params.pathCellIds). */
  path: readonly number[]
  land: MusicAnchor
  gainDb?: number
  idPrefix?: string
  priority?: number
}

export interface BeamStereoSpec {
  effect: string
  /** [left, right] beam-array asset ids. */
  positions: readonly [string, string]
  /** Crowd-grid cell both footprints converge on. */
  target: number
  land: MusicAnchor
  /** Stereo correlation id (auto-generated from the cue id prefix when omitted). */
  pairId?: string
  /** Extra arrival delay applied to the R channel, milliseconds. */
  extraDelayMs?: number
  gainDb?: number
  idPrefix?: string
  priority?: number
}

export interface BeamPingPongSpec {
  effect: string
  position: string
  /** Cells bounced between (first ↔ last of the path). */
  cells: readonly number[]
  /** Beats per bounce. */
  periodBeats: Beats
  land: MusicAnchor
  gainDb?: number
  idPrefix?: string
  priority?: number
}

export interface BeamTagSpec {
  effect: string
  position: string
  /** Cue id whose ground position the beam narrates/tags (params.sourceCueId). */
  source: string
  land: MusicAnchor
  /** Fallback cell when the source cue has no ground position. */
  fallbackTarget?: number
  gainDb?: number
  idPrefix?: string
  priority?: number
}

export interface BeamTollSpec {
  effect: string
  position: string
  land: MusicAnchor
  gainDb?: number
  idPrefix?: string
  priority?: number
}

/** Raw cue input for TrackBuilder.cue(): id optional, everything else as contracts.Cue. */
export interface RawCue {
  id?: string
  effectId: string
  anchor: MusicAnchor
  positionId?: string
  params?: CueParams
  priority?: number
}

// ---------------------------------------------------------------------------
// Track facades
// ---------------------------------------------------------------------------

class TrackBuilder {
  protected readonly owner: ShowBuilderImpl
  readonly trackId: string
  private counter = 0

  constructor(owner: ShowBuilderImpl, trackId: string) {
    this.owner = owner
    this.trackId = trackId
  }

  /** Next deterministic auto id / group prefix: '<trackId>-<n>'. */
  protected nextId(): string {
    return `${this.trackId}-${this.counter++}`
  }

  protected push(cue: Cue): void {
    this.owner.addCue(this.trackId, cue)
  }

  protected pushRaw(raw: RawCue): void {
    const cue: Cue = { id: raw.id ?? this.nextId(), effectId: raw.effectId, anchor: raw.anchor }
    if (raw.positionId !== undefined) cue.positionId = raw.positionId
    if (raw.params !== undefined) cue.params = raw.params
    if (raw.priority !== undefined) cue.priority = raw.priority
    this.push(cue)
  }

  /** Append a raw cue (id auto-assigned when omitted). */
  cue(raw: RawCue): this {
    this.pushRaw(raw)
    return this
  }
}

class PyroTrackBuilder extends TrackBuilder {
  /** One shell/comet/mine landing on `land`. */
  fire(spec: FireSpec): this {
    const raw: RawCue = { effectId: spec.effect, anchor: spec.land, positionId: spec.position }
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }

  /** One cue per position, effects cycled, landings staggered (choreo volley). */
  volley(spec: VolleySpec): this {
    const s: Parameters<typeof choreoVolley>[0] = {
      effects: spec.effects,
      positionIds: spec.positions,
      land: spec.land,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.staggerBeats !== undefined) s.staggerBeats = spec.staggerBeats
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of choreoVolley(s)) this.push(c)
    return this
  }

  /** Linear chase: position i lands at startLand + i·stepBeats (choreo chase). */
  chase(spec: ChaseSpec): this {
    const s: Parameters<typeof choreoChase>[0] = {
      effect: spec.effect,
      positionIds: spec.positions,
      startLand: spec.startLand,
      stepBeats: spec.stepBeats,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of choreoChase(s)) this.push(c)
    return this
  }

  /**
   * Density-ramped barrage over [windowStart, peak]: cue rate grows
   * d(u) = start + (end − start)·u² per second, positions cycled, calibers
   * ramped small → large; the final cue lands ON the peak anchor with the
   * largest effect. Requires .music()/.score() first (the window is resolved
   * against the timeline).
   */
  barrage(spec: BarrageSpec): this {
    if (spec.effectPool.length === 0) throw new Error('barrage: effectPool must be non-empty')
    if (spec.positions.length === 0) throw new Error('barrage: positions must be non-empty')
    if (!(spec.startRateHz > 0) || !(spec.endRateHz > 0)) {
      throw new Error('barrage: rates must be > 0')
    }
    const tl = this.owner.requireMusic('pyro.barrage')
    const tPeak = resolveAnchor(spec.window.peak, tl)
    if (tPeak === undefined) {
      throw new Error(`barrage: peak anchor ${JSON.stringify(spec.window.peak)} does not resolve`)
    }
    let start: Seconds
    if (spec.window.startSec !== undefined) {
      start = spec.window.startSec
    } else if (spec.window.fromAnchor !== undefined) {
      const s = resolveAnchor(spec.window.fromAnchor, tl)
      if (s === undefined) {
        throw new Error(
          `barrage: window.fromAnchor ${JSON.stringify(spec.window.fromAnchor)} does not resolve`,
        )
      }
      start = s
    } else {
      start = tPeak - (spec.window.windowSec ?? 20)
    }
    const t0 = Math.max(0, start)
    const w = tPeak - t0
    const catalog = this.owner.catalog
    const caliber = (id: string): number => {
      const e = catalog.find(id)
      return e !== undefined && e.medium === 'pyro' ? e.caliberMm : 0
    }
    const pool = [...spec.effectPool].sort(
      (a, b) => caliber(a) - caliber(b) || (a < b ? -1 : a > b ? 1 : 0),
    )
    const prefix = spec.idPrefix ?? this.nextId()

    let k = 0
    const emit = (effectId: string, anchor: MusicAnchor): void => {
      const raw: RawCue = {
        id: `${prefix}-${pad3(k)}`,
        effectId,
        anchor,
        positionId: spec.positions[k % spec.positions.length]!,
      }
      if (spec.priority !== undefined) raw.priority = spec.priority
      this.pushRaw(raw)
      k++
    }

    if (w > 1e-9) {
      let t = t0
      let guard = 0
      while (t < tPeak - 1e-9 && guard++ < 100_000) {
        const u = (t - t0) / w
        emit(pool[Math.min(pool.length - 1, Math.floor(u * pool.length))]!, { kind: 'sec', t })
        const rate = spec.startRateHz + (spec.endRateHz - spec.startRateHz) * u * u
        t += 1 / rate
      }
    }
    emit(pool[pool.length - 1]!, spec.window.peak)
    return this
  }
}

class DroneTrackBuilder extends TrackBuilder {
  /** A formation fully formed by `by` and held for holdSec after landing. */
  formation(spec: FormationSpec): this {
    const params: CueParams = { ...(spec.params ?? {}) }
    if (spec.holdSec !== undefined) params['holdSec'] = spec.holdSec
    const raw: RawCue = { effectId: spec.effect, anchor: spec.by, positionId: spec.position }
    if (Object.keys(params).length > 0) raw.params = params
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }

  /**
   * Countdown digits, one per landing: landings.length−1 … 0 (11 landings =
   * classic 10…0). Digits 0–9 use the catalog's first 'digit' formation;
   * larger numbers ('10', …) use its first 'text' formation. NOTE: landings
   * must be spaced at least digit-duration + morph anticipation apart or the
   * solver reports DRONE_OVERLAP.
   */
  countdown(spec: CountdownSpec): this {
    const catalog = this.owner.catalog
    const digitEffect = catalog.effects.find((e) => e.medium === 'drone' && e.formation === 'digit')
    if (!digitEffect) throw new Error("countdown: catalog has no drone 'digit' formation effect")
    const textEffect = catalog.effects.find((e) => e.medium === 'drone' && e.formation === 'text')
    const prefix = spec.idPrefix ?? this.nextId()
    const startDigit = spec.landings.length - 1
    spec.landings.forEach((land, i) => {
      const d = startDigit - i
      const effect = d <= 9 ? digitEffect : textEffect
      if (!effect) {
        throw new Error(`countdown: digit ${d} needs a drone 'text' formation in the catalog`)
      }
      const params: CueParams = { text: String(d) }
      if (spec.count !== undefined) params['count'] = spec.count
      if (spec.scaleM !== undefined) params['scaleM'] = spec.scaleM
      const raw: RawCue = {
        id: `${prefix}-${pad3(i)}`,
        effectId: effect.id,
        anchor: land,
        positionId: spec.position,
        params,
      }
      if (spec.priority !== undefined) raw.priority = spec.priority
      this.pushRaw(raw)
    })
    return this
  }
}

class LaserTrackBuilder extends TrackBuilder {
  /**
   * A laser pattern starting at `from`. durBeats (or holdSec, converted via
   * the tempo map) becomes params.periodBeats — the beat-locked cycle length.
   */
  pattern(spec: LaserPatternSpec): this {
    const params: CueParams = { ...(spec.params ?? {}) }
    if (spec.durBeats !== undefined) {
      params['periodBeats'] = spec.durBeats
    } else if (spec.holdSec !== undefined) {
      const tl = this.owner.requireMusic('lasers.pattern holdSec')
      const tempo = tempoMapsFrom(tl.tempo).tempo
      const t = resolveAnchor(spec.from, tl) ?? 0
      params['periodBeats'] = tempo.secToBeat(t + spec.holdSec) - tempo.secToBeat(t)
    }
    const raw: RawCue = { effectId: spec.effect, anchor: spec.from, positionId: spec.position }
    if (Object.keys(params).length > 0) raw.params = params
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }
}

class PanelTrackBuilder extends TrackBuilder {
  /** A panel pattern starting at `from` (rgb/rgb2 forwarded as params). */
  pattern(spec: PanelPatternSpec): this {
    const params: CueParams = { ...(spec.params ?? {}) }
    if (spec.rgb !== undefined) params['rgb'] = spec.rgb
    if (spec.rgb2 !== undefined) params['rgb2'] = spec.rgb2
    const raw: RawCue = { effectId: spec.effect, anchor: spec.from, positionId: spec.position }
    if (Object.keys(params).length > 0) raw.params = params
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }

  /** Scrolling text on the catalog's first 'text' panel pattern. */
  ticker(text: string, spec: TickerSpec): this {
    const effect = this.owner.catalog.effects.find(
      (e) => e.medium === 'panel' && e.pattern === 'text',
    )
    if (!effect) throw new Error("ticker: catalog has no 'text' panel pattern")
    const params: CueParams = { text, speedPxPerBeat: spec.speedPxPerBeat ?? 8 }
    if (spec.rgb !== undefined) params['rgb'] = spec.rgb
    const raw: RawCue = {
      effectId: effect.id,
      anchor: spec.from,
      positionId: spec.position,
      params,
    }
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }
}

class CrowdTrackBuilder extends TrackBuilder {
  /** Whole-canvas color flood held from `from` (rgb/rgb2/intensity as params). */
  flood(spec: CrowdFloodSpec): this {
    const params: CueParams = {}
    if (spec.rgb !== undefined) params['rgb'] = spec.rgb
    if (spec.rgb2 !== undefined) params['rgb2'] = spec.rgb2
    if (spec.intensity !== undefined) params['intensity'] = spec.intensity
    const raw: RawCue = { effectId: spec.effect, anchor: spec.from, positionId: spec.position }
    if (Object.keys(params).length > 0) raw.params = params
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }

  /** One traveling wavefront across the crowd canvas (choreo crowdWave). */
  wave(spec: CrowdWaveSpec): this {
    const s: Parameters<typeof crowdWave>[0] = {
      effect: spec.effect,
      mastId: spec.position,
      from: spec.from,
      periodBeats: spec.periodBeats,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.dirDeg !== undefined) s.dirDeg = spec.dirDeg
    if (spec.rgb !== undefined) s.rgb = spec.rgb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of crowdWave(s)) this.push(c)
    return this
  }

  /**
   * Rings pulsing outward from originCell (choreo crowdRadial). Without an
   * originCell the cue carries no origin and the sim radiates from the zone
   * center (mirroring heartbeat).
   */
  pulse(spec: CrowdPulseSpec): this {
    const prefix = spec.idPrefix ?? this.nextId()
    if (spec.originCell !== undefined) {
      const s: Parameters<typeof crowdRadial>[0] = {
        effect: spec.effect,
        mastId: spec.position,
        land: spec.land,
        originCell: spec.originCell,
        idPrefix: prefix,
      }
      if (spec.periodBeats !== undefined) s.periodBeats = spec.periodBeats
      if (spec.rgb !== undefined) s.rgb = spec.rgb
      if (spec.priority !== undefined) s.priority = spec.priority
      for (const c of crowdRadial(s)) this.push(c)
      return this
    }
    const params: CueParams = {}
    if (spec.periodBeats !== undefined) params['periodBeats'] = spec.periodBeats
    if (spec.rgb !== undefined) params['rgb'] = spec.rgb
    const raw: RawCue = {
      id: `${prefix}-${pad3(0)}`,
      effectId: spec.effect,
      anchor: spec.land,
      positionId: spec.position,
    }
    if (Object.keys(params).length > 0) raw.params = params
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }

  /** One cue per section, landing startLand + i·stepBeats (choreo crowdSectionChase). */
  chase(spec: CrowdChaseSpec): this {
    const s: Parameters<typeof crowdSectionChase>[0] = {
      effect: spec.effect,
      mastId: spec.position,
      startLand: spec.startLand,
      stepBeats: spec.stepBeats,
      sections: spec.sections,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.rgb !== undefined) s.rgb = spec.rgb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of crowdSectionChase(s)) this.push(c)
    return this
  }

  /** Marquee `text` rendered across the crowd canvas (choreo crowdText). */
  text(text: string, spec: CrowdTextSpec): this {
    const s: Parameters<typeof crowdText>[1] = {
      effect: spec.effect,
      mastId: spec.position,
      land: spec.land,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.rgb !== undefined) s.rgb = spec.rgb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of crowdText(text, s)) this.push(c)
    return this
  }

  /** Random twinkle over the lawn from `from` (densityFrac/twinkleHz as params). */
  sparkle(spec: CrowdSparkleSpec): this {
    const params: CueParams = {}
    if (spec.densityFrac !== undefined) params['densityFrac'] = spec.densityFrac
    if (spec.twinkleHz !== undefined) params['twinkleHz'] = spec.twinkleHz
    if (spec.rgb !== undefined) params['rgb'] = spec.rgb
    const raw: RawCue = { effectId: spec.effect, anchor: spec.from, positionId: spec.position }
    if (Object.keys(params).length > 0) raw.params = params
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }

  /** Slow double-thump swell over the whole lawn (choreo crowdHeartbeat). */
  heartbeat(spec: CrowdHeartbeatSpec): this {
    const s: Parameters<typeof crowdHeartbeat>[0] = {
      effect: spec.effect,
      mastId: spec.position,
      land: spec.land,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.originCell !== undefined) s.originCell = spec.originCell
    if (spec.rgb !== undefined) s.rgb = spec.rgb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of crowdHeartbeat(s)) this.push(c)
    return this
  }

  /** One haptic thump on the wristband channel (non-visual). */
  haptic(spec: CrowdHapticSpec): this {
    const raw: RawCue = { effectId: spec.effect, anchor: spec.land, positionId: spec.position }
    if (spec.id !== undefined) raw.id = spec.id
    if (spec.priority !== undefined) raw.priority = spec.priority
    this.pushRaw(raw)
    return this
  }
}

class BeamTrackBuilder extends TrackBuilder {
  /** Hold a narrow audible zone on one crowd cell (choreo beamWhisper). */
  whisper(spec: BeamWhisperSpec): this {
    const s: Parameters<typeof beamWhisper>[0] = {
      effect: spec.effect,
      arrayId: spec.position,
      land: spec.land,
      targetCellId: spec.target,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.gainDb !== undefined) s.gainDb = spec.gainDb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of beamWhisper(s)) this.push(c)
    return this
  }

  /** Sweep the footprint along a cell path (choreo beamFlyover). */
  flyover(spec: BeamFlyoverSpec): this {
    const s: Parameters<typeof beamFlyover>[0] = {
      effect: spec.effect,
      arrayId: spec.position,
      land: spec.land,
      pathCellIds: spec.path,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.gainDb !== undefined) s.gainDb = spec.gainDb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of beamFlyover(s)) this.push(c)
    return this
  }

  /**
   * Crossed stereo pair (choreo beamStereoPair): exactly two cues, roles 'L'
   * and 'R' on positions[0]/positions[1], converging on `target` with a shared
   * pairId (the cue id prefix when omitted) and the same landing anchor.
   */
  stereo(spec: BeamStereoSpec): this {
    const prefix = spec.idPrefix ?? this.nextId()
    const s: Parameters<typeof beamStereoPair>[0] = {
      effect: spec.effect,
      arrayIds: spec.positions,
      land: spec.land,
      targetCellId: spec.target,
      pairId: spec.pairId ?? prefix,
      idPrefix: prefix,
    }
    if (spec.extraDelayMs !== undefined) s.extraDelayMs = spec.extraDelayMs
    if (spec.gainDb !== undefined) s.gainDb = spec.gainDb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of beamStereoPair(s)) this.push(c)
    return this
  }

  /** Bounce the footprint between the end cells every periodBeats (choreo beamPingPong). */
  pingPong(spec: BeamPingPongSpec): this {
    const s: Parameters<typeof beamPingPong>[0] = {
      effect: spec.effect,
      arrayId: spec.position,
      land: spec.land,
      cellIds: spec.cells,
      periodBeats: spec.periodBeats,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.gainDb !== undefined) s.gainDb = spec.gainDb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of beamPingPong(s)) this.push(c)
    return this
  }

  /** Point the audible tag at another cue's ground position (choreo beamTag). */
  tag(spec: BeamTagSpec): this {
    const s: Parameters<typeof beamTag>[0] = {
      effect: spec.effect,
      arrayId: spec.position,
      land: spec.land,
      sourceCueId: spec.source,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.fallbackTarget !== undefined) s.targetCellId = spec.fallbackTarget
    if (spec.gainDb !== undefined) s.gainDb = spec.gainDb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of beamTag(s)) this.push(c)
    return this
  }

  /** The everywhere-at-once bell: params.cells = 'all' (choreo beamToll). */
  toll(spec: BeamTollSpec): this {
    const s: Parameters<typeof beamToll>[0] = {
      effect: spec.effect,
      arrayId: spec.position,
      land: spec.land,
      idPrefix: spec.idPrefix ?? this.nextId(),
    }
    if (spec.gainDb !== undefined) s.gainDb = spec.gainDb
    if (spec.priority !== undefined) s.priority = spec.priority
    for (const c of beamToll(s)) this.push(c)
    return this
  }
}

// ---------------------------------------------------------------------------
// Show builder
// ---------------------------------------------------------------------------

export interface ShowBuilderOptions {
  id: string
  title: string
  seed: number
  site: SitePlan
  catalog: Catalog
  variant?: 'standard' | 'quiet'
  /** Written to Show.catalogId (default STARTER_CATALOG_ID). */
  catalogId?: string
}

export interface BuildResult {
  show: Show
  compiled: CompiledShow
}

/** Track order in the emitted Show (only non-empty tracks are included). */
const TRACK_DEFS = [
  { id: 'pyro', medium: 'pyro', name: 'Pyro' },
  { id: 'drones', medium: 'drone', name: 'Drones' },
  { id: 'lasers', medium: 'laser', name: 'Lasers' },
  { id: 'panels', medium: 'panel', name: 'Panels' },
  { id: 'fabrication', medium: 'fabrication', name: 'Fabrication' },
  { id: 'crowd', medium: 'crowd', name: 'Crowd' },
  { id: 'beams', medium: 'beam', name: 'Beams' },
] as const

class ShowBuilderImpl {
  readonly catalog: Catalog
  private readonly opts: ShowBuilderOptions
  private tl: MusicalTimeline | undefined
  private budgetDb: number | undefined
  private preRollSec: Seconds | undefined
  private quantizeGrid: QuantizeGrid = 'none'
  private readonly cuesByTrack = new Map<string, Cue[]>()

  readonly pyro: PyroTrackBuilder
  readonly drones: DroneTrackBuilder
  readonly lasers: LaserTrackBuilder
  readonly panels: PanelTrackBuilder
  readonly fabrication: TrackBuilder
  readonly crowd: CrowdTrackBuilder
  readonly beams: BeamTrackBuilder

  constructor(opts: ShowBuilderOptions) {
    this.opts = opts
    this.catalog = opts.catalog
    for (const t of TRACK_DEFS) this.cuesByTrack.set(t.id, [])
    this.pyro = new PyroTrackBuilder(this, 'pyro')
    this.drones = new DroneTrackBuilder(this, 'drones')
    this.lasers = new LaserTrackBuilder(this, 'lasers')
    this.panels = new PanelTrackBuilder(this, 'panels')
    this.fabrication = new TrackBuilder(this, 'fabrication')
    this.crowd = new CrowdTrackBuilder(this, 'crowd')
    this.beams = new BeamTrackBuilder(this, 'beams')
  }

  /** @internal track facades append through here. */
  addCue(trackId: string, cue: Cue): void {
    this.cuesByTrack.get(trackId)!.push(cue)
  }

  /** @internal */
  requireMusic(what: string): MusicalTimeline {
    if (!this.tl) throw new Error(`${what}: call .music(timeline) or .score(score) first`)
    return this.tl
  }

  /** Set the show's musical timeline. */
  music(tl: MusicalTimeline): this {
    this.tl = tl
    return this
  }

  /** Build the timeline from an authored score. */
  score(score: Score): this {
    return this.music(buildTimelineFromScore(score))
  }

  /** Peak SPL budget at the worst reference listener. */
  noiseBudget(maxSplDb: number): this {
    this.budgetDb = maxSplDb
    return this
  }

  /** Transport pre-roll: fires may start as early as −sec. */
  preRoll(sec: Seconds): this {
    if (!(sec >= 0)) throw new Error('preRoll: sec must be >= 0')
    this.preRollSec = sec
    return this
  }

  /** Landing-time quantize grid passed to the solver. */
  quantize(grid: QuantizeGrid): this {
    this.quantizeGrid = grid
    return this
  }

  /**
   * Assemble the plain Show and compile it. Throws an Error listing every
   * error-severity diagnostic; warnings ride along on compiled.diagnostics.
   */
  build(): BuildResult {
    const tl = this.requireMusic('build')
    const tracks: Track[] = []
    for (const def of TRACK_DEFS) {
      const cues = this.cuesByTrack.get(def.id)!
      if (cues.length === 0) continue
      tracks.push({ id: def.id, medium: def.medium, name: def.name, cues: [...cues] })
    }
    const show: Show = {
      meta: {
        id: this.opts.id,
        title: this.opts.title,
        variant: this.opts.variant ?? 'standard',
        seed: this.opts.seed,
      },
      music: tl,
      site: this.opts.site,
      catalogId: this.opts.catalogId ?? STARTER_CATALOG_ID,
      tracks,
    }
    if (this.preRollSec !== undefined) show.preRollSec = this.preRollSec
    if (this.budgetDb !== undefined) show.noiseBudget = { maxSplDb: this.budgetDb }

    const compiled = compile(show, this.catalog, { quantize: this.quantizeGrid })
    const errors = compiled.diagnostics.filter((d) => d.severity === 'error')
    if (errors.length > 0) {
      throw new Error(
        `show '${show.meta.id}' failed to build with ${errors.length} error(s):\n` +
          errors.map((d) => `  - [${d.code}] ${d.message}`).join('\n'),
      )
    }
    return { show, compiled }
  }
}

/** Public builder type (implementation class is internal). */
export type ShowBuilder = ShowBuilderImpl

/** Create a fluent show builder. See the module doc for the full surface. */
export function showBuilder(opts: ShowBuilderOptions): ShowBuilder {
  return new ShowBuilderImpl(opts)
}
