/**
 * ui/timeline.ts — Canvas2D show timeline.
 *
 * Rows: Pyro / Drones / Lasers / Panels / Crowd / Beams / Fountains / Lights /
 * Music (lane colors mirror core's gallery theme). A cue is drawn as a hatched
 * anticipation lead-in over [fireSec, targetSec] (the backward-solve made
 * visible) plus a solid block over [targetSec, targetSec + durationSec].
 * The music row shows downbeat ticks, phrase brackets, and annotation
 * diamonds (hit = gold, climax = red) with labels surfaced through the
 * canvas 'title' attribute via a hover map.
 *
 * Interaction: click/drag seeks; wheel zooms about the cursor (px/s clamped
 * to [MIN_PX_PER_SEC, MAX_PX_PER_SEC]); the view auto-follows the playhead
 * unless the user scrolled within the last FOLLOW_TIMEOUT_MS.
 *
 * All coordinate math is in the exported pure functions (xForT, tForX,
 * zoomAbout, followView) — tested headlessly.
 */

import type { CompiledCue, CompiledShow, Medium } from '@theodoor/core'

// ---------------------------------------------------------------------------
// Pure view math (tested)
// ---------------------------------------------------------------------------

export interface TimelineView {
  /** Show time at the left edge, seconds. */
  startSec: number
  /** Zoom, pixels per second. */
  pxPerSec: number
}

export const MIN_PX_PER_SEC = 2
export const MAX_PX_PER_SEC = 400
/** User scroll suppresses auto-follow for this long. */
export const FOLLOW_TIMEOUT_MS = 5000

export function xForT(t: number, view: TimelineView): number {
  return (t - view.startSec) * view.pxPerSec
}

export function tForX(x: number, view: TimelineView): number {
  return view.startSec + x / view.pxPerSec
}

/**
 * Zoom by factor zf keeping the time under cursor x = mxPx invariant.
 * pxPerSec clamps to [MIN_PX_PER_SEC, MAX_PX_PER_SEC].
 */
export function zoomAbout(view: TimelineView, mxPx: number, zf: number): TimelineView {
  const pxPerSec = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, view.pxPerSec * zf))
  const tUnderCursor = tForX(mxPx, view)
  return { startSec: tUnderCursor - mxPx / pxPerSec, pxPerSec }
}

/**
 * Auto-follow: when the playhead leaves the comfortable band
 * [start + 10% width, start + 80% width], scroll so it sits at 15%.
 */
