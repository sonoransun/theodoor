/**
 * scores/index.ts — registry of built-in authored scores.
 */

import type { Score } from '../../contracts.js'
import { odeToJoy } from './odeToJoy.js'
import { starsAndStripesForever } from './starsAndStripesForever.js'
import { overture1812Finale } from './overture1812Finale.js'
import { auldLangSyne } from './auldLangSyne.js'
import { danseMacabre } from './danseMacabre.js'
import { mountainKing } from './mountainKing.js'
import { dawnOfAllSaints } from './dawnOfAllSaints.js'
import { zarathustraSunrise } from './zarathustraSunrise.js'
import { blueDanube } from './blueDanube.js'
import { jupiterHymn } from './jupiterHymn.js'
import { gymnopedie1 } from './gymnopedie1.js'
import { clairDeLune } from './clairDeLune.js'
import { moonlightAdagio } from './moonlightAdagio.js'
import { vltava } from './vltava.js'

export { odeToJoy } from './odeToJoy.js'
export { starsAndStripesForever } from './starsAndStripesForever.js'
export { overture1812Finale } from './overture1812Finale.js'
export { auldLangSyne } from './auldLangSyne.js'
export { danseMacabre } from './danseMacabre.js'
export { mountainKing } from './mountainKing.js'
export { dawnOfAllSaints } from './dawnOfAllSaints.js'
export { zarathustraSunrise } from './zarathustraSunrise.js'
export { blueDanube } from './blueDanube.js'
export { jupiterHymn } from './jupiterHymn.js'
export { gymnopedie1 } from './gymnopedie1.js'
export { clairDeLune } from './clairDeLune.js'
export { moonlightAdagio } from './moonlightAdagio.js'
export { vltava } from './vltava.js'

export const SCORES: Record<string, Score> = {
  [odeToJoy.id]: odeToJoy,
  [starsAndStripesForever.id]: starsAndStripesForever,
  [overture1812Finale.id]: overture1812Finale,
  [auldLangSyne.id]: auldLangSyne,
  [danseMacabre.id]: danseMacabre,
  [mountainKing.id]: mountainKing,
  [dawnOfAllSaints.id]: dawnOfAllSaints,
  [zarathustraSunrise.id]: zarathustraSunrise,
  [blueDanube.id]: blueDanube,
  [jupiterHymn.id]: jupiterHymn,
  [gymnopedie1.id]: gymnopedie1,
  [clairDeLune.id]: clairDeLune,
  [moonlightAdagio.id]: moonlightAdagio,
  [vltava.id]: vltava,
}

/** Look up a built-in score by id (undefined when unknown). */
export function getScore(id: string): Score | undefined {
  return SCORES[id]
}
