/**
 * export/firingScript.ts — firing-script CSV with module/pin addressing.
 *
 * PURE string builder: no I/O and no gating here. The CLI gates emission of
 * this artifact behind the safety machine; this module only decides bytes.
 *
 * Addressing: pyro cues are grouped by launch position (`positionId`).
 * Within a rack, cues are taken in fire-time order and assigned pins
 * 1..pinsPerModule (32 unless the rack spec says otherwise); each rollover
 * increments the module. Module numbering is GLOBAL across racks, in site
 * asset order: rack B's first module follows rack A's last.
 */

import type { CompiledCue, CompiledShow, EffectDef, PositionedAsset } from '../contracts.js'
import { csvDocument, guardSpreadsheetInjection, type CsvField } from './csv.js'

/** Default pins per firing module when the rack spec does not say. */
export const PINS_PER_MODULE = 32

export const FIRING_SCRIPT_COLUMNS = [
  'fireTimeSec',
  'module',
  'pin',
  'effectId',
  'category',
  'caliberMm',
  'positionId',
  'x',
  'y',
  'notes',
] as const

interface Address {
  module: number
  pin: number
}

/**
 * Build the firing-script CSV for every pyro cue in the compiled show.
 *
 * Columns: fireTimeSec (fixed 3), module, pin, effectId, category, caliberMm,
 * positionId, x, y, notes. Rows keep the compiled order (sorted by fireSec,
 * trackId, id — a total order, so output is byte-identical across runs).
 */
export function firingScriptCsv(
  compiled: CompiledShow,
  getEffect: (id: string) => EffectDef | undefined,
): string {
  const pyroCues = compiled.cues.filter((c) => c.medium === 'pyro')

  // --- group cues by positionId (missing positionId groups under '') ------
  const byPosition = new Map<string, CompiledCue[]>()
  for (const cue of pyroCues) {
    const key = cue.positionId ?? ''
    const group = byPosition.get(key)
    if (group) group.push(cue)
    else byPosition.set(key, [cue])
  }

  // --- deterministic group order: site asset order, then unknown ids ------
  const assetsById = new Map<string, PositionedAsset>()
  for (const asset of compiled.show.site.assets) assetsById.set(asset.id, asset)
  const groupOrder: string[] = []
  for (const asset of compiled.show.site.assets) {
    if (byPosition.has(asset.id)) groupOrder.push(asset.id)
  }
  const unknown = [...byPosition.keys()]
    .filter((id) => !assetsById.has(id))
    .sort()
  groupOrder.push(...unknown)

  // --- assign module/pin: pins 1..N in fire order, modules global ---------
  const addressByCueId = new Map<string, Address>()
  let nextModule = 1
  for (const positionId of groupOrder) {
    const group = byPosition.get(positionId)!
    const pinsPerModule = assetsById.get(positionId)?.rack?.pinsPerModule ?? PINS_PER_MODULE
    // Compiled order within the group is already fireSec-sorted; keep it.
    for (let i = 0; i < group.length; i++) {
      addressByCueId.set(group[i].id, {
        module: nextModule + Math.floor(i / pinsPerModule),
        pin: (i % pinsPerModule) + 1,
      })
    }
    nextModule += Math.max(1, Math.ceil(group.length / pinsPerModule))
  }

  // --- emit rows in compiled (fireSec) order -------------------------------
  const rows: CsvField[][] = [[...FIRING_SCRIPT_COLUMNS]]
  for (const cue of pyroCues) {
    const addr = addressByCueId.get(cue.id)!
    const effect = getEffect(cue.effectId)
    const pyro = effect && effect.medium === 'pyro' ? effect : undefined
    const asset = cue.positionId ? assetsById.get(cue.positionId) : undefined
    rows.push([
      cue.fireSec.toFixed(3),
      addr.module,
      addr.pin,
      guardSpreadsheetInjection(cue.effectId),
      pyro ? pyro.category : '',
      pyro ? pyro.caliberMm : '',
      guardSpreadsheetInjection(cue.positionId ?? ''),
      asset ? asset.pos.x.toFixed(2) : '',
      asset ? asset.pos.y.toFixed(2) : '',
      guardSpreadsheetInjection(effect ? effect.name : 'UNKNOWN EFFECT'),
    ])
  }
  return csvDocument(rows)
}
