import { describe, expect, it } from 'vitest'
import {
  ARM_ACK_PHRASE,
  AuditLog,
  canTransition,
  evaluateInterlocks,
  GO_LIVE_PHRASE,
  SafetyError,
  SafetyMachine,
  TRANSITIONS,
  type InterlockContext,
  type SafetyState,
} from '../src/safety/index.js'

const STATES: readonly SafetyState[] = ['DISARMED', 'ARMED', 'LIVE', 'ESTOPPED']

function makeClock(start = 1_000): () => number {
  let t = start
  return () => t++
}

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

function machineIn(state: SafetyState): { m: SafetyMachine; log: AuditLog } {
  const log = new AuditLog()
  const m = new SafetyMachine(makeClock(), log)
  if (state === 'ARMED' || state === 'LIVE') m.arm(goodCtx())
  if (state === 'LIVE') m.goLive(GO_LIVE_PHRASE)
  if (state === 'ESTOPPED') m.eStop('drive-to-state')
  return { m, log }
}

describe('states: TRANSITIONS table', () => {
  // The full 4x4 matrix, table level.
  const legal = new Set([
    'DISARMED>ARMED',
    'DISARMED>ESTOPPED',
    'ARMED>LIVE',
    'ARMED>DISARMED',
    'ARMED>ESTOPPED',
    'LIVE>ARMED',
    'LIVE>ESTOPPED',
    'ESTOPPED>DISARMED',
  ])

  for (const from of STATES) {
    for (const to of STATES) {
      it(`canTransition(${from}, ${to}) = ${legal.has(`${from}>${to}`)}`, () => {
        expect(canTransition(from, to)).toBe(legal.has(`${from}>${to}`))
      })
    }
  }

  it('table is frozen', () => {
    expect(Object.isFrozen(TRANSITIONS)).toBe(true)
    expect(Object.isFrozen(TRANSITIONS.ARMED)).toBe(true)
  })
})

describe('machine: full transition matrix via mutators', () => {
  // Each mutator, its target state, and the states it legally fires from.
  const mutators: {
    name: string
    target: SafetyState
    call: (m: SafetyMachine) => void
    legalFrom: readonly SafetyState[]
  }[] = [
    { name: 'arm', target: 'ARMED', call: (m) => m.arm(goodCtx()), legalFrom: ['DISARMED'] },
    { name: 'goLive', target: 'LIVE', call: (m) => m.goLive(GO_LIVE_PHRASE), legalFrom: ['ARMED'] },
    { name: 'standDown', target: 'ARMED', call: (m) => m.standDown(), legalFrom: ['LIVE'] },
    { name: 'disarm', target: 'DISARMED', call: (m) => m.disarm(), legalFrom: ['ARMED'] },
    { name: 'reset', target: 'DISARMED', call: (m) => m.reset('alex'), legalFrom: ['ESTOPPED'] },
  ]

  for (const from of STATES) {
    for (const mut of mutators) {
      const shouldPass = mut.legalFrom.includes(from)
      it(`${mut.name} from ${from} ${shouldPass ? 'succeeds' : 'is refused and audited'}`, () => {
        const { m, log } = machineIn(from)
        const before = log.entries().length
        if (shouldPass) {
          mut.call(m)
          expect(m.state).toBe(mut.target)
          const last = log.entries().at(-1)!
          expect(last.from).toBe(from)
          expect(last.to).toBe(mut.target)
          expect(last.reason.startsWith('REFUSED')).toBe(false)
        } else {
          expect(() => mut.call(m)).toThrow(SafetyError)
          expect(m.state).toBe(from) // refusal does not change state
          const entries = log.entries()
          expect(entries.length).toBe(before + 1) // refusal IS audited
          const last = entries.at(-1)!
          expect(last.reason.startsWith('REFUSED: ')).toBe(true)
          expect(last.from).toBe(from)
          expect(last.to).toBe(from) // refused entries have to === from
        }
        expect(log.verifyChain().ok).toBe(true)
      })
    }

    it(`eStop from ${from} always lands in ESTOPPED without throwing`, () => {
      const { m, log } = machineIn(from)
      m.eStop('matrix check')
      expect(m.state).toBe('ESTOPPED')
      const last = log.entries().at(-1)!
      expect(last.to).toBe('ESTOPPED')
      expect(last.reason).toContain('E-STOP: matrix check')
      expect(last.reason.startsWith('REFUSED')).toBe(false)
    })
  }

  it('only reset exits ESTOPPED — disarm is refused even though the table has ESTOPPED->DISARMED', () => {
    const { m, log } = machineIn('ESTOPPED')
    expect(() => m.disarm()).toThrow(SafetyError)
    expect(m.state).toBe('ESTOPPED')
    expect(log.entries().at(-1)!.reason).toMatch(/^REFUSED: disarm/)
    m.reset('alex')
    expect(m.state).toBe('DISARMED')
  })
})

