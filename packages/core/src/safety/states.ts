/**
 * safety/states.ts — safety state union, legal-transition table, guards.
 *
 * The machine is a strict four-state automaton:
 *
 *   DISARMED ──arm──▶ ARMED ──goLive──▶ LIVE
 *      ▲                │ ▲               │
 *      └────disarm──────┘ └──standDown────┘
 *
 *   every state ──eStop──▶ ESTOPPED ──reset──▶ DISARMED
 *
 * ESTOPPED latches: the ONLY exit is an explicit reset(). The table below is
 * the single source of truth; `SafetyMachine` refuses (and audits) anything
 * not listed here.
 */

export type SafetyState = 'DISARMED' | 'ARMED' | 'LIVE' | 'ESTOPPED'

/** All states, in escalation order. */
export const SAFETY_STATES: readonly SafetyState[] = Object.freeze([
  'DISARMED',
  'ARMED',
  'LIVE',
  'ESTOPPED',
])

/**
 * Legal target states per source state.
 * LIVE → ARMED is the stand-down path; ESTOPPED lists only DISARMED, and that
 * edge is reserved for reset() — no other mutator may take it.
 */
export const TRANSITIONS: Record<SafetyState, readonly SafetyState[]> = Object.freeze({
  DISARMED: Object.freeze(['ARMED', 'ESTOPPED'] as SafetyState[]),
  ARMED: Object.freeze(['LIVE', 'DISARMED', 'ESTOPPED'] as SafetyState[]),
  LIVE: Object.freeze(['ARMED', 'ESTOPPED'] as SafetyState[]),
  ESTOPPED: Object.freeze(['DISARMED'] as SafetyState[]),
})

/** True iff `from → to` appears in the TRANSITIONS table. */
export function canTransition(from: SafetyState, to: SafetyState): boolean {
  return TRANSITIONS[from].includes(to)
}
