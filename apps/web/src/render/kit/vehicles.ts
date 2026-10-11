// Owner: T2. Vehicles: bus (kit v2: lower and longer) and the 2-car train (approved, unchanged from the kit sheet).
// Local frame: +x = forward (front of the vehicle), y up, +z = right-hand (kerb/door) side.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Materials } from '../materials';
import { at, box, cyl, detail, mesh, rbox } from './prims';

/** Bus dimensions (world units). Total height includes wheels and the roof unit. */
export const BUS = { length: 3.3, width: 1.25, height: 1.1, body: 0.8, wheelR: 0.2 } as const;
/** Train car dimensions; cars are coupled `TRAIN.pitch` apart (centre to centre). */
export const TRAIN = { carLength: 4.2, width: 1.36, pitch: 4.5, deckY: 0.2 } as const;

const L = BUS.length, W = BUS.width;
const BS = 0.06;              // body bevel (rounds the side edges)
const Y0 = 0.18, Y1 = 0.98;   // body bottom / top (outer)
const XR = -1.0, XF = 0.92;   // rear / front axle
const FRONT_R = 0.3;          // rounded front cap (outer radius)

let bodyGeo: THREE.BufferGeometry | null = null;
let shieldGeo: THREE.BufferGeometry | null = null;
let displayGeo: THREE.BufferGeometry | null = null;

/** Side profile with wheel arches and a rounded front cap, extruded across the width with rounded edges. */
function busBody(): THREE.BufferGeometry {
  if (bodyGeo) return bodyGeo;
  const x0 = -L / 2 + BS, x1 = L / 2 - BS, y0 = Y0 + BS, y1 = Y1 - BS;
  const rft = FRONT_R - BS, rfb = 0.06, rrt = 0.1, rrb = 0.04;
  const ra = BUS.wheelR + 0.07 + BS, wy = BUS.wheelR;            // arch radius (visible ≈ 0.27)
  const a = Math.asin((y0 - wy) / ra), dx = Math.sqrt(ra * ra - (y0 - wy) ** 2);
  const s = new THREE.Shape();
  s.moveTo(x0 + rrb, y0);
  s.lineTo(XR - dx, y0);
  s.absarc(XR, wy, ra, Math.PI - a, a, true);
  s.lineTo(XF - dx, y0);
  s.absarc(XF, wy, ra, Math.PI - a, a, true);
  s.lineTo(x1 - rfb, y0);
  s.absarc(x1 - rfb, y0 + rfb, rfb, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - rft);
  s.absarc(x1 - rft, y1 - rft, rft, 0, Math.PI / 2, false);
  s.lineTo(x0 + rrt, y1);
  s.absarc(x0 + rrt, y1 - rrt, rrt, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rrb);
  s.absarc(x0 + rrb, y0 + rrb, rrb, Math.PI, Math.PI * 1.5, false);
  const depth = W - 2 * BS;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: BS, bevelSize: BS, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute('uv');
  bodyGeo = toCreasedNormals(g, Math.PI / 5);
  return bodyGeo;
}

/** A thin shell following the front cap between angles a0..a1 (radians, 0 = straight ahead, π/2 = up). */
function frontShell(r0: number, r1: number, a0: number, a1: number, flatDown: number, width: number): THREE.BufferGeometry {
  const cx = L / 2 - FRONT_R, cy = Y1 - FRONT_R;
  const s = new THREE.Shape();
  if (flatDown > 0) {
    s.moveTo(cx + r0, cy - flatDown);
    s.lineTo(cx + r1, cy - flatDown);
    s.lineTo(cx + r1, cy);
  } else {
    s.moveTo(cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0));
  }
  s.absarc(cx, cy, r1, a0, a1, false);
  s.lineTo(cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1));
  s.absarc(cx, cy, r0, a1, a0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -width / 2);
  g.deleteAttribute('uv');
  return toCreasedNormals(g, Math.PI / 4);
}

