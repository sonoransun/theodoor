import { describe, expect, it } from 'vitest'
import { CSV_EOL, firingScriptCsv } from '../src/export/index.js'
import { getEffect, laserCue, makeCompiled, pyroCue, trickyComet } from './export-fixtures.js'

/** 40 cues on rackA (fireSec 1..40) + 3 on rackB, interleaved fire times. */
function rolloverShow() {
  const cues = []
  for (let i = 1; i <= 40; i++) {
    cues.push(pyroCue(`a${String(i).padStart(3, '0')}`, i, 'rackA'))
  }
  cues.push(pyroCue('b1', 0.5, 'rackB'))
  cues.push(pyroCue('b2', 10.5, 'rackB'))
  cues.push(pyroCue('b3', 20.5, 'rackB'))
  return makeCompiled(cues)
}

function parseRows(csv: string): string[][] {
  const lines = csv.split(CSV_EOL)
  expect(lines[lines.length - 1]).toBe('') // trailing CRLF
  return lines.slice(0, -1).map((l) => l.split(','))
}

describe('firingScriptCsv', () => {
  it('emits the exact header and one row per pyro cue, sorted by fire time', () => {
    const rows = parseRows(firingScriptCsv(rolloverShow(), getEffect))
    expect(rows[0]).toEqual([
      'fireTimeSec', 'module', 'pin', 'effectId', 'category',
      'caliberMm', 'positionId', 'x', 'y', 'notes',
    ])
    expect(rows.length).toBe(1 + 43)
    const times = rows.slice(1).map((r) => Number(r[0]))
    expect([...times].sort((x, y) => x - y)).toEqual(times)
    expect(rows[1]![0]).toBe('0.500') // fixed(3)
  })

  it('assigns pins 1..32 then rolls the module; modules are global by asset order', () => {
    const rows = parseRows(firingScriptCsv(rolloverShow(), getEffect)).slice(1)
    const addr = (positionId: string, fireSec: number) => {
      const row = rows.find((r) => r[6] === positionId && Number(r[0]) === fireSec)!
      return { module: Number(row[1]), pin: Number(row[2]) }
    }
    // rackA: pins 1..32 fill module 1, then module 2 starts at pin 1.
    expect(addr('rackA', 1)).toEqual({ module: 1, pin: 1 })
    expect(addr('rackA', 32)).toEqual({ module: 1, pin: 32 })
    expect(addr('rackA', 33)).toEqual({ module: 2, pin: 1 })
    expect(addr('rackA', 40)).toEqual({ module: 2, pin: 8 })
    // rackB is second in site asset order: its module base follows rackA's,
    // even though its first cue fires earliest in the whole show.
    expect(addr('rackB', 0.5)).toEqual({ module: 3, pin: 1 })
    expect(addr('rackB', 10.5)).toEqual({ module: 3, pin: 2 })
    expect(addr('rackB', 20.5)).toEqual({ module: 3, pin: 3 })
  })

  it('includes only pyro cues', () => {
    const compiled = makeCompiled([pyroCue('p1', 5, 'rackA'), laserCue('l1', 6)])
    const rows = parseRows(firingScriptCsv(compiled, getEffect))
    expect(rows.length).toBe(2)
    expect(rows[1]![3]).toBe('peony-75')
  })

  it('fills effect metadata and asset coordinates', () => {
    const compiled = makeCompiled([pyroCue('p1', 5, 'rackA')])
    const row = parseRows(firingScriptCsv(compiled, getEffect))[1]!
    expect(row).toEqual([
      '5.000', '1', '1', 'peony-75', 'peony', '75', 'rackA', '10.00', '0.00', 'Red Peony 75',
    ])
  })

  it('guards spreadsheet injection in the notes column', () => {
    const compiled = makeCompiled([pyroCue('p1', 5, 'rackA', trickyComet.id)])
    const csv = firingScriptCsv(compiled, getEffect)
    // Name is '=HYPERLINK("x"), gold' → guarded with ' and RFC-quoted.
    expect(csv).toContain('"\'=HYPERLINK(""x""), gold"')
    expect(csv).not.toContain(`,=HYPERLINK`)
  })

  it('handles unknown effects and unknown positions without throwing', () => {
    const compiled = makeCompiled([pyroCue('p1', 5, 'ghost-rack', 'no-such-effect')])
    const row = parseRows(firingScriptCsv(compiled, getEffect))[1]!
    expect(row[3]).toBe('no-such-effect')
    expect(row[4]).toBe('') // category unknown
    expect(row[7]).toBe('') // x unknown
    expect(row[9]).toBe('UNKNOWN EFFECT')
    expect(row[1]).toBe('1') // still gets a module
  })

  it('is deterministic: byte-identical across two runs on fresh inputs', () => {
    const a = firingScriptCsv(rolloverShow(), getEffect)
    const b = firingScriptCsv(rolloverShow(), getEffect)
    expect(a).toBe(b)
    expect(Buffer.from(a, 'utf8').equals(Buffer.from(b, 'utf8'))).toBe(true)
  })
})
