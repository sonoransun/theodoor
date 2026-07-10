/**
 * LED panel pipeline. Each SimSnapshot.panelFrames entry is a w×h RGB byte
 * grid for one panel asset. Per asset we keep a NEAREST-filtered RGB texture
 * (visible pixel grid — deliberate) updated with gl.texSubImage2D each draw,
 * and render two quads at the asset's world position:
 *   1. the panel itself at full alpha, physical size PanelSpec.pitchMm·wPx
 *      (× hPx) millimeters, bottom edge at asset.elevationM;
 *   2. a 1.15× scaled quad at alpha 0.2 around the same center — cheap bloom.
 * Output is premultiplied (rgb·alpha); the renderer draws panels additively.
 */
import type { PositionedAsset, SimSnapshot } from '@theodoor/core'
import type { Camera } from './camera.js'
import { compileProgram } from './types.js'

export const PANEL_BLOOM_SCALE = 1.15
export const PANEL_BLOOM_ALPHA = 0.2

const VS = `
attribute vec2 aClip;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  gl_Position = vec4(aClip, 0.0, 1.0);
  vUv = aUv;
}
`

const FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uAlpha, 1.0);
}
`

interface PanelTexture {
  tex: WebGLTexture
  w: number
  h: number
}

export interface PanelPipeline {
  draw(
    frames: SimSnapshot['panelFrames'],
    camera: Camera,
    assetById: ReadonlyMap<string, PositionedAsset>,
  ): void
  dispose(): void
}

export function createPanelPipeline(gl: WebGLRenderingContext): PanelPipeline {
  const prog = compileProgram(gl, VS, FS)
  const buf = gl.createBuffer()
  if (!buf) throw new Error('createBuffer failed')
  const aClip = gl.getAttribLocation(prog, 'aClip')
  const aUv = gl.getAttribLocation(prog, 'aUv')
  const uTex = gl.getUniformLocation(prog, 'uTex')
  const uAlpha = gl.getUniformLocation(prog, 'uAlpha')
  const textures = new Map<string, PanelTexture>()
  const quad = new Float32Array(6 * 4)

  function getTexture(assetId: string, w: number, h: number): PanelTexture {
    let entry = textures.get(assetId)
    if (entry && (entry.w !== w || entry.h !== h)) {
      gl.deleteTexture(entry.tex)
      entry = undefined
    }
    if (!entry) {
      const tex = gl.createTexture()
      if (!tex) throw new Error('createTexture failed')
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      entry = { tex, w, h }
      textures.set(assetId, entry)
    }
    return entry
  }

  /** Upload + draw one quad centered on (cx, czCenter), size wM×hM, alpha. */
  function drawQuad(
    camera: Camera,
    cx: number,
    czCenter: number,
    wM: number,
    hM: number,
    alpha: number,
  ): void {
    const tl = camera.project(cx - wM / 2, czCenter + hM / 2)
    const tr = camera.project(cx + wM / 2, czCenter + hM / 2)
    const bl = camera.project(cx - wM / 2, czCenter - hM / 2)
    const br = camera.project(cx + wM / 2, czCenter - hM / 2)
    // Texture row 0 is the TOP of the panel image (no Y flip on upload).
    quad.set([
      tl.x, tl.y, 0, 0,
      bl.x, bl.y, 0, 1,
      tr.x, tr.y, 1, 0,
      tr.x, tr.y, 1, 0,
      bl.x, bl.y, 0, 1,
      br.x, br.y, 1, 1,
    ])
    gl.uniform1f(uAlpha, alpha)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  return {
    draw(frames, camera, assetById): void {
      if (frames.length === 0) return
      gl.useProgram(prog)
      gl.activeTexture(gl.TEXTURE0)
      gl.uniform1i(uTex, 0)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      const strideBytes = 4 * 4
      gl.enableVertexAttribArray(aClip)
      gl.vertexAttribPointer(aClip, 2, gl.FLOAT, false, strideBytes, 0)
      gl.enableVertexAttribArray(aUv)
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, strideBytes, 8)

      for (const frame of frames) {
        const asset = assetById.get(frame.assetId)
        const spec = asset?.panel
        if (!asset || !spec) continue
        if (frame.w <= 0 || frame.h <= 0) continue
        if (frame.rgb.length < frame.w * frame.h * 3) continue

        const entry = getTexture(frame.assetId, frame.w, frame.h)
        gl.bindTexture(gl.TEXTURE_2D, entry.tex)
        gl.texSubImage2D(
          gl.TEXTURE_2D, 0, 0, 0,
          frame.w, frame.h, gl.RGB, gl.UNSIGNED_BYTE, frame.rgb,
        )

        const wM = (spec.pitchMm * spec.wPx) / 1000
        const hM = (spec.pitchMm * spec.hPx) / 1000
        const czCenter = asset.elevationM + hM / 2
        drawQuad(camera, asset.pos.x, czCenter, wM, hM, 1.0)
        drawQuad(
          camera, asset.pos.x, czCenter,
          wM * PANEL_BLOOM_SCALE, hM * PANEL_BLOOM_SCALE, PANEL_BLOOM_ALPHA,
        )
      }

      gl.disableVertexAttribArray(aClip)
      gl.disableVertexAttribArray(aUv)
    },
    dispose(): void {
      for (const entry of textures.values()) gl.deleteTexture(entry.tex)
      textures.clear()
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
    },
  }
}
