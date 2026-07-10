import { describe, expect, it } from 'vitest'
import type {
  BeamArraySpec,
  BeamEffect,
  CompiledCue,
  CompiledShow,
  CrowdEffect,
  CueParams,
  Diagnostic,
  EffectDef,
  Medium,
  MusicalTimeline,
  Seconds,
  Show,
  SitePlan,
  Vec2,
} from '../src/contracts.js'
import { dist2, v2 } from '../src/math/index.js'
import { crowdGridFor } from '../src/site/crowdGrid.js'
import { lakesidePark } from '../src/site/presets.js'
import { validateSite } from '../src/site/validate.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const whisper: BeamEffect = {
  id: 'beam-whisper',
  name: 'Test Whisper Zone',
  medium: 'beam',
  tags: ['test'],
  noiseDbAt15m: 58,
  durationSec: 8,
  program: 'whisperZone',
  beamWidthDeg: 8,
  carrierBandLabel: 'u-band-40',
  maxCarrierDbAtFocus: 110,
  contentTag: 'narration',
}

const flyoverWide: BeamEffect = {
  ...whisper,
  id: 'beam-wide',
  name: 'Test Wide Flyover',
  program: 'flyover',
  beamWidthDeg: 18,
}

const pingPong: BeamEffect = {
  ...whisper,
  id: 'beam-pingpong',
  name: 'Test Ping Pong',
  program: 'pingPong',
}

const flood: CrowdEffect = {
  id: 'crowd-flood',
  name: 'Test Flood',
  medium: 'crowd',
  tags: ['test'],
  noiseDbAt15m: 0,
  durationSec: 4,
  pattern: 'flood',
  channel: 'wristband',
  maskUpdateHz: 10,
  colors: ['#ff2200'],
}

const EFFECTS: readonly EffectDef[] = [whisper, flyoverWide, pingPong, flood]
const getEffect = (id: string): EffectDef | undefined => EFFECTS.find((e) => e.id === id)

let cueCounter = 0
function cue(medium: Medium, effectId: string, positionId?: string, params?: CueParams): CompiledCue {
  return {
    id: `cue-${++cueCounter}`,
    trackId: 'trk-1',
    medium,
    effectId,
    positionId,
    targetSec: 10,
    fireSec: 9.8,
    anticipationSec: 0.2,
    durationSec: 2,
    seed: 42,
    params,
  }
}

