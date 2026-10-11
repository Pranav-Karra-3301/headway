// Owner: E1. Stone tunnel portals (toy-railway style): a chunky masonry facade with a round arch, alternating
// voussoirs + keystone, a cornice, plinths, a dark mouth set back in the opening, and two lanterns
// whose glass glows at dusk (palette role `lamp`). Local frame: +z = out of the tunnel, the cut plane at z = 0, the
// facade occupies z ∈ [0, depth]; y = 0 is the ground. Parts carry palette/terrain roles for bakeGeometry.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PortalDims, PortalSite } from './field';
import { RAIL_PORTAL, ROAD_PORTAL } from './field';

const mats = new Map<string, THREE.MeshStandardMaterial>();
const geos = new Map<string, THREE.BufferGeometry>();

/** A mesh tagged with a role (material.userData.role/idx → bakeGeometry). */
export function rolePart(geo: THREE.BufferGeometry, role: string, idx = 0): THREE.Mesh {
  const key = `${role}#${idx}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#c8c2b4', roughness: 0.85 });
    m.name = key;
    m.userData.role = role;
    m.userData.idx = idx;
    mats.set(key, m);
  }
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
const cached = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geos.get(key);
  if (!g) { g = make(); geos.set(key, g); }
  return g;
};
const r3 = (n: number) => n.toFixed(3);
function rbox(w: number, h: number, d: number, r: number, role: string, idx = 0): THREE.Mesh {
  const rr = Math.max(0.005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  return rolePart(cached(`rb${r3(w)}${r3(h)}${r3(d)}${r3(rr)}`, () => new RoundedBoxGeometry(w, h, d, 2, rr)), role, idx);
}
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => { o.position.set(x, y, z); return o; };

/** Arch outline (opening) as a path: up the right jamb, over the semicircle, down the left jamb. */
function archOpening(dims: PortalDims, inset = 0): THREE.Shape {
  const s = new THREE.Shape();
  const o = dims.open - inset;
  s.moveTo(o, 0);
  s.lineTo(o, dims.spring);
  s.absarc(0, dims.spring, o, 0, Math.PI, false);
  s.lineTo(-o, 0);
  s.closePath();
  return s;
}

/** The facade slab: a rounded-top block with the arch cut out (one ∩-shaped outline, extruded). */
function facadeGeometry(dims: PortalDims): THREE.BufferGeometry {
  return cached(`facade${r3(dims.half)}${r3(dims.open)}${r3(dims.spring)}${r3(dims.top)}${r3(dims.depth)}`, () => {
    const { half, open, spring, top } = dims, rc = 0.32;
    const s = new THREE.Shape();
    s.moveTo(-half, 0);
    s.lineTo(-half, top - rc);
    s.quadraticCurveTo(-half, top, -half + rc, top);
    s.lineTo(half - rc, top);
    s.quadraticCurveTo(half, top, half, top - rc);
    s.lineTo(half, 0);
    s.lineTo(open, 0);
    s.lineTo(open, spring);
    s.absarc(0, spring, open, 0, Math.PI, false);
    s.lineTo(-open, 0);
    s.closePath();
    const bevel = 0.07;
    const g = new THREE.ExtrudeGeometry(s, { depth: dims.depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20 });
    g.translate(0, 0, bevel);
    g.deleteAttribute('uv');
    return g;
  });
}

function mouthGeometry(dims: PortalDims): THREE.BufferGeometry {
  return cached(`mouth${r3(dims.open)}${r3(dims.spring)}`, () => {
    const g = new THREE.ShapeGeometry(archOpening(dims, -0.05), 20);
    g.deleteAttribute('uv');
    return g;
  });
}

/** Voussoirs: blocks around the arch (alternating tones), the keystone a size up. */
function voussoirs(g: THREE.Group, dims: PortalDims, n: number, front: number): void {
  const r = dims.open + 0.2;
  for (let k = 0; k < n; k++) {
    const a = (Math.PI * (k + 0.5)) / n;
    const key = k === (n - 1) / 2;
    const b = rbox(key ? 0.36 : 0.29, key ? 0.52 : 0.4, 0.16, 0.05, 'trStone', key ? 2 : k % 2);
    b.rotation.z = a - Math.PI / 2;
    g.add(at(b, Math.cos(a) * (r + (key ? 0.05 : 0)), dims.spring + Math.sin(a) * (r + (key ? 0.05 : 0)), front + 0.04));
  }
  // springer blocks where the arch meets the jambs
  for (const sx of [-1, 1]) g.add(at(rbox(0.42, 0.3, 0.16, 0.05, 'trStone', 2), sx * (dims.open + 0.2), dims.spring - 0.13, front + 0.04));
}

/** Wall lantern: an arm from the facade (local z = -0.26) holding a hanging lamp at the origin. */
function lantern(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(rbox(0.08, 0.08, 0.34, 0.025, 'trIron'), 0, 0, -0.12));
  g.add(at(rbox(0.045, 0.14, 0.045, 0.015, 'trIron'), 0, -0.07, 0));
  g.add(at(rbox(0.27, 0.07, 0.27, 0.03, 'trIron'), 0, -0.17, 0));
  g.add(at(rbox(0.18, 0.25, 0.18, 0.045, 'lamp'), 0, -0.33, 0));
  g.add(at(rbox(0.22, 0.05, 0.22, 0.02, 'trIron'), 0, -0.48, 0));
  return g;
}

function portalGroup(dims: PortalDims, kind: 'road' | 'rail'): THREE.Group {
  const g = new THREE.Group();
  g.name = `portal:${kind}`;
  g.add(rolePart(facadeGeometry(dims), 'trStone', 0));
  const mouth = rolePart(mouthGeometry(dims), 'trMouth');
  mouth.position.z = 0.03;
  mouth.castShadow = false;
  g.add(mouth);
  const front = dims.depth;
  voussoirs(g, dims, kind === 'road' ? 11 : 9, front);
  // cornice + plinths
  g.add(at(rbox(dims.half * 2 + 0.32, 0.26, dims.depth + 0.3, 0.08, 'trStone', 2), 0, dims.top + 0.06, dims.depth / 2 + 0.08));
  const pier = dims.half - dims.open;
  for (const sx of [-1, 1]) {
    g.add(at(rbox(pier + 0.16, 0.36, dims.depth + 0.16, 0.06, 'trStone', 2), sx * (dims.open + pier / 2), 0.18, dims.depth / 2 + 0.05));
    // a string course between plinth and arch
    g.add(at(rbox(pier + 0.06, 0.12, 0.1, 0.03, 'trStone', 1), sx * (dims.open + pier / 2), dims.spring - 0.5, front + 0.03));
  }
  for (const sx of [-1, 1]) {
    g.add(at(lantern(), sx * (dims.open + pier * 0.5), dims.spring + (kind === 'road' ? 1.1 : 1.0), front + 0.26));
  }
  if (kind === 'road') {
    // a raised name plaque above the keystone (shape only)
    g.add(at(rbox(1.3, 0.38, 0.12, 0.06, 'trStone', 2), 0, dims.spring + dims.open + 0.62, front + 0.03));
    g.add(at(rbox(1.05, 0.2, 0.06, 0.04, 'trIron'), 0, dims.spring + dims.open + 0.62, front + 0.1));
  }
  return g;
}

/** A portal placed at its site: the facade's back face sits on the cut plane, the front faces `site.face`. */
export function makePortal(site: PortalSite): THREE.Group {
  const g = portalGroup(site.kind === 'road' ? ROAD_PORTAL : RAIL_PORTAL, site.kind);
  g.position.set(site.x, 0, site.z);
  g.rotation.y = Math.atan2(site.face.x, site.face.z);
  return g;
}
