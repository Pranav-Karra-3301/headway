// Owner: A6 street. Geometry helpers for street furniture.
// Every mesh starts life as a kit primitive, so the composer's KitContext adapter tags it like any other part
// (role, shadows); thin parts then swap in a cached custom geometry (plain boxes, lathes, extrusions).
// Custom geometries match three's primitives: indexed, exactly position + normal + uv, no groups.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AssetParams, KitContext } from '../../types';

export type Mat = THREE.Material;
export type V3 = readonly [number, number, number];

const cache = new Map<string, THREE.BufferGeometry>();
export const r3 = (n: number): number => Math.round(n * 1000) / 1000;

function normalise(src: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = src;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.index) g = mergeVertices(g);
  g.clearGroups();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Cached custom geometry (built once per key, shared by every placement). */
export function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = normalise(make()); cache.set(key, g); }
  return g;
}

/** Merge several geometries (already transformed) into one indexed geometry. */
export function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((p) => normalise(p)), false)!;
}

/** A kit mesh carrying a custom geometry. */
export function shaped(k: KitContext, geometry: THREE.BufferGeometry, m: Mat): THREE.Mesh {
  const mesh = k.cyl(0.5, 0.5, 1, m, 3);
  mesh.geometry = geometry;
  return mesh;
}

/** Plain box (12 triangles) for slats, rails, panels: the rounded kit box costs 100–600 triangles. */
export function box(k: KitContext, w: number, h: number, d: number, m: Mat): THREE.Mesh {
  return shaped(k, cached(`bx:${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)), m);
}

/** Cylinder of radius r from a to b (tubes, stays, rails). */
export function bar(k: KitContext, a: V3, b: V3, r: number, m: Mat, seg = 5): THREE.Mesh {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const mesh = k.cyl(r, r, dir.length(), m, seg);
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** Lathe around y from (radius, y) profile points (bottom to top). */
export function lathe(k: KitContext, key: string, profile: Array<[number, number]>, seg: number, m: Mat): THREE.Mesh {
  return shaped(k, cached(`la:${key}:${seg}`, () => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg)), m);
}

/** Shape in the x-y plane extruded `depth` along z, centred on z = 0; optional small bevel for soft edges. */
export function extrude(k: KitContext, key: string, shape: () => THREE.Shape, depth: number, m: Mat, bevel = 0, curveSegments = 6): THREE.Mesh {
  return shaped(k, cached(`ex:${key}`, () => {
    const g = new THREE.ExtrudeGeometry(shape(), {
      depth, curveSegments, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  }), m);
}

/** Closed cone sector (apex up, base at y = 0) spanning [t0, t0 + dt] around y; used for striped umbrellas. */
export function coneSector(k: KitContext, r: number, h: number, t0: number, dt: number, m: Mat): THREE.Mesh {
  return shaped(k, cached(`cs:${r3(r)},${r3(h)},${r3(t0)},${r3(dt)}`, () => {
    const g = new THREE.ConeGeometry(r, h, 2, 1, false, t0, dt);
    g.translate(0, h / 2, 0);
    return g;
  }), m);
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
export function rotX<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.x = a; return o; }
export function rotY<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.y = a; return o; }
export function rotZ<T extends THREE.Object3D>(o: T, a: number): T { o.rotation.z = a; return o; }

/** Colour variant: params.color (int) when given, else seeded per placement. */
export function pick(k: KitContext, params: AssetParams, n: number, key = 'color'): number {
  const v = params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return ((Math.floor(v) % n) + n) % n;
  return Math.min(n - 1, Math.floor(k.rand() * n));
}

export function num(params: AssetParams, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function group(name: string, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (children.length) g.add(...children);
  return g;
}
