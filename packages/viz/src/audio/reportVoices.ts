/**
 * audio/reportVoices.ts — Web Audio graphs for the REPORT timbres: what a
 * shell, a set piece, or a fountain sounds like at the seat. One call = one
 * ReportEvent = one small graph, fully scheduled against context time at
 * build, connected to the dry bus (through an air-absorption lowpass and a
 * stereo panner) and to the reverb send.
 *
 * Timbres (all from the shared seeded noise buffer + oscillators; `size`
 * 0..1 scales depth and length):
 *   salute  — crack: highpassed noise, 25 ms; thump: sine 90 → 35 Hz, 0.35 s;
 *             low rumble: lowpassed noise, 0.5 s
 *   boom    — sub sweep (70·(1−0.35·size) → 28 Hz) over 0.45 + 0.4·size s;
 *             rumble: lowpass (260 − 120·size) Hz noise over 0.8 + 1.4·size s;
 *             body: bandpass 220 Hz thud, 0.18 s
 *   crackle — a small boom plus 5–8 seeded crackle ticks (highpassed 8 ms
 *             bursts) spread over 0.15–1.1 s after the break
 *   mine    — whoosh: bandpass sweeping 350 → 2400 Hz, 0.7 s, 60 ms attack
 *   comet   — soft whoosh riding the ascent: bandpass 500 → 1400 Hz over the
 *             sounding duration, slow in/out
 *   hiss    — set piece: bandpass 2.8 kHz (Q 0.5) noise for the duration,
 *             0.3 s attack, 0.6 s release
 *   water   — fountain rush: bandpass 1.1 kHz (Q 0.45) + lowpass 4 kHz noise
 *             for the duration, attack = the rise, slow 0.45 Hz wobble
 *
 * Every graph ends with: air lowpass (event.lowpassHz) → StereoPanner
 * (event.pan) → dest, plus a parallel send → reverbSend. `stopAt` tells the
 * registry when the graph is silent and reap-able.
 */
import { mulberry32 } from '@theodoor/core'
import type { ReportEvent } from './reportMath.js'
import { noiseBuffer } from './voices.js'
import type { BuiltVoice } from './voices.js'

/** Highpass corner of the salute crack, Hz. */
export const SALUTE_CRACK_HZ = 2200
/** Reverb send level for impulsive reports (they bloom in the tail). */
export const REPORT_SEND_IMPULSE = 0.55
/** Reverb send level for sustained sources (already diffuse). */
export const REPORT_SEND_SUSTAINED = 0.25
/** Crackle ticks per crossette (seeded within this range). */
export const CRACKLE_TICKS_MIN = 5
export const CRACKLE_TICKS_MAX = 8

interface Tail {
  /** Air lowpass → panner → dest (+ send). Connect voice output here. */
  input: AudioNode
  nodes: AudioNode[]
}

/** Shared output tail: air-absorption lowpass, pan, dry + reverb send. */
function makeTail(
  ctx: BaseAudioContext,
  ev: ReportEvent,
  dest: AudioNode,
  reverbSend: AudioNode | null,
  sendLevel: number,
): Tail {
  const air = ctx.createBiquadFilter()
  air.type = 'lowpass'
  air.frequency.value = Math.min(ev.lowpassHz, ctx.sampleRate / 2 - 100)
  air.Q.value = 0.3
  const pan = ctx.createStereoPanner()
  pan.pan.value = Math.max(-1, Math.min(1, ev.pan))
  air.connect(pan)
  pan.connect(dest)
  const nodes: AudioNode[] = [air, pan]
  if (reverbSend) {
    const send = ctx.createGain()
    send.gain.value = sendLevel
    pan.connect(send)
    send.connect(reverbSend)
    nodes.push(send)
  }
  return { input: air, nodes }
}

/** Exponentially decaying gain envelope from `peak` at t0 to ~silence at t0 + decaySec. */
function decayEnv(g: GainNode, t0: number, peak: number, decaySec: number): number {
  g.gain.setValueAtTime(Math.max(1e-4, peak), t0)
  g.gain.exponentialRampToValueAtTime(1e-4, t0 + decaySec)
  g.gain.linearRampToValueAtTime(0, t0 + decaySec + 0.01)
  return t0 + decaySec + 0.02
}

/** Attack / hold / release envelope for sustained sources. */
function sustainEnv(
  g: GainNode,
  t0: number,
  peak: number,
  attackSec: number,
  holdSec: number,
  releaseSec: number,
): number {
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(peak, t0 + attackSec)
  const holdEnd = Math.max(t0 + attackSec, t0 + holdSec)
  g.gain.setValueAtTime(peak, holdEnd)
  g.gain.linearRampToValueAtTime(0, holdEnd + releaseSec)
  return holdEnd + releaseSec + 0.01
}

function noiseSource(ctx: BaseAudioContext, t0: number, stopAt: number, loop = false): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  src.loop = loop
  src.start(t0)
  src.stop(stopAt)
  return src
}

function filtered(ctx: BaseAudioContext, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = hz
  f.Q.value = q
  return f
}

