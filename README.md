# Theodoor — Theatrical Pyrotechnics and Synchronized Visual Displays

Theodoor is a full suite for the conception, fabrication planning, and orchestration of
theatrical displays: LED panels, drone swarms, pyrotechnics, staged fabrications
(waterfalls, lancework, wheels), laser primitives, audience augmentation devices
(LED wristbands and phones as a "crowd canvas"), and steerable directional-audio
beams, combined into a single musically-synchronized show for maximum aesthetic
effect. You author a show against a musical timeline — a built-in score or an
analyzed WAV — and Theodoor solves the firing schedule, validates it against the
site, a noise budget, and a carrier-exposure budget, simulates every star, drone,
crowd cell, and beam deterministically, and emits the paperwork and control files
a crew would use.

> ## Safety & scope
>
> - **This is show-design and simulation software.** It designs, validates, simulates,
>   and documents displays; it does not operate hardware.
> - **Effects are opaque catalog metadata.** A catalog entry carries performance data
>   only — timing, geometry, colors, noise level. There is no energetic-materials
>   information anywhere in this codebase, and a repo-wide guard test keeps it that way.
> - **Simulation-first.** The only hardware-facing artifacts are file exports
>   (firing-script CSV, ILDA, Art-Net, drone waypoints, crowd-broadcast frames,
>   beam-steering schedules), and emitting them is gated behind an arm / e-stop
>   safety state machine with an explicit operator acknowledgement. Everything
>   else runs entirely in the simulator.
> - **Directional audio carries its own budget.** The beam medium is opaque
>   performance metadata like everything else, and a carrier-exposure ceiling
>   (instantaneous cap plus a rolling dwell rule at every audience cell) is
>   enforced by `compile()` whenever a show uses beams — always on, never opt-in.
> - **"Fabrication" means staging hardware.** The `fab` module produces mortar-rack and
>   panel-frame drawings (SVG) and bills of materials — mounting structure, never
>   devices.
> - **Quiet shows are a first-class feature.** Every flagship program ships a quiet
>   variant for noise-sensitive audiences, enforced by validation, not convention.

## Quickstart

```sh
npm install
npm test        # ~1,200 deterministic tests
npm run build
npm run dev     # visualizer — pick 'Ode to Joy — engine demo' or a flagship program, press play
```

After `npm run build`, the CLI is available:

```sh
node packages/cli/dist/index.js align    --show july4                 # solve + diagnostics
node packages/cli/dist/index.js simulate --show nye --to 60 --json    # headless sim stats
node packages/cli/dist/index.js export   --show july4 --target cue-sheet --out out/
node packages/cli/dist/index.js fab      --target bom
node packages/cli/dist/index.js analyze  --wav yourfile.wav
```

The hardware-facing export targets (`firing-script`, `artnet`, `waypoints`, `ilda`,
`crowd-broadcast`, `beam-steering`) require an explicit acknowledgement — without
`--armed-ack 'ARM CONFIRMED'` the CLI refuses and exits with code 4:

```sh
node packages/cli/dist/index.js export --show july4 --target firing-script --out out/ \
  --armed-ack 'ARM CONFIRMED'
```

## Architecture

| Package | What it is |
| --- | --- |
| [`packages/core`](packages/core) | The engine: music + WAV analysis, effect catalog, site model, safety machine, acoustics, choreography, transport, exporters, fab drawings, the show solver/builder, and the simulator. Pure isomorphic TypeScript, zero runtime dependencies. |
| [`packages/cli`](packages/cli) | Command-line front end: `align`, `simulate`, `export`, `fab`, `analyze` over the flagship programs. |
| [`packages/viz`](packages/viz) | WebGL + WebAudio visualizer (Vite app): renders live sim snapshots and synthesizes the score so you can watch a show land on the beat. |
| [`programs`](programs) | Flagship show programs — `july4`, `nye`, `hallows`, `cosmos`, `aurora`, `cardstunt`, and their quiet variants — plus shared [palettes](programs/src/palettes.ts). |

