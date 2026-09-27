/**
 * Interleaved-float vertex stream: one dynamic ARRAY_BUFFER that grows with
 * headroom, plus attribute pointer setup derived from a declared layout. The
 * newer emissive pipelines (streaks, smoke, fountains, searchlights) all
 * push `[clipX, clipY, …]` floats per vertex and draw TRIANGLES; this helper
 * owns the upload/pointer boilerplate so each pipeline only owns its math
 * and shaders. WebGL1 only — no vertex array objects.
 */

export interface StreamAttrib {
  /** Attribute name in the vertex shader. */
  name: string
  /** Float components (1–4). */
  size: number
}

export interface VertexStream {
  /** Floats per vertex (sum of attribute sizes). */
  readonly stride: number
  /** Upload the first `floats` entries of `data` and draw them as `mode`. */
  draw(data: Float32Array, floats: number, mode: number): void
  dispose(): void
}

/** Growable Float32Array staging list — push floats, then hand `.data` to a stream. */
export class FloatSink {
  data: Float32Array
  length = 0

  constructor(initialFloats = 1024) {
    this.data = new Float32Array(initialFloats)
  }

  reset(): void {
    this.length = 0
  }

  /** Ensure room for `n` more floats (grows by doubling; never shrinks). */
  reserve(n: number): void {
    const need = this.length + n
    if (need <= this.data.length) return
    let cap = this.data.length
    while (cap < need) cap *= 2
    const next = new Float32Array(cap)
    next.set(this.data.subarray(0, this.length))
    this.data = next
  }

  push(...v: number[]): void {
    this.reserve(v.length)
    for (let i = 0; i < v.length; i++) this.data[this.length++] = v[i]!
  }
}

export function createVertexStream(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  attribs: readonly StreamAttrib[],
): VertexStream {
  const buf = gl.createBuffer()
  if (!buf) throw new Error('createBuffer failed')
  const locs = attribs.map((a) => gl.getAttribLocation(prog, a.name))
  const stride = attribs.reduce((s, a) => s + a.size, 0)
  const strideBytes = stride * 4
  let capacityFloats = 0

  return {
    stride,
    draw(data, floats, mode): void {
      if (floats <= 0) return
      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      if (floats > capacityFloats) {
        capacityFloats = Math.ceil(floats * 1.5)
        gl.bufferData(gl.ARRAY_BUFFER, capacityFloats * 4, gl.DYNAMIC_DRAW)
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, floats))
      let offset = 0
      attribs.forEach((a, i) => {
        const loc = locs[i]!
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc)
          gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, strideBytes, offset)
        }
        offset += a.size * 4
      })
      gl.drawArrays(mode, 0, floats / stride)
      for (const loc of locs) if (loc >= 0) gl.disableVertexAttribArray(loc)
    },
    dispose(): void {
      gl.deleteBuffer(buf)
    },
  }
}

/**
 * Push one quad (two triangles, 6 vertices) whose four corners are given as
 * clip positions with per-corner (u, v) and a shared color/alpha tail.
 * Corner order: a− (u0, −1), a+ (u0, +1), b− (u1, −1), b+ (u1, +1).
 */
export function pushQuad(
  sink: FloatSink,
  aN: { x: number; y: number },
  aP: { x: number; y: number },
  bN: { x: number; y: number },
  bP: { x: number; y: number },
  u0: number,
  u1: number,
  tail: readonly number[],
): void {
  sink.reserve(6 * (4 + tail.length))
  const put = (p: { x: number; y: number }, u: number, v: number): void => {
    sink.push(p.x, p.y, u, v, ...tail)
  }
  put(aN, u0, -1)
  put(aP, u0, 1)
  put(bN, u1, -1)
  put(aP, u0, 1)
  put(bP, u1, 1)
  put(bN, u1, -1)
}
