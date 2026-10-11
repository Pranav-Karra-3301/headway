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
  p.add(at(cyl(k, 0.055, 0.06, 1.44, 'frame', 0, 8), 0, 0.1 + 0.72, 0));
  p.add(k.detail(at(cyl(k, 0.065, 0.065, 0.2, 'post', 0, 8), 0, 0.2, 0)));
  // crossbuck (white boards with red borders) facing +z, nudged toward the road (-x)
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const b = box(k, 0.78, 0.13, 0.025, 'frame'); b.rotation.z = a; p.add(at(b, -0.08, 1.36, 0.07));
    const e = box(k, 0.82, 0.17, 0.015, 'lmRed'); e.rotation.z = a; p.add(at(e, -0.08, 1.36, 0.052));
    const bk = box(k, 0.78, 0.13, 0.015, 'frame'); bk.rotation.z = a; p.add(k.detail(at(bk, -0.08, 1.36, 0.036)));
  }
  // twin lights on a cross arm
  p.add(at(box(k, 0.66, 0.08, 0.06, 'post'), -0.13, 1.0, 0.05));
  for (const x of [-0.38, 0.12]) {
    p.add(at(disc(k, 0.11, 0.05, 'post', 0, 12), x, 1.0, 0.1));
    p.add(at(disc(k, 0.075, 0.03, 'taillight', 0, 12), x, 1.0, 0.135));
    p.add(k.detail(at(box(k, 0.22, 0.025, 0.11, 'post'), x, 1.12, 0.16)));
  }
  p.add(k.detail(at(box(k, 0.22, 0.16, 0.03, 'frame'), 0, 0.76, 0.07)));
  return p;
}

/** Barrier arm group: pivot at the origin, arm reaching toward -x, raised by `lift` radians. */
function barrierArm(k: Kit, len: number, lift: number): THREE.Group {
  const a = group('barrierArm');
  a.add(at(box(k, 0.16, 0.1, 0.08, 'post'), 0.1, 0, 0));
  const n = 6, seg = len / n;
  for (let i = 0; i < n; i++) a.add(at(box(k, seg, 0.075, 0.055, i % 2 ? 'frame' : 'lmRed'), -0.04 - seg * (i + 0.5), 0, 0));
  a.add(k.detail(at(box(k, 0.05, 0.11, 0.06, 'lmRed'), -0.04 - len, 0, 0)));
  a.rotation.z = -lift;
  return a;
}

/** One corner of the crossing: warning post at the origin, gate housing + raised arm toward the track (-z). */
function crossingCorner(k: Kit): THREE.Group {
  const c = crossingPost(k);
  const gate = group('gate');
  gate.add(at(box(k, 0.24, 0.1, 0.24, 'curb'), 0, 0.05, 0));
  gate.add(at(rbox(k, 0.2, 0.44, 0.18, 0.04, 'rail'), 0, 0.32, 0));
  gate.add(k.detail(at(box(k, 0.22, 0.04, 0.2, 'post'), 0, 0.555, 0)));
  gate.add(at(barrierArm(k, 1.16, 0.88), -0.13, 0.44, 0));
  c.add(at(gate, -0.02, 0, -0.38));
  return c;
}

export function buildLevelCrossing(k: Kit, _params: AssetParams): THREE.Object3D {
  const g = group('levelCrossing');
  const px = 1.34, pz = 1.36;
  for (const s of [1, -1]) {
    const corner = crossingCorner(k);
    corner.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(at(corner, s * px, 0, s * pz));
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