The keystone of the whole system is one identity, applied everywhere:
**`fireSec = targetSec − anticipationSec`**. You author *when things should be seen*
(a shell break on a downbeat, a drone formation fully formed by the chorus); the solver
works backward to when each cue must fire. Shells are fired early by their rise time so
the break lands on the beat; drone anticipation is not a constant at all but is solved
from fleet kinematics — launch grid, per-pad departure timelines, and trapezoidal-profile
morph transitions between formations. The two newest media are the purest instances of
the identity: a crowd broadcast is commanded one p95 command latency early so the
wristband field completes its ramp **on** the beat, and a directional-audio beam is
fired one acoustic time-of-flight early (`distance / 343 m/s`) so the sound **lands on
the beat at the listener** — for the everywhere-at-once bell strike, one ToF per cell.

### Module map (`packages/core/src`)

- [`contracts.ts`](packages/core/src/contracts.ts) — frozen interchange types every module codes against.
- `math` — seeded deterministic RNG, per-cue seeds, vectors, colors, easing curves.
- `time` — tempo maps (beats ↔ seconds), meters, quantize grids.
- `text` — 5×7 bitmap font used by drone text/digit formations and panel tickers.
- `music` — notation DSL, thirteen built-in scores, `Score → MusicalTimeline`, bar-aligned score concatenation.
- `music/analysis` — WAV pipeline: decode → STFT → spectral-flux onsets + A-weighted energy → tempo estimate → annotated `MusicalTimeline`.
- `catalog` — validated effect registry (the `starter-v1` set) and cue-param validation.
- `site` — `SitePlan` validation rules, the derived audience crowd grid, and the `lakesidePark()` demo venue.
- `safety` — arm / go-live / stand-down / e-stop state machine, interlocks (site freshness, wind, operator ack, carrier exposure, broadcast bandwidth), audit log, gate tokens.
- `acoustics` — SPL propagation, summed listener timelines, quiet-budget reports with substitution hints, beam aim/footprint geometry, and the carrier-exposure report.
- `choreo` — formation generators, morph planning and drone assignment, pyro volleys/chases, crowd/beam cue factories, conflict checks (pins, pads, mast bandwidth, beam slew).
- `transport` — deterministic play/pause/seek transport, event bus, cue scheduler (no wall clock).
- `export` — pure byte/string builders: firing-script CSV, markdown cue sheet, ILDA laser files, Art-Net DMX, drone waypoints, crowd-broadcast frames, beam-steering schedules.
- `fab` — staging-hardware parametrics: mortar-rack and panel-frame drawings (SVG) and BOM rollups.
- `show` — anchors, the two-phase alignment solver, validation, `compile()`, the fluent `showBuilder`, and the analysis-driven show generator.
- `sim` — fixed-timestep 120 Hz engine: shell ascent and closed-form stars, drone fleet flight, laser/panel frames, the crowd canvas (seeded latency ramps), beam steering states, SPL, headless stats.

## Crowd & beam — the audience as instrument

Two media turn the audience itself into part of the display:

- **`crowd`** — LED wristbands and phones addressed as a cell grid derived over the
  audience zone (the "crowd canvas"): color floods, waves, radial pulses, section
  chases, sparkles, card-stunt text, heartbeats, phone-flashlight starfields, and
  wristband haptics. Broadcast latency is the anticipation: the solver commands each
  pattern one p95 command latency early, and the simulator scatters per-device arrival
  through the mast's seeded latency distribution, so the field visibly ramps in and
  completes exactly on the musical moment. Mast bandwidth (concurrent mask updates per
  second) is a solver-enforced constraint like rack pin capacity.
- **`beam`** — steerable directional-audio arrays whose sound is audible essentially
  only inside a cone footprint on the lawn: localized whispers, flyovers that sweep the
  crowd, crossed stereo pairs that image *from a place* (a hovering drone formation can
  hum from where it hangs), pings, zone pulses, and the everywhere-at-once bell strike
  (`cells: 'all'` — one time-of-flight per cell). Acoustic time-of-flight is the
  anticipation, which enables the signature *thunder-with-flash* trick: a shell's
  report, beam-delivered, lands **with** its light instead of half a second behind it.
  Beams flow through the same SPL pipeline as every other medium (in-footprint level,
  −20 dB leakage outside) and carry an always-enforced carrier-exposure budget.

