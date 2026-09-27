/**
 * Renderer contract shared by the GL renderer (and any future backend),
 * plus the one tiny GL utility every pipeline needs. There is deliberately
 * NO Canvas2D fallback renderer: when WebGL is unavailable the app shows a
 * "WebGL required" message instead.
 */
import type { CompiledShow, EffectDef, PositionedAsset, SimSnapshot, SitePlan } from '@theodoor/core'

export interface Renderer {
  /** CSS size + devicePixelRatio; backing store is w·dpr × h·dpr. */
  resize(w: number, h: number, dpr: number): void
  render(snapshot: SimSnapshot, tSec: number): void
  dispose(): void
}

/** A renderer that also knows the site assets (beam/panel/backdrop anchors). */
export interface SceneRenderer extends Renderer {
  setAssets(assets: readonly PositionedAsset[]): void
  /**
   * Site for the derived-geometry layers (crowd grid, beam floor band).
   * Null for site-less sessions (synthetic demo) — those layers skip.
   */
  setSite(site: SitePlan | null): void
  /**
   * The compiled show for cue-derived layers (wind-drifted smoke from the
   * pyro bursts) plus the app's effect lookup for its catalog. Null / absent
   * for site-less sessions — those layers skip.
   */
  setCompiled(compiled: CompiledShow | null, getEffect?: (id: string) => EffectDef | undefined): void
}

/** Compile + link a WebGL1 program; throws with the info log on failure. */
export function compileProgram(
  gl: WebGLRenderingContext,
  vsSrc: string,
  fsSrc: string,
): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)
    if (!sh) throw new Error('createShader failed')
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(sh) ?? 'unknown error'
      gl.deleteShader(sh)
      throw new Error(`shader compile failed: ${log}`)
    }
    return sh
  }
  const prog = gl.createProgram()
  if (!prog) throw new Error('createProgram failed')
  const vs = compile(gl.VERTEX_SHADER, vsSrc)
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog) ?? 'unknown error'
    gl.deleteProgram(prog)
    throw new Error(`program link failed: ${log}`)
  }
  return prog
}
