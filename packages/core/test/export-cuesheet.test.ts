import { describe, expect, it } from 'vitest'
import { cueSheetMarkdown, formatMmSsD } from '../src/export/index.js'
import { getEffect, laserCue, makeCompiled, pyroCue } from './export-fixtures.js'
import type { Track } from '../src/contracts.js'

describe('formatMmSsD', () => {
  it('formats mm:ss.d with zero padding', () => {
    expect(formatMmSsD(0)).toBe('00:00.0')
    expect(formatMmSsD(75)).toBe('01:15.0')
    expect(formatMmSsD(83.44)).toBe('01:23.4')
    expect(formatMmSsD(600)).toBe('10:00.0')
  })

  it('sign-prefixes negative (pre-roll) times', () => {
    expect(formatMmSsD(-2.5)).toBe('-00:02.5')
  })

  it('carries tenths overflow into the minute', () => {
    expect(formatMmSsD(59.96)).toBe('01:00.0')
  })
})

describe('cueSheetMarkdown', () => {
  const compiled = makeCompiled([
    pyroCue('p1', 10, 'rackA'),
    pyroCue('p2', 30.25, 'rackB'),
    laserCue('l1', 12),
  ])

  it('includes title, variant, seed, and a SIMULATION-ONLY banner in the header', () => {
    const md = cueSheetMarkdown(compiled, getEffect)
    expect(md).toContain('# Cue Sheet — Golden Fixture Show')
    expect(md).toContain('**Variant:** standard')
    expect(md).toContain('**Seed:** 42')
    expect(md).toContain('**SIMULATION ONLY.**')
    expect(md).toContain('not a firing authorization')
  })

  it('renders one table per track with land/fire/effect/position/anticipation', () => {
    const md = cueSheetMarkdown(compiled, getEffect)
    expect(md).toContain('## trk-pyro (pyro) — 2 cues')
    expect(md).toContain('## trk-laser (laser) — 1 cue')
    expect(md).toContain('| Cue | Land | Fire | Effect | Position | Anticipation |')
    // p1: fireSec 10, riseTime 2.2 -> land 12.2.
    expect(md).toContain('| p1 | 00:12.2 | 00:10.0 | Red Peony 75 | rackA | 2.20 s |')
    // p2: fireSec 30.25 -> land 32.45 (32.4 or 32.5 by rounding — assert row prefix).
    expect(md).toMatch(/\| p2 \| 00:32\.[45] \| 00:30\.3 \| Red Peony 75 \| rackB \| 2\.20 s \|/)
  })

  it('marks unknown effects and missing positions', () => {
    const orphan = makeCompiled([
      { ...pyroCue('x1', 5, undefined), effectId: 'no-such' },
    ])
    const md = cueSheetMarkdown(orphan, getEffect)
    expect(md).toContain('no-such (unknown)')
    expect(md).toContain('| — |')
  })

  it('renders empty tracks as "No cues"', () => {
    const tracks: Track[] = [{ id: 't-empty', medium: 'panel', name: 'Panel Wall', cues: [] }]
    const md = cueSheetMarkdown(makeCompiled([], tracks), getEffect)
    expect(md).toContain('## Panel Wall (panel) — 0 cues')
    expect(md).toContain('_No cues._')
  })

  it('escapes markdown pipes in names', () => {
    const tracks: Track[] = [{ id: 'trk-pyro', medium: 'pyro', name: 'A|B', cues: [] }]
    const md = cueSheetMarkdown(makeCompiled([pyroCue('p1', 10, 'rackA')], tracks), getEffect)
    expect(md).toContain('## A\\|B (pyro) — 1 cue')
  })

  it('is deterministic across runs', () => {
    expect(cueSheetMarkdown(compiled, getEffect)).toBe(cueSheetMarkdown(compiled, getEffect))
  })
})
