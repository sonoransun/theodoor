/**
 * export/programNotes.ts — the printed program a guest receives.
 *
 * PURE string builder over a CompiledShow: title, tagline, music credits,
 * runtime, one section per program-note act (compiled.acts — resolved to
 * seconds by compile()) with the author's guest-facing note and an
 * auto-generated "Look for" line derived from the cues that land inside the
 * act, then a short "How it lands on the beat" paragraph built from the
 * show's own solved anticipations. Written for the audience, not the crew:
 * no cue ids, no pin numbers, no SIMULATION-ONLY banner — but timings are
 * marked as design values, and live emission stays gated elsewhere.
 *
 * Deterministic: identical inputs produce identical bytes (no clocks, stable
 * iteration order, fixed number formatting). Shows without notes still get a
 * minimal program (title, music, runtime, footer).
 */

import type { CompiledAct, CompiledCue, CompiledShow, EffectDef, Seconds } from '../contracts.js'
import { QUIET_VARIANT_MAX_DB } from '../show/validate.js'
import { showDurationSec } from '../transport/transport.js'

type GetEffect = (id: string) => EffectDef | undefined

/** m:ss for guests (no tenths); negative times are sign-prefixed. */
export function formatClock(t: Seconds): string {
  const sign = t < 0 ? '-' : ''
  const total = Math.round(Math.abs(t))
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${sign}${m}:${String(s).padStart(2, '0')}`
}

/** Escape characters that would break markdown structure; newlines collapse. */
function md(s: string): string {
  return s.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ')
}

/** 'cometTail' → 'comet tail'. */
function words(camel: string): string {
  return camel.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

/** 'a, b and c' — deterministic English list. */
function humanList(items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]!
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Titles that already open with a roman numeral ('II — Orbit') need no 'Act n —' prefix. */
const ROMAN_PREFIX = /^[IVXLC]+\s*[—–-]\s/

/** Section heading for act i (0-based): 'Act n — Title (m:ss)', or the title alone when it numbers itself. */
export function actHeading(act: CompiledAct, i: number): string {
  const title = md(act.title)
  const head = ROMAN_PREFIX.test(act.title) ? title : `Act ${i + 1} — ${title}`
  return `## ${head} (${formatClock(act.fromSec)})`
}

/** Ids of pyro/drone cues some beam cue tags (sourceCueId) — thunder with flash. */
function taggedSourceIds(cues: readonly CompiledCue[]): Set<string> {
  const out = new Set<string>()
  for (const c of cues) {
    if (c.medium !== 'beam') continue
    const ref = c.params?.['sourceCueId']
    if (typeof ref === 'string') out.add(ref)
  }
  return out
}

/**
 * The auto-generated "Look for" line for one act: what lands inside its
 * span, per medium, terse and deterministic. Empty string when nothing lands.
 */
