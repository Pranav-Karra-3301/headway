// Owner: A4. lm.stadium — the showpiece: a rounded college-football bowl (11 × 8.5 footprint, front = +z).
// Outer facade with concourse arches, a colour band and hanging banners; parapet with pennants; three stepped
// seating tiers; padded field wall; striped pitch with end zones, yard lines, midfield logo and goalposts;
// press box on the back stand; scoreboard over the -x end; four corner light towers whose lamp heads (role
// `lamp`) glow at dusk; a main gate on the front and two end gates.
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { loftGeometry, perimeterAt, perimeterLength, rrAt, type Bowl } from './loft';
import { at, box, cyl, disc, group, type Kit, mesh, rbox, rodX, roundedPlate } from './parts';

/** Bowl outline: outer facade 10 × 7.5, corner radius 2.4; end stands shallower than the side stands. */
export const STADIUM_BOWL: Bowl = { a: 5.0, b: 3.75, r: 2.4, fx: 0.75, fz: 1.0, fr: 0.9, rMin: 0.5, seg: 8 };

const RIM_Y = 1.68;
const FIELD_D = 2.0;

type Prof = Array<[number, number]>;
const FACADE: Prof = [[0, 0], [0, 1.5]];
const PARAPET: Prof = [[0, 1.5], [0, RIM_Y], [0.2, RIM_Y], [0.2, 1.52]];
const TIER_UPPER: Prof = [[0.2, 1.52], [0.46, 1.52], [0.46, 1.36], [0.72, 1.36], [0.72, 1.2], [0.98, 1.2], [0.98, 1.04]];
const AISLE: Prof = [[0.98, 1.04], [1.18, 1.04]];
const TIER_MID: Prof = [[1.18, 1.04], [1.18, 0.86], [1.43, 0.86], [1.43, 0.68]];
const TIER_LOW: Prof = [[1.43, 0.68], [1.68, 0.68], [1.68, 0.5], [1.93, 0.5], [1.93, 0.32]];
const FIELD_WALL: Prof = [[1.93, 0.32], [FIELD_D, 0.32], [FIELD_D, 0.03]];

function loft(k: Kit, prof: Prof, role: string, idx = 0, name = ''): THREE.Mesh {
  const m = mesh(k, loftGeometry(STADIUM_BOWL, prof), role, idx);
  m.name = name;
  return m;
}

/** Yaw that turns local +z to the outward normal (nx, nz). */
const yawOf = (nx: number, nz: number) => Math.atan2(nx, nz);

function pitch(k: Kit, root: THREE.Group): void {
  const rr = rrAt(STADIUM_BOWL, FIELD_D);
  root.add(at(roundedPlate(k, rr.a + 0.02, rr.b + 0.02, rr.r, 'field'), 0, 0.03, 0));
  const L = 3.2, W = 1.45, goal = 2.66, yd = (2 * goal) / 10;
  // mowing stripes (every other 10 yards) + end zones
  for (let i = 0; i < 10; i += 2) root.add(k.detail(at(box(k, yd, 0.01, W * 2, 'lmTurf'), -goal + yd * (i + 0.5), 0.036, 0)));
  for (const s of [-1, 1]) root.add(at(box(k, L - goal, 0.012, W * 2, 'lmEndzone'), s * (goal + L) / 2, 0.038, 0));
  // yard lines, sidelines, end lines
  for (let i = 0; i <= 10; i++) root.add(at(box(k, i % 5 === 0 ? 0.04 : 0.025, 0.012, W * 2, 'mark'), -goal + yd * i, 0.044, 0));
  for (const s of [-1, 1]) {
    root.add(at(box(k, L * 2 + 0.04, 0.012, 0.04, 'mark'), 0, 0.044, s * W));
    root.add(at(box(k, 0.04, 0.012, W * 2, 'mark'), s * L, 0.044, 0));
  }
  // midfield logo
  root.add(at(cyl(k, 0.36, 0.36, 0.012, 'mark', 0, 20), 0, 0.046, 0));
  root.add(at(cyl(k, 0.3, 0.3, 0.014, 'lmBanner', 0, 20), 0, 0.048, 0));
  root.add(k.detail(at(cyl(k, 0.12, 0.12, 0.016, 'mark', 0, 12), 0, 0.05, 0)));
  // goalposts (yellow), just behind each end line
  for (const s of [-1, 1]) {
    const gp = group('goalpost');
    gp.add(at(cyl(k, 0.028, 0.034, 0.42, 'safety', 0, 6), 0, 0.21, 0));
    gp.add(at(rodX(k, 0.022, 0.16, 'safety', 0, 6), -s * 0.08, 0.42, 0));
    const bar = cyl(k, 0.022, 0.022, 0.66, 'safety', 0, 6); bar.rotation.x = Math.PI / 2;
    gp.add(at(bar, -s * 0.16, 0.42, 0));
    for (const z of [-0.33, 0.33]) gp.add(at(cyl(k, 0.02, 0.02, 0.56, 'safety', 0, 6), -s * 0.16, 0.7, z));
    root.add(at(gp, s * (L + 0.14), 0, 0));
  }
  // team benches on the near and far sidelines (detail)
  for (const s of [-1, 1]) for (const x of [-0.9, 0.9]) root.add(k.detail(at(box(k, 0.9, 0.08, 0.1, 'bench'), x, 0.08, s * (W + 0.12))));
}

