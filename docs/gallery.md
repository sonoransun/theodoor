# Theodoor gallery

Every image on this page (and in the README) is **generated deterministically by the
engine itself** — no hand-drawn art. `npm run gallery` rebuilds the CLI, loads the
flagship programs, samples the 120 Hz simulator, and rewrites `docs/gallery/*.svg`
byte-identically; `npm run gallery:check` fails if the committed assets have drifted
from the code. Animated files are plain SMIL SVG, so they loop right here on GitHub.

## Scenes

### The Unquiet Hour at the summit — one sim snapshot

![One simulator snapshot at the hallows summit: barrage stars mid-burst over the ground line, the drone bloom, and the crowd band lit below](gallery/scene-hallows-summit.svg)

A single `SimSnapshot` at the show's strength-1.0 climax: the brightest 450 barrage
stars, the drone fleet, and the crowd canvas — same seed, same image, every run.

### Night of the Spheres — act 2 orbit loop

![Animated loop: the drone orrery holds formation while the comet formation crosses, a thunder-tagged shell bursts, and crowd cells wave below](gallery/hero-cosmos-orbit.svg)

A 16-second window sampled at 4 fps: the 140-drone orrery, pad-2's comet crossing
with its chasing beam tag, a thunder-tagged waltz shell (closed-form burst rosette),
and the crowd band waving in 3/4.

### Vltava — the broad river

