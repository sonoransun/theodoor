/**
 * commands/export.ts — file exporters behind the safety gate.
 *
 * Targets: firing-script | artnet | waypoints | ilda | crowd-broadcast |
 * beam-steering | cue-sheet | program-notes.
 *
 * SAFETY GATE: hardware-consumable targets (everything except the two
 * design artifacts, cue-sheet and the guest-facing program-notes)
 * require --armed-ack 'ARM CONFIRMED'. The command drives a real
 * SafetyMachine through arm() (interlocks: fresh site validation + site-hash
 * staleness guard, wind under limit, operator ack, carrier exposure on beam
 * shows, broadcast bandwidth on crowd shows — the last recomputed fresh from
 * both the choreo demand model and the actual exporter frame stream) and
 * goLive('GO LIVE'); machine.requireLive(token) gates EVERY file write. A
 * missing or wrong ack exits 4 with the interlock report and writes nothing.
 * The hash-chained audit log is written as JSONL next to the outputs
 * whenever the gate was opened — even when an artifact write fails mid-loop.
 * Byte GENERATION is pure core code; only EMISSION is gated here — and it
 * only ever writes files (never sockets).
 */

import type {
  ChannelPatch,
  CompiledShow,
  CrowdBroadcastMastLoad,
  DmxFrame,
  DroneCuePlan,
  GateToken,
  InterlockContext,
  LaserPoint,
} from '@theodoor/core'
import {
  ARM_ACK_PHRASE,
  AuditLog,
  DEFAULT_EXPOSURE_BUDGET,
  GO_LIVE_PHRASE,
  LASER_SLOTS,
  PanelRenderer,
  SafetyError,
  SafetyMachine,
  beamSteeringCsv,
  beamSteeringJson,
  buildFountainCues,
  buildIldaFile,
  buildLaserCues,
  buildPanelCues,
  crowdBandwidth,
  crowdBroadcastBin,
  crowdBroadcastCsv,
  crowdBroadcastFrames,
  crowdBroadcastIndexJson,
  crowdBroadcastOverruns,
  cueSheetMarkdown,
  deriveLightChains,
  derivePadTimelines,
  droneWaypointsCsv,
  droneWaypointsJson,
  exposureReport,
  firingScriptCsv,
  fountainChannelsAt,
  fountainPatch,
  jetStatesAt,
  laserFramesAt,
  laserPatch,
  lightStatesAt,
  panelPatch,
  programNotesMarkdown,
  renderDmxPackets,
  searchlightChannelsAt,
  searchlightPatch,
  showDurationSec,
  siteHash,
  validateSite,
} from '@theodoor/core'
import { SafetyRefusalError, UsageError, type CliFlags } from '../args.js'
import { effectLookupFor, loadCompiledShow, type EffectLookup } from '../load.js'
import { ensureOutDir, logErr, printJson, printLines, writeArtifact } from '../out.js'

export const EXPORT_TARGETS = [
  'firing-script',
  'artnet',
  'waypoints',
  'ilda',
  'crowd-broadcast',
  'beam-steering',
  'cue-sheet',
  'program-notes',
] as const
export type ExportTarget = (typeof EXPORT_TARGETS)[number]

/** Targets a hardware system could consume — these demand the safety gate. */
export const HARDWARE_TARGETS: readonly ExportTarget[] = [
  'firing-script',
  'artnet',
  'waypoints',
  'ilda',
  'crowd-broadcast',
  'beam-steering',
]

/** DMX/ILDA render rate. */
export const EXPORT_FPS = 30

interface Artifact {
  name: string
  data: string | Uint8Array
}

// ---------------------------------------------------------------------------
// Pure artifact builders (no I/O)
// ---------------------------------------------------------------------------

function buildFiringScript(compiled: CompiledShow, getEffect: EffectLookup): Artifact[] {
  return [
    {
      name: `${compiled.show.meta.id}.firing-script.csv`,
      data: firingScriptCsv(compiled, getEffect),
    },
  ]
}

function buildCueSheet(compiled: CompiledShow, getEffect: EffectLookup): Artifact[] {
  return [
    { name: `${compiled.show.meta.id}.cue-sheet.md`, data: cueSheetMarkdown(compiled, getEffect) },
  ]
}

