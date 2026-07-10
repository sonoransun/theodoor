/**
 * Point-sprite particle pipeline: one dynamic buffer, one draw call for all
 * stars + drones. Consumes the interleaved layout produced by
 * curves.packSnapshot: [clipX, clipY, sizePx, r, g, b, alpha] × count.
 *
 * sizePx is pre-multiplied by the camera's pxPerMeter at pack time, so the
 * overall point size is clamp(sizeM · pxPerMeter, 1.5, 64) px. A NEGATIVE
 * sizePx marks a drone: the shader takes abs() for the size and bumps the
 * halo term from 0.1 (stars) to 0.35 (drone glow).
 *
 * Output is premultiplied additive: rgb·alpha·(core + halo), drawn with
 * blendFunc(ONE, ONE) set by the renderer.
 */
import { PACK_STRIDE } from './curves.js'
import type { PackedParticles } from './curves.js'
import { compileProgram } from './types.js'

const VS = `
attribute vec2 aClip;
attribute float aSizePx;
attribute vec4 aColor;
varying vec4 vColor;
varying float vHalo;
void main() {
  gl_Position = vec4(aClip, 0.0, 1.0);
  gl_PointSize = clamp(abs(aSizePx), 1.5, 64.0);
  vColor = aColor;
  vHalo = aSizePx < 0.0 ? 0.35 : 0.1;
}
`

const FS = `
precision mediump float;
varying vec4 vColor;
varying float vHalo;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float core = exp(-18.0 * d * d);
  float halo = exp(-4.0 * d * d) * vHalo;
  gl_FragColor = vec4(vColor.rgb * vColor.a * (core + halo), 1.0);
}
`

export interface ParticlePipeline {
  draw(packed: PackedParticles): void
  dispose(): void
}

export function createParticlePipeline(gl: WebGLRenderingContext): ParticlePipeline {
  const prog = compileProgram(gl, VS, FS)
  const buf = gl.createBuffer()
  if (!buf) throw new Error('createBuffer failed')
  const aClip = gl.getAttribLocation(prog, 'aClip')
  const aSizePx = gl.getAttribLocation(prog, 'aSizePx')
  const aColor = gl.getAttribLocation(prog, 'aColor')
  let capacityFloats = 0

  return {
    draw(packed: PackedParticles): void {
      if (packed.count <= 0) return
      const view = packed.data.subarray(0, packed.count * PACK_STRIDE)

      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      if (view.length > capacityFloats) {
        // Grow with headroom so steady-state frames are a single subupload.
        capacityFloats = Math.ceil(view.length * 1.5)
        gl.bufferData(gl.ARRAY_BUFFER, capacityFloats * 4, gl.DYNAMIC_DRAW)
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, view)

      const strideBytes = PACK_STRIDE * 4
      gl.enableVertexAttribArray(aClip)
      gl.vertexAttribPointer(aClip, 2, gl.FLOAT, false, strideBytes, 0)
      gl.enableVertexAttribArray(aSizePx)
      gl.vertexAttribPointer(aSizePx, 1, gl.FLOAT, false, strideBytes, 8)
      gl.enableVertexAttribArray(aColor)
      gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, strideBytes, 12)

      gl.drawArrays(gl.POINTS, 0, packed.count)

      gl.disableVertexAttribArray(aClip)
      gl.disableVertexAttribArray(aSizePx)
      gl.disableVertexAttribArray(aColor)
    },
    dispose(): void {
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
    },
  }
}
