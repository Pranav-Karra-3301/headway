// Owner: A4. Railway furniture.
//  lm.levelCrossing (3 × 3): centred on the road/rail intersection. At rot 0 the ROAD runs along z and the
//    TRACK along x. Two warning posts on opposite corners (just off the road edge and the ballast), each with
//    a crossbuck, twin red lights (role `taillight`, glows at dusk) and a raised red/white barrier arm.
//  lm.railSignal (0.5 × 0.5, instanced): colour-light signal on a post; lamps face +z (oncoming trains).
import * as THREE from 'three';
import type { AssetParams } from '../../types';
import { at, box, cyl, disc, group, type Kit, rbox } from './parts';

function crossingPost(k: Kit): THREE.Group {
  const p = group('crossingPost');
  p.add(at(box(k, 0.3, 0.1, 0.3, 'curb'), 0, 0.05, 0));
  p.add(at(cyl(k, 0.045, 0.05, 1.42, 'frame', 0, 8), 0, 0.1 + 0.71, 0));
  p.add(k.detail(at(cyl(k, 0.05, 0.05, 0.18, 'post', 0, 8), 0, 0.19, 0)));
  // crossbuck (white boards with red borders) facing +z
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const b = box(k, 0.66, 0.11, 0.02, 'frame'); b.rotation.z = a; p.add(at(b, 0, 1.38, 0.06));
    const e = box(k, 0.7, 0.15, 0.015, 'lmRed'); e.rotation.z = a; p.add(k.detail(at(e, 0, 1.38, 0.045)));
  }
  // twin lights on a cross arm
  p.add(at(box(k, 0.62, 0.07, 0.05, 'post'), 0, 1.04, 0.05));
  for (const x of [-0.24, 0.24]) {
    p.add(at(disc(k, 0.1, 0.05, 'post', 0, 12), x, 1.04, 0.09));
    p.add(at(disc(k, 0.065, 0.03, 'taillight', 0, 12), x, 1.04, 0.125));
    p.add(k.detail(at(box(k, 0.2, 0.025, 0.1, 'post'), x, 1.15, 0.15)));
  }
  p.add(k.detail(at(box(k, 0.2, 0.16, 0.03, 'frame'), 0, 0.82, 0.06)));
  return p;
}

/** Barrier arm group: pivot at the origin, arm reaching toward -x, raised by `lift` radians. */
function barrierArm(k: Kit, len: number, lift: number): THREE.Group {
  const a = group('barrierArm');
  a.add(at(box(k, 0.18, 0.2, 0.14, 'rail'), 0.04, 0, 0));
  a.add(k.detail(at(box(k, 0.16, 0.12, 0.12, 'post'), 0.2, 0, 0)));
  const n = 6, seg = len / n;
  for (let i = 0; i < n; i++) a.add(at(box(k, seg, 0.06, 0.045, i % 2 ? 'frame' : 'lmRed'), -0.06 - seg * (i + 0.5), 0, 0));
  a.rotation.z = -lift;
  return a;
}

export function buildLevelCrossing(k: Kit, _params: AssetParams): THREE.Object3D {
  const g = group('levelCrossing');
  const px = 1.36, pz = 1.24;
  for (const s of [1, -1]) {
    const post = crossingPost(k);
    post.add(at(barrierArm(k, 1.14, 1.05), -0.16, 0.6, 0));
    post.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(at(post, s * px, 0, s * pz));
  }
  return g;
}

export function buildRailSignal(k: Kit, _params: AssetParams): THREE.Object3D {
  const g = group('railSignal');
  g.add(at(box(k, 0.46, 0.1, 0.46, 'curb'), 0, 0.05, 0));
  g.add(at(cyl(k, 0.04, 0.05, 1.3, 'post', 0, 8), 0, 0.1 + 0.65, 0));
  g.add(k.detail(at(box(k, 0.14, 0.24, 0.1, 'rail'), 0, 0.22, -0.1)));
  const head = group('signalHead');
  head.add(at(rbox(k, 0.28, 0.56, 0.12, 0.06, 'post'), 0, 0, 0));
  head.add(k.detail(at(box(k, 0.34, 0.62, 0.02, 'post'), 0, 0, -0.07)));
  for (const [y, role] of [[0.13, 'taillight'], [-0.13, 'lmGreen']] as const) {
    head.add(at(disc(k, 0.07, 0.03, role, 0, 10), 0, y, 0.07));
    head.add(k.detail(at(box(k, 0.18, 0.02, 0.09, 'post'), 0, y + 0.09, 0.1)));
  }
  g.add(at(head, 0, 1.48, 0));
  g.add(k.detail(at(box(k, 0.22, 0.03, 0.16, 'post'), 0, 1.78, 0)));
  return g;
}
