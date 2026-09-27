/**
 * Bloom post-process (WebGL1, RGBA8 targets only — no float textures).
 *
 *   begin(): bind the full-size scene target; the renderer draws the frame
 *            (backdrop + every additive layer) into it exactly as it would
 *            to the screen.
 *   end():   1. blit the scene target to the screen 1:1 (replace);
 *            2. downsample + soft-threshold the scene into small target A
 *               (BLOOM_DOWNSAMPLE, a 4-tap box on the bilinear texture);
 *            3. separable Gaussian: A → B horizontally, B → A vertically
 *               (kernel from render/bloom.ts, unrolled into the shader);
 *            4. add A over the screen with BLOOM_GAIN (blendFunc ONE, ONE).
 *
 * `available` is false when framebuffers cannot be completed on this
 * context (checkFramebufferStatus); begin()/end() are then no-ops and the
 * renderer draws straight to the screen as before. resize() recreates the
 * targets; dispose() frees everything; the renderer rebuilds the pipeline
 * on context restore like every other GL resource.
 */
import {
  BLOOM_GAIN,
  BLOOM_KERNEL_RADIUS,
  BLOOM_SIGMA,
  BLOOM_THRESHOLD,
  bloomTargetSize,
  gaussianKernel,
} from './bloom.js'
import { compileProgram } from './types.js'

const QUAD_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUv = aPos * 0.5 + 0.5;
}
`

const BLIT_FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
}
`

const DOWNSAMPLE_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv + uStep * vec2(-1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uStep * vec2( 1.0, -1.0)).rgb
         + texture2D(uTex, vUv + uStep * vec2(-1.0,  1.0)).rgb
         + texture2D(uTex, vUv + uStep * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  vec3 k = max(c - vec3(uThreshold), vec3(0.0)) / (1.0 - uThreshold);
  gl_FragColor = vec4(k, 1.0);
}
`

/** Unrolled separable blur: uStep is one texel along the blur axis. */
function blurFs(weights: readonly number[]): string {
  const r = (weights.length - 1) / 2
  const taps = weights
    .map((w, i) => `  c += texture2D(uTex, vUv + uStep * ${(i - r).toFixed(1)}).rgb * ${w.toFixed(6)};`)
    .join('\n')
  return `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
${taps}
  gl_FragColor = vec4(c, 1.0);
}
`
}

const ADD_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uGain;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uGain, 1.0);
}
`

interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

export interface BloomPipeline {
  /** False when offscreen targets cannot be completed (render straight to screen). */
  readonly available: boolean
  /** Bind the scene target (no-op when unavailable). */
  begin(): void
  /** Composite scene + bloom onto the default framebuffer (no-op when unavailable). */
  end(): void
  /** Recreate the targets for a new backing-store size. */
  resize(widthPx: number, heightPx: number): void
  dispose(): void
}

