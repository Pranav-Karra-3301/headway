// Owner: A6 street. Street lamp + traffic light. Front faces +z; base at y = 0.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { at, box, group, rotX } from './prims';

/** Centre of the glowing lamp head (role `lamp`) above the lamp's base, and its radius: FX hangs the dusk glow here. */
export const LAMP_HEAD = { y: 1.98, r: 0.13 } as const;

/** College-town lantern lamp: stepped plinth, tapered iron post, six-sided glass lantern with a hat. */
export function buildLamp(k: KitContext, _p: AssetParams): THREE.Object3D {
  const iron = k.mat('post'), glow = k.mat('lamp');
  const g = group('st.lamp');
  g.add(at(k.cyl(0.12, 0.15, 0.16, iron, 10), 0, 0.08, 0));
  g.add(k.detail(at(k.cyl(0.075, 0.105, 0.08, iron, 10), 0, 0.2, 0)));
  g.add(at(k.cyl(0.036, 0.05, 1.54, iron, 8), 0, 0.98, 0));
  g.add(at(k.cyl(0.065, 0.045, 0.07, iron, 8), 0, 1.76, 0));
  g.add(at(k.cyl(0.105, 0.06, 0.06, iron, 6), 0, 1.83, 0));
  g.add(at(k.cyl(0.13, 0.095, 0.26, glow, 6), 0, LAMP_HEAD.y, 0));
  g.add(at(k.cone(0.175, 0.14, iron, 6), 0, 2.18, 0));
  g.add(k.detail(at(k.cone(0.035, 0.09, iron, 6), 0, 2.29, 0)));
  return g;
}

/** Post-mounted signal: dark housing on a yellow back plate, red / amber / green lenses facing +z. */
export function buildTrafficLight(k: KitContext, _p: AssetParams): THREE.Object3D {
  const iron = k.mat('post');
  const g = group('st.trafficLight');
  g.add(at(k.cyl(0.08, 0.1, 0.1, iron, 8), 0, 0.05, 0));
  g.add(at(k.cyl(0.034, 0.042, 1.9, iron, 8), 0, 1.0, 0));
  g.add(at(k.rbox(0.22, 0.6, 0.16, 0.05, iron), 0, 2.08, 0));
  g.add(at(box(k, 0.3, 0.68, 0.025, k.mat('stBrass')), 0, 2.08, -0.09));
  const lenses: Array<[string, number]> = [['taillight', 2.27], ['stAmber', 2.08], ['stGreen', 1.89]];
  for (const [role, y] of lenses) {
    g.add(at(rotX(k.cyl(0.056, 0.056, 0.03, k.mat(role), 10), Math.PI / 2), 0, y, 0.085));
    g.add(k.detail(at(rotX(box(k, 0.15, 0.016, 0.075, iron), -0.18), 0, y + 0.07, 0.115)));
  }
  g.add(k.detail(at(box(k, 0.07, 0.11, 0.05, k.mat('stBrass')), 0, 0.95, 0.055)));
  return g;
}
