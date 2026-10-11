// Owner: A6 street. Litter bin, fire hydrant, mailbox, bike rack with two bikes. Front faces +z; base at y = 0.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { variants } from './roles';
import { at, bar, box, extrude, group, pick, rotX, rotZ } from './prims';

/** Round park bin: green body with a pale band, iron rims and a domed lid. */
export function buildBin(k: KitContext, _p: AssetParams): THREE.Object3D {
  const iron = k.mat('post'), body = k.mat('stBin');
  const g = group('st.bin');
  g.add(at(k.cyl(0.13, 0.14, 0.05, iron, 12), 0, 0.025, 0));
  g.add(at(k.cyl(0.15, 0.13, 0.44, body, 12), 0, 0.27, 0));
  g.add(k.detail(at(k.cyl(0.149, 0.146, 0.05, k.mat('stPaint'), 12), 0, 0.36, 0)));
  g.add(at(k.cyl(0.165, 0.16, 0.05, iron, 12), 0, 0.505, 0));
  g.add(at(k.cyl(0.07, 0.15, 0.07, iron, 12), 0, 0.565, 0));
  g.add(k.detail(at(k.cyl(0.03, 0.035, 0.035, iron, 6), 0, 0.615, 0)));
  return g;
}

/** Fire hydrant: red barrel and bonnet dome, brass caps; the big pumper nozzle faces the street (+z). */
export function buildHydrant(k: KitContext, _p: AssetParams): THREE.Object3D {
  const red = k.mat('stHydrant'), brass = k.mat('stBrass');
  const g = group('st.hydrant');
  g.add(at(k.cyl(0.1, 0.115, 0.045, red, 10), 0, 0.0225, 0));
  g.add(at(k.cyl(0.074, 0.08, 0.25, red, 10), 0, 0.17, 0));
  g.add(at(k.cyl(0.098, 0.098, 0.035, red, 10), 0, 0.305, 0));
  const dome = k.sphere(0.08, red, 8); dome.scale.set(1, 0.85, 1);
  g.add(at(dome, 0, 0.32, 0));
  g.add(at(k.cyl(0.024, 0.032, 0.05, brass, 6), 0, 0.42, 0));
  for (const s of [-1, 1]) g.add(at(rotZ(k.cyl(0.03, 0.03, 0.06, brass, 8), Math.PI / 2), s * 0.1, 0.215, 0));
  g.add(at(rotX(k.cyl(0.042, 0.042, 0.05, brass, 8), Math.PI / 2), 0, 0.2, 0.095));
  return g;
}

/** US-style blue collection box on four legs: rounded top, pull handle and emblem on the front (+z). */
export function buildMailbox(k: KitContext, _p: AssetParams): THREE.Object3D {
  const blue = k.mat('stMail'), iron = k.mat('post');
  const g = group('st.mailbox');
  const W = 0.32, H = 0.34, R = W / 2;
  for (const x of [-0.12, 0.12]) for (const z of [-0.09, 0.09]) g.add(at(box(k, 0.045, 0.23, 0.045, iron), x, 0.115, z));
  g.add(at(box(k, 0.36, 0.035, 0.29, blue), 0, 0.235, 0));
  g.add(at(extrude(k, `mailbox:${W}:${H}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-R, 0); s.lineTo(R, 0); s.lineTo(R, H); s.absarc(0, H, R, 0, Math.PI, false); s.lineTo(-R, 0);
    return s;
  }, 0.24, blue, 0.018, 8), 0, 0.25, 0));
  g.add(at(rotX(box(k, 0.2, 0.05, 0.035, iron), -0.25), 0, 0.6, 0.14));
  g.add(k.detail(at(rotX(k.cyl(0.055, 0.055, 0.012, k.mat('stPaint'), 12), Math.PI / 2), 0, 0.42, 0.145)));
  return g;
}

/** One bike along x, wheels on the ground, front at +x. */
function bike(k: KitContext, colour: number): THREE.Group {
  const frame = k.mat('stBike', colour), tyre = k.mat('tire'), hub = k.mat('hub'), dark = k.mat('post');
  const b = group('bike');
  const r = 0.135, rear: [number, number, number] = [-0.24, r, 0], front: [number, number, number] = [0.24, r, 0];
  for (const c of [rear, front]) {
    b.add(at(rotX(k.cyl(r, r, 0.026, tyre, 10), Math.PI / 2), c[0], c[1], 0));
    b.add(k.detail(at(rotX(k.cyl(r * 0.6, r * 0.6, 0.032, hub, 6), Math.PI / 2), c[0], c[1], 0)));
  }
  const bb: [number, number, number] = [-0.02, 0.15, 0], seat: [number, number, number] = [-0.08, 0.36, 0], head: [number, number, number] = [0.15, 0.34, 0];
  b.add(bar(k, bb, head, 0.016, frame, 4));
  b.add(bar(k, bb, seat, 0.016, frame, 4));
  b.add(bar(k, [-0.075, 0.33, 0], head, 0.014, frame, 4));
  b.add(bar(k, bb, rear, 0.013, frame, 4));
  b.add(bar(k, [0.15, 0.4, 0], front, 0.014, frame, 4));
  b.add(bar(k, [0.15, 0.4, -0.1], [0.15, 0.4, 0.1], 0.013, dark, 4));
  b.add(at(box(k, 0.11, 0.03, 0.06, dark), -0.09, 0.385, 0));
  return b;
}

/** Steel hoop rack along x with two parked bikes in front (+z). params.color / color2 pick the bike colours. */
export function buildBikeRack(k: KitContext, p: AssetParams): THREE.Object3D {
  const steel = k.mat('stSteel');
  const g = group('st.bikeRack');
  const n = variants('stBike');
  const c1 = pick(k, p, n);
  const c2 = typeof p.color2 === 'number' ? pick(k, p, n, 'color2') : (c1 + 1 + pick(k, {}, n - 1)) % n;
  for (const x of [-0.62, 0.62]) g.add(bar(k, [x, 0, -0.14], [x, 0.3, -0.14], 0.022, steel, 6));
  g.add(bar(k, [-0.64, 0.3, -0.14], [0.64, 0.3, -0.14], 0.022, steel, 6));
  const a = bike(k, c1); a.position.set(-0.36, 0, 0.04); a.rotation.y = 0.05;
  const b = bike(k, c2); b.position.set(0.37, 0, 0.06); b.rotation.y = Math.PI - 0.05;
  g.add(a, b);
  return g;
}