export function createBloomPipeline(
  gl: WebGLRenderingContext,
  widthPx: number,
  heightPx: number,
): BloomPipeline {
  const blitProg = compileProgram(gl, QUAD_VS, BLIT_FS)
  const downProg = compileProgram(gl, QUAD_VS, DOWNSAMPLE_FS)
  const blurProg = compileProgram(gl, QUAD_VS, blurFs(gaussianKernel(BLOOM_KERNEL_RADIUS, BLOOM_SIGMA)))
  const addProg = compileProgram(gl, QUAD_VS, ADD_FS)
  const quad = gl.createBuffer()
  if (!quad) throw new Error('createBuffer failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  let scene: Target | null = null
  let small: [Target, Target] | null = null
  let available = false
  let fullW = Math.max(1, widthPx)
  let fullH = Math.max(1, heightPx)

  function makeTarget(w: number, h: number): Target | null {
    const tex = gl.createTexture()
    const fbo = gl.createFramebuffer()
    if (!tex || !fbo) return null
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (!ok) {
      gl.deleteTexture(tex)
      gl.deleteFramebuffer(fbo)
      return null
    }
    return { tex, fbo, w, h }
  }

  function freeTarget(t: Target | null): void {
    if (!t) return
    gl.deleteTexture(t.tex)
    gl.deleteFramebuffer(t.fbo)
  }

  function rebuild(): void {
    freeTarget(scene)
    if (small) {
      freeTarget(small[0])
      freeTarget(small[1])
    }
    scene = null
    small = null
    available = false
    const s = makeTarget(fullW, fullH)
    if (!s) return
    const { w, h } = bloomTargetSize(fullW, fullH)
    const a = makeTarget(w, h)
    const b = makeTarget(w, h)
    if (!a || !b) {
      freeTarget(s)
      freeTarget(a)
      freeTarget(b)
      return
    }
    scene = s
    small = [a, b]
    available = true
  }

  // Program locations are resolved once (string-keyed GL queries are not
  // free) — the same discipline as every other pipeline in render/.
  interface QuadProgram {
    prog: WebGLProgram
    aPos: number
    uTex: WebGLUniformLocation | null
  }
  const quadProgram = (prog: WebGLProgram): QuadProgram => ({
    prog,
    aPos: gl.getAttribLocation(prog, 'aPos'),
    uTex: gl.getUniformLocation(prog, 'uTex'),
  })
  const blitQ = quadProgram(blitProg)
  const downQ = quadProgram(downProg)
  const blurQ = quadProgram(blurProg)
  const addQ = quadProgram(addProg)
  const uDownStep = gl.getUniformLocation(downProg, 'uStep')
  const uDownThreshold = gl.getUniformLocation(downProg, 'uThreshold')
  const uBlurStep = gl.getUniformLocation(blurProg, 'uStep')
  const uAddGain = gl.getUniformLocation(addProg, 'uGain')

  function drawQuad(q: QuadProgram, tex: WebGLTexture, setUniforms: () => void): void {
    gl.useProgram(q.prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(q.uTex, 0)
    setUniforms()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(q.aPos)
    gl.vertexAttribPointer(q.aPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disableVertexAttribArray(q.aPos)
  }

  rebuild()

  return {
    get available(): boolean {
      return available
    },
    begin(): void {
      if (!available || !scene) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo)
      gl.viewport(0, 0, scene.w, scene.h)
    },
    end(): void {
      if (!available || !scene || !small) return
      const [a, b] = small
      // 1. scene → screen (replace).
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, fullW, fullH)
      gl.disable(gl.BLEND)
      drawQuad(blitQ, scene.tex, () => {})
      // 2. threshold + downsample → A.
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo)
      gl.viewport(0, 0, a.w, a.h)
      drawQuad(downQ, scene.tex, () => {
        gl.uniform2f(uDownStep, 1 / scene!.w, 1 / scene!.h)
        gl.uniform1f(uDownThreshold, BLOOM_THRESHOLD)
      })
      // 3. blur A → B (horizontal), B → A (vertical).
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo)
      drawQuad(blurQ, a.tex, () => {
        gl.uniform2f(uBlurStep, 1 / a.w, 0)
      })
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo)
      drawQuad(blurQ, b.tex, () => {
        gl.uniform2f(uBlurStep, 0, 1 / a.h)
      })
      // 4. add A over the screen.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, fullW, fullH)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      drawQuad(addQ, a.tex, () => {
        gl.uniform1f(uAddGain, BLOOM_GAIN)
      })
      gl.disable(gl.BLEND)
    },
    resize(widthPx, heightPx): void {
      fullW = Math.max(1, Math.round(widthPx))
      fullH = Math.max(1, Math.round(heightPx))
      rebuild()
    },
    dispose(): void {
      freeTarget(scene)
      if (small) {
        freeTarget(small[0])
        freeTarget(small[1])
      }
      scene = null
      small = null
      available = false
      gl.deleteBuffer(quad)
      gl.deleteProgram(blitProg)
      gl.deleteProgram(downProg)
      gl.deleteProgram(blurProg)
      gl.deleteProgram(addProg)
    },
  }
}
