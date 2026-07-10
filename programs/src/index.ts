/**
 * @theodoor/programs — flagship show programs.
 *
 * Each entry is a PURE builder: call it for a fresh { show, compiled } pair.
 * Quiet variants target noise-sensitive audiences: a 100 dB@15m authoring
 * ceiling plus a summed 85 dB SPL budget at the audience listeners.
 */
import type { BuildResult } from '@theodoor/core'
import { july4, july4Quiet } from './july4.js'
import { nye, nyeQuiet } from './nye.js'
import { hallows, hallowsQuiet } from './hallows.js'
import { cosmos, cosmosQuiet } from './cosmos.js'
import { aurora, auroraQuiet } from './aurora.js'
import { cardstunt, cardstuntQuiet } from './cardstunt.js'

export { july4, july4Quiet } from './july4.js'
export { nye, nyeQuiet } from './nye.js'
export { hallows, hallowsQuiet } from './hallows.js'
export { cosmos, cosmosQuiet } from './cosmos.js'
export { aurora, auroraQuiet } from './aurora.js'
export { cardstunt, cardstuntQuiet } from './cardstunt.js'
export * from './palettes.js'

export const PROGRAMS: Record<string, () => BuildResult> = {
  july4,
  'july4-quiet': july4Quiet,
  nye,
  'nye-quiet': nyeQuiet,
  hallows,
  'hallows-quiet': hallowsQuiet,
  cosmos,
  'cosmos-quiet': cosmosQuiet,
  aurora,
  'aurora-quiet': auroraQuiet,
  cardstunt,
  'cardstunt-quiet': cardstuntQuiet,
}