function lightTower(k: Kit, x: number, z: number): THREE.Group {
  const t = group('lightTower');
  t.add(at(cyl(k, 0.2, 0.24, 0.12, 'curb', 0, 10), 0, 0.06, 0));
  t.add(at(cyl(k, 0.05, 0.09, 3.18, 'mast', 0, 8), 0, 0.12 + 1.59, 0));
  for (const y of [1.0, 1.9, 2.7]) t.add(k.detail(at(cyl(k, 0.1 - y * 0.012, 0.1 - y * 0.012, 0.05, 'mast', 0, 8), 0, y, 0)));
  const head = group('lampHead');
  head.add(at(box(k, 1.0, 0.5, 0.1, 'mast'), 0, 0, -0.02));
  head.add(at(box(k, 0.9, 0.4, 0.04, 'lamp'), 0, 0, 0.05));
  head.add(k.detail(at(box(k, 0.9, 0.025, 0.03, 'mast'), 0, 0, 0.08)));
  for (const u of [-0.15, 0.15]) head.add(k.detail(at(box(k, 0.025, 0.4, 0.03, 'mast'), u, 0, 0.08)));
  head.add(k.detail(at(box(k, 1.04, 0.04, 0.18, 'mast'), 0, 0.27, 0.03)));
  head.add(k.detail(at(box(k, 0.86, 0.03, 0.2, 'mast'), 0, -0.32, -0.04)));
  head.rotation.order = 'YXZ';
  head.rotation.y = Math.atan2(-x, -z);
  head.rotation.x = 0.32;
  t.add(at(head, 0, 3.34, 0));
  return at(t, x, 0, z);
}

function scoreboard(k: Kit): THREE.Group {
  const s = group('scoreboard');
  for (const z of [-0.75, 0.75]) s.add(at(cyl(k, 0.065, 0.065, 0.66, 'mast', 0, 8), 0, RIM_Y + 0.33, z));
  s.add(at(rbox(k, 0.2, 0.92, 2.3, 0.05, 'mast'), 0, 2.78, 0));
  s.add(at(box(k, 0.03, 0.6, 1.62, 'display'), 0.105, 2.84, 0));
  for (const z of [-0.45, 0.45]) {
    s.add(k.detail(at(box(k, 0.02, 0.22, 0.42, 'window'), 0.125, 2.8, z)));
    s.add(k.detail(at(box(k, 0.02, 0.07, 0.42, 'lmBanner', z < 0 ? 0 : 1), 0.125, 3.0, z)));
  }
  s.add(at(box(k, 0.24, 0.14, 2.36, 'lmBanner', 0), 0, 3.3, 0));
  return s;
}

