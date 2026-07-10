/**
 * site/presets.ts — canned demo sites.
 *
 * `lakesidePark()` is the flagship demo venue: an arc of mortar racks on the
 * lake shore firing north-to-south toward an audience 190 m away, a drone pad
 * behind the line, flanking laser towers and pixel panels. All distances
 * satisfy the separation rule in site/validate.ts for 200 mm shells
 * (0.84 × 200 = 168 m; the audience line sits at 190 m).
 */
import type { PositionedAsset, SitePlan } from '../contracts.js'
import { v2 } from '../math/index.js'

/** Demo site: lakeside park, audience looking north (+y) at the display. */
export function lakesidePark(): SitePlan {
  const assets: PositionedAsset[] = []

  // 8 mortar racks in a shallow arc across the firing line, x ∈ [-120, 120],
  // y ≈ 0 (edges) bowing to 6 m at center stage.
  for (let i = 0; i < 8; i++) {
    const x = -120 + (240 * i) / 7
    const y = 6 * (1 - (x / 120) ** 2)
    assets.push({
      id: `rack-${i + 1}`,
      kind: 'mortarRack',
      pos: v2(x, y),
      headingDeg: 0,
      elevationM: 0,
      rack: {
        calibersMm: [75, 100, 125, 150, 200],
        tiltDeg: 0,
        pinsPerModule: 32,
        maxSimultaneousPins: 8,
      },
    })
  }

  assets.push({
    id: 'pad-1',
    kind: 'dronePad',
    pos: v2(0, 40),
    headingDeg: 0,
    elevationM: 0,
    fleet: { count: 200, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 },
  })

  for (const side of [-1, 1] as const) {
    assets.push({
      id: side < 0 ? 'laser-west' : 'laser-east',
      kind: 'laserTower',
      pos: v2(60 * side, 0),
      headingDeg: 0,
      elevationM: 3,
      laser: { minElevationDeg: 12, scanFovDeg: 90, terminationM: 800 },
    })
    assets.push({
      id: side < 0 ? 'panel-west' : 'panel-east',
      kind: 'panel',
      pos: v2(30 * side, 0),
      headingDeg: 180,
      elevationM: 2,
      panel: { wPx: 64, hPx: 32, pitchMm: 40 },
    })
  }

  // Second drone pad, west of pad-1 inside the geofence: the solver chains one
  // morph sequence per pad, so concurrent formations need their own pad.
  assets.push({
    id: 'pad-2',
    kind: 'dronePad',
    pos: v2(-90, 40),
    headingDeg: 0,
    elevationM: 0,
    fleet: { count: 60, vMaxMps: 6, aMaxMps2: 3, rMinM: 2 },
  })

  // Crowd-broadcast masts flanking the lawn; either covers well past center,
  // together they cover every cell of the 300×70 m audience zone.
  const mastLatency = {
    wristband: { minMs: 10, p50Ms: 35, p95Ms: 80, maxMs: 120 },
    phone: { minMs: 120, p50Ms: 350, p95Ms: 1200, maxMs: 2500 },
  }
  for (const side of [-1, 1] as const) {
    assets.push({
      id: side < 0 ? 'mast-west' : 'mast-east',
      kind: 'crowdMast',
      pos: v2(75 * side, -185),
      headingDeg: 180,
      elevationM: 8,
      // framesPerSec is the PHYSICAL broadcast frame budget (one frame per
      // distinct color/intensity tuple per tick); latency-ramp rasters spend
      // hundreds of frames per second, so the masts carry broadcast-class
      // headroom. Pattern stacking is still bounded by Σ maskUpdateHz and the
      // exporter's stream check, both against this same cap.
      crowdMast: { coverageRadiusM: 170, framesPerSec: 1500, ...mastLatency },
    })
  }

  // Directional-audio arrays. A footprint needs depression ≥ halfWidth + 2°,
  // so max ground throw ≈ 11.4 × height above ear level for a 6° beam:
  //  - north pair on 25 m masts above the laser towers (long throw, reaches
  //    the lawn 190–265 m out at 0.55–0.78 s time-of-flight — the
  //    thunder-with-flash and flyover arrays);
  //  - delay-tower pair inside the lawn flanks on 16 m masts (~165 m throw —
  //    whole-zone coverage, crossed stereo pairs, zone pulses);
  //  - south corner pair on 8 m masts (~73 m throw — near-field whispers
  //    into the front corners).
  const beamSpec = {
    panRangeDeg: 120,
    tiltMinDeg: -45,
    tiltMaxDeg: 10,
    steerRateDegPerSec: 45,
    minFocusDistanceM: 5,
  }
  for (const side of [-1, 1] as const) {
    assets.push({
      id: side < 0 ? 'beam-north-west' : 'beam-north-east',
      kind: 'beamArray',
      pos: v2(60 * side, 0),
      headingDeg: 180,
      elevationM: 25,
      beamArray: { ...beamSpec },
    })
    assets.push({
      id: side < 0 ? 'beam-delay-west' : 'beam-delay-east',
      kind: 'beamArray',
      pos: v2(75 * side, -225),
      headingDeg: 0,
      elevationM: 16,
      beamArray: { ...beamSpec, panRangeDeg: 360 },
    })
    assets.push({
      id: side < 0 ? 'beam-south-west' : 'beam-south-east',
      kind: 'beamArray',
      pos: v2(140 * side, -182),
      headingDeg: 180,
      elevationM: 8,
      beamArray: { ...beamSpec },
    })
  }

  return {
    id: 'lakeside-park',
    assets,
    // Audience front line, 190 m south of the firing line.
    audience: [v2(-150, -190), v2(150, -190)],
    // Audience-occupied lawn behind the front line.
    audienceZone: [v2(-150, -190), v2(150, -190), v2(150, -260), v2(-150, -260)],
    exclusionZones: [],
    // Drone containment box over the display area (north of the racks).
    geofence: [v2(-170, 10), v2(170, 10), v2(170, 220), v2(-170, 220)],
    maxAltitudeM: 150,
    wind: { dirDegFrom: 270, speedMps: 3, limitMps: 9 },
    refListenerPos: [v2(-100, -190), v2(0, -190), v2(100, -190)],
    // Crowd canvas over the lawn: 8 m cells → ~38×9 grid, ≈330 kept cells.
    crowdGrid: { cellSizeM: 8, densityPPM2: 1.0, seed: 0xc404d5ee },
  }
}
