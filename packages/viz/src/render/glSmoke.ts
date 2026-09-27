/**
 * Smoke pipeline: one soft quad per puff from render/smoke.ts, drawn as a
 * radial Gaussian tinted SMOKE_RGB at the puff's tiny alpha. A seeded
 * per-puff phase breaks the perfect disc into a lopsided cloud (two offset
 * lobes) so overlapping puffs read as haze rather than stacked circles.
 * Premultiplied additive output — lit haze that softens whatever sits behind
 * it, never a bright blob (alpha tops out at SMOKE_PEAK_ALPHA).
 */
import type { Wind } from '@theodoor/core'
import type { Camera } from './camera.js'
import { FloatSink, createVertexStream, pushQuad } from './glStream.js'
import type { VertexStream } from './glStream.js'
import { SMOKE_RGB, smokePuffsFromPlan, type SmokeSource } from './smoke.js'
import { compileProgram } from './types.js'

const VS = `
attribute vec2 aClip;
attribute vec2 aUv;
attribute vec4 aColor;
attribute float aPhase;
varying vec2 vUv;
varying vec4 vColor;
varying float vPhase;
void main() {
  gl_Position = vec4(aClip, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
  vPhase = aPhase;
}
`

// uv spans −1..1 in both axes across the puff quad (u remapped in the sink).
const FS = `
precision mediump float;
varying vec2 vUv;
varying vec4 vColor;
varying float vPhase;
void main() {
  vec2 p = vUv;
  vec2 lobe = 0.35 * vec2(cos(vPhase), sin(vPhase));
  float d1 = dot(p - lobe, p - lobe);
  float d2 = dot(p + lobe * 0.6, p + lobe * 0.6);
  float g = 0.6 * exp(-3.2 * d1) + 0.5 * exp(-2.6 * d2);
  float a = g * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
}
`

export interface SmokePipeline {
  /** `plan` comes from smoke.ts prepareSmoke (built once per show by the renderer). */
  draw(plan: readonly SmokeSource[], wind: Wind | undefined, camera: Camera, tSec: number): void
  dispose(): void
}

const TWO_PI = Math.PI * 2

export function createSmokePipeline(gl: WebGLRenderingContext): SmokePipeline {
  const prog = compileProgram(gl, VS, FS)
  const stream: VertexStream = createVertexStream(gl, prog, [
    { name: 'aClip', size: 2 },
    { name: 'aUv', size: 2 },
    { name: 'aColor', size: 4 },
    { name: 'aPhase', size: 1 },
  ])
  const sink = new FloatSink(2048)
  const [r, g, b] = SMOKE_RGB

  return {
    draw(plan, wind, camera, tSec): void {
      if (plan.length === 0 || !wind) return
      const puffs = smokePuffsFromPlan(plan, wind, tSec)
      if (puffs.length === 0) return
      sink.reset()
      for (const p of puffs) {
        const rad = p.radiusM
        const phase = (p.seed / 0x100000000) * TWO_PI
        const aN = camera.project(p.x - rad, p.z - rad)
        const aP = camera.project(p.x - rad, p.z + rad)
        const bN = camera.project(p.x + rad, p.z - rad)
        const bP = camera.project(p.x + rad, p.z + rad)
        // pushQuad writes (u, v) with u ∈ {u0, u1} and v ∈ {−1, 1}; use u0 = −1
        // so uv is a centered −1..1 square.
        pushQuad(sink, aN, aP, bN, bP, -1, 1, [r, g, b, p.alpha, phase])
      }
      stream.draw(sink.data, sink.length, gl.TRIANGLES)
    },
    dispose(): void {
      stream.dispose()
      gl.deleteProgram(prog)
    },
  }
}