describe('e-stop latch', () => {
  for (const from of STATES) {
    it(`latches from ${from} until reset`, () => {
      const { m } = machineIn(from)
      m.eStop('smoke in rack area')
      expect(m.state).toBe('ESTOPPED')
      expect(() => m.arm(goodCtx())).toThrow(SafetyError)
      expect(() => m.goLive(GO_LIVE_PHRASE)).toThrow(SafetyError)
      expect(() => m.standDown()).toThrow(SafetyError)
      expect(() => m.disarm()).toThrow(SafetyError)
      expect(m.state).toBe('ESTOPPED')
      m.reset('alex')
      expect(m.state).toBe('DISARMED')
      m.arm(goodCtx()) // fully operational again after reset
      expect(m.state).toBe('ARMED')
    })
  }

  it('eStop while already latched is audited and stays latched', () => {
    const { m, log } = machineIn('ESTOPPED')
    const before = log.entries().length
    expect(() => m.eStop('second press')).not.toThrow()
    expect(m.state).toBe('ESTOPPED')
    const last = log.entries().at(-1)!
    expect(log.entries().length).toBe(before + 1)
    expect(last.from).toBe('ESTOPPED')
    expect(last.to).toBe('ESTOPPED')
    expect(last.reason).toContain('already latched')
  })
})

describe('interlocks', () => {
  it('all satisfied on a good context (5 results)', () => {
    const results = evaluateInterlocks(goodCtx())
    expect(results.map((r) => r.id)).toEqual([
      'site-validation',
      'wind-limit',
      'operator-ack',
      'carrier-exposure',
      'broadcast-bandwidth',
    ])
    expect(results.every((r) => r.satisfied)).toBe(true)
  })

  it('wind at the limit is unsatisfied; just under is satisfied', () => {
    const at = evaluateInterlocks(goodCtx({ windSpeedMps: 9, windLimitMps: 9 }))
    expect(at.find((r) => r.id === 'wind-limit')!.satisfied).toBe(false)
    const under = evaluateInterlocks(goodCtx({ windSpeedMps: 8.99, windLimitMps: 9 }))
    expect(under.find((r) => r.id === 'wind-limit')!.satisfied).toBe(true)
  })

  it('stale site hash is unsatisfied and names both hashes', () => {
    const results = evaluateInterlocks(goodCtx({ currentSiteHash: 'deadbeef' }))
    const site = results.find((r) => r.id === 'site-validation')!
    expect(site.satisfied).toBe(false)
    expect(site.detail).toContain('ab12cd34')
    expect(site.detail).toContain('deadbeef')
  })

  it('failed validation, missing ack, and wrong phrase are each unsatisfied', () => {
    expect(
      evaluateInterlocks(goodCtx({ siteValidation: { ok: false, siteHash: 'ab12cd34' } })).find(
        (r) => r.id === 'site-validation',
      )!.satisfied,
    ).toBe(false)
    expect(
      evaluateInterlocks(goodCtx({ operatorAck: null })).find((r) => r.id === 'operator-ack')!
        .satisfied,
    ).toBe(false)
    expect(
      evaluateInterlocks(goodCtx({ operatorAck: { name: 'alex', phrase: 'arm confirmed' } })).find(
        (r) => r.id === 'operator-ack',
      )!.satisfied,
    ).toBe(false)
  })

  it('arm with 2 failing interlocks lists BOTH in the error and the audit entry', () => {
    const { m, log } = machineIn('DISARMED')
    const bad = goodCtx({
      windSpeedMps: 12, // over limit
      operatorAck: { name: 'alex', phrase: 'yes go' }, // wrong phrase
    })
    let caught: SafetyError | undefined
    try {
      m.arm(bad)
    } catch (e) {
      caught = e as SafetyError
    }
    expect(caught).toBeInstanceOf(SafetyError)
    expect(caught!.message).toContain('wind-limit')
    expect(caught!.message).toContain('operator-ack')
    expect(caught!.unsatisfied!.map((r) => r.id)).toEqual(['wind-limit', 'operator-ack'])
    expect(m.state).toBe('DISARMED')

    const last = log.entries().at(-1)!
    expect(last.reason).toBe('REFUSED: interlocks unsatisfied: wind-limit, operator-ack')
    expect(last.to).toBe('DISARMED')
    expect(last.interlocks!.length).toBe(5) // full result set recorded
    expect(last.interlocks!.filter((r) => !r.satisfied).length).toBe(2)
  })

  it('successful arm returns and audits the full satisfied result set', () => {
    const { m, log } = machineIn('DISARMED')
    const results = m.arm(goodCtx())
    expect(results.length).toBe(5)
    expect(results.every((r) => r.satisfied)).toBe(true)
    const last = log.entries().at(-1)!
    expect(last.reason).toBe('ARM')
    expect(last.actor).toBe('alex')
    expect(last.interlocks!.length).toBe(5)
  })
})

