/**
 * commands/fab.ts — fabrication shop drawings and the bill of materials.
 *
 * Targets: rack (dimensioned mortar-rack SVG per rack asset), panel (mounting
 * frame SVG per panel asset), bom (aggregated bill of materials, markdown
 * and/or JSON). UNGATED by design: these are staging-hardware shop drawings,
 * never firing data.
 */

import { buildBom, bomMarkdown, panelFrameSvg, rackPlan, rackSvg } from '@theodoor/core'
import { UsageError, type CliFlags } from '../args.js'
import { effectLookupFor, loadCompiledShow } from '../load.js'
import { ensureOutDir, printJson, printLines, writeArtifact } from '../out.js'

export const FAB_TARGETS = ['rack', 'panel', 'bom'] as const
export type FabTarget = (typeof FAB_TARGETS)[number]

export async function runFab(flags: CliFlags): Promise<number> {
  const target = flags.target as FabTarget | undefined
  if (target === undefined || !FAB_TARGETS.includes(target)) {
    throw new UsageError(
      `fab requires --target <${FAB_TARGETS.join('|')}>` +
        (flags.target !== undefined ? ` (got '${flags.target}')` : ''),
    )
  }
  const { compiled } = await loadCompiledShow(flags)
  const getEffect = effectLookupFor(compiled)
  const site = compiled.show.site

  if (target === 'rack') {
    if (flags.out === undefined) throw new UsageError('fab --target rack requires --out <dir>')
    ensureOutDir(flags.out)
    const plans = rackPlan(compiled, site, getEffect)
    const written: string[] = []
    for (const plan of plans) {
      written.push(writeArtifact(flags.out, `${plan.assetId}.rack.svg`, rackSvg(plan)))
    }
    if (flags.json) {
      printJson({
        ok: true,
        target,
        files: written,
        racks: plans.map((p) => ({
          assetId: p.assetId,
          tubeCount: p.tubeCount,
          lengthMm: p.lengthMm,
          widthMm: p.widthMm,
        })),
      })
    } else {
      printLines([
        `wrote ${written.length} rack drawing(s):`,
        ...plans.map((p, i) => `  ${written[i]}  (${p.tubeCount} tubes)`),
      ])
    }
    return 0
  }

  if (target === 'panel') {
    if (flags.out === undefined) throw new UsageError('fab --target panel requires --out <dir>')
    ensureOutDir(flags.out)
    const panels = site.assets.filter((a) => a.kind === 'panel' && a.panel !== undefined)
    const written: string[] = []
    for (const asset of panels) {
      written.push(writeArtifact(flags.out, `${asset.id}.panel.svg`, panelFrameSvg(asset)))
    }
    if (flags.json) {
      printJson({ ok: true, target, files: written })
    } else {
      printLines([`wrote ${written.length} panel frame drawing(s):`, ...written.map((p) => `  ${p}`)])
    }
    return 0
  }

  // bom
  const bom = buildBom(compiled, site, getEffect)
  let written: string | undefined
  if (flags.out !== undefined) {
    ensureOutDir(flags.out)
    written = writeArtifact(flags.out, `${compiled.show.meta.id}.bom.md`, bomMarkdown(bom))
  }
  if (flags.json) {
    printJson({ ok: true, target, bom, ...(written !== undefined ? { files: [written] } : {}) })
  } else if (written !== undefined) {
    printLines([`wrote ${written}`])
  } else {
    printLines([bomMarkdown(bom).trimEnd()])
  }
  return 0
}
