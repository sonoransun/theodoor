/**
 * Searchlight pipeline: sky beams from SimSnapshot.lights.
 *
 * Each LightState draws as a long tapered quad from its head (base.x, base.z)
 * along the x–z projection of its direction for reachM · LIGHT_DRAW_FRACTION
 * (the sky panel is shorter than a real 600 m beam; beams simply leave the
 * frame). The visible half-width grows from LIGHT_CORE_HALF_W_M at the head
 * to len · tan(halfAngle) at the far end — the real divergence — and the
 * fragment fades with distance ((1 − u)^LIGHT_FALLOFF_POW: atmospheric
 * scatter thins the beam as it climbs) and across it (exp(−3v²)). A second,
 * three-times-wider halo quad at low gain gives the beam its soft glow. Both
 * are additive, so converging or crossed beams genuinely brighten where they
 * meet — the whole point of those figures. Heads pointing mostly in depth
 * (dir.y) shorten to a bright stub. Intensity comes straight from the state
 * (strike/fade envelopes, chase idles); slewing heads draw as usual — the
 * light is lit while it moves.
 */
import type { LightState } from '@theodoor/core'
import type { Camera } from './camera.js'
import { FloatSink, createVertexStream, pushQuad } from './glStream.js'
import type { VertexStream } from './glStream.js'
import { compileProgram } from './types.js'

/** Fraction of reachM actually drawn. */
export const LIGHT_DRAW_FRACTION = 0.6
/** Core half-width at the head, world meters. */
export const LIGHT_CORE_HALF_W_M = 0.9
/** Halo half-width multiplier over the core. */
export const LIGHT_HALO_SCALE = 3
/** Core / halo gains (additive). */
export const LIGHT_CORE_GAIN = 0.42
export const LIGHT_HALO_GAIN = 0.1
/** Along-beam falloff exponent. */
export const LIGHT_FALLOFF_POW = 1.15

const DEG = Math.PI / 180

const VS = `
attribute vec2 aClip;
attribute vec2 aUv;
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  gl_Position = vec4(aClip, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
}
`

const FS = `
precision mediump float;
varying vec2 vUv;
varying vec4 vColor;
uniform float uFalloffPow;
void main() {
  float across = exp(-3.0 * vUv.y * vUv.y);
  float along = pow(max(0.0, 1.0 - vUv.x), uFalloffPow);
  float a = across * along * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
}
`

export interface SearchlightPipeline {
  draw(lights: readonly LightState[], camera: Camera): void
  dispose(): void
}

/** Visible 2-D beam geometry in the x–z plane: unit direction and length. */
export function beamPlanar(
  dir: { x: number; y: number; z: number },
  reachM: number,
): { ux: number; uz: number; lenM: number } {
  const planar = Math.hypot(dir.x, dir.z)
  if (planar < 1e-6) return { ux: 0, uz: 1, lenM: reachM * LIGHT_DRAW_FRACTION * 0.05 }
  return { ux: dir.x / planar, uz: dir.z / planar, lenM: reachM * LIGHT_DRAW_FRACTION * planar }
}

export function createSearchlightPipeline(gl: WebGLRenderingContext): SearchlightPipeline {
  const prog = compileProgram(gl, VS, FS)
  const uFalloffPow = gl.getUniformLocation(prog, 'uFalloffPow')
  const stream: VertexStream = createVertexStream(gl, prog, [
    { name: 'aClip', size: 2 },
    { name: 'aUv', size: 2 },
    { name: 'aColor', size: 4 },
  ])
  const sink = new FloatSink(2048)

  return {
    draw(lights, camera): void {
      if (lights.length === 0) return
      sink.reset()
      for (const l of lights) {
        if (!(l.intensity > 0.005)) continue
        const { ux, uz, lenM } = beamPlanar(l.dir, l.reachM)
        const x0 = l.base.x
        const z0 = l.base.z
        const x1 = x0 + ux * lenM
        const z1 = z0 + uz * lenM
        const nx = -uz
        const nz = ux
        const wFar = Math.max(LIGHT_CORE_HALF_W_M, lenM * Math.tan(l.halfAngleDeg * DEG))
        for (const [scale, gain] of [
          [1, LIGHT_CORE_GAIN],
          [LIGHT_HALO_SCALE, LIGHT_HALO_GAIN],
        ] as const) {
          const w0 = LIGHT_CORE_HALF_W_M * scale
          const w1 = wFar * scale
          const aN = camera.project(x0 - nx * w0, z0 - nz * w0)
          const aP = camera.project(x0 + nx * w0, z0 + nz * w0)
          const bN = camera.project(x1 - nx * w1, z1 - nz * w1)
          const bP = camera.project(x1 + nx * w1, z1 + nz * w1)
          pushQuad(sink, aN, aP, bN, bP, 0, 1, [l.r, l.g, l.b, gain * l.intensity])
        }
      }
      if (sink.length === 0) return
      gl.useProgram(prog)
      gl.uniform1f(uFalloffPow, LIGHT_FALLOFF_POW)
      stream.draw(sink.data, sink.length, gl.TRIANGLES)
    },
    dispose(): void {
      stream.dispose()
      gl.deleteProgram(prog)
    },
  }
}
