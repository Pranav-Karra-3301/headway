// Owner: E2. Everything static around the lake, baked into ONE vertex-coloured geometry drawn with KitMaterial:
// the beach (a strip following the shore, sand → wet sand → lake bed), causeways (abutment, deck, piers, parapets,
// dashed road), the lighthouse point (rock skirt + grass cap), the marina boardwalk, beach huts, umbrellas, rocks,
// dune grass, lamps… Builders work in a local frame (base centre at the origin, front = +z) like the town kit.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeGeometry, recolorBaked, type Baked } from '../../kit/bake';
import type { PaletteId } from '../../types';
import { resolveWaterRole, WATER_COLORS } from './colors';
import { at, box, capsule, cone, cyl, dome, group, pebble, prism, rbox, rot, scl, slab, sphere, torus } from './kit';
import { BEACH_Y, DECK_Y, LAKE_BED_Y, PIER_Y, WATER_Y, type Bridge, type Prop, type WaterPlan } from './plan';
import { buildViaduct } from './viaduct';

type Builder = (p: Prop) => THREE.Object3D;

// ---------------------------------------------------------------- small props
function lamp(): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.12, 0.15, 0.16, 'post', 0, 10), 0, 0.08, 0));
  g.add(at(cyl(0.036, 0.05, 1.54, 'post', 0, 8), 0, 0.98, 0));
  g.add(at(cyl(0.065, 0.045, 0.07, 'post', 0, 8), 0, 1.76, 0));
  g.add(at(cyl(0.115, 0.06, 0.06, 'post', 0, 6), 0, 1.82, 0));
  g.add(at(cyl(0.15, 0.105, 0.3, 'lamp', 0, 6), 0, 1.99, 0));
  g.add(at(cone(0.2, 0.15, 'post', 0, 6), 0, 2.235, 0));
  g.add(at(cone(0.035, 0.09, 'post', 0, 6), 0, 2.35, 0));
  return g;
}

function hut(p: Prop): THREE.Object3D {
  const g = group();
  const W = 1.22, D = 1.0, H = 1.18, base = 0.16, cz = -0.06;
  g.add(at(rbox(1.5, base + 0.3, 1.32, 0.04, 'plank', 1), 0, base / 2 - 0.15, 0.02));
  g.add(at(rbox(W, H, D, 0.05, 'hutPaint', p.v), 0, base + H / 2, cz));
  for (const sx of [-1, 1]) g.add(at(box(0.07, H, 0.07, 'trim'), sx * (W / 2 - 0.015), base + H / 2, cz + D / 2 - 0.015));
  g.add(at(prism(W + 0.24, 0.52, D + 0.26, 'z', 'stripe'), 0, base + H - 0.01, cz));
  g.add(at(rbox(0.52, 0.88, 0.06, 0.02, 'trim'), 0, base + 0.46, cz + D / 2 + 0.01));
  g.add(at(rbox(0.42, 0.79, 0.06, 0.02, 'hutPaint', (p.v + 2) % 5), 0, base + 0.43, cz + D / 2 + 0.03));
  g.add(at(rot(cyl(0.085, 0.085, 0.04, 'hutPaint', (p.v + 2) % 5, 12), Math.PI / 2, 0, 0), 0, base + H + 0.17, cz + D / 2 + 0.13));
  return g;
}

function umbrella(p: Prop): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.028, 0.028, 1.5, 'post', 0, 6), 0, 0.72, 0));
  for (let k = 0; k < 8; k++) g.add(at(cone(0.74, 0.3, k % 2 ? 'stripe' : 'hutPaint', k % 2 ? 0 : p.v, 2, (k * Math.PI) / 4, Math.PI / 4), 0, 1.5, 0));
  g.add(at(sphere(0.045, 'trim', 0, 8, 6), 0, 1.67, 0));
  g.rotation.z = 0.1;
  g.rotation.x = -0.06;
  return g;
}

function towel(p: Prop): THREE.Object3D {
  const g = group();
  g.add(at(rbox(0.62, 0.03, 1.1, 0.012, 'hutPaint', p.v % 5), 0, 0.015, 0));
  for (const z of [-0.36, 0.36]) g.add(at(box(0.63, 0.032, 0.09, 'stripe'), 0, 0.016, z));
  return g;
}

