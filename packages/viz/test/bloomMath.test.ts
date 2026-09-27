import { describe, expect, it } from 'vitest'
import {
  BLOOM_KERNEL_RADIUS,
  BLOOM_THRESHOLD,
  bloomTargetSize,
  gaussianKernel,
  kernelGlsl,
  softThreshold,
} from '../src/render/bloom.js'

describe('gaussianKernel', () => {
  it('has 2r+1 symmetric taps summing to 1 with the peak in the middle', () => {
    const k = gaussianKernel()
    expect(k).toHaveLength(2 * BLOOM_KERNEL_RADIUS + 1)
    expect(k.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    for (let i = 0; i < k.length; i++) expect(k[i]).toBeCloseTo(k[k.length - 1 - i]!, 12)
    const mid = k[BLOOM_KERNEL_RADIUS]!
    for (const v of k) expect(v).toBeLessThanOrEqual(mid + 1e-12)
  })

  it('degenerates to a single unit tap at radius 0', () => {
    expect(gaussianKernel(0, 1)).toEqual([1])
  })
})

describe('bloomTargetSize / softThreshold / kernelGlsl', () => {
  it('rounds the blur target up and never below 1×1', () => {
    expect(bloomTargetSize(1920, 1080, 4)).toEqual({ w: 480, h: 270 })
    expect(bloomTargetSize(1921, 1081, 4)).toEqual({ w: 481, h: 271 })
    expect(bloomTargetSize(1, 1, 4)).toEqual({ w: 1, h: 1 })
  })

  it('soft threshold is 0 below the knee and reaches 1 at full white', () => {
    expect(softThreshold(0)).toBe(0)
    expect(softThreshold(BLOOM_THRESHOLD)).toBe(0)
    expect(softThreshold(1)).toBeCloseTo(1, 12)
    expect(softThreshold(0.6)).toBeGreaterThan(0)
    expect(softThreshold(0.6)).toBeLessThan(1)
  })

  it('emits a comma-joined float list for GLSL', () => {
    expect(kernelGlsl([0.25, 0.5, 0.25])).toBe('0.250000, 0.500000, 0.250000')
  })
})
