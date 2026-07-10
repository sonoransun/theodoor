/**
 * Shared fixture for fab-*.test.ts: a 20-cue two-caliber compiled show on a
 * site with one mortar rack, one 200-drone pad, two laser towers, and two
 * identical pixel panels — plus a tiny stack-based tag-balance checker.
 */
import type {
  CompiledCue,
  CompiledShow,
  EffectDef,
  MusicalTimeline,
  Show,
  SitePlan,
} from '../src/contracts.js'
import { cueSeed } from '../src/math/index.js'

const effects: Record<string, EffectDef> = {
  p75: {
    id: 'p75',
    name: 'Crimson Peony 75',
    medium: 'pyro',
    tags: ['red'],
    noiseDbAt15m: 110,
    durationSec: 1.8,
    category: 'peony',
    caliberMm: 75,
    riseTimeSec: 2.2,
    burstHeightM: 90,
    burstRadiusM: 35,
    starCount: 60,
    colors: ['#ff4040'],
    dragK: 0.4,
    gravityBias: 0.2,
    minAudienceDistanceM: 65,
  },
  p100: {
    id: 'p100',
    name: 'Gold Brocade 100',
    medium: 'pyro',
    tags: ['gold'],
    noiseDbAt15m: 114,
    durationSec: 2.6,
    category: 'brocade',
    caliberMm: 100,
    riseTimeSec: 2.8,
    burstHeightM: 120,
    burstRadiusM: 48,
    starCount: 90,
    colors: ['#ffcc66'],
    dragK: 0.35,
    gravityBias: 0.6,
    minAudienceDistanceM: 85,
  },
  fabFall: {
    id: 'fabFall',
    name: 'Silver Waterfall',
    medium: 'fabrication',
    tags: ['silver'],
    noiseDbAt15m: 88,
    durationSec: 20,
    kind: 'waterfall',
    widthM: 30,
    heightM: 8,
    minAudienceDistanceM: 30,
  },
}

export const getEffect = (id: string): EffectDef | undefined => effects[id]

export function makeSite(): SitePlan {
  return {
    id: 'site-fab-fixture',
    assets: [
      {
        id: 'rackA',
        kind: 'mortarRack',
        pos: { x: 0, y: 0 },
        headingDeg: 0,
        elevationM: 0,
        rack: { calibersMm: [75, 100], tiltDeg: 0, pinsPerModule: 32, maxSimultaneousPins: 8 },
      },
      {
        id: 'padA',
        kind: 'dronePad',
        pos: { x: 30, y: 10 },
        headingDeg: 0,
        elevationM: 0,
        fleet: { count: 200, vMaxMps: 8, aMaxMps2: 4, rMinM: 2 },
      },
      {
        id: 'laserL',
        kind: 'laserTower',
        pos: { x: -40, y: 5 },
        headingDeg: 10,
        elevationM: 3,
        laser: { minElevationDeg: 5, scanFovDeg: 60, terminationM: 400 },
      },
      {
        id: 'laserR',
        kind: 'laserTower',
        pos: { x: 40, y: 5 },
        headingDeg: -10,
        elevationM: 3,
        laser: { minElevationDeg: 5, scanFovDeg: 60, terminationM: 400 },
      },
      {
        id: 'panelA',
        kind: 'panel',
        pos: { x: -15, y: 2 },
        headingDeg: 180,
        elevationM: 4,
        panel: { wPx: 32, hPx: 16, pitchMm: 10 },
      },
      {
        id: 'panelB',
        kind: 'panel',
        pos: { x: 15, y: 2 },
        headingDeg: 180,
        elevationM: 4,
        panel: { wPx: 32, hPx: 16, pitchMm: 10 },
      },
    ],
    audience: [
      { x: -60, y: -80 },
      { x: 60, y: -80 },
    ],
    audienceZone: [
      { x: -60, y: -80 },
      { x: 60, y: -80 },
      { x: 60, y: -130 },
      { x: -60, y: -130 },
    ],
    exclusionZones: [],
    geofence: [
      { x: -100, y: -20 },
      { x: 100, y: -20 },
      { x: 100, y: 150 },
      { x: -100, y: 150 },
    ],
    maxAltitudeM: 120,
    wind: { dirDegFrom: 270, speedMps: 2, limitMps: 9 },
    refListenerPos: [{ x: 0, y: -80 }],
  }
}

const SHOW_SEED = 42

function cue(
  id: string,
  medium: CompiledCue['medium'],
  effectId: string,
  targetSec: number,
  anticipationSec: number,
  durationSec: number,
  positionId?: string,
): CompiledCue {
  return {
    id,
    trackId: `${medium}-1`,
    medium,
    effectId,
    positionId,
    targetSec,
    fireSec: targetSec - anticipationSec,
    anticipationSec,
    durationSec,
    seed: cueSeed(SHOW_SEED, id),
  }
}

/** 20 pyro cues from rackA (12 x 75 mm + 8 x 100 mm) plus 2 waterfall cues. */
export function makeCompiled(site: SitePlan = makeSite()): CompiledShow {
  const cues: CompiledCue[] = []
  for (let i = 0; i < 12; i++) cues.push(cue(`c75-${i}`, 'pyro', 'p75', 10 + i * 4, 2.2, 1.8, 'rackA'))
  for (let i = 0; i < 8; i++) cues.push(cue(`c100-${i}`, 'pyro', 'p100', 12 + i * 6, 2.8, 2.6, 'rackA'))
  cues.push(cue('fall-1', 'fabrication', 'fabFall', 30, 0, 20, 'rackA'))
  cues.push(cue('fall-2', 'fabrication', 'fabFall', 62, 0, 20, 'rackA'))
  cues.sort(
    (a, b) => a.fireSec - b.fireSec || a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id),
  )

  const music: MusicalTimeline = {
    source: 'analysis',
    id: 'music-fab-fixture',
    title: 'Fab Fixture',
    duration: 90,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats: [],
    downbeats: [],
    annotations: [],
    energy: [],
    tempoConfidence: 0.8,
  }
  const show: Show = {
    meta: { id: 'show-fab-fixture', title: 'Fab Fixture', variant: 'standard', seed: SHOW_SEED },
    music,
    site,
    catalogId: 'test-catalog',
    tracks: [],
  }
  return { show, cues, diagnostics: [] }
}

/**
 * Minimal stack parser: throws unless every open tag is closed in order.
 * Also trips on raw '<'/'>' inside attribute values (escaping bugs), since
 * those would desync the tag scan.
 */
export function assertBalancedSvg(svg: string): void {
  const stack: string[] = []
  // escapeAttr/escapeText guarantee no raw '<'/'>' inside values or content,
  // so a tag is simply '<' ... '>' with no angle brackets in between.
  const re = /<(\/?)([A-Za-z][\w-]*)([^<>]*)>/g
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(svg))) {
    const between = svg.slice(cursor, m.index)
    if (between.includes('<') || between.includes('>')) {
      throw new Error(`stray angle bracket in content near index ${cursor}`)
    }
    cursor = m.index + m[0].length
    const closing = m[1] === '/'
    const name = m[2]!
    const selfClosing = m[3]!.endsWith('/')
    if (closing) {
      const top = stack.pop()
      if (top !== name) throw new Error(`</${name}> closes <${top ?? 'nothing'}>`)
    } else if (!selfClosing) {
      stack.push(name)
    }
  }
  if (svg.slice(cursor).includes('<') || svg.slice(cursor).includes('>')) {
    throw new Error('stray angle bracket after last tag')
  }
  if (stack.length > 0) throw new Error(`unclosed tags: ${stack.join(', ')}`)
}
