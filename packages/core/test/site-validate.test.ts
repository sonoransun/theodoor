import { describe, expect, it } from 'vitest'
import type {
  CompiledCue,
  CompiledShow,
  CueParams,
  Diagnostic,
  DronePrimitive,
  EffectDef,
  Medium,
  MusicalTimeline,
  PositionedAsset,
  PyroEffect,
  Show,
  SitePlan,
  Vec2,
} from '../src/contracts.js'
import { v2 } from '../src/math/index.js'
import { validateSite } from '../src/site/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const shell75: PyroEffect = {
  id: 'shell-75',
  name: 'Test Peony 75',
  medium: 'pyro',
  tags: ['test'],
  noiseDbAt15m: 108,
  durationSec: 1.8,
  category: 'peony',
  caliberMm: 75,
  riseTimeSec: 2.2,
  burstHeightM: 75,
  burstRadiusM: 25,
  starCount: 120,
  colors: ['#ff6633'],
  dragK: 0.4,
  gravityBias: 0.2,
  minAudienceDistanceM: 60,
}

const ring40: DronePrimitive = {
  id: 'ring-40',
  name: 'Test Ring',
  medium: 'drone',
  tags: ['test'],
  noiseDbAt15m: 40,
  durationSec: 12,
  formation: 'ring',
  minDrones: 50,
  maxDrones: 200,
  scaleM: 40,
}

const EFFECTS: readonly EffectDef[] = [shell75, ring40]
const getEffect = (id: string): EffectDef | undefined => EFFECTS.find((e) => e.id === id)

/**
 * Base test venue: audience front line along y = 0 (x ±100), audience lawn
 * south of it (y ∈ [-50, 0]), geofence north of the firing line
 * (x ±80, y ∈ [10, 160]). Racks are placed north of the audience per test.
 */
function makeSite(overrides: Partial<SitePlan> = {}): SitePlan {
  return {
    id: 'test-site',
    assets: [],
    audience: [v2(-100, 0), v2(100, 0)],
    audienceZone: [v2(-100, 0), v2(100, 0), v2(100, -50), v2(-100, -50)],
    exclusionZones: [],
    geofence: [v2(-80, 10), v2(80, 10), v2(80, 160), v2(-80, 160)],
    maxAltitudeM: 150,
    wind: { dirDegFrom: 270, speedMps: 0, limitMps: 9 },
    refListenerPos: [v2(0, 0)],
    ...overrides,
  }
}

function rack(id: string, pos: Vec2, headingDeg = 180, tiltDeg = 0): PositionedAsset {
  return {
    id,
    kind: 'mortarRack',
    pos,
    headingDeg,
    elevationM: 0,
    rack: { calibersMm: [75, 100], tiltDeg, pinsPerModule: 32, maxSimultaneousPins: 8 },
  }
}

function pad(id: string, pos: Vec2): PositionedAsset {
  return {
    id,
    kind: 'dronePad',
    pos,
    headingDeg: 0,
    elevationM: 0,
    fleet: { count: 200, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 },
  }
}

function laser(
  id: string,
  pos: Vec2,
  headingDeg: number,
  minElevationDeg: number,
  terminationM = 500,
  elevationM = 0,
): PositionedAsset {
  return {
    id,
    kind: 'laserTower',
    pos,
    headingDeg,
    elevationM,
    laser: { minElevationDeg, scanFovDeg: 60, terminationM },
  }
}

let cueCounter = 0
function cue(medium: Medium, effectId: string, positionId?: string, params?: CueParams): CompiledCue {
  return {
    id: `cue-${++cueCounter}`,
    trackId: 'trk-1',
    medium,
    effectId,
    positionId,
    targetSec: 10,
    fireSec: 8,
    anticipationSec: 2,
    durationSec: 2,
    seed: 1234,
    params,
  }
}

