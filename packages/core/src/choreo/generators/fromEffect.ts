import type { CueParams, DronePrimitive, Formation } from '../../contracts.js'
import { clamp } from '../../math/curves.js'
import { hexToRgb } from '../../math/color.js'
import {
  bat,
  bloom,
  clockRing,
  cometTail,
  crescent,
  digit,
  flag,
  ghost,
  grid,
  heart,
  orrery,
  resampleTo,
  ring,
  saucer,
  scatter,
  snowflake,
  spiral,
  star,
  text,
} from './formations.js'

/**
 * Single owner of the (drone effect, cue params) → Formation mapping, shared
 * by the alignment solver (anticipation via planMorph) and the sim engine
 * (flight targets). Deterministic: identical inputs → identical formation.
 */
export function formationFromEffect(
  effect: DronePrimitive,
  params: CueParams | undefined,
  seed: number,
): Formation {
  const n = clamp(
    Math.round(typeof params?.count === 'number' ? params.count : effect.maxDrones),
    effect.minDrones,
    effect.maxDrones,
  )
  const scale = typeof params?.scaleM === 'number' ? params.scaleM : effect.scaleM
  const rgb =
    Array.isArray(params?.rgb) && params.rgb.length === 3
      ? (params.rgb as readonly number[])
      : undefined

  let f: Formation
  switch (effect.formation) {
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(n))
      const rows = Math.ceil(n / cols)
      f = {
        name: `grid-${n}`,
        points: resampleTo(grid(rows, cols, scale / Math.max(1, cols - 1)).points, n, seed),
      }
      break
    }
    case 'ring':
      f = ring(n, scale / 2)
      break
    case 'star':
      f = star(n, scale / 2, scale / 5)
      break
    case 'heart':
      f = heart(n, scale / 34) // parametric heart spans ~34 units
      break
    case 'flag': {
      const cols = Math.max(2, Math.round(Math.sqrt(n * 1.9)))
      const rows = Math.max(2, Math.ceil(n / cols))
      f = flag(cols, rows, scale / Math.max(1, cols - 1), usFlagBands(rows))
      break
    }
    case 'wave': {
      // A wide line that the sim modulates; encoded as a 1-row grid.
      f = grid(1, n, scale / Math.max(1, n - 1))
      break
    }
    case 'text': {
      const s = typeof params?.text === 'string' && params.text.length > 0 ? params.text : 'USA'
      f = text(s, n, scale)
      break
    }
    case 'digit': {
      const d =
        typeof params?.text === 'string' && /^[0-9]$/.test(params.text)
          ? Number(params.text)
          : 0
      f = digit(d, n, scale)
      break
    }
    case 'scatter':
      f = scatter(n, { x: scale, y: scale / 4, z: scale / 2 }, seed)
      break
    case 'bloom':
      f = bloom(n, scale / 2, seed)
      break
    case 'clockRing':
      f = clockRing(n, scale / 2)
      break
    case 'bat':
      f = bat(n, scale)
      break
    case 'ghost':
      f = ghost(n, scale, seed)
      break
    case 'spiral':
      f = spiral(n, scale / 2, seed)
      break
    case 'cometTail':
      f = cometTail(n, scale, seed)
      break
    case 'saucer':
      f = saucer(n, scale)
      break
    case 'orrery':
      f = orrery(n, scale / 2)
      break
    case 'crescent':
      f = crescent(n, scale / 2)
      break
    case 'snowflake':
      f = snowflake(n, scale)
      break
  }

  if (rgb) {
    f = {
      name: f.name,
      points: f.points.map((p) => ({ ...p, r: rgb[0]!, g: rgb[1]!, b: rgb[2]! })),
    }
  } else if (typeof params?.color === 'string') {
    const [r, g, b] = hexToRgb(params.color)
    f = { name: f.name, points: f.points.map((p) => ({ ...p, r, g, b })) }
  }
  return f
}

/** 13 red/white stripes; rows are colored top-to-bottom. */
function usFlagBands(rows: number): readonly [number, number, number][] {
  const bands: [number, number, number][] = []
  for (let i = 0; i < rows; i++) {
    bands.push(i % 2 === 0 ? [0.72, 0.07, 0.15] : [0.95, 0.95, 0.95])
  }
  return bands
}
