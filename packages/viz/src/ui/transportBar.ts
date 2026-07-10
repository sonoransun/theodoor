/**
 * ui/transportBar.ts — play/pause, ±10 s skip, rate buttons, time readout.
 * Pure DOM (no framework); the app wires the callbacks to the AudioClock,
 * which delegates to the core Transport (the single source of truth).
 */

import { h } from './dom.js'

export const SKIP_SEC = 10
export const RATES: readonly number[] = [0.5, 1, 2]

/** mm:ss.d, negative times (pre-roll) prefixed with '-'. */
export function fmtTime(t: number): string {
  const sign = t < 0 ? '-' : ''
  const at = Math.abs(t)
  const mm = Math.floor(at / 60)
  const ss = Math.floor(at % 60)
  const d = Math.floor((at % 1) * 10)
  return `${sign}${mm}:${String(ss).padStart(2, '0')}.${d}`
}

export interface TransportBarCallbacks {
  onPlayPause(): void
  onSkip(deltaSec: number): void
  onRate(rate: number): void
}

export interface TransportBar {
  el: HTMLElement
  update(tSec: number, durationSec: number, playing: boolean, rate: number): void
  setEnabled(enabled: boolean): void
}

export function createTransportBar(cb: TransportBarCallbacks): TransportBar {
  const playBtn = h('button', { class: 'tb-btn tb-play', title: 'Play/Pause (space)' }, '▶')
  const backBtn = h('button', { class: 'tb-btn', title: `Back ${SKIP_SEC}s` }, `−${SKIP_SEC}s`)
  const fwdBtn = h('button', { class: 'tb-btn', title: `Forward ${SKIP_SEC}s` }, `+${SKIP_SEC}s`)
  const readout = h('span', { class: 'tb-time' }, '0:00.0 / 0:00.0')

  const rateBtns = RATES.map((r) =>
    h('button', { class: 'tb-btn tb-rate', 'data-rate': String(r) }, `${r}×`),
  )

  playBtn.addEventListener('click', () => cb.onPlayPause())
  backBtn.addEventListener('click', () => cb.onSkip(-SKIP_SEC))
  fwdBtn.addEventListener('click', () => cb.onSkip(SKIP_SEC))
  rateBtns.forEach((btn, i) => btn.addEventListener('click', () => cb.onRate(RATES[i]!)))

  const el = h('div', { class: 'transport-bar' }, backBtn, playBtn, fwdBtn, ...rateBtns, readout)

  let lastText = ''
  return {
    el,
    update(tSec, durationSec, playing, rate): void {
      const text = `${fmtTime(tSec)} / ${fmtTime(durationSec)}`
      if (text !== lastText) {
        readout.textContent = text
        lastText = text
      }
      const glyph = playing ? '❚❚' : '▶'
      if (playBtn.textContent !== glyph) playBtn.textContent = glyph
      rateBtns.forEach((btn, i) => {
        btn.classList.toggle('tb-active', Math.abs(RATES[i]! - rate) < 1e-9)
      })
    },
    setEnabled(enabled): void {
      el.classList.toggle('tb-disabled', !enabled)
      for (const b of [playBtn, backBtn, fwdBtn, ...rateBtns]) {
        ;(b as HTMLButtonElement).disabled = !enabled
      }
    },
  }
}
