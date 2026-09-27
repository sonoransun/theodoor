/**
 * Star streak pipeline: draws the quads packed by render/streaks.ts. The
 * fragment shader fades across the streak (exp(−4v²)) and along it from a
 * dim tail (u = 0) to the head (u = 1), so a trail reads as motion blur
 * behind the star sprite drawn by glParticles. Premultiplied additive output
 * (the renderer sets blendFunc(ONE, ONE)).
 */
import type { SimSnapshot } from '@theodoor/core'
import type { Camera } from './camera.js'
import { FloatSink, createVertexStream } from './glStream.js'
import type { VertexStream } from './glStream.js'
import { packStreaks } from './streaks.js'
import { compileProgram } from './types.js'

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
  float across = exp(-4.0 * vUv.y * vUv.y);
  float along = vUv.x * vUv.x;
  float a = across * along * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
}
`

export interface StreakPipeline {
  draw(snapshot: SimSnapshot, camera: Camera): void
  dispose(): void
}

export function createStreakPipeline(gl: WebGLRenderingContext): StreakPipeline {
  const prog = compileProgram(gl, VS, FS)
  const stream: VertexStream = createVertexStream(gl, prog, [
    { name: 'aClip', size: 2 },
    { name: 'aUv', size: 2 },
    { name: 'aColor', size: 4 },
  ])
  const sink = new FloatSink(4096)
  return {
    draw(snapshot, camera): void {
      const packed = packStreaks(snapshot, camera, sink)
      if (packed.count === 0) return
      stream.draw(packed.data, packed.floats, gl.TRIANGLES)
    },
    dispose(): void {
      stream.dispose()
      gl.deleteProgram(prog)
    },
  }
}
