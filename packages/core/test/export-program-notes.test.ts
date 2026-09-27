/**
 * export-program-notes.test.ts — the guest program: structure, per-act
 * "Look for" lines derived from the cues, the keystone paragraph with the
 * show's own extremes, quiet-variant remark, escaping, and determinism.
 */
import { describe, expect, it } from 'vitest'
import type { CompiledCue, CompiledShow } from '../src/contracts.js'
import { getEffectFrom, starterCatalog } from '../src/catalog/index.js'
import {
  actHeading,
  formatClock,
  keystoneParagraph,
  lookForLine,
  programNotesMarkdown,
} from '../src/export/index.js'
import { lakesidePark } from '../src/site/index.js'
import { buildTimelineFromScore, getScore } from '../src/music/index.js'
import { musicRefs, showBuilder } from '../src/show/index.js'
import { showDurationSec } from '../src/transport/index.js'

const catalog = starterCatalog()
const getEffect = getEffectFrom(catalog)
const tl = buildTimelineFromScore(getScore('odeToJoy')!)
const m = musicRefs(tl)

/** A two-act show touching every medium, with a thunder-tagged shell. */
function build(variant: 'standard' | 'quiet' = 'standard', withNotes = true): CompiledShow {
  const b = showBuilder({
    id: 'notes-fixture',
    title: 'Notes | Fixture',
    seed: 9,
    site: lakesidePark(),
    catalog,
    variant,
  })
    .music(tl)
    .preRoll(6)
  if (variant === 'quiet') b.noiseBudget(85)
  if (withNotes) {
    b.notes({
      tagline: 'A test | with a pipe',
      music: ['Ludwig van Beethoven — Ode to Joy (1824)'],
      epilogue: 'Good night.',
    })
    b.act('I — Opening', m.time(0), 'First act note.\nSecond line.')
    b.act('II — Finale', m.barBeat(17, 1), 'Finale note.')
  }
  const shell = variant === 'quiet' ? 'comet-30-gold' : 'peony-100-white'
  b.pyro.fire({ id: 'shell-a', effect: shell, position: 'rack-4', land: m.barBeat(3, 1) })
  b.pyro.fire({ id: 'shell-b', effect: shell, position: 'rack-5', land: m.barBeat(19, 1) })
  b.beams.tag({
    effect: 'beam-tag-drone',
    position: 'beam-north-west',
    source: 'shell-b',
    fallbackTarget: 170,
    land: m.barBeat(19, 1),
    idPrefix: 'thunder',
  })
  b.beams.toll({ effect: 'beam-zone-pulse', position: 'beam-delay-west', land: m.barBeat(5, 1), idPrefix: 'toll' })
  b.drones.formation({
    effect: 'orrery-formation-140',
    position: 'pad-1',
    by: m.barBeat(9, 1),
    params: { count: 100, scaleM: 50 },
  })
  // pad-2: the orrery on pad-1 holds 60 s, so a second chain is needed.
  b.drones.formation({
    effect: 'text-formation-150',
    position: 'pad-2',
    by: m.barBeat(27, 1),
    params: { count: 60, scaleM: 3, text: 'JOY' },
  })
  b.lasers.pattern({ effect: 'laser-fan-rgb', position: 'laser-west', from: m.barBeat(2, 1), durBeats: 8 })
  b.panels.pattern({ effect: 'panel-aurora', position: 'panel-east', from: m.barBeat(18, 1) })
  b.fabrication.cue({ effectId: 'lancework-moon-6m', anchor: m.barBeat(20, 1), positionId: 'rack-6' })
  b.crowd.flood({ effect: 'crowd-flood-rgb', position: 'mast-west', from: m.barBeat(4, 1) })
  b.crowd.text('BOO', { effect: 'crowd-text-marquee', position: 'mast-east', land: m.barBeat(21, 1) })
  b.crowd.haptic({ effect: 'crowd-haptic-thump', position: 'mast-west', land: m.barBeat(22, 1) })
  b.fountains.jet({ effect: 'fountain-plume-30m', position: 'fount-west', crest: m.barBeat(6, 1), heightM: 40 })
  b.lights.figure({ effect: 'light-fan-gold', position: 'lights-east', land: m.barBeat(23, 1) })
  return b.build().compiled
}

describe('formatClock', () => {
  it('renders m:ss without tenths and sign-prefixes negatives', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(75.4)).toBe('1:15')
    expect(formatClock(59.6)).toBe('1:00')
    expect(formatClock(-6)).toBe('-0:06')
    expect(formatClock(600)).toBe('10:00')
  })
})

