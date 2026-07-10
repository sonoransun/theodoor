import { describe, expect, it } from 'vitest'
import { Transport } from '../src/transport/index.js'
import { SimEngine, runHeadless } from '../src/sim/index.js'
import { hashSnapshot, makeCompiled, sixCueShow } from './sim-fixture.js'

describe('sim/engine — stepping & determinism', () => {
  it('chunked advance: one advanceTo(5) vs 600 uneven steps → identical snapshot', () => {
    const one = new SimEngine(sixCueShow())
    one.advanceTo(5)

    const many = new SimEngine(sixCueShow())
    let t = 0
    for (let i = 1; i <= 600; i++) {
      // Uneven, non-monotone-increment chunks that still end exactly at 5.
      t = 5 * Math.pow(i / 600, 1.37)
      many.advanceTo(t)
    }
    expect(many.snapshot().step).toBe(one.snapshot().step)
    expect(hashSnapshot(many.snapshot())).toBe(hashSnapshot(one.snapshot()))
  })

  it('reset + advanceTo(12) equals a fresh engine advanceTo(12)', () => {
    const fresh = new SimEngine(sixCueShow())
    fresh.advanceTo(12)
    const freshHash = hashSnapshot(fresh.snapshot())

    const reused = new SimEngine(sixCueShow())
    reused.advanceTo(30)
    reused.reset()
    reused.advanceTo(12)
    expect(hashSnapshot(reused.snapshot())).toBe(freshHash)
  })

  it('seeking backward re-simulates deterministically (advanceTo past, then earlier)', () => {
    const fresh = new SimEngine(sixCueShow())
    fresh.advanceTo(12)

    const scrubbed = new SimEngine(sixCueShow())
    scrubbed.advanceTo(30)
    scrubbed.advanceTo(12) // backward → internal full re-sim from t0
    expect(hashSnapshot(scrubbed.snapshot())).toBe(hashSnapshot(fresh.snapshot()))
  })

  it('starts at t0 = -(preRollSec) and steps land on multiples of 1/stepHz', () => {
    const compiled = makeCompiled(
      [
        { id: 'p-neg', trackId: 'trk-pyro', medium: 'pyro', effectId: 'peony-75-red',
          positionId: 'rack-1', targetSec: 1, anticipationSec: 2.2, durationSec: 1.8 },
      ],
      { preRollSec: 2 },
    )
    const engine = new SimEngine(compiled)
    expect(engine.startSec).toBe(-2)
    expect(engine.snapshot().t).toBe(-2)
    expect(engine.snapshot().step).toBe(0)
    // Cue fires at -1.2 during pre-roll; the shell is ascending at t = -0.5.
    engine.advanceTo(-0.5)
    expect(engine.snapshot().shells.count).toBe(1)
  })
})

describe('sim/engine — transport attach', () => {
  it('play/advance through a Transport drives identical results to direct advanceTo', () => {
    const compiled = sixCueShow()
    const transport = new Transport(compiled)
    const attached = new SimEngine(compiled)
    const detach = attached.attach(transport)

    transport.play()
    // Uneven host frame times.
    for (let i = 0; i < 200; i++) transport.advance(0.02 + 0.017 * ((i * 7) % 5))
    const tEnd = transport.timeSec
    expect(tEnd).toBeGreaterThan(5)

    const direct = new SimEngine(compiled)
    direct.advanceTo(tEnd)
    expect(hashSnapshot(attached.snapshot())).toBe(hashSnapshot(direct.snapshot()))
    detach()
  })

  it('transport seek back re-simulates; result equals a fresh engine at the seek target', () => {
    const compiled = sixCueShow()
    const transport = new Transport(compiled)
    const engine = new SimEngine(compiled)
    engine.attach(transport)

    transport.play()
    for (let i = 0; i < 300; i++) transport.advance(0.1) // → t = 30
    transport.seek(12)
    const fresh = new SimEngine(compiled)
    fresh.advanceTo(12)
    expect(hashSnapshot(engine.snapshot())).toBe(hashSnapshot(fresh.snapshot()))
  })

  it('detaching stops the engine from following the transport', () => {
    const compiled = sixCueShow()
    const transport = new Transport(compiled)
    const engine = new SimEngine(compiled)
    const detach = engine.attach(transport)
    transport.play()
    transport.advance(1)
    const stepAt1 = engine.snapshot().step
    detach()
    transport.advance(5)
    expect(engine.snapshot().step).toBe(stepAt1)
  })
})

describe('sim/engine — SPL & headless stats', () => {
  it('splByListener is nonzero during a burst window and -Infinity outside', () => {
    const engine = new SimEngine(sixCueShow())
    // t=2: nothing audible yet (peony bursts at 4).
    engine.advanceTo(2)
    for (const db of engine.snapshot().splByListener) expect(db).toBe(-Infinity)
    // t=4.5: inside the peony noise window [4, 5.8).
    engine.advanceTo(4.5)
    const during = engine.snapshot().splByListener
    expect(during.length).toBe(3)
    for (const db of during) {
      expect(Number.isFinite(db)).toBe(true)
      expect(db).toBeGreaterThan(60)
    }
    // t=38: every window has closed again.
    engine.advanceTo(38)
    for (const db of engine.snapshot().splByListener) expect(db).toBe(-Infinity)
  })

  it('the salute spikes SPL only within its impulse window', () => {
    const engine = new SimEngine(sixCueShow())
    engine.advanceTo(20.1) // salute window [20, 20.3)
    const peak = Math.max(...engine.snapshot().splByListener)
    expect(peak).toBeGreaterThan(110)
    engine.advanceTo(21)
    const after = Math.max(...engine.snapshot().splByListener)
    expect(after).toBeLessThan(peak - 30)
  })

  it('runHeadless returns sane stats and zero warnings on the clean fixture', () => {
    const { stats, engine } = runHeadless(sixCueShow())
    expect(engine.warnings()).toEqual([])
    expect(stats.warningCount).toBe(0)
    expect(stats.peakStars).toBeGreaterThan(0)
    expect(stats.peakDrones).toBe(60)
    expect(stats.minSeparationM).toBeGreaterThan(2)
    expect(stats.landingAccuracyM).toBeLessThan(0.1)
    expect(stats.splPeakByListener.length).toBe(3)
    for (const db of stats.splPeakByListener) expect(db).toBeGreaterThan(100)
    expect(stats.steps).toBe(40 * 120 + 1) // duration 40 s at 120 Hz + step 0
  })

  it('runHeadless is deterministic (identical stats objects)', () => {
    const a = runHeadless(sixCueShow(), { toSec: 25 }).stats
    const b = runHeadless(sixCueShow(), { toSec: 25 }).stats
    expect(b).toEqual(a)
  })

  it('rejects non-starter catalogs without an explicit getEffect', () => {
    const compiled = sixCueShow()
    const other = {
      ...compiled,
      show: { ...compiled.show, catalogId: 'custom-cat' },
    }
    expect(() => new SimEngine(other)).toThrow(/getEffect/)
  })
})
