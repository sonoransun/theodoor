import { describe, expect, it } from 'vitest'
import {
  AuditLog,
  canonicalJson,
  entryHash,
  GENESIS_HASH,
  hex8,
  siteHash,
  verifyEntries,
  type AuditEntry,
} from '../src/safety/index.js'
import { fnv1a32 } from '../src/math/index.js'
import type { SitePlan } from '../src/contracts.js'

function makeLog(n = 4): AuditLog {
  const log = new AuditLog()
  const states = ['DISARMED', 'ARMED', 'LIVE', 'ARMED', 'DISARMED'] as const
  for (let i = 0; i < n; i++) {
    log.append({
      tMs: 1_000 + i,
      from: states[Math.min(i, states.length - 2)],
      to: states[Math.min(i + 1, states.length - 1)],
      actor: 'alex',
      reason: `step ${i}`,
      ...(i === 0
        ? { interlocks: [{ id: 'wind-limit', satisfied: true, detail: 'wind 4 m/s under limit 9 m/s' }] }
        : {}),
    })
  }
  return log
}

describe('hex8 / canonicalJson', () => {
  it('hex8 zero-pads to 8 lower-case hex digits', () => {
    expect(hex8(0)).toBe('00000000')
    expect(hex8(255)).toBe('000000ff')
    expect(hex8(0xdeadbeef)).toBe('deadbeef')
    expect(hex8(-1)).toBe('ffffffff') // uint32 wrap
  })

  it('canonicalJson sorts keys recursively and omits undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(canonicalJson({ b: 1, a: undefined })).toBe('{"b":1}')
    expect(canonicalJson([1, 'x', null, { z: 1, y: 2 }])).toBe('[1,"x",null,{"y":2,"z":1}]')
    expect(canonicalJson('plain')).toBe('"plain"')
    expect(canonicalJson(null)).toBe('null')
  })

  it('key order does not affect the serialization', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
  })
})

describe('AuditLog chain', () => {
  it('genesis prevHash is 00000000 and hashes recompute by the documented formula', () => {
    const log = makeLog(3)
    const [e0, e1] = log.entries()
    expect(e0.prevHash).toBe(GENESIS_HASH)
    const { hash: h0, ...body0 } = e0
    expect(h0).toBe(hex8(fnv1a32(e0.prevHash + canonicalJson(body0))))
    expect(h0).toBe(entryHash(body0))
    expect(e1.prevHash).toBe(h0) // links
    expect(log.verifyChain()).toEqual({ ok: true })
  })

  it('append assigns sequential seq and returns frozen copies', () => {
    const log = makeLog(3)
    const entries = log.entries()
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2])
    expect(Object.isFrozen(entries)).toBe(true)
    expect(Object.isFrozen(entries[0])).toBe(true)
    expect(Object.isFrozen(entries[0].interlocks)).toBe(true)
    expect(Object.isFrozen(entries[0].interlocks![0])).toBe(true)
    expect(() => {
      ;(entries[0] as { reason: string }).reason = 'forged'
    }).toThrow()
    // Mutating a returned copy (even if it were possible) cannot reach the chain:
    expect(log.verifyChain()).toEqual({ ok: true })
  })

  it('empty log verifies and serializes to the empty string', () => {
    const log = new AuditLog()
    expect(log.verifyChain()).toEqual({ ok: true })
    expect(log.toJsonLines()).toBe('')
    expect(AuditLog.fromJsonLines('').entries().length).toBe(0)
  })
})

describe('tamper evidence', () => {
  const parseLines = (text: string): AuditEntry[] =>
    text
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as AuditEntry)

  it('editing ANY serialized entry breaks verifyChain at exactly that index', () => {
    const log = makeLog(4)
    const clean = log.toJsonLines()
    for (let i = 0; i < 4; i++) {
      const entries = parseLines(clean)
      entries[i].reason = entries[i].reason + ' [edited]'
      expect(verifyEntries(entries)).toEqual({ ok: false, brokenAt: i })
    }
  })

  it('tampering different fields (tMs, actor, from, interlocks) is caught', () => {
    const clean = parseLines(makeLog(4).toJsonLines())
    const cases: ((e: AuditEntry[]) => void)[] = [
      (e) => void (e[1].tMs = e[1].tMs + 1),
      (e) => void (e[2].actor = 'mallory'),
      (e) => void (e[3].from = 'LIVE'),
      (e) => void ((e[0].interlocks as { satisfied: boolean }[])[0].satisfied = false),
    ]
    const at = [1, 2, 3, 0]
    cases.forEach((mutate, idx) => {
      const entries = parseLines(makeLog(4).toJsonLines())
      mutate(entries)
      expect(verifyEntries(entries)).toEqual({ ok: false, brokenAt: at[idx] })
      void clean
    })
  })

  it('recomputing a tampered hash still breaks the chain at the NEXT link', () => {
    const entries = parseLines(makeLog(4).toJsonLines())
    entries[1].reason = 'forged'
    const { hash: _old, ...body } = entries[1]
    entries[1].hash = entryHash(body) // attacker re-hashes the edited entry
    expect(verifyEntries(entries)).toEqual({ ok: false, brokenAt: 2 })
  })

  it('deleting or reordering entries breaks the chain', () => {
    const dropped = parseLines(makeLog(4).toJsonLines())
    dropped.splice(2, 1)
    expect(verifyEntries(dropped).ok).toBe(false)
    const swapped = parseLines(makeLog(4).toJsonLines())
    ;[swapped[1], swapped[2]] = [swapped[2], swapped[1]]
    expect(verifyEntries(swapped)).toEqual({ ok: false, brokenAt: 1 })
  })
})