function lifeguard(): THREE.Object3D {
  const g = group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(rot(cyl(0.04, 0.05, 1.34, 'trim', 0, 6), sz * 0.08, 0, -sx * 0.08), sx * 0.3, 0.66, sz * 0.27));
  for (const sz of [-1, 1]) g.add(at(box(0.66, 0.05, 0.05, 'trim'), 0, 0.5, sz * 0.27));
  g.add(at(rbox(0.82, 0.07, 0.76, 0.02, 'plank'), 0, 1.33, 0));
  g.add(at(rbox(0.52, 0.08, 0.42, 0.03, 'taillight'), 0, 1.5, -0.04));
  g.add(at(rbox(0.52, 0.5, 0.07, 0.03, 'taillight'), 0, 1.78, -0.24));
  for (let k = 0; k < 4; k++) g.add(at(cone(0.48, 0.24, k % 2 ? 'stripe' : 'taillight', 0, 1, (k * Math.PI) / 2 + Math.PI / 4, Math.PI / 2), 0, 2.2, 0));
  g.add(at(cyl(0.02, 0.02, 0.55, 'trim', 0, 5), 0, 1.98, 0));
  for (let k = 0; k < 4; k++) g.add(at(box(0.5, 0.035, 0.05, 'trim'), 0, 0.28 + k * 0.28, 0.4));
  return g;
}

function hullShape(L: number, B: number): () => THREE.Shape {
  return () => {
    const s = new THREE.Shape();
    const hx = L / 2, hb = B / 2;
    s.moveTo(-hx + 0.12, -hb);
    s.lineTo(hx * 0.25, -hb);
    s.quadraticCurveTo(hx * 0.85, -hb * 0.8, hx, 0);
    s.quadraticCurveTo(hx * 0.85, hb * 0.8, hx * 0.25, hb);
    s.lineTo(-hx + 0.12, hb);
    s.quadraticCurveTo(-hx, hb, -hx, hb - 0.12);
    s.lineTo(-hx, -hb + 0.12);
    s.quadraticCurveTo(-hx, -hb, -hx + 0.12, -hb);
    return s;
  };
}
export { hullShape };

function rowboat(): THREE.Object3D {
  const g = group();
  g.add(at(slab('rowhull', hullShape(1.3, 0.56), 0.3, 0.05, 'hutPaint', 3), 0, 0, 0));
  g.add(at(slab('rowin', hullShape(1.08, 0.38), 0.05, 0.015, 'plank', 0), 0, 0.27, 0));
  for (const x of [-0.18, 0.2]) g.add(at(box(0.1, 0.04, 0.48, 'plank', 1), x, 0.31, 0));
  g.add(at(rot(capsule(0.025, 1.1, 'plank', 1), 0, 0.3, Math.PI / 2 - 0.05), 0.05, 0.36, 0.33));
  g.rotation.z = 0.12;
  return g;
}

function castle(): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.3, 0.36, 0.14, 'sandRole', 0, 12), 0, 0.07, 0));
  g.add(at(cyl(0.12, 0.14, 0.34, 'sandRole', 0, 10), 0, 0.3, 0));
  g.add(at(cone(0.13, 0.16, 'sandRole', 0, 10), 0, 0.55, 0));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    g.add(at(cyl(0.07, 0.08, 0.22, 'sandRole', 0, 8), Math.cos(a) * 0.22, 0.24, Math.sin(a) * 0.22));
  }
  g.add(at(cyl(0.008, 0.008, 0.22, 'post', 0, 4), 0, 0.72, 0));
  g.add(at(box(0.1, 0.06, 0.01, 'taillight'), 0.05, 0.79, 0));
  return g;
}

function rock(p: Prop): THREE.Object3D {
  const g = group();
  const h = p.h;
  g.add(at(rot(scl(pebble('rock', p.v), p.w * 0.55, h * 0.72, p.d * 0.55), 0.2, p.rot, 0.1), 0, h * 0.3, 0));
  g.add(at(rot(scl(pebble('rock', p.v + 1), p.w * 0.3, h * 0.42, p.d * 0.28), 0.4, p.rot * 1.7, 0.3), p.w * 0.42, h * 0.1, p.d * 0.22));
  return g;
}

