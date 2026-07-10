/**
 * gallery/sky.ts -- front-view night-sky scenes: static stills and SMIL loops
 * over engine-sampled GalleryFrames, plus closed-form pyro rosette glyphs.
 *
 * Flattening (deliberate, documented):
 * - The sky panel is a straight front view via skyProject: world x (east) ->
 *   view x, world z (up) -> view y; world depth (y) is dropped above the
 *   ground line.
 * - The lawn band below the ground line is a squashed top-down inset of the
 *   audience zone. Band x reuses the sky projection's toX; band y maps world
 *   y (depth) linearly across the band height using the crowd grid's row
 *   extents, FRONT row (nearest the stage, highest world y) at the bottom.
 * - Beam footprints flatten onto the band as axis-aligned ellipses:
 *   rx = footprint.a * pxPerMx (the along-azimuth semi-axis approximates the
 *   east-west extent), ry = footprint.b scaled by the band's px-per-meter
 *   depth, footprint azimuth ignored.
 *
 * Animated loops follow the anim.ts house conventions: positions linear at
 * the caller's frame rate, colors/crowd discrete at a reduced rate, one
 * hold-and-restart loop of loopDurSec. Bursts are the pyro layer of loops --
 * closed-form glyphs (seeded spoke rosettes), never per-star markup.
 */

import type { BeamState, SitePlan } from '../contracts.js'
import { el, fmtMm, type SvgAttrValue } from '../fab/svg.js'
import { rgbToHex } from '../math/color.js'
import { mulberry32 } from '../math/index.js'
import { crowdGridFor, type CrowdGrid } from '../site/crowdGrid.js'
import { animate, animateTransform, fmtSmilSec, holdLoopKeyTimes, translateValues } from './anim.js'
import { crowdCellHex } from './crowd.js'
import { galleryDoc, nightBackdrop, skyProject, type SkyProjection } from './scene.js'
import type { GalleryFrame } from './sample.js'
import { GALLERY_THEME } from './theme.js'

/** Vertical layout shared by still and loop: sky panel, gap, lawn band, pad. */
const BAND_GAP_PX = 6
const BAND_H_PX = 66
const BOTTOM_PAD_PX = 4
/** Loop hold fraction (hold-and-restart house convention). */
const SKY_HOLD_FRAC = 0.06
/** Fill/opacity steps for beam footprint ellipses. */
const BEAM_OPACITY_OFF = '0'
const BEAM_OPACITY_AIRBORNE = '0.4'
const BEAM_OPACITY_LANDED = '0.9'

/** Lawn-band geometry derived from the site's crowd grid + audience zone. */
interface LawnBand {
  grid: CrowdGrid
  top: number
  hPx: number
  /** Audience-zone bbox min y (the grid's row-0 edge), meters. */
  yMinM: number
  /** rows * cellSizeM, meters of lawn depth the band spans. */
  depthM: number
  /** Cell footprint on the band, px. */
  cellW: number
  rowH: number
  /** World y (depth, meters) -> band y px; front row lands at the bottom. */
  toBandY(yM: number): number
}

function lawnBandFor(site: SitePlan, proj: SkyProjection, top: number, hPx: number): LawnBand | undefined {
  const grid = crowdGridFor(site)
  if (grid === undefined) return undefined
  let yMinM = Infinity
  for (const p of site.audienceZone) {
    if (p.y < yMinM) yMinM = p.y
  }
  const depthM = grid.rows * grid.cellSizeM
  return {
    grid,
    top,
    hPx,
    yMinM,
    depthM,
    cellW: grid.cellSizeM * proj.pxPerMx,
    rowH: hPx / grid.rows,
    toBandY: (yM) => top + ((yM - yMinM) / depthM) * hPx,
  }
}

/** Position/size attrs of one crowd-cell rect on the band (1 px gap). */
function cellRectAttrs(
  centroid: { x: number; y: number },
  band: LawnBand,
  proj: SkyProjection,
): Record<string, SvgAttrValue> {
  return {
    x: proj.toX(centroid.x) - band.cellW / 2 + 0.5,
    y: band.toBandY(centroid.y) - band.rowH / 2 + 0.5,
    width: band.cellW - 1,
    height: band.rowH - 1,
  }
}