function pressBox(k: Kit): THREE.Group {
  const p = group('pressBox');
  p.add(at(rbox(k, 3.4, 0.62, 0.95, 0.06, 'wall', 2), 0, RIM_Y + 0.31, 0));
  p.add(at(box(k, 3.12, 0.3, 0.03, 'window', 1), 0, RIM_Y + 0.35, 0.48));
  for (let i = 0; i <= 6; i++) p.add(k.detail(at(box(k, 0.03, 0.3, 0.035, 'frame'), -1.56 + i * 0.52, RIM_Y + 0.35, 0.49)));
  p.add(k.detail(at(box(k, 3.2, 0.04, 0.12, 'trim'), 0, RIM_Y + 0.17, 0.5)));
  p.add(at(rbox(k, 3.62, 0.1, 1.14, 0.04, 'roof', 1), 0, RIM_Y + 0.67, 0.04));
  p.add(k.detail(at(box(k, 0.5, 0.18, 0.3, 'metal'), -1.0, RIM_Y + 0.81, -0.1)));
  p.add(k.detail(at(cyl(k, 0.012, 0.012, 0.5, 'post', 0, 4), 1.3, RIM_Y + 0.97, -0.2)));
  return p;
}

/** Gate pavilion facing +z, its back embedded in the facade. `main` adds the sign, crest and flags. */
function gate(k: Kit, main: boolean, rnd: () => number): THREE.Group {
  const g = group('gate');
  const w = main ? 2.1 : 1.5, h = main ? 1.95 : 1.8, d = 0.72;
  g.add(at(rbox(k, w, h, d, 0.07, 'brick'), 0, h / 2, 0.08));
  const ow = main ? 0.9 : 0.66, rect = main ? 0.62 : 0.5, front = 0.08 + d / 2;
  // arched opening with a stone surround
  g.add(k.detail(at(box(k, ow + 0.16, rect, 0.03, 'lmStone'), 0, rect / 2, front + 0.005)));
  g.add(k.detail(at(disc(k, ow / 2 + 0.08, 0.03, 'lmStone', 0, 10), 0, rect, front + 0.005)));
  g.add(at(box(k, ow, rect, 0.04, 'window'), 0, rect / 2, front + 0.02));
  g.add(at(disc(k, ow / 2, 0.04, 'window', 0, 10), 0, rect, front + 0.02));
  // canopy over the entrance
  g.add(at(box(k, ow + 0.6, 0.06, 0.36, 'canopy'), 0, rect + ow / 2 + 0.16, front + 0.2));
  g.add(k.detail(at(box(k, ow + 0.6, 0.08, 0.02, 'stripe'), 0, rect + ow / 2 + 0.1, front + 0.38)));
  // turnstiles
  for (const u of [-ow / 3, 0, ow / 3]) g.add(k.detail(at(cyl(k, 0.035, 0.035, 0.32, 'rail', 0, 6), u, 0.16, front + 0.12)));
  // lanterns
  for (const u of [-1, 1]) g.add(k.detail(at(box(k, 0.1, 0.16, 0.1, 'lamp'), u * (ow / 2 + 0.24), rect + 0.12, front + 0.05)));
  if (main) {
    g.add(at(box(k, 1.5, 0.3, 0.05, 'paper'), 0, h - 0.25, front + 0.02));
    g.add(k.detail(at(box(k, 1.24, 0.08, 0.02, 'accent'), 0, h - 0.25, front + 0.055)));
    g.add(at(rbox(k, 1.1, 0.24, 0.5, 0.05, 'brick'), 0, h + 0.1, 0.08));
    g.add(k.detail(at(box(k, w + 0.06, 0.06, d + 0.06, 'lmStone'), 0, h - 0.02, 0.08)));
    const o = Math.floor(rnd() * 3);
    for (const s of [-1, 1]) {
      const f = group('flag');
      f.add(at(cyl(k, 0.018, 0.018, 0.72, 'post', 0, 5), 0, 0.36, 0));
      f.add(at(box(k, 0.34, 0.2, 0.02, 'lmBanner', (o + (s > 0 ? 1 : 0)) % 3), 0.18, 0.6, 0));
      g.add(k.detail(at(f, s * (w / 2 - 0.12), h, 0.08)));
    }
  } else {
    g.add(k.detail(at(box(k, w + 0.06, 0.06, d + 0.06, 'lmStone'), 0, h - 0.02, 0.08)));
    g.add(at(box(k, 0.9, 0.2, 0.04, 'paper'), 0, h - 0.24, front + 0.02));
  }
  return g;
}