function makeCompiled(
  site: SitePlan,
  cues: readonly CompiledCue[],
  beats: readonly Seconds[] = [],
): CompiledShow {
  const music: MusicalTimeline = {
    source: 'score',
    id: 'music-1',
    title: 'Test Music',
    duration: 60,
    tempo: { segments: [{ beat: 0, bpm: 120 }], meters: [{ bar: 1, beatsPerBar: 4 }] },
    beats,
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

/** Compact index of the derived cell whose centroid is nearest to `p`. */
function cellIdNear(site: SitePlan, p: Vec2): number {
  const grid = crowdGridFor(site)!
  let best = grid.cells[0]!
  for (const c of grid.cells) {
    if (dist2(c.centroid, p) < dist2(best.centroid, p)) best = c
  }
  return best.index
}

function withBeamSpec(site: SitePlan, assetId: string, patch: Partial<BeamArraySpec>): SitePlan {
  return {
    ...site,
    assets: site.assets.map((a) =>
      a.id === assetId && a.beamArray ? { ...a, beamArray: { ...a.beamArray, ...patch } } : a,
    ),
  }
}

// Nearest cell to the beam-south-west head (-140,-182): centroid (-146,-192),
// ~11.7 m ground / ~11.9 m slant, depression ~11.6° — clean on every rule.
const NEAR_SW = v2(-146, -192)

// ---------------------------------------------------------------------------
// beam rules
// ---------------------------------------------------------------------------

describe('beam rules', () => {
  it('clean whisper cue on beam-south-west targeting a near cell yields no diagnostics', () => {
    const site = lakesidePark()
    const near = cellIdNear(site, NEAR_SW)
    const compiled = makeCompiled(site, [
      cue('beam', 'beam-whisper', 'beam-south-west', { targetCellId: near }),
    ])
    expect(validateSite(site, compiled, getEffect)).toEqual([])
  })

  it('pan beyond ±60° triggers beam-steer-range', () => {
    const site = lakesidePark()
    // Far-east cell from the south-WEST array: pan ≈ −88° vs the ±60° range.
    const east = cellIdNear(site, v2(150, -192))
    const compiled = makeCompiled(site, [
      cue('beam', 'beam-whisper', 'beam-south-west', { targetCellId: east }),
    ])
    const hits = byCode(validateSite(site, compiled, getEffect), 'beam-steer-range')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.assetId).toBe('beam-south-west')
    expect(hits[0]!.cueIds).toHaveLength(1)
  })

  it('a shallow far-edge aim on a 4 m array triggers beam-horizon', () => {
    const site = lakesidePark()
    // Far zone edge ~74 m due south: depression ≈ 1.9° < 9° half-angle + 2° margin.
    const far = cellIdNear(site, v2(-138, -256))
    const compiled = makeCompiled(site, [
      cue('beam', 'beam-wide', 'beam-south-west', { targetCellId: far }),
    ])
    const diags = validateSite(site, compiled, getEffect)
    const hits = byCode(diags, 'beam-horizon')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.assetId).toBe('beam-south-west')
    // Pan ≈ −1.6° and tilt ≈ −1.9° stay legal — only the horizon rule fires.
    expect(byCode(diags, 'beam-steer-range')).toHaveLength(0)
  })

  it('a cell directly under a south array trips beam-focus when minFocusDistanceM is raised', () => {
    const site = withBeamSpec(lakesidePark(), 'beam-south-west', { minFocusDistanceM: 20 })
    const near = cellIdNear(site, NEAR_SW) // aim slant ≈ 11.9 m < 20 m
    const compiled = makeCompiled(site, [
      cue('beam', 'beam-whisper', 'beam-south-west', { targetCellId: near }),
    ])
    const hits = byCode(validateSite(site, compiled, getEffect), 'beam-focus')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.message).toContain('minimum focus')
  })

  it('a lone pairId cue is a beam-pair warning', () => {
    const site = lakesidePark()
    const near = cellIdNear(site, NEAR_SW)
    const compiled = makeCompiled(site, [
      cue('beam', 'beam-whisper', 'beam-south-west', {
        targetCellId: near,
        pairId: 'pair-1',
        role: 'L',
      }),
    ])
    const diags = validateSite(site, compiled, getEffect)
    const hits = byCode(diags, 'beam-pair')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('warning')
    expect(hits[0]!.message).toContain('pair-1')
    expect(hits[0]!.cueIds).toHaveLength(1)
    expect(diags).toEqual(hits) // geometry itself is clean
  })

  it('a pair with far-apart targets warns; a coincident pair does not', () => {
    const site = lakesidePark()
    const west = cellIdNear(site, NEAR_SW)
    const east = cellIdNear(site, v2(146, -192))
    const wide = makeCompiled(site, [
      cue('beam', 'beam-whisper', 'beam-south-west', { targetCellId: west, pairId: 'p', role: 'L' }),
      cue('beam', 'beam-whisper', 'beam-south-east', { targetCellId: east, pairId: 'p', role: 'R' }),
    ])
    const wideHits = byCode(validateSite(site, wide, getEffect), 'beam-pair')
    expect(wideHits).toHaveLength(1)
    expect(wideHits[0]!.severity).toBe('warning')
    expect(wideHits[0]!.cueIds).toHaveLength(2)

    const tight = makeCompiled(site, [
      cue('beam', 'beam-whisper', 'beam-south-west', { targetCellId: west, pairId: 'q', role: 'L' }),
      cue('beam', 'beam-whisper', 'beam-south-west', { targetCellId: west, pairId: 'q', role: 'R' }),
    ])
    expect(byCode(validateSite(site, tight, getEffect), 'beam-pair')).toHaveLength(0)
  })

  it('a sweep ending over the horizon triggers beam-horizon at the window end', () => {
    const site = lakesidePark()
    const near = cellIdNear(site, NEAR_SW)
    // Far zone edge ~74 m due south: depression ≈ 4.9° < 9° half-angle + 2° margin.
    const far = cellIdNear(site, v2(-138, -256))
    const compiled = makeCompiled(site, [
      cue('beam', 'beam-wide', 'beam-south-west', { pathCellIds: [near, far] }),
    ])
    const diags = validateSite(site, compiled, getEffect)
    const hits = byCode(diags, 'beam-horizon')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.assetId).toBe('beam-south-west')
    expect(hits[0]!.message).toContain('window end')
    // Both endpoint aims stay inside pan/tilt limits — only the horizon fires.
    expect(byCode(diags, 'beam-steer-range')).toHaveLength(0)
  })

  it('a sweep ending inside the minimum focus slant triggers beam-focus at the window end', () => {
    const site = withBeamSpec(lakesidePark(), 'beam-south-west', { minFocusDistanceM: 20 })
    // Start ~39 m slant away (clean, and its footprint covers no cell nearer
    // than 20 m), sweeping back to the near cell at ~13 m slant.
    const mid = cellIdNear(site, v2(-146, -220))
    const near = cellIdNear(site, NEAR_SW)
    const compiled = makeCompiled(site, [
      cue('beam', 'beam-whisper', 'beam-south-west', { pathCellIds: [mid, near] }),
    ])
    const diags = validateSite(site, compiled, getEffect)
    const hits = byCode(diags, 'beam-focus')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.message).toContain('window end')
    expect(hits[0]!.message).toContain('minimum focus')
    expect(byCode(diags, 'beam-horizon')).toHaveLength(0)
  })

  it('pingPong endpoint aims resolve on the show beat grid, not the 1 s/beat fallback', () => {
    const site = lakesidePark()
    const west = cellIdNear(site, NEAR_SW)
    // Far-east cell: pan ≈ −88° from beam-south-west, outside the ±60° range.
    const east = cellIdNear(site, v2(150, -192))
    const params: CueParams = { pathCellIds: [west, east], periodBeats: 8 }
    // 240 bpm grid: 8 beats elapse over the 2 s window, so the window-end aim
    // flips to the far-east cell. The 1 s/beat fallback sees only 2 beats and
    // leaves the aim parked on the (legal) west cell.
    const beats = Array.from({ length: 241 }, (_, i) => i * 0.25)
    const withGrid = makeCompiled(
      site,
      [cue('beam', 'beam-pingpong', 'beam-south-west', params)],
      beats,
    )
    const hits = byCode(validateSite(site, withGrid, getEffect), 'beam-steer-range')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.message).toContain('window end')

    // Without a beat grid the fallback clock keeps the end aim on the west
    // cell and the steering rule stays quiet.
    const noGrid = makeCompiled(site, [cue('beam', 'beam-pingpong', 'beam-south-west', params)])
    expect(byCode(validateSite(site, noGrid, getEffect), 'beam-steer-range')).toHaveLength(0)
  })

  it('a beam cue on an asset without a beamArray spec is beam-structure; unknown assets/effects are skipped', () => {
    const site = lakesidePark()
    const near = cellIdNear(site, NEAR_SW)
    const compiled = makeCompiled(site, [
      cue('beam', 'beam-whisper', 'mast-west', { targetCellId: near }),
      cue('beam', 'beam-whisper', 'ghost-array', { targetCellId: near }),
      cue('beam', 'no-such-effect', 'beam-south-west', { targetCellId: near }),
    ])
    const diags = validateSite(site, compiled, getEffect)
    const hits = byCode(diags, 'beam-structure')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.assetId).toBe('mast-west')
    expect(diags).toEqual(hits)
  })
})