/** Flattened footprint ellipse geometry on the band (see header). */
function beamEllipseGeom(
  b: BeamState,
  band: LawnBand,
  proj: SkyProjection,
): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: proj.toX(b.footprint.cx),
    cy: band.toBandY(b.footprint.cy),
    rx: b.footprint.a * proj.pxPerMx,
    ry: b.footprint.b * (band.hPx / band.depthM),
  }
}

export interface SkySceneOpts {
  /** Default 900. */
  widthPx?: number
  /** Default 480. */
  heightPx?: number
  /** Default 200. */
  worldHalfWidthM?: number
  /** Default 220. */
  maxAltM?: number
  /** Stars dimmer than this are skipped; default 0.05. */
  minStarBrightness?: number
  /** Keep at most this many stars (brightest first); default unlimited. */
  starMax?: number
  title?: string
}

/**
 * Static still of one sampled frame: night backdrop and ground line, pyro
 * stars (brightness -> opacity), drones, and the lawn band with crowd cells
 * and beam footprints (brighter once landed).
 */
export function skySceneSvg(frame: GalleryFrame, site: SitePlan, opts: SkySceneOpts = {}): string {
  const w = opts.widthPx ?? 900
  const h = opts.heightPx ?? 480
  const minB = opts.minStarBrightness ?? 0.05
  const groundY = h - BAND_GAP_PX - BAND_H_PX - BOTTOM_PAD_PX
  const proj = skyProject(w, groundY, opts.worldHalfWidthM ?? 200, opts.maxAltM ?? 220)
  const children: string[] = [nightBackdrop(0, 0, w, groundY)]

  // Dense barrages carry thousands of stars; cap the drawn set at the
  // brightest starMax (stable order: brightness desc, then index asc).
  let indices: number[] = []
  for (let i = 0; i < frame.stars.count; i++) {
    if ((frame.stars.brightness[i] ?? 0) >= minB) indices.push(i)
  }
  if (opts.starMax !== undefined && indices.length > opts.starMax) {
    indices = indices
      .sort(
        (a, b) =>
          (frame.stars.brightness[b] ?? 0) - (frame.stars.brightness[a] ?? 0) || a - b,
      )
      .slice(0, opts.starMax)
      .sort((a, b) => a - b)
  }
  const stars: string[] = []
  for (const i of indices) {
    const b = frame.stars.brightness[i] ?? 0
    const attrs: Record<string, SvgAttrValue> = {
      cx: proj.toX(frame.stars.pos[3 * i] ?? 0),
      cy: proj.toY(frame.stars.pos[3 * i + 2] ?? 0),
      r: Math.min(4, Math.max(1, (frame.stars.sizeM[i] ?? 0) * proj.pxPerMz)),
      fill: rgbToHex(frame.stars.rgb[3 * i] ?? 0, frame.stars.rgb[3 * i + 1] ?? 0, frame.stars.rgb[3 * i + 2] ?? 0),
    }
    if (b < 0.95) attrs['opacity'] = b
    stars.push(el('circle', attrs))
  }
  children.push(el('g', {}, stars.join('')))

  // Snapshots carry the whole fleet, parked drones included; a drone with
  // its light off (quantized #000000) is invisible against the night sky and
  // is skipped in both the still and the loop.
  const drones: string[] = []
  for (let i = 0; i < frame.drones.count; i++) {
    const fill = rgbToHex(
      frame.drones.rgb[3 * i] ?? 0,
      frame.drones.rgb[3 * i + 1] ?? 0,
      frame.drones.rgb[3 * i + 2] ?? 0,
    )
    if (fill === '#000000') continue
    drones.push(
      el('circle', {
        cx: proj.toX(frame.drones.pos[3 * i] ?? 0),
        cy: proj.toY(frame.drones.pos[3 * i + 2] ?? 0),
        r: 2,
        fill,
      }),
    )
  }
  children.push(el('g', {}, drones.join('')))

  const band = lawnBandFor(site, proj, groundY + BAND_GAP_PX, BAND_H_PX)
  if (band !== undefined) {
    const parts: string[] = [
      el('rect', { x: 0, y: band.top, width: w, height: band.hPx, fill: GALLERY_THEME.panelBg }),
    ]
    for (const cell of band.grid.cells) {
      parts.push(
        el('rect', { ...cellRectAttrs(cell.centroid, band, proj), fill: crowdCellHex(frame, cell.index) }),
      )
    }
    for (const b of frame.beams) {
      parts.push(
        el('ellipse', {
          ...beamEllipseGeom(b, band, proj),
          fill: GALLERY_THEME.lanes.beams,
          'fill-opacity': b.landed ? 0.35 : 0.15,
          stroke: GALLERY_THEME.lanes.beams,
          'stroke-width': 1,
          'stroke-opacity': b.landed ? 0.9 : 0.45,
        }),
      )
    }
    children.push(el('g', {}, parts.join('')))
  }

  return galleryDoc(
    w,
    h,
    {
      title: opts.title ?? `sky scene at ${fmtSmilSec(frame.t)}s`,
      desc: 'front view: pyro stars and drones over the ground line, lawn band with crowd cells and beam footprints below',
    },
    children,
  )
}

