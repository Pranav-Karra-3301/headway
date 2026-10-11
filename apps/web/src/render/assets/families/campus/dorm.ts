// Owner: A2. cp.dorm: four-storey collegiate dorm. Limestone ground floor, three brick storeys, central entrance bay
// rising to a pediment over the parapet, flat roof with a stair hut. Student touches: curtains, a pennant, window
// boxes. 6 × 3.5 footprint, about 4.6 tall (pediment ≈ 5.1), front toward +z.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { at, band, box, bays, door, flatRoof, mats, onFace, panel, pediment, roundel, sash, topiary, triPanel, type Block, type Face, type Mats } from './parts';
import { pick } from './pick';

const BASE = 0.26, F1 = 1.14, F = 1.04, TOP = BASE + F1 + 3 * F; // 4.52

export function buildDorm(k: KitContext, p: AssetParams): THREE.Group {
  const x = mats(k, pick(p.brick, 3, k), pick(p.roof, 3, k), pick(p.door, 3, k));
  const g = new THREE.Group();
  const body: Block = { cx: 0, cz: -0.17, w: 5.7, d: 3.0 };
  const bay: Block = { cx: 0, cz: body.cz + body.d / 2 + 0.07, w: 1.5, d: 0.14 };

  g.add(at(k.rbox(body.w + 0.12, BASE, body.d + 0.12, 0.05, x.stone), 0, BASE / 2, body.cz));
  g.add(at(k.rbox(body.w, TOP - BASE + 0.03, body.d, 0.08, x.brick), 0, BASE - 0.015 + (TOP - BASE + 0.03) / 2, body.cz));
  g.add(at(box(k, body.w + 0.05, F1, body.d + 0.05, x.stone), 0, BASE + F1 / 2, body.cz)); // limestone ground floor
  g.add(band(k, body, BASE + F1 + 0.04, 0.1, 0.05, x.stone));
  g.add(k.detail(band(k, body, BASE + F1 + F + 0.02, 0.05, 0.02, x.stone)));
  g.add(k.detail(band(k, body, BASE + F1 + 2 * F + 0.02, 0.05, 0.02, x.stone)));
  g.add(band(k, body, TOP + 0.05, 0.14, 0.07, x.trim));
  // Flat roof deck framed by a brick parapet with stone coping.
  g.add(flatRoof(k, x, body, TOP + 0.12, 0.26, x.brick, x.roof));

  // Entrance bay: slightly proud, full height, pediment above the parapet.
  g.add(at(box(k, bay.w, TOP - BASE - F1, bay.d + 0.02, x.brick), bay.cx, BASE + F1 + (TOP - BASE - F1) / 2, bay.cz - 0.01));
  g.add(at(box(k, bay.w + 0.06, F1, bay.d + 0.06, x.stone), bay.cx, BASE + F1 / 2, bay.cz));
  g.add(at(pediment(k, bay.w + 0.2, 0.5, 0.5, x.trim), 0, TOP + 0.12, bay.cz - 0.18));
  g.add(k.detail(at(triPanel(k, bay.w - 0.2, 0.34, x.stone), 0, TOP + 0.18, bay.cz + 0.075)));
  g.add(k.detail(at(roundel(k, x, 0.12), 0, TOP + 0.33, bay.cz + 0.08)));
  g.add(onFace(door(k, x, { w: 0.72, h: 1.02, double: true, surround: 'pediment', step: true }), body, 'front', 0, 0, 0.14));
  for (const s of [-1, 1]) g.add(onFace(topiary(k, x), body, 'front', s * 0.98, 0, 0.3));

  // Windows: five bays front/back, two per side, four storeys.
  const ys = [BASE + 0.58, BASE + F1 + 0.5, BASE + F1 + F + 0.5, BASE + F1 + 2 * F + 0.5];
  const front = [-2.3, -1.2, 0, 1.2, 2.3], back = bays(5, 4.6);
  ys.forEach((y, i) => {
    const out = i === 0 ? 0.026 : 0; // ground floor windows sit on the limestone cladding
    for (const u of front) if (!(i === 0 && u === 0)) g.add(onFace(dormWindow(k, x, i === 0, u === 0), body, 'front', u, y, u === 0 ? 0.14 : out));
    for (const u of back) g.add(onFace(dormWindow(k, x, i === 0, false), body, 'back', u, y, out));
    for (const f of ['left', 'right'] as Face[]) for (const u of [-0.65, 0.65]) g.add(onFace(dormWindow(k, x, i === 0, false), body, f, u, y, out));
  });

  // Roof: stair hut + vents.
  g.add(at(box(k, 0.95, 0.5, 0.85, x.brick), 1.6, TOP + 0.4, body.cz - 0.5));
  g.add(at(box(k, 1.05, 0.07, 0.95, x.stone), 1.6, TOP + 0.68, body.cz - 0.5));
  for (const vx of [-1.4, -0.9]) g.add(k.detail(at(k.cyl(0.08, 0.08, 0.28, k.mat('cpMetal'), 8), vx, TOP + 0.38, body.cz - 0.6)));
  return g;
}

/** Dorm sash window with student touches: curtains, the odd window box or pennant. */
function dormWindow(k: KitContext, x: Mats, ground: boolean, centre: boolean): THREE.Group {
  const w = ground ? 0.52 : 0.5, h = ground ? 0.74 : 0.7;
  const g = sash(k, x, w, h, { lintel: ground || centre });
  const r = k.rand();
  if (!ground && r < 0.28) {
    const c = k.mat('cpCurtain', Math.floor(k.rand() * 4));
    for (const s of [-1, 1]) g.add(at(panel(k, w * 0.22, h * 0.92, c), s * w * 0.37, 0, 0.026));
  } else if (!ground && r < 0.36) {
    g.add(at(box(k, w + 0.12, 0.12, 0.14, x.brick), 0, -h / 2 - 0.15, 0.09));
    g.add(at(box(k, w + 0.06, 0.08, 0.1, k.mat('leaf', 1)), 0, -h / 2 - 0.05, 0.09));
    for (const s of [-0.3, 0, 0.3]) g.add(at(box(k, 0.07, 0.07, 0.07, k.mat('cpCurtain', Math.floor(k.rand() * 4))), s * w, -h / 2 + 0.0, 0.11));
  } else if (!ground && r < 0.4) {
    const pen = box(k, 0.36, 0.13, 0.02, k.mat('cpBanner', Math.floor(k.rand() * 3)));
    pen.rotation.z = -0.25;
    g.add(at(pen, 0, h * 0.18, 0.04));
  }
  return g;
}
