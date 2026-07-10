/**
 * audio/voices.ts — Web Audio voice graphs for the score synth.
 *
 * One call = one note = one small node graph connected to the given
 * destination (the synth's per-program gain). Every graph is fully scheduled
 * against AudioContext time at build (start/stop/AudioParam ramps) so the
 * scheduler never revisits it; `stopAt` tells the active-node registry when
 * the graph is finished and can be reaped.
 *
 * Programs (design §3):
 *   lead  — 2 saws detuned ±6 cents → lowpass 2.5 kHz → ADSR 5/80/0.7/120 ms,
 *           5.5 Hz vibrato on frequency
 *   brass — saw → lowpass sweeping 500→3000 Hz over the attack → ADSR
 *           20/150/0.8/200 ms
 *   bass  — triangle + sub-octave sine, short envelope
 *   bells — lead variant: long release (600 ms) + a 2.01× inharmonic partial
 *   perc  — shared 2 s noise buffer; midi selects the drum (GM-ish):
 *           38 snare (bandpass 1.8 kHz, 80 ms), 35 kick (sine 150→50 Hz,
 *           250 ms), 49 cymbal (highpass 6 kHz, 900 ms), 57 cannon (kick +
 *           lowpass-300 Hz noise, 600 ms)
 */

import { mulberry32 } from '@theodoor/core'
import type { VoiceProgram } from '@theodoor/core'

export interface VoiceNote {
  midi: number
  /** 0..1 */
  velocity: number
  /** AudioContext time the note starts sounding. */
  tStart: number
  /** Sounding duration in context seconds (already rate-adjusted). */
  tDur: number
}

export interface BuiltVoice {
  /**
   * Every node of the graph. Sources are started/stopped already; flush
   * stops any node with a stop() and disconnects all of them.
   */
  nodes: AudioNode[]
  /** Context time after which the graph is silent and reap-able. */
  stopAt: number
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// ---------------------------------------------------------------------------
// Shared noise buffer (per context, deterministic)
// ---------------------------------------------------------------------------

export const NOISE_BUFFER_SEC = 2
/** Fixed seed → identical noise buffer on every load. */
const NOISE_SEED = 0x7e0da01

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

/** Shared 2 s white-noise buffer, one per context, seeded (no Math.random). */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx)
  if (!buf) {
    const n = Math.floor(NOISE_BUFFER_SEC * ctx.sampleRate)
    buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const data = buf.getChannelData(0)
    const rng = mulberry32(NOISE_SEED)
    for (let i = 0; i < n; i++) data[i] = rng() * 2 - 1
    noiseCache.set(ctx, buf)
  }
  return buf
}

// ---------------------------------------------------------------------------
// Envelope helper
// ---------------------------------------------------------------------------

interface Adsr {
  a: number
  d: number
  s: number
  r: number
}

/**
 * Schedule a linear ADSR on `gain` for a note held tDur seconds from t0.
 * Short notes release early (from wherever the envelope is). Returns the
 * time the envelope reaches zero.
 */
function scheduleAdsr(
  gain: AudioParam,
  t0: number,
  tDur: number,
  peak: number,
  env: Adsr,
): number {
  const holdEnd = t0 + Math.max(tDur, 0.01)
  gain.setValueAtTime(0, t0)
  gain.linearRampToValueAtTime(peak, t0 + env.a)
  gain.linearRampToValueAtTime(peak * env.s, t0 + env.a + env.d)
  if (holdEnd > t0 + env.a + env.d) gain.setValueAtTime(peak * env.s, holdEnd)
  const stopAt = holdEnd + env.r
  gain.linearRampToValueAtTime(0, stopAt)
  return stopAt
}

// ---------------------------------------------------------------------------
// Melodic programs
// ---------------------------------------------------------------------------