/**
 * A closed-form pyro rosette glyph for loops: `spokes` lines radiating from
 * (xM, zM), their length scaling 0 -> radiusM while the group opacity fades
 * 1 -> 0 over durSec, repeating every loopDurSec starting at beginSec.
 * Per-spoke color cycles through `colors`; spoke angles get seeded jitter.
 */
export interface SkyBurst {
  xM: number
  zM: number
  radiusM: number
  /** Offset into the loop when the rosette pops, seconds. */
  beginSec: number
  /** Expansion+fade time, seconds (must be < the loop duration). */
  durSec: number
  colors: readonly string[]
  /** Default 12. */
  spokes?: number
  seed: number
}

function burstGlyph(b: SkyBurst, proj: SkyProjection, loopDurSec: number): string {
  const spokes = b.spokes ?? 12
  const rng = mulberry32(b.seed)
  const rPx = Math.max(2, b.radiusM * proj.pxPerMz)
  const frac = Math.min(0.98, Math.max(0.01, b.durSec / loopDurSec))
  const keyTimes = [0, frac, 1]
  const lines: string[] = []
  for (let k = 0; k < spokes; k++) {
    const th = (2 * Math.PI * k) / spokes + (rng() - 0.5) * (Math.PI / spokes) * 0.7
    lines.push(
      el('line', {
        x1: 0.15 * rPx * Math.cos(th),
        y1: 0.15 * rPx * Math.sin(th),
        x2: rPx * Math.cos(th),
        y2: rPx * Math.sin(th),
        stroke: b.colors[k % b.colors.length] ?? GALLERY_THEME.lanes.pyro,
        'stroke-width': 1.4,
        'stroke-linecap': 'round',
      }),
    )
  }
  const inner = el(
    'g',
    {},
    lines.join('') +
      animateTransform('scale', {
        values: ['0', '1', '1'],
        durSec: loopDurSec,
        keyTimes,
        beginSec: b.beginSec,
      }),
  )
  // Base opacity 0 hides the glyph before its first begin; each cycle then
  // flashes to 1 and fades out over the same fraction the scale expands.
  return el(
    'g',
    { transform: `translate(${fmtMm(proj.toX(b.xM))} ${fmtMm(proj.toY(b.zM))})`, opacity: 0 },
    inner +
      animate('opacity', {
        values: ['1', '0', '0'],
        durSec: loopDurSec,
        keyTimes,
        beginSec: b.beginSec,
      }),
  )
}

export interface SkyLoopOpts {
  loopDurSec: number
  /** Default 900. */
  widthPx?: number
  /** Default 420. */
  heightPx?: number
  /** Default 200. */
  worldHalfWidthM?: number
  /** Default 220. */
  maxAltM?: number
  /** Closed-form pyro rosettes (the loop's pyro layer). */
  bursts?: readonly SkyBurst[]
  /** Animate at most this many drones (first indices win); default 220. */
  droneMax?: number
  title?: string
}