function grass(p: Prop): THREE.Object3D {
  const g = group();
  const n = 5;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + p.rot;
    const h = 0.34 + ((k * 37) % 5) * 0.035;
    const blade = at(cone(0.04, h, 'dune', (p.v + k) % 3, 4), Math.cos(a) * 0.06, h / 2 - 0.02, Math.sin(a) * 0.06);
    blade.rotation.set(Math.sin(a) * 0.38, 0, -Math.cos(a) * 0.38);
    g.add(blade);
  }
  return g;
}

function driftwood(): THREE.Object3D {
  const g = group();
  g.add(at(rot(capsule(0.085, 1.3, 'drift'), 0, 0, Math.PI / 2), 0, 0.06, 0));
  g.add(at(rot(capsule(0.045, 0.36, 'drift'), 0.5, 0, 0.9), 0.32, 0.12, 0.1));
  return g;
}

function boathouse(): THREE.Object3D {
  const g = group();
  const W = 2.15, D = 1.85, H = 1.38, base = 0.18;
  g.add(at(rbox(W + 0.3, base + 0.3, D + 0.36, 0.05, 'plank', 1), 0, base / 2 - 0.15, 0.03));
  g.add(at(rbox(W, H, D, 0.05, 'wall', 2), 0, base + H / 2, 0));
  for (let k = -3; k <= 3; k++) g.add(at(box(0.04, H - 0.06, 0.03, 'trim'), (k * W) / 7.4, base + H / 2, D / 2 + 0.005));
  g.add(at(prism(W + 0.36, 0.78, D + 0.34, 'z', 'hutPaint', 0), 0, base + H - 0.01, 0));
  g.add(at(rbox(1.0, 1.02, 0.06, 0.03, 'trim'), 0, base + 0.52, D / 2 + 0.03));
  g.add(at(rbox(0.88, 0.94, 0.06, 0.03, 'door', 0), 0, base + 0.48, D / 2 + 0.05));
  g.add(at(box(0.03, 0.9, 0.065, 'trim'), 0, base + 0.48, D / 2 + 0.06));
  g.add(at(rot(cyl(0.17, 0.17, 0.05, 'trim', 0, 14), Math.PI / 2, 0, 0), 0, base + H + 0.27, D / 2 + 0.16));
  g.add(at(rot(cyl(0.13, 0.13, 0.06, 'window', 1, 14), Math.PI / 2, 0, 0), 0, base + H + 0.27, D / 2 + 0.17));
  g.add(at(rbox(1.3, 0.24, 0.05, 0.02, 'hutPaint', 1), 0, base + 1.17, D / 2 + 0.06));
  g.add(at(box(0.9, 0.05, 0.052, 'stripe'), 0, base + 1.17, D / 2 + 0.07));
  g.add(at(rbox(0.13, 0.18, 0.12, 0.03, 'lamp'), 0.62, base + 0.95, D / 2 + 0.08));
  for (const sz of [-0.42, 0.28]) g.add(at(rbox(0.06, 0.42, 0.42, 0.02, 'window', 1), W / 2 + 0.01, base + 0.78, sz));
  return g;
}

function flag(p: Prop): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.1, 0.13, 0.12, 'stone', 0, 8), 0, 0.06, 0));
  g.add(at(cyl(0.03, 0.04, 3.1, 'column', 0, 6), 0, 1.6, 0));
  g.add(at(sphere(0.06, 'stop', 0, 8, 6), 0, 3.18, 0));
  g.add(at(rbox(0.7, 0.42, 0.03, 0.012, 'hutPaint', p.v), 0.38, 2.88, 0));
  g.add(at(box(0.7, 0.1, 0.034, 'stripe'), 0.38, 2.88, 0));
  return g;
}

function bench(): THREE.Object3D {
  const g = group();
  for (const sx of [-0.5, 0.5]) {
    g.add(at(box(0.06, 0.42, 0.06, 'post'), sx, 0.21, 0.12));
    g.add(at(box(0.06, 0.78, 0.06, 'post'), sx, 0.39, -0.16));
  }
  for (const z of [-0.02, 0.12]) g.add(at(rbox(1.24, 0.05, 0.13, 0.015, 'bench'), 0, 0.44, z));
  for (const y of [0.6, 0.74]) g.add(at(rbox(1.24, 0.1, 0.04, 0.015, 'bench'), 0, y, -0.18));
  return g;
}