describe('goLive and gate tokens', () => {
  it('requires the exact re-ack phrase', () => {
    const { m, log } = machineIn('ARMED')
    expect(() => m.goLive('go live')).toThrow(SafetyError)
    expect(m.state).toBe('ARMED')
    expect(log.entries().at(-1)!.reason).toMatch(/^REFUSED: goLive re-ack phrase mismatch/)
    const token = m.goLive('GO LIVE')
    expect(m.state).toBe('LIVE')
    expect(token.state).toBe('LIVE')
    expect(Object.isFrozen(token)).toBe(true)
  })

  it('token stamps the seq of its GO LIVE audit entry', () => {
    const { m, log } = machineIn('ARMED')
    const token = m.goLive(GO_LIVE_PHRASE)
    const live = log.entries().at(-1)!
    expect(live.reason).toBe('GO LIVE')
    expect(token.issuedSeq).toBe(live.seq)
  })

  it('requireLive passes for a current token and throws when not LIVE', () => {
    const { m } = machineIn('ARMED')
    const token = m.goLive(GO_LIVE_PHRASE)
    expect(() => m.requireLive(token)).not.toThrow()
    m.standDown()
    expect(() => m.requireLive(token)).toThrow(/not LIVE/)
  })

  it('token from before an e-stop is rejected after reset + re-arm + re-live (epoch bump)', () => {
    const { m } = machineIn('ARMED')
    const oldToken = m.goLive(GO_LIVE_PHRASE)
    m.requireLive(oldToken) // valid while this LIVE epoch holds
    m.eStop('anomaly on pad 3')
    expect(() => m.requireLive(oldToken)).toThrow(SafetyError) // not LIVE
    m.reset('alex')
    m.arm(goodCtx())
    const newToken = m.goLive(GO_LIVE_PHRASE)
    expect(() => m.requireLive(newToken)).not.toThrow()
    // Machine is LIVE again, but the pre-e-stop token must stay dead.
    expect(() => m.requireLive(oldToken)).toThrow(/stale token/)
  })

  it('stand-down also invalidates tokens across a re-live', () => {
    const { m } = machineIn('ARMED')
    const t1 = m.goLive(GO_LIVE_PHRASE)
    m.standDown()
    const t2 = m.goLive(GO_LIVE_PHRASE)
    expect(() => m.requireLive(t2)).not.toThrow()
    expect(() => m.requireLive(t1)).toThrow(/stale token/)
  })
})

describe('machine audit integration', () => {
  it('uses the caller-supplied clock for tMs and keeps a verifiable chain', () => {
    const log = new AuditLog()
    const m = new SafetyMachine(makeClock(5_000), log)
    m.arm(goodCtx())
    m.goLive(GO_LIVE_PHRASE)
    m.standDown()
    m.disarm()
    m.eStop('end of test')
    m.reset('alex')
    const entries = log.entries()
    expect(entries.map((e) => e.tMs)).toEqual([5000, 5001, 5002, 5003, 5004, 5005])
    expect(entries.map((e) => `${e.from}>${e.to}`)).toEqual([
      'DISARMED>ARMED',
      'ARMED>LIVE',
      'LIVE>ARMED',
      'ARMED>DISARMED',
      'DISARMED>ESTOPPED',
      'ESTOPPED>DISARMED',
    ])
    expect(log.verifyChain()).toEqual({ ok: true })
  })
})