export function buildStadium(k: Kit, _params: AssetParams): THREE.Object3D {
  const root = group('stadium');
  const rnd = () => k.rand();
  // ---- bowl ----
  root.add(loft(k, FACADE, 'stadium'));
  root.add(loft(k, PARAPET, 'stadium'));
  root.add(loft(k, [[-0.012, 1.36], [-0.012, 1.47]], 'lmBanner', 0));
  root.add(loft(k, TIER_UPPER, 'seats', 0, 'tier'));
  root.add(loft(k, AISLE, 'stadium'));
  root.add(loft(k, TIER_MID, 'seats', 1, 'tier'));
  root.add(loft(k, TIER_LOW, 'seats', 0, 'tier'));
  root.add(loft(k, FIELD_WALL, 'lmEndzone'));
  pitch(k, root);

  // ---- gates (front + both ends) ----
  const gates: Array<[number, number, number]> = [[0, STADIUM_BOWL.b, 0], [STADIUM_BOWL.a, 0, Math.PI / 2], [-STADIUM_BOWL.a, 0, -Math.PI / 2]];
  gates.forEach(([x, z, yaw], i) => { const g = gate(k, i === 0, rnd); g.rotation.y = yaw; root.add(at(g, x, 0, z)); });
  const nearGate = (x: number, z: number, r: number) => gates.some(([gx, gz]) => Math.hypot(x - gx, z - gz) < r);

  // ---- facade: concourse arches, banners; rim pennants ----
  const outer = rrAt(STADIUM_BOWL, -0.01);
  const nArch = 28, start = 0.5 / nArch, offset = rnd() < 0.5 ? 0 : 1;
  for (let i = 0; i < nArch; i++) {
    const p = perimeterAt(outer, start + i / nArch);
    if (nearGate(p.x, p.z, 1.45)) continue;
    const a = group('arch');
    a.add(at(box(k, 0.3, 0.3, 0.03, 'window'), 0, 0.27, 0.01));
    a.add(at(disc(k, 0.15, 0.03, 'window', 0, 8), 0, 0.42, 0.01));
    a.rotation.y = yawOf(p.nx, p.nz);
    root.add(at(a, p.x, 0, p.z));
    if (i % 2 === 1) continue;
    const b = group('banner');
    b.add(at(box(k, 0.3, 0.5, 0.025, 'lmBanner', (i / 2 + offset) % 3), 0, 0.98, 0.02));
    b.add(at(box(k, 0.3, 0.06, 0.03, 'paper'), 0, 0.76, 0.025));
    b.add(at(box(k, 0.38, 0.03, 0.04, 'rail'), 0, 1.24, 0.025));
    b.rotation.y = yawOf(p.nx, p.nz);
    root.add(k.detail(at(b, p.x, 0, p.z)));
  }
  const rim = rrAt(STADIUM_BOWL, 0.1);
  const nFlag = 12;
  for (let i = 0; i < nFlag; i++) {
    const p = perimeterAt(rim, (i + 0.5) / nFlag);
    if (p.z < -2.6 && Math.abs(p.x) < 2.1) continue; // press box
    if (p.x < -3.5 && Math.abs(p.z) < 1.4) continue; // scoreboard
    const f = group('flag');
    f.add(at(cyl(k, 0.016, 0.016, 0.56, 'post', 0, 5), 0, 0.28, 0));
    f.add(at(box(k, 0.26, 0.16, 0.02, 'lmBanner', (i + offset) % 3), 0.13, 0.47, 0));
    f.rotation.y = yawOf(p.nx, p.nz) + Math.PI / 2;
    root.add(k.detail(at(f, p.x, RIM_Y, p.z)));
  }
  void perimeterLength;

  // ---- press box (back stand), scoreboard (-x end) ----
  root.add(at(pressBox(k), 0, 0, -STADIUM_BOWL.b + 0.47));
  root.add(at(scoreboard(k), -STADIUM_BOWL.a + 0.12, 0, 0));

  // ---- light towers in the four corner gaps ----
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) root.add(lightTower(k, sx * 4.74, sz * 3.5));
  return root;
}