export function followView(view: TimelineView, playheadSec: number, widthPx: number): TimelineView {
  const w = widthPx / view.pxPerSec
  const lo = view.startSec + 0.1 * w
  const hi = view.startSec + 0.8 * w
  if (playheadSec >= lo && playheadSec <= hi) return view
  return { startSec: playheadSec - 0.15 * w, pxPerSec: view.pxPerSec }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface Lane {
  label: string
  media: readonly Medium[]
  color: string
}

/**
 * Cue lanes, top to bottom (the music lane is appended last). Colors match
 * packages/core/src/gallery/theme.ts so the docs gallery and the live strip
 * agree on what each medium looks like.
 */
export const LANES: readonly Lane[] = [
  { label: 'Pyro', media: ['pyro', 'fabrication'], color: '#ff9d4d' },
  { label: 'Drones', media: ['drone'], color: '#4dc3ff' },
  { label: 'Lasers', media: ['laser'], color: '#7dff8a' },
  { label: 'Panels', media: ['panel'], color: '#d98cff' },
  { label: 'Crowd', media: ['crowd'], color: '#ffe08a' },
  { label: 'Beams', media: ['beam'], color: '#5ee6d0' },
  { label: 'Fountains', media: ['fountain'], color: '#5aa9ff' },
  { label: 'Lights', media: ['searchlight'], color: '#f3e6a8' },
]

export const MUSIC_COLOR = '#ffd24d'
const HIT_COLOR = '#ffd24d'
const CLIMAX_COLOR = '#ff5252'
const LABEL_GUTTER_PX = 66
const RULER_PX = 16

interface HoverSpot {
  x: number
  y: number
  label: string
}

export interface TimelineOptions {
  onSeek(t: number): void
  /** Millisecond clock (defaults to performance.now) — injectable for tests. */
  nowMs?: () => number
}

export class Timeline {
  private readonly canvas: HTMLCanvasElement
  private readonly compiled: CompiledShow
  private readonly onSeek: (t: number) => void
  private readonly nowMs: () => number
  private readonly startSec: number
  private readonly endSec: number
  private view: TimelineView
  private lastUserScrollMs = -Infinity
  private dragging = false
  private hoverSpots: HoverSpot[] = []
  private readonly unlisten: (() => void)[] = []

  constructor(canvas: HTMLCanvasElement, compiled: CompiledShow, opts: TimelineOptions) {
    this.canvas = canvas
    this.compiled = compiled
    this.onSeek = opts.onSeek
    this.nowMs = opts.nowMs ?? (() => performance.now())

    this.startSec = 0 - (compiled.show.preRollSec ?? 0)
    let end = compiled.show.music.duration
    for (const c of compiled.cues) end = Math.max(end, c.targetSec + c.durationSec)
    this.endSec = end

    const w = Math.max(1, canvas.clientWidth - LABEL_GUTTER_PX)
    const span = Math.max(1, this.endSec - this.startSec)
    this.view = {
      startSec: this.startSec,
      pxPerSec: Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, w / span)),
    }

    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opt?: AddEventListenerOptions,
    ): void => {
      canvas.addEventListener(type, fn as EventListener, opt)
      this.unlisten.push(() => canvas.removeEventListener(type, fn as EventListener))
    }

    on(
      'wheel',
      (e) => {
        e.preventDefault()
        const mx = this.eventX(e)
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const d = (e.deltaX || e.deltaY) / this.view.pxPerSec
          this.view = { ...this.view, startSec: this.view.startSec + d }
        } else {
          this.view = zoomAbout(this.view, mx, Math.pow(1.0015, -e.deltaY))
        }
        this.lastUserScrollMs = this.nowMs()
      },
      { passive: false },
    )
    on('mousedown', (e) => {
      this.dragging = true
      this.seekAt(this.eventX(e))
    })
    on('mousemove', (e) => {
      if (this.dragging) this.seekAt(this.eventX(e))
      else this.updateHover(this.eventX(e), e.offsetY)
    })
    on('mouseup', () => {
      this.dragging = false
    })
    on('mouseleave', () => {
      this.dragging = false
    })
  }

  dispose(): void {
    for (const un of this.unlisten) un()
    this.unlisten.length = 0
  }

  /** Draw the strip with the playhead at tSec. */
  draw(tSec: number): void {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    const cw = this.canvas.clientWidth
    const ch = this.canvas.clientHeight
    if (cw < 1 || ch < 1) return
    const bw = Math.round(cw * dpr)
    const bh = Math.round(ch * dpr)
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw
      this.canvas.height = bh
    }
    const g = this.canvas.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (this.nowMs() - this.lastUserScrollMs > FOLLOW_TIMEOUT_MS) {
      this.view = followView(this.view, tSec, cw - LABEL_GUTTER_PX)
    }

    g.clearRect(0, 0, cw, ch)
    g.fillStyle = 'rgba(5, 8, 22, 0.92)'
    g.fillRect(0, 0, cw, ch)

    const laneCount = LANES.length + 1 // + music
    const laneH = (ch - RULER_PX) / laneCount
    this.hoverSpots = []

    this.drawRuler(g, cw)

    // Lane separators + labels.
    g.font = '10px ui-monospace, Menlo, monospace'
    for (let i = 0; i < laneCount; i++) {
      const y = RULER_PX + i * laneH
      g.strokeStyle = 'rgba(120, 140, 190, 0.15)'
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(cw, y)
      g.stroke()
      const lane = i < LANES.length ? LANES[i]! : undefined
      g.fillStyle = lane ? lane.color : MUSIC_COLOR
      g.fillText(lane ? lane.label : 'Music', 6, y + 12)
    }

    // Cue blocks (tight lanes keep a 2 px gutter so nine rows still read).
    const pad = laneH >= 18 ? 4 : 2
    for (let i = 0; i < LANES.length; i++) {
      const lane = LANES[i]!
      const y = RULER_PX + i * laneH + pad
      const h = laneH - 2 * pad
      for (const cue of this.compiled.cues) {
        if (!lane.media.includes(cue.medium)) continue
        this.drawCue(g, cue, y, h, lane.color, cw)
      }
    }

    this.drawMusicLane(g, RULER_PX + LANES.length * laneH, laneH, cw)
    this.drawPlayhead(g, tSec, ch)
  }

  // -- internals --------------------------------------------------------------

  private eventX(e: MouseEvent): number {
    return e.offsetX - LABEL_GUTTER_PX
  }

  private x(t: number): number {
    return LABEL_GUTTER_PX + xForT(t, this.view)
  }

  private seekAt(mx: number): void {
    const t = Math.min(this.endSec, Math.max(this.startSec, tForX(mx, this.view)))
    // Scrubbing is user interaction: suppress auto-follow, or followView
    // re-centres between drag events and every mousemove seeks further ahead.
    this.lastUserScrollMs = this.nowMs()
    this.onSeek(t)
  }

  private updateHover(mx: number, my: number): void {
    const x = mx + LABEL_GUTTER_PX
    let label = ''
    for (const s of this.hoverSpots) {
      if (Math.abs(s.x - x) <= 6 && Math.abs(s.y - my) <= 8) {
        label = s.label
        break
      }
    }
    if (this.canvas.title !== label) this.canvas.title = label
  }

  private drawRuler(g: CanvasRenderingContext2D, cw: number): void {
    const stepCandidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120]
    let step = stepCandidates[stepCandidates.length - 1]!
    for (const s of stepCandidates) {
      if (s * this.view.pxPerSec >= 64) {
        step = s
        break
      }
    }
    g.font = '9px ui-monospace, Menlo, monospace'
    g.fillStyle = 'rgba(150, 165, 205, 0.7)'
    g.strokeStyle = 'rgba(120, 140, 190, 0.25)'
    const t0 = Math.floor(tForX(0, this.view) / step) * step
    const t1 = tForX(cw - LABEL_GUTTER_PX, this.view)
    for (let t = t0; t <= t1; t += step) {
      const x = this.x(t)
      if (x < LABEL_GUTTER_PX) continue
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, RULER_PX - 4)
      g.stroke()
      const sign = t < 0 ? '-' : ''
      const at = Math.abs(t)
      const mm = Math.floor(at / 60)
      const ss = Math.floor(at % 60)
      g.fillText(`${sign}${mm}:${String(ss).padStart(2, '0')}`, x + 2, 10)
    }
  }

  private drawCue(
    g: CanvasRenderingContext2D,
    cue: CompiledCue,
    y: number,
    h: number,
    color: string,
    cw: number,
  ): void {
    const xFire = this.x(cue.fireSec)
    const xLand = this.x(cue.targetSec)
    const xEnd = this.x(cue.targetSec + Math.max(cue.durationSec, 0.1))
    if (xEnd < LABEL_GUTTER_PX || xFire > cw) return

    // Hatched anticipation lead-in [fireSec, targetSec].
    if (xLand - xFire > 0.5) {
      g.save()
      g.beginPath()
      g.rect(xFire, y, xLand - xFire, h)
      g.clip()
      g.strokeStyle = color
      g.globalAlpha = 0.45
      g.lineWidth = 1
      for (let x = xFire - h; x < xLand; x += 5) {
        g.beginPath()
        g.moveTo(x, y + h)
        g.lineTo(x + h, y)
        g.stroke()
      }
      g.restore()
      g.globalAlpha = 1
    }

    // Solid body [targetSec, targetSec + durationSec].
    const wBody = Math.max(2, xEnd - xLand)
    g.fillStyle = color
    g.globalAlpha = 0.85
    g.fillRect(xLand, y, wBody, h)
    g.globalAlpha = 1
    this.hoverSpots.push({
      x: (xLand + Math.min(xEnd, xLand + 40)) / 2,
      y: y + h / 2,
      label: `${cue.id} · ${cue.effectId}`,
    })
  }

  private drawMusicLane(
    g: CanvasRenderingContext2D,
    y: number,
    laneH: number,
    cw: number,
  ): void {
    const music = this.compiled.show.music
    const midY = y + laneH / 2

    // Downbeat ticks.
    g.strokeStyle = 'rgba(255, 210, 77, 0.5)'
    for (const t of music.downbeats) {
      const x = this.x(t)
      if (x < LABEL_GUTTER_PX || x > cw) continue
      g.beginPath()
      g.moveTo(x, y + laneH - 10)
      g.lineTo(x, y + laneH - 2)
      g.stroke()
    }

    // Phrase brackets and annotation diamonds.
    for (const a of music.annotations) {
      const x = this.x(a.time)
      if (x < LABEL_GUTTER_PX - 20 || x > cw + 20) continue
      if (a.kind === 'phrase') {
        g.strokeStyle = 'rgba(255, 210, 77, 0.8)'
        g.beginPath()
        g.moveTo(x - 8, y + 6)
        g.lineTo(x, y + 6)
        g.lineTo(x, y + 16)
        g.stroke()
        if (a.label) this.hoverSpots.push({ x, y: y + 10, label: a.label })
      } else if (a.kind === 'hit' || a.kind === 'climax' || a.kind === 'accent') {
        const color = a.kind === 'climax' ? CLIMAX_COLOR : HIT_COLOR
        const r = a.kind === 'climax' ? 6 : 4
        g.fillStyle = color
        g.beginPath()
        g.moveTo(x, midY - r)
        g.lineTo(x + r, midY)
        g.lineTo(x, midY + r)
        g.lineTo(x - r, midY)
        g.closePath()
        g.fill()
        this.hoverSpots.push({ x, y: midY, label: a.label ?? a.kind })
      }
    }
  }

  private drawPlayhead(g: CanvasRenderingContext2D, tSec: number, ch: number): void {
    const x = this.x(tSec)
    if (x < LABEL_GUTTER_PX) return
    g.strokeStyle = '#f2f5ff'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, ch)
    g.stroke()
    g.fillStyle = '#f2f5ff'
    g.beginPath()
    g.moveTo(x - 4, 0)
    g.lineTo(x + 4, 0)
    g.lineTo(x, 6)
    g.closePath()
    g.fill()
  }
}
