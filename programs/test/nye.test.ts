import { describe, expect, it } from 'vitest'
import type { BuildResult, CompiledCue } from '@theodoor/core'
import { runHeadless, starterCatalog } from '@theodoor/core'
import { nye, nyeQuiet } from '../src/nye.js'

const catalog = starterCatalog()
const std = nye()
const qt = nyeQuiet()

const midnightOf = (r: BuildResult): number => {
  const a = r.show.music.annotations.find((x) => x.label === 'midnight')
  expect(a).toBeDefined()
  expect(a!.strength).toBe(1)
  return a!.time
}

const digitsOf = (r: BuildResult): CompiledCue[] =>
  r.compiled.cues
    .filter((c) => c.id.startsWith('nye-cd-'))
    .sort((a, b) => (a.id < b.id ? -1 : 1))

describe('nye programs', () => {
  it('nye() builds clean (zero error diagnostics) with the full arc', () => {
    expect(std.compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(std.show.meta.variant).toBe('standard')
    expect(std.show.meta.seed).toBe(20260101)
    expect(std.show.preRollSec).toBe(6)
    expect(std.show.noiseBudget).toBeUndefined()
    expect(std.compiled.cues.length).toBeGreaterThanOrEqual(100)
  })

  it('nyeQuiet() builds clean with variant quiet and an 85 dB budget', () => {
    expect(qt.compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(qt.show.meta.variant).toBe('quiet')
    expect(qt.show.noiseBudget).toEqual({ maxSplDb: 85 })
  })

  it('both variants are deterministic (JSON-identical on rebuild)', () => {
    const std2 = nye()
    const qt2 = nyeQuiet()
    expect(JSON.stringify(std2.show)).toBe(JSON.stringify(std.show))
    expect(JSON.stringify(std2.compiled)).toBe(JSON.stringify(std.compiled))
    expect(JSON.stringify(qt2.show)).toBe(JSON.stringify(qt.show))
    expect(JSON.stringify(qt2.compiled)).toBe(JSON.stringify(qt.compiled))
  })

  it('countdown: 10 digit cues 9…0, each landing exactly on a downbeat', () => {
    for (const r of [std, qt]) {
      const tl = r.show.music
      const midnightT = midnightOf(r)
      const digits = digitsOf(r)
      expect(digits.length).toBe(10)
      expect(digits.map((c) => c.params?.['text'])).toEqual([
        '9', '8', '7', '6', '5', '4', '3', '2', '1', '0',
      ])
      expect(digits.every((c) => c.effectId === 'digit-formation-100')).toBe(true)
      // Each digit lands within 1e-9 of a downbeat, in ascending time order.
      let prev = -Infinity
      for (const c of digits) {
        const nearest = tl.downbeats.reduce(
          (best, t) => (Math.abs(t - c.targetSec) < Math.abs(best - c.targetSec) ? t : best),
          Infinity,
        )
        expect(Math.abs(c.targetSec - nearest)).toBeLessThan(1e-9)
        expect(c.targetSec).toBeGreaterThan(prev)
        prev = c.targetSec
      }
      // Digit 0 sits exactly on the last downbeat before midnight.
      const lastBefore = tl.downbeats.filter((t) => t < midnightT).at(-1)!
      expect(Math.abs(digits[9]!.targetSec - lastBefore)).toBeLessThan(1e-9)
    }
  })

  it('crowd digit pulses shadow the drone countdown (same targetSec, gold, mast-east)', () => {
    for (const r of [std, qt]) {
      const digits = digitsOf(r)
      const pulses = r.compiled.cues
        .filter((c) => c.id.startsWith('nye-cdp-'))
        .sort((a, b) => a.targetSec - b.targetSec)
      expect(pulses).toHaveLength(10)
      pulses.forEach((p, i) => {
        expect(p.medium).toBe('crowd')
        expect(p.effectId).toBe('crowd-pulse-radial')
        expect(p.positionId).toBe('mast-east')
        // Each pulse shares its landing instant with the matching drone digit.
        expect(Math.abs(p.targetSec - digits[i]!.targetSec)).toBeLessThan(1e-9)
      })
    }
  })

  it("midnight crowd: the '2027' marquee and the white flood land ON the midnight annotation", () => {
    for (const r of [std, qt]) {
      const midnightT = midnightOf(r)
      const text = r.compiled.cues.find((c) => c.id === 'nye-2027-000')
      expect(text).toBeDefined()
      expect(text!.medium).toBe('crowd')
      expect(text!.effectId).toBe('crowd-text-marquee')
      expect(text!.positionId).toBe('mast-west')
      expect(text!.params?.['text']).toBe('2027')
      expect(Math.abs(text!.targetSec - midnightT)).toBeLessThan(1e-9)
      const flood = r.compiled.cues.find((c) => c.id === 'nye-midnight-flood')
      expect(flood).toBeDefined()
      expect(flood!.medium).toBe('crowd')
      expect(flood!.effectId).toBe('crowd-flood-rgb')
      expect(flood!.positionId).toBe('mast-east')
      expect(Math.abs(flood!.targetSec - midnightT)).toBeLessThan(1e-9)
    }
  })

  it('whisper count-in: one 10 s beam cue from beam-delay-west runs the last digits into midnight', () => {
    for (const r of [std, qt]) {
      const midnightT = midnightOf(r)
      const beams = r.compiled.cues.filter((c) => c.medium === 'beam')
      expect(beams).toHaveLength(1)
      const count = beams[0]!
      expect(count.id).toBe('nye-count-000')
      expect(count.effectId).toBe('beam-whisper-count')
      expect(count.positionId).toBe('beam-delay-west')
      expect(count.durationSec).toBe(10)
      // Lands on the third-to-last downbeat before midnight, so the 10 s
      // window covers the final three bars — digit 0's landing included.
      const before = r.show.music.downbeats.filter((t) => t < midnightT)
      expect(Math.abs(count.targetSec - before.at(-3)!)).toBeLessThan(1e-9)
      const digit0 = digitsOf(r)[9]!
      expect(digit0.targetSec).toBeGreaterThan(count.targetSec)
      expect(digit0.targetSec).toBeLessThan(count.targetSec + count.durationSec)
    }
  })

  it('midnight barrage: the final (largest) cue lands ON the midnight annotation', () => {
    for (const r of [std, qt]) {
      const midnightT = midnightOf(r)
      const barrage = r.compiled.cues
        .filter((c) => c.id.startsWith('nye-mid-'))
        .sort((a, b) => a.targetSec - b.targetSec)
      expect(barrage.length).toBeGreaterThanOrEqual(30)
      const last = barrage.at(-1)!
      expect(Math.abs(last.targetSec - midnightT)).toBeLessThan(1e-9)
      // Calibers ramp small → large; the peak cue carries the pool's largest.
      expect(last.effectId).toBe(r === std ? 'brocade-200-gold' : 'crossette-75-silver')
    }
  })

  it("drones spell '2027' in both variants", () => {
    for (const r of [std, qt]) {
      const text = r.compiled.cues.find(
        (c) => c.medium === 'drone' && c.params?.['text'] === '2027',
      )
      expect(text).toBeDefined()
      expect(text!.effectId).toBe('text-formation-150')
      expect(text!.targetSec).toBeGreaterThan(midnightOf(r))
    }
  })

  it('quiet: no authored effect exceeds 100 dB at the reference distance', () => {
    for (const track of qt.show.tracks) {
      for (const cue of track.cues) {
        const effect = catalog.find(cue.effectId)!
        expect(effect.noiseDbAt15m).toBeLessThanOrEqual(100)
      }
    }
  })

  it('quiet: headless sim peak SPL stays within the 85 dB budget', { timeout: 60_000 }, () => {
    const { stats } = runHeadless(qt.compiled)
    expect(Math.max(...stats.splPeakByListener)).toBeLessThanOrEqual(85)
  })

  it('standard exceeds 85 dB at the audience (negative control)', { timeout: 60_000 }, () => {
    const { stats } = runHeadless(std.compiled)
    expect(Math.max(...stats.splPeakByListener)).toBeGreaterThan(85)
  })

  it('first 12 compiled cues match the snapshot', () => {
    const head = std.compiled.cues.slice(0, 12).map((c) => ({
      id: c.id,
      effectId: c.effectId,
      positionId: c.positionId,
      fireSec: Number(c.fireSec.toFixed(3)),
      targetSec: Number(c.targetSec.toFixed(3)),
    }))
    expect(head).toMatchSnapshot()
  })
})
