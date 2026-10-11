// Owner: A6 street. Plaza pieces: fountain, kiosk, flag. Front faces +z; base at y = 0.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { variants } from './roles';
import { at, bar, box, disc, extrude, group, lathe, pick, rotX } from './prims';

/** Two-tier stone fountain: round basin brimming with water, a lathed pedestal bowl, a small top bowl and a jet. */
export function buildFountain(k: KitContext, _p: AssetParams): THREE.Object3D {
  const stone = k.mat('stStone'), water = k.mat('stWater'), foam = k.mat('stFoam');
  const g = group('st.fountain');
  g.add(lathe(k, 'basin', [[1.17, 0], [1.22, 0.27], [1.16, 0.35], [1.06, 0.34], [1.03, 0.29]], 24, stone));
  g.add(at(disc(k, 1.04, 24, water), 0, 0.3, 0));
  g.add(lathe(k, 'tier1', [[0.25, 0.29], [0.12, 0.4], [0.1, 0.56], [0.2, 0.66], [0.5, 0.74], [0.54, 0.79], [0.47, 0.79]], 14, stone));
  g.add(at(disc(k, 0.48, 14, water), 0, 0.775, 0));
  g.add(lathe(k, 'tier2', [[0.08, 0.77], [0.05, 0.9], [0.09, 0.97], [0.23, 1.03], [0.2, 1.04]], 10, stone));
  g.add(at(disc(k, 0.205, 10, water), 0, 1.03, 0));
  g.add(at(k.cyl(0.014, 0.034, 0.14, foam, 6), 0, 1.1, 0));
  const drop = k.sphere(0.05, foam, 5); drop.scale.set(1, 1.25, 1);
  g.add(k.detail(at(drop, 0, 1.19, 0)));
  return g;
}

const KIOSK = [
  { body: 0, roof: 0, awning: 2 },
  { body: 1, roof: 1, awning: 2 },
  { body: 2, roof: 2, awning: 0 },
] as const;

/** Coffee + news kiosk: rounded booth, service window with counter and striped awning (+z), pyramid roof
 *  in a contrasting colour crowned by a giant coffee cup. params.color picks one of three colourways. */
export function buildKiosk(k: KitContext, p: AssetParams): THREE.Object3D {
  const v = KIOSK[pick(k, p, KIOSK.length)]!;
  const body = k.mat('stKiosk', v.body), paint = k.mat('stPaint'), wood = k.mat('bench'), glass = k.mat('glass');
  const cloth = k.mat('awning', v.awning), stripe = k.mat('stripe');
  const g = group('st.kiosk');
  g.add(at(k.rbox(0.94, 1.02, 0.84, 0.08, body), 0, 0.51, 0));
  g.add(at(box(k, 0.62, 0.4, 0.02, glass), 0, 0.75, 0.422));
  g.add(at(box(k, 0.72, 0.045, 0.16, wood), 0, 0.535, 0.48));
  // striped awning tilted down toward the customer
  const slats = 5, sw = 0.76 / slats;
  for (let i = 0; i < slats; i++) g.add(at(rotX(box(k, sw, 0.022, 0.24, i % 2 ? stripe : cloth), 0.42), -0.38 + sw * (i + 0.5), 0.98, 0.52));
  g.add(at(box(k, 1.04, 0.07, 0.94, paint), 0, 1.055, 0));
  const roof = k.cone(0.73, 0.34, k.mat('awning', v.roof), 4); roof.rotation.y = Math.PI / 4;
  g.add(at(roof, 0, 1.26, 0));
  // giant coffee cup on the apex: white cup, coffee top, handle
  g.add(at(k.cyl(0.12, 0.085, 0.17, paint, 12), 0, 1.47, 0));
  g.add(k.detail(at(disc(k, 0.105, 10, wood), 0, 1.557, 0)));
  g.add(k.detail(at(box(k, 0.035, 0.1, 0.035, paint), 0.135, 1.48, 0)));
  // side window + newspaper stand (+x)
  g.add(k.detail(at(box(k, 0.02, 0.3, 0.4, glass), 0.472, 0.78, -0.05)));
  g.add(k.detail(at(box(k, 0.08, 0.28, 0.42, wood), 0.52, 0.3, 0.05)));
  for (let i = 0; i < 2; i++) g.add(k.detail(at(box(k, 0.03, 0.1, 0.13, i ? paint : k.mat('awning', v.awning)), 0.555, 0.39, -0.03 + i * 0.16)));
  return g;
}

/** Banner flag: slim pole with a brass ball and a swallowtail banner hung from a crossbar in front of the pole
 *  (+z), wide enough to read from any rotation while staying on its 0.3 × 0.3 footprint. params.color picks it. */
export function buildFlag(k: KitContext, p: AssetParams): THREE.Object3D {
  const c = pick(k, p, variants('stFlag'));
  const pole = k.mat('stPole'), cloth = k.mat('stFlag', c), brass = k.mat('stBrass');
  const g = group('st.flag');
  g.add(at(k.cyl(0.085, 0.11, 0.09, k.mat('stStone'), 8), 0, 0.045, 0));
  g.add(at(k.cyl(0.024, 0.032, 2.64, pole, 8), 0, 1.41, 0));
  g.add(at(k.sphere(0.045, brass, 8), 0, 2.76, 0));
  g.add(bar(k, [-0.14, 2.58, 0.035], [0.14, 2.58, 0.035], 0.013, pole, 5));
  for (const x of [-0.14, 0.14]) g.add(k.detail(at(k.sphere(0.022, brass, 5), x, 2.58, 0.035)));
  const W = 0.29, H = 0.9, notch = 0.15;
  g.add(at(extrude(k, `banner:${W}:${H}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, -H); s.lineTo(0, -H + notch); s.lineTo(-W / 2, -H); s.lineTo(-W / 2, 0);
    return s;
  }, 0.016, cloth), 0, 2.57, 0.04));
  g.add(k.detail(at(box(k, W, 0.05, 0.022, k.mat('stPaint')), 0, 2.57 - 0.14, 0.04)));
  g.add(k.detail(at(rotX(k.cyl(0.06, 0.06, 0.024, k.mat('stPaint'), 12), Math.PI / 2), 0, 2.57 - 0.42, 0.04)));
  return g;
}
