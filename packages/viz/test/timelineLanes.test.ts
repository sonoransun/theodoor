import { describe, expect, it } from 'vitest'
import type { Medium } from '@theodoor/core'
import { GALLERY_THEME } from '@theodoor/core'
import { LANES, MUSIC_COLOR } from '../src/ui/timeline.js'

const ALL_MEDIA: Medium[] = [
  'pyro', 'drone', 'laser', 'panel', 'fabrication', 'crowd', 'beam', 'fountain', 'searchlight',
]

describe('timeline lanes', () => {
  it('cover every medium exactly once', () => {
    const seen = new Map<Medium, number>()
    for (const lane of LANES) for (const m of lane.media) seen.set(m, (seen.get(m) ?? 0) + 1)
    for (const m of ALL_MEDIA) expect(seen.get(m), `medium ${m}`).toBe(1)
    expect([...seen.keys()].sort()).toEqual([...ALL_MEDIA].sort())
  })

  it('use the gallery theme colors so the docs and the live strip agree', () => {
    const byMedium = new Map<Medium, string>()
    for (const lane of LANES) for (const m of lane.media) byMedium.set(m, lane.color)
    expect(byMedium.get('pyro')).toBe(GALLERY_THEME.lanes.pyro)
    expect(byMedium.get('drone')).toBe(GALLERY_THEME.lanes.drones)
    expect(byMedium.get('laser')).toBe(GALLERY_THEME.lanes.lasers)
    expect(byMedium.get('panel')).toBe(GALLERY_THEME.lanes.panels)
    expect(byMedium.get('crowd')).toBe(GALLERY_THEME.lanes.crowd)
    expect(byMedium.get('beam')).toBe(GALLERY_THEME.lanes.beams)
    expect(byMedium.get('fountain')).toBe(GALLERY_THEME.lanes.fountains)
    expect(byMedium.get('searchlight')).toBe(GALLERY_THEME.lanes.lights)
    expect(MUSIC_COLOR).toBe(GALLERY_THEME.lanes.music)
  })
})
