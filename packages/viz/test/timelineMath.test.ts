/**
 * Timeline coordinate math: projection round trips, zoom-about-cursor
 * invariant, clamps, auto-follow — plus the transport bar's time formatting
 * and the HUD's SPL scale (all pure exports).
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  followView,
  tForX,
  xForT,
  zoomAbout,
} from '../src/ui/timeline.js'
import type { TimelineView } from '../src/ui/timeline.js'
import { fmtTime } from '../src/ui/transportBar.js'
import { SPL_MAX_DB, SPL_MIN_DB, splFrac } from '../src/ui/hud.js'

describe('xForT / tForX', () => {
  const view: TimelineView = { startSec: 12, pxPerSec: 20 }

  it('projects linearly from the view start', () => {
    expect(xForT(12, view)).toBe(0)
    expect(xForT(13, view)).toBe(20)
    expect(xForT(11.5, view)).toBe(-10)
  })

  it('round-trips both directions', () => {
    for (const t of [-4, 0, 12, 33.37, 610]) {
      expect(tForX(xForT(t, view), view)).toBeCloseTo(t, 9)
    }
    for (const x of [-100, 0, 1, 640, 1e4]) {
      expect(xForT(tForX(x, view), view)).toBeCloseTo(x, 9)
    }
  })
})

describe('zoomAbout', () => {
  it('keeps the time under the cursor invariant', () => {
    let view: TimelineView = { startSec: 5, pxPerSec: 10 }
    const mx = 137
    const tUnder = tForX(mx, view)
    for (const zf of [1.5, 1.5, 0.25, 3, 0.9]) {
      view = zoomAbout(view, mx, zf)
      expect(tForX(mx, view)).toBeCloseTo(tUnder, 9)
    }
  })

  it('multiplies pxPerSec by the factor inside the clamp range', () => {
    const view = zoomAbout({ startSec: 0, pxPerSec: 10 }, 0, 2)
    expect(view.pxPerSec).toBeCloseTo(20, 12)
  })

  it('clamps pxPerSec to [MIN_PX_PER_SEC, MAX_PX_PER_SEC]', () => {
    const zoomedOut = zoomAbout({ startSec: 0, pxPerSec: 4 }, 100, 1e-6)
    expect(zoomedOut.pxPerSec).toBe(MIN_PX_PER_SEC)
    const zoomedIn = zoomAbout({ startSec: 0, pxPerSec: 300 }, 100, 1e6)
    expect(zoomedIn.pxPerSec).toBe(MAX_PX_PER_SEC)
    // Invariant holds even when the factor was clamped.
    const before: TimelineView = { startSec: 7, pxPerSec: 300 }
    const after = zoomAbout(before, 50, 1e6)
    expect(tForX(50, after)).toBeCloseTo(tForX(50, before), 9)
  })

  it('zooming about x=0 keeps startSec fixed', () => {
    const view = zoomAbout({ startSec: 42, pxPerSec: 10 }, 0, 2)
    expect(view.startSec).toBeCloseTo(42, 12)
  })
})

describe('followView', () => {
  const view: TimelineView = { startSec: 0, pxPerSec: 10 } // 80 s across 800 px

  it('leaves the view alone while the playhead is inside the band', () => {
    expect(followView(view, 20, 800)).toEqual(view)
    expect(followView(view, 8, 800)).toEqual(view) // exactly at 10 %
    expect(followView(view, 64, 800)).toEqual(view) // exactly at 80 %
  })

  it('scrolls the playhead to 15 % when it leaves the band', () => {
    const ahead = followView(view, 70, 800)
    expect(xForT(70, ahead) / 800).toBeCloseTo(0.15, 9)
    const behind = followView(view, -5, 800)
    expect(xForT(-5, behind) / 800).toBeCloseTo(0.15, 9)
  })

  it('never changes the zoom', () => {
    expect(followView(view, 1000, 800).pxPerSec).toBe(view.pxPerSec)
  })
})

describe('fmtTime', () => {
  it('formats mm:ss.d', () => {
    expect(fmtTime(0)).toBe('0:00.0')
    expect(fmtTime(65.43)).toBe('1:05.4')
    expect(fmtTime(600)).toBe('10:00.0')
  })

  it('prefixes pre-roll (negative) times with a minus', () => {
    expect(fmtTime(-4.2)).toBe('-0:04.2')
  })
})

describe('splFrac', () => {
  it('maps the 40–140 dB scale to 0..1 and clamps', () => {
    expect(splFrac(SPL_MIN_DB)).toBe(0)
    expect(splFrac(SPL_MAX_DB)).toBe(1)
    expect(splFrac(90)).toBeCloseTo(0.5, 12)
    expect(splFrac(-Infinity)).toBe(0)
    expect(splFrac(500)).toBe(1)
  })
})
