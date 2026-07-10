/**
 * app.ts — the visualizer application: picker-driven sessions over one
 * persistent WebGL renderer.
 *
 * Entries:
 *   1. 'Synthetic preview'        — the untouched wave-1 demo loop
 *   2. 'Ode to Joy — engine demo' — built INLINE here with the core
 *      showBuilder (score → timeline → cues → compile), ~40 cues across
 *      every medium; built at startup, diagnostics panel on error
 *   3. 'Ode to Joy (quiet 85 dB)' — quiet-variant build with a noise budget;
 *      an intentionally-loud simultaneous mine salvo proves the solver's
 *      SPL substitution end-to-end in the browser
 *   4. 'Load WAV…'                — decode → analyzePcm →
 *      generateShowFromAnalysis → the same pipeline
 *
 * Wiring per compiled session: Transport(compiled) + SimEngine.attach +
 * AudioClock.drive (host clock) + ScoreSynth (score shows) or WavPlayer
 * (WAV shows) + BeamAudio (shows with beam cues — the "sit here" audition,
 * seat picked in the top bar). One rAF loop renders:
 * renderer.render(engine.snapshot(), t), beamAudio.update(snap.beams),
 * timeline.draw(t), hud.update(snapshot). The renderer gets the session's
 * site (setSite) for the crowd/audio-beam floor-band layers; the HUD gets
 * the crowd-grid centroids for the carrier-exposure meter. Selecting another
 * entry tears the previous session down (engine/transport/synth/beam-audio
 * disposed, canvases cleared); the renderer persists.
 */

import {
  SimEngine,
  Transport,
  buildTimelineFromScore,
  crowdGridFor,
  getScore,
  lakesidePark,
  musicRefs,
  showBuilder,
  starterCatalog,
} from '@theodoor/core'
import type { BuildResult, CompiledShow, CrowdGrid, Score } from '@theodoor/core'
import { PROGRAMS } from '@theodoor/programs'
import { BeamAudio } from './audio/beamAudio.js'
import { ScoreSynth } from './audio/synth.js'
import { WavPlayer, loadWavShow } from './audio/wavSource.js'
import { AudioClock } from './clock/audioClock.js'
import { DEMO_LOOP_SEC, SYNTHETIC_ASSETS, makeSyntheticSnapshot } from './demo/syntheticShow.js'
import { createGlRenderer } from './render/glRenderer.js'
import { h } from './ui/dom.js'
import { createHud } from './ui/hud.js'
import { createPicker } from './ui/picker.js'
import { createSeatControl, seatCellPos } from './ui/seat.js'
import { Timeline } from './ui/timeline.js'
import { createTransportBar } from './ui/transportBar.js'

const ODE_SEED = 0x0de70301

// ---------------------------------------------------------------------------
// Inline flagship demo: Ode to Joy over the lakeside-park site
// ---------------------------------------------------------------------------

/**
 * Build the Ode to Joy engine demo (or its quiet 85 dB variant): RWB volleys
 * on phrase ends, a drone ring → star → 'JOY' text sequence, a lissajous
 * laser, panel wash + ticker, and a mini finale barrage into the climax.
 */