// ---------------------------------------------------------------------------
// crowd rules
// ---------------------------------------------------------------------------

describe('crowd rules', () => {
  it('crowd cues without a site crowdGrid are a crowd-structure error', () => {
    const site: SitePlan = { ...lakesidePark(), crowdGrid: undefined }
    const compiled = makeCompiled(site, [cue('crowd', 'crowd-flood', 'mast-west')])
    const hits = byCode(validateSite(site, compiled, getEffect), 'crowd-structure')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.cueIds).toHaveLength(1)
  })

  it('a declared crowdGrid deriving zero cells is a site-only crowd-structure error', () => {
    const base = lakesidePark()
    const site: SitePlan = {
      ...base,
      exclusionZones: [{ id: 'closed-lawn', poly: base.audienceZone }],
    }
    const hits = byCode(validateSite(site, null, getEffect), 'crowd-structure')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
  })

  it('a non-positive cellSizeM is a crowd-structure error naming the size', () => {
    const base = lakesidePark()
    const site: SitePlan = { ...base, crowdGrid: { ...base.crowdGrid!, cellSizeM: 0 } }
    const hits = byCode(validateSite(site, null, getEffect), 'crowd-structure')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.message).toContain('cellSizeM')
  })

  it('a crowdGrid with the masts stripped warns crowd-coverage (site-only)', () => {
    const base = lakesidePark()
    const site: SitePlan = { ...base, assets: base.assets.filter((a) => a.kind !== 'crowdMast') }
    const hits = byCode(validateSite(site, null, getEffect), 'crowd-coverage')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('warning')
    expect(hits[0]!.message).toMatch(/\d+ cells/)
  })

  it('reports the count of cells outside every mast coverage radius', () => {
    const base = lakesidePark()
    const site: SitePlan = {
      ...base,
      assets: base.assets.map((a) =>
        a.kind === 'crowdMast' && a.crowdMast
          ? { ...a, crowdMast: { ...a.crowdMast, coverageRadiusM: 60 } }
          : a,
      ),
    }
    const hits = byCode(validateSite(site, null, getEffect), 'crowd-coverage')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('warning')
    expect(hits[0]!.message).toMatch(/^\d+ of \d+ crowd cells/)
  })

  it('a crowd cue on a crowdMast asset without a crowdMast spec is a crowd-structure error', () => {
    const base = lakesidePark()
    const site: SitePlan = {
      ...base,
      assets: base.assets.map((a) => (a.id === 'mast-west' ? { ...a, crowdMast: undefined } : a)),
    }
    const compiled = makeCompiled(site, [cue('crowd', 'crowd-flood', 'mast-west')])
    const hits = byCode(validateSite(site, compiled, getEffect), 'crowd-structure')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.severity).toBe('error')
    expect(hits[0]!.assetId).toBe('mast-west')
    expect(hits[0]!.message).toContain('mast-west')
    expect(hits[0]!.cueIds).toHaveLength(1)

    // Control: the same cue on the intact site is structurally clean.
    const intact = lakesidePark()
    const clean = makeCompiled(intact, [cue('crowd', 'crowd-flood', 'mast-west')])
    expect(byCode(validateSite(intact, clean, getEffect), 'crowd-structure')).toHaveLength(0)
  })

  it('the intact lakeside site raises neither crowd rule', () => {
    const site = lakesidePark()
    const diags = validateSite(site, null, getEffect)
    expect(byCode(diags, 'crowd-structure')).toHaveLength(0)
    expect(byCode(diags, 'crowd-coverage')).toHaveLength(0)
  })
})
