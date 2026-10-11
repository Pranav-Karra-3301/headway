// Owner: A2. cp.union: student union. Brick block with a stone entrance pavilion and a great arched window, banners,
// a broad terrace with wide steps, café umbrellas and a flagpole. 6 × 5 footprint, about 3.4 tall (flag ≈ 3.6),
// front toward +z.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { archPanel, at, band, bays, box, door, flagpole, hipRoof, mats, onFace, panel, pediment, sashRow, triPanel, type Block, type Mats } from './parts';
import { pick } from './pick';

const BASE = 0.3, G1 = 1.2, G2 = 1.1, EAVE = BASE + G1 + G2;

export function buildUnion(k: KitContext, p: AssetParams): THREE.Group {
  const x = mats(k, pick(p.brick, 3, k), pick(p.roof, 3, k), pick(p.door, 3, k));
  const bi = pick(p.banner, 3, k), banner = k.mat('cpBanner', (bi + 1) % 3), flagM = k.mat('cpBanner', bi);
  const g = new THREE.Group();
  const body: Block = { cx: 0, cz: -0.66, w: 5.6, d: 3.3 };
  const front = body.cz + body.d / 2;
  const pav: Block = { cx: 0, cz: front + 0.15, w: 2.3, d: 0.3 };

  g.add(at(k.rbox(body.w + 0.12, BASE, body.d + 0.12, 0.05, x.stone), 0, BASE / 2, body.cz));
  g.add(at(k.rbox(body.w, EAVE - BASE + 0.03, body.d, 0.08, x.brick), 0, BASE - 0.015 + (EAVE - BASE + 0.03) / 2, body.cz));
  g.add(k.detail(band(k, body, BASE + G1, 0.07, 0.025, x.stone)));
  g.add(band(k, body, EAVE + 0.05, 0.15, 0.08, x.trim));
  g.add(at(hipRoof(k, body.w + 0.3, body.d + 0.3, 0.52, x.roof), 0, EAVE + 0.12, body.cz));

  // Terrace and wide steps.
  const tz0 = front, td = 0.95;
  g.add(at(box(k, 5.1, BASE, td, x.stone), 0, BASE / 2, tz0 + td / 2));
  for (let i = 0; i < 2; i++) {
    const sh = BASE * (1 - (i + 1) / 3);
    g.add(at(box(k, 4.7 - i * 0.2, sh, 0.2, x.stone), 0, sh / 2, tz0 + td + 0.1 + i * 0.2));
  }

  // Stone pavilion with a pediment and a great round-headed window over the doors.
  const pavH = EAVE + 0.17 - BASE;
  g.add(at(box(k, pav.w, pavH, pav.d + 0.02, x.stone), pav.cx, BASE + pavH / 2, pav.cz - 0.01));
  g.add(at(box(k, pav.w + 0.12, 0.14, pav.d + 0.14, x.trim), 0, EAVE + 0.1, pav.cz));
  // Cross-gable roof from the pavilion back into the main roof, fronted by a white raking cornice.
  g.add(at(pediment(k, pav.w + 0.06, 0.48, 2.1, x.roof), 0, EAVE + 0.17, pav.cz + pav.d / 2 - 0.14 - 1.05));
  g.add(at(pediment(k, pav.w + 0.16, 0.52, 0.16, x.trim), 0, EAVE + 0.17, pav.cz + pav.d / 2 - 0.06));
  g.add(k.detail(at(triPanel(k, pav.w - 0.3, 0.34, x.stone), 0, EAVE + 0.23, pav.cz + pav.d / 2 + 0.025)));
  g.add(onFace(greatWindow(k, x, 1.25, 1.95), pav, 'front', 0, BASE + 0.16 + 1.95 / 2));
  g.add(onFace(door(k, x, { w: 0.9, h: 0.98, double: true, fanlight: false, surround: 'plain', step: false }), pav, 'front', 0, BASE));
  for (const s of [-1, 1]) g.add(k.detail(onFace(box(k, 0.14, pavH - 0.1, 0.06, x.trim), pav, 'front', s * (pav.w / 2 - 0.12), BASE + (pavH - 0.1) / 2, 0.03)));

  // Banners either side of the pavilion.
  for (const s of [-1, 1]) {
    const b = new THREE.Group();
    b.add(at(box(k, 0.05, 0.05, 0.22, x.trim), 0, 0, 0.11));
    b.add(at(box(k, 0.34, 1.05, 0.03, banner), 0, -0.55, 0.2));
    b.add(at(box(k, 0.18, 0.18, 0.035, x.trim), 0, -0.42, 0.22));
    g.add(onFace(b, body, 'front', s * 1.33, EAVE - 0.16));
  }

  // Windows.
  const yA = BASE + 0.6, yB = BASE + G1 + 0.5;
  for (const y of [yA, yB]) {
    sashRow(g, k, x, body, 'front', [-2.47, -1.95, 1.95, 2.47], y, 0.37, y === yA ? 0.78 : 0.7, { lintel: true });
    sashRow(g, k, x, body, 'back', bays(5, 4.6), y, 0.46, y === yA ? 0.78 : 0.7);
    for (const f of ['left', 'right'] as const) sashRow(g, k, x, body, f, [-1.0, 0, 1.0], y, 0.46, y === yA ? 0.78 : 0.7);
  }

  // Flagpole on the terrace corner; café umbrellas on the other side.
  g.add(at(flagpole(k, x, 3.3, flagM), 2.3, BASE, tz0 + td - 0.22));
  for (const [ux, i] of [[-2.15, 0], [-1.45, 1]] as const) g.add(k.detail(at(umbrella(k, x, k.mat('cpBanner', i + 1)), ux, BASE, tz0 + td / 2 + 0.05)));
  return g;
}

/** Tall arched window with a white glazing grid, centred on the origin, facing +z. */
function greatWindow(k: KitContext, x: Mats, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(archPanel(k, w + 0.14, h + 0.14, x.trim, 8), 0, 0, 0.012));
  g.add(at(archPanel(k, w, h, k.rand() < 0.5 ? x.lit : x.dark, 8), 0, 0, 0.022));
  for (const u of [-w / 4, w / 4]) g.add(k.detail(at(panel(k, 0.035, h - w / 2 + w * 0.42, x.trim), u, -w * 0.08, 0.03)));
  for (const y of [-h * 0.12, h / 2 - w / 2]) g.add(k.detail(at(panel(k, w, 0.04, x.trim), 0, y, 0.03)));
  g.add(at(panel(k, 0.04, h * 0.98, x.trim), 0, 0, 0.03));
  return g;
}

/** Café table with an umbrella, base at y = 0. */
function umbrella(k: KitContext, x: Mats, m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(at(k.cyl(0.18, 0.18, 0.04, x.trim, 10), 0, 0.36, 0));
  g.add(at(k.cyl(0.025, 0.025, 1.0, x.trim, 6), 0, 0.5, 0));
  g.add(at(k.cone(0.42, 0.24, m, 8), 0, 1.06, 0));
  for (const s of [-1, 1]) g.add(at(box(k, 0.14, 0.2, 0.14, m), s * 0.3, 0.1, 0));
  return g;
}
