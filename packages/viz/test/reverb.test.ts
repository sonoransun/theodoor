/**
 * The lakeside impulse response (audio/reverb.ts): seeded, deterministic,
 * with the documented RT60 decay and the treeline slapback at the right
 * sample. Pure Float32Array math — no ConvolverNode needed.
 */
import { describe, expect, it } from 'vitest'
import { SPEED_OF_SOUND_MPS } from '@theodoor/core'
import {
  REVERB_IR_SEC,
  REVERB_PREDELAY_SEC,
  REVERB_RT60_SEC,
  REVERB_SLAPBACK_GAIN,
  REVERB_TREELINE_M,
  impulseResponse,
  rms,
  slapbackDelaySec,
  stereoImpulseResponse,
} from '../src/audio/reverb.js'
import {
  MASTER_LIMIT_RATIO,
  MASTER_LIMIT_THRESHOLD_DB,
} from '../src/audio/mixBus.js'

const SR = 48_000

describe('impulseResponse', () => {
  const ir = impulseResponse(SR)

  it('is REVERB_IR_SEC long and deterministic for a seed', () => {
    expect(ir.length).toBe(Math.round(REVERB_IR_SEC * SR))
    const again = impulseResponse(SR)
    expect(again.length).toBe(ir.length)
    for (let i = 0; i < ir.length; i += 997) expect(again[i]).toBe(ir[i])
    const other = impulseResponse(SR, { seed: 7 })
    expect(other.some((v, i) => v !== ir[i])).toBe(true)
  })

  it('is silent through the pre-delay, then decays ~60 dB by RT60', () => {
    const pre = Math.round(REVERB_PREDELAY_SEC * SR)
    for (let i = 0; i < pre; i++) expect(ir[i]).toBe(0)
    const win = 2048
    const early = rms(ir, pre, pre + win)
    const late = rms(ir, pre + Math.round(REVERB_RT60_SEC * SR) - win, pre + Math.round(REVERB_RT60_SEC * SR))
    const dropDb = 20 * Math.log10(late / early)
    // The window straddles the decay; expect −60 dB within a few dB.
    expect(dropDb).toBeLessThan(-54)
    expect(dropDb).toBeGreaterThan(-68)
  })

  it('puts the treeline slapback at 2·60 m / 343 m/s ≈ 0.35 s', () => {
    const delay = slapbackDelaySec()
    expect(delay).toBeCloseTo((2 * REVERB_TREELINE_M) / SPEED_OF_SOUND_MPS, 12)
    expect(delay).toBeGreaterThan(0.3)
    expect(delay).toBeLessThan(0.4)
    const idx = Math.round(delay * SR)
    // The slapback impulse dominates the (already decayed) tail at that sample.
    expect(Math.abs(ir[idx]!)).toBeGreaterThan(REVERB_SLAPBACK_GAIN * 0.8)
    expect(Math.abs(ir[idx - 50]!)).toBeLessThan(REVERB_SLAPBACK_GAIN * 0.8)
  })

  it('stereo channels share the slapback but decorrelate the tail', () => {
    const [l, r] = stereoImpulseResponse(SR)
    expect(l.length).toBe(r.length)
    const idx = Math.round(slapbackDelaySec() * SR)
    expect(Math.sign(l[idx]!)).toBe(Math.sign(r[idx]!))
    let same = 0
    for (let i = 2000; i < 6000; i++) if (l[i] === r[i]) same++
    expect(same).toBeLessThan(10)
  })
})

describe('master limiter settings', () => {
  it('is a gentle ceiling: −6 dBFS threshold, high ratio', () => {
    expect(MASTER_LIMIT_THRESHOLD_DB).toBe(-6)
    expect(MASTER_LIMIT_RATIO).toBeGreaterThanOrEqual(8)
  })
})