describe('programNotesMarkdown', () => {
  const compiled = build()
  const md = programNotesMarkdown(compiled, getEffect)

  it('opens with the escaped title, tagline, music credits and runtime', () => {
    expect(md.startsWith('# Notes \\| Fixture\n')).toBe(true)
    expect(md).toContain('*A test \\| with a pipe*')
    expect(md).toContain('- Ludwig van Beethoven — Ode to Joy (1824)')
    expect(md).toContain(`**Runtime** ${formatClock(showDurationSec(compiled))} · **Acts** 2`)
  })

  it('writes one section per act with its clock, note (newlines collapsed) and a Look-for line', () => {
    // Self-numbered titles ('I — …') print without the 'Act n —' prefix.
    expect(md).toContain('## I — Opening (0:00)')
    expect(md).toContain('First act note. Second line.')
    expect(md).toContain(`## II — Finale (${formatClock(tl.downbeats[16]!)})`)
    expect(md).not.toContain('Act 1 —')
    expect(md).toContain('Finale note.')
    expect(md.match(/\*Look for:\*/g)).toHaveLength(2)
  })

  it('derives the Look-for line from the cues landing inside each act', () => {
    const [act1, act2] = md.split('## II — Finale')
    // Act 1 (0 s → bar 17): shell-a, the toll, the orrery, laser, flood, fountain.
    expect(act1).toContain('1 shell;')
    expect(act1).toContain('drones form orrery (up to 100)')
    expect(act1).toContain('1 laser pattern')
    expect(act1).toContain('the crowd canvas lights 1 time')
    expect(act1).toContain('1 directional-audio cue (1 everywhere-at-once)')
    expect(act1).toContain('fountains crest to 40 m (plume)')
    expect(act1).not.toContain('searchlights')
    // Act 2: shell-b WITH thunder, JOY text, panel, lancework, BOO + thump, fan lights.
    expect(act2).toContain('1 shell (1 with beam-delivered thunder)')
    expect(act2).toContain("drones form text 'JOY' (up to 60)")
    expect(act2).toContain('1 panel pattern')
    expect(act2).toContain('set pieces: Lancework Crescent Moon')
    expect(act2).toContain("the crowd canvas lights 2 times and spells 'BOO' (1 wrist thump)")
    expect(act2).toContain('1 directional-audio cue (1 following a shell or formation)')
    expect(act2).toContain('searchlights fan')
  })

  it('closes with the epilogue, the keystone paragraph and the design-values footer — no crew banner', () => {
    expect(md).toContain('*Good night.*')
    expect(md).toContain('## How it lands on the beat')
    expect(md).toContain('Nothing in this show is fired on the beat.')
    expect(md).toContain('A shell leaves its mortar up to 2.80 s before its break (White Peony 100).')
    expect(md).toContain('Sound from the directional arrays sets off up to')
    expect(md).toContain('Fountain valves open')
    expect(md).toContain('Searchlight heads start their swing up to')
    expect(md).toContain('Wristband and phone commands leave the masts 0.08 s early')
    expect(md).toContain('Drones begin their move up to')
    expect(md.trimEnd().endsWith('Designed and simulated in Theodoor. Timings are design values; live emission is gated separately.')).toBe(true)
    expect(md).not.toContain('SIMULATION ONLY')
    expect(md).not.toContain('firing authorization')
  })

  it('remarks on the quiet variant with the budget it holds', () => {
    const quiet = programNotesMarkdown(build('quiet'), getEffect)
    expect(quiet).toContain('> A quiet-variant performance: no effect above 100 dB at 15 m; the summed level at the lawn is held to 85 dB.')
    expect(md).not.toContain('quiet-variant performance')
  })

  it('still prints a minimal program (title, music from the timeline, runtime, footer) without notes', () => {
    const bare = build('standard', false)
    const out = programNotesMarkdown(bare, getEffect)
    expect(out).toContain('# Notes \\| Fixture')
    expect(out).toContain(`- ${tl.title}`)
    expect(out).toContain('**Runtime**')
    expect(out).not.toContain('**Acts**')
    expect(out).not.toContain('## Act')
    expect(out).toContain('## How it lands on the beat')
    expect(out).toContain('Designed and simulated in Theodoor.')
  })

  it('is deterministic across runs and across independent builds', () => {
    expect(programNotesMarkdown(compiled, getEffect)).toBe(md)
    expect(programNotesMarkdown(build(), getEffect)).toBe(md)
  })
})

describe('actHeading', () => {
  it('prefixes plain titles with the act number and leaves self-numbered titles alone', () => {
    expect(actHeading({ title: 'Opening', fromSec: 0, toSec: 10, note: '' }, 0)).toBe('## Act 1 — Opening (0:00)')
    expect(actHeading({ title: 'IV — Dawn', fromSec: 245.5, toSec: 260, note: '' }, 3)).toBe('## IV — Dawn (4:06)')
    expect(actHeading({ title: 'A|B', fromSec: 61, toSec: 70, note: '' }, 1)).toBe('## Act 2 — A\\|B (1:01)')
  })
})

describe('lookForLine / keystoneParagraph edge cases', () => {
  it('returns an empty line for an empty act', () => {
    expect(lookForLine([], getEffect, new Set())).toBe('')
  })

  it('pluralizes and lists formation kinds in human English', () => {
    const compiled = build()
    const drones = compiled.cues.filter((c) => c.medium === 'drone')
    expect(lookForLine(drones, getEffect, new Set())).toBe("drones form orrery and text 'JOY' (up to 100)")
    const shells: CompiledCue[] = compiled.cues.filter((c) => c.medium === 'pyro')
    expect(lookForLine(shells, getEffect, new Set())).toBe('2 shells')
    expect(lookForLine(shells, getEffect, new Set(['shell-a', 'shell-b']))).toBe('2 shells (2 with beam-delivered thunder)')
  })

  it('the keystone paragraph names only the media the show actually uses', () => {
    const b = showBuilder({ id: 'k', title: 'K', seed: 1, site: lakesidePark(), catalog }).music(tl)
    b.lasers.pattern({ effect: 'laser-fan-rgb', position: 'laser-west', from: m.time(1), durBeats: 4 })
    const text = keystoneParagraph(b.build().compiled, getEffect)
    expect(text).toContain('Nothing in this show is fired on the beat.')
    expect(text).not.toContain('shell')
    expect(text).not.toContain('Fountain')
  })
})