function buildLeadLike(
  ctx: BaseAudioContext,
  note: VoiceNote,
  dest: AudioNode,
  opts: { release: number; bellPartial: boolean },
): BuiltVoice {
  const { tStart: t0, tDur } = note
  const hz = midiToHz(note.midi)
  const nodes: AudioNode[] = []

  const g = ctx.createGain()
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2500
  lp.connect(g)
  g.connect(dest)
  nodes.push(lp, g)

  const stopAt = scheduleAdsr(
    g.gain,
    t0,
    tDur,
    0.28 * note.velocity,
    { a: 0.005, d: 0.08, s: 0.7, r: opts.release },
  )

  // Two saws detuned ±6 cents.
  const oscs: OscillatorNode[] = []
  for (const cents of [-6, 6]) {
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = hz
    o.detune.value = cents
    o.connect(lp)
    oscs.push(o)
    nodes.push(o)
  }

  if (opts.bellPartial) {
    const partial = ctx.createOscillator()
    partial.type = 'sine'
    partial.frequency.value = hz * 2.01
    const pg = ctx.createGain()
    pg.gain.value = 0.35
    partial.connect(pg)
    pg.connect(lp)
    oscs.push(partial)
    nodes.push(partial, pg)
  }

  // 5.5 Hz vibrato on frequency (one LFO drives every oscillator).
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 5.5
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = hz * 0.006 // ~10 cents of wobble
  lfo.connect(lfoGain)
  for (const o of oscs) {
    if (o.type !== 'sine' || !opts.bellPartial) lfoGain.connect(o.frequency)
  }
  nodes.push(lfo, lfoGain)

  for (const o of [...oscs, lfo]) {
    o.start(t0)
    o.stop(stopAt)
  }
  return { nodes, stopAt }
}

function buildBrass(ctx: BaseAudioContext, note: VoiceNote, dest: AudioNode): BuiltVoice {
  const { tStart: t0, tDur } = note
  const hz = midiToHz(note.midi)
  const nodes: AudioNode[] = []

  const g = ctx.createGain()
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.connect(g)
  g.connect(dest)
  nodes.push(lp, g)

  const env: Adsr = { a: 0.02, d: 0.15, s: 0.8, r: 0.2 }
  const stopAt = scheduleAdsr(g.gain, t0, tDur, 0.3 * note.velocity, env)

  // Filter sweep 500 → 3000 Hz over the attack.
  lp.frequency.setValueAtTime(500, t0)
  lp.frequency.linearRampToValueAtTime(3000, t0 + env.a)

  const o = ctx.createOscillator()
  o.type = 'sawtooth'
  o.frequency.value = hz
  o.connect(lp)
  o.start(t0)
  o.stop(stopAt)
  nodes.push(o)
  return { nodes, stopAt }
}

function buildBass(ctx: BaseAudioContext, note: VoiceNote, dest: AudioNode): BuiltVoice {
  const { tStart: t0, tDur } = note
  const hz = midiToHz(note.midi)
  const nodes: AudioNode[] = []

  const g = ctx.createGain()
  g.connect(dest)
  nodes.push(g)

  const stopAt = scheduleAdsr(
    g.gain,
    t0,
    tDur,
    0.35 * note.velocity,
    { a: 0.008, d: 0.09, s: 0.6, r: 0.09 },
  )

  const tri = ctx.createOscillator()
  tri.type = 'triangle'
  tri.frequency.value = hz
  tri.connect(g)

  const sub = ctx.createOscillator()
  sub.type = 'sine'
  sub.frequency.value = hz / 2
  const subGain = ctx.createGain()
  subGain.gain.value = 0.6
  sub.connect(subGain)
  subGain.connect(g)

  for (const o of [tri, sub]) {
    o.start(t0)
    o.stop(stopAt)
  }
  nodes.push(tri, sub, subGain)
  return { nodes, stopAt }
}

// ---------------------------------------------------------------------------
// Percussion
// ---------------------------------------------------------------------------

