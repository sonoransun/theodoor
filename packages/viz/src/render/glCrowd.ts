/**
 * Crowd-canvas pipeline: one GL point per audience cell, lighting up the
 * floor band from SimSnapshot.crowd.
 *
 * FLOOR-BAND MAPPING (see render/crowdBand.ts, the single owner): the camera
 * projects world x–z and ignores world y, so lawn cells map to
 *   clipX = camera.project(centroid.x, 0).x
 *   clipY = band above the backdrop silhouettes — front rows (row rows−1,
 *           nearest the stage) sit LOWER (groundY − 4 px), back rows HIGHER
 *           (groundY − 36 px), lerped by the cell's world y.
 *
 * Cell positions are static per (grid, camera): recomputed only when either
 * identity changes (session switch / resize / context restore). Per frame the
 * only upload is ONE bufferData of colors — wristband rgb plus the phone
 * flashlight channel added as white light. Premultiplied additive output
 * (renderer sets blendFunc(ONE, ONE)); the unlit crowd stays visible as the
 * backdrop silhouettes underneath.
 */
import type { CrowdGrid, SimSnapshot } from '@theodoor/core'
import type { Camera } from './camera.js'
import { crowdCellClipPositions } from './crowdBand.js'
import { compileProgram } from './types.js'

/** Crowd cell point size, device px. */
export const CROWD_POINT_SIZE_PX = 5

const VS = `
attribute vec2 aClip;
attribute vec3 aColor;
uniform float uSizePx;
varying vec3 vColor;
void main() {
  gl_Position = vec4(aClip, 0.0, 1.0);
  gl_PointSize = uSizePx;
  vColor = aColor;
}
`

const FS = `
precision mediump float;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float core = exp(-10.0 * d * d);
  gl_FragColor = vec4(vColor * core, 1.0);
}
`

export interface CrowdPipeline {
  draw(crowd: SimSnapshot['crowd'], camera: Camera, grid: CrowdGrid | undefined): void
  dispose(): void
}

export function createCrowdPipeline(gl: WebGLRenderingContext): CrowdPipeline {
  const prog = compileProgram(gl, VS, FS)
  const posBuf = gl.createBuffer()
  const colorBuf = gl.createBuffer()
  if (!posBuf || !colorBuf) throw new Error('createBuffer failed')
  const aClip = gl.getAttribLocation(prog, 'aClip')
  const aColor = gl.getAttribLocation(prog, 'aColor')
  const uSizePx = gl.getUniformLocation(prog, 'uSizePx')

  // Static-geometry cache: rebuilt when the grid or camera identity changes.
  let cachedGrid: CrowdGrid | undefined
  let cachedCamera: Camera | undefined
  let cachedCount = 0
  let colors: Float32Array | undefined

  return {
    draw(crowd, camera, grid): void {
      if (crowd.cellCount === 0 || !grid) return
      const count = Math.min(crowd.cellCount, grid.cells.length)
      if (count === 0) return

      if (grid !== cachedGrid || camera !== cachedCamera) {
        cachedGrid = grid
        cachedCamera = camera
        cachedCount = grid.cells.length
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
        gl.bufferData(gl.ARRAY_BUFFER, crowdCellClipPositions(grid, camera), gl.STATIC_DRAW)
      }
      if (count > cachedCount) return // grid/snapshot mismatch — skip safely

      // Colors: wristband rgb + phone flashlight added as white light.
      if (!colors || colors.length < count * 3) colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        const w = crowd.white[i]!
        colors[3 * i] = crowd.rgb[3 * i]! + w
        colors[3 * i + 1] = crowd.rgb[3 * i + 1]! + w
        colors[3 * i + 2] = crowd.rgb[3 * i + 2]! + w
      }

      gl.useProgram(prog)
      gl.uniform1f(uSizePx, CROWD_POINT_SIZE_PX)

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
      gl.enableVertexAttribArray(aClip)
      gl.vertexAttribPointer(aClip, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf)
      gl.bufferData(gl.ARRAY_BUFFER, colors.subarray(0, count * 3), gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(aColor)
      gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0)

      gl.drawArrays(gl.POINTS, 0, count)

      gl.disableVertexAttribArray(aClip)
      gl.disableVertexAttribArray(aColor)
    },
    dispose(): void {
      gl.deleteBuffer(posBuf)
      gl.deleteBuffer(colorBuf)
      gl.deleteProgram(prog)
    },
  }
}