/**
 * Animated loop over evenly spaced frames: each drone is one circle carrying
 * one translate animateTransform through its per-frame positions (linear,
 * hold-and-restart); fills animate discretely at quarter rate and only for
 * drones whose quantized color changes; drones absent in a frame park at
 * their previous position behind a discrete opacity animate; drones whose
 * light stays off across the window emit no markup, drones that never move
 * (parked fleet with status lights) render as static dots without a
 * translate, and at most droneMax drones render (first indices win). The lawn band
 * animates crowd cells (discrete, half rate, changing cells only) and beam
 * footprints (cx/rx linear, opacity stepping brighter at landing). Bursts
 * render as SkyBurst glyphs. Everything loops on loopDurSec.
 */
export function skyLoopSvg(frames: readonly GalleryFrame[], site: SitePlan, opts: SkyLoopOpts): string {
  const F = frames.length
  if (F < 2) throw new Error('skyLoopSvg: need at least 2 frames')
  if (!(opts.loopDurSec > 0)) throw new Error('skyLoopSvg: loopDurSec must be > 0')
  const w = opts.widthPx ?? 900
  const h = opts.heightPx ?? 420
  const dur = opts.loopDurSec
  const groundY = h - BAND_GAP_PX - BAND_H_PX - BOTTOM_PAD_PX
  const proj = skyProject(w, groundY, opts.worldHalfWidthM ?? 200, opts.maxAltM ?? 220)
  const keyTimes = holdLoopKeyTimes(F + 1, SKY_HOLD_FRAC)
  /** keyTime of frame k on the hold-and-restart grid (matches keyTimes[k]). */
  const frameKt = (k: number): number => (k / (F - 1)) * (1 - SKY_HOLD_FRAC)
  const children: string[] = [nightBackdrop(0, 0, w, groundY)]

  // --- Lawn band: crowd cells (discrete, every other frame) + beams. -------
  const band = lawnBandFor(site, proj, groundY + BAND_GAP_PX, BAND_H_PX)
  if (band !== undefined) {
    const parts: string[] = [
      el('rect', { x: 0, y: band.top, width: w, height: band.hPx, fill: GALLERY_THEME.panelBg }),
    ]
    const cellIdx: number[] = []
    for (let k = 0; k < F; k += 2) cellIdx.push(k)
    const cellKts = [...cellIdx.map(frameKt), 1]
    for (const cell of band.grid.cells) {
      const attrs = cellRectAttrs(cell.centroid, band, proj)
      const hexes = cellIdx.map((k) => crowdCellHex(frames[k]!, cell.index))
      if (hexes.every((x) => x === hexes[0])) {
        parts.push(el('rect', { ...attrs, fill: hexes[0]! }))
        continue
      }
      parts.push(
        el(
          'rect',
          { ...attrs, fill: hexes[0]! },
          animate('fill', {
            values: [...hexes, hexes[hexes.length - 1]!],
            durSec: dur,
            keyTimes: cellKts,
            calcMode: 'discrete',
          }),
        ),
      )
    }

    // One ellipse per beam cue seen anywhere in the window.
    const beamIds: number[] = []
    for (const f of frames) {
      for (const b of f.beams) {
        if (!beamIds.includes(b.cueIdx)) beamIds.push(b.cueIdx)
      }
    }
    for (const id of beamIds) {
      const states = frames.map((f) => f.beams.find((b) => b.cueIdx === id))
      const first = states.find((s) => s !== undefined)!
      const geom = beamEllipseGeom(first, band, proj)
      const cxs: string[] = []
      const rxs: string[] = []
      const ops: string[] = []
      let last = geom
      for (const s of states) {
        if (s !== undefined) last = beamEllipseGeom(s, band, proj)
        cxs.push(fmtMm(last.cx))
        rxs.push(fmtMm(last.rx))
        ops.push(s === undefined ? BEAM_OPACITY_OFF : s.landed ? BEAM_OPACITY_LANDED : BEAM_OPACITY_AIRBORNE)
      }
      parts.push(
        el(
          'ellipse',
          {
            cx: geom.cx,
            cy: geom.cy,
            rx: geom.rx,
            ry: geom.ry,
            fill: GALLERY_THEME.lanes.beams,
            'fill-opacity': 0.35,
            stroke: GALLERY_THEME.lanes.beams,
            'stroke-width': 1,
            opacity: 0,
          },
          animate('cx', { values: [...cxs, cxs[F - 1]!], durSec: dur, keyTimes }) +
            animate('rx', { values: [...rxs, rxs[F - 1]!], durSec: dur, keyTimes }) +
            animate('opacity', {
              values: [...ops, ops[F - 1]!],
              durSec: dur,
              keyTimes,
              calcMode: 'discrete',
            }),
        ),
      )
    }
    children.push(el('g', {}, parts.join('')))
  }

  // --- Drones: translate per drone, fills quarter rate, presence opacity. ---
  let maxCount = 0
  for (const f of frames) maxCount = Math.max(maxCount, f.drones.count)
  const droneMax = opts.droneMax ?? 220
  const fillIdx: number[] = []
  for (let k = 0; k < F; k += 4) fillIdx.push(k)
  const fillKts = [...fillIdx.map(frameKt), 1]
  const droneParts: string[] = []
  for (let i = 0; i < maxCount && droneParts.length < droneMax; i++) {
    const present = frames.map((f) => i < f.drones.count)
    const firstAt = present.indexOf(true)
    if (firstAt === -1) continue
    const at = (f: GalleryFrame): { x: number; y: number } => ({
      x: proj.toX(f.drones.pos[3 * i] ?? 0),
      y: proj.toY(f.drones.pos[3 * i + 2] ?? 0),
    })
    const hexAt = (f: GalleryFrame): string =>
      rgbToHex(f.drones.rgb[3 * i] ?? 0, f.drones.rgb[3 * i + 1] ?? 0, f.drones.rgb[3 * i + 2] ?? 0)
    // Absent frames park at the previous position (leading gap: first known).
    const pts: { x: number; y: number }[] = []
    const hexes: string[] = []
    let lastPt = at(frames[firstAt]!)
    let lastHex = hexAt(frames[firstAt]!)
    for (let k = 0; k < F; k++) {
      if (present[k]) {
        lastPt = at(frames[k]!)
        lastHex = hexAt(frames[k]!)
      }
      pts.push(lastPt)
      hexes.push(lastHex)
    }
    const sampledHexes = fillIdx.map((k) => hexes[k]!)
    // Lights-off the whole window (quantized at the fill rate): invisible
    // against the night sky, so no markup at all.
    if (sampledHexes.every((x) => x === '#000000')) continue
    // Parked drones (dim status light, never moving) render as static dots:
    // a translate animate is only spent on drones that actually move.
    const vals = translateValues([...pts, pts[F - 1]!])
    const moves = vals.some((v) => v !== vals[0])
    let inner = moves ? animateTransform('translate', { values: vals, durSec: dur, keyTimes }) : ''
    if (sampledHexes.some((x) => x !== sampledHexes[0])) {
      inner += animate('fill', {
        values: [...sampledHexes, sampledHexes[sampledHexes.length - 1]!],
        durSec: dur,
        keyTimes: fillKts,
        calcMode: 'discrete',
      })
    }
    if (present.some((p) => !p)) {
      const ops = present.map((p) => (p ? '1' : '0'))
      inner += animate('opacity', {
        values: [...ops, ops[F - 1]!],
        durSec: dur,
        keyTimes,
        calcMode: 'discrete',
      })
    }
    const base = moves ? { x: 0, y: 0 } : pts[0]!
    const attrs = { cx: base.x, cy: base.y, r: 2, fill: sampledHexes[0]! }
    droneParts.push(inner === '' ? el('circle', attrs) : el('circle', attrs, inner))
  }
  children.push(el('g', {}, droneParts.join('')))

  // --- Pyro layer: closed-form rosette glyphs. ------------------------------
  for (const b of opts.bursts ?? []) children.push(burstGlyph(b, proj, dur))

  return galleryDoc(
    w,
    h,
    {
      title: opts.title ?? 'sky loop',
      desc: `${F} frames over a ${fmtSmilSec(dur)}s loop: drones, crowd band, beam footprints, rosette glyphs`,
    },
    children,
  )
}
