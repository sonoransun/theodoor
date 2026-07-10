/**
 * Audio-beam pipeline: translucent frustums for the steerable directional
 * arrays, visually DISTINCT from the laser layer — desaturated cyan, low
 * gain, soft fills instead of tight bright strokes.
 *
 * PROJECTION (mirrors glBeams' sky-quad convention, but onto the floor band
 * of render/crowdBand.ts): the apex projects through the camera at
 * (apex.x, apex.z); the ground footprint has no world z, so it renders in
 * the audience floor band — clipX from camera.project(worldX, 0).x, clipY
 * from the band mapping of world y. Each BeamState draws
 *   1. a cone: triangle from the apex down to the footprint's x-extent at
 *      the band height of the footprint center (dimmer at the apex);
 *   2. the footprint ellipse outline, sampled in world ground coordinates
 *      and mapped point-by-point into the band.
 *
 * TIME-OF-FLIGHT IS VISIBLE: while a beam is in flight (landed === false)
 * everything renders at BEAM_FLIGHT_ALPHA (~40%); when `landed` flips the
 * cone snaps to full alpha and the outline pulses briefly
 * (BEAM_LANDING_PULSE_SEC). Landing instants are observed from the flip —
 * seeking into an already-landed beam does not pulse.
 *
 * Premultiplied additive output (renderer sets blendFunc(ONE, ONE)).
 */
import type { BeamState, CrowdGrid } from '@theodoor/core'
import type { Camera } from './camera.js'
import {
  bandScreenY,
  beamConeAlpha,
  footprintPoints,
  footprintXExtentM,
  landingPulse,
  screenYToClipY,
} from './crowdBand.js'
import { compileProgram } from './types.js'

/** Desaturated cyan — nothing like the saturated laser palette. */
export const AUDIO_BEAM_RGB: readonly [number, number, number] = [0.3, 0.75, 0.8]
/** Cone fill gain (low — these read as translucent air, not light). */
export const AUDIO_BEAM_CONE_GAIN = 0.09
/** Footprint outline gain. */
export const AUDIO_BEAM_OUTLINE_GAIN = 0.35
/** Outline gain boost factor at full landing pulse. */
export const AUDIO_BEAM_PULSE_BOOST = 2
/** Ellipse boundary sample count. */
export const FOOTPRINT_SEGMENTS = 48
/** Apex vertices render at this fraction of the foot vertices' alpha. */
export const CONE_APEX_FADE = 0.5

const VS = `
attribute vec2 aClip;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  gl_Position = vec4(aClip, 0.0, 1.0);
  vColor = aColor;
}
`

const FS = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`

// Per vertex: [clipX, clipY, r, g, b] (premultiplied color).
const VERT_FLOATS = 5

export interface AudioBeamPipeline {
  draw(
    beams: readonly BeamState[],
    camera: Camera,
    grid: CrowdGrid | undefined,
    tSec: number,
  ): void
  dispose(): void
}

export function createAudioBeamPipeline(gl: WebGLRenderingContext): AudioBeamPipeline {
  const prog = compileProgram(gl, VS, FS)
  const buf = gl.createBuffer()
  if (!buf) throw new Error('createBuffer failed')
  const aClip = gl.getAttribLocation(prog, 'aClip')
  const aColor = gl.getAttribLocation(prog, 'aColor')
  let capacityFloats = 0

  // Landing bookkeeping: show time each cue's `landed` flip was observed.
  // -Infinity = first seen already landed (seek into the middle — no pulse).
  const landedAt = new Map<number, number>()

  return {
    draw(beams, camera, grid, tSec): void {
      if (beams.length === 0) {
        landedAt.clear()
        return
      }

      const active = new Set<number>()
      for (const b of beams) {
        active.add(b.cueIdx)
        const prev = landedAt.get(b.cueIdx)
        if (b.landed) {
          if (prev === undefined) landedAt.set(b.cueIdx, -Infinity) // already landed
          else if (Number.isNaN(prev)) landedAt.set(b.cueIdx, tSec) // observed flip
        } else {
          landedAt.set(b.cueIdx, Number.NaN) // in flight (NaN = not yet landed)
        }
      }
      for (const k of landedAt.keys()) if (!active.has(k)) landedAt.delete(k)

      if (!grid) return
      const gY = camera.worldToScreen(0, 0).y
      const tri: number[] = []
      const lines: number[] = []
      const [r, g, bl] = AUDIO_BEAM_RGB

      for (const b of beams) {
        const at = landedAt.get(b.cueIdx)
        const sinceLanded = at === undefined || Number.isNaN(at) ? Number.NaN : tSec - at
        const alpha = beamConeAlpha(b.landed)
        const pulse = landingPulse(sinceLanded)

        const apex = camera.project(b.apex.x, b.apex.z)
        const fp = b.footprint
        const halfW = footprintXExtentM(fp)
        const footClipY = screenYToClipY(bandScreenY(grid, fp.cy, gY), camera.heightPx)
        const footL = camera.project(fp.cx - halfW, 0).x
        const footR = camera.project(fp.cx + halfW, 0).x

        // Cone triangle: apex (dimmer) → the footprint span in the band.
        if (halfW > 0) {
          const ca = AUDIO_BEAM_CONE_GAIN * alpha
          const apexC = ca * CONE_APEX_FADE
          tri.push(
            apex.x, apex.y, r * apexC, g * apexC, bl * apexC,
            footL, footClipY, r * ca, g * ca, bl * ca,
            footR, footClipY, r * ca, g * ca, bl * ca,
          )
        }

        // Footprint ellipse outline in the band (+ landing pulse boost).
        const oc = AUDIO_BEAM_OUTLINE_GAIN * alpha * (1 + AUDIO_BEAM_PULSE_BOOST * pulse)
        const pts = footprintPoints(fp, FOOTPRINT_SEGMENTS)
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i]!
          const p1 = pts[(i + 1) % pts.length]!
          const y0 = screenYToClipY(bandScreenY(grid, p0.y, gY), camera.heightPx)
          const y1 = screenYToClipY(bandScreenY(grid, p1.y, gY), camera.heightPx)
          lines.push(
            camera.project(p0.x, 0).x, y0, r * oc, g * oc, bl * oc,
            camera.project(p1.x, 0).x, y1, r * oc, g * oc, bl * oc,
          )
        }
      }

      const total = tri.length + lines.length
      if (total === 0) return
      const data = new Float32Array(total)
      data.set(tri, 0)
      data.set(lines, tri.length)

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
      gl.enableVertexAttribArray(aColor)
      gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, strideBytes, 8)

      if (tri.length > 0) gl.drawArrays(gl.TRIANGLES, 0, tri.length / VERT_FLOATS)
      if (lines.length > 0) {
        gl.drawArrays(gl.LINES, tri.length / VERT_FLOATS, lines.length / VERT_FLOATS)
      }

      gl.disableVertexAttribArray(aClip)
      gl.disableVertexAttribArray(aColor)
    },
    dispose(): void {
      landedAt.clear()
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
    },
  }
}
