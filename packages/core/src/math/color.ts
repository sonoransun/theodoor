/** Catalog color convention: CSS hex '#rrggbb' (starter entries use it). */

/** '#rrggbb' (or 'rrggbb') → [r, g, b] each 0..1. Unparseable → white. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255]
}

/**
 * [r, g, b] each 0..1 → '#rrggbb'. Channels are clamped then rounded, so the
 * quantization is stable — the same float inputs always yield the same hex
 * (gallery SVGs golden-test on it).
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const ch = (v: number): string => {
    const byte = Math.round(Math.min(1, Math.max(0, v)) * 255)
    return byte.toString(16).padStart(2, '0')
  }
  return `#${ch(r)}${ch(g)}${ch(b)}`
}