function noiseHit(
  ctx: BaseAudioContext,
  t0: number,
  vel: number,
  decaySec: number,
  shapeFilter: (f: BiquadFilterNode) => void,
  dest: AudioNode,
  gainScale: number,
): { nodes: AudioNode[]; stopAt: number } {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const f = ctx.createBiquadFilter()
  shapeFilter(f)
  const g = ctx.createGain()
  g.gain.setValueAtTime(gainScale * vel, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + decaySec)
  g.gain.linearRampToValueAtTime(0, t0 + decaySec + 0.01)
  src.connect(f)
  f.connect(g)
  g.connect(dest)
  const stopAt = t0 + decaySec + 0.02
  src.start(t0)
  src.stop(stopAt)
  return { nodes: [src, f, g], stopAt }
}

function kick(
  ctx: BaseAudioContext,
  t0: number,
  vel: number,
  dest: AudioNode,
): { nodes: AudioNode[]; stopAt: number } {
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(150, t0)
  o.frequency.exponentialRampToValueAtTime(50, t0 + 0.25)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.9 * vel, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25)
  g.gain.linearRampToValueAtTime(0, t0 + 0.26)
  o.connect(g)
  g.connect(dest)
  const stopAt = t0 + 0.27
  o.start(t0)
  o.stop(stopAt)
  return { nodes: [o, g], stopAt }
}

/** GM-ish drum map used by perc voices (see contracts.NoteEvent doc). */
export const PERC_KICK = 35
export const PERC_SNARE = 38
export const PERC_CYMBAL = 49
export const PERC_CANNON = 57

function buildPerc(ctx: BaseAudioContext, note: VoiceNote, dest: AudioNode): BuiltVoice {
  const { tStart: t0, velocity: vel } = note
  switch (note.midi) {
    case PERC_SNARE: {
      const hit = noiseHit(
        ctx,
        t0,
        vel,
        0.08,
        (f) => {
          f.type = 'bandpass'
          f.frequency.value = 1800
          f.Q.value = 0.9
        },
        dest,
        0.7,
      )
      return { nodes: hit.nodes, stopAt: hit.stopAt }
    }
    case PERC_CYMBAL: {
      const hit = noiseHit(
        ctx,
        t0,
        vel,
        0.9,
        (f) => {
          f.type = 'highpass'
          f.frequency.value = 6000
        },
        dest,
        0.45,
      )
      return { nodes: hit.nodes, stopAt: hit.stopAt }
    }
    case PERC_CANNON: {
      // The audible accent big hits land on: kick + low rumble.
      const k = kick(ctx, t0, vel, dest)
      const rumble = noiseHit(
        ctx,
        t0,
        vel,
        0.6,
        (f) => {
          f.type = 'lowpass'
          f.frequency.value = 300
        },
        dest,
        0.9,
      )
      return {
        nodes: [...k.nodes, ...rumble.nodes],
        stopAt: Math.max(k.stopAt, rumble.stopAt),
      }
    }
    case PERC_KICK:
    default: {
      const k = kick(ctx, t0, vel, dest)
      return { nodes: k.nodes, stopAt: k.stopAt }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build (and fully schedule) one note's voice graph, connected to `dest`
 * — the synth's per-program gain feeding the master compressor.
 */
export function buildVoice(
  ctx: BaseAudioContext,
  program: VoiceProgram,
  note: VoiceNote,
  dest: AudioNode,
): BuiltVoice {
  switch (program) {
    case 'lead':
      return buildLeadLike(ctx, note, dest, { release: 0.12, bellPartial: false })
    case 'bells':
      return buildLeadLike(ctx, note, dest, { release: 0.6, bellPartial: true })
    case 'brass':
      return buildBrass(ctx, note, dest)
    case 'bass':
      return buildBass(ctx, note, dest)
    case 'perc':
      return buildPerc(ctx, note, dest)
  }
}
