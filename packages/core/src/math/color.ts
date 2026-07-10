/** Catalog color convention: CSS hex '#rrggbb' (starter entries use it). */

/** '#rrggbb' (or 'rrggbb') → [r, g, b] each 0..1. Unparseable → white. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255]
}
