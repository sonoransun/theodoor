/**
 * Bloom math — pure helpers for the post-process pass (no GL; tested in Node).
 *
 * The scene's emissive layers are rendered into an offscreen target, bright
 * parts are soft-thresholded while downsampling to a small target, blurred
 * with a separable Gaussian (horizontal then vertical), and added back over
 * the frame with BLOOM_GAIN. All the numbers live here so the GL pipeline is
 * plumbing only.
 */

/** Downsample divisor of the blur targets (quarter resolution). */
export const BLOOM_DOWNSAMPLE = 4
/** Gaussian radius in blur-target pixels (kernel has 2·r + 1 taps). */
export const BLOOM_KERNEL_RADIUS = 6
/** Gaussian sigma in blur-target pixels. */
export const BLOOM_SIGMA = 2.6
/** Soft brightness threshold below which nothing blooms (0..1). */
export const BLOOM_THRESHOLD = 0.22
/** Composite gain of the blurred layer. */
export const BLOOM_GAIN = 0.8

/** Normalized 1-D Gaussian weights for taps −radius..+radius. */
export function gaussianKernel(radius = BLOOM_KERNEL_RADIUS, sigma = BLOOM_SIGMA): number[] {
  const r = Math.max(0, Math.floor(radius))
  const s = Math.max(1e-6, sigma)
  const w: number[] = []
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * s * s))
    w.push(v)
    sum += v
  }
  return w.map((v) => v / sum)
}

/** Blur-target size for a backing store: ceil(w/d) × ceil(h/d), never below 1. */
export function bloomTargetSize(
  widthPx: number,
  heightPx: number,
  divisor = BLOOM_DOWNSAMPLE,
): { w: number; h: number } {
  const d = Math.max(1, divisor)
  return { w: Math.max(1, Math.ceil(widthPx / d)), h: Math.max(1, Math.ceil(heightPx / d)) }
}

/** Soft threshold applied per channel while downsampling: (c − t)/(1 − t), clamped at 0. */
export function softThreshold(c: number, threshold = BLOOM_THRESHOLD): number {
  const t = Math.min(0.999, Math.max(0, threshold))
  return Math.max(0, (c - t) / (1 - t))
}

/** GLSL source of the kernel as a comma-joined float list (for a const array). */
export function kernelGlsl(weights: readonly number[]): string {
  return weights.map((w) => w.toFixed(6)).join(', ')
}
