/**
 * safety/ — safety state machine, interlocks, and hash-chained audit log.
 *
 * Public API:
 *   states:     SafetyState, SAFETY_STATES, TRANSITIONS, canTransition
 *   interlocks: ARM_ACK_PHRASE, InterlockContext, InterlockResult,
 *               evaluateInterlocks
 *   machine:    SafetyMachine, SafetyError, GateToken, HardwareSink,
 *               GO_LIVE_PHRASE
 *   audit:      AuditLog, AuditEntry, GENESIS_HASH, entryHash, verifyEntries,
 *               canonicalJson, hex8, siteHash
 */

export * from './states.js'
export * from './interlocks.js'
export * from './machine.js'
export * from './audit.js'