/** The guest program: narrative acts + auto "look for" lines. Ungated design artifact. */
function buildProgramNotes(compiled: CompiledShow, getEffect: EffectLookup): Artifact[] {
  return [
    { name: `${compiled.show.meta.id}.program.md`, data: programNotesMarkdown(compiled, getEffect) },
  ]
}

/** Map one laser point-cloud frame onto the 8-slot laser DMX preset. */
function laserChannels(points: readonly LaserPoint[]): Uint8Array {
  const out = new Uint8Array(LASER_SLOTS.length)
  const lit = points.filter((p) => !p.blank)
  if (lit.length === 0) return out
  let cx = 0
  let cy = 0
  let r = 0
  let g = 0
  let b = 0
  for (const p of lit) {
    cx += p.x
    cy += p.y
    r = Math.max(r, p.r)
    g = Math.max(g, p.g)
    b = Math.max(b, p.b)
  }
  cx /= lit.length
  cy /= lit.length
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)))
  out[0] = byte((cx + 1) / 2) // pan
  out[1] = byte((cy + 1) / 2) // tilt
  out[2] = byte(r)
  out[3] = byte(g)
  out[4] = byte(b)
  out[5] = byte(lit.length / points.length) // intensity: lit fraction
  // mode, reserved stay 0
  return out
}

function buildArtnet(compiled: CompiledShow, getEffect: EffectLookup): Artifact[] {
  const site = compiled.show.site

  // Deterministic universe allocation, site-asset order: panels first blob of
  // consecutive universes, lasers one universe each, then fountain banks
  // (4 ch/nozzle) and searchlight banks (6 ch/head) one universe each —
  // water and light are DMX fixtures like any moving head.
  const patches: ChannelPatch[] = []
  let nextUniverse = 0
  for (const asset of site.assets) {
    if (asset.kind === 'panel' && asset.panel) {
      const patch = panelPatch(asset.id, asset.panel, nextUniverse)
      patches.push(patch)
      nextUniverse += patch.slices.length
    } else if (asset.kind === 'laserTower') {
      patches.push(laserPatch(asset.id, nextUniverse))
      nextUniverse += 1
    } else if (asset.kind === 'fountainBank' && asset.fountainBank) {
      patches.push(fountainPatch(asset.id, asset.fountainBank, nextUniverse))
      nextUniverse += 1
    } else if (asset.kind === 'searchlightBank' && asset.searchlightBank) {
      patches.push(searchlightPatch(asset.id, asset.searchlightBank, nextUniverse))
      nextUniverse += 1
    }
  }

  const laserCues = buildLaserCues(compiled, getEffect)
  const panels = new PanelRenderer(buildPanelCues(compiled, getEffect), compiled.show.music)
  const fountainCues = buildFountainCues(compiled, getEffect)
  const lightChains = deriveLightChains(compiled, getEffect)
  const beats = compiled.show.music.beats
  const duration = showDurationSec(compiled)
  const tickCount = Math.max(1, Math.ceil(duration * EXPORT_FPS) + 1)

  const frames: DmxFrame[] = []
  for (let k = 0; k < tickCount; k++) {
    const t = k / EXPORT_FPS
    const byAsset = new Map<string, Uint8Array>()
    // Zero-fill every patched asset so inactive fixtures black out.
    for (const p of patches) byAsset.set(p.assetId, new Uint8Array(p.totalChannels))
    for (const f of panels.framesAt(t)) {
      if (byAsset.has(f.assetId)) byAsset.set(f.assetId, f.rgb)
    }
    for (const f of laserFramesAt(laserCues, t, compiled.show.music)) {
      if (byAsset.has(f.assetId)) byAsset.set(f.assetId, laserChannels(f.points))
    }
    if (fountainCues.length > 0) {
      const jets = jetStatesAt(fountainCues, t, { beats })
      for (const asset of site.assets) {
        if (asset.kind === 'fountainBank' && asset.fountainBank && byAsset.has(asset.id)) {
          byAsset.set(asset.id, fountainChannelsAt(jets, asset, asset.fountainBank))
        }
      }
    }
    if (lightChains.length > 0) {
      const lights = lightStatesAt(lightChains, t, { beats })
      for (const asset of site.assets) {
        if (asset.kind === 'searchlightBank' && asset.searchlightBank && byAsset.has(asset.id)) {
          byAsset.set(asset.id, searchlightChannelsAt(lights, asset, asset.searchlightBank))
        }
      }
    }
    frames.push({ tSec: t, byAsset })
  }

  const packetFrames = renderDmxPackets(frames, patches, EXPORT_FPS)

  // .artnet.bin: every packet length-prefixed (u32 BE), frame order. The
  // index lists only ticks that emitted packets (diff-skip leaves most empty).
  let total = 0
  for (const pf of packetFrames) for (const p of pf.packets) total += 4 + p.length
  const bin = new Uint8Array(total)
  const view = new DataView(bin.buffer)
  const index: { tSec: number; packets: number; byteOffset: number; byteLength: number }[] = []
  let offset = 0
  for (const pf of packetFrames) {
    if (pf.packets.length === 0) continue
    const start = offset
    for (const p of pf.packets) {
      view.setUint32(offset, p.length, false)
      bin.set(p, offset + 4)
      offset += 4 + p.length
    }
    index.push({
      tSec: pf.tSec,
      packets: pf.packets.length,
      byteOffset: start,
      byteLength: offset - start,
    })
  }

  const id = compiled.show.meta.id
  return [
    { name: `${id}.artnet.bin`, data: bin },
    {
      name: `${id}.artnet.json`,
      data: JSON.stringify(
        {
          format: 'theodoor-artnet-index',
          version: 1,
          fps: EXPORT_FPS,
          universes: nextUniverse,
          patches: patches.map((p) => ({
            assetId: p.assetId,
            kind: p.kind,
            totalChannels: p.totalChannels,
            universes: p.slices.map((s) => s.universe),
          })),
          frames: index,
        },
        null,
        2,
      ),
    },
  ]
}

