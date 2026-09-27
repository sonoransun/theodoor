import { describe, expect, it } from 'vitest'
import type {
  CompiledCue,
  CompiledShow,
  CueParams,
  DronePrimitive,
  EffectDef,
  Medium,
  MusicalTimeline,
  PyroEffect,
  Show,
  SitePlan,
} from '../src/contracts.js'
import { lakesidePark, validateSite } from '../src/site/index.js'

const shell200: PyroEffect = {
  id: 'shell-200',
  name: 'Test Chrysanthemum 200',
  medium: 'pyro',
  tags: ['test', 'finale'],
  noiseDbAt15m: 118,
  durationSec: 2.5,
  category: 'chrysanthemum',
  caliberMm: 200,
  riseTimeSec: 4.5,
  burstHeightM: 200,
  burstRadiusM: 60,
  starCount: 400,
  colors: ['#ffd27f', '#ff5533'],
  dragK: 0.35,
  gravityBias: 0.3,
  minAudienceDistanceM: 168,
}

const ring: DronePrimitive = {
  id: 'ring-25',
  name: 'Test Ring',
  medium: 'drone',
  tags: ['test'],
  noiseDbAt15m: 40,
  durationSec: 15,
  formation: 'ring',
  minDrones: 60,
  maxDrones: 200,
  scaleM: 25,
}

const EFFECTS: readonly EffectDef[] = [shell200, ring]
const getEffect = (id: string): EffectDef | undefined => EFFECTS.find((e) => e.id === id)

let cueCounter = 0
function cue(medium: Medium, effectId: string, positionId: string, params?: CueParams): CompiledCue {
  return {
    id: `cue-${++cueCounter}`,
    trackId: 'trk-1',
    medium,
    effectId,
    positionId,
    targetSec: 30,
    fireSec: 25,
    anticipationSec: 5,
    durationSec: 3,
    seed: 99,
    params,
  }
}

function makeCompiled(site: SitePlan, cues: readonly CompiledCue[]): CompiledShow {
  const music: MusicalTimeline = {
    source: 'score',
    id: 'music-1',
    title: 'Test Music',
    duration: 120,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats: [],
    downbeats: [],
    annotations: [],
    energy: [],
    tempoConfidence: 1,
  }
  const show: Show = {
    meta: { id: 'show-1', title: 'Preset Test Show', variant: 'standard', seed: 7 },
    music,
    site,
    catalogId: 'catalog-1',
    tracks: [],
  }
  return { show, cues, diagnostics: [] }
}