export function lookForLine(
  cues: readonly CompiledCue[],
  getEffect: GetEffect,
  tagged: ReadonlySet<string>,
): string {
  const parts: string[] = []
  const of = (medium: CompiledCue['medium']): CompiledCue[] => cues.filter((c) => c.medium === medium)

  const pyro = of('pyro')
  if (pyro.length > 0) {
    const withThunder = pyro.filter((c) => tagged.has(c.id)).length
    parts.push(
      plural(pyro.length, 'shell', 'shells') +
        (withThunder > 0 ? ` (${withThunder} with beam-delivered thunder)` : ''),
    )
  }

  const drones = of('drone')
  if (drones.length > 0) {
    let maxCount = 0
    const kinds: string[] = []
    for (const c of drones) {
      const e = getEffect(c.effectId)
      if (!e || e.medium !== 'drone') continue
      const count = typeof c.params?.['count'] === 'number' ? c.params['count'] : e.maxDrones
      if (count > maxCount) maxCount = count
      let kind = words(e.formation)
      if ((e.formation === 'text' || e.formation === 'digit') && typeof c.params?.['text'] === 'string') {
        kind = `${kind} '${c.params['text']}'`
      }
      if (!kinds.includes(kind)) kinds.push(kind)
    }
    if (kinds.length > 0) parts.push(`drones form ${humanList(kinds)} (up to ${maxCount})`)
  }

  const lasers = of('laser')
  if (lasers.length > 0) parts.push(plural(lasers.length, 'laser pattern', 'laser patterns'))
  const panels = of('panel')
  if (panels.length > 0) parts.push(plural(panels.length, 'panel pattern', 'panel patterns'))

  const fab = of('fabrication')
  if (fab.length > 0) {
    const names: string[] = []
    for (const c of fab) {
      const e = getEffect(c.effectId)
      const name = e ? e.name : c.effectId
      if (!names.includes(name)) names.push(name)
    }
    parts.push(`set pieces: ${humanList(names)}`)
  }

  const crowd = of('crowd')
  if (crowd.length > 0) {
    let thumps = 0
    const texts: string[] = []
    for (const c of crowd) {
      const e = getEffect(c.effectId)
      if (e?.medium === 'crowd' && e.pattern === 'hapticPulse') thumps++
      if (e?.medium === 'crowd' && e.pattern === 'text' && typeof c.params?.['text'] === 'string') {
        if (!texts.includes(c.params['text'])) texts.push(c.params['text'])
      }
    }
    let s = `the crowd canvas lights ${plural(crowd.length, 'time', 'times')}`
    if (texts.length > 0) s += ` and spells ${humanList(texts.map((t) => `'${t}'`))}`
    if (thumps > 0) s += ` (${plural(thumps, 'wrist thump', 'wrist thumps')})`
    parts.push(s)
  }

  const beams = of('beam')
  if (beams.length > 0) {
    const everywhere = beams.filter((c) => c.params?.['cells'] === 'all').length
    const tags = beams.filter((c) => typeof c.params?.['sourceCueId'] === 'string').length
    const extras: string[] = []
    if (everywhere > 0) extras.push(`${everywhere} everywhere-at-once`)
    if (tags > 0) extras.push(`${tags} following a shell or formation`)
    parts.push(
      plural(beams.length, 'directional-audio cue', 'directional-audio cues') +
        (extras.length > 0 ? ` (${extras.join(', ')})` : ''),
    )
  }

  const fountains = of('fountain')
  if (fountains.length > 0) {
    let crest = 0
    const kinds: string[] = []
    for (const c of fountains) {
      const e = getEffect(c.effectId)
      if (!e || e.medium !== 'fountain') continue
      const h = typeof c.params?.['heightM'] === 'number' ? c.params['heightM'] : e.heightM
      if (h > crest) crest = h
      const kind = words(e.jet)
      if (!kinds.includes(kind)) kinds.push(kind)
    }
    parts.push(`fountains crest to ${Math.round(crest)} m` + (kinds.length > 0 ? ` (${humanList(kinds)})` : ''))
  }

  const lights = of('searchlight')
  if (lights.length > 0) {
    const figures: string[] = []
    for (const c of lights) {
      const e = getEffect(c.effectId)
      if (!e || e.medium !== 'searchlight') continue
      const f = words(e.figure)
      if (!figures.includes(f)) figures.push(f)
    }
    parts.push(`searchlights ${humanList(figures)}`)
  }

  return parts.join('; ')
}

/** Cues whose landing falls inside an act's span (the last act includes its end). */
function cuesInAct(cues: readonly CompiledCue[], act: CompiledAct, isLast: boolean): CompiledCue[] {
  return cues.filter(
    (c) => c.targetSec >= act.fromSec && (isLast ? c.targetSec <= act.toSec : c.targetSec < act.toSec),
  )
}

interface Extreme {
  sec: number
  effectName: string
}

function longest(cues: readonly CompiledCue[], medium: CompiledCue['medium'], getEffect: GetEffect): Extreme | undefined {
  let best: Extreme | undefined
  for (const c of cues) {
    if (c.medium !== medium) continue
    if (best === undefined || c.anticipationSec > best.sec) {
      const e = getEffect(c.effectId)
      best = { sec: c.anticipationSec, effectName: e ? e.name : c.effectId }
    }
  }
  return best
}

/**
 * The guest-friendly keystone paragraph: fireSec = targetSec − anticipation,
 * illustrated with this show's own solved extremes per medium present.
 */
