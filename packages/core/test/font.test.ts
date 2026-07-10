import { describe, expect, it } from 'vitest'
import { FONT_H, FONT_W, glyph, textCells } from '../src/text/font5x7.js'

describe('font5x7', () => {
  it('covers A-Z, 0-9, and basic punctuation with 7 rows of 5', () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !?.,-\':'
    for (const ch of chars) {
      const g = glyph(ch)
      expect(g, `missing glyph ${JSON.stringify(ch)}`).toBeDefined()
      expect(g!.length).toBe(FONT_H)
      for (const row of g!) {
        expect(row.length).toBe(FONT_W)
        expect(/^[.X]+$/.test(row)).toBe(true)
      }
    }
  })

  it('is case-insensitive', () => {
    expect(glyph('a')).toEqual(glyph('A'))
  })

  it('lays out text with spacing and reports width', () => {
    const { cells, width, height } = textCells('HI')
    expect(height).toBe(7)
    expect(width).toBe(11) // 5 + 1 + 5
    // 'I' top bar spans columns 6..10 (x offset 6 for the second glyph).
    const topBarI = cells.filter((c) => c.y === 0 && c.x >= 6)
    expect(topBarI.length).toBe(5)
    // No cell escapes the layout box.
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThan(11)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeLessThan(7)
    }
  })

  it('renders unknown characters as blanks without crashing', () => {
    const { cells } = textCells('~')
    expect(cells.length).toBe(0)
  })
})