export function buildOdeToJoyShow(quiet: boolean): BuildResult {
  const score = getScore('odeToJoy')
  if (!score) throw new Error("built-in score 'odeToJoy' is missing from the registry")
  const tl = buildTimelineFromScore(score)
  const b = showBuilder({
    id: quiet ? 'ode-to-joy-quiet' : 'ode-to-joy',
    title: quiet ? 'Ode to Joy (quiet 85 dB)' : 'Ode to Joy — engine demo',
    seed: ODE_SEED,
    site: lakesidePark(),
    catalog: starterCatalog(),
    variant: quiet ? 'quiet' : 'standard',
  })
    .music(tl)
    .preRoll(10)
  if (quiet) b.noiseBudget(85)
  const m = musicRefs(tl)

  // Volleys landing on each phrase end (4 × 3 racks = 12 cues). The quiet
  // variant authors low-report entries (the quiet-variant validator rejects
  // anything above 100 dB at the reference distance).
  const volleyEffects = quiet
    ? ['crossette-75-silver', 'comet-50-red', 'mine-50-silver']
    : ['peony-75-red', 'peony-100-white', 'peony-75-blue']
  for (const land of m.everyPhraseEnd({ from: 0, to: 3 })) {
    b.pyro.volley({
      effects: volleyEffects,
      positions: ['rack-2', 'rack-4', 'rack-6'],
      land,
      staggerBeats: 0.5,
    })
  }

  // Gold/red comet accents on section downbeats (4 cues).
  const cometBars = [5, 13, 21, 27] as const
  cometBars.forEach((bar, i) => {
    b.pyro.fire({
      effect: i % 2 === 0 ? 'comet-30-gold' : 'comet-50-red',
      position: i % 2 === 0 ? 'rack-3' : 'rack-5',
      land: m.barBeat(bar, 1),
    })
  })

  // Drone sequence: ring → star → text 'JOY' (3 cues, one pad chain).
  // Scales stay ≤ 30 m so the formation circle fits the geofence from pad-1
  // (y=40, fence starts at y=10); holds leave morph headroom (DRONE_OVERLAP).
  b.drones.formation({
    effect: 'ring-formation-60',
    position: 'pad-1',
    by: m.barBeat(5, 1),
    holdSec: 4,
    params: { count: 36, scaleM: 30, rgb: [0.35, 0.7, 1] },
  })
  b.drones.formation({
    effect: 'star-formation-80',
    position: 'pad-1',
    by: m.barBeat(15, 1),
    params: { count: 40, scaleM: 30, rgb: [1, 0.85, 0.3] },
  })
  b.drones.formation({
    effect: 'text-formation-150',
    position: 'pad-1',
    by: m.barBeat(25, 1),
    holdSec: 10,
    params: { text: 'JOY', count: 60, scaleM: 3, rgb: [1, 0.45, 0.65] },
  })

  // Lasers: lissajous through the bell section, fan into the build (2 cues).
  b.lasers.pattern({
    effect: 'laser-lissajous-rgb',
    position: 'laser-west',
    from: m.barBeat(9, 1),
    durBeats: 32,
  })
  b.lasers.pattern({
    effect: 'laser-fan-rgb',
    position: 'laser-east',
    from: m.barBeat(25, 1),
    durBeats: 16,
  })

  // Panels: gradient wash from the top, ticker at the forte (2 cues).
  b.panels.pattern({
    effect: 'panel-gradient-wipe',
    position: 'panel-west',
    from: m.time(0),
    rgb: [0.15, 0.25, 0.9],
    rgb2: [1, 0.85, 0.3],
  })
  b.panels.ticker('ODE TO JOY', {
    position: 'panel-east',
    from: m.barBeat(17, 1),
    speedPxPerBeat: 8,
    rgb: [1, 0.9, 0.5],
  })

  if (!quiet) {
    // Mini finale barrage ramping into the single climax (~15 cues; the
    // largest effect lands exactly ON the climax annotation).
    b.pyro.barrage({
      window: { peak: m.climax(0), windowSec: 12 },
      effectPool: [
        'peony-100-white',
        'chrysanthemum-100-gold',
        'peony-150-gold',
        'brocade-200-gold',
      ],
      positions: ['rack-1', 'rack-3', 'rack-5', 'rack-7'],
      startRateHz: 0.5,
      endRateHz: 2.5,
      idPrefix: 'finale',
    })
  } else {
    // Quiet finale: a comet curtain peaking just before the climax, plus a
    // 7-rack SIMULTANEOUS mine salvo ON the climax. The salvo's summed SPL
    // (~86 dB) intentionally exceeds the 85 dB budget so the solver's
    // substitution machinery visibly kicks in (SPL_BUDGET warnings; some
    // mines land as quieter entries).
    b.pyro.barrage({
      window: { peak: m.barBeat(27, 1), windowSec: 10 },
      effectPool: ['comet-30-gold', 'comet-50-red', 'crossette-75-silver'],
      positions: ['rack-1', 'rack-3', 'rack-5', 'rack-7'],
      startRateHz: 0.6,
      endRateHz: 2,
      idPrefix: 'finale',
    })
    for (let i = 0; i < 7; i++) {
      b.pyro.fire({
        id: `salvo-${i}`,
        effect: 'mine-75-red',
        position: `rack-${i + 1}`,
        land: m.climax(0),
      })
    }
  }

  return b.build()
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

interface Session {
  frame(nowMs: number, fps: number): void
  dispose(): void
}

const ENTRIES = [
  { id: 'synthetic', label: 'Synthetic preview' },
  { id: 'ode', label: 'Ode to Joy — engine demo' },
  { id: 'ode-quiet', label: 'Ode to Joy (quiet 85 dB)' },
  { id: 'july4', label: 'July 4th — flagship' },
  { id: 'july4-quiet', label: 'July 4th (quiet 85 dB)' },
  { id: 'nye', label: "New Year's Eve — flagship" },
  { id: 'nye-quiet', label: "New Year's Eve (quiet 85 dB)" },
  { id: 'hallows', label: 'The Unquiet Hour — Halloween' },
  { id: 'hallows-quiet', label: 'The Unquiet Hour (quiet 85 dB)' },
  { id: 'cosmos', label: 'Night of the Spheres — cosmic' },
  { id: 'cosmos-quiet', label: 'Night of the Spheres (quiet 85 dB)' },
  { id: 'aurora', label: 'Midsummer Aurora — crowd-first' },
  { id: 'aurora-quiet', label: 'Midsummer Aurora (quiet 85 dB)' },
  { id: 'cardstunt', label: 'The Living Field — crowd demo' },
  { id: 'cardstunt-quiet', label: 'The Living Field (quiet 85 dB)' },
] as const

type Prebuilt = { ok: true; result: BuildResult } | { ok: false; error: Error }

export function startApp(appRoot: HTMLElement, stage: HTMLCanvasElement): void {
  // ---- fatal fallback ---------------------------------------------------------
  const fatal = (message: string): void => {
    stage.setAttribute('hidden', '')
    appRoot.append(
      h(
        'div',
        { class: 'diag-panel' },
        h('h2', {}, 'WebGL required'),
        h('p', {}, message),
        h(
          'p',
          { class: 'diag-hint' },
          'This visualizer renders exclusively through WebGL — there is no 2D fallback.',
        ),
      ),
    )
  }

  const renderer = createGlRenderer(stage, { onFatal: fatal })
  if (!renderer) {
    fatal(
      'Your browser could not create a WebGL context. Enable hardware ' +
        'acceleration or switch to a WebGL-capable browser, then reload.',
    )
    return
  }

  // ---- UI shell -----------------------------------------------------------------
  const clock = new AudioClock()
  const hud = createHud()

  // Audition seat: app-level so the choice survives session switches. The
  // active session registers its BeamAudio + grid; selecting a seat retargets
  // both immediately.
  let activeBeamAudio: BeamAudio | null = null
  let activeGrid: CrowdGrid | undefined
  const applySeat = (): void => {
    activeBeamAudio?.setSeat(seatCellPos(activeGrid, seatCtl.current()) ?? null)
  }
  const seatCtl = createSeatControl((preset) => {
    if (activeBeamAudio) hud.setSeat(preset.label)
    applySeat()
  })

  const bar = createTransportBar({
    onPlayPause: () => togglePlay(),
    onSkip: (d) => {
      const t = clock.transport
      if (t) clock.seek(t.timeSec + d)
    },
    onRate: (r) => clock.setRate(r),
  })

  const tlCanvas = h('canvas', { class: 'timeline-canvas' })
  const tlStrip = h('div', { class: 'timeline-strip', hidden: true }, tlCanvas)

  const diag = h('div', { class: 'diag-panel', hidden: true })
  const showDiag = (title: string, lines: readonly string[]): void => {
    diag.replaceChildren(
      h('h2', {}, title),
      ...lines.map((l) => h('p', { class: 'diag-line' }, l)),
    )
    diag.removeAttribute('hidden')
  }
  const hideDiag = (): void => diag.setAttribute('hidden', '')

  const picker = createPicker(ENTRIES, {
    onSelect: (id) => select(id),
    onWav: (file, quiet) => void loadWav(file, quiet),
  })

  const topBar = h('div', { class: 'top-bar' }, picker.el, seatCtl.el, bar.el)
  appRoot.append(topBar, hud.el, tlStrip, diag)

  // ---- prebuild the inline shows (diagnostics instead of a blank page) ----------
  const prebuilt = new Map<string, Prebuilt>()
  for (const [id, quiet] of [
    ['ode', false],
    ['ode-quiet', true],
  ] as const) {
    try {
      prebuilt.set(id, { ok: true, result: buildOdeToJoyShow(quiet) })
    } catch (e) {
      prebuilt.set(id, { ok: false, error: e instanceof Error ? e : new Error(String(e)) })
    }
  }

  // ---- sessions -------------------------------------------------------------------
  let session: Session | null = null
  const setSession = (next: Session | null): void => {
    session?.dispose()
    session = next
  }

  const togglePlay = (): void => {
    const t = clock.transport
    if (!t) return
    if (t.state === 'playing') clock.pause()
    else void clock.play()
  }

  function startSynthetic(): Session {
    renderer!.setAssets(SYNTHETIC_ASSETS)
    renderer!.setSite(null)
    hud.setBudget(undefined)
    hud.setExposureCells(undefined)
    hud.setSeat(null)
    activeGrid = undefined
    tlStrip.setAttribute('hidden', '')
    bar.setEnabled(false)
    return {
      frame(nowMs, fps): void {
        const t = (nowMs / 1000) % DEMO_LOOP_SEC
        const snap = makeSyntheticSnapshot(t)
        renderer!.render(snap, t)
        hud.update(snap, fps)
        bar.update(t, DEMO_LOOP_SEC, true, 1)
      },
      dispose(): void {},
    }
  }

  function startCompiled(
    compiled: CompiledShow,
    audio: { score?: Score; wav?: AudioBuffer },
  ): Session {
    const site = compiled.show.site
    renderer!.setAssets(site.assets)
    renderer!.setSite(site)
    hud.setBudget(compiled.show.noiseBudget?.maxSplDb)
    tlStrip.removeAttribute('hidden')
    bar.setEnabled(true)

    // Audience layers: crowd grid for the seat resolver, exposure meter +
    // seat audition only for shows that actually use the beam arrays.
    const grid = crowdGridFor(site)
    const hasBeams = compiled.cues.some((c) => c.medium === 'beam')
    activeGrid = grid
    hud.setExposureCells(
      hasBeams ? (grid?.cells.map((c) => c.centroid) ?? site.refListenerPos) : undefined,
    )
    hud.setSeat(hasBeams ? seatCtl.current().label : null)

    const warnings = compiled.diagnostics.filter((d) => d.severity === 'warning')
    if (warnings.length > 0) {
      // Substitutions, drops, near-limit spacing, … — visible in devtools.
      console.warn(
        `[theodoor] show '${compiled.show.meta.id}' compiled with ${warnings.length} warning(s):`,
        warnings.map((w) => `[${w.code}] ${w.message}`),
      )
    }

    const transport = new Transport(compiled)
    const engine = new SimEngine(compiled)
    const cleanups: (() => void)[] = []
    cleanups.push(engine.attach(transport))
    cleanups.push(clock.drive(transport))

    let beamAudio: BeamAudio | null = null
    if (clock.ctx && hasBeams) {
      beamAudio = new BeamAudio(clock.ctx, compiled.cues)
      activeBeamAudio = beamAudio
      applySeat()
      cleanups.push(() => {
        beamAudio!.dispose()
        if (activeBeamAudio === beamAudio) activeBeamAudio = null
      })
    }

    if (clock.ctx) {
      if (audio.score) {
        const synth = new ScoreSynth(clock.ctx, audio.score, () => clock.anchor())
        synth.start()
        cleanups.push(clock.onFlush(() => synth.flush()))
        cleanups.push(() => synth.dispose())
      } else if (audio.wav) {
        const player = new WavPlayer(clock.ctx, audio.wav)
        const sync = (): void => player.sync(clock.anchor())
        cleanups.push(clock.onFlush(sync))
        cleanups.push(transport.on((e) => (e.type === 'transport' ? sync() : undefined)))
        cleanups.push(() => player.dispose())
      }
    }

    const timeline = new Timeline(tlCanvas, compiled, { onSeek: (t) => clock.seek(t) })
    cleanups.push(() => timeline.dispose())

    return {
      frame(_nowMs, fps): void {
        const t = transport.timeSec
        if (transport.state === 'playing' && t >= transport.durationSec - 1e-6) {
          clock.pause() // end reached → auto-pause at durationSec
        }
        const snap = engine.snapshot()
        renderer!.render(snap, t)
        beamAudio?.update(snap.beams, transport.state === 'playing')
        timeline.draw(t)
        hud.update(snap, fps)
        bar.update(t, transport.durationSec, transport.state === 'playing', transport.rate)
      },
      dispose(): void {
        clock.pause() // flush sounding nodes before teardown
        for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
        const g = tlCanvas.getContext('2d')
        g?.clearRect(0, 0, tlCanvas.width, tlCanvas.height)
      },
    }
  }

  function select(id: string): void {
    hideDiag()
    picker.setActive(id)
    if (id === 'synthetic') {
      setSession(startSynthetic())
      return
    }
    // Flagship programs build lazily on first selection (each runs the full
    // solver + SPL pass — a second or two).
    if (!prebuilt.has(id) && PROGRAMS[id] !== undefined) {
      try {
        prebuilt.set(id, { ok: true, result: PROGRAMS[id]!() })
      } catch (e) {
        prebuilt.set(id, { ok: false, error: e instanceof Error ? e : new Error(String(e)) })
      }
    }
    const p = prebuilt.get(id)
    if (!p) return
    if (!p.ok) {
      setSession(null)
      showDiag(
        `Show '${id}' failed to build`,
        p.error.message.split('\n').filter((l) => l.length > 0),
      )
      return
    }
    const compiled = p.result.compiled
    const score = compiled.show.music.score
    setSession(startCompiled(compiled, score ? { score } : {}))
  }

  async function loadWav(file: File, quiet: boolean): Promise<void> {
    if (!clock.ctx) {
      showDiag('Web Audio unavailable', [
        'WAV shows need an AudioContext for decoding and playback, ' +
          'which this browser refused to create.',
      ])
      return
    }
    picker.setStatus(`Analyzing ${file.name}…`)
    try {
      const wav = await loadWavShow(file, clock.ctx, { quiet })
      hideDiag()
      setSession(startCompiled(wav.compiled, { wav: wav.buffer }))
    } catch (e) {
      setSession(null)
      showDiag('WAV load failed', [e instanceof Error ? e.message : String(e)])
    } finally {
      picker.setStatus(null)
    }
  }

  // ---- global listeners + main loop ---------------------------------------------
  const resize = (): void => {
    renderer!.resize(
      stage.clientWidth || window.innerWidth,
      stage.clientHeight || window.innerHeight,
      window.devicePixelRatio || 1,
    )
  }
  window.addEventListener('resize', resize)
  resize()

  window.addEventListener('keydown', (e) => {
    const tgt = e.target
    if (
      e.code === 'Space' &&
      !(tgt instanceof HTMLInputElement) &&
      !(tgt instanceof HTMLSelectElement) &&
      !(tgt instanceof HTMLButtonElement)
    ) {
      e.preventDefault()
      togglePlay()
    }
  })

  let frames = 0
  let fpsWindowStartMs = performance.now()
  let fps = 0
  const loop = (nowMs: number): void => {
    frames++
    const elapsed = nowMs - fpsWindowStartMs
    if (elapsed >= 500) {
      fps = (frames * 1000) / elapsed
      frames = 0
      fpsWindowStartMs = nowMs
    }
    session?.frame(nowMs, fps)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  // Land on the engine demo (falls back to its diagnostics panel on error).
  select('ode')
}
