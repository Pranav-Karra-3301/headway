// Owner: A2. cp.science: modern science building. A white two-storey volume with vertical fins and ribbon windows
// floats over a recessed glass band; a brick stair core ties it to the Georgian campus; rooftop observatory dome
// and solar panels. 6 × 4 footprint, about 3.6 tall (observatory ≈ 4.2), front toward +z.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { at, bays, box, dome, door, mats, meridian, onFace, panel, type Block } from './parts';
import { pick } from './pick';

const GLASS_H = 1.2, TOP = 3.4;

export function buildScience(k: KitContext, p: AssetParams): THREE.Group {
  const x = mats(k, pick(p.brick, 3, k), 0, pick(p.door, 3, k));
  const white = k.mat('cpPanel'), glass = k.mat('cpGlass'), solar = k.mat('cpSolar'), metal = k.mat('cpMetal');
  const g = new THREE.Group();
  const upper: Block = { cx: -0.4, cz: -0.02, w: 5.2, d: 3.76 };
  const band: Block = { cx: -0.35, cz: -0.02, w: 4.9, d: 3.24 };
  const core: Block = { cx: 2.58, cz: -0.62, w: 0.84, d: 2.2 };

  // Glass band with white mullions; pilotis under the overhang.
  g.add(at(box(k, band.w, GLASS_H, band.d, glass), band.cx, GLASS_H / 2, band.cz));
  g.add(at(box(k, band.w + 0.06, 0.06, band.d + 0.06, white), band.cx, 0.03, band.cz));
  for (const f of ['front', 'back'] as const) for (const u of bays(8, band.w - 0.3)) {
    if (f === 'front' && Math.abs(u + 0.0) < 0.6) continue;
    g.add(onFace(panel(k, 0.05, GLASS_H, white), band, f, u, GLASS_H / 2, 0.01));
  }
  for (const f of ['left'] as const) for (const u of bays(5, band.d - 0.3)) g.add(onFace(panel(k, 0.05, GLASS_H, white), band, f, u, GLASS_H / 2, 0.01));
  for (const sz of [-1, 1]) g.add(k.detail(at(k.cyl(0.06, 0.06, GLASS_H, white, 8), upper.cx - upper.w / 2 + 0.16, GLASS_H / 2, upper.cz + sz * (upper.d / 2 - 0.16))));
  g.add(onFace(door(k, x, { w: 0.9, h: 1.0, double: true, fanlight: false, surround: 'plain', step: true }), band, 'front', 0, 0));

  // Floating white volume: ribbon windows between vertical fins.
  g.add(at(k.rbox(upper.w, TOP - GLASS_H, upper.d, 0.08, white), upper.cx, GLASS_H + (TOP - GLASS_H) / 2, upper.cz));
  g.add(at(box(k, upper.w + 0.04, 0.1, upper.d + 0.04, white), upper.cx, TOP + 0.05, upper.cz));
  const floors = [GLASS_H + 0.55, GLASS_H + 1.6], fins = bays(7, upper.w - 0.3), seg = fins[1]! - fins[0]!;
  for (const f of ['front', 'back'] as const) {
    for (const u of fins) g.add(onFace(box(k, 0.06, TOP - GLASS_H - 0.14, 0.16, white), upper, f, u, GLASS_H + (TOP - GLASS_H) / 2, 0.08));
    for (const y of floors) for (let i = 0; i + 1 < fins.length; i++) {
      g.add(k.detail(onFace(panel(k, seg - 0.14, 0.52, k.rand() < 0.45 ? x.lit : x.dark), upper, f, (fins[i]! + fins[i + 1]!) / 2, y, 0.012)));
    }
  }
  for (const y of floors) {
    for (const u of [-1.15, 0, 1.15]) g.add(k.detail(onFace(panel(k, 1.0, 0.52, k.rand() < 0.45 ? x.lit : x.dark), upper, 'left', u, y, 0.012)));
    g.add(k.detail(onFace(panel(k, 1.0, 0.52, k.rand() < 0.45 ? x.lit : x.dark), upper, 'right', -1.25, y, 0.012)));
  }

  // Brick stair core with tall glazed slots, set back at one end and rising above the roof.
  const coreH = TOP + 0.3, slotH = coreH - 0.9, slotY = 0.5 + slotH / 2;
  g.add(at(k.rbox(core.w, coreH, core.d, 0.06, x.brick), core.cx, coreH / 2, core.cz));
  g.add(at(box(k, core.w + 0.08, 0.08, core.d + 0.08, x.stone), core.cx, coreH + 0.03, core.cz));
  for (const [f, u, w] of [['front', 0, 0.36], ['right', 0.45, 0.36], ['right', -0.45, 0.36], ['back', 0, 0.3]] as const) {
    g.add(k.detail(onFace(panel(k, w + 0.1, slotH + 0.1, x.stone), core, f, u, slotY, 0.008)));
    g.add(k.detail(onFace(panel(k, w, slotH, f === 'front' ? x.lit : x.dark), core, f, u, slotY, 0.014)));
  }

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
  g.add(k.detail(at(meridian(k, dr, 0.075, Math.PI * 0.6, x.dark), ox, TOP + 0.36, oz))); // shutter slit
  return g;
}