export function makeBus(mats: Materials, routeIdx: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bus';
  const body = mats.get('bus'), glass = mats.get('glass');
  g.add(mesh(busBody(), body));
  // Curved windshield wrapping the front cap, destination display above it.
  shieldGeo ??= frontShell(FRONT_R - 0.05, FRONT_R + 0.012, 0, 0.74, 0.24, W - 0.22);
  displayGeo ??= frontShell(FRONT_R - 0.02, FRONT_R + 0.016, 0.82, 1.16, 0, 0.7);
  g.add(mesh(shieldGeo, glass));
  g.add(mesh(displayGeo, mats.get('display')));
  // Window band with thin pillars, rear window.
  g.add(at(box(2.3, 0.28, W + 0.024, glass), -0.32, 0.76, 0));
  for (const x of [-0.95, -0.38, 0.19]) g.add(detail(at(box(0.05, 0.28, W + 0.034, body), x, 0.76, 0)));
  g.add(at(box(0.02, 0.22, W - 0.34, glass), -L / 2 - 0.005, 0.73, 0));
  // Route-colour stripe (sides + rear), front door on the kerb side.
  g.add(at(box(2.78, 0.1, W + 0.02, mats.get('route', routeIdx)), -0.27, 0.53, 0));
  g.add(at(box(0.3, 0.6, 0.02, glass), 1.37, 0.56, W / 2 + 0.006));
  g.add(detail(at(box(0.025, 0.6, 0.03, body), 1.37, 0.56, W / 2 + 0.008)));
  // Roof panel + roof unit (total height 1.1).
  g.add(at(rbox(L - 0.7, 0.05, W - 0.36, 0.02, mats.get('busRoof')), 0, 1.0, 0));
  g.add(detail(at(rbox(0.62, 0.075, 0.6, 0.025, mats.get('metal')), -0.55, 1.0625, 0)));
  // Lights and bumpers.
  for (const z of [-0.4, 0.4]) g.add(at(box(0.02, 0.08, 0.16, mats.get('headlight')), L / 2 + 0.006, 0.34, z));
  for (const z of [-0.44, 0.44]) g.add(at(box(0.02, 0.1, 0.12, mats.get('taillight')), -L / 2 - 0.006, 0.4, z));
  for (const x of [L / 2 + 0.01, -L / 2 - 0.01]) g.add(detail(at(rbox(0.06, 0.08, W - 0.06, 0.02, mats.get('tire')), x, 0.22, 0)));
  // Wheels inside the arches.
  for (const x of [XR, XF]) for (const z of [-0.52, 0.52]) {
    const w = cyl(BUS.wheelR, BUS.wheelR, 0.16, mats.get('tire'), 18); w.rotation.x = Math.PI / 2; g.add(at(w, x, BUS.wheelR, z));
    const h = cyl(0.09, 0.09, 0.02, mats.get('hub'), 12); h.rotation.x = Math.PI / 2; g.add(detail(at(h, x, BUS.wheelR, Math.sign(z) * 0.605)));
  }
  return g;
}

export function makeTrainCar(mats: Materials, front: boolean): THREE.Group {
  const g = new THREE.Group(), Lc = TRAIN.carLength, Wc = TRAIN.width, end = front ? 1 : -1;
  g.name = front ? 'trainFront' : 'trainRear';
  g.add(at(rbox(Lc, 1.12, Wc, 0.3, mats.get('train')), 0, 0.92, 0));
  g.add(at(rbox(Lc + 0.02, 0.14, Wc + 0.02, 0.05, mats.get('trainStripe')), 0, 0.66, 0));
  g.add(at(rbox(Lc - 0.9, 0.36, Wc + 0.02, 0.06, mats.get('glass')), -end * 0.2, 1.12, 0));
  g.add(at(rbox(Lc - 0.3, 0.14, Wc - 0.2, 0.06, mats.get('trainRoof')), 0, 1.54, 0));
  for (const bx of [-1.35, 1.35]) g.add(at(rbox(0.95, 0.3, Wc - 0.24, 0.06, mats.get('bogie')), bx, 0.25, 0));
  g.add(at(rbox(0.12, 0.42, Wc - 0.3, 0.05, mats.get('glass')), end * (Lc / 2 - 0.02), 1.1, 0));
  for (const dx of [-0.9, 0.9]) g.add(detail(at(rbox(0.5, 0.78, 0.04, 0.03, mats.get('trainStripe')), dx, 0.92, Wc / 2 + 0.01)));
  for (const sz of [-0.42, 0.42]) g.add(at(rbox(0.05, 0.12, 0.2, 0.02, mats.get(front ? 'headlight' : 'taillight')), end * (Lc / 2 + 0.02), 0.6, sz));
  return g;
}

/** Two coupled cars, front car toward +x, standing on the rail deck (y = 0 is the ballast top). */
export function makeTrain(mats: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'train';
  g.add(at(makeTrainCar(mats, true), TRAIN.pitch / 2, 0, 0), at(makeTrainCar(mats, false), -TRAIN.pitch / 2, 0, 0));
  g.add(at(rbox(0.5, 0.2, 0.3, 0.05, mats.get('bogie')), 0, 0.55, 0));
  return g;
}
