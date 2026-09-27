/**
 * audio/wavSource.ts — user-supplied WAV → (playback + auto-generated show).
 *
 * The file is decoded twice from one arrayBuffer read:
 *   - ctx.decodeAudioData → AudioBuffer for playback (WavPlayer below);
 *   - channel 0 as Float32Array → core analyzePcm → MusicalTimeline →
 *     generateShowFromAnalysis({ maxSplDb: quiet ? 85 : undefined }) →
 *     { show, compiled } for the standard transport/sim/viz pipeline.
 *
 * Playback: AudioBufferSourceNode is one-shot, so every play/seek/rate
 * change recreates the source at the right offset with playbackRate = rate.
 */

import { analyzePcm, generateShowFromAnalysis } from '@theodoor/core'
import type { CompiledShow, MusicalTimeline, Show } from '@theodoor/core'
import type { SynthAnchor } from '../clock/audioClock.js'

/** Longest accepted WAV (10 minutes). */
export const MAX_WAV_SEC = 600
/** Quiet-mode budget applied when the picker checkbox is on. */
export const WAV_QUIET_BUDGET_DB = 85

export interface WavShow {
  title: string
  buffer: AudioBuffer
  timeline: MusicalTimeline
  show: Show
  compiled: CompiledShow
}

/**
 * Decode + analyze + generate. Throws Error with a user-facing message on
 * rejection (too long, silent, undecodable).
 */
export async function loadWavShow(
  file: File,
  ctx: BaseAudioContext,
  opts: { quiet?: boolean } = {},
): Promise<WavShow> {
  const bytes = await file.arrayBuffer()
  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(bytes)
  } catch {
    throw new Error(`Could not decode '${file.name}' as audio — is it a valid WAV file?`)
  }
  if (buffer.duration > MAX_WAV_SEC) {
    throw new Error(
      `'${file.name}' is ${Math.round(buffer.duration)} s long — ` +
        `the analyzer accepts at most ${MAX_WAV_SEC / 60} minutes.`,
    )
  }
  if (buffer.duration <= 0 || buffer.numberOfChannels < 1) {
    throw new Error(`'${file.name}' contains no audio data.`)
  }
  const pcm = buffer.getChannelData(0)
  let silent = true
  for (let i = 0; i < pcm.length; i += 997) {
    if (Math.abs(pcm[i]!) > 1e-4) {
      silent = false
      break
    }
  }
  if (silent) throw new Error(`'${file.name}' appears to be silent — nothing to analyze.`)

  const timeline = analyzePcm(pcm, buffer.sampleRate, {
    id: 'wav-analysis',
    title: file.name,
  })
  const generated = opts.quiet
    ? generateShowFromAnalysis(timeline, { maxSplDb: WAV_QUIET_BUDGET_DB })
    : generateShowFromAnalysis(timeline)
  return { title: file.name, buffer, timeline, show: generated.show, compiled: generated.compiled }
}

/**
 * Transport-slaved AudioBuffer playback. Call sync(anchor) whenever the
 * transport's play state / rate / position changes (and on flush); the
 * player recreates its one-shot source node as needed.
 */
export class WavPlayer {
  private readonly ctx: AudioContext
  private readonly buffer: AudioBuffer
  private readonly gain: GainNode
  private source: AudioBufferSourceNode | null = null

  constructor(ctx: AudioContext, buffer: AudioBuffer, out: AudioNode = ctx.destination) {
    this.ctx = ctx
    this.buffer = buffer
    this.gain = ctx.createGain()
    this.gain.gain.value = 0.9
    this.gain.connect(out)
  }

  /** Recreate/stop the source so playback matches the anchor. */
  sync(anchor: SynthAnchor): void {
    this.stopSource()
    if (!anchor.playing) return
    const offset = anchor.showSec
    if (offset >= this.buffer.duration) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.playbackRate.value = anchor.rate
    src.connect(this.gain)
    if (offset >= 0) {
      src.start(this.ctx.currentTime, offset)
    } else {
      // Pre-roll: music begins at show time 0, i.e. (−offset)/rate from now.
      src.start(this.ctx.currentTime + -offset / anchor.rate, 0)
    }
    this.source = src
  }

  dispose(): void {
    this.stopSource()
    this.gain.disconnect()
  }

  private stopSource(): void {
    if (this.source) {
      try {
        this.source.stop()
      } catch {
        /* never started */
      }
      this.source.disconnect()
      this.source = null
    }
  }
}
