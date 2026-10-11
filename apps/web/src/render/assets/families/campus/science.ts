// Owner: A2. cp.science: modern science building. A white two-storey volume with vertical fins and ribbon windows
// floats over a recessed glass band; a brick stair core ties it to the Georgian campus; rooftop observatory dome
// and solar panels. 6 × 4 footprint, about 3.6 tall (observatory ≈ 4.2), front toward +z.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { at, bays, box, dome, door, mats, onFace, panel, type Block } from './parts';
import { pick } from './pick';

const GLASS_H = 1.2, TOP = 3.4;

export function buildScience(k: KitContext, p: AssetParams): THREE.Group {
  const x = mats(k, pick(p.brick, 3, k), 0, pick(p.door, 3, k));
  const white = k.mat('cpPanel'), glass = k.mat('cpGlass'), solar = k.mat('cpSolar'), metal = k.mat('cpMetal');
  const g = new THREE.Group();
  const upper: Block = { cx: -0.5, cz: -0.02, w: 5.0, d: 3.76 };
  const band: Block = { cx: -0.4, cz: -0.02, w: 4.8, d: 3.24 };
  const core: Block = { cx: 2.47, cz: 0, w: 0.95, d: 2.6 };

  // Glass band with white mullions; pilotis under the overhang.
  g.add(at(box(k, band.w, GLASS_H, band.d, glass), band.cx, GLASS_H / 2, band.cz));
  g.add(at(box(k, band.w + 0.06, 0.06, band.d + 0.06, white), band.cx, 0.03, band.cz));
  for (const f of ['front', 'back'] as const) for (const u of bays(8, band.w - 0.3)) {
    if (f === 'front' && Math.abs(u + 0.0) < 0.6) continue;
    g.add(onFace(at(panel(k, 0.05, GLASS_H, white), 0, 0, 0.01), band, f, u, GLASS_H / 2));
  }
  for (const f of ['left'] as const) for (const u of bays(5, band.d - 0.3)) g.add(onFace(at(panel(k, 0.05, GLASS_H, white), 0, 0, 0.01), band, f, u, GLASS_H / 2));
  for (const sz of [-1, 1]) g.add(k.detail(at(k.cyl(0.06, 0.06, GLASS_H, white, 8), upper.cx - upper.w / 2 + 0.16, GLASS_H / 2, upper.cz + sz * (upper.d / 2 - 0.16))));
  g.add(onFace(door(k, x, { w: 0.9, h: 1.0, double: true, fanlight: false, surround: 'plain', step: true }), band, 'front', 0, 0));

  // Floating white volume: ribbon windows between vertical fins.
  g.add(at(k.rbox(upper.w, TOP - GLASS_H, upper.d, 0.08, white), upper.cx, GLASS_H + (TOP - GLASS_H) / 2, upper.cz));
  g.add(at(box(k, upper.w + 0.04, 0.1, upper.d + 0.04, white), upper.cx, TOP + 0.05, upper.cz));
  const floors = [GLASS_H + 0.55, GLASS_H + 1.6], fins = bays(7, upper.w - 0.3), seg = fins[1]! - fins[0]!;
  for (const f of ['front', 'back'] as const) {
    for (const u of fins) g.add(onFace(at(box(k, 0.06, TOP - GLASS_H - 0.14, 0.16, white), 0, 0, 0.08), upper, f, u, GLASS_H + (TOP - GLASS_H) / 2));
    for (const y of floors) for (let i = 0; i + 1 < fins.length; i++) {
      g.add(k.detail(onFace(at(panel(k, seg - 0.14, 0.52, k.rand() < 0.45 ? x.lit : x.dark), 0, 0, 0.012), upper, f, (fins[i]! + fins[i + 1]!) / 2, y)));
    }
  }
  for (const y of floors) for (const u of [-1.15, 0, 1.15]) {
    g.add(k.detail(onFace(at(panel(k, 1.0, 0.52, k.rand() < 0.45 ? x.lit : x.dark), 0, 0, 0.012), upper, 'left', u, y)));
  }

  // Brick stair core with a tall slot window, rising above the roof.
  const coreH = TOP + 0.45;
  g.add(at(k.rbox(core.w, coreH, core.d, 0.06, x.brick), core.cx, coreH / 2, core.cz));
  g.add(at(box(k, core.w + 0.08, 0.08, core.d + 0.08, x.stone), core.cx, coreH + 0.03, core.cz));
  g.add(k.detail(onFace(at(panel(k, 0.3, coreH - 1.0, x.lit), 0, 0, 0.012), core, 'front', 0, 0.55 + (coreH - 1.0) / 2)));
  g.add(k.detail(onFace(at(panel(k, 0.3, coreH - 1.0, x.dark), 0, 0, 0.012), core, 'right', 0.5, 0.55 + (coreH - 1.0) / 2)));
  g.add(k.detail(onFace(at(panel(k, 0.3, coreH - 1.0, x.dark), 0, 0, 0.012), core, 'back', 0, 0.55 + (coreH - 1.0) / 2)));

  // Roof: solar panels and an observatory.
  for (const [sx, sz] of [[-0.1, -0.85], [0.95, -0.85], [-0.1, 0.25], [0.95, 0.25]] as const) {
    const pnl = box(k, 0.9, 0.04, 0.6, solar);
    pnl.rotation.x = 0.4;
    g.add(k.detail(at(pnl, sx, TOP + 0.26, sz)));
    g.add(k.detail(at(box(k, 0.06, 0.2, 0.06, metal), sx, TOP + 0.15, sz - 0.18)));
  }
  const ox = -1.75, oz = -0.25, dr = 0.55;
  g.add(at(k.cyl(dr, dr + 0.03, 0.26, white, 16), ox, TOP + 0.1 + 0.13, oz));
  g.add(at(dome(k, dr, x.trim, 16, 5), ox, TOP + 0.36, oz));
  const slit = box(k, 0.16, 0.05, dr * 1.25, x.dark);
  slit.rotation.x = -0.72;
  g.add(k.detail(at(slit, ox, TOP + 0.36 + dr * 0.62, oz + dr * 0.5)));
  return g;
}