function buildSalute(ctx: BaseAudioContext, ev: ReportEvent, t0: number, out: AudioNode): { nodes: AudioNode[]; stopAt: number } {
  const nodes: AudioNode[] = []
  const g = ev.gain
  // Crack.
  const crackG = ctx.createGain()
  const crackStop = decayEnv(crackG, t0, g, 0.025)
  const crackF = filtered(ctx, 'highpass', SALUTE_CRACK_HZ, 0.7)
  const crack = noiseSource(ctx, t0, crackStop)
  crack.connect(crackF)
  crackF.connect(crackG)
  crackG.connect(out)
  nodes.push(crack, crackF, crackG)
  // Thump.
  const thump = ctx.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(90, t0)
  thump.frequency.exponentialRampToValueAtTime(35, t0 + 0.35)
  const thumpG = ctx.createGain()
  const thumpStop = decayEnv(thumpG, t0, g * 0.9, 0.35)
  thump.connect(thumpG)
  thumpG.connect(out)
  thump.start(t0)
  thump.stop(thumpStop)
  nodes.push(thump, thumpG)
  // Rumble.
  const rumbleG = ctx.createGain()
  const rumbleStop = decayEnv(rumbleG, t0 + 0.01, g * 0.5, 0.5)
  const rumbleF = filtered(ctx, 'lowpass', 200, 0.5)
  const rumble = noiseSource(ctx, t0 + 0.01, rumbleStop)
  rumble.connect(rumbleF)
  rumbleF.connect(rumbleG)
  rumbleG.connect(out)
  nodes.push(rumble, rumbleF, rumbleG)
  return { nodes, stopAt: Math.max(crackStop, thumpStop, rumbleStop) }
}

function buildBoom(
  ctx: BaseAudioContext,
  ev: ReportEvent,
  t0: number,
  out: AudioNode,
  gainScale = 1,
): { nodes: AudioNode[]; stopAt: number } {
  const nodes: AudioNode[] = []
  const g = ev.gain * gainScale
  const s = ev.size
  // Sub sweep.
  const sub = ctx.createOscillator()
  sub.type = 'sine'
  const subDur = 0.45 + 0.4 * s
  sub.frequency.setValueAtTime(70 * (1 - 0.35 * s), t0)
  sub.frequency.exponentialRampToValueAtTime(28, t0 + subDur)
  const subG = ctx.createGain()
  const subStop = decayEnv(subG, t0, g * (0.6 + 0.4 * s), subDur)
  sub.connect(subG)
  subG.connect(out)
  sub.start(t0)
  sub.stop(subStop)
  nodes.push(sub, subG)
  // Rumble.
  const rumbleDur = 0.8 + 1.4 * s
  const rumbleG = ctx.createGain()
  const rumbleStop = decayEnv(rumbleG, t0 + 0.02, g * (0.35 + 0.45 * s), rumbleDur)
  const rumbleF = filtered(ctx, 'lowpass', 260 - 120 * s, 0.6)
  const rumble = noiseSource(ctx, t0 + 0.02, rumbleStop, true)
  rumble.connect(rumbleF)
  rumbleF.connect(rumbleG)
  rumbleG.connect(out)
  nodes.push(rumble, rumbleF, rumbleG)
  // Body thud.
  const bodyG = ctx.createGain()
  const bodyStop = decayEnv(bodyG, t0, g * 0.5, 0.18)
  const bodyF = filtered(ctx, 'bandpass', 220, 1.2)
  const body = noiseSource(ctx, t0, bodyStop)
  body.connect(bodyF)
  bodyF.connect(bodyG)
  bodyG.connect(out)
  nodes.push(body, bodyF, bodyG)
  return { nodes, stopAt: Math.max(subStop, rumbleStop, bodyStop) }
}

function buildCrackle(ctx: BaseAudioContext, ev: ReportEvent, t0: number, out: AudioNode): { nodes: AudioNode[]; stopAt: number } {
  const boom = buildBoom(ctx, { ...ev, size: Math.min(ev.size, 0.45) }, t0, out, 0.8)
  const nodes = [...boom.nodes]
  let stopAt = boom.stopAt
  const rng = mulberry32(ev.seed >>> 0)
  const n = CRACKLE_TICKS_MIN + Math.floor(rng() * (CRACKLE_TICKS_MAX - CRACKLE_TICKS_MIN + 1))
  for (let i = 0; i < n; i++) {
    const at = t0 + 0.15 + rng() * 0.95
    const tickG = ctx.createGain()
    const tickStop = decayEnv(tickG, at, ev.gain * (0.35 + 0.35 * rng()), 0.008 + rng() * 0.012)
    const tickF = filtered(ctx, 'highpass', 3000 + rng() * 2000, 0.7)
    const tick = noiseSource(ctx, at, tickStop)
    tick.connect(tickF)
    tickF.connect(tickG)
    tickG.connect(out)
    nodes.push(tick, tickF, tickG)
    if (tickStop > stopAt) stopAt = tickStop
  }
  return { nodes, stopAt }
}