describe('JSONL round-trip', () => {
  it('preserves the chain byte-for-byte', () => {
    const log = makeLog(4)
    const text = log.toJsonLines()
    const restored = AuditLog.fromJsonLines(text)
    expect(restored.verifyChain()).toEqual({ ok: true })
    expect(restored.entries()).toEqual(log.entries())
    expect(restored.toJsonLines()).toBe(text)
  })

  it('fromJsonLines rejects a tampered log and names the broken entry', () => {
    const log = makeLog(3)
    const lines = log.toJsonLines().split('\n').filter((l) => l.length > 0)
    const entry = JSON.parse(lines[1]) as AuditEntry
    entry.actor = 'mallory'
    lines[1] = JSON.stringify(entry)
    expect(() => AuditLog.fromJsonLines(lines.join('\n'))).toThrow(/broken at entry 1/)
  })

  it('tolerates CRLF and blank lines', () => {
    const log = makeLog(2)
    const text = log.toJsonLines().replace(/\n/g, '\r\n') + '\r\n\r\n'
    expect(AuditLog.fromJsonLines(text).entries().length).toBe(2)
  })
})

describe('siteHash', () => {
  function makeSite(): SitePlan {
    return {
      id: 'riverfront',
      assets: [
        {
          id: 'rack-1',
          kind: 'mortarRack',
          pos: { x: 0, y: 120 },
          headingDeg: 0,
          elevationM: 2,
          rack: { calibersMm: [75, 100], tiltDeg: 5, pinsPerModule: 32, maxSimultaneousPins: 8 },
        },
        {
          id: 'pad-1',
          kind: 'dronePad',
          pos: { x: -40, y: 100 },
          headingDeg: 0,
          elevationM: 2,
          fleet: { count: 60, vMaxMps: 8, aMaxMps2: 3, rMinM: 2.5 },
        },
      ],
      audience: [
        { x: -60, y: 0 },
        { x: 60, y: 0 },
      ],
      audienceZone: [
        { x: -60, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: -40 },
        { x: -60, y: -40 },
      ],
      exclusionZones: [
        {
          id: 'marina',
          poly: [
            { x: 80, y: 80 },
            { x: 120, y: 80 },
            { x: 120, y: 140 },
            { x: 80, y: 140 },
          ],
        },
      ],
      geofence: [
        { x: -80, y: 60 },
        { x: 80, y: 60 },
        { x: 80, y: 200 },
        { x: -80, y: 200 },
      ],
      maxAltitudeM: 120,
      wind: { dirDegFrom: 270, speedMps: 4, limitMps: 9 },
      refListenerPos: [{ x: 0, y: -10 }],
    }
  }

  it('is stable: equal plans hash equal, hex8 format', () => {
    expect(siteHash(makeSite())).toBe(siteHash(makeSite()))
    expect(siteHash(makeSite())).toMatch(/^[0-9a-f]{8}$/)
  })

  it('ignores object key order (canonical JSON)', () => {
    const site = makeSite()
    const reordered = {
      wind: site.wind,
      refListenerPos: site.refListenerPos,
      maxAltitudeM: site.maxAltitudeM,
      geofence: site.geofence,
      exclusionZones: site.exclusionZones,
      audienceZone: site.audienceZone,
      audience: site.audience,
      assets: site.assets,
      id: site.id,
    } as SitePlan
    expect(siteHash(reordered)).toBe(siteHash(site))
  })

  const mutations: [string, (s: SitePlan) => void][] = [
    ['id', (s) => void ((s as { id: string }).id = 'lakeside')],
    ['asset pos.x', (s) => void ((s.assets[0].pos as { x: number }).x += 0.5)],
    ['asset headingDeg', (s) => void ((s.assets[0] as { headingDeg: number }).headingDeg = 10)],
    ['rack tiltDeg', (s) => void ((s.assets[0].rack as { tiltDeg: number }).tiltDeg = 6)],
    ['rack caliber', (s) => void ((s.assets[0].rack!.calibersMm as number[])[0] = 62)],
    ['fleet count', (s) => void ((s.assets[1].fleet as { count: number }).count = 61)],
    ['audience vertex', (s) => void ((s.audience[0] as { x: number }).x = -61)],
    ['audienceZone vertex', (s) => void ((s.audienceZone[2] as { y: number }).y = -41)],
    ['exclusion zone id', (s) => void ((s.exclusionZones[0] as { id: string }).id = 'dock')],
    ['exclusion poly vertex', (s) => void ((s.exclusionZones[0].poly[0] as { x: number }).x = 81)],
    ['geofence vertex', (s) => void ((s.geofence[3] as { y: number }).y = 201)],
    ['maxAltitudeM', (s) => void ((s as { maxAltitudeM: number }).maxAltitudeM = 121)],
    ['wind.dirDegFrom', (s) => void ((s.wind as { dirDegFrom: number }).dirDegFrom = 271)],
    ['wind.speedMps', (s) => void ((s.wind as { speedMps: number }).speedMps = 4.1)],
    ['wind.limitMps', (s) => void ((s.wind as { limitMps: number }).limitMps = 10)],
    ['refListenerPos', (s) => void ((s.refListenerPos[0] as { y: number }).y = -11)],
  ]

  for (const [label, mutate] of mutations) {
    it(`changes when ${label} changes`, () => {
      const base = siteHash(makeSite())
      const edited = makeSite()
      mutate(edited)
      expect(siteHash(edited)).not.toBe(base)
    })
  }
})
