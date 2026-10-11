// Owner: T2.1. Transit infrastructure: bus stop + station (approved, as on the kit sheet), straight track and
// road pieces, street lamp. Stop frame: +z = kerb/road side, shelter at -z, platform 3.6 × 1.8, y = 0 ground.
// Station frame: platform along x, track at +z (z = 1.75), station building at -z.
import * as THREE from 'three';
import { at, box, cyl, detail, rbox, sphere } from './prims';
import { clockFace } from './landmarks';

export function makeStop(routes: number[] = [0]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stop';
  g.add(at(rbox(3.6, 0.12, 1.8, 0.06, 'platform'), 0, 0.06, 0));
  g.add(detail(at(rbox(3.6, 0.02, 0.12, 0.01, 'safety'), 0, 0.13, 0.82)));
  for (const x of [-1.0, 1.0]) g.add(at(cyl(0.06, 0.06, 1.4, 'post', 0, 10), x, 0.8, -0.55));
  g.add(at(rbox(2.4, 0.14, 1.05, 0.06, 'stop'), 0, 1.52, -0.35));
  g.add(at(rbox(2.0, 0.95, 0.06, 0.03, 'panel'), 0, 0.68, -0.62));
  g.add(detail(at(rbox(1.5, 0.08, 0.36, 0.03, 'bench'), 0, 0.46, -0.4)));
  g.add(at(cyl(0.05, 0.05, 2.1, 'post', 0, 10), 1.55, 1.12, 0.45));
  g.add(at(rbox(0.56, 0.56, 0.08, 0.08, 'stop'), 1.55, 2.05, 0.45));
  routes.forEach((r, i) => g.add(at(rbox(0.13, 0.13, 0.06, 0.03, 'route', r), 1.55 + (i - (routes.length - 1) / 2) * 0.16, 2.05, 0.5)));
  return g;
}

/** Track constants: ballast width, rail gauge (rail centres at ±gauge/2), tie spacing. */
export const TRACK = { ballastW: 1.8, gauge: 0.9, tieSpacing: 0.6, tieW: 0.26, tieL: 1.4, railTop: 0.255 } as const;

/** Straight track piece along x (ballast, ties, 2 rails), base at y = 0. */
export function makeTrack(length: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'track';
  g.add(at(rbox(length, 0.1, TRACK.ballastW, 0.04, 'ballast'), 0, 0.05, 0));
  const n = Math.floor(length / TRACK.tieSpacing);
  for (let i = 0; i < n; i++) g.add(at(box(TRACK.tieW, 0.08, TRACK.tieL, 'ties'), -length / 2 + TRACK.tieSpacing / 2 + i * TRACK.tieSpacing, 0.13, 0));
  for (const z of [-TRACK.gauge / 2, TRACK.gauge / 2]) g.add(at(rbox(length, 0.09, 0.09, 0.02, 'rail'), 0, 0.21, z));
  return g;
}

/** Station clock (station-local): post-mounted face at 45°. */
export const STATION_CLOCK = { x: 3.4, y: 2.1, z: -0.2, rotY: Math.PI / 4, r: 0.32 } as const;

export function makeStation(opts: { track?: boolean; hands?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = 'station';
  if (opts.track ?? true) g.add(at(makeTrack(11), 0, 0, 1.75));
  g.add(at(rbox(9, 0.55, 2.4, 0.1, 'platform'), 0, 0.275, -0.2));
  g.add(detail(at(rbox(9, 0.02, 0.16, 0.01, 'safety'), 0, 0.56, 0.85)));
  for (const x of [-2.6, 0, 2.6]) g.add(at(cyl(0.07, 0.07, 1.95, 'post', 0, 10), x, 1.5, -0.6));
  g.add(at(rbox(7.2, 0.16, 1.9, 0.07, 'canopy'), 0, 2.5, -0.25));
  g.add(at(rbox(3.4, 2.4, 2.2, 0.14, 'wall', 2), -1.6, 1.2, -2.6));
  g.add(at(rbox(3.6, 0.26, 2.4, 0.1, 'roof', 0), -1.6, 2.5, -2.6));
  g.add(at(rbox(0.06, 1.3, 0.9, 0.04, 'door'), 0.11, 0.65, -2.6));
  g.add(at(cyl(0.05, 0.05, 1.4, 'post', 0, 10), STATION_CLOCK.x, 1.25, STATION_CLOCK.z));
  const clock = clockFace(STATION_CLOCK.r, opts.hands ?? true);
  clock.rotation.y = STATION_CLOCK.rotY;
  g.add(at(clock, STATION_CLOCK.x, STATION_CLOCK.y, STATION_CLOCK.z));
  return g;
}

/** Straight road piece along x (2.4 wide) with centre dashes. */
export function makeRoad(length: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'road';
  g.add(at(rbox(length, 0.06, 2.4, 0.03, 'road'), 0, 0.03, 0));
  for (let x = -length / 2 + 0.8; x < length / 2 - 0.4; x += 1.6) g.add(detail(at(box(0.8, 0.02, 0.1, 'mark'), x + 0.4, 0.07, 0)));
  return g;
}

/** Globe street lamp ≈ 2 u tall; the globe (role `lamp`) glows at dusk. */
export const LAMP = { height: 2.02, globeY: 1.86, globeR: 0.16 } as const;

export function makeStreetLamp(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lamp';
  g.add(at(cyl(0.1, 0.12, 0.16, 'post', 0, 10), 0, 0.08, 0));
  g.add(at(cyl(0.045, 0.06, 1.62, 'post', 0, 8), 0, 0.9, 0));
  g.add(detail(at(cyl(0.09, 0.07, 0.08, 'post', 0, 10), 0, 1.71, 0)));
  g.add(at(sphere(LAMP.globeR, 'lamp', 0, 12, 9), 0, LAMP.globeY, 0));
  return g;
}
