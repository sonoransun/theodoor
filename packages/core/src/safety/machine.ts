/**
 * safety/machine.ts — the SafetyMachine: arm / goLive / standDown / disarm /
 * eStop / reset, with gate tokens for hardware-facing emission.
 *
 * Rules (see states.ts for the transition table):
 *   - Every mutator checks the TRANSITIONS table AND its own legal source
 *     states. A refused call throws SafetyError AND appends an audit entry
 *     with to === from and reason 'REFUSED: …' — refusals are auditable and
 *     never change state.
 *   - arm() evaluates ALL interlocks and reports every unsatisfied one.
 *   - goLive() demands the exact re-ack phrase 'GO LIVE' and returns a
 *     GateToken stamped with the audit seq and the machine's internal epoch.
 *   - goLive/standDown/eStop bump the epoch, so requireLive() rejects any
 *     token issued before the latest LIVE entry (no replay of a pre-e-stop
 *     go signal).
 *   - ESTOPPED latches; only reset(operator) exits it.
 *
 * The CALLER supplies the clock — core never touches Date.
 */

import { canTransition, type SafetyState } from './states.js'
import {
  evaluateInterlocks,
  type InterlockContext,
  type InterlockResult,
} from './interlocks.js'
import type { AuditEntry, AuditLog } from './audit.js'

/** Exact re-acknowledgement phrase required by goLive(). */
export const GO_LIVE_PHRASE = 'GO LIVE'

/** Thrown on refused transitions, failed interlocks, and stale gate tokens. */
export class SafetyError extends Error {
  /** Present when an arm() was refused by interlocks: every unsatisfied one. */
  readonly unsatisfied?: readonly InterlockResult[]

  constructor(message: string, unsatisfied?: readonly InterlockResult[]) {
    super(message)
    this.name = 'SafetyError'
    if (unsatisfied !== undefined) this.unsatisfied = unsatisfied
  }
}

/** Proof-of-LIVE capability. Invalidated by standDown/eStop (epoch bump). */
export interface GateToken {
  readonly state: 'LIVE'
  /** Audit seq of the GO LIVE entry this token was stamped against. */
  readonly issuedSeq: number
  /** Machine epoch at issue; must still be current for requireLive(). */
  readonly epoch: number
}

/**
 * Hardware-facing sink contract: byte GENERATION is always pure and legal;
 * EMISSION (socket send, firing-script file write) demands a live GateToken.
 */
export interface HardwareSink {
  emit(token: GateToken, bytes: Uint8Array): void
}

export class SafetyMachine {
  private stateValue: SafetyState = 'DISARMED'
  private epoch = 0
  private readonly clock: () => number
  private readonly log: AuditLog

  constructor(clock: () => number, log: AuditLog) {
    this.clock = clock
    this.log = log
  }

  get state(): SafetyState {
    return this.stateValue
  }

  /**
   * DISARMED → ARMED. Evaluates all interlocks; if any are unsatisfied, the
   * attempt is audited as refused and a SafetyError listing EVERY unsatisfied
   * interlock is thrown. Returns the full (all-satisfied) result set.
   */
  arm(ctx: InterlockContext): InterlockResult[] {
    const actor = ctx.operatorAck?.name ?? 'unknown'
    this.guard('ARMED', 'arm', actor, ['DISARMED'])
    const results = evaluateInterlocks(ctx)
    const unsatisfied = results.filter((r) => !r.satisfied)
    if (unsatisfied.length > 0) {
      this.audit(
        this.stateValue,
        actor,
        `REFUSED: interlocks unsatisfied: ${unsatisfied.map((r) => r.id).join(', ')}`,
        results,
      )
      throw new SafetyError(
        `arm refused; unsatisfied interlocks: ${unsatisfied
          .map((r) => `${r.id} (${r.detail})`)
          .join('; ')}`,
        unsatisfied,
      )
    }
    this.audit('ARMED', actor, 'ARM', results)
    this.stateValue = 'ARMED'
    return results
  }