function lighthouse(): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.98, 1.08, 0.34, 'stone', 0, 10), 0, 0.17, 0));
  g.add(at(cyl(0.86, 0.94, 0.12, 'stoneDark', 0, 10), 0, 0.4, 0));
  const y0 = 0.46, y1 = 4.12, n = 5, r0 = 0.74, r1 = 0.5;
  for (let i = 0; i < n; i++) {
    const a = y0 + ((y1 - y0) * i) / n, b = y0 + ((y1 - y0) * (i + 1)) / n;
    const ra = r0 + ((r1 - r0) * i) / n, rb = r0 + ((r1 - r0) * (i + 1)) / n;
    g.add(at(cyl(rb, ra, b - a, i % 2 ? 'lhStripe' : 'wall', i % 2 ? 0 : 2, 18), 0, (a + b) / 2, 0));
  }
  // door + porthole windows on the camera-facing sides
  g.add(at(rbox(0.36, 0.64, 0.12, 0.05, 'door'), 0, y0 + 0.32, r0 - 0.02));
  for (const [y, a] of [[1.95, 0.6], [3.3, -0.5]] as const) {
    const r = r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    g.add(at(rot(cyl(0.1, 0.1, 0.06, 'window', 1, 10), Math.PI / 2, a, 0), Math.sin(a) * r, y, Math.cos(a) * r));
  }
  // gallery deck + railing
  g.add(at(cyl(0.8, 0.6, 0.16, 'post', 0, 18), 0, y1 + 0.08, 0));
  g.add(at(rot(torus(0.76, 0.022, 'post', 0, 4, 28), Math.PI / 2, 0, 0), 0, y1 + 0.42, 0));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.add(at(cyl(0.016, 0.016, 0.28, 'post', 0, 4), Math.cos(a) * 0.76, y1 + 0.29, Math.sin(a) * 0.76));
  }
  // lantern room (glows at dusk) with mullions, roof, ball finial
  g.add(at(cyl(0.4, 0.4, 0.66, 'lamp', 0, 12), 0, y1 + 0.49, 0));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.26;
    g.add(at(box(0.05, 0.66, 0.05, 'post'), Math.cos(a) * 0.41, y1 + 0.49, Math.sin(a) * 0.41));
  }
  g.add(at(cyl(0.48, 0.48, 0.06, 'post', 0, 14), 0, y1 + 0.85, 0));
  g.add(at(dome(0.46, 'lhStripe', 0, 16, 6), 0, y1 + 0.87, 0));
  g.add(at(cyl(0.025, 0.04, 0.3, 'post', 0, 6), 0, y1 + 1.4, 0));
  g.add(at(sphere(0.085, 'post', 0, 10, 8), 0, y1 + 1.58, 0));
  return g;
}

function cottage(): THREE.Object3D {
  const g = group();
  g.add(at(rbox(2.0, 0.14, 1.62, 0.04, 'stone'), 0, 0.07, 0));
  g.add(at(rbox(1.86, 1.12, 1.46, 0.06, 'wall', 2), 0, 0.13 + 0.56, 0));
  g.add(at(prism(2.1, 0.78, 1.72, 'x', 'lhStripe'), 0, 0.13 + 1.11, 0));
  g.add(at(rbox(0.26, 0.62, 0.26, 0.04, 'stone'), 0.52, 1.78, -0.28));
  g.add(at(rbox(0.36, 0.7, 0.06, 0.03, 'door'), -0.45, 0.13 + 0.35, 0.74));
  for (const x of [0.25, 0.68]) {
    g.add(at(rbox(0.34, 0.36, 0.05, 0.02, 'trim'), x, 0.13 + 0.66, 0.74));
    g.add(at(rbox(0.26, 0.28, 0.05, 0.02, 'window', 1), x, 0.13 + 0.66, 0.755));
  }
  g.add(at(rbox(0.05, 0.36, 0.34, 0.02, 'window', 1), 0.94, 0.13 + 0.66, 0.1));
  return g;
}

