/**
 * commands/gallery.ts — generated documentation imagery.
 *
 * Writes the README/docs showcase SVGs (static + SMIL-animated) into --out,
 * every one derived deterministically from the real engine: flagship
 * programs are loaded from the @theodoor/programs registry, sampled through
 * the 120 Hz sim, and rendered by the core gallery builders. UNGATED by
 * design: these are documentation artwork, never firing data.
 *
 * Output: one `<asset-id>.svg` per registry entry plus `manifest.json`
 * (no timestamps, no absolute paths — byte-deterministic).
 */

import type {
  BeamEffect,
  CompiledCue,
  CompiledShow,
  EffectDef,
  PyroEffect,
  SitePlan,
} from '@theodoor/core'
import {
  beamFlyoverSvg,
  beamGeometrySvg,
  crowdGridFor,
  crowdMastFor,
  crowdRampSvg,
  exposureHeatmapSvg,
  exposureReport,
  formationFromEffect,
  formationMorphSvg,
  formationSheetSvg,
  fountainRiseSvg,
  getEffectFrom,
  keystoneChartSvg,
  latencyQuantileMs,
  lakesidePark,
  launchFormation,
  mulberry32,
  forkSeed,
  rackPlan,
  rackSvg,
  sampleFrames,
  searchlightSlewSvg,
  sitePlanSvg,
  skyLoopSvg,
  skySceneSvg,
  splCompareSvg,
  splTimeline,
  starterCatalog,
  timelineSvg,
  type FountainBankSpec,
  type FountainEffect,
  type SearchlightBankSpec,
  type SkyBurst,
  type TimelineBand,
} from '@theodoor/core'
import {
  bat, bloom, clockRing, cometTail, crescent, digit, flag, ghost, grid, heart,
  orrery, ring, saucer, scatter, snowflake, spiral, star, text as textFormation,
} from '@theodoor/core'
import { GALLERY_PROVENANCE, GALLERY_THEME } from '@theodoor/core'
import { UsageError, type CliFlags } from '../args.js'
import { loadProgramFromRegistry } from '../load.js'
import { ensureOutDir, printJson, printLines, writeArtifact } from '../out.js'

type GetEffect = (id: string) => EffectDef | undefined

interface AssetCtx {
  compiled: CompiledShow
  getEffect: GetEffect
  site: SitePlan
}

export interface GalleryAsset {
  /** Filename stem, kebab-case (also the --only selector). */
  id: string
  title: string
  kind: 'static' | 'animated'
  /** Program registry id, or undefined for pure/venue assets. */
  programId?: string
  render: (ctx: AssetCtx) => string
}

// ---------------------------------------------------------------------------
// Small helpers over compiled shows
// ---------------------------------------------------------------------------

function cueOrThrow(compiled: CompiledShow, id: string): CompiledCue {
  const cue = compiled.cues.find((c) => c.id === id)
  if (!cue) throw new UsageError(`gallery: cue '${id}' not found in '${compiled.show.meta.id}'`)
  return cue
}

function cueByPrefix(compiled: CompiledShow, prefix: string): CompiledCue {
  const cue = compiled.cues.find((c) => c.id.startsWith(prefix))
  if (!cue) throw new UsageError(`gallery: no cue starting '${prefix}' in '${compiled.show.meta.id}'`)
  return cue
}

function annotationTime(
  compiled: CompiledShow,
  kind: string,
  label: string | undefined,
  pick: 'first' | 'strongest' = 'first',
): number {
  const hits = compiled.show.music.annotations.filter(
    (a) => a.kind === kind && (label === undefined || a.label === label),
  )
  if (hits.length === 0) {
    throw new UsageError(`gallery: no '${kind}'${label ? `/'${label}'` : ''} annotation found`)
  }
  if (pick === 'strongest') hits.sort((a, b) => b.strength - a.strength)
  return hits[0]!.time
}