function buildWaypoints(compiled: CompiledShow, getEffect: EffectLookup): Artifact[] {
  const timelines = derivePadTimelines(compiled, getEffect)
  const plans: DroneCuePlan[] = []
  for (const tl of timelines) {
    for (const seg of tl.segments) {
      plans.push({
        cueId: seg.cueId ?? `${tl.padId}-return`,
        startSec: seg.startSec,
        transitionSec: seg.transitionSec,
        plan: seg.plan,
      })
    }
  }
  const id = compiled.show.meta.id
  return [
    { name: `${id}.waypoints.csv`, data: droneWaypointsCsv(plans) },
    { name: `${id}.waypoints.json`, data: droneWaypointsJson(plans) },
  ]
}

function buildIlda(compiled: CompiledShow, getEffect: EffectLookup): Artifact[] {
  const laserCues = buildLaserCues(compiled, getEffect)
  const assetIds = [...new Set(laserCues.map((c) => c.assetId))].sort()
  const duration = showDurationSec(compiled)
  const tickCount = Math.max(1, Math.ceil(duration * EXPORT_FPS) + 1)

  const artifacts: Artifact[] = []
  for (const assetId of assetIds) {
    const frames: LaserPoint[][] = []
    let any = false
    for (let k = 0; k < tickCount; k++) {
      const t = k / EXPORT_FPS
      const frame = laserFramesAt(laserCues, t, compiled.show.music).find(
        (f) => f.assetId === assetId,
      )
      if (frame && frame.points.length > 0) {
        any = true
        frames.push([...frame.points])
      } else {
        // Dark tick: one blanked point keeps the fixed-rate frame stream
        // aligned (buildIldaFile drops truly empty frames, which would
        // collapse idle gaps and desynchronize everything after them).
        frames.push([{ x: 0, y: 0, r: 0, g: 0, b: 0, blank: true }])
      }
    }
    if (!any) continue
    artifacts.push({
      name: `${compiled.show.meta.id}.${assetId}.ild`,
      data: buildIldaFile(frames, { frameName: assetId.slice(0, 8) }),
    })
  }
  return artifacts
}

