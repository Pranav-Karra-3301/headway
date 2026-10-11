// Owner: T2.1. Landmarks: clock tower (Old Main) and stadium bowl, plus the shared clock face.
// Clock hands are separate so the FX layer can drive them from the sim clock: build with `{ hands: false }`
// and place hands at CLOCK_TOWER.faces / STATION_CLOCK (local coordinates, face normal = rotated +z).
import * as THREE from 'three';
import { at, box, cone, cyl, detail, ellipseRing, rbox, sphere } from './prims';
import { windowUnit } from './buildings';

/** Clock face facing +z (disc axis along z), centred at the origin. Hands (if any) are detail parts. */
export function clockFace(r: number, hands = true): THREE.Group {
  const g = new THREE.Group();
  const rim = cyl(r + 0.05, r + 0.05, 0.06, 'hands', 0, 24); rim.rotation.x = Math.PI / 2; rim.position.z = -0.02; g.add(rim);
  const disc = cyl(r, r, 0.08, 'clock', 0, 24); disc.rotation.x = Math.PI / 2; g.add(disc);
  if (hands) for (const [len, ang] of [[r * 0.55, 2.2], [r * 0.82, -0.55]] as const) g.add(detail(clockHand(len, ang)));
  return g;
}

/** One clock hand pivoting at the face centre (rotation.z = angle, 0 = 12 o'clock, clockwise negative). */
export function clockHand(len: number, angle = 0): THREE.Mesh {
  const h = box(0.06, len, 0.02, 'hands');
  h.geometry = h.geometry.clone().translate(0, len / 2, 0);
  h.rotation.z = angle;
  h.position.z = 0.05;
  return h;
}

const TS = 1.7, TH = 6.4, FACE_R = 0.55, FACE_Y = TH - 0.95;

/** Clock tower dimensions + the 4 clock faces (tower-local: position, yaw; the face looks along its rotated +z). */
export const CLOCK_TOWER = {
  size: TS, height: TH + 1.8, faceR: FACE_R,
  faces: [
    { x: 0, y: FACE_Y, z: TS / 2 + 0.04, rotY: 0 },
    { x: TS / 2 + 0.04, y: FACE_Y, z: 0, rotY: Math.PI / 2 },
    { x: 0, y: FACE_Y, z: -TS / 2 - 0.04, rotY: Math.PI },
    { x: -TS / 2 - 0.04, y: FACE_Y, z: 0, rotY: -Math.PI / 2 },
  ],
} as const;

export function makeClockTower(opts: { hands?: boolean } = {}): THREE.Group {
  const g = new THREE.Group(), s = TS, h = TH;
  g.name = 'clockTower';
  g.add(at(rbox(s + 0.6, 0.5, s + 0.6, 0.12, 'tower'), 0, 0.25, 0));
  g.add(at(rbox(s, h, s, 0.12, 'tower'), 0, h / 2, 0));
  g.add(at(rbox(s + 0.24, 0.2, s + 0.24, 0.07, 'trim'), 0, h - 1.85, 0));
  g.add(detail(at(rbox(s + 0.16, 0.14, s + 0.16, 0.05, 'trim'), 0, h - 0.02, 0)));
  const roof = cone(s * 0.84, 1.8, 'towerRoof', 0, 4); roof.rotation.y = Math.PI / 4; g.add(at(roof, 0, h + 0.9, 0));
  g.add(detail(at(sphere(0.1, 'display', 0, 8, 6), 0, h + 1.86, 0)));
  for (const f of CLOCK_TOWER.faces) {
    const c = clockFace(FACE_R, opts.hands ?? true); c.rotation.y = f.rotY; g.add(at(c, f.x, f.y, f.z));
    for (const y of [1.6, 3.0]) {
      const w = windowUnit(0.4, 0.8, y > 2, { sill: true });
      w.rotation.y = f.rotY;
      const k = (s / 2) / Math.hypot(f.x, f.z);
      g.add(at(w, f.x * k, y, f.z * k));
    }
  }
  const door = new THREE.Group();
  door.add(at(box(0.6, 1.0, 0.05, 'door'), 0, 0.5, 0.025), detail(at(box(0.72, 1.06, 0.035, 'frame'), 0, 0.53, 0.0175)));
  g.add(at(door, 0, 0.5, s / 2));
  return g;
}

