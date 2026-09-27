/**
 * ui/hud.ts — always-on overlays:
 *   - the permanent amber '● SIMULATION' badge (no off switch, by design);
 *   - an SPL meter: vertical 40–140 dB bar fed by max(snapshot.splByListener)
 *     with a 1 s peak-hold, plus a red budget line and green/amber/red zones
 *     when the show carries a noise budget;
 *   - a carrier-exposure meter (beam shows only): worst-cell summed carrier
 *     this frame from snapshot.beams over the crowd-grid centroids
 *     (audio/beamMath.worstCellCarrierDb), scale 60–130 dB with an amber
 *     line at the dwell level (100) and a red line at the ceiling (110);
 *   - the audition-seat readout ('sit: Front-Center', beam shows only);
 *   - the ACT CAPTION: the program-note act the playhead is in (title +
 *     guest-facing note, from CompiledShow.acts via setActs), fading in and
 *     out at act boundaries through a CSS transition; hidden without notes;
 *   - a small FPS meter.
 */

import type { CompiledAct, SimSnapshot, Vec2 } from '@theodoor/core'
import { worstCellCarrierDb } from '../audio/beamMath.js'
import { h } from './dom.js'

export const SPL_MIN_DB = 40
export const SPL_MAX_DB = 140
/** Peak marker holds for this long, then decays. */
export const PEAK_HOLD_MS = 1000
/** Peak decay after the hold, dB per second. */
export const PEAK_DECAY_DB_PER_SEC = 30

/** Carrier-exposure meter scale + guide lines (see acoustics/exposure.ts). */
export const EXPOSURE_MIN_DB = 60
export const EXPOSURE_MAX_DB = 130
export const EXPOSURE_AMBER_DB = 100
export const EXPOSURE_RED_DB = 110

/** 0..1 position of a dB value on the SPL meter (clamped). */
export function splFrac(db: number): number {
  return meterFrac(db, SPL_MIN_DB, SPL_MAX_DB)
}

/** 0..1 position of a dB value on the exposure meter (clamped). */
export function exposureFrac(db: number): number {
  return meterFrac(db, EXPOSURE_MIN_DB, EXPOSURE_MAX_DB)
}

function meterFrac(db: number, minDb: number, maxDb: number): number {
  if (!Number.isFinite(db)) return 0
  return Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)))
}

/**
 * The act the playhead is in: the last act with fromSec ≤ t whose toSec is
 * still ahead (acts are sorted ascending by compile()). Undefined during the
 * pre-roll before the first act and after the last act ends.
 */
export function actAt(acts: readonly CompiledAct[], tSec: number): CompiledAct | undefined {
  let hit: CompiledAct | undefined
  for (const a of acts) {
    if (a.fromSec <= tSec && tSec < a.toSec) hit = a
  }
  return hit
}

/** Peak-hold state machine shared by both meters (hold, then decay). */
function makePeakTracker(nowMs: () => number, floorDb: number) {
  let peakDb = -Infinity
  let peakAtMs = -Infinity
  return {
    update(db: number): number {
      const t = nowMs()
      if (db >= peakDb) {
        peakDb = db
        peakAtMs = t
      } else if (t - peakAtMs > PEAK_HOLD_MS) {
        peakDb -= (PEAK_DECAY_DB_PER_SEC * (t - peakAtMs - PEAK_HOLD_MS)) / 1000
        peakAtMs = t - PEAK_HOLD_MS // decay incrementally from here
        if (peakDb < db) peakDb = db
        if (peakDb < floorDb - 10) peakDb = -Infinity
      }
      return peakDb
    },
  }
}

export interface Hud {
  el: HTMLElement
  /** Set/replace the budget line (undefined hides zones + line). */
  setBudget(maxSplDb: number | undefined): void
  /**
   * Cell centroids for the worst-cell carrier sweep. Undefined hides the
   * exposure meter (beam-less shows).
   */
  setExposureCells(cells: readonly Vec2[] | undefined): void
  /** Audition-seat readout label (null hides it). */
  setSeat(label: string | null): void
  /** Program-note acts for the caption overlay (empty hides it). */
  setActs(acts: readonly CompiledAct[]): void
  update(snapshot: SimSnapshot | null, fps: number): void
}

