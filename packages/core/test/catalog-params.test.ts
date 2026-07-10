import { describe, expect, it } from 'vitest'
import { ALLOWED_PARAM_KEYS, starterCatalog, validateParams } from '../src/catalog/index.js'

const cat = starterCatalog()
const droneText = cat.get('text-formation-150')
const droneRing = cat.get('ring-formation-60')
const droneDigit = cat.get('digit-formation-100')
const laserFan = cat.get('laser-fan-rgb')
const panelText = cat.get('panel-text-marquee')
const peony = cat.get('peony-75-red')

describe('ALLOWED_PARAM_KEYS', () => {
  it('matches the contracts.ts CueParams documentation exactly', () => {
    expect(Object.keys(ALLOWED_PARAM_KEYS.drone).sort()).toEqual(
      ['count', 'holdSec', 'rgb', 'scaleM', 'text'],
    )
    expect(Object.keys(ALLOWED_PARAM_KEYS.laser).sort()).toEqual(
      ['headId', 'periodBeats', 'rgb', 'spreadDeg'],
    )
    expect(Object.keys(ALLOWED_PARAM_KEYS.panel).sort()).toEqual(
      ['rgb', 'rgb2', 'speedPxPerBeat', 'text'],
    )
    expect(Object.keys(ALLOWED_PARAM_KEYS.pyro)).toEqual([])
    expect(Object.keys(ALLOWED_PARAM_KEYS.fabrication)).toEqual([])
  })
})

describe('validateParams', () => {
  it('returns [] for undefined or empty params', () => {
    expect(validateParams(peony, undefined)).toEqual([])
    expect(validateParams(droneRing, {})).toEqual([])
  })

  it('accepts well-typed documented params', () => {
    expect(
      validateParams(droneText, { count: 120, scaleM: 60, holdSec: 8, text: 'HELLO', rgb: [1, 0.8, 0.2] }),
    ).toEqual([])
    expect(
      validateParams(laserFan, { headId: 'laser-north', spreadDeg: 45, periodBeats: 2, rgb: [0, 1, 0] }),
    ).toEqual([])
    expect(
      validateParams(panelText, { text: 'THEODOOR', speedPxPerBeat: 8, rgb: [1, 1, 1], rgb2: [0, 0, 1] }),
    ).toEqual([])
  })

  it('flags unknown keys as warnings', () => {
    const diags = validateParams(droneRing, { swirlRate: 3 })
    expect(diags).toHaveLength(1)
    expect(diags[0].severity).toBe('warning')
    expect(diags[0].code).toBe('catalog/unknown-param')
    expect(diags[0].message).toContain('swirlRate')
  })

  it('any param on pyro is unknown (pyro takes none in v1)', () => {
    const diags = validateParams(peony, { count: 3 })
    expect(diags).toHaveLength(1)
    expect(diags[0].severity).toBe('warning')
  })

  it('flags wrong primitive types as errors', () => {
    const wrongCount = validateParams(droneRing, { count: 'five' })
    expect(wrongCount).toHaveLength(1)
    expect(wrongCount[0].severity).toBe('error')
    expect(wrongCount[0].code).toBe('catalog/param-type')
    expect(wrongCount[0].message).toMatch(/must be number, got string/)

    const wrongRgb = validateParams(laserFan, { rgb: 'green' })
    expect(wrongRgb[0].severity).toBe('error')
    expect(wrongRgb[0].message).toMatch(/must be numberArray/)

    const wrongText = validateParams(panelText, { text: 42 })
    expect(wrongText[0].severity).toBe('error')

    const mixed = validateParams(droneRing, { rgb: [1, 'x'] as unknown as number[] })
    expect(mixed[0].severity).toBe('error')
  })

  it('mixes errors and warnings across keys', () => {
    const diags = validateParams(droneRing, { count: false, bogus: 1 })
    expect(diags.map((d) => d.severity).sort()).toEqual(['error', 'warning'])
  })

  it("warns when 'text' is given for a non-text drone formation", () => {
    const diags = validateParams(droneRing, { text: 'HI' })
    expect(diags).toHaveLength(1)
    expect(diags[0].severity).toBe('warning')
    expect(diags[0].code).toBe('catalog/param-inapplicable')
  })

  it("accepts 'text' for drone 'text' and 'digit' formations", () => {
    expect(validateParams(droneText, { text: 'HI' })).toEqual([])
    expect(validateParams(droneDigit, { text: '9' })).toEqual([])
  })
})