function buildWhoosh(
  ctx: BaseAudioContext,
  ev: ReportEvent,
  t0: number,
  out: AudioNode,
  spec: { fromHz: number; toHz: number; durSec: number; attackSec: number; gainScale: number; q: number },
): { nodes: AudioNode[]; stopAt: number } {
  const g = ctx.createGain()
  const stopAt = sustainEnv(g, t0, ev.gain * spec.gainScale, spec.attackSec, spec.durSec * 0.7, spec.durSec * 0.3)
  const f = filtered(ctx, 'bandpass', spec.fromHz, spec.q)
  f.frequency.setValueAtTime(spec.fromHz, t0)
  f.frequency.exponentialRampToValueAtTime(spec.toHz, t0 + spec.durSec)
  const src = noiseSource(ctx, t0, stopAt, true)
  src.connect(f)
  f.connect(g)
  g.connect(out)
  return { nodes: [src, f, g], stopAt }
}

function buildSustained(
  ctx: BaseAudioContext,
  ev: ReportEvent,
  t0: number,
  durSec: number,
  out: AudioNode,
  spec: { hz: number; q: number; lowpassHz?: number; attackSec: number; releaseSec: number; gainScale: number; wobbleHz?: number },
): { nodes: AudioNode[]; stopAt: number } {
  const g = ctx.createGain()
  const stopAt = sustainEnv(g, t0, ev.gain * spec.gainScale, spec.attackSec, durSec, spec.releaseSec)
  const f = filtered(ctx, 'bandpass', spec.hz, spec.q)
  const src = noiseSource(ctx, t0, stopAt, true)
  const nodes: AudioNode[] = [src, f, g]
  src.connect(f)
  let last: AudioNode = f
  if (spec.lowpassHz !== undefined) {
    const lp = filtered(ctx, 'lowpass', spec.lowpassHz, 0.5)
    last.connect(lp)
    last = lp
    nodes.push(lp)
  }
  last.connect(g)
  g.connect(out)
  if (spec.wobbleHz !== undefined) {
    // Slow amplitude wobble: LFO into a unity-biased gain stage.
    const wobble = ctx.createGain()
    wobble.gain.value = 1
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = spec.wobbleHz
    const depth = ctx.createGain()
    depth.gain.value = 0.18
    lfo.connect(depth)
    depth.connect(wobble.gain)
    g.disconnect(out)
    g.connect(wobble)
    wobble.connect(out)
    lfo.start(t0)
    lfo.stop(stopAt)
    nodes.push(wobble, lfo, depth)
  }
  return { nodes, stopAt }
}

/**
 * Build (and fully schedule) one report's graph. `tArrival` is the context
 * time the sound reaches the seat; `tDur` the rate-adjusted sounding
 * duration for sustained kinds (ignored by impulses).
 */
export function buildReport(
  ctx: BaseAudioContext,
  ev: ReportEvent,
  tArrival: number,
  tDur: number,
  dest: AudioNode,
  reverbSend: AudioNode | null,
): BuiltVoice {
  const impulsive = ev.kind === 'salute' || ev.kind === 'boom' || ev.kind === 'crackle'
  const tail = makeTail(ctx, ev, dest, reverbSend, impulsive ? REPORT_SEND_IMPULSE : REPORT_SEND_SUSTAINED)
  let built: { nodes: AudioNode[]; stopAt: number }
  switch (ev.kind) {
    case 'salute':
      built = buildSalute(ctx, ev, tArrival, tail.input)
      break
    case 'boom':
      built = buildBoom(ctx, ev, tArrival, tail.input)
      break
    case 'crackle':
      built = buildCrackle(ctx, ev, tArrival, tail.input)
      break
    case 'mine':
      built = buildWhoosh(ctx, ev, tArrival, tail.input, {
        fromHz: 350, toHz: 2400, durSec: 0.7, attackSec: 0.06, gainScale: 0.8, q: 1.1,
      })
      break
    case 'comet':
      built = buildWhoosh(ctx, ev, tArrival, tail.input, {
        fromHz: 500, toHz: 1400, durSec: Math.max(0.4, tDur), attackSec: Math.max(0.15, tDur * 0.3), gainScale: 0.6, q: 1.4,
      })
      break
    case 'hiss':
      built = buildSustained(ctx, ev, tArrival, Math.max(0.2, tDur), tail.input, {
        hz: 2800, q: 0.5, attackSec: 0.3, releaseSec: 0.6, gainScale: 0.7,
      })
      break
    case 'water':
      built = buildSustained(ctx, ev, tArrival, Math.max(0.2, tDur), tail.input, {
        hz: 1100, q: 0.45, lowpassHz: 4000, attackSec: Math.min(2, Math.max(0.3, tDur * 0.25)), releaseSec: 0.8,
        gainScale: 0.5 + 0.5 * ev.size, wobbleHz: 0.45,
      })
      break
  }
  return { nodes: [...built.nodes, ...tail.nodes], stopAt: built.stopAt }
}