function pierDeck(p: Prop): THREE.Object3D {
  const g = group();
  const alongZ = p.d >= p.w;
  const long = alongZ ? p.d : p.w, short = alongZ ? p.w : p.d;
  const n = Math.max(1, Math.round(long / 0.42));
  const step = long / n;
  for (let k = 0; k < n; k++) {
    const c = -long / 2 + step * (k + 0.5);
    const plank = rbox(alongZ ? short : step - 0.035, p.h, alongZ ? step - 0.035 : short, 0.02, 'plank', k % 2);
    g.add(at(plank, alongZ ? 0 : c, p.h / 2, alongZ ? c : 0));
  }
  for (const s of [-1, 1]) {
    const beam = box(alongZ ? 0.12 : long, 0.16, alongZ ? long : 0.12, 'pile');
    g.add(at(beam, alongZ ? s * (short / 2 - 0.1) : 0, -0.06, alongZ ? 0 : s * (short / 2 - 0.1)));
  }
  return g;
}

function pile(p: Prop): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.1, 0.11, p.h, 'pile', 0, 8), 0, p.h / 2, 0));
  g.add(at(cyl(0.112, 0.112, 0.07, 'stripe', 0, 8), 0, p.h - 0.035, 0));
  return g;
}

function bollard(): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.06, 0.075, 0.15, 'post', 0, 8), 0, 0.075, 0));
  g.add(at(sphere(0.07, 'post', 0, 8, 5), 0, 0.16, 0));
  return g;
}

function lifering(): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.04, 0.045, 0.95, 'pile', 0, 6), 0, 0.47, 0));
  g.add(at(torus(0.17, 0.055, 'taillight', 0, 6, 16), 0, 0.68, 0.06));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(at(rot(box(0.07, 0.13, 0.13, 'stripe'), 0, 0, a), Math.cos(a) * 0.17, 0.68 + Math.sin(a) * 0.17, 0.06));
  }
  return g;
}

function crates(): THREE.Object3D {
  const g = group();
  g.add(at(rbox(0.46, 0.4, 0.46, 0.03, 'plank', 1), -0.12, 0.2, 0));
  g.add(at(rot(rbox(0.36, 0.3, 0.36, 0.03, 'plank', 0), 0, 0.4, 0), -0.08, 0.55, 0.02));
  g.add(at(cyl(0.16, 0.16, 0.44, 'pile', 0, 10), 0.3, 0.22, 0.12));
  g.add(at(rot(torus(0.15, 0.045, 'stripe', 0, 5, 12), Math.PI / 2, 0, 0), 0.32, 0.03, -0.32));
  return g;
}

/** Level-crossing sign: post, white crossbuck with red rims, a red lamp (glows at dusk via the palette lamp role). */
function xsign(): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.1, 0.12, 0.08, 'stone', 0, 8), 0, 0.04, 0));
  g.add(at(cyl(0.045, 0.05, 1.3, 'post', 0, 8), 0, 0.68, 0));
  for (const s of [-1, 1]) {
    g.add(at(rot(rbox(0.66, 0.14, 0.04, 0.02, 'taillight'), 0, 0, s * 0.62), 0, 1.22, 0.04));
    g.add(at(rot(rbox(0.6, 0.08, 0.045, 0.015, 'stripe'), 0, 0, s * 0.62), 0, 1.22, 0.045));
  }
  g.add(at(rbox(0.26, 0.16, 0.12, 0.04, 'post'), 0, 0.86, 0.05));
  for (const x of [-0.07, 0.07]) g.add(at(sphere(0.045, 'taillight', 0, 8, 6), x, 0.86, 0.11));
  return g;
}

const BUILDERS: Record<Prop['kind'], Builder> = {
  hut, umbrella, towel, lifeguard, rowboat, castle, rock, grass, driftwood, boathouse, lamp, flag, bench,
  lighthouse, cottage, pierDeck, pile, bollard, lifering, crates, xsign,
};

export function buildProp(p: Prop): THREE.Object3D {
  const o = BUILDERS[p.kind](p);
  const g = group(o);
  g.position.set(p.x, p.y, p.z);
  if (p.kind !== 'rock') g.rotation.y = p.rot;
  return g;
}