export function createHud(nowMs: () => number = () => performance.now()): Hud {
  const badge = h('div', { class: 'sim-badge' }, '● SIMULATION')
  const fpsMeter = h('div', { class: 'fps-meter' }, '– fps')
  const seatReadout = h('div', { class: 'hud-seat', hidden: true })
  const captionTitle = h('div', { class: 'hud-caption-title' })
  const captionNote = h('div', { class: 'hud-caption-note' })
  const caption = h('div', { class: 'hud-caption' }, captionTitle, captionNote)
  let captionKey = ''

  const meterCanvas = h('canvas', { class: 'spl-meter', width: '46', height: '220' })
  const exposureCanvas = h('canvas', {
    class: 'exposure-meter',
    width: '46',
    height: '220',
    hidden: true,
    title: 'Worst-cell summed carrier exposure',
  })
  const wrap = h(
    'div',
    { class: 'hud-root' },
    badge,
    fpsMeter,
    seatReadout,
    meterCanvas,
    exposureCanvas,
    caption,
  )

  let budgetDb: number | undefined
  let exposureCells: readonly Vec2[] | undefined
  /** Program-note acts (the caption overlay reads these against snapshot.t). */
  let currentActs: readonly CompiledAct[] = []
  const splPeak = makePeakTracker(nowMs, SPL_MIN_DB)
  const exposurePeak = makePeakTracker(nowMs, EXPOSURE_MIN_DB)
  let lastFpsText = ''

  interface BarLayout {
    barX: number
    barW: number
    barTop: number
    barH: number
  }

  const layoutOf = (canvas: HTMLCanvasElement): BarLayout => ({
    barX: 8,
    barW: 14,
    barTop: 14,
    barH: canvas.height - 28,
  })

  const drawSplMeter = (db: number, peakDb: number): void => {
    const g = meterCanvas.getContext('2d')
    if (!g) return
    const { barX, barW, barTop, barH } = layoutOf(meterCanvas)
    const yFor = (v: number): number => barTop + barH * (1 - splFrac(v))

    g.clearRect(0, 0, meterCanvas.width, meterCanvas.height)
    g.fillStyle = 'rgba(6, 10, 26, 0.75)'
    g.fillRect(0, 0, meterCanvas.width, meterCanvas.height)

    // Zones (only meaningful with a budget).
    if (budgetDb !== undefined) {
      const yBudget = yFor(budgetDb)
      const yWarn = yFor(budgetDb - 6)
      g.fillStyle = 'rgba(80, 200, 120, 0.18)'
      g.fillRect(barX, yWarn, barW, barTop + barH - yWarn)
      g.fillStyle = 'rgba(255, 176, 32, 0.2)'
      g.fillRect(barX, yBudget, barW, yWarn - yBudget)
      g.fillStyle = 'rgba(255, 82, 82, 0.22)'
      g.fillRect(barX, barTop, barW, yBudget - barTop)
    } else {
      g.fillStyle = 'rgba(120, 140, 190, 0.12)'
      g.fillRect(barX, barTop, barW, barH)
    }

    // Live bar.
    const yDb = yFor(db)
    let barColor = '#50c878'
    if (budgetDb !== undefined) {
      if (db > budgetDb) barColor = '#ff5252'
      else if (db > budgetDb - 6) barColor = '#ffb020'
    }
    g.fillStyle = barColor
    g.fillRect(barX, yDb, barW, barTop + barH - yDb)

    // Peak-hold marker.
    if (Number.isFinite(peakDb)) {
      g.fillStyle = '#f2f5ff'
      g.fillRect(barX, yFor(peakDb) - 1, barW, 2)
    }

    // Budget line.
    if (budgetDb !== undefined) {
      const y = yFor(budgetDb)
      g.strokeStyle = '#ff5252'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(barX - 4, y)
      g.lineTo(barX + barW + 4, y)
      g.stroke()
    }

    // Scale labels.
    g.font = '8px ui-monospace, Menlo, monospace'
    g.fillStyle = 'rgba(150, 165, 205, 0.8)'
    for (const v of [40, 60, 80, 100, 120, 140]) {
      g.fillText(String(v), barX + barW + 4, yFor(v) + 3)
    }
    g.fillStyle = 'rgba(150, 165, 205, 0.9)'
    g.fillText('dB', barX + barW + 4, meterCanvas.height - 3)
  }

  const drawExposureMeter = (db: number, peakDb: number): void => {
    const g = exposureCanvas.getContext('2d')
    if (!g) return
    const { barX, barW, barTop, barH } = layoutOf(exposureCanvas)
    const yFor = (v: number): number => barTop + barH * (1 - exposureFrac(v))

    g.clearRect(0, 0, exposureCanvas.width, exposureCanvas.height)
    g.fillStyle = 'rgba(6, 10, 26, 0.75)'
    g.fillRect(0, 0, exposureCanvas.width, exposureCanvas.height)

    // Zones: quiet below amber, warning band, red above the ceiling.
    const yAmber = yFor(EXPOSURE_AMBER_DB)
    const yRed = yFor(EXPOSURE_RED_DB)
    g.fillStyle = 'rgba(80, 200, 120, 0.18)'
    g.fillRect(barX, yAmber, barW, barTop + barH - yAmber)
    g.fillStyle = 'rgba(255, 176, 32, 0.2)'
    g.fillRect(barX, yRed, barW, yAmber - yRed)
    g.fillStyle = 'rgba(255, 82, 82, 0.22)'
    g.fillRect(barX, barTop, barW, yRed - barTop)

    // Live bar.
    let barColor = '#50c878'
    if (db > EXPOSURE_RED_DB) barColor = '#ff5252'
    else if (db > EXPOSURE_AMBER_DB) barColor = '#ffb020'
    g.fillStyle = barColor
    const yDb = yFor(db)
    g.fillRect(barX, yDb, barW, barTop + barH - yDb)

    // Peak-hold marker.
    if (Number.isFinite(peakDb)) {
      g.fillStyle = '#f2f5ff'
      g.fillRect(barX, yFor(peakDb) - 1, barW, 2)
    }

    // Guide lines: amber at the dwell level, red at the ceiling.
    g.strokeStyle = '#ffb020'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(barX - 4, yAmber)
    g.lineTo(barX + barW + 4, yAmber)
    g.stroke()
    g.strokeStyle = '#ff5252'
    g.beginPath()
    g.moveTo(barX - 4, yRed)
    g.lineTo(barX + barW + 4, yRed)
    g.stroke()

    // Scale labels + meter label.
    g.font = '8px ui-monospace, Menlo, monospace'
    g.fillStyle = 'rgba(150, 165, 205, 0.8)'
    for (const v of [60, 80, 100, 110, 130]) {
      g.fillText(String(v), barX + barW + 4, yFor(v) + 3)
    }
    g.fillStyle = 'rgba(120, 200, 210, 0.9)'
    g.fillText('carrier', 4, exposureCanvas.height - 3)
  }

  return {
    el: wrap,
    setBudget(maxSplDb): void {
      budgetDb = maxSplDb
    },
    setExposureCells(cells): void {
      exposureCells = cells
      if (cells) exposureCanvas.removeAttribute('hidden')
      else exposureCanvas.setAttribute('hidden', '')
    },
    setSeat(label): void {
      if (label === null) {
        seatReadout.setAttribute('hidden', '')
        seatReadout.textContent = ''
      } else {
        seatReadout.removeAttribute('hidden')
        seatReadout.textContent = `sit: ${label}`
      }
    },
    setActs(acts): void {
      currentActs = acts
      captionKey = ''
      caption.classList.remove('visible')
    },
    update(snapshot, fps): void {
      let db = -Infinity
      if (snapshot) {
        for (const v of snapshot.splByListener) if (v > db) db = v
      }
      drawSplMeter(db, splPeak.update(db))

      if (exposureCells) {
        const carrierDb =
          snapshot && snapshot.beams.length > 0
            ? worstCellCarrierDb(snapshot.beams, exposureCells)
            : -Infinity
        drawExposureMeter(carrierDb, exposurePeak.update(carrierDb))
      }

      const text = `${Math.round(fps)} fps`
      if (text !== lastFpsText) {
        fpsMeter.textContent = text
        lastFpsText = text
      }

      // Act caption: only touch the DOM when the act changes.
      const act = snapshot && currentActs.length > 0 ? actAt(currentActs, snapshot.t) : undefined
      const key = act ? `${act.fromSec}|${act.title}` : ''
      if (key !== captionKey) {
        captionKey = key
        if (act) {
          captionTitle.textContent = act.title
          captionNote.textContent = act.note
          caption.classList.add('visible')
        } else {
          caption.classList.remove('visible')
        }
      }
    },
  }
}