/** Stadium bowl ≈ 10.8 × 8.4 with 4 floodlight masts (lamp heads glow at dusk), gates and a scoreboard. */
export const STADIUM = { rx: 5.4, rz: 4.2, wallH: 1.8, masts: [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4] } as const;

export function makeStadium(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stadium';
  g.add(ellipseRing(5.4, 4.2, 4.7, 3.5, 1.8, 'stadium'));
  g.add(ellipseRing(4.7, 3.5, 4.3, 3.15, 1.35, 'seats', 0));
  g.add(ellipseRing(4.3, 3.15, 3.9, 2.8, 0.9, 'seats', 1));
  g.add(ellipseRing(3.9, 2.8, 0, 0, 0.08, 'field'));
  g.add(detail(at(box(0.08, 0.02, 5.4, 'mark'), 0, 0.09, 0)));
  g.add(detail(at(box(4.2, 0.02, 0.08, 'mark'), 0, 0.09, 2.55)));
  g.add(detail(at(box(4.2, 0.02, 0.08, 'mark'), 0, 0.09, -2.55)));
  const ring = cyl(0.7, 0.7, 0.02, 'mark', 0, 24); g.add(detail(at(ring, 0, 0.09, 0)));
  g.add(detail(at(cyl(0.62, 0.62, 0.025, 'field', 0, 24), 0, 0.095, 0)));
  // Rim band + pennants.
  g.add(detail(ellipseRing(5.45, 4.25, 5.25, 4.05, 0.12, 'trim')).translateY(1.8));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, x = Math.cos(a) * 5.05, z = Math.sin(a) * 3.88;
    const flag = new THREE.Group();
    flag.add(at(cyl(0.025, 0.025, 0.7, 'post', 0, 6), 0, 0.35, 0));
    flag.add(at(box(0.3, 0.18, 0.02, 'route', i % 3), 0.15, 0.6, 0));
    flag.rotation.y = -a;
    g.add(detail(at(flag, x, 1.8, z)));
  }
  // Gates: 3 arches on the town-facing sides.
  for (const a of [Math.PI / 2, 0, Math.PI * 0.75]) {
    const gate = new THREE.Group();
    gate.add(at(rbox(1.4, 1.25, 0.5, 0.08, 'trim'), 0, 0.625, 0));
    gate.add(at(box(0.8, 0.9, 0.06, 'window'), 0, 0.45, 0.24));
    gate.add(detail(at(rbox(1.6, 0.12, 0.66, 0.04, 'canopy'), 0, 1.3, 0.04)));
    gate.rotation.y = Math.PI / 2 - a;
    g.add(at(gate, Math.cos(a) * 5.35, 0, Math.sin(a) * 4.15));
  }
  // Scoreboard at the far end.
  const sb = new THREE.Group();
  sb.add(at(cyl(0.06, 0.06, 1.2, 'mast', 0, 8), -0.5, 0.6, 0), at(cyl(0.06, 0.06, 1.2, 'mast', 0, 8), 0.5, 0.6, 0));
  sb.add(at(rbox(1.7, 0.75, 0.16, 0.05, 'mast'), 0, 1.45, 0));
  sb.add(detail(at(box(1.45, 0.52, 0.02, 'display'), 0, 1.45, 0.085)));
  g.add(at(sb, 0, 1.8, -3.8));
  // Floodlight masts with lamp heads aimed at the pitch.
  for (const a of STADIUM.masts) {
    const x = Math.cos(a) * 5.0, z = Math.sin(a) * 3.85;
    g.add(at(cyl(0.1, 0.13, 2.0, 'mast', 0, 10), x, 2.8, z));
    const head = rbox(1.0, 0.55, 0.22, 0.06, 'lamp');
    head.position.set(x, 3.95, z);
    head.lookAt(0, 2.6, 0);
    g.add(head);
    const back = rbox(1.06, 0.6, 0.12, 0.04, 'mast');
    back.position.set(x * 1.025, 3.97, z * 1.025);
    back.lookAt(0, 2.6, 0);
    g.add(back);
  }
  return g;
}