// ---------------------------------------------------------------- causeways
export function buildBridge(br: Bridge): THREE.Object3D {
  const g = group();
  const L = br.len, W = br.width, road = 2.4;
  const walk = (W - road) / 2 - 0.16;
  // abutment: a stone ramp wall from under the board edge out to the shallows
  const abLen = br.shoreAt + 0.6;
  const abBot = -1.5, abTop = DECK_Y - 0.03;
  g.add(at(rbox(W + 0.24, abTop - abBot, abLen, 0.14, 'stone'), 0, (abTop + abBot) / 2, abLen / 2 - 0.3));
  // deck slab
  const d0 = br.shoreAt - 0.2, slabH = 0.4;
  g.add(at(rbox(W, slabH, L - d0, 0.08, 'stone'), 0, DECK_Y - 0.02 - slabH / 2, (d0 + L) / 2));
  g.add(at(box(W + 0.06, 0.08, L - d0 - 0.1, 'stoneDark'), 0, DECK_Y - 0.36, (d0 + L) / 2));
  // road, sidewalks, parapets with a white coping, dashed centre line
  g.add(at(box(road, 0.03, L + 0.3, 'road'), 0, DECK_Y - 0.01, L / 2 - 0.15));
  // parapets run from 0.3 u to the end, broken at level crossings (br.gaps)
  const spans: Array<[number, number]> = [];
  let from = 0.3;
  for (const [a, c] of [...br.gaps].sort((p, q) => p[0] - q[0])) {
    if (a > from) spans.push([from, a]);
    from = Math.max(from, c);
  }
  if (L > from) spans.push([from, L]);
  for (const s of [-1, 1]) {
    g.add(at(box(walk, 0.1, L + 0.3, 'curb'), s * (road / 2 + walk / 2), DECK_Y + 0.02, L / 2 - 0.15));
    for (const [a, c] of spans) {
      if (c - a < 0.3) continue;
      g.add(at(rbox(0.17, 0.34, c - a, 0.05, 'stone'), s * (W / 2 - 0.085), DECK_Y + 0.15, (a + c) / 2));
      g.add(at(rbox(0.23, 0.06, c - a, 0.025, 'trim'), s * (W / 2 - 0.085), DECK_Y + 0.33, (a + c) / 2));
    }
  }
  for (let z = 1.2; z < L - 0.6; z += 2.0) g.add(at(box(0.12, 0.012, 0.9, 'mark'), 0, DECK_Y + 0.011, z));
  // piers with rounded cutwaters and a pale cap course
  const pTop = DECK_Y - 0.02 - slabH, pBot = LAKE_BED_Y;
  for (const a of br.piers) {
    g.add(at(rbox(W - 0.5, pTop - pBot, 0.84, 0.4, 'stoneDark'), 0, (pTop + pBot) / 2, a));
    g.add(at(rbox(W - 0.3, 0.12, 1.0, 0.05, 'stone'), 0, pTop - 0.02, a));
  }
  g.rotation.y = Math.atan2(br.dir.x, br.dir.z);
  g.position.set(br.from.x, 0, br.from.z);
  return g;
}

// ---------------------------------------------------------------- the lighthouse point
export function buildPoint(plan: WaterPlan): THREE.Object3D {
  const { a, b, r } = plan.point;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const capsuleShape = (rr: number) => () => {
    const s = new THREE.Shape();
    s.absarc(len, 0, rr, -Math.PI / 2, Math.PI / 2, false);
    s.absarc(0, 0, rr, Math.PI / 2, (3 * Math.PI) / 2, false);
    s.closePath();
    return s;
  };
  const g = group();
  g.add(at(slab(`pt-rock:${len.toFixed(2)}:${r}`, capsuleShape(r - 0.3), 0.0 - LAKE_BED_Y + 0.06, 0.3, 'rock', 1, 14), 0, LAKE_BED_Y, 0));
  g.add(at(slab(`pt-grass:${len.toFixed(2)}:${r}`, capsuleShape(r - 0.62), 0.2, 0.08, 'lawn', 0, 14), 0, -0.05, 0));
  // stepping-stone path from the beach to the lighthouse
  for (let k = 0; k < 6; k++) {
    const u = 0.3 + k * ((len - 1.6) / 5);
    g.add(at(rot(rbox(0.46, 0.06, 0.36, 0.03, 'stone'), 0, 0.3 * Math.sin(k * 1.7), 0), u, 0.15, 0.55 * Math.sin(k * 0.9 + 0.4)));
  }
  g.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
  g.position.set(a.x, 0, a.z);
  return g;
}

