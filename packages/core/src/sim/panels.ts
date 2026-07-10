/**
 * sim/panels.ts — procedural panel patterns → RGB frame buffers.
 *
 * Frames render at the pattern's native fps into row-major w*h*3 Uint8Arrays
 * and are cached by (cue, frameIndex): renderPanelFrame is a PURE function of
 * the frame index (local time = frameIdx / fps; any beat-locked or
 * energy-driven term uses tShow = targetSec + frameIdx / fps), so cached
 * frames are exact and the cache survives engine resets without affecting
 * determinism.
 */

import type {
  CompiledCue,
  CompiledShow,
  MusicalTimeline,
  PanelPattern,
  PanelSpec,
  Seconds,
} from '../contracts.js'
import type { EffectLookup } from '../acoustics/index.js'
import { clamp, fnv1a32, hexToRgb, mulberry32, smoothstep } from '../math/index.js'
import { energyAt } from '../music/index.js'
import { textCells } from '../text/index.js'
import { beatPhase } from './lasers.js'

/** Default strobe rate when no params.hz is given. */
export const DEFAULT_STROBE_HZ = 8
/** Default ticker speed, pixels per beat. */
export const DEFAULT_SPEED_PX_PER_BEAT = 4
/** Default ticker message when the cue carries no text param. */
export const DEFAULT_TICKER_TEXT = 'THEODOOR'

type Rgb = readonly [number, number, number]

/** rgb/rgb2 param: [r,g,b] tuple 0..1 or '#rrggbb' hex string, else fallback. */
export function paramRgb(
  cue: CompiledCue,
  key: string,
  fallback: Rgb,
): Rgb {
  const v = cue.params?.[key]
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')) {
    return [clamp(v[0]!, 0, 1), clamp(v[1]!, 0, 1), clamp(v[2]!, 0, 1)]
  }
  if (typeof v === 'string') return hexToRgb(v)
  return fallback
}

const hash01 = (s: string): number => fnv1a32(s) / 4294967296

/**
 * Render one panel frame: row-major w*h*3 bytes. Pure function of
 * (effect, cue, frameIdx, dims, timeline) — see module doc.
 */
