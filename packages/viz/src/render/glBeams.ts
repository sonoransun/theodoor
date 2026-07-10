/**
 * Laser beam pipeline. Each SimSnapshot.laserFrames entry carries points in
 * projector space [-1, 1]²; we map that square onto a per-asset "sky quad" —
 * a SKY_QUAD_W_M × SKY_QUAD_H_M world rect centered horizontally on the
 * asset's x position, rising from the asset's elevation:
 *
 *   worldX = asset.pos.x + px · SKY_QUAD_W_M / 2        (px ∈ [-1, 1])
 *   worldZ = asset.elevationM + (py + 1)/2 · SKY_QUAD_H_M (py ∈ [-1, 1])
 *
 * Every consecutive point pair with BOTH endpoints unblanked becomes one
 * quad (two triangles) whose half-width widens from BEAM_HALF_W_NEAR_M at
 * the segment start to BEAM_HALF_W_FAR_M at the end. The fragment shader
 * fades alpha = exp(-4·v²) · mix(1, 0.25, u) · intensity — brightest and
 * tightest near the start, reading as atmospheric scatter.
 *
 * Per-segment intensity is the peak rgb component of the averaged endpoint
 * colors; the varying color is normalized by it so intensity is not counted
 * twice. Premultiplied additive output (renderer sets blendFunc(ONE, ONE)).
 */
import type { PositionedAsset, SimSnapshot } from '@theodoor/core'
import type { Camera } from './camera.js'
import { compileProgram } from './types.js'

export const SKY_QUAD_W_M = 200
export const SKY_QUAD_H_M = 150
export const BEAM_HALF_W_NEAR_M = 0.5
export const BEAM_HALF_W_FAR_M = 2.5

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
void main() {
  float a = exp(-4.0 * vUv.y * vUv.y) * mix(1.0, 0.25, vUv.x) * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
}
`

// Per vertex: [clipX, clipY, u, v, r, g, b, intensity]
const VERT_FLOATS = 8

export interface BeamPipeline {
  draw(
    frames: SimSnapshot['laserFrames'],
    camera: Camera,
    assetById: ReadonlyMap<string, PositionedAsset>,
  ): void
  dispose(): void
}

export function createBeamPipeline(gl: WebGLRenderingContext): BeamPipeline {
  const prog = compileProgram(gl, VS, FS)
  const buf = gl.createBuffer()
  if (!buf) throw new Error('createBuffer failed')
  const aClip = gl.getAttribLocation(prog, 'aClip')
  const aUv = gl.getAttribLocation(prog, 'aUv')
  const aColor = gl.getAttribLocation(prog, 'aColor')
  let capacityFloats = 0

  return {
    draw(frames, camera, assetById): void {
      const verts: number[] = []

      for (const frame of frames) {
        const asset = assetById.get(frame.assetId)
        if (!asset) continue
        const cx = asset.pos.x
        const zBase = asset.elevationM
        const pts = frame.points

        for (let i = 0; i + 1 < pts.length; i++) {
          const p0 = pts[i]
          const p1 = pts[i + 1]
          if (p0.blank || p1.blank) continue

          const ax = cx + p0.x * (SKY_QUAD_W_M / 2)
          const az = zBase + ((p0.y + 1) / 2) * SKY_QUAD_H_M
          const bx = cx + p1.x * (SKY_QUAD_W_M / 2)
          const bz = zBase + ((p1.y + 1) / 2) * SKY_QUAD_H_M

          const dx = bx - ax
          const dz = bz - az
          const len = Math.hypot(dx, dz)
          if (len < 1e-3) continue

          const r = (p0.r + p1.r) / 2
          const g = (p0.g + p1.g) / 2
          const b = (p0.b + p1.b) / 2
          const intensity = Math.max(r, g, b)
          if (intensity <= 1e-3) continue
          const hr = r / intensity
          const hg = g / intensity
          const hb = b / intensity

          // Unit normal to the segment in the x–z plane.
          const nx = -dz / len
          const nz = dx / len
          const w0 = BEAM_HALF_W_NEAR_M
          const w1 = BEAM_HALF_W_FAR_M

          const c = (x: number, z: number) => camera.project(x, z)
          const aN = c(ax - nx * w0, az - nz * w0)
          const aP = c(ax + nx * w0, az + nz * w0)
          const bN = c(bx - nx * w1, bz - nz * w1)
          const bP = c(bx + nx * w1, bz + nz * w1)

          // Two triangles: (a-, a+, b-) and (a+, b+, b-).
          verts.push(
            aN.x, aN.y, 0, -1, hr, hg, hb, intensity,
            aP.x, aP.y, 0, 1, hr, hg, hb, intensity,
            bN.x, bN.y, 1, -1, hr, hg, hb, intensity,
            aP.x, aP.y, 0, 1, hr, hg, hb, intensity,
            bP.x, bP.y, 1, 1, hr, hg, hb, intensity,
            bN.x, bN.y, 1, -1, hr, hg, hb, intensity,
          )
        }
      }

      if (verts.length === 0) return
      const data = new Float32Array(verts)

      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      if (data.length > capacityFloats) {
        capacityFloats = Math.ceil(data.length * 1.5)
        gl.bufferData(gl.ARRAY_BUFFER, capacityFloats * 4, gl.DYNAMIC_DRAW)
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)

      const strideBytes = VERT_FLOATS * 4
      gl.enableVertexAttribArray(aClip)
      gl.vertexAttribPointer(aClip, 2, gl.FLOAT, false, strideBytes, 0)
      gl.enableVertexAttribArray(aUv)
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, strideBytes, 8)
      gl.enableVertexAttribArray(aColor)
      gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, strideBytes, 16)

      gl.drawArrays(gl.TRIANGLES, 0, data.length / VERT_FLOATS)

      gl.disableVertexAttribArray(aClip)
      gl.disableVertexAttribArray(aUv)
      gl.disableVertexAttribArray(aColor)
    },
    dispose(): void {
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
    },
  }
}