![Animated loop of the river program's climax: gold brocades with beam-delivered thunder, nine water columns cresting on both banks, white searchlight pillars, a drone bloom, and the crowd flooding gold](gallery/hero-vltava-broad-river.svg)

Sixteen seconds around the strength-1 climax of *Vltava — The River*: the rapids
barrage resolves into three gold brocades (each with beam-delivered thunder), nine
45 m shooters crest on both banks, white pillars stand at the ends of the line, the
fleet blooms gold, and the crowd floods — all landing on one beat.

### Vltava — moonlight

![One simulator snapshot at the river program's moonlight accent: eight searchlight beams converging into a spire, a crescent formation, a single 45 m water column at its crest, and a dim blue lawn](gallery/scene-vltava-moonlight.svg)

Half a second after the 'moonlight' accent: the two banks' heads have slewed into a
spire that hangs as the moon, the crescent holds over pad-2, and the first nymph
shooter is at its 45 m crest — commanded 3.18 s early so the water, not the light,
is what lands on the chime.

## The keystone

Everything in Theodoor pivots on one identity: `fireSec = targetSec − anticipationSec`.
You author when something should **land**; the solver works backward to when it must
**fire**.

```mermaid
flowchart LR
  cue[cue lands on anchor] --> k{medium}
  k -->|pyro| r["shell rise time (catalog)"]
  k -->|drone| m["planMorph kinematics x 1.1"]
  k -->|crowd| p["mast p95 command latency"]
  k -->|beam| tof["slant distance / 343 m per s"]
  k -->|fabrication| fl["0.1 s relay latency"]
  k -->|laser / panel| z["0 s"]
  r --> f["fireSec = targetSec - anticipationSec"]
  m --> f
  p --> f
  tof --> f
  fl --> f
  z --> f
```

### One landing, six kinds of physics

![Chart of seven cues firing early by medium-specific anticipation: drone morph, shell rise, water rise, time-of-flight, broadcast latency, and searchlight slew](gallery/keystone-vltava-broad-river.svg)

The river program's climax from real solver output: the gold bloom's 14.5 s morph,
the brocades' 4.2 s rise, the shooters' 3.18 s of valve latency plus water rise, the
thunder tags' 0.66 s of sound flight, the wristband flood's 0.08 s broadcast lead —
one `targetSec`, five different `fireSec`; the pillars need no slew (their heads are
already vertical), and the castle spire that follows shows the slew lead landing on
the Vyšehrad chorale.

### One beat, four kinds of physics

![Chart of cues firing early by medium-specific anticipation so all land on the same beat](gallery/keystone-cosmos-daybreak.svg)

The cosmos "physics repaired" excerpt from real solver output: the lone lag comet
whose report arrives late, then the daybreak cluster — peonies (2.8 s rise), their
beam-delivered thunder (0.66 s of sound flight), a wristband haptic and flood
(0.08 s broadcast lead) — all sharing one `targetSec` with four different `fireSec`.

### The crowd ramp, made visible

![Animated crowd grid raining in over 1.2 seconds and completing on the beat marker](gallery/anim-crowd-ramp-cosmos.svg)

The phone starfield's per-cell arrival delays come from the same seeded latency
model the simulator ramps with: commanded one p95 early, ~95% of the field lands
exactly on the beat tick.

## The solver

```mermaid
flowchart TD
  anchors[cue anchors] --> p1["PHASE 1 - per cue"]
  p1 --> tgt["targetSec = resolve(anchor)"]
  p1 --> ant["anticipationSec per medium"]
  tgt --> fire["fireSec = targetSec - anticipationSec"]
  ant --> fire
  fire --> p2["PHASE 2 - deterministic repair passes"]
  p2 --> a["a. quantize landings (never fires)"]
  a --> b["b. negative fire: shift landing by whole beats"]
  b --> c["c. rack pin capacity"]
  c --> d["d. drone pad overlap"]
  d --> d2["d2. crowd mast bandwidth"]
  d2 --> d3["d3. beam slew"]
  d3 --> e["e. SPL budget: substitute quieter effects"]
  e --> out["CompiledShow + diagnostics"]
```

## Water & light

The two newest media are lighting-desk fixtures with real kinematics in their timing.

### The column crests on the beat

![Water column height against time: valve latency, ballistic rise, crest on the beat, hold, fall](gallery/physics-fountain-rise.svg)

The 45 m shooter charted from the fountain sim's own closed form: the valve opens at
`fireSec`, water appears after the bank's 0.15 s latency, the column rises on
`h = v₀τ − gτ²/2` and crests exactly on the beat — an anticipation of
`0.15 + √(2·45/9.81) = 3.18 s`, the shell's rise time in water. It holds through the
cue's window and falls dry at the end of it.

### Slew as anticipation

![Head tilt against time for two consecutive searchlight figures: slew from park to beat one, then from the previous aim to beat two](gallery/physics-searchlight-slew.svg)

A searchlight bank's heads are chained like a drone pad's formations: the first figure
slews from park (straight up) and arrives on beat one; the second departs the first
figure's *end aim*, not park, and arrives on beat two. Each lead is the largest head's
angular distance over the bank's slew rate, with the same 1.1× margin the sim chain
uses — a squeezed slew surfaces as a `sim/light-slew-short` warning, never a silent
correction.

## Site & geometry

### The flagship venue

![Top-down venue map with racks, pads, towers, masts, beam arrays, throw arcs, and the 38-by-9 crowd grid](gallery/site-lakeside-park.svg)

`lakesidePark()`: the 8-rack arc, two drone pads, laser towers, LED panels, two
crowd masts, six directional-audio arrays with their horizon-bounded throw arcs
(25 m north masts ≈ 267 m, 16 m in-lawn delay towers ≈ 165 m, 8 m corner masts
≈ 73 m), two nine-nozzle fountain banks on the water behind the racks, and two
four-head searchlight banks at the ends of the line. Every flagship compiles against
this plan.

### Footprint geometry

![Side-view cone and top-view ellipse with the real near/far footprint distances and semi-axes](gallery/beam-footprint-geometry.svg)

A beam's audible region is its cone's intersection with the ear-height plane — an
ellipse spanning `h/tan(ε+α) … h/tan(ε−α)` downrange. Aims whose depression comes
within 2° of the half-angle have no bounded footprint and fail validation.

### Beam flyover

![Animated top-down loop of the audible footprint sweeping across the lawn with an expanding wavefront ring](gallery/anim-beam-flyover-hallows.svg)

A hallows act-1 "invisible flyover": the footprint sweeps its cell path while the
wavefront ring expands from the array head — sound moving through a crowd with
nothing in the sky.

## Programs

### The Unquiet Hour — full-show timeline

![Full show timeline with per-lane cues and hatched anticipation lead-ins](gallery/timeline-hallows.svg)

All nine lanes over ~4.3 minutes (the fountain and searchlight lanes stay dark — the
haunting has no use for water or light until dawn). The hatching before each cue body is its
anticipation — the twelve everywhere-at-once bell strikes carry visibly long
time-of-flight leads on the Beams lane.

### Vltava — all nine lanes

![Full nine-lane show timeline of the river program with act bands and hatched anticipation lead-ins](gallery/timeline-vltava.svg)

Every lane carries cues: the fountain lane's long hatched lead-ins are valve latency
plus ballistic rise; the searchlight lane's short ones are solved head slews. Act
bands come from the program notes.

### Fleet kinematics

![Animated morph loop from the launch grid through a spiral galaxy into the orrery formation](gallery/anim-drone-morph-cosmos.svg)

The cosmos liftoff chain: launch grid → spiral galaxy → orrery. Drone anticipation
is never a constant — it is solved per transition from trapezoidal-profile
kinematics over exactly these point pairings.

### Formation atlas

![Contact sheet of all eighteen drone formation kinds as labeled point clouds](gallery/formations.svg)

## Acoustics & budgets

### Carrier exposure — always enforced

![Heatmap of per-cell peak carrier level, all under the 110 dB ceiling](gallery/exposure-hallows.svg)

`compile()` runs the exposure report whenever a show uses beams — an instantaneous
110 dB ceiling plus a rolling dwell rule at every audience cell. Never opt-in.

### The quiet budget

![Two SPL traces at the center listener with the dashed 85 dB budget line; the standard show's over-budget area is shaded](gallery/spl-nye-vs-quiet.svg)

New Year's Eve, standard vs quiet at the center listener: the quiet variant's
summed SPL never crosses the 85 dB budget the validator enforces.

## Safety

The only hardware-facing artifacts are file exports, and emitting them walks a
strict state machine with five interlocks (site freshness, wind, operator ack,
carrier exposure, broadcast bandwidth) and a hash-chained audit log:

```mermaid
stateDiagram-v2
  [*] --> DISARMED
  DISARMED --> ARMED: arm (5 interlocks pass)
  ARMED --> LIVE: goLive
  LIVE --> ARMED: standDown
  ARMED --> DISARMED: disarm
  DISARMED --> ESTOPPED: eStop
  ARMED --> ESTOPPED: eStop
  LIVE --> ESTOPPED: eStop
  ESTOPPED --> DISARMED: reset (latched, explicit only)
```

## Fabrication

![Dimensioned top-view drawing of an eight-plus-eight tube mortar rack with pitch and overall dimensions](gallery/fab-rack-drawing.svg)

The `fab` module's staging-hardware output — the same deterministic SVG the
`theodoor fab` command writes, restyled for the gallery page.