export function renderPanelFrame(
  effect: PanelPattern,
  cue: CompiledCue,
  frameIdx: number,
  dims: PanelSpec,
  timeline: MusicalTimeline,
): Uint8Array {
  const w = dims.wPx
  const h = dims.hPx
  const out = new Uint8Array(w * h * 3)
  const tLocal = frameIdx / effect.fps
  const tShow = cue.targetSec + tLocal
  const rgb = paramRgb(cue, 'rgb', [1, 1, 1])
  const rgb2 = paramRgb(cue, 'rgb2', [0, 0, 0])

  const set = (x: number, y: number, r: number, g: number, b: number): void => {
    const i = (y * w + x) * 3
    out[i] = Math.round(clamp(r, 0, 1) * 255)
    out[i + 1] = Math.round(clamp(g, 0, 1) * 255)
    out[i + 2] = Math.round(clamp(b, 0, 1) * 255)
  }

  switch (effect.pattern) {
    case 'solid': {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, rgb[0], rgb[1], rgb[2])
      break
    }

    case 'aurora': {
      // Vertical curtain: per-column luminance from two drifting sine ripples,
      // blended rgb (top) → rgb2 (bottom) down each column.
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w
        const lum = clamp(
          0.45
            + 0.35 * Math.sin(2 * Math.PI * (1.7 * u - 0.12 * tLocal))
            + 0.2 * Math.sin(2 * Math.PI * (3.1 * u + 0.07 * tLocal)),
          0, 1,
        )
        for (let y = 0; y < h; y++) {
          const v = h === 1 ? 0 : y / (h - 1)
          set(
            x, y,
            (rgb[0] * (1 - v) + rgb2[0] * v) * lum,
            (rgb[1] * (1 - v) + rgb2[1] * v) * lum,
            (rgb[2] * (1 - v) + rgb2[2] * v) * lum,
          )
        }
      }
      break
    }

    case 'gradientWipe': {
      // Wipe left → right once over the effect duration (or per periodBeats).
      const periodBeats = typeof cue.params?.periodBeats === 'number' ? cue.params.periodBeats : 0
      const p = periodBeats > 0
        ? beatPhase(timeline.beats, tShow) / periodBeats - Math.floor(beatPhase(timeline.beats, tShow) / periodBeats)
        : clamp(tLocal / effect.durationSec, 0, 1)
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w
        const lit = 1 - smoothstep(p - 0.08, p + 0.08, u)
        const r = rgb[0] * lit + rgb2[0] * (1 - lit)
        const g = rgb[1] * lit + rgb2[1] * (1 - lit)
        const b = rgb[2] * lit + rgb2[2] * (1 - lit)
        for (let y = 0; y < h; y++) set(x, y, r, g, b)
      }
      break
    }

    case 'embers': {
      // Rising sparks: seeded particles climb from a faint warm bed on the
      // bottom row, swaying slightly and cooling rgb (hot) → rgb2 with height.
      for (let x = 0; x < w; x++) {
        const bed = 0.1 + 0.08 * hash01(`${cue.seed}:bed:${x}`)
        set(x, h - 1, rgb[0] * bed, rgb[1] * bed, rgb[2] * bed)
      }
      const count = Math.max(6, Math.round((w * h) / 24))
      for (let i = 0; i < count; i++) {
        const rng = mulberry32(fnv1a32(`${cue.seed}:ember:${i}`))
        const x0 = rng() * w
        const period = 2 + rng() * 3 // seconds bottom → top
        const phase0 = rng()
        const swayPx = 0.5 + rng() * 1.5
        const u = (tLocal / period + phase0) % 1 // 0 bottom → 1 top
        const x = Math.floor(x0 + swayPx * Math.sin(2 * Math.PI * (2 * u + phase0)))
        const y = Math.floor((h - 1) * (1 - u))
        if (x < 0 || x >= w || y < 0 || y >= h) continue
        const fade = 1 - 0.65 * u // embers dim as they cool
        set(
          x, y,
          (rgb[0] * (1 - u) + rgb2[0] * u) * fade,
          (rgb[1] * (1 - u) + rgb2[1] * u) * fade,
          (rgb[2] * (1 - u) + rgb2[2] * u) * fade,
        )
      }
      break
    }

    case 'starfield': {
      // Sparse seeded stars twinkling and drifting slowly (wrapping at the
      // edges), plus one shooting star streaking across every few seconds.
      const count = Math.max(8, Math.round((w * h) / 40))
      for (let i = 0; i < count; i++) {
        const rng = mulberry32(fnv1a32(`${cue.seed}:star:${i}`))
        const x0 = rng() * w
        const y0 = rng() * h
        const dx = (rng() - 0.5) * 1.2 // px/s
        const dy = (rng() - 0.5) * 0.6
        const twinkleHz = 0.5 + rng() * 1.5
        const ph = rng()
        const x = Math.floor((((x0 + dx * tLocal) % w) + w) % w)
        const y = Math.floor((((y0 + dy * tLocal) % h) + h) % h)
        const lum = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (twinkleHz * tLocal + ph)))
        set(x, y, rgb[0] * lum, rgb[1] * lum, rgb[2] * lum)
      }
      const SHOOT_EVERY = 4 // one streak per window, seeded trajectory
      const STREAK = 0.7
      const pass = Math.floor(tLocal / SHOOT_EVERY)
      const uSh = (tLocal - pass * SHOOT_EVERY) / STREAK
      if (uSh <= 1) {
        const rng = mulberry32(fnv1a32(`${cue.seed}:shoot:${pass}`))
        const yA = rng() * h * 0.6
        const slope = (rng() - 0.5) * 0.5 // px of drop per px of travel
        const headX = uSh * (w + 8) - 4
        const TAIL = 6
        for (let s = 0; s < TAIL; s++) {
          const x = Math.floor(headX - s)
          const y = Math.floor(yA + slope * (headX - s))
          const v = 1 - s / TAIL
          if (x >= 0 && x < w && y >= 0 && y < h) set(x, y, rgb[0] * v, rgb[1] * v, rgb[2] * v)
        }
      }
      break
    }

    case 'sparkle': {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = hash01(`${cue.seed}:${frameIdx}:${x}:${y}`)
          if (u > 0.85) {
            const v = (u - 0.85) / 0.15
            set(x, y, rgb[0] * v, rgb[1] * v, rgb[2] * v)
          } else {
            set(x, y, rgb2[0] * 0.06, rgb2[1] * 0.06, rgb2[2] * 0.06)
          }
        }
      }
      break
    }

    case 'flagStripes': {
      // 13 horizontal bands + canton block (top-left, 7 band-heights, 40% width).
      const red: Rgb = [0.72, 0.13, 0.2]
      const white: Rgb = [0.95, 0.95, 0.95]
      const blue: Rgb = [0.23, 0.23, 0.43]
      const cantonH = Math.round((h * 7) / 13)
      const cantonW = Math.round(w * 0.4)
      for (let y = 0; y < h; y++) {
        const band = Math.min(12, Math.floor((y * 13) / h))
        const stripe = band % 2 === 0 ? red : white
        for (let x = 0; x < w; x++) {
          if (y < cantonH && x < cantonW) {
            const star = x % 4 === 1 && y % 3 === 1
            const c = star ? white : blue
            set(x, y, c[0], c[1], c[2])
          } else {
            set(x, y, stripe[0], stripe[1], stripe[2])
          }
        }
      }
      break
    }

    case 'waveformBars': {
      // Energy-driven bars rising from the bottom; per-bar seeded character.
      const bars = Math.max(4, Math.min(32, w >> 2))
      const colsPerBar = w / bars
      for (let bIdx = 0; bIdx < bars; bIdx++) {
        const jitter = 0.6 + 0.4 * hash01(`${cue.seed}:bar:${bIdx}`)
        const lag = 0.06 * bIdx
        const e = energyAt(timeline, tShow - lag).rms
        const barH = Math.round(clamp(e * jitter, 0, 1) * h)
        const x0 = Math.round(bIdx * colsPerBar)
        const x1 = Math.min(w, Math.round((bIdx + 1) * colsPerBar) - 1)
        for (let x = x0; x < x1; x++) {
          for (let y = 0; y < h; y++) {
            const fromBottom = h - 1 - y
            if (fromBottom < barH) {
              const tip = fromBottom === barH - 1
              const c = tip ? rgb2 : rgb
              const scale = tip ? 1 : 0.35 + (0.65 * fromBottom) / Math.max(1, barH)
              set(x, y, c[0] * scale + (tip ? 0 : 0), c[1] * scale, c[2] * scale)
            }
          }
        }
      }
      break
    }

    case 'text': {
      // Ticker: text enters from the right edge and scrolls left by
      // speedPxPerBeat px per beat (falls back to 8 px/s without a beat grid).
      const msg = typeof cue.params?.text === 'string' && cue.params.text.length > 0
        ? cue.params.text
        : DEFAULT_TICKER_TEXT
      const speed = typeof cue.params?.speedPxPerBeat === 'number'
        ? cue.params.speedPxPerBeat
        : DEFAULT_SPEED_PX_PER_BEAT
      const { cells, width } = textCells(msg)
      const offsetPx = timeline.beats.length >= 2
        ? Math.floor(beatPhase(timeline.beats, tShow) * speed)
        : Math.floor(tLocal * 8)
      const cycle = width + w
      const xoff = cycle > 0 ? offsetPx % cycle : 0
      const y0 = Math.max(0, Math.floor((h - 7) / 2))
      for (const c of cells) {
        const sx = w - xoff + c.x
        const sy = y0 + c.y
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) set(sx, sy, rgb[0], rgb[1], rgb[2])
      }
      break
    }

    case 'lightning': {
      // One seeded strike per window: a ~120 ms flash drawing a jagged main
      // bolt (top → bottom) with one branch peeling off midway; dark
      // otherwise. Bolt geometry depends only on the window's seed, so every
      // frame inside a flash shows the same bolt while the wash fades.
      const WINDOW = 2
      const FLASH = 0.12
      const k = Math.floor(tLocal / WINDOW)
      const rng = mulberry32(fnv1a32(`${cue.seed}:bolt:${k}`))
      const at = k * WINDOW + rng() * (WINDOW - FLASH)
      if (tLocal >= at && tLocal < at + FLASH) {
        const fade = 1 - (tLocal - at) / FLASH
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            set(x, y, rgb2[0] * 0.25 * fade, rgb2[1] * 0.25 * fade, rgb2[2] * 0.25 * fade)
          }
        }
        let x = Math.floor(w * (0.25 + rng() * 0.5))
        const branchY = Math.floor(h * (0.3 + rng() * 0.3))
        const branchDir = rng() < 0.5 ? -1 : 1
        let bx = 0
        for (let y = 0; y < h; y++) {
          x = clamp(x + Math.round((rng() - 0.5) * 3), 0, w - 1)
          set(x, y, rgb[0] * fade, rgb[1] * fade, rgb[2] * fade)
          if (y === branchY) bx = x
          if (y > branchY && y <= branchY + (h >> 2)) {
            bx += branchDir * (1 + Math.round(rng()))
            if (bx >= 0 && bx < w) {
              set(bx, y, rgb[0] * 0.55 * fade, rgb[1] * 0.55 * fade, rgb[2] * 0.55 * fade)
            }
          }
        }
      }
      break
    }

    case 'eyes': {
      // Pairs of blinking eyes: 4–6 seeded (x, y) pairs, each two 2×2 blocks,
      // each pair going dark for 0.2 s on its own seeded blink schedule.
      const EYE = 2
      const BLINK = 0.2
      const nPairs = 4 + Math.floor(hash01(`${cue.seed}:eyes`) * 3)
      for (let i = 0; i < nPairs; i++) {
        const rng = mulberry32(fnv1a32(`${cue.seed}:eye:${i}`))
        const gap = 2 + Math.floor(rng() * 3) // px between the two blocks
        const x0 = Math.floor(rng() * Math.max(1, w - (2 * EYE + gap)))
        const y0 = Math.floor(rng() * Math.max(1, h - EYE))
        const period = 2.5 + rng() * 2.5
        const phase0 = rng() * period
        if ((tLocal + phase0) % period < BLINK) continue // mid-blink → dark
        for (let dy = 0; dy < EYE; dy++) {
          for (let dx = 0; dx < EYE; dx++) {
            for (const ex of [x0 + dx, x0 + EYE + gap + dx]) {
              if (ex < w && y0 + dy < h) set(ex, y0 + dy, rgb[0], rgb[1], rgb[2])
            }
          }
        }
      }
      break
    }

    case 'strobe': {
      const hz = typeof cue.params?.hz === 'number' && cue.params.hz > 0
        ? cue.params.hz
        : DEFAULT_STROBE_HZ
      const phase = tLocal * hz
      const on = phase - Math.floor(phase) < 0.5
      if (on) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, rgb[0], rgb[1], rgb[2])
      }
      break
    }

    case 'chase': {
      // A bright pulse with a fading tail traveling across the panel.
      const periodBeats = typeof cue.params?.periodBeats === 'number' ? cue.params.periodBeats : 0
      const prog = periodBeats > 0
        ? beatPhase(timeline.beats, tShow) / periodBeats
        : tLocal / 2
      const pos = Math.floor((prog - Math.floor(prog)) * w)
      const tail = Math.max(4, w >> 3)
      for (let x = 0; x < w; x++) {
        const d = (pos - x + w) % w
        const v = d < tail ? 1 - d / tail : 0
        for (let y = 0; y < h; y++) set(x, y, rgb[0] * v, rgb[1] * v, rgb[2] * v)
      }
      break
    }

    case 'fireworks': {
      // Seeded expanding rings from 3 emitters (panel echo of the sky show).
      const emitters = 3
      for (let e = 0; e < emitters; e++) {
        const rng = mulberry32(fnv1a32(`${cue.seed}:fw:${e}`))
        const cx = rng() * w
        const cy = rng() * h * 0.7
        const period = 1.2 + rng() * 0.8
        const phase0 = rng() * period
        const cr = 0.5 + rng() * 0.5
        const cg = 0.3 + rng() * 0.7
        const cb = 0.2 + rng() * 0.8
        const age = (tLocal + phase0) % period
        const radius = (age / period) * h * 0.9
        const fade = 1 - age / period
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const d = Math.hypot(x - cx, y - cy)
            if (Math.abs(d - radius) < 1.2) {
              const i = (y * w + x) * 3
              out[i] = Math.min(255, out[i]! + Math.round(cr * fade * 255))
              out[i + 1] = Math.min(255, out[i + 1]! + Math.round(cg * fade * 255))
              out[i + 2] = Math.min(255, out[i + 2]! + Math.round(cb * fade * 255))
            }
          }
        }
      }
      break
    }
  }

  return out
}