export function keystoneParagraph(compiled: CompiledShow, getEffect: GetEffect): string {
  const cues = compiled.cues
  const s2 = (v: number): string => v.toFixed(2)
  const lines: string[] = [
    'Nothing in this show is fired on the beat. Everything is fired early, by exactly ' +
      'as long as it takes to arrive, so that it lands on the beat.',
  ]
  const pyro = longest(cues, 'pyro', getEffect)
  if (pyro && pyro.sec > 0) {
    lines.push(`A shell leaves its mortar up to ${s2(pyro.sec)} s before its break (${md(pyro.effectName)}).`)
  }
  const drone = longest(cues, 'drone', getEffect)
  if (drone && drone.sec > 0) {
    lines.push(`Drones begin their move up to ${s2(drone.sec)} s before a formation is complete.`)
  }
  const crowd = longest(cues, 'crowd', getEffect)
  if (crowd && crowd.sec > 0) {
    lines.push(
      `Wristband and phone commands leave the masts ${s2(crowd.sec)} s early, so the field finishes lighting on the beat.`,
    )
  }
  const beam = longest(cues, 'beam', getEffect)
  if (beam && beam.sec > 0) {
    lines.push(
      `Sound from the directional arrays sets off up to ${s2(beam.sec)} s before it reaches your seat — ` +
        'the time it takes sound to cross the lawn.',
    )
  }
  const fountain = longest(cues, 'fountain', getEffect)
  if (fountain && fountain.sec > 0) {
    lines.push(`Fountain valves open ${s2(fountain.sec)} s before the water crests.`)
  }
  const light = longest(cues, 'searchlight', getEffect)
  if (light && light.sec > 0) {
    lines.push(`Searchlight heads start their swing up to ${s2(light.sec)} s before the light arrives on its mark.`)
  }
  return lines.join(' ')
}

/** Build the full guest program (markdown) for a compiled show. */
export function programNotesMarkdown(compiled: CompiledShow, getEffect: GetEffect): string {
  const { show, cues } = compiled
  const notes = show.notes
  const acts = compiled.acts ?? []
  const tagged = taggedSourceIds(cues)
  const out: string[] = []

  out.push(`# ${md(show.meta.title)}`)
  out.push('')
  if (notes && notes.tagline.length > 0) {
    out.push(`*${md(notes.tagline)}*`)
    out.push('')
  }

  out.push('**Music**')
  out.push('')
  const credits = notes && notes.music.length > 0 ? notes.music : [show.music.title]
  for (const line of credits) out.push(`- ${md(line)}`)
  out.push('')

  out.push(
    `**Runtime** ${formatClock(showDurationSec(compiled))}` +
      (acts.length > 0 ? ` · **Acts** ${acts.length}` : ''),
  )
  out.push('')

  if (show.meta.variant === 'quiet') {
    const budget = show.noiseBudget?.maxSplDb
    out.push(
      `> A quiet-variant performance: no effect above ${QUIET_VARIANT_MAX_DB} dB at 15 m` +
        (budget !== undefined ? `; the summed level at the lawn is held to ${budget} dB.` : '.'),
    )
    out.push('')
  }

  acts.forEach((act, i) => {
    out.push(actHeading(act, i))
    out.push('')
    if (act.note.length > 0) {
      out.push(md(act.note))
      out.push('')
    }
    const look = lookForLine(cuesInAct(cues, act, i === acts.length - 1), getEffect, tagged)
    if (look.length > 0) {
      out.push(`*Look for:* ${look}.`)
      out.push('')
    }
  })

  if (notes?.epilogue !== undefined && notes.epilogue.length > 0) {
    out.push(`*${md(notes.epilogue)}*`)
    out.push('')
  }

  if (cues.length > 0) {
    out.push('## How it lands on the beat')
    out.push('')
    out.push(keystoneParagraph(compiled, getEffect))
    out.push('')
  }

  out.push('---')
  out.push('')
  out.push('Designed and simulated in Theodoor. Timings are design values; live emission is gated separately.')
  return out.join('\n')
}
