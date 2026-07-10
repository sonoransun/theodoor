/**
 * gallery-charts.test.ts — site map, timeline poster, keystone chart.
 *
 * Fixture: a lakesidePark show with at least one cue of every medium (pyro
 * volley, drone formation, laser, panel, fabrication, crowd flood, beam
 * whisper on a near front-corner cell — see show-builder-crowd-beam.test.ts
 * for the beam geometry constraints). House golden style: substring
 * assertions, balanced-tag check, two-run byte equality, size ceilings, and
 * never currentColor (GitHub <img> renders it black).
 */
import { describe, expect, it } from 'vitest'
import type { CompiledShow } from '../src/contracts.js'
import { starterCatalog } from '../src/catalog/index.js'
import { fmtMm } from '../src/fab/svg.js'
import { keystoneChartSvg } from '../src/gallery/keystone.js'
import { beamThrowRadiusM, sitePlanSvg } from '../src/gallery/sitePlan.js'
import { timelineScale, timelineSvg } from '../src/gallery/timeline.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { lakesidePark } from '../src/site/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { assertBalancedSvg } from './fab-fixture.js'

/** Build the whole fixture from scratch (fresh site/catalog/timeline). */
function buildFixture(): CompiledShow {
  const catalog = starterCatalog()
  const tl = buildTimelineFromScore(getScore('odeToJoy')!)
  const m = musicRefs(tl)
  const b = showBuilder({
    id: 'gallery-charts',
    title: 'Gallery Charts',
    seed: 21,
    site: lakesidePark(),
    catalog,
  })
    .music(tl)
    .preRoll(6)

  b.pyro.volley({
    effects: ['peony-75-red', 'peony-75-blue'],
    positions: ['rack-2', 'rack-3', 'rack-5', 'rack-6'],
    land: m.barBeat(9, 1),
    staggerBeats: 0.5,
  })
  b.drones.formation({
    effect: 'ring-formation-60',
    position: 'pad-1',
    by: m.barBeat(5, 1),
    holdSec: 4,
    params: { count: 40, scaleM: 24 },
  })
  b.lasers.pattern({ effect: 'laser-fan-rgb', position: 'laser-west', from: m.barBeat(11, 1), durBeats: 16 })
  b.panels.pattern({ effect: 'panel-aurora', position: 'panel-east', from: m.barBeat(3, 1) })
  b.fabrication.cue({ effectId: 'waterfall-30m', anchor: m.time(24), positionId: 'rack-6' })
  b.crowd.flood({ effect: 'crowd-flood-rgb', position: 'mast-west', from: m.barBeat(3, 1) })
  b.beams.whisper({
    effect: 'beam-whisper-narration',
    position: 'beam-south-west',
    target: 267,
    land: m.barBeat(3, 1),
  })
  return b.build().compiled
}

const compiled = buildFixture()

describe('gallery charts fixture', () => {
  it('carries every medium and compiles clean', () => {
    const media = new Set(compiled.cues.map((c) => c.medium))
    expect([...media].sort()).toEqual(['beam', 'crowd', 'drone', 'fabrication', 'laser', 'panel', 'pyro'])
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })
})

describe('sitePlanSvg', () => {
  const site = lakesidePark()
  const svg = sitePlanSvg(site)

  it('is structurally sound and never leans on currentColor', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
  })

  it('labels every asset id', () => {
    for (const a of site.assets) expect(svg).toContain(`>${a.id}</text>`)
    expect(site.assets).toHaveLength(22)
  })

  it('draws one throw arc per beam array (6 on lakesidePark)', () => {
    expect(svg.match(/class="throw-arc"/g)).toHaveLength(6)
    // The horizon-margin rule: north masts (25 m) reach ~267 m ground throw.
    expect(beamThrowRadiusM(25, 6)).toBeCloseTo(267.5, 0)
    expect(beamThrowRadiusM(8, 6)).toBeCloseTo(73.2, 0)
    expect(beamThrowRadiusM(1.6, 6)).toBe(0)
  })

  it('annotates the crowd grid front row, elevations, wind, and scale bar', () => {
    expect(svg).toContain('>front</text>')
    expect(svg).toContain('>25m</text>')
    expect(svg).toContain('>16m</text>')
    expect(svg).toContain('>8m</text>')
    expect(svg).toContain('>wind 3 m/s</text>')
    expect(svg).toContain('>50 m</text>')
    expect(svg).toContain(`${site.id} — site plan`)
  })

  it('is deterministic and within the size ceiling', () => {
    expect(sitePlanSvg(lakesidePark())).toBe(svg)
    expect(svg.length).toBeLessThanOrEqual(90 * 1024)
  })
})