/** One panel cue prepared for per-step evaluation. */
export interface PanelCueSim {
  cueIdx: number
  cue: CompiledCue
  effect: PanelPattern
  assetId: string
  spec: PanelSpec
  startSec: Seconds
  endSec: Seconds
}

/** Collect panel cues bound to panel assets (dangling positionIds are skipped). */
export function buildPanelCues(compiled: CompiledShow, getEffect: EffectLookup): PanelCueSim[] {
  const out: PanelCueSim[] = []
  compiled.cues.forEach((cue, cueIdx) => {
    if (cue.medium !== 'panel') return
    const effect = getEffect(cue.effectId)
    if (!effect || effect.medium !== 'panel') return
    const asset = compiled.show.site.assets.find(
      (a) => a.id === cue.positionId && a.panel !== undefined,
    )
    if (!asset) return // validation flags dangling position ids elsewhere
    out.push({
      cueIdx,
      cue,
      effect,
      assetId: asset.id,
      spec: asset.panel!,
      startSec: cue.targetSec,
      endSec: cue.targetSec + cue.durationSec,
    })
  })
  return out
}

/** Frame cache + per-step evaluation over the prepared panel cues. */
export class PanelRenderer {
  private readonly cache = new Map<string, Uint8Array>()

  constructor(
    private readonly cues: readonly PanelCueSim[],
    private readonly timeline: MusicalTimeline,
  ) {}

  /** Cached frame for one cue at a frame index. */
  frame(c: PanelCueSim, frameIdx: number): Uint8Array {
    const key = `${c.cueIdx}:${frameIdx}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const rendered = renderPanelFrame(c.effect, c.cue, frameIdx, c.spec, this.timeline)
    this.cache.set(key, rendered)
    return rendered
  }

  /** Frames for every panel asset with an active cue at t (last wins per asset). */
  framesAt(tSec: Seconds): { assetId: string; w: number; h: number; rgb: Uint8Array }[] {
    const byAsset = new Map<string, PanelCueSim>()
    for (const c of this.cues) {
      if (tSec >= c.startSec && tSec < c.endSec) byAsset.set(c.assetId, c)
    }
    const frames: { assetId: string; w: number; h: number; rgb: Uint8Array }[] = []
    for (const [assetId, c] of byAsset) {
      const frameIdx = Math.max(0, Math.floor((tSec - c.startSec) * c.effect.fps + 1e-9))
      frames.push({ assetId, w: c.spec.wPx, h: c.spec.hPx, rgb: this.frame(c, frameIdx) })
    }
    return frames
  }
}
