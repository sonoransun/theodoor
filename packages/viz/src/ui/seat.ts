/**
 * ui/seat.ts — the "sit:" seat picker for the beam audition: a small select
 * of crowd-grid preset seats (row/col on the derived grid). Selecting a seat
 * retargets BeamAudio's gain/delay/pan math and the HUD readout.
 */
import type { CrowdGrid, Vec2 } from '@theodoor/core'
import { h } from './dom.js'

export interface SeatPreset {
  id: string
  label: string
  /** Crowd-grid row (rows−1 = front, nearest the stage). */
  row: number
  col: number
}

/** Presets on the lakeside 38×9 grid (row 8 front, col 19 center aisle). */
export const SEAT_PRESETS: readonly SeatPreset[] = [
  { id: 'front-west', label: 'Front-West', row: 8, col: 5 },
  { id: 'front-center', label: 'Front-Center', row: 8, col: 19 },
  { id: 'front-east', label: 'Front-East', row: 8, col: 33 },
  { id: 'mid-center', label: 'Mid-Center', row: 4, col: 19 },
  { id: 'back-center', label: 'Back-Center', row: 0, col: 19 },
]

export const DEFAULT_SEAT_ID = 'front-center'

/**
 * Ground position of a preset seat on a grid: the exact (row, col) cell's
 * centroid, else the nearest kept cell by row+col distance (exclusion holes),
 * undefined without a grid. Pure — unit-tested in Node.
 */
export function seatCellPos(
  grid: Pick<CrowdGrid, 'cells'> | undefined,
  preset: Pick<SeatPreset, 'row' | 'col'>,
): Vec2 | undefined {
  if (!grid || grid.cells.length === 0) return undefined
  let best = grid.cells[0]!
  let bestD = Infinity
  for (const cell of grid.cells) {
    const d = Math.abs(cell.row - preset.row) + Math.abs(cell.col - preset.col)
    if (d < bestD) {
      bestD = d
      best = cell
      if (d === 0) break
    }
  }
  return best.centroid
}

export interface SeatControl {
  el: HTMLElement
  current(): SeatPreset
}

/** Build the "sit:" select. `onChange` fires with the newly selected preset. */
export function createSeatControl(onChange: (preset: SeatPreset) => void): SeatControl {
  const select = h('select', {
    class: 'picker-select seat-select',
    title: 'Audition seat for the directional-audio beams',
  })
  for (const p of SEAT_PRESETS) select.append(h('option', { value: p.id }, p.label))
  select.value = DEFAULT_SEAT_ID
  select.addEventListener('change', () => {
    const preset = SEAT_PRESETS.find((p) => p.id === select.value)
    if (preset) onChange(preset)
  })

  const el = h('label', { class: 'seat-picker' }, 'sit: ', select)
  return {
    el,
    current(): SeatPreset {
      return SEAT_PRESETS.find((p) => p.id === select.value) ?? SEAT_PRESETS[1]!
    },
  }
}
