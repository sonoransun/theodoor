/**
 * WebGL1 scene renderer. Frame order:
 *   0. bloom.begin()                — redirect the frame into the scene target
 *      (no-op when offscreen targets are unavailable: draw straight to screen)
 *   1. clear (near-black) + backdrop texture quad — normal (opaque) pass
 *   2. wind-drifted smoke           — additive haze (needs setCompiled)
 *   3. star streaks                 — additive (from SimSnapshot.stars.vel)
 *   4. particles (stars + drones)   — additive, blendFunc(ONE, ONE)
 *   5. laser beams                  — additive
 *   6. LED panels + panel bloom     — additive
 *   7. fountain columns + crests    — additive (SimSnapshot.jets)
 *   8. searchlight beams            — additive (SimSnapshot.lights)
 *   9. crowd-canvas cell points     — additive (floor band, needs setSite)
 *  10. audio-beam frustums          — additive (floor band, needs setSite)
 *  11. bloom.end()                  — scene → screen, thresholded blur added
 *
 * Passes 2–10 are all additive and therefore order-independent; the order
 * above is just the order they arrived in.
 *
 * Context loss policy: the first loss is survivable — on 'webglcontextrestored'
 * every GL resource is rebuilt once. A second loss within 10 seconds is
 * treated as fatal: resources are torn down and opts.onFatal(message) fires so
 * the app can show its "WebGL required" fallback div (there is no Canvas2D
 * fallback renderer by design).
 */
import { crowdGridFor } from '@theodoor/core'
import type {
  CompiledShow,
  CrowdGrid,
  EffectDef,
  PositionedAsset,
  SimSnapshot,
  SitePlan,
  Wind,
} from '@theodoor/core'
import { drawBackdrop } from './backdrop.js'
import { makeCamera } from './camera.js'
import type { Camera } from './camera.js'
import { packSnapshot } from './curves.js'
import { createAudioBeamPipeline } from './glAudioBeams.js'
import type { AudioBeamPipeline } from './glAudioBeams.js'
import { createBeamPipeline } from './glBeams.js'
import type { BeamPipeline } from './glBeams.js'
import { createBloomPipeline } from './glBloom.js'
import type { BloomPipeline } from './glBloom.js'
import { createCrowdPipeline } from './glCrowd.js'
import type { CrowdPipeline } from './glCrowd.js'
import { createFountainPipeline } from './glFountains.js'
import type { FountainPipeline } from './glFountains.js'
import { createPanelPipeline } from './glPanel.js'
import type { PanelPipeline } from './glPanel.js'
import { createParticlePipeline } from './glParticles.js'
import type { ParticlePipeline } from './glParticles.js'
import { createSearchlightPipeline } from './glSearchlights.js'
import type { SearchlightPipeline } from './glSearchlights.js'
import { createSmokePipeline } from './glSmoke.js'
import { prepareSmoke, type SmokeSource } from './smoke.js'
import type { SmokePipeline } from './glSmoke.js'
import { createStreakPipeline } from './glStreaks.js'
import type { StreakPipeline } from './glStreaks.js'
import { compileProgram } from './types.js'
import type { SceneRenderer } from './types.js'

export const CONTEXT_LOSS_FATAL_WINDOW_MS = 10_000
/** Fixed seed for the audience-silhouette scatter — same crowd every load. */
const BACKDROP_SEED = 0x7e0d0012

const BACKDROP_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
}
`

const BACKDROP_FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}
`

export interface GlRendererOptions {
  /** Fired when the context is lost twice within the fatal window. */
  onFatal: (message: string) => void
  /** Millisecond clock for loss bookkeeping; defaults to performance.now(). */
  now?: () => number
}

interface GlResources {
  particles: ParticlePipeline
  streaks: StreakPipeline
  smoke: SmokePipeline
  beams: BeamPipeline
  panels: PanelPipeline
  fountains: FountainPipeline
  searchlights: SearchlightPipeline
  crowd: CrowdPipeline
  audioBeams: AudioBeamPipeline
  bloom: BloomPipeline
  backdropProg: WebGLProgram
  backdropTex: WebGLTexture
  backdropBuf: WebGLBuffer
  backdropAPos: number
}