  /**
   * ARMED → LIVE. Requires the exact re-ack phrase 'GO LIVE'. Bumps the epoch
   * and returns a GateToken carrying it.
   */
  goLive(reAck: string): GateToken {
    this.guard('LIVE', 'goLive', 'operator', ['ARMED'])
    if (reAck !== GO_LIVE_PHRASE) {
      this.audit(
        this.stateValue,
        'operator',
        `REFUSED: goLive re-ack phrase mismatch (expected '${GO_LIVE_PHRASE}')`,
      )
      throw new SafetyError(`goLive refused: re-ack phrase must be exactly '${GO_LIVE_PHRASE}'`)
    }
    this.epoch += 1
    const entry = this.audit('LIVE', 'operator', 'GO LIVE')
    this.stateValue = 'LIVE'
    return Object.freeze({ state: 'LIVE' as const, issuedSeq: entry.seq, epoch: this.epoch })
  }

  /** LIVE → ARMED. Invalidates all outstanding gate tokens (epoch bump). */
  standDown(): void {
    this.guard('ARMED', 'standDown', 'operator', ['LIVE'])
    this.epoch += 1
    this.audit('ARMED', 'operator', 'STAND DOWN')
    this.stateValue = 'ARMED'
  }

  /** ARMED → DISARMED. (From LIVE, stand down first.) */
  disarm(): void {
    this.guard('DISARMED', 'disarm', 'operator', ['ARMED'])
    this.audit('DISARMED', 'operator', 'DISARM')
    this.stateValue = 'DISARMED'
  }

  /**
   * → ESTOPPED, legal from EVERY state, latches until reset(). Never throws.
   * Calling it while already latched is audited but changes nothing. Always
   * bumps the epoch so outstanding tokens die immediately.
   */
  eStop(reason: string): void {
    this.epoch += 1
    if (this.stateValue === 'ESTOPPED') {
      this.audit('ESTOPPED', 'operator', `E-STOP: ${reason} (already latched)`)
      return
    }
    this.audit('ESTOPPED', 'operator', `E-STOP: ${reason}`)
    this.stateValue = 'ESTOPPED'
  }

  /** ESTOPPED → DISARMED. The only exit from the e-stop latch. */
  reset(operator: string): void {
    this.guard('DISARMED', 'reset', operator, ['ESTOPPED'])
    this.audit('DISARMED', operator, `RESET by ${operator}`)
    this.stateValue = 'DISARMED'
  }

  /**
   * Gate check for hardware emission: throws unless the machine is LIVE and
   * the token's epoch is current (i.e. issued by the latest goLive with no
   * standDown/eStop since).
   */
  requireLive(token: GateToken): void {
    if (this.stateValue !== 'LIVE') {
      throw new SafetyError(`gate refused: machine is ${this.stateValue}, not LIVE`)
    }
    if (token.epoch !== this.epoch) {
      throw new SafetyError(
        `gate refused: stale token (issued epoch ${token.epoch}, current ${this.epoch})`,
      )
    }
  }

  /**
   * Refuse-or-pass gate common to every mutator: the source state must be in
   * `allowedFrom` AND the edge must be in the TRANSITIONS table. Refusals are
   * audited (to === from, reason 'REFUSED: …') and throw; state is unchanged.
   */
  private guard(
    to: SafetyState,
    op: string,
    actor: string,
    allowedFrom: readonly SafetyState[],
  ): void {
    if (allowedFrom.includes(this.stateValue) && canTransition(this.stateValue, to)) return
    this.audit(this.stateValue, actor, `REFUSED: ${op} from ${this.stateValue} (to ${to})`)
    throw new SafetyError(`${op} refused: illegal transition ${this.stateValue} -> ${to}`)
  }

  /** Append an audit entry stamped with the caller-supplied clock. */
  private audit(
    to: SafetyState,
    actor: string,
    reason: string,
    interlocks?: InterlockResult[],
  ): AuditEntry {
    return this.log.append({
      tMs: this.clock(),
      from: this.stateValue,
      to,
      actor,
      reason,
      ...(interlocks !== undefined ? { interlocks } : {}),
    })
  }
}