describe('lakesidePark preset', () => {
  const site = lakesidePark()

  it('has the specified asset roster', () => {
    const racks = site.assets.filter((a) => a.kind === 'mortarRack')
    const pads = site.assets.filter((a) => a.kind === 'dronePad')
    const lasers = site.assets.filter((a) => a.kind === 'laserTower')
    const panels = site.assets.filter((a) => a.kind === 'panel')
    const masts = site.assets.filter((a) => a.kind === 'crowdMast')
    const beams = site.assets.filter((a) => a.kind === 'beamArray')
    const fountains = site.assets.filter((a) => a.kind === 'fountainBank')
    const lights = site.assets.filter((a) => a.kind === 'searchlightBank')
    expect(racks).toHaveLength(8)
    expect(pads).toHaveLength(2)
    expect(lasers).toHaveLength(2)
    expect(panels).toHaveLength(2)
    expect(masts).toHaveLength(2)
    expect(beams).toHaveLength(6)
    expect(fountains).toHaveLength(2)
    expect(lights).toHaveLength(2)
    expect(site.assets).toHaveLength(26)

    // Fountain banks sit on the water just behind the firing line, flanking
    // center; searchlight banks anchor the far ends of the line.
    for (const f of fountains) {
      expect(Math.abs(f.pos.x)).toBe(48)
      expect(f.pos.y).toBe(14)
      expect(f.fountainBank).toEqual({ nozzles: 9, spanM: 32, maxHeightM: 45, valveLatencySec: 0.15 })
    }
    for (const l of lights) {
      expect(Math.abs(l.pos.x)).toBe(130)
      expect(l.elevationM).toBe(1.5)
      expect(l.searchlightBank).toEqual({
        heads: 4,
        spanM: 18,
        slewRateDegPerSec: 60,
        maxTiltDeg: 75,
        minElevationDeg: 20,
      })
    }

    for (const r of racks) {
      expect(r.rack).toBeDefined()
      expect(r.rack!.pinsPerModule).toBe(32)
      expect(r.rack!.maxSimultaneousPins).toBe(8)
      expect(r.rack!.tiltDeg).toBe(0)
      expect(Math.max(...r.rack!.calibersMm)).toBe(200)
      expect(Math.abs(r.pos.x)).toBeLessThanOrEqual(120)
      expect(r.pos.y).toBeGreaterThanOrEqual(0)
      expect(r.pos.y).toBeLessThanOrEqual(10) // y ≈ 0 arc
    }
    const xs = racks.map((r) => r.pos.x)
    expect(Math.min(...xs)).toBe(-120)
    expect(Math.max(...xs)).toBe(120)

    expect(pads[0]!.pos.y).toBe(40)
    expect(pads[0]!.fleet).toEqual({ count: 200, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 })
    expect(pads[1]!.id).toBe('pad-2')
    expect(pads[1]!.fleet).toEqual({ count: 60, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 })

    for (const l of lasers) {
      expect(Math.abs(l.pos.x)).toBe(60)
      expect(l.laser).toEqual({ minElevationDeg: 12, scanFovDeg: 90, terminationM: 800 })
    }
    for (const p of panels) {
      expect(Math.abs(p.pos.x)).toBe(30)
      expect(p.panel).toEqual({ wPx: 64, hPx: 32, pitchMm: 40 })
    }

    for (const m of masts) {
      expect(m.crowdMast).toBeDefined()
      expect(m.crowdMast!.coverageRadiusM).toBe(170)
      expect(m.crowdMast!.framesPerSec).toBe(1500)
      expect(m.crowdMast!.wristband.p95Ms).toBe(80)
      expect(m.crowdMast!.phone.p95Ms).toBe(1200)
    }
    // North pair rides tall masts at the laser towers (long throw); the delay
    // pair sits inside the lawn flanks (whole-zone coverage, stereo pairs);
    // the south pair sits at the audience front corners (near-field whispers).
    const north = beams.filter((b) => b.pos.y === 0)
    const delay = beams.filter((b) => b.pos.y === -225)
    const south = beams.filter((b) => b.pos.y === -182)
    expect(north).toHaveLength(2)
    expect(delay).toHaveLength(2)
    expect(south).toHaveLength(2)
    expect(north[0]!.elevationM).toBe(25)
    expect(delay[0]!.elevationM).toBe(16)
    expect(south[0]!.elevationM).toBe(8)
    for (const b of beams) {
      expect(b.beamArray).toBeDefined()
      expect(b.beamArray!.steerRateDegPerSec).toBe(45)
      expect(b.beamArray!.minFocusDistanceM).toBe(5)
    }
  })

  it('has the specified venue geometry', () => {
    expect(site.audience).toHaveLength(2)
    for (const p of site.audience) expect(p.y).toBe(-190)
    expect(Math.min(...site.audience.map((p) => p.x))).toBe(-150)
    expect(Math.max(...site.audience.map((p) => p.x))).toBe(150)

    const zoneYs = site.audienceZone.map((p) => p.y)
    expect(Math.min(...zoneYs)).toBe(-260)
    expect(Math.max(...zoneYs)).toBe(-190)

    const gx = site.geofence.map((p) => p.x)
    const gy = site.geofence.map((p) => p.y)
    expect(Math.min(...gx)).toBe(-170)
    expect(Math.max(...gx)).toBe(170)
    expect(Math.min(...gy)).toBe(10)
    expect(Math.max(...gy)).toBe(220)

    expect(site.maxAltitudeM).toBe(150)
    expect(site.wind).toEqual({ dirDegFrom: 270, speedMps: 3, limitMps: 9 })
    expect(site.refListenerPos).toHaveLength(3)
    for (const p of site.refListenerPos) expect(p.y).toBe(-190)

    expect(site.crowdGrid).toEqual({ cellSizeM: 8, densityPPM2: 1.0, seed: 0xc404d5ee })
  })

  it('validates clean with no show (zero diagnostics)', () => {
    expect(validateSite(site, null, getEffect)).toEqual([])
  })

  it('clears its own separation and fallout rules for 200 mm shells from every rack', () => {
    // 0.84 × 200 = 168 m required; the audience line is 190 m downrange.
    const racks = site.assets.filter((a) => a.kind === 'mortarRack')
    const cues = racks.map((r) => cue('pyro', 'shell-200', r.id))
    cues.push(cue('drone', 'ring-25', 'pad-1'))
    const compiled = makeCompiled(site, cues)
    expect(validateSite(site, compiled, getEffect)).toEqual([])
  })

  it('returns a fresh, independent plan on each call', () => {
    const a = lakesidePark()
    const b = lakesidePark()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})