function buildCrowdBroadcast(compiled: CompiledShow, getEffect: EffectLookup): Artifact[] {
  const id = compiled.show.meta.id
  return [
    { name: `${id}.crowd-broadcast.csv`, data: crowdBroadcastCsv(compiled, getEffect) },
    { name: `${id}.crowd-broadcast.bin`, data: crowdBroadcastBin(compiled, getEffect) },
    { name: `${id}.crowd-broadcast.json`, data: crowdBroadcastIndexJson(compiled, getEffect) },
  ]
}

function buildBeamSteering(compiled: CompiledShow, getEffect: EffectLookup): Artifact[] {
  const id = compiled.show.meta.id
  return [
    { name: `${id}.beam-steering.csv`, data: beamSteeringCsv(compiled, getEffect) },
    { name: `${id}.beam-steering.json`, data: beamSteeringJson(compiled, getEffect) },
  ]
}

// ---------------------------------------------------------------------------
// Safety gate
// ---------------------------------------------------------------------------

interface Gate {
  machine: SafetyMachine
  log: AuditLog
  token: GateToken
}

/**
 * Arm and go live, or throw SafetyRefusalError (exit 4) carrying the full
 * interlock report. Clock is the caller's wall clock (audit timestamps only —
 * chain integrity never depends on time).
 */
