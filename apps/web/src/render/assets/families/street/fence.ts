// Owner: A6 street. Fences along x, centred: params.length (default 3) and params.style 'picket' | 'rail'.
// Pickets of a run are merged into one cached geometry per length, so a long fence stays a handful of meshes.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { at, box, cached, group, merged, num, r3, shaped } from './prims';

const PICKET = { w: 0.075, h: 0.44, tip: 0.06, d: 0.022, gap: 0.165, y0: 0.07 } as const;

function picketRun(len: number): THREE.BufferGeometry {
  return cached(`pickets:${r3(len)}`, () => {
    const n = Math.max(2, Math.round(len / PICKET.gap));
    const step = (len - 0.2) / (n - 1);
    const s = new THREE.Shape();
    const hw = PICKET.w / 2;
    s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, PICKET.h); s.lineTo(0, PICKET.h + PICKET.tip); s.lineTo(-hw, PICKET.h); s.lineTo(-hw, 0);
    const one = new THREE.ExtrudeGeometry(s, { depth: PICKET.d, bevelEnabled: false });
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) parts.push(one.clone().translate(-len / 2 + 0.1 + i * step, PICKET.y0, 0.01));
    return merged(parts);
  });
}

export function buildFence(k: KitContext, p: AssetParams): THREE.Object3D {
  const len = Math.max(0.6, num(p, 'length', 3));
  return p.style === 'rail' ? railFence(k, len) : picketFence(k, len);
}

/** White picket fence: square posts every ≤ 1.5 u with caps, two rails behind pointed pickets. */
function picketFence(k: KitContext, len: number): THREE.Object3D {
  const paint = k.mat('stPaint');
  const g = group('st.fence');
  for (const y of [0.17, 0.4]) g.add(at(box(k, len - 0.04, 0.045, 0.03, paint), 0, y, -0.025));
  g.add(shaped(k, picketRun(len), paint));
  const posts = Math.max(2, Math.ceil(len / 1.5) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -len / 2 + 0.045 + (i * (len - 0.09)) / (posts - 1);
    g.add(at(box(k, 0.085, 0.56, 0.085, paint), x, 0.28, -0.01));
    const cap = k.cone(0.068, 0.07, paint, 4); cap.rotation.y = Math.PI / 4;
    g.add(k.detail(at(cap, x, 0.595, -0.01)));
  }
  return g;
}

/** Post-and-rail fence: round wooden posts about every metre, two rails. */
function railFence(k: KitContext, len: number): THREE.Object3D {
  const wood = k.mat('stRanch');
  const g = group('st.fence');
  const posts = Math.max(2, Math.round(len / 1.0) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -len / 2 + 0.05 + (i * (len - 0.1)) / (posts - 1);
    g.add(at(k.cyl(0.042, 0.05, 0.58, wood, 6), x, 0.29, 0));
  }
  for (const y of [0.24, 0.46]) g.add(at(box(k, len - 0.02, 0.06, 0.035, wood), 0, y, 0.05));
  return g;
}