/** Returns null when a WebGL1 context cannot be created at all. */
export function createGlRenderer(
  canvas: HTMLCanvasElement,
  opts: GlRendererOptions,
): SceneRenderer | null {
  let gl: WebGLRenderingContext | null = null
  try {
    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    })
  } catch {
    gl = null
  }
  if (!gl) return null
  const ctx = gl

  const now = opts.now ?? (() => performance.now())
  const backdropCanvas = document.createElement('canvas')

  let camera: Camera = makeCamera(canvas.width || 1, canvas.height || 1)
  let assets: readonly PositionedAsset[] = []
  /** Crowd grid derived from setSite (undefined → audience layers skip). */
  let crowdGrid: CrowdGrid | undefined
  /** Compiled show for cue-derived layers (null → those layers skip). */
  let compiledShow: CompiledShow | null = null
  /** Smoke plan precomputed from the compiled show (empty → no smoke layer). */
  let smokePlan: readonly SmokeSource[] = []
  /** Site wind from setSite (smoke drift). */
  let wind: Wind | undefined
  const assetById = new Map<string, PositionedAsset>()
  let res: GlResources | null = null
  let packScratch: Float32Array | undefined
  let contextLost = false
  let dead = false
  let disposed = false
  let lastLossAtMs: number | null = null

  function initGl(): GlResources {
    ctx.disable(ctx.DEPTH_TEST)
    ctx.disable(ctx.CULL_FACE)
    ctx.clearColor(0.005, 0.008, 0.03, 1)

    const backdropProg = compileProgram(ctx, BACKDROP_VS, BACKDROP_FS)
    const backdropTex = ctx.createTexture()
    const backdropBuf = ctx.createBuffer()
    if (!backdropTex || !backdropBuf) throw new Error('backdrop resource alloc failed')
    ctx.bindBuffer(ctx.ARRAY_BUFFER, backdropBuf)
    ctx.bufferData(
      ctx.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      ctx.STATIC_DRAW,
    )
    ctx.bindTexture(ctx.TEXTURE_2D, backdropTex)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE)

    return {
      particles: createParticlePipeline(ctx),
      streaks: createStreakPipeline(ctx),
      smoke: createSmokePipeline(ctx),
      beams: createBeamPipeline(ctx),
      panels: createPanelPipeline(ctx),
      fountains: createFountainPipeline(ctx),
      searchlights: createSearchlightPipeline(ctx),
      crowd: createCrowdPipeline(ctx),
      audioBeams: createAudioBeamPipeline(ctx),
      bloom: createBloomPipeline(ctx, camera.widthPx, camera.heightPx),
      backdropProg,
      backdropTex,
      backdropBuf,
      backdropAPos: ctx.getAttribLocation(backdropProg, 'aPos'),
    }
  }

  function launchXs(): number[] {
    return assets.filter((a) => a.kind === 'mortarRack').map((a) => a.pos.x)
  }

  function redrawBackdrop(): void {
    if (!res || contextLost) return
    backdropCanvas.width = camera.widthPx
    backdropCanvas.height = camera.heightPx
    const c2d = backdropCanvas.getContext('2d')
    if (!c2d) return
    drawBackdrop(c2d, camera, { seed: BACKDROP_SEED, launchXs: launchXs() })
    ctx.bindTexture(ctx.TEXTURE_2D, res.backdropTex)
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGB, ctx.RGB, ctx.UNSIGNED_BYTE, backdropCanvas)
  }

  function drawBackdropPass(): void {
    if (!res) return
    ctx.disable(ctx.BLEND)
    ctx.useProgram(res.backdropProg)
    ctx.activeTexture(ctx.TEXTURE0)
    ctx.bindTexture(ctx.TEXTURE_2D, res.backdropTex)
    ctx.uniform1i(ctx.getUniformLocation(res.backdropProg, 'uTex'), 0)
    ctx.bindBuffer(ctx.ARRAY_BUFFER, res.backdropBuf)
    ctx.enableVertexAttribArray(res.backdropAPos)
    ctx.vertexAttribPointer(res.backdropAPos, 2, ctx.FLOAT, false, 0, 0)
    ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4)
    ctx.disableVertexAttribArray(res.backdropAPos)
  }

  function fail(message: string): void {
    dead = true
    res = null
    opts.onFatal(message)
  }

  const onContextLost = (e: Event): void => {
    e.preventDefault() // signal that we intend to restore
    contextLost = true
    const t = now()
    if (lastLossAtMs !== null && t - lastLossAtMs < CONTEXT_LOSS_FATAL_WINDOW_MS) {
      fail(
        'The WebGL context was lost twice in quick succession. ' +
          'WebGL is required (there is no 2D fallback) — reload the page or ' +
          'enable hardware acceleration.',
      )
      return
    }
    lastLossAtMs = t
  }

  const onContextRestored = (): void => {
    if (dead || disposed) return
    contextLost = false
    res = initGl() // rebuild every GL resource once
    ctx.viewport(0, 0, camera.widthPx, camera.heightPx)
    redrawBackdrop()
  }

  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)

  try {
    res = initGl()
  } catch {
    canvas.removeEventListener('webglcontextlost', onContextLost)
    canvas.removeEventListener('webglcontextrestored', onContextRestored)
    return null
  }
  redrawBackdrop()

  return {
    setAssets(next: readonly PositionedAsset[]): void {
      assets = next
      assetById.clear()
      for (const a of next) assetById.set(a.id, a)
      redrawBackdrop()
    },

    setSite(site: SitePlan | null): void {
      crowdGrid = site ? crowdGridFor(site) : undefined
      wind = site?.wind
    },

    setCompiled(compiled: CompiledShow | null, getEffect?: (id: string) => EffectDef | undefined): void {
      compiledShow = compiled
      // The app owns catalog resolution (one lookup per session); without a
      // lookup there is simply no smoke layer.
      smokePlan = compiled && getEffect ? prepareSmoke(compiled, getEffect) : []
    },

    resize(w: number, h: number, dpr: number): void {
      if (disposed) return
      const pw = Math.max(1, Math.round(w * dpr))
      const ph = Math.max(1, Math.round(h * dpr))
      canvas.width = pw
      canvas.height = ph
      camera = makeCamera(pw, ph)
      if (!contextLost && !dead) {
        ctx.viewport(0, 0, pw, ph)
        res?.bloom.resize(pw, ph)
      }
      redrawBackdrop()
    },

    render(snapshot: SimSnapshot, tSec: number): void {
      if (disposed || dead || contextLost || !res) return

      res.bloom.begin()
      ctx.clear(ctx.COLOR_BUFFER_BIT)
      drawBackdropPass()

      // Everything on top of the backdrop is emissive → additive blending.
      ctx.enable(ctx.BLEND)
      ctx.blendFunc(ctx.ONE, ctx.ONE)

      if (compiledShow && smokePlan.length > 0) res.smoke.draw(smokePlan, wind, camera, tSec)
      res.streaks.draw(snapshot, camera)
      const packed = packSnapshot(snapshot, camera, packScratch)
      packScratch = packed.data
      res.particles.draw(packed)
      res.beams.draw(snapshot.laserFrames, camera, assetById)
      res.panels.draw(snapshot.panelFrames, camera, assetById)
      res.fountains.draw(snapshot.jets, camera)
      res.searchlights.draw(snapshot.lights, camera)
      res.crowd.draw(snapshot.crowd, camera, crowdGrid)
      res.audioBeams.draw(snapshot.beams, camera, crowdGrid, snapshot.t)
      res.bloom.end()
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      if (res && !contextLost) {
        res.particles.dispose()
        res.streaks.dispose()
        res.smoke.dispose()
        res.beams.dispose()
        res.panels.dispose()
        res.fountains.dispose()
        res.searchlights.dispose()
        res.crowd.dispose()
        res.audioBeams.dispose()
        res.bloom.dispose()
        ctx.deleteProgram(res.backdropProg)
        ctx.deleteTexture(res.backdropTex)
        ctx.deleteBuffer(res.backdropBuf)
      }
      res = null
    },
  }
}
