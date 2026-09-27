/**
 * Fountain pipeline: illuminated water columns from SimSnapshot.jets.
 *
 * Each JetState draws as a tapered quad from its nozzle (base.x, base.z) to
 * its tip (base.x + tipDx, base.z + heightM) — fanned jets lean via tipDx —
 * with half-width widthM/2 (pixel floor FOUNTAIN_MIN_HALF_W_PX) widening
 * slightly toward the tip as the column breaks up. Underwater lights sit at
 * the nozzle, so the column is brightest at its base (u = 0) and dims toward
 * the crest; a bright core (exp(−7v²)) rides inside a soft spray edge
 * (exp(−1.6v²)). The crest itself gets a small glow sprite (POINTS) so the
 * beat landing — the column cresting — has a visible highlight. Falling
 * columns dim by FOUNTAIN_FALL_DIM; wide, low 'mist' columns read as a soft
 * glowing band through the same shader. Premultiplied additive output.
 */
import type { JetState } from '@theodoor/core'
import type { Camera } from './camera.js'
import { FloatSink, createVertexStream, pushQuad } from './glStream.js'
import type { VertexStream } from './glStream.js'
import { compileProgram } from './types.js'

/** Column half-width floor, device pixels. */
export const FOUNTAIN_MIN_HALF_W_PX = 1.5
/** Extra spread at the crest relative to the base half-width. */
export const FOUNTAIN_TIP_SPREAD = 1.35
/** Overall column gain (additive). */
export const FOUNTAIN_GAIN = 0.85
/** Falling-phase dimming. */
export const FOUNTAIN_FALL_DIM = 0.72
/** Crest glow sprite size, device px per world meter of width (clamped). */
export const FOUNTAIN_CREST_PX_PER_M = 14
export const FOUNTAIN_CREST_MIN_PX = 4
export const FOUNTAIN_CREST_MAX_PX = 40
/** Crest glow gain relative to the column color. */
export const FOUNTAIN_CREST_GAIN = 0.55

const COLUMN_VS = `
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

const COLUMN_FS = `
precision mediump float;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float core = exp(-7.0 * vUv.y * vUv.y);
  float spray = 0.35 * exp(-1.6 * vUv.y * vUv.y);
  float along = mix(1.0, 0.45, vUv.x);
  float a = (core + spray) * along * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
}
`

const CREST_VS = `
attribute vec2 aClip;
attribute float aSizePx;
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  gl_Position = vec4(aClip, 0.0, 1.0);
  gl_PointSize = aSizePx;
  vColor = aColor;
}
`

const CREST_FS = `
precision mediump float;
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float g = exp(-14.0 * d * d);
  gl_FragColor = vec4(vColor.rgb * vColor.a * g, 1.0);
}
`

export interface FountainPipeline {
  draw(jets: readonly JetState[], camera: Camera): void
  dispose(): void
}

/** Column alpha for a jet's phase (holding/rising full, falling dimmed). */
export function jetAlpha(phase: JetState['phase']): number {
  return FOUNTAIN_GAIN * (phase === 'falling' ? FOUNTAIN_FALL_DIM : 1)
}

export function createFountainPipeline(gl: WebGLRenderingContext): FountainPipeline {
  const columnProg = compileProgram(gl, COLUMN_VS, COLUMN_FS)
  const crestProg = compileProgram(gl, CREST_VS, CREST_FS)
  const columns: VertexStream = createVertexStream(gl, columnProg, [
    { name: 'aClip', size: 2 },
    { name: 'aUv', size: 2 },
    { name: 'aColor', size: 4 },
  ])
  const crests: VertexStream = createVertexStream(gl, crestProg, [
    { name: 'aClip', size: 2 },
    { name: 'aSizePx', size: 1 },
    { name: 'aColor', size: 4 },
  ])
  const columnSink = new FloatSink(2048)
  const crestSink = new FloatSink(256)

  return {
    draw(jets, camera): void {
      if (jets.length === 0) return
      const ppm = camera.pxPerMeter()
      const minHalfW = FOUNTAIN_MIN_HALF_W_PX / Math.max(1e-6, ppm)
      columnSink.reset()
      crestSink.reset()
      for (const j of jets) {
        if (!(j.heightM > 0)) continue
        const x0 = j.base.x
        const z0 = j.base.z
        const x1 = j.base.x + j.tipDx
        const z1 = j.base.z + j.heightM
        const dx = x1 - x0
        const dz = z1 - z0
        const len = Math.hypot(dx, dz)
        if (len < 1e-3) continue
        const nx = -dz / len
        const nz = dx / len
        const w0 = Math.max(minHalfW, j.widthM / 2)
        const w1 = w0 * FOUNTAIN_TIP_SPREAD
        const alpha = jetAlpha(j.phase)
        const aN = camera.project(x0 - nx * w0, z0 - nz * w0)
        const aP = camera.project(x0 + nx * w0, z0 + nz * w0)
        const bN = camera.project(x1 - nx * w1, z1 - nz * w1)
        const bP = camera.project(x1 + nx * w1, z1 + nz * w1)
        pushQuad(columnSink, aN, aP, bN, bP, 0, 1, [j.r, j.g, j.b, alpha])

        // Crest glow: brightest once the column has crested (the landing).
        const tip = camera.project(x1, z1)
        const sizePx = Math.min(
          FOUNTAIN_CREST_MAX_PX,
          Math.max(FOUNTAIN_CREST_MIN_PX, j.widthM * FOUNTAIN_CREST_PX_PER_M * (ppm / 1.9)),
        )
        const crestA = FOUNTAIN_CREST_GAIN * (j.crested ? 1 : 0.5) * (j.phase === 'falling' ? 0.6 : 1)
        crestSink.push(tip.x, tip.y, sizePx, j.r, j.g, j.b, crestA)
      }
      columns.draw(columnSink.data, columnSink.length, gl.TRIANGLES)
      crests.draw(crestSink.data, crestSink.length, gl.POINTS)
    },
    dispose(): void {
      columns.dispose()
      crests.dispose()
      gl.deleteProgram(columnProg)
      gl.deleteProgram(crestProg)
    },
  }
}
