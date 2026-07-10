/**
 * safety/interlocks — the two crowd/beam interlocks added in wave 3:
 * carrier-exposure and broadcast-bandwidth. Both context entries are
 * OPTIONAL, so pre-crowd callers keep compiling AND keep arming: an absent
 * entry evaluates satisfied. evaluateInterlocks stays pure/total (always all
 * five results), and a failing exposure blocks arm — and therefore goLive.
 */

import { describe, expect, it } from 'vitest'
import {
  ARM_ACK_PHRASE,
  AuditLog,
  GO_LIVE_PHRASE,
  SafetyError,
  SafetyMachine,
  evaluateInterlocks,
  type InterlockContext,
  type InterlockResult,
} from '../src/safety/index.js'

function goodCtx(overrides: Partial<InterlockContext> = {}): InterlockContext {
  return {
    siteValidation: { ok: true, siteHash: 'ab12cd34' },
    currentSiteHash: 'ab12cd34',
    windSpeedMps: 4,
    windLimitMps: 9,
    operatorAck: { name: 'alex', phrase: ARM_ACK_PHRASE },
    ...overrides,
  }
}

const byId = (results: InterlockResult[], id: string): InterlockResult => {
  const r = results.find((x) => x.id === id)
  if (!r) throw new Error(`no interlock '${id}'`)
  return r
}

describe('evaluateInterlocks — totality with the new entries', () => {
  it('always returns all five interlocks, in stable order', () => {
    for (const ctx of [
      goodCtx(),
      goodCtx({ exposure: { applicable: true, ok: false } }),
      goodCtx({ broadcastBandwidth: { applicable: true, ok: false } }),
      goodCtx({ operatorAck: null, windSpeedMps: 99 }),
    ]) {
      expect(evaluateInterlocks(ctx).map((r) => r.id)).toEqual([
        'site-validation',
        'wind-limit',
        'operator-ack',
        'carrier-exposure',
        'broadcast-bandwidth',
      ])
    }
  })
})

describe('carrier-exposure matrix', () => {
  it("absent → satisfied with detail 'no beam cues'", () => {
    const r = byId(evaluateInterlocks(goodCtx()), 'carrier-exposure')
    expect(r.satisfied).toBe(true)
    expect(r.detail).toBe('no beam cues')
  })

  it('applicable=false → satisfied regardless of ok', () => {
    const r = byId(
      evaluateInterlocks(goodCtx({ exposure: { applicable: false, ok: false } })),
      'carrier-exposure',
    )
    expect(r.satisfied).toBe(true)
    expect(r.detail).toContain('not applicable')
  })

  it('applicable && ok (fresh omitted or true) → satisfied', () => {
    for (const exposure of [
      { applicable: true, ok: true },
      { applicable: true, ok: true, fresh: true },
    ]) {
      const r = byId(evaluateInterlocks(goodCtx({ exposure })), 'carrier-exposure')
      expect(r.satisfied).toBe(true)
      expect(r.detail).toContain('satisfied')
    }
  })

  it('applicable && !ok → unsatisfied (budget violated)', () => {
    const r = byId(
      evaluateInterlocks(goodCtx({ exposure: { applicable: true, ok: false } })),
      'carrier-exposure',
    )
    expect(r.satisfied).toBe(false)
    expect(r.detail).toContain('violated')
  })

  it('applicable && ok but fresh=false → unsatisfied (stale report)', () => {
    const r = byId(
      evaluateInterlocks(goodCtx({ exposure: { applicable: true, ok: true, fresh: false } })),
      'carrier-exposure',
    )
    expect(r.satisfied).toBe(false)
    expect(r.detail).toContain('stale')
  })
})

describe('broadcast-bandwidth matrix', () => {
  it("absent → satisfied with detail 'no crowd cues'", () => {
    const r = byId(evaluateInterlocks(goodCtx()), 'broadcast-bandwidth')
    expect(r.satisfied).toBe(true)
    expect(r.detail).toBe('no crowd cues')
  })

  it('applicable=false → satisfied regardless of ok', () => {
    const r = byId(
      evaluateInterlocks(goodCtx({ broadcastBandwidth: { applicable: false, ok: false } })),
      'broadcast-bandwidth',
    )
    expect(r.satisfied).toBe(true)
    expect(r.detail).toContain('not applicable')
  })

  it('applicable && ok → satisfied', () => {
    const r = byId(
      evaluateInterlocks(goodCtx({ broadcastBandwidth: { applicable: true, ok: true } })),
      'broadcast-bandwidth',
    )
    expect(r.satisfied).toBe(true)
    expect(r.detail).toContain('within')
  })

  it('applicable && !ok → unsatisfied naming CROWD_BANDWIDTH', () => {
    const r = byId(
      evaluateInterlocks(goodCtx({ broadcastBandwidth: { applicable: true, ok: false } })),
      'broadcast-bandwidth',
    )
    expect(r.satisfied).toBe(false)
    expect(r.detail).toContain('CROWD_BANDWIDTH')
  })
})

describe('machine integration — a failing exposure blocks arm and goLive', () => {
  it('arm refuses, lists carrier-exposure, audits, and goLive stays refused', () => {
    const log = new AuditLog()
    const m = new SafetyMachine(() => 1000, log)
    const bad = goodCtx({ exposure: { applicable: true, ok: false } })

    let caught: SafetyError | undefined
    try {
      m.arm(bad)
    } catch (e) {
      caught = e as SafetyError
    }
    expect(caught).toBeInstanceOf(SafetyError)
    expect(caught!.unsatisfied!.map((r) => r.id)).toEqual(['carrier-exposure'])
    expect(m.state).toBe('DISARMED')

    const refusal = log.entries().at(-1)!
    expect(refusal.reason).toBe('REFUSED: interlocks unsatisfied: carrier-exposure')
    expect(refusal.interlocks!.length).toBe(5) // full result set recorded

    // Never armed → the goLive path is refused too (and audited).
    expect(() => m.goLive(GO_LIVE_PHRASE)).toThrow(SafetyError)
    expect(m.state).toBe('DISARMED')
    expect(log.entries().at(-1)!.reason).toMatch(/^REFUSED: goLive/)
    expect(log.verifyChain().ok).toBe(true)
  })

  it('both new interlocks failing are reported together', () => {
    const m = new SafetyMachine(() => 0, new AuditLog())
    try {
      m.arm(
        goodCtx({
          exposure: { applicable: true, ok: true, fresh: false },
          broadcastBandwidth: { applicable: true, ok: false },
        }),
      )
      expect.unreachable('arm must refuse')
    } catch (e) {
      expect((e as SafetyError).unsatisfied!.map((r) => r.id)).toEqual([
        'carrier-exposure',
        'broadcast-bandwidth',
      ])
    }
  })

  it('satisfied new interlocks arm and go live normally', () => {
    const m = new SafetyMachine(() => 0, new AuditLog())
    const results = m.arm(
      goodCtx({
        exposure: { applicable: true, ok: true, fresh: true },
        broadcastBandwidth: { applicable: true, ok: true },
      }),
    )
    expect(results).toHaveLength(5)
    expect(results.every((r) => r.satisfied)).toBe(true)
    const token = m.goLive(GO_LIVE_PHRASE)
    expect(() => m.requireLive(token)).not.toThrow()
  })
})
