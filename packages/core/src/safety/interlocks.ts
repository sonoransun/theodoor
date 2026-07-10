/**
 * safety/interlocks.ts — pure arm-time interlock evaluation.
 *
 * Five interlocks gate DISARMED → ARMED:
 *   1. site-validation — the last validation run passed AND its site hash
 *      matches the hash of the site plan as it stands now (staleness guard:
 *      editing the site after validating invalidates the validation).
 *   2. wind-limit — measured wind speed strictly under the site limit.
 *   3. operator-ack — a named operator typed the exact phrase 'ARM CONFIRMED'.
 *   4. carrier-exposure — the carrier-exposure report of a beam show passed
 *      and is fresh. OPTIONAL context: shows without beam cues simply omit
 *      it and the interlock reports satisfied ('no beam cues').
 *   5. broadcast-bandwidth — no error-severity CROWD_BANDWIDTH diagnostics.
 *      OPTIONAL context: shows without crowd cues omit it (satisfied).
 *
 * `evaluateInterlocks` is pure and total: it always returns ALL results so a
 * refused arm can report every unsatisfied interlock at once, not just the
 * first.
 */

/** Exact acknowledgement phrase required to arm. */
export const ARM_ACK_PHRASE = 'ARM CONFIRMED'

/** Carrier-exposure interlock input (beam shows). */
export interface ExposureInterlockInput {
  /** True when the show has beam cues, i.e. the exposure budget applies. */
  applicable: boolean
  /** True when the carrier-exposure report passed the budget. */
  ok: boolean
  /** False when the report predates the compiled show being armed. */
  fresh?: boolean
}

/** Crowd broadcast-bandwidth interlock input (crowd shows). */
export interface BroadcastBandwidthInterlockInput {
  /** True when the show has crowd cues, i.e. the mast caps apply. */
  applicable: boolean
  /** True when no error-severity CROWD_BANDWIDTH diagnostic exists. */
  ok: boolean
}

export interface InterlockContext {
  /** Outcome of the last site validation run (ok flag + hash of the plan it saw). */
  siteValidation: { ok: boolean; siteHash: string }
  /** Hash of the site plan as it stands NOW — recomputed at arm time. */
  currentSiteHash: string
  windSpeedMps: number
  windLimitMps: number
  /** Operator acknowledgement; `phrase` must equal ARM_ACK_PHRASE exactly. */
  operatorAck: { name: string; phrase: string } | null
  /** Carrier-exposure report outcome; absent → the show has no beam cues. */
  exposure?: ExposureInterlockInput
  /** Crowd broadcast-bandwidth outcome; absent → the show has no crowd cues. */
  broadcastBandwidth?: BroadcastBandwidthInterlockInput
}

export interface InterlockResult {
  id: string
  satisfied: boolean
  detail: string
}

/** Evaluate every interlock; never throws, never short-circuits. */
export function evaluateInterlocks(ctx: InterlockContext): InterlockResult[] {
  const results: InterlockResult[] = []

  // 1. Site validation: must have passed, against the current site plan.
  if (!ctx.siteValidation.ok) {
    results.push({
      id: 'site-validation',
      satisfied: false,
      detail: 'site validation failed',
    })
  } else if (ctx.siteValidation.siteHash !== ctx.currentSiteHash) {
    results.push({
      id: 'site-validation',
      satisfied: false,
      detail:
        `stale site validation: validated hash ${ctx.siteValidation.siteHash}` +
        ` but current site hash is ${ctx.currentSiteHash}`,
    })
  } else {
    results.push({
      id: 'site-validation',
      satisfied: true,
      detail: `site validated (hash ${ctx.currentSiteHash})`,
    })
  }

  // 2. Wind: strictly under the limit (at or over the limit refuses arm).
  const windOk = ctx.windSpeedMps < ctx.windLimitMps
  results.push({
    id: 'wind-limit',
    satisfied: windOk,
    detail: windOk
      ? `wind ${ctx.windSpeedMps} m/s under limit ${ctx.windLimitMps} m/s`
      : `wind ${ctx.windSpeedMps} m/s at or over limit ${ctx.windLimitMps} m/s`,
  })

  // 3. Operator acknowledgement: exact phrase, case-sensitive.
  if (ctx.operatorAck === null) {
    results.push({
      id: 'operator-ack',
      satisfied: false,
      detail: 'no operator acknowledgement',
    })
  } else if (ctx.operatorAck.phrase !== ARM_ACK_PHRASE) {
    results.push({
      id: 'operator-ack',
      satisfied: false,
      detail: `acknowledgement phrase mismatch (expected '${ARM_ACK_PHRASE}')`,
    })
  } else {
    results.push({
      id: 'operator-ack',
      satisfied: true,
      detail: `acknowledged by ${ctx.operatorAck.name}`,
    })
  }

  // 4. Carrier exposure: absent context means the show has no beam cues.
  const exposure = ctx.exposure
  if (exposure === undefined) {
    results.push({ id: 'carrier-exposure', satisfied: true, detail: 'no beam cues' })
  } else if (!exposure.applicable) {
    results.push({
      id: 'carrier-exposure',
      satisfied: true,
      detail: 'not applicable (no beam cues)',
    })
  } else if (exposure.fresh === false) {
    results.push({
      id: 'carrier-exposure',
      satisfied: false,
      detail: 'stale carrier-exposure report — re-run the exposure sweep against this compile',
    })
  } else if (!exposure.ok) {
    results.push({
      id: 'carrier-exposure',
      satisfied: false,
      detail: 'carrier-exposure budget violated',
    })
  } else {
    results.push({
      id: 'carrier-exposure',
      satisfied: true,
      detail: 'carrier-exposure budget satisfied',
    })
  }

  // 5. Crowd broadcast bandwidth: absent context means no crowd cues.
  const bandwidth = ctx.broadcastBandwidth
  if (bandwidth === undefined) {
    results.push({ id: 'broadcast-bandwidth', satisfied: true, detail: 'no crowd cues' })
  } else if (!bandwidth.applicable) {
    results.push({
      id: 'broadcast-bandwidth',
      satisfied: true,
      detail: 'not applicable (no crowd cues)',
    })
  } else if (!bandwidth.ok) {
    results.push({
      id: 'broadcast-bandwidth',
      satisfied: false,
      detail: 'crowd broadcast bandwidth over a mast cap (error-severity CROWD_BANDWIDTH)',
    })
  } else {
    results.push({
      id: 'broadcast-bandwidth',
      satisfied: true,
      detail: 'crowd broadcast bandwidth within every mast cap',
    })
  }

  return results
}
