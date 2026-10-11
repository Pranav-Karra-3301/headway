// Owner: E2. The rail where the loop leaves the board over the lake (plan.viaduct): a ballast berm across the beach
// and a chunky cream viaduct over the bay — swept deck with low parapets and a darker fascia, rounded piers with
// cutwaters standing on the lake bed, and stone abutments where the deck meets the sand. Baked with the statics.
import * as THREE from 'three';
import type { Vec2 } from '@headway/sim';
import { at, group, rbox, roleMat, type AnyRole } from './kit';
import { LAKE_BED_Y, type Viaduct } from './plan';

/** Sweep a closed profile (across, y — counter-clockwise seen along the path) along a polyline. Each profile edge is
 *  its own strip (crisp edges across, smooth along the curve); ends are left open (abutments hide them). */
export function sweepProfile(pts: Vec2[], profile: Array<[number, number]>): THREE.BufferGeometry {
  const n = pts.length;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  if (n < 2) return new THREE.BufferGeometry();
  // per-point unit tangent (central differences) and left normal (−tz, tx)
  const frames = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / l, tz = (b.z - a.z) / l;
    return { p, tx, tz, nx: -tz, nz: tx };
  });
  const m = profile.length;
  for (let e = 0; e < m; e++) {
    const [a0, y0] = profile[e]!, [a1, y1] = profile[(e + 1) % m]!;
    // outward normal of the edge in profile space (profile is CCW in (across, y))
    const ex = a1 - a0, ey = y1 - y0, el = Math.hypot(ex, ey) || 1;
    const pa = ey / el, py = -ex / el;
    const base = pos.length / 3;
    for (const f of frames) {
      for (const [a, y] of [[a0, y0], [a1, y1]] as const) {
        pos.push(f.p.x + f.nx * a, y, f.p.z + f.nz * a);
        nor.push(f.nx * pa, py, f.nz * pa);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const v0 = base + i * 2, v1 = v0 + 1, v2 = v0 + 2, v3 = v0 + 3;
      idx.push(v0, v2, v1, v1, v2, v3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  // make sure triangles face outward whatever the path's turning direction
  return fixWinding(g);
}

/** Flip triangles whose geometric normal disagrees with their vertex normals. */
function fixWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const P = g.getAttribute('position') as THREE.BufferAttribute, N = g.getAttribute('normal') as THREE.BufferAttribute;
  const I = g.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let k = 0; k < I.count; k += 3) {
    const i0 = I.getX(k), i1 = I.getX(k + 1), i2 = I.getX(k + 2);
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    b.sub(a); c.sub(a); b.cross(c);
    nn.fromBufferAttribute(N, i0);
    if (b.dot(nn) < 0) { I.setX(k + 1, i2); I.setX(k + 2, i1); }
  }
  return g;
}

function swept(pts: Vec2[], profile: Array<[number, number]>, role: AnyRole, idx = 0): THREE.Mesh {
  const m = new THREE.Mesh(sweepProfile(pts, profile), roleMat(role, idx));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** CCW profile helper: a rectangle (across a0..a1, y0..y1) with chamfered top corners. */
function slabProfile(a0: number, a1: number, y0: number, y1: number, ch: number): Array<[number, number]> {
  return [[a0, y0], [a1, y0], [a1, y1 - ch], [a1 - ch, y1], [a0 + ch, y1], [a0, y1 - ch]];
}

export function buildViaduct(v: Viaduct): THREE.Object3D {
  const g = group();
  const W = v.width, hw = W / 2, top = v.deckTop;
  const bodyBot = top - 0.46;
  for (const run of v.runs) {
    if (run.pts.length < 2) continue;
    if (run.kind === 'berm') {
      // a low gravel embankment: the ballast sits on its crown, its toes vanish into the sand
      g.add(swept(run.pts, [[-1.95, -0.75], [1.95, -0.75], [1.08, top], [-1.08, top]], 'ballast'));
      continue;
    }
    // deck slab with a darker fascia band and two low parapets with a pale coping
    g.add(swept(run.pts, slabProfile(-hw + 0.04, hw - 0.04, bodyBot + 0.1, top, 0.03), 'stone'));
    g.add(swept(run.pts, slabProfile(-hw, hw, bodyBot, bodyBot + 0.14, 0.04), 'stoneDark'));
    for (const s of [-1, 1]) {
      const a0 = s < 0 ? -hw : hw - 0.16, a1 = s < 0 ? -hw + 0.16 : hw;
      g.add(swept(run.pts, slabProfile(a0, a1, top - 0.02, top + 0.24, 0.04), 'stone'));
      g.add(swept(run.pts, slabProfile(a0 - 0.03, a1 + 0.03, top + 0.24, top + 0.3, 0.025), 'trim'));
    }
    // abutments where the deck meets the beach
    for (const [p, q] of [[run.pts[0]!, run.pts[1]!], [run.pts[run.pts.length - 1]!, run.pts[run.pts.length - 2]!]] as const) {
      const ab = group(at(rbox(W + 0.24, top - 0.02 - -1.7, 1.3, 0.14, 'stone'), 0, (top - 0.02 + -1.7) / 2, 0));
      ab.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
      ab.position.set(p.x, 0, p.z);
      g.add(ab);
    }
  }
  // piers: rounded cutwater blocks on the lake bed with a pale cap course
  const pTop = bodyBot, pBot = LAKE_BED_Y;
  for (const pr of v.piers) {
    const p = group(
      at(rbox(W - 0.5, pTop - pBot, 0.86, 0.4, 'stoneDark'), 0, (pTop + pBot) / 2, 0),
      at(rbox(W - 0.3, 0.12, 1.02, 0.05, 'stone'), 0, pTop - 0.02, 0),
    );
    // local +z along the track, local x across it
    p.rotation.y = Math.atan2(pr.dx, pr.dz);
    p.position.set(pr.x, 0, pr.z);
    g.add(p);
  }
  return g;
}