describe('timelineSvg', () => {
  const svg = timelineSvg(compiled)

  it('is structurally sound and never leans on currentColor', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
  })

  it('labels all seven lanes', () => {
    for (const name of ['Music', 'Pyro', 'Drones', 'Lasers', 'Panels', 'Crowd', 'Beams']) {
      expect(svg).toContain(`>${name}</text>`)
    }
  })

  it('defines hatch patterns for the populated lanes', () => {
    expect(svg).toContain('<pattern id="hatch-pyro"')
    expect(svg).toContain('<pattern id="hatch-beams"')
    expect(svg).toContain('patternTransform="rotate(45)"')
  })

  it('places the pyro cue lead-in and body rects on the shared linear mapping', () => {
    const cue = compiled.cues.find((c) => c.medium === 'pyro')!
    const scale = timelineScale(compiled, 960)
    const xf = fmtMm(scale.x(cue.fireSec))
    const wLead = fmtMm(scale.x(cue.targetSec) - scale.x(cue.fireSec))
    const xt = fmtMm(scale.x(cue.targetSec))
    const wBody = fmtMm(Math.max(scale.x(cue.targetSec + cue.durationSec) - scale.x(cue.targetSec), 1))
    expect(svg).toMatch(
      new RegExp(
        `<rect x="${xf}" y="[0-9.]+" width="${wLead}" height="10" fill="url\\(#hatch-pyro\\)" fill-opacity="0.45"/>`,
      ),
    )
    expect(svg).toMatch(
      new RegExp(
        `<rect x="${xt}" y="[0-9.]+" width="${wBody}" height="10" fill="#ff9d4d" fill-opacity="0.85"/>`,
      ),
    )
  })

  it('renders act bands behind the lanes when asked', () => {
    const banded = timelineSvg(compiled, {
      bands: [
        { label: 'Act I', fromSec: 0, toSec: 20 },
        { label: 'Finale', fromSec: 20, toSec: 60 },
      ],
    })
    assertBalancedSvg(banded)
    expect(banded).toContain('>Act I</text>')
    expect(banded).toContain('>Finale</text>')
  })

  it('adds an indefinitely looping SMIL playhead when sweepDurSec is set', () => {
    const swept = timelineSvg(compiled, { sweepDurSec: 12 })
    assertBalancedSvg(swept)
    expect(swept).toContain('<animateTransform')
    expect(swept).toContain('repeatCount="indefinite"')
    expect(swept).toContain('dur="12s"')
    expect(svg).not.toContain('<animateTransform')
  })

  it('is deterministic and within the size ceiling', () => {
    expect(timelineSvg(buildFixture())).toBe(svg)
    expect(svg.length).toBeLessThanOrEqual(90 * 1024)
  })
})

describe('keystoneChartSvg', () => {
  const beamCue = compiled.cues.find((c) => c.medium === 'beam')!
  const droneCue = compiled.cues.find((c) => c.medium === 'drone')!
  const pyroCue = compiled.cues.find((c) => c.medium === 'pyro')!
  const opts = {
    rows: [
      { cueId: beamCue.id, note: 'front-corner whisper' },
      { cueId: droneCue.id },
      { cueId: pyroCue.id },
    ],
    fromSec: -8,
    toSec: 40,
    ruleAt: { tSec: 4, label: 'bar 3' },
    callout: { text: 'anticipation', atRowOfCueId: droneCue.id },
  } as const
  const svg = keystoneChartSvg(compiled, opts)

  it('is structurally sound and never leans on currentColor', () => {
    assertBalancedSvg(svg)
    expect(svg).not.toContain('currentColor')
  })

  it('prints each anticipationSec at fixed 2 dp', () => {
    for (const cue of [beamCue, droneCue, pyroCue]) {
      expect(svg).toContain(`>${cue.anticipationSec.toFixed(2)}s</text>`)
    }
  })

  it('orders rows exactly as given', () => {
    const at = (id: string): number => svg.indexOf(`>${id}</text>`)
    expect(at(beamCue.id)).toBeGreaterThan(-1)
    expect(at(beamCue.id)).toBeLessThan(at(droneCue.id))
    expect(at(droneCue.id)).toBeLessThan(at(pyroCue.id))
    expect(svg).toContain('>front-corner whisper</text>')
  })

  it('draws the beat grid, rule, and callout', () => {
    expect(svg).toContain('stroke-opacity="0.18"')
    expect(svg).toContain('>bar 3</text>')
    expect(svg).toContain('>anticipation</text>')
    const bare = keystoneChartSvg(compiled, { rows: opts.rows, fromSec: -8, toSec: 40, beatTicks: false })
    expect(bare).not.toContain('stroke-opacity="0.18"')
  })

  it('throws on an unknown cueId, naming it', () => {
    expect(() =>
      keystoneChartSvg(compiled, { rows: [{ cueId: 'no-such-cue' }], fromSec: 0, toSec: 10 }),
    ).toThrow(/no-such-cue/)
    expect(() =>
      keystoneChartSvg(compiled, {
        rows: [{ cueId: beamCue.id }],
        fromSec: 0,
        toSec: 10,
        callout: { text: 'x', atRowOfCueId: 'absent-row' },
      }),
    ).toThrow(/absent-row/)
  })

  it('is deterministic and within the size ceiling', () => {
    expect(keystoneChartSvg(buildFixture(), opts)).toBe(svg)
    expect(svg.length).toBeLessThanOrEqual(60 * 1024)
  })
})