// ---------------------------------------------------------------- the beach strip
/** Row offsets across the beach as fractions of the local width (the first row tucks under the board edge). */
const ROWS = [-0.15, 0, 0.1, 0.24, 0.4, 0.56, 0.7, 0.82, 0.91, 0.97, 1.02, 1.1, 1.24, 1.5, 1.85];

export interface BeachMesh {
  geometry: THREE.BufferGeometry;
  /** Write sand colours for a palette into `color` starting at vertex `offset`. */
  recolor(color: THREE.BufferAttribute, palette: PaletteId, offset: number): void;
}

export function buildBeach(plan: WaterPlan, palette: PaletteId): BeachMesh {
  const sh = plan.shore;
  const cols: number[] = [];
  for (let s = sh.sMin; s < sh.sMax; s += 0.5) cols.push(s);
  cols.push(sh.sMax);
  const nr = ROWS.length, nc = cols.length;
  const pos = new Float32Array(nc * nr * 3);
  const tArr = new Float32Array(nc * nr);
  const noise = new Float32Array(nc * nr);
  for (let i = 0; i < nc; i++) {
    const s = cols[i]!, w = sh.width(s);
    for (let j = 0; j < nr; j++) {
      const f = ROWS[j]!;
      const d = j === 0 ? -0.6 : f * w;
      const p = sh.at(s, d);
      const y = j === 0 ? BEACH_Y - 0.05 : Math.max(sh.ground(p.x, p.z), LAKE_BED_Y);
      const k = i * nr + j;
      pos[k * 3] = p.x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = p.z;
      tArr[k] = f;
      noise[k] = Math.sin(p.x * 1.7 + p.z * 0.9) * 0.5 + Math.sin(p.x * 0.53 - p.z * 1.31) * 0.5;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < nc - 1; i++) {
    for (let j = 0; j < nr - 1; j++) {
      const a = i * nr + j, b = (i + 1) * nr + j, c = (i + 1) * nr + j + 1, d = i * nr + j + 1;
      index.push(a, c, b, a, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const n = nc * nr;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n), 1));
  const ca = new THREE.Color(), cb = new THREE.Color(), cc = new THREE.Color(), out = new THREE.Color();
  const recolor = (color: THREE.BufferAttribute, pal: PaletteId, offset: number) => {
    const C = WATER_COLORS[pal];
    ca.set(C.sand); cb.set(C.wetSand); cc.set(C.bedSand);
    const arr = color.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const t = tArr[k]!;
      out.copy(ca).lerp(cb, THREE.MathUtils.smoothstep(t, 0.62, 0.9));
      out.lerp(cc, THREE.MathUtils.smoothstep(t, 0.98, 1.25));
      out.multiplyScalar(1 + noise[k]! * 0.025);
      const o = (offset + k) * 3;
      arr[o] = out.r; arr[o + 1] = out.g; arr[o + 2] = out.b;
    }
    color.needsUpdate = true;
  };
  recolor(geometry.getAttribute('color') as THREE.BufferAttribute, palette, 0);
  return { geometry, recolor };
}

// ---------------------------------------------------------------- all statics in one geometry
export interface Statics {
  geometry: THREE.BufferGeometry;
  /** Vertex count of the baked props (the beach follows). */
  propVertices: number;
  recolor(palette: PaletteId): void;
}

export function buildStatics(plan: WaterPlan, palette: PaletteId): Statics {
  const root = group();
  for (const p of plan.props) root.add(buildProp(p));
  for (const br of plan.bridges) root.add(buildBridge(br));
  root.add(buildViaduct(plan.viaduct));
  root.add(buildPoint(plan));
  const baked = bakeGeometry(root, palette, { resolve: resolveWaterRole });
  const beach = buildBeach(plan, palette);
  const propVertices = baked.geometry.getAttribute('position').count;
  const geometry = mergeGeometries([baked.geometry, beach.geometry]);
  baked.geometry.dispose();
  beach.geometry.dispose();
  const view: Baked = { geometry, ranges: baked.ranges, baseIndexCount: geometry.index!.count, resolve: resolveWaterRole };
  geometry.userData.kit = view;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const recolor = (pal: PaletteId) => {
    recolorBaked(view, pal);
    beach.recolor(geometry.getAttribute('color') as THREE.BufferAttribute, pal, propVertices);
  };
  recolor(palette);
  return { geometry, propVertices, recolor };
}

export { WATER_Y, PIER_Y };