function makeCompiled(site: SitePlan, cues: readonly CompiledCue[]): CompiledShow {
  const music: MusicalTimeline = {
    source: 'score',
    id: 'music-1',
    title: 'Test Music',
    duration: 60,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats: [],
    downbeats: [],
    annotations: [],
    energy: [],
    tempoConfidence: 1,
  }
  const show: Show = {
    meta: { id: 'show-1', title: 'Test Show', variant: 'standard', seed: 7 },
    music,
    site,
    catalogId: 'catalog-1',
    tracks: [],
  }
  return { show, cues, diagnostics: [] }
}

const byCode = (diags: readonly Diagnostic[], code: string): Diagnostic[] =>
  diags.filter((d) => d.code === code)

// ---------------------------------------------------------------------------
// separation
// ---------------------------------------------------------------------------

describe('separation', () => {
  // 75 mm shell: required = max(60, 0.84 * 75) = 63 m.
  const rows: readonly { rackY: number; fails: boolean }[] = [
    { rackY: 62, fails: true },
    { rackY: 64, fails: false },
    { rackY: 120, fails: false },
  ]

  for (const row of rows) {
    it(`75 mm rack at ${row.rackY} m ${row.fails ? 'fails' : 'passes'}`, () => {
      const site = makeSite({ assets: [rack('r1', v2(0, row.rackY))] })
      const compiled = makeCompiled(site, [cue('pyro', 'shell-75', 'r1')])
      const seps = byCode(validateSite(site, compiled, getEffect), 'separation')
      if (row.fails) {
        expect(seps).toHaveLength(1)
        expect(seps[0]!.severity).toBe('error')
        expect(seps[0]!.assetId).toBe('r1')
        expect(seps[0]!.cueIds).toHaveLength(1)
      } else {
        expect(seps).toHaveLength(0)
      }
    })
  }

  // Tilt drift = tan(20°) * burstHeight 75 ≈ 27.3 m along the rack heading.
  const tiltRows: readonly { tiltDeg: number; headingDeg: number; fails: boolean }[] = [
    { tiltDeg: 0, headingDeg: 180, fails: false }, // 70 m ≥ 63 m
    { tiltDeg: 20, headingDeg: 180, fails: true }, // 70 − 27.3 ≈ 42.7 m < 63 m
    { tiltDeg: 20, headingDeg: 0, fails: false }, // tilted away: 97.3 m
  ]

  for (const row of tiltRows) {
    it(`tilt ${row.tiltDeg}° heading ${row.headingDeg}° at 70 m ${row.fails ? 'fails' : 'passes'}`, () => {
      const site = makeSite({ assets: [rack('r1', v2(0, 70), row.headingDeg, row.tiltDeg)] })
      const compiled = makeCompiled(site, [cue('pyro', 'shell-75', 'r1')])
      const seps = byCode(validateSite(site, compiled, getEffect), 'separation')
      expect(seps).toHaveLength(row.fails ? 1 : 0)
    })
  }

  it('aggregates repeated cues of one effect into a single diagnostic', () => {
    const site = makeSite({ assets: [rack('r1', v2(0, 62))] })
    const compiled = makeCompiled(site, [
      cue('pyro', 'shell-75', 'r1'),
      cue('pyro', 'shell-75', 'r1'),
      cue('pyro', 'shell-75', 'r1'),
    ])
    const seps = byCode(validateSite(site, compiled, getEffect), 'separation')
    expect(seps).toHaveLength(1)
    expect(seps[0]!.cueIds).toHaveLength(3)
  })

  it('fails closed on an unresolvable pyro effect; skips missing/foreign positions', () => {
    const site = makeSite({ assets: [rack('r1', v2(0, 100)), pad('p1', v2(0, 40))] })
    const compiled = makeCompiled(site, [
      // On a rack but unverifiable — the one cue whose separation/fallout
      // CANNOT be checked must fail the gate, not silently pass it.
      cue('pyro', 'no-such-effect', 'r1'),
      cue('pyro', 'shell-75'), // no positionId — not on any rack, skipped
      cue('pyro', 'shell-75', 'ghost-rack'), // unknown asset, skipped
      cue('pyro', 'shell-75', 'p1'), // not a mortarRack, skipped
    ])
    const seps = byCode(validateSite(site, compiled, getEffect), 'separation')
    expect(seps).toHaveLength(1)
    expect(seps[0]!.severity).toBe('error')
    expect(seps[0]!.message).toContain('no-such-effect')
  })
})