function openGate(compiled: CompiledShow, getEffect: EffectLookup, armedAck?: string): Gate {
  const site = compiled.show.site
  const siteDiags = validateSite(site, compiled, getEffect)
  const hash = siteHash(site)
  const log = new AuditLog()
  // AuditEntry.tMs is contractually MILLISECONDS — pass the ms clock raw.
  const machine = new SafetyMachine(() => Date.now(), log)
  // Carrier exposure (beam shows) and broadcast bandwidth (crowd shows) are
  // OPTIONAL interlock inputs: omitted contexts report satisfied, so shows
  // without those media arm exactly as before.
  const hasBeamCues = compiled.cues.some((c) => c.medium === 'beam')
  const hasCrowdCues = compiled.cues.some((c) => c.medium === 'crowd')
  // Broadcast bandwidth is recomputed FRESH at arm time, like the site and
  // exposure interlocks — embedded diagnostics are never trusted (a
  // stripped/stale/older-solver array must not open the crowd-emission
  // gate). Two independent checks must both fit:
  //   1. the choreo demand model (summed per-cue maskUpdateHz vs mast caps);
  //   2. the ACTUAL exporter stream (scheduled frames per rolling second —
  //      gradient patterns fan out to one frame per distinct tuple per tick,
  //      which the demand model cannot see).
  // Overruns REFUSE; frames are never dropped to fit (a truncated stream
  // would render a pattern the reviewed sim never showed).
  let bandwidthOk = true
  let overruns: CrowdBroadcastMastLoad[] = []
  if (hasCrowdCues) {
    const demandDiags = crowdBandwidth(compiled.cues, site.assets, getEffect)
    const stream = crowdBroadcastFrames(compiled, getEffect)
    overruns = crowdBroadcastOverruns(stream.frames, stream.masts)
    bandwidthOk = !demandDiags.some((d) => d.severity === 'error') && overruns.length === 0
  }
  const ctx: InterlockContext = {
    siteValidation: {
      ok: !siteDiags.some((d) => d.severity === 'error'),
      siteHash: hash,
    },
    currentSiteHash: hash,
    windSpeedMps: site.wind.speedMps,
    windLimitMps: site.wind.limitMps,
    operatorAck: armedAck !== undefined ? { name: 'cli-operator', phrase: armedAck } : null,
    ...(hasBeamCues
      ? {
          exposure: {
            applicable: true,
            ok: exposureReport(
              compiled,
              getEffect,
              compiled.show.exposureBudget ?? DEFAULT_EXPOSURE_BUDGET,
            ).pass,
            fresh: true, // recomputed against this compile, right now
          },
        }
      : {}),
    ...(hasCrowdCues
      ? {
          broadcastBandwidth: {
            applicable: true,
            ok: bandwidthOk, // recomputed against this compile, right now
          },
        }
      : {}),
  }
  try {
    machine.arm(ctx)
    const token = machine.goLive(GO_LIVE_PHRASE)
    return { machine, log, token }
  } catch (err) {
    if (err instanceof SafetyError) {
      const interlocks = err.unsatisfied ?? []
      const overrunDetail =
        overruns.length > 0
          ? '; broadcast stream overruns: ' +
            overruns
              .map((o) => `${o.mastId} peaks at ${o.peakFramesPerSec} frames/s (cap ${o.framesPerSec})`)
              .join(', ')
          : ''
      throw new SafetyRefusalError(
        `export refused: ${err.message}${overrunDetail}` +
          (armedAck === undefined
            ? ` (pass --armed-ack '${ARM_ACK_PHRASE}' to arm hardware-consumable exports)`
            : ''),
        { interlocks },
      )
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function runExport(flags: CliFlags): Promise<number> {
  const target = flags.target as ExportTarget | undefined
  if (target === undefined || !EXPORT_TARGETS.includes(target)) {
    throw new UsageError(
      `export requires --target <${EXPORT_TARGETS.join('|')}>` +
        (flags.target !== undefined ? ` (got '${flags.target}')` : ''),
    )
  }
  if (flags.out === undefined) throw new UsageError('export requires --out <dir>')

  const { compiled } = await loadCompiledShow(flags)
  const getEffect = effectLookupFor(compiled)
  const gated = HARDWARE_TARGETS.includes(target)

  // Gate FIRST: on refusal nothing is generated and nothing is written.
  const gate = gated ? openGate(compiled, getEffect, flags.armedAck) : undefined

  const written: string[] = []
  let auditPath: string | undefined
  let emissionOk = false
  try {
    let artifacts: Artifact[]
    switch (target) {
      case 'firing-script':
        artifacts = buildFiringScript(compiled, getEffect)
        break
      case 'artnet':
        artifacts = buildArtnet(compiled, getEffect)
        break
      case 'waypoints':
        artifacts = buildWaypoints(compiled, getEffect)
        break
      case 'ilda':
        artifacts = buildIlda(compiled, getEffect)
        break
      case 'crowd-broadcast':
        artifacts = buildCrowdBroadcast(compiled, getEffect)
        break
      case 'beam-steering':
        artifacts = buildBeamSteering(compiled, getEffect)
        break
      case 'cue-sheet':
        artifacts = buildCueSheet(compiled, getEffect)
        break
      case 'program-notes':
        artifacts = buildProgramNotes(compiled, getEffect)
        break
    }

    ensureOutDir(flags.out)
    for (const artifact of artifacts) {
      if (gate) gate.machine.requireLive(gate.token) // gate EVERY hardware write
      written.push(writeArtifact(flags.out, artifact.name, artifact.data))
    }
    emissionOk = true
  } finally {
    // The audit chain is persisted whenever the gate was opened — even when
    // a builder or an artifact write throws mid-loop, the gated files
    // already on disk must have their ARM / GO LIVE / STAND DOWN record
    // beside them.
    if (gate) {
      gate.machine.standDown()
      gate.machine.disarm()
      try {
        ensureOutDir(flags.out) // may not exist yet if generation threw
        auditPath = writeArtifact(
          flags.out,
          `${compiled.show.meta.id}.audit.jsonl`,
          gate.log.toJsonLines(),
        )
      } catch (auditErr) {
        // Emission succeeded but the audit write failed: that IS the primary
        // failure — rethrow (IoError, exit 3), exactly as before.
        if (emissionOk) throw auditErr
        // Emission already failed (its error is in flight; never mask it):
        // best-effort dump the chain to stderr so it is not lost entirely.
        logErr(
          `audit chain could not be written: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
        )
        process.stderr.write(gate.log.toJsonLines())
      }
    }
  }

  if (flags.json) {
    printJson({
      ok: true,
      show: compiled.show.meta.id,
      target,
      gated,
      files: written,
      ...(auditPath !== undefined ? { auditLog: auditPath } : {}),
    })
  } else {
    const lines = [
      `exported '${compiled.show.meta.id}' target ${target}${gated ? ' (safety-gated)' : ''}:`,
      ...written.map((p) => `  ${p}`),
    ]
    if (auditPath !== undefined) lines.push(`  ${auditPath} (audit chain)`)
    printLines(lines)
  }
  if (!gated) logErr(`note: ${target} is a design artifact; no safety gate required`)
  return 0
}