In the visualizer, pick a seat ("sit:" control) to audition the beams spatially —
per-beam delay is the true time-of-flight and crossed pairs image through genuinely
different arrival times — and watch the crowd band beneath the stage light up cell by
cell. A second HUD meter tracks worst-cell carrier exposure against the budget.

## Programs

Twelve flagship programs are built on the [`showBuilder`](packages/core/src/show/builder.ts)
authoring surface:

- **`july4`** — a suite of *The Stars and Stripes Forever* joined bar-aligned to the
  *1812 Overture* finale (`concatScores`), with flag formations, cannon-hit volleys,
  crowd waves through the trio, and a climax barrage.
- **`nye`** — *Auld Lang Syne* with a drone countdown to midnight, crowd pulses
  shadowing every digit, a whispered count-in, and a "2027" crowd marquee.
- **`hallows`** — *The Unquiet Hour*: Danse Macabre, In the Hall of the Mountain King,
  and an original dawn coda. The haunting arrives through sound before anything is
  seen — twelve everywhere-at-once bell strikes, roving whispers, invisible flyovers
  that become bats, a ghost that moans from where it hovers, and a heartbeat that
  infects the crowd cell by cell until every wrist pounds on the beat.
- **`cosmos`** — *Night of the Spheres*: Also sprach Zarathustra, The Blue Danube, and
  Jupiter's hymn. Time-of-flight is the theme: the show lets you hear a shell's report
  lag its flash ("old physics"), then repairs it — every burst's thunder beam-delivered
  to land with its light, while a comet formation crosses the sky trailing its own sound.
- **`aurora`** — *Midsummer Aurora*: Gymnopédie, Clair de Lune, and the Moonlight
  adagio. Quiet-first: the entire first act is painted on the audience alone, the sky
  joins at moonrise, and the show ends in silence — a single cell blinking once where
  the aurora was born. The quiet variant is byte-identical: enforcement-only proof of
  quiet-native design.
- **`cardstunt`** — *The Living Field*: three passes of Ode to Joy as a crowd-canvas
  tech demo — calibration figures, card-stunt images, and a crowd digit countdown
  racing the drone countdown off the same landings array. The program implementers copy.
- **`*-quiet`** — every show ships a quiet variant for noise-sensitive audiences.

What makes a quiet variant quiet is enforcement, not taste. A show with
`variant: 'quiet'` **rejects at validation** any catalog effect louder than 100 dB at
the 15 m reference distance — salutes and large peonies are illegal to author, so quiet
shows lean on low-noise comets, crossettes, and mines plus drones, lasers, and panels.
On top of that ceiling, `.noiseBudget(85)` enforces a summed-SPL budget at the audience
listener positions, with automatic substitution of individually-over-budget cues.

## Music

Both music sources produce the exact same `MusicalTimeline`, so everything downstream —
solver, generators, visualizer — is agnostic about where the beat grid came from:

- **Authored scores.** Thirteen public-domain pieces ship in the notation DSL —
  Ode to Joy, The Stars and Stripes Forever, the 1812 Overture finale, Auld Lang Syne,
  Danse Macabre, In the Hall of the Mountain King, an original dawn coda, the
  Zarathustra sunrise, The Blue Danube, Jupiter's hymn (Thaxted), Gymnopédie No. 1,
  Clair de Lune (9/8, notated on the eighth), and the Moonlight adagio (triplet grid)
  (`getScore(id)` / `SCORES`). Scores carry tempo maps, voices, and annotations (beats,
  downbeats, phrase ends, labelled hits, climaxes) that cues anchor to.
- **WAV analysis.** `analyzeWav` runs the onset/tempo/energy pipeline over your own
  audio and emits the same timeline shape, so `generateShowFromAnalysis` can build a
  show for music that was never notated.

## Determinism & testing

Everything is deterministic: no wall clock and no ambient randomness anywhere in the
engine (a repo guard test enforces it). Randomness is seeded per cue from the show seed,
the transport and simulator compute step times by multiplication rather than
accumulation, and exporters are golden-byte tested — the same show compiles to the same
bytes, every run, on every machine. The suite is ~1,200 vitest tests under
[`packages/core/test`](packages/core/test) (plus CLI, viz, and program suites),
including repo-wide safety-vocabulary and end-to-end determinism guards.

```sh
npm test
```