/** Pyro cues landing inside [fromSec, toSec] → closed-form burst glyph specs. */
function burstsInWindow(ctx: AssetCtx, fromSec: number, toSec: number): SkyBurst[] {
  const out: SkyBurst[] = []
  for (const cue of ctx.compiled.cues) {
    if (cue.medium !== 'pyro') continue
    if (cue.targetSec < fromSec || cue.targetSec > toSec) continue
    const effect = ctx.getEffect(cue.effectId)
    if (!effect || effect.medium !== 'pyro') continue
    const fx = effect as PyroEffect
    const asset = ctx.site.assets.find((a) => a.id === cue.positionId)
    out.push({
      xM: asset?.pos.x ?? 0,
      zM: fx.burstHeightM,
      radiusM: fx.burstRadiusM,
      beginSec: cue.targetSec - fromSec,
      durSec: Math.min(fx.durationSec, 4),
      colors: fx.colors,
      seed: cue.seed,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The registry (declared order = manifest/output order)
// ---------------------------------------------------------------------------

const ALL_FORMATIONS = (): { f: ReturnType<typeof ring>; label: string }[] => [
  { f: grid(6, 8, 4), label: 'grid' },
  { f: ring(48, 20), label: 'ring' },
  { f: star(60, 22, 9), label: 'star' },
  { f: heart(56, 1.4), label: 'heart' },
  { f: flag(12, 7, 4, [[0.72, 0.07, 0.15], [0.95, 0.95, 0.95]], { cols: 5, rows: 3, rgb: [0.1, 0.24, 0.56] }), label: 'flag' },
  { f: textFormation('JOY', 60, 34), label: 'text' },
  { f: digit(7, 48, 26), label: 'digit' },
  { f: clockRing(60, 20), label: 'clockRing' },
  { f: scatter(56, { x: 40, y: 10, z: 20 }, 11), label: 'scatter' },
  { f: bloom(56, 18, 12), label: 'bloom' },
  { f: bat(56, 40), label: 'bat' },
  { f: ghost(56, 30, 13), label: 'ghost' },
  { f: spiral(60, 22, 14), label: 'spiral' },
  { f: cometTail(56, 44, 15), label: 'cometTail' },
  { f: saucer(56, 34), label: 'saucer' },
  { f: orrery(64, 22), label: 'orrery' },
  { f: crescent(52, 20), label: 'crescent' },
  { f: snowflake(60, 40), label: 'snowflake' },
]

export const GALLERY_ASSETS: readonly GalleryAsset[] = [
  {
    id: 'hero-cosmos-orbit',
    title: 'Night of the Spheres — act 2 orbit loop',
    kind: 'animated',
    programId: 'cosmos',
    render: (ctx) => {
      const comet = cueOrThrow(ctx.compiled, 'comet-crossing')
      const fromSec = comet.targetSec - 10
      const toSec = fromSec + 16
      const frames = sampleFrames(ctx.compiled, { fromSec, toSec, fps: 4, getEffect: ctx.getEffect })
      return skyLoopSvg(frames, ctx.site, {
        loopDurSec: 16,
        bursts: burstsInWindow(ctx, fromSec, toSec),
        title: 'Night of the Spheres — orrery, comet crossing, thunder-tagged shell',
      })
    },
  },
  {
    id: 'keystone-cosmos-daybreak',
    title: 'The keystone identity — one beat, four kinds of physics',
    kind: 'static',
    programId: 'cosmos',
    render: (ctx) => {
      const daybreak = annotationTime(ctx.compiled, 'climax', undefined, 'first')
      const rows = [
        { cueId: 'sunrise-lag-comet', note: 'old physics — report lags the flash' },
        { cueId: 'dawn-wave-000' },
        { cueId: 'sunrise-repaired-comet' },
        { cueId: cueByPrefix(ctx.compiled, 'thunder-sunrise-repaired-comet').id },
        { cueId: 'daybreak-a' },
        { cueId: cueByPrefix(ctx.compiled, 'thunder-daybreak-a').id },
        { cueId: 'daybreak-b' },
        { cueId: cueByPrefix(ctx.compiled, 'thunder-daybreak-b').id },
        { cueId: 'daybreak-haptic' },
        { cueId: 'daybreak-flood' },
      ]
      return keystoneChartSvg(ctx.compiled, {
        rows,
        fromSec: 4,
        toSec: Math.ceil(daybreak) + 4,
        ruleAt: { tSec: daybreak, label: 'daybreak' },
        callout: { text: 'same targetSec - different fireSec', atRowOfCueId: 'daybreak-a' },
        title: 'fireSec = targetSec − anticipationSec',
      })
    },
  },
  {
    id: 'anim-crowd-ramp-cosmos',
    title: 'Crowd broadcast latency — the ramp completes on the beat',
    kind: 'animated',
    programId: 'cosmos',
    render: (ctx) => {
      const cue = cueOrThrow(ctx.compiled, 'starfield-0')
      const mast = crowdMastFor(ctx.site, cue.positionId)
      if (!mast?.crowdMast) throw new UsageError('gallery: starfield cue has no mast')
      const grid = crowdGridFor(ctx.site)
      if (!grid) throw new UsageError('gallery: site has no crowd grid')
      // Per-cell delay = the median of that cell's 16 seeded device draws —
      // the same latency model the sim ramps with.
      const cells = grid.cells.map((cell) => {
        const draws: number[] = []
        for (let i = 0; i < 16; i++) {
          const u = mulberry32(forkSeed(cue.seed, `lat:${cell.row}:${cell.col}:${i}`))()
          draws.push(latencyQuantileMs(mast.crowdMast!.phone, u))
        }
        draws.sort((a, b) => a - b)
        return { col: cell.col, row: cell.row, delaySec: draws[8]! / 1000 }
      })
      return crowdRampSvg(cells, { cols: grid.cols, rows: grid.rows }, {
        fireToLandSec: cue.anticipationSec,
        loopDurSec: 8,
        title: 'Phone starfield rains in — ~95% lit exactly at the beat',
      })
    },
  },
  {
    id: 'site-lakeside-park',
    title: 'lakesidePark() — the flagship venue',
    kind: 'static',
    render: () => sitePlanSvg(lakesidePark()),
  },
  {
    id: 'timeline-hallows',
    title: 'The Unquiet Hour — full-show cue timeline',
    kind: 'static',
    programId: 'hallows',
    render: (ctx) => {
      const danse = annotationTime(ctx.compiled, 'accent', 'danse')
      const creep = annotationTime(ctx.compiled, 'accent', 'creep')
      const dawn = annotationTime(ctx.compiled, 'accent', 'dawn')
      const end = ctx.compiled.show.music.duration
      const bands: TimelineBand[] = [
        { label: 'THE SUMMONING', fromSec: 0, toSec: danse },
        { label: 'THE DANCE', fromSec: danse, toSec: creep },
        { label: 'CHASE', fromSec: creep, toSec: dawn },
        { label: 'DAWN', fromSec: dawn, toSec: end },
      ]
      return timelineSvg(ctx.compiled, { bands })
    },
  },
  {
    id: 'exposure-hallows',
    title: 'Carrier exposure by crowd cell — The Unquiet Hour',
    kind: 'static',
    programId: 'hallows',
    render: (ctx) => {
      const grid = crowdGridFor(ctx.site)
      if (!grid) throw new UsageError('gallery: site has no crowd grid')
      const report = exposureReport(ctx.compiled, ctx.getEffect)
      return exposureHeatmapSvg(report, grid)
    },
  },
  {
    id: 'spl-nye-vs-quiet',
    title: 'The quiet budget — NYE standard vs quiet at the center listener',
    kind: 'static',
    programId: 'nye',
    render: (ctx) => {
      const listener = ctx.site.refListenerPos[1] ?? ctx.site.refListenerPos[0]!
      const std = splTimeline(ctx.compiled, ctx.getEffect, listener, 0.25)
      const quiet = galleryProgramCache.get('nye-quiet')
      if (!quiet) throw new UsageError('gallery: nye-quiet not preloaded')
      const q = splTimeline(quiet, getEffectFrom(starterCatalog()), listener, 0.25)
      const midnight = annotationTime(ctx.compiled, 'accent', 'midnight')
      return splCompareSvg(
        [
          { label: 'standard', color: '#ff9d4d', fillOverBudget: true, samples: std },
          { label: 'quiet (85 dB budget)', color: '#5ee6d0', samples: q },
        ],
        { budgetDb: 85, ruleAt: { tSec: midnight, label: 'midnight' } },
      )
    },
  },
  {
    id: 'formations',
    title: 'Formation atlas — all eighteen kinds',
    kind: 'static',
    render: () => formationSheetSvg(ALL_FORMATIONS(), 6),
  },
  {
    id: 'beam-footprint-geometry',
    title: 'Directional-audio footprint geometry',
    kind: 'static',
    render: () => {
      const site = lakesidePark()
      const asset = site.assets.find((a) => a.id === 'beam-north-west')!
      const effect = getEffectFrom(starterCatalog())('beam-whisper-narration') as BeamEffect
      const grid = crowdGridFor(site)!
      const target = grid.cells.find((c) => c.row === 4 && c.col === 19)!.centroid
      return beamGeometrySvg(asset, effect, target)
    },
  },
  {
    id: 'hero-vltava-broad-river',
    title: 'Vltava — the broad river: brocades, thunder, nine shooters, pillars, bloom',
    kind: 'animated',
    programId: 'vltava',
    render: (ctx) => {
      const climax = annotationTime(ctx.compiled, 'climax', undefined, 'strongest')
      // Open one second before the landing: shooters two-thirds up, brocade
      // tracers near apogee — a static frame already reads as "about to land".
      const fromSec = climax - 1
      const toSec = fromSec + 14
      const frames = sampleFrames(ctx.compiled, { fromSec, toSec, fps: 4, getEffect: ctx.getEffect })
      return skyLoopSvg(frames, ctx.site, {
        loopDurSec: 14,
        bursts: burstsInWindow(ctx, fromSec, toSec),
        droneMax: 120,
        title: 'Vltava — the broad river: water, light, thunder and gold land on one beat',
      })
    },
  },
  {
    id: 'scene-vltava-moonlight',
    title: 'Vltava — moonlight: the spire, the crescent, a nymph shooter at its crest',
    kind: 'static',
    programId: 'vltava',
    render: (ctx) => {
      const moonlight = annotationTime(ctx.compiled, 'accent', 'moonlight')
      const frame = sampleFrames(ctx.compiled, {
        fromSec: moonlight + 0.5,
        toSec: moonlight + 0.5,
        fps: 4,
        getEffect: ctx.getEffect,
      })[0]!
      return skySceneSvg(frame, ctx.site, {
        starMax: 300,
        title: 'Vltava at moonlight — the converging spire, the crescent, and a 45 m shooter cresting on the nymph',
      })
    },
  },
  {
    id: 'keystone-vltava-broad-river',
    title: 'The keystone identity — one landing, six kinds of physics',
    kind: 'static',
    programId: 'vltava',
    render: (ctx) => {
      const climax = annotationTime(ctx.compiled, 'climax', undefined, 'strongest')
      const castle = annotationTime(ctx.compiled, 'accent', 'vysehrad')
      const rows = [
        { cueId: 'broad-bloom', note: 'drone morph kinematics' },
        { cueId: 'broad-brocade-0', note: 'shell rise time' },
        { cueId: 'broad-shooters-000', note: 'valve latency + water rise' },
        { cueId: cueByPrefix(ctx.compiled, 'thunder-broad-brocade-0').id, note: 'acoustic time-of-flight' },
        { cueId: 'broad-flood-mast-west', note: 'broadcast p95 latency' },
        { cueId: 'broad-pillars-000', note: 'heads already vertical: no slew' },
        { cueId: cueByPrefix(ctx.compiled, 'castle-spire-1').id, note: 'head slew, landing on the castle' },
      ]
      return keystoneChartSvg(ctx.compiled, {
        rows,
        fromSec: Math.floor(climax) - 16,
        toSec: Math.ceil(castle) + 3,
        ruleAt: { tSec: climax, label: 'the broad river' },
        callout: { text: 'same targetSec - six different fireSec', atRowOfCueId: 'broad-brocade-0' },
        title: 'fireSec = targetSec − anticipationSec — six media, one landing',
      })
    },
  },
  {
    id: 'timeline-vltava',
    title: 'Vltava — full-show timeline, all nine lanes',
    kind: 'static',
    programId: 'vltava',
    render: (ctx) => {
      // Short acts crowd the band header: label by the act numeral only.
      const bands: TimelineBand[] = (ctx.compiled.acts ?? []).map((a) => ({
        label: a.title.split(' — ')[0] ?? a.title,
        fromSec: a.fromSec,
        toSec: a.toSec,
      }))
      return timelineSvg(ctx.compiled, { bands })
    },
  },
  {
    id: 'physics-fountain-rise',
    title: 'Fountain anticipation — valve latency plus the ballistic rise',
    kind: 'static',
    render: () => {
      const site = lakesidePark()
      const bank = site.assets.find((a) => a.id === 'fount-west')?.fountainBank as FountainBankSpec | undefined
      if (!bank) throw new UsageError('gallery: lakesidePark has no fount-west bank')
      const shooter = getEffectFrom(starterCatalog())('fountain-shooter-45m') as FountainEffect | undefined
      if (!shooter || shooter.medium !== 'fountain') {
        throw new UsageError('gallery: fountain-shooter-45m missing from the catalog')
      }
      return fountainRiseSvg(shooter, bank, {
        title: 'Sky Shooter 45 m — the column crests on the beat',
      })
    },
  },
  {
    id: 'physics-searchlight-slew',
    title: 'Searchlight anticipation — head slew solved from the previous aim',
    kind: 'static',
    render: () => {
      const site = lakesidePark()
      const bank = site.assets.find((a) => a.id === 'lights-west')?.searchlightBank as SearchlightBankSpec | undefined
      if (!bank) throw new UsageError('gallery: lakesidePark has no lights-west bank')
      return searchlightSlewSvg(bank)
    },
  },
  {
    id: 'scene-hallows-summit',
    title: 'The Unquiet Hour — the summit, one sim snapshot',
    kind: 'static',
    programId: 'hallows',
    render: (ctx) => {
      const summit = annotationTime(ctx.compiled, 'climax', undefined, 'strongest')
      const frame = sampleFrames(ctx.compiled, {
        fromSec: summit + 1,
        toSec: summit + 1,
        fps: 4,
        getEffect: ctx.getEffect,
      })[0]!
      return skySceneSvg(frame, ctx.site, {
        starMax: 450,
        title: 'The Unquiet Hour at the summit — every pixel from the deterministic sim',
      })
    },
  },
  {
    id: 'anim-drone-morph-cosmos',
    title: 'Fleet kinematics — launch grid to spiral galaxy to orrery',
    kind: 'animated',
    render: () => {
      const getEffect = getEffectFrom(starterCatalog())
      const spiralFx = getEffect('spiral-formation-120')
      const orreryFx = getEffect('orrery-formation-140')
      if (spiralFx?.medium !== 'drone' || orreryFx?.medium !== 'drone') {
        throw new UsageError('gallery: drone formation effects missing from the catalog')
      }
      return formationMorphSvg(
        [
          launchFormation(140),
          formationFromEffect(spiralFx, { count: 120, scaleM: 58 }, 7),
          formationFromEffect(orreryFx, { count: 140, scaleM: 58 }, 7),
        ],
        { durSec: 18, labels: ['launch grid', 'spiral galaxy', 'orrery'] },
      )
    },
  },
  {
    id: 'anim-beam-flyover-hallows',
    title: 'Beam flyover — the audible footprint sweeps the lawn',
    kind: 'animated',
    programId: 'hallows',
    render: (ctx) => {
      const cue = cueByPrefix(ctx.compiled, 'tritone-fly-0')
      const grid = crowdGridFor(ctx.site)
      if (!grid) throw new UsageError('gallery: site has no crowd grid')
      const frames = sampleFrames(ctx.compiled, {
        fromSec: cue.fireSec,
        toSec: cue.targetSec + cue.durationSec - 0.25,
        fps: 4,
        getEffect: ctx.getEffect,
      })
      return beamFlyoverSvg(frames, grid, { loopDurSec: 8 })
    },
  },
  {
    id: 'fab-rack-drawing',
    title: 'Fabrication output — a dimensioned mortar-rack drawing',
    kind: 'static',
    programId: 'july4',
    render: (ctx) => {
      const plans = rackPlan(ctx.compiled, ctx.site, ctx.getEffect)
      if (plans.length === 0) throw new UsageError('gallery: july4 has no rack plans')
      // Fab drawings are currentColor line art: pin the ink via the root
      // `color` attribute and paint an opaque page so the gallery copy reads
      // on both GitHub themes (raw currentColor renders black in <img>).
      return rackSvg(plans[0]!)
        .replace('<svg ', `<svg color="${GALLERY_THEME.ink}" `)
        .replace(
          '><defs>',
          `>${GALLERY_PROVENANCE}<rect x="0" y="0" width="100%" height="100%" fill="${GALLERY_THEME.pageBg}"/><defs>`,
        )
    },
  },
]

/** Programs loaded once per run (the SPL chart needs a second variant). */
const galleryProgramCache = new Map<string, CompiledShow>()

async function loadCached(programId: string): Promise<CompiledShow> {
  const hit = galleryProgramCache.get(programId)
  if (hit) return hit
  const compiled = await loadProgramFromRegistry(programId)
  galleryProgramCache.set(programId, compiled)
  return compiled
}

export async function runGallery(flags: CliFlags): Promise<number> {
  if (flags.out === undefined) throw new UsageError('gallery requires --out <dir>')
  const assets =
    flags.only === undefined
      ? GALLERY_ASSETS
      : GALLERY_ASSETS.filter((a) => a.id === flags.only)
  if (assets.length === 0) {
    throw new UsageError(
      `gallery: unknown asset '${flags.only}'; known: ${GALLERY_ASSETS.map((a) => a.id).join(', ')}`,
    )
  }
  ensureOutDir(flags.out)
  galleryProgramCache.clear()
  // The SPL chart compares against the quiet variant; preload it.
  if (assets.some((a) => a.id === 'spl-nye-vs-quiet')) await loadCached('nye-quiet')

  const written: string[] = []
  const manifest: { id: string; file: string; title: string; kind: string }[] = []
  for (const asset of assets) {
    let ctx: AssetCtx
    if (asset.programId !== undefined) {
      const compiled = await loadCached(asset.programId)
      ctx = { compiled, getEffect: getEffectFrom(starterCatalog()), site: compiled.show.site }
    } else {
      const site = lakesidePark()
      ctx = {
        compiled: undefined as unknown as CompiledShow, // pure assets never read it
        getEffect: getEffectFrom(starterCatalog()),
        site,
      }
    }
    const svg = asset.render(ctx)
    written.push(writeArtifact(flags.out, `${asset.id}.svg`, svg))
    manifest.push({ id: asset.id, file: `${asset.id}.svg`, title: asset.title, kind: asset.kind })
  }
  // Manifest covers the FULL registry only on unfiltered runs, so --only
  // never truncates the committed manifest by accident.
  if (flags.only === undefined) {
    written.push(writeArtifact(flags.out, 'manifest.json', `${JSON.stringify(manifest, null, 1)}\n`))
  }

  if (flags.json) {
    printJson({ ok: true, files: written, assets: manifest })
  } else {
    printLines([`gallery: wrote ${written.length} file(s) to ${flags.out}`, ...written.map((f) => `  ${f}`)])
  }
  return 0
}
