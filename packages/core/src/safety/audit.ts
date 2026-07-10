/**
 * safety/audit.ts — append-only, hash-chained audit log.
 *
 * Every safety-machine transition (including REFUSED attempts) is appended
 * here. Each entry's hash covers the previous entry's hash, so any edit,
 * deletion, or reorder of a serialized log breaks `verifyChain()` at the
 * tampered index.
 *
 * TAMPER-EVIDENCE, NOT CRYPTOGRAPHY: the chain uses FNV-1a 32-bit — enough to
 * catch accidental or casual mutation of an operations record, documented as
 * such. hash = hex8(fnv1a32(prevHash + canonicalJson(entry-without-hash))),
 * genesis prevHash = '00000000'.
 */

import { fnv1a32 } from '../math/index.js'
import type { SitePlan } from '../contracts.js'
import type { SafetyState } from './states.js'
import type { InterlockResult } from './interlocks.js'

/** prevHash of the first entry in every chain. */
export const GENESIS_HASH = '00000000'

/** Lower-case zero-padded 8-hex-digit rendering of a uint32. */
export function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0')
}

/**
 * Canonical JSON: object keys sorted, `undefined` properties omitted, no
 * whitespace. Two structurally-equal values always serialize identically, so
 * hashes are stable across key-insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value)
    return s === undefined ? 'null' : s
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

export interface AuditEntry {
  /** 0-based position in the chain. */
  seq: number
  /** Caller-supplied clock reading (ms); core never touches Date. */
  tMs: number
  from: SafetyState
  to: SafetyState
  actor: string
  /** Refused transitions carry reason 'REFUSED: …' and have to === from. */
  reason: string
  interlocks?: readonly InterlockResult[]
  prevHash: string
  hash: string
}

/** Compute the chain hash for an entry (everything but `hash` itself). */
export function entryHash(entry: Omit<AuditEntry, 'hash'>): string {
  return hex8(fnv1a32(entry.prevHash + canonicalJson(entry)))
}

/**
 * Verify an entry sequence as a chain: seq must count from 0, prevHash must
 * link (genesis '00000000'), and each hash must recompute. Returns the index
 * of the first bad entry.
 */
export function verifyEntries(entries: readonly AuditEntry[]): { ok: boolean; brokenAt?: number } {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const expectedPrev = i === 0 ? GENESIS_HASH : entries[i - 1].hash
    if (e.seq !== i || e.prevHash !== expectedPrev) return { ok: false, brokenAt: i }
    const { hash, ...body } = e
    if (entryHash(body) !== hash) return { ok: false, brokenAt: i }
  }
  return { ok: true }
}

function frozenCopy(e: AuditEntry): AuditEntry {
  const copy: AuditEntry = { ...e }
  if (e.interlocks !== undefined) {
    copy.interlocks = Object.freeze(e.interlocks.map((r) => Object.freeze({ ...r })))
  }
  return Object.freeze(copy)
}

/**
 * Append-only audit log. There is deliberately no delete/mutate API, and
 * `entries()` hands out frozen copies so callers cannot reach the chain.
 */
export class AuditLog {
  private readonly chain: AuditEntry[] = []

  /** Append one entry; seq/prevHash/hash are computed here. Returns a frozen copy. */
  append(e: Omit<AuditEntry, 'seq' | 'prevHash' | 'hash'>): AuditEntry {
    const seq = this.chain.length
    const prevHash = seq === 0 ? GENESIS_HASH : this.chain[seq - 1].hash
    const body: Omit<AuditEntry, 'hash'> = {
      seq,
      tMs: e.tMs,
      from: e.from,
      to: e.to,
      actor: e.actor,
      reason: e.reason,
      ...(e.interlocks !== undefined ? { interlocks: e.interlocks.map((r) => ({ ...r })) } : {}),
      prevHash,
    }
    const entry: AuditEntry = { ...body, hash: entryHash(body) }
    this.chain.push(entry)
    return frozenCopy(entry)
  }

  /** Frozen copies of every entry, in chain order. */
  entries(): readonly AuditEntry[] {
    return Object.freeze(this.chain.map(frozenCopy))
  }

  verifyChain(): { ok: boolean; brokenAt?: number } {
    return verifyEntries(this.chain)
  }

  /** One canonical-JSON entry per line (trailing newline; empty log → ''). */
  toJsonLines(): string {
    if (this.chain.length === 0) return ''
    return this.chain.map((e) => canonicalJson(e)).join('\n') + '\n'
  }

  /**
   * Rebuild a log from JSONL and re-verify the chain; throws if any entry was
   * tampered with (message names the broken index). CLI round-trip path.
   */
  static fromJsonLines(text: string): AuditLog {
    const log = new AuditLog()
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length === 0) continue
      log.chain.push(JSON.parse(line) as AuditEntry)
    }
    const check = verifyEntries(log.chain)
    if (!check.ok) {
      throw new Error(`audit log rejected: hash chain broken at entry ${check.brokenAt}`)
    }
    return log
  }
}

/**
 * Stable hash of a site plan — hex8(fnv1a32(canonicalJson(site))). Recorded by
 * site validation and recomputed at arm time; a mismatch means the site was
 * edited after validation (staleness interlock).
 */
export function siteHash(site: SitePlan): string {
  return hex8(fnv1a32(canonicalJson(site)))
}