// ---------------------------------------------------------------------------
// fallout
// ---------------------------------------------------------------------------

describe('fallout', () => {
  // Drift time = rise 2.2 + duration 1.8 + 3 = 7 s. Radius = 25 * 1.25 = 31.25 m.
  const rows: readonly { speedMps: number; dirDegFrom: number; fails: boolean }[] = [
    { speedMps: 0, dirDegFrom: 0, fails: false }, // centroid 64 m from zone
    { speedMps: 6, dirDegFrom: 0, fails: true }, // 42 m south → 22 m < 31.25 m
    { speedMps: 6, dirDegFrom: 180, fails: false }, // blown away from audience
  ]

  for (const row of rows) {
    it(`wind ${row.speedMps} m/s from ${row.dirDegFrom}° ${row.fails ? 'fails' : 'passes'}`, () => {
      const site = makeSite({
        assets: [rack('r1', v2(0, 64))],
        wind: { dirDegFrom: row.dirDegFrom, speedMps: row.speedMps, limitMps: 9 },
      })
      const compiled = makeCompiled(site, [cue('pyro', 'shell-75', 'r1')])
      const diags = validateSite(site, compiled, getEffect)
      expect(byCode(diags, 'separation')).toHaveLength(0) // 64 m ≥ 63 m regardless of wind
      expect(byCode(diags, 'fallout')).toHaveLength(row.fails ? 1 : 0)
    })
  }

  it('flags fallout drifting into an exclusion zone but not the audience', () => {
    // Wind from 270° blows east: centroid (42, 64), radius 31.25 m.
    const site = makeSite({
      assets: [rack('r1', v2(0, 64))],
      wind: { dirDegFrom: 270, speedMps: 6, limitMps: 9 },
      exclusionZones: [
        { id: 'boat-dock', poly: [v2(60, 50), v2(90, 50), v2(90, 80), v2(60, 80)] },
      ],
    })
    const compiled = makeCompiled(site, [cue('pyro', 'shell-75', 'r1')])
    const fallout = byCode(validateSite(site, compiled, getEffect), 'fallout')
    expect(fallout).toHaveLength(1)
    expect(fallout[0]!.message).toContain('boat-dock')
  })
})

// ---------------------------------------------------------------------------
// wind (site-level thresholds, independent of cues)
// ---------------------------------------------------------------------------

