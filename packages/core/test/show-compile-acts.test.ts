/**
 * show-compile-acts.test.ts — program-note acts through compile():
 * resolution to seconds, chronological ordering regardless of authoring
 * order, toSec chaining to the next act / the show's end, ACT_UNRESOLVED as a
 * warning (never an error), absence without notes, and byte-identical JSON
 * across compiles.
 */
import { describe, expect, it } from 'vitest'
import type { Show } from '../src/contracts.js'
import { starterCatalog } from '../src/catalog/index.js'
import { lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { compile, musicRefs, resolveActs, showBuilder } from '../src/show/index.js'
import { showDurationSec } from '../src/transport/index.js'

const catalog = starterCatalog()
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)

function builder(id = 'acts') {
  const b = showBuilder({ id, title: 'Acts', seed: 5, site: lakesidePark(), catalog })
    .music(tl)
    .preRoll(4)
  b.pyro.fire({ effect: 'peony-75-red', position: 'rack-1', land: m.barBeat(3, 1) })
  b.pyro.fire({ effect: 'willow-150-gold', position: 'rack-4', land: m.barBeat(25, 1) })
  return b
}

describe('compile() acts', () => {
  it('omits acts entirely when the show carries no notes', () => {
    const { show, compiled } = builder().build()
    expect(show.notes).toBeUndefined()
    expect(compiled.acts).toBeUndefined()
    expect('acts' in compiled).toBe(false)
    expect(resolveActs(show, compiled)).toEqual({ acts: [], diagnostics: [] })
  })

  it('resolves acts to seconds, sorted ascending, each ending where the next begins', () => {
    const b = builder()
      .notes({ tagline: 'tag', music: ['Beethoven — Ode to Joy (1824)'] })
      // Authored out of order on purpose.
      .act('III', m.barBeat(25, 1), 'late')
      .act('I', m.time(0), 'early')
      .act('II', m.annotation('accent', 0, 'forte'), 'middle')
    const { show, compiled } = b.build()
    expect(show.notes?.acts.map((a) => a.title)).toEqual(['III', 'I', 'II'])
    const acts = compiled.acts!
    expect(acts.map((a) => a.title)).toEqual(['I', 'II', 'III'])
    expect(acts[0]!.fromSec).toBe(0)
    expect(acts[1]!.fromSec).toBe(tl.annotations.find((a) => a.label === 'forte')!.time)
    expect(acts[2]!.fromSec).toBe(tl.downbeats[24])
    for (let i = 0; i + 1 < acts.length; i++) {
      expect(acts[i]!.toSec).toBe(acts[i + 1]!.fromSec)
      expect(acts[i]!.fromSec).toBeLessThan(acts[i + 1]!.fromSec)
    }
    // The last act runs to the show's end (music duration or the last cue tail).
    expect(acts[2]!.toSec).toBe(showDurationSec(compiled))
    expect(acts[2]!.toSec).toBeGreaterThan(acts[2]!.fromSec)
    expect(acts.map((a) => a.note)).toEqual(['early', 'middle', 'late'])
  })

  it('drops an unresolvable act with a warning-severity ACT_UNRESOLVED, never an error', () => {
    const b = builder()
      .notes({ tagline: 't', music: ['x'] })
      .act('Good', m.time(1), 'ok')
      .act('Ghost', m.hit('no-such-label', 0), 'nowhere')
    const { compiled } = b.build() // build() throws on errors — a warning must not
    expect(compiled.acts!.map((a) => a.title)).toEqual(['Good'])
    const diag = compiled.diagnostics.find((d) => d.code === 'ACT_UNRESOLVED')
    expect(diag?.severity).toBe('warning')
    expect(diag?.message).toContain("'Ghost'")
  })

  it('a lone act spans from its anchor to the show end, even past the last cue', () => {
    const { compiled } = builder().notes({ tagline: '', music: [] }).act('Only', m.time(10), 'n').build()
    expect(compiled.acts).toHaveLength(1)
    expect(compiled.acts![0]!.fromSec).toBe(10)
    expect(compiled.acts![0]!.toSec).toBe(showDurationSec(compiled))
  })

  it('an act anchored after the show end still gets a non-negative span', () => {
    const far = showDurationSec(builder().build().compiled) + 100
    const { compiled } = builder().notes({ tagline: '', music: [] }).act('Late', m.time(far), 'n').build()
    expect(compiled.acts![0]!.fromSec).toBe(far)
    expect(compiled.acts![0]!.toSec).toBe(far)
  })

  it('notes() replaces tagline/music but keeps previously appended acts', () => {
    const b = builder().act('A', m.time(0), 'a').notes({ tagline: 'new', music: ['m'] })
    const { show } = b.build()
    expect(show.notes?.tagline).toBe('new')
    expect(show.notes?.acts.map((a) => a.title)).toEqual(['A'])
  })

  it('compile is deterministic: two compiles of one show are JSON-identical', () => {
    const { show } = builder().notes({ tagline: 't', music: ['m'] }).act('I', m.time(0), 'n').build()
    const a = compile(show, catalog)
    const b = compile(show, catalog)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.acts).toEqual(b.acts)
  })

  it('resolveActs tolerates a plain Show without notes', () => {
    const { show, compiled } = builder().build()
    const bare: Show = { ...show }
    delete bare.notes
    expect(resolveActs(bare, compiled).acts).toEqual([])
  })
})
