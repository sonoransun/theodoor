import { describe, expect, it } from 'vitest'
import type { CompiledAct } from '@theodoor/core'
import { actAt } from '../src/ui/hud.js'

const ACTS: CompiledAct[] = [
  { title: 'I — Two Springs', fromSec: 0, toSec: 40, note: 'Two trickles become a river.' },
  { title: 'II — The River', fromSec: 40, toSec: 110, note: 'The theme in full flow.' },
  { title: 'III — Moonlight', fromSec: 110, toSec: 180, note: 'Nymphs dance on the water.' },
]

describe('actAt', () => {
  it('returns the act whose span contains t (half-open)', () => {
    expect(actAt(ACTS, 0)?.title).toBe('I — Two Springs')
    expect(actAt(ACTS, 39.999)?.title).toBe('I — Two Springs')
    expect(actAt(ACTS, 40)?.title).toBe('II — The River')
    expect(actAt(ACTS, 150)?.title).toBe('III — Moonlight')
  })

  it('is undefined in the pre-roll, after the last act, and with no acts', () => {
    expect(actAt(ACTS, -3)).toBeUndefined()
    expect(actAt(ACTS, 180)).toBeUndefined()
    expect(actAt([], 10)).toBeUndefined()
  })
})