describe('wind thresholds', () => {
  const rows: readonly { speedMps: number; expected: 'none' | 'warning' | 'error' }[] = [
    { speedMps: 5, expected: 'none' }, // ≤ 0.8 × 9 = 7.2
    { speedMps: 7.2, expected: 'none' }, // boundary: not strictly above
    { speedMps: 7.3, expected: 'warning' },
    { speedMps: 9, expected: 'error' }, // at limit
    { speedMps: 12, expected: 'error' },
  ]

  for (const row of rows) {
    it(`speed ${row.speedMps} m/s (limit 9) → ${row.expected}`, () => {
      const site = makeSite({ wind: { dirDegFrom: 270, speedMps: row.speedMps, limitMps: 9 } })
      const winds = byCode(validateSite(site, null, getEffect), 'wind')
      if (row.expected === 'none') expect(winds).toHaveLength(0)
      else {
        expect(winds).toHaveLength(1)
        expect(winds[0]!.severity).toBe(row.expected)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// laser-horizon
// ---------------------------------------------------------------------------

describe('laser-horizon', () => {
  // Tower at (0, 50): audience zone is 50 m away to the south (heading 180).
  const rows: readonly {
    name: string
    headingDeg: number
    minElevationDeg: number
    terminationM: number
    elevationM: number
    fails: boolean
  }[] = [
    {
      name: '2° aimed at the audience fails',
      headingDeg: 180, minElevationDeg: 2, terminationM: 500, elevationM: 0,
      fails: true, // beam height 50·tan 2° ≈ 1.75 m < 3 m; reach ≈ 499.7 m ≥ 50 m
    },
    {
      name: '5° aimed at the audience passes',
      headingDeg: 180, minElevationDeg: 5, terminationM: 500, elevationM: 0,
      fails: false, // scan floor above the 3° horizon margin
    },
    {
      name: '2° with short termination passes',
      headingDeg: 180, minElevationDeg: 2, terminationM: 30, elevationM: 0,
      fails: false, // beam terminates ~30 m out, audience at 50 m
    },
    {
      name: '2° from a 4 m tower passes',
      headingDeg: 180, minElevationDeg: 2, terminationM: 500, elevationM: 4,
      fails: false, // beam height 4 + 1.75 ≈ 5.75 m ≥ 3 m clearance
    },
    {
      name: '2° aimed away from the audience passes',
      headingDeg: 0, minElevationDeg: 2, terminationM: 500, elevationM: 0,
      fails: false, // scan sector 0° ± 30° never overlaps zone at ~180° ± 63°
    },
  ]

  for (const row of rows) {
    it(row.name, () => {
      const site = makeSite({
        assets: [
          laser('l1', v2(0, 50), row.headingDeg, row.minElevationDeg, row.terminationM, row.elevationM),
        ],
      })
      const hits = byCode(validateSite(site, null, getEffect), 'laser-horizon')
      if (row.fails) {
        expect(hits).toHaveLength(1)
        expect(hits[0]!.severity).toBe('error')
        expect(hits[0]!.assetId).toBe('l1')
      } else {
        expect(hits).toHaveLength(0)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// geofence / overflight / altitude
// ---------------------------------------------------------------------------

describe('drone geofence and overflight', () => {
  const padRows: readonly { name: string; pos: Vec2; fails: boolean }[] = [
    { name: 'pad well inside the geofence passes', pos: v2(0, 40), fails: false },
    { name: 'pad outside the geofence fails', pos: v2(0, 5), fails: true },
    { name: 'pad within the 1 m inset fails', pos: v2(0, 10.5), fails: true },
    { name: 'pad far outside fails', pos: v2(200, 40), fails: true },
  ]

  for (const row of padRows) {
    it(row.name, () => {
      const site = makeSite({ assets: [pad('p1', row.pos)] })
      const hits = byCode(validateSite(site, null, getEffect), 'geofence')
      expect(hits).toHaveLength(row.fails ? 1 : 0)
    })
  }

  it('formation circle contained by geofence and clear of audience passes', () => {
    const site = makeSite({ assets: [pad('p1', v2(0, 40))] })
    const compiled = makeCompiled(site, [cue('drone', 'ring-40', 'p1', { scaleM: 25 })])
    const diags = validateSite(site, compiled, getEffect)
    expect(byCode(diags, 'geofence')).toHaveLength(0)
    expect(byCode(diags, 'overflight')).toHaveLength(0)
    expect(byCode(diags, 'altitude')).toHaveLength(0)
  })

  it('formation circle escaping the geofence fails (params.scaleM override)', () => {
    // Pad 30 m from the geofence edge; ring scale 70 -> footprint radius 35 m > 30 m.
    const site = makeSite({ assets: [pad('p1', v2(0, 40))] })
    const compiled = makeCompiled(site, [cue('drone', 'ring-40', 'p1', { scaleM: 70 })])
    const diags = validateSite(site, compiled, getEffect)
    expect(byCode(diags, 'geofence')).toHaveLength(1)
    expect(byCode(diags, 'overflight')).toHaveLength(0) // audience is 40 m away
  })

  it('formation circle over the audience zone fails with overflight', () => {
    // Geofence extended south so containment passes and overflight isolates.
    const site = makeSite({
      geofence: [v2(-80, -30), v2(80, -30), v2(80, 160), v2(-80, 160)],
      assets: [pad('p1', v2(0, 20))],
    })
    const compiled = makeCompiled(site, [cue('drone', 'ring-40', 'p1', { scaleM: 50 })])
    const diags = validateSite(site, compiled, getEffect)
    expect(byCode(diags, 'geofence')).toHaveLength(0) // 50 m to boundary ≥ 25 m radius
    const over = byCode(diags, 'overflight')
    expect(over).toHaveLength(1) // audience zone 20 m away < 25 m footprint radius
    expect(over[0]!.severity).toBe('error')
    expect(over[0]!.assetId).toBe('p1')
  })

  it('formation flight top above maxAltitudeM warns (effect scaleM fallback)', () => {
    // ring scale 40: flight top = 30 base + 20 (scale/2) + 20 (max z) = 70 m > 30 m.
    const site = makeSite({ assets: [pad('p1', v2(0, 40))], maxAltitudeM: 30 })
    const compiled = makeCompiled(site, [cue('drone', 'ring-40', 'p1')]) // effect scaleM 40
    const alts = byCode(validateSite(site, compiled, getEffect), 'altitude')
    expect(alts).toHaveLength(1)
    expect(alts[0]!.severity).toBe('warning')
  })
})

// ---------------------------------------------------------------------------
// structure & listener
// ---------------------------------------------------------------------------

describe('structure and listener diagnostics', () => {
  it('clean base site with no show yields no diagnostics', () => {
    expect(validateSite(makeSite(), null, getEffect)).toHaveLength(0)
  })

  it('audience polyline with fewer than 2 points is a structural error', () => {
    const diags = validateSite(makeSite({ audience: [v2(0, 0)] }), null, getEffect)
    const structural = byCode(diags, 'site-structure')
    expect(structural).toHaveLength(1)
    expect(structural[0]!.severity).toBe('error')
    expect(structural[0]!.message).toContain('audience')
  })

  it('audienceZone with fewer than 3 points is a structural error', () => {
    const diags = validateSite(makeSite({ audienceZone: [v2(0, 0), v2(1, 0)] }), null, getEffect)
    expect(byCode(diags, 'site-structure')).toHaveLength(1)
  })

  it('degenerate exclusion polygon is a structural error naming the zone', () => {
    const site = makeSite({ exclusionZones: [{ id: 'stub', poly: [v2(0, 0), v2(1, 1)] }] })
    const structural = byCode(validateSite(site, null, getEffect), 'site-structure')
    expect(structural).toHaveLength(1)
    expect(structural[0]!.message).toContain('stub')
  })

  it('empty geofence is fine without drone cues but an error with them', () => {
    const site = makeSite({ geofence: [] })
    expect(validateSite(site, null, getEffect)).toHaveLength(0)
    const compiled = makeCompiled(site, [cue('drone', 'ring-40')])
    const structural = byCode(validateSite(site, compiled, getEffect), 'site-structure')
    expect(structural).toHaveLength(1)
    expect(structural[0]!.message).toContain('geofence')
  })

  it('non-empty degenerate geofence is a structural error even without drones', () => {
    const site = makeSite({ geofence: [v2(0, 0), v2(1, 0)] })
    expect(byCode(validateSite(site, null, getEffect), 'site-structure')).toHaveLength(1)
  })

  it('empty refListenerPos is a listener error', () => {
    const listeners = byCode(validateSite(makeSite({ refListenerPos: [] }), null, getEffect), 'listener')
    expect(listeners).toHaveLength(1)
    expect(listeners[0]!.severity).toBe('error')
  })

  it('never throws on thoroughly degenerate input', () => {
    const site = makeSite({
      audience: [],
      audienceZone: [],
      geofence: [],
      refListenerPos: [],
      assets: [rack('r1', v2(0, 0)), pad('p1', v2(0, 0)), laser('l1', v2(0, 0), 180, 1)],
    })
    const compiled = makeCompiled(site, [
      cue('pyro', 'shell-75', 'r1'),
      cue('drone', 'ring-40', 'p1'),
    ])
    expect(() => validateSite(site, compiled, getEffect)).not.toThrow()
    const diags = validateSite(site, compiled, getEffect)
    expect(diags.length).toBeGreaterThan(0)
    expect(diags.every((d) => d.severity === 'error' || d.severity === 'warning')).toBe(true)
  })
})
