// Owner: A6 street. Plaza pieces: fountain, kiosk, flag. Front faces +z; base at y = 0.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { variants } from './roles';
import { at, bar, box, cached, extrude, group, lathe, pick, rotX, shaped } from './prims';

/** Water surface: an upward disc (only the top is ever seen, so no sides or underside). */
function pool(k: KitContext, r: number, seg: number, m: THREE.Material): THREE.Mesh {
  return shaped(k, cached(`pool:${r}:${seg}`, () => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2)), m);
}

/** Round stone basin brimming with water, a lathed pedestal bowl with a falling-water bell and a little jet. */
export function buildFountain(k: KitContext, _p: AssetParams): THREE.Object3D {
  const stone = k.mat('stStone'), water = k.mat('stWater'), foam = k.mat('stFoam');
  const g = group('st.fountain');
  g.add(lathe(k, 'basin', [[1.17, 0], [1.22, 0.27], [1.16, 0.35], [1.06, 0.34], [1.03, 0.29]], 24, stone));
  g.add(at(pool(k, 1.04, 24, water), 0, 0.3, 0));
  g.add(lathe(k, 'pedestal', [[0.21, 0.29], [0.12, 0.47], [0.13, 0.68], [0.36, 0.78], [0.5, 0.86], [0.48, 0.9], [0.44, 0.88]], 12, stone));
  g.add(k.detail(at(k.cyl(0.445, 0.6, 0.5, foam, 12), 0, 0.56, 0)));
  g.add(at(pool(k, 0.45, 12, water), 0, 0.885, 0));
  g.add(at(k.cyl(0.05, 0.07, 0.1, stone, 6), 0, 0.93, 0));
  g.add(at(k.cyl(0.012, 0.035, 0.22, foam, 6), 0, 1.07, 0));
  const drop = k.sphere(0.055, foam, 6); drop.scale.set(1, 1.2, 1);
  g.add(k.detail(at(drop, 0, 1.19, 0)));
  return g;
}

/** Coffee + news kiosk: rounded booth, service window with counter and striped awning (+z), pyramid roof, cup sign. */
export function buildKiosk(k: KitContext, p: AssetParams): THREE.Object3D {
  const c = pick(k, p, variants('stKiosk'));
  const body = k.mat('stKiosk', c), paint = k.mat('stPaint'), wood = k.mat('bench'), glass = k.mat('glass');
  const cloth = k.mat('awning', (c + 2) % 3), stripe = k.mat('stripe');
  const g = group('st.kiosk');
  g.add(at(k.rbox(0.94, 1.06, 0.84, 0.08, body), 0, 0.53, 0));
  g.add(at(box(k, 0.62, 0.4, 0.02, glass), 0, 0.77, 0.422));
  g.add(at(box(k, 0.72, 0.045, 0.16, wood), 0, 0.555, 0.48));
  // striped awning: 6 slats tilted down toward the customer
  const slats = 6, sw = 0.76 / slats;
  for (let i = 0; i < slats; i++) g.add(at(rotX(box(k, sw, 0.022, 0.24, i % 2 ? stripe : cloth), 0.42), -0.38 + sw * (i + 0.5), 1.0, 0.52));
  g.add(at(box(k, 1.04, 0.07, 0.94, paint), 0, 1.095, 0));
  const roof = k.cone(0.72, 0.26, body, 4); roof.rotation.y = Math.PI / 4;
  g.add(at(roof, 0, 1.26, 0));
  // round sign: white disc with a coffee-brown cup disc, on a short post
  g.add(at(k.cyl(0.02, 0.02, 0.14, k.mat('post'), 5), 0, 1.4, 0));
  g.add(at(rotX(k.cyl(0.15, 0.15, 0.035, paint, 12), Math.PI / 2), 0, 1.45, 0));
  g.add(k.detail(at(rotX(k.cyl(0.085, 0.085, 0.045, wood, 8), Math.PI / 2), 0, 1.45, 0)));
  // side window + newspaper stand (+x)
  g.add(k.detail(at(box(k, 0.02, 0.3, 0.4, glass), 0.472, 0.8, -0.05)));
  g.add(k.detail(at(box(k, 0.08, 0.28, 0.42, wood), 0.52, 0.3, 0.05)));
  for (let i = 0; i < 2; i++) g.add(k.detail(at(box(k, 0.03, 0.1, 0.13, k.mat('awning', i)), 0.555, 0.39, -0.03 + i * 0.16)));
  return g;
}

/** Banner flag: white pole with a brass ball, a cloth banner hanging from a yardarm (+x) with a swallowtail. */
export function buildFlag(k: KitContext, p: AssetParams): THREE.Object3D {
  const c = pick(k, p, variants('stFlag'));
  const pole = k.mat('stPole'), cloth = k.mat('stFlag', c);
  const g = group('st.flag');
  const px = -0.07;
  g.add(at(k.cyl(0.07, 0.09, 0.08, k.mat('stStone'), 8), px, 0.04, 0));
  g.add(at(k.cyl(0.02, 0.028, 2.66, pole, 8), px, 1.41, 0));
  g.add(at(k.sphere(0.04, k.mat('stBrass'), 8), px, 2.77, 0));
  g.add(bar(k, [px, 2.6, 0], [0.16, 2.6, 0], 0.012, pole, 5));
  const W = 0.21, H = 0.78, notch = 0.13;
  g.add(at(extrude(k, `banner:${W}:${H}`, () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(W, 0); s.lineTo(W, -H); s.lineTo(W / 2, -H + notch); s.lineTo(0, -H); s.lineTo(0, 0);
    return s;
  }, 0.014, cloth), px + 0.025, 2.59, 0));
  g.add(k.detail(at(rotX(k.cyl(0.055, 0.055, 0.03, k.mat('stPaint'), 12), Math.PI / 2), px + 0.025 + W / 2, 2.59 - 0.3, 0)));
  return g;
}
