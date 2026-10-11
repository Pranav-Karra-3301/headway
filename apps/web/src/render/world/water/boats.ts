// Owner: E2. Every boat, buoy, float and duck in ONE draw call: each is baked in its own local frame (bow +x,
// waterline y = 0), merged with an `aBoat` index attribute, and posed in the vertex shader from two small uniform
// arrays (x, y, z, heading) + (roll, pitch, scale) that the layer fills each frame from boatPose().
import * as THREE from 'three';
import { kenneyModel, kenneyReady, kenneyTemplate, type KenneyId, type KenneyPartInfo } from '../../assets/kenney';
import { bakeGeometry, mergeBaked, recolorBaked, type Baked } from '../../kit/bake';
import { KitMaterial } from '../../materials';
import type { PaletteId } from '../../types';
import { resolveWaterRole } from './colors';
import { at, box, capsule, cone, cyl, group, rbox, roleMat, rot, scl, slab, sphere, wpart } from './kit';
import { hullShape } from './props';
import type { Boat, BoatKind } from './plan';

export const MAX_BOATS = 24;

function sailShape(pts: Array<[number, number]>): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
  g.translate(0, 0, -0.0175);
  g.deleteAttribute('uv');
  return g;
}
const SAIL_CACHE = new Map<string, THREE.BufferGeometry>();
function sail(key: string, pts: Array<[number, number]>, role: string, idx: number): THREE.Mesh {
  let g = SAIL_CACHE.get(key);
  if (!g) { g = sailShape(pts); SAIL_CACHE.set(key, g); }
  return wpart(g, role, idx);
}

function hull(L: number, B: number, H: number, v: number, key: string): THREE.Object3D {
  const g = group();
  g.add(at(slab(`${key}-hull`, hullShape(L, B), H, 0.07, 'hull', 0), 0, -0.2, 0));
  g.add(at(slab(`${key}-boot`, hullShape(L + 0.06, B + 0.05), 0.09, 0.02, 'hutPaint', v), 0, -0.02, 0));
  g.add(at(slab(`${key}-deck`, hullShape(L - 0.26, B - 0.2), 0.05, 0.015, 'plank', 0), 0, H - 0.22, 0));
  return g;
}

function sailboat(v: number, underway: boolean): THREE.Object3D {
  const g = group();
  g.add(hull(2.4, 0.84, 0.5, v, 'sb'));
  g.add(at(rbox(0.82, 0.3, 0.52, 0.1, 'hull', 1), -0.2, 0.42, 0));
  for (const s of [-1, 1]) g.add(at(box(0.5, 0.07, 0.02, 'window', 1), -0.18, 0.46, s * 0.262));
  g.add(at(cyl(0.03, 0.04, 3.0, 'column', 0, 6), 0.3, 0.3 + 1.5, 0));
  g.add(at(rot(cyl(0.024, 0.024, 1.25, 'column', 0, 5), 0, 0, Math.PI / 2), -0.32, 0.78, 0));
  if (underway) {
    g.add(at(sail('main', [[0, 0], [0, 2.3], [-1.18, 0]], 'sail', v), 0.27, 0.82, 0));
    g.add(at(sail('jib', [[0, 0], [0, 2.05], [0.98, 0]], 'sail', 0), 0.34, 0.62, 0));
  } else {
    g.add(at(rot(capsule(0.075, 1.0, 'sail', v), 0, 0, Math.PI / 2), -0.3, 0.86, 0));
  }
  g.add(at(rot(cone(0.05, 0.16, 'hutPaint', v, 4), 0, 0, -Math.PI / 2), 0.36, 3.32, 0));
  return g;
}

function motorboat(v: number): THREE.Object3D {
  const g = group();
  g.add(hull(2.2, 0.86, 0.48, v, 'mb'));
  g.add(at(rbox(0.74, 0.4, 0.64, 0.1, 'hull', 1), -0.05, 0.48, 0));
  g.add(at(rot(box(0.05, 0.24, 0.58, 'window', 0), 0, 0, 0.55), 0.34, 0.6, 0));
  for (const s of [-1, 1]) g.add(at(box(0.44, 0.1, 0.02, 'window', 1), -0.08, 0.52, s * 0.322));
  g.add(at(rbox(0.92, 0.06, 0.74, 0.03, 'hutPaint', v), -0.1, 0.71, 0));
  g.add(at(rbox(0.18, 0.34, 0.16, 0.05, 'post'), -1.12, 0.2, 0));
  g.add(at(rbox(0.5, 0.05, 0.5, 0.02, 'plank', 1), -0.72, 0.31, 0));
  return g;
}

function buoy(v: number): THREE.Object3D {
  const g = group();
  g.add(at(cyl(0.17, 0.24, 0.44, 'buoy', v, 12), 0, 0.08, 0));
  g.add(at(cyl(0.18, 0.18, 0.08, 'stripe', 0, 12), 0, 0.2, 0));
  g.add(at(v ? cone(0.17, 0.34, 'buoy', v, 12) : cyl(0.15, 0.17, 0.3, 'buoy', v, 12), 0, 0.42, 0));
  g.add(at(sphere(0.05, 'lamp', 0, 8, 6), 0, v ? 0.62 : 0.6, 0));
  return g;
}

function float(v: number): THREE.Object3D {
  return group(at(sphere(0.12, v ? 'stripe' : 'taillight', 0, 10, 8), 0, 0.03, 0));
}

function duck(scale: number): THREE.Object3D {
  const g = group();
  g.add(at(scl(sphere(0.16, 'duck', 0, 12, 9), 1.25, 0.78, 0.92), 0, 0.06, 0));
  g.add(at(rot(cone(0.06, 0.14, 'duck', 0, 6), 0, 0, 1.1), -0.2, 0.12, 0));
  g.add(at(sphere(0.095, 'duck', 0, 12, 9), 0.13, 0.22, 0));
  g.add(at(scl(sphere(0.045, 'beak', 0, 8, 6), 1.5, 0.55, 1.1), 0.23, 0.205, 0));
  for (const s of [-1, 1]) g.add(at(sphere(0.016, 'hands', 0, 6, 4), 0.19, 0.25, s * 0.06));
  g.scale.setScalar(scale);
  return g;
}

// ---------------------------------------------------------------- Kenney watercraft (v5/v7 Kenney-first)
/** Kenney models per boat kind (picked by the boat's colour variant). Ducks, buoys and floats stay ours. */
export const KENNEY_BOAT_MODELS: Partial<Record<BoatKind, KenneyId[]>> = {
  sail: ['watercraft-pack/boat-sail-a', 'watercraft-pack/boat-sail-b'],
  motor: ['watercraft-pack/boat-speed-a', 'watercraft-pack/boat-fishing-small', 'watercraft-pack/boat-speed-c'],
};
/** Every Kenney model the lake uses: preload them (the layer also upgrades itself when they arrive). */
export const WATER_KENNEY_IDS: KenneyId[] = [...new Set(Object.values(KENNEY_BOAT_MODELS).flat())];
/** How deep each model sits in the water (u below the waterline; Kenney keels sit at y = 0). */
const SINK: Partial<Record<KenneyId, number>> = {
  'watercraft-pack/boat-sail-a': 0.2, 'watercraft-pack/boat-sail-b': 0.2,
  'watercraft-pack/boat-speed-a': 0.17, 'watercraft-pack/boat-speed-c': 0.17, 'watercraft-pack/boat-fishing-small': 0.2,
};

export function kenneyBoatId(b: Boat): KenneyId | null {
  const list = KENNEY_BOAT_MODELS[b.kind];
  return list?.length ? list[((b.v % list.length) + list.length) % list.length]! : null;
}

/** A loaded Kenney boat in our boat frame: bow +x, centred on the origin, keel `SINK` under the waterline, its paint
 *  part repainted in the lake's (palette-following) boat colours. */
function kenneyBoat(b: Boat, id: KenneyId, palette: PaletteId): THREE.Object3D {
  const t = kenneyTemplate(id)!;
  const m = kenneyModel(id, { palette });
  m.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const info = mesh.userData?.kenney as KenneyPartInfo | undefined;
    if (mesh.isMesh && info?.paint) mesh.material = roleMat('boatPaint', b.v);
  });
  // rotate +π/2 about y: (x, y, z) → (z, y, −x), so Kenney's +z bow points along +x
  const cx = (t.box.min.x + t.box.max.x) / 2, cz = (t.box.min.z + t.box.max.z) / 2;
  m.rotation.y = Math.PI / 2;
  m.position.set(-cz, -(SINK[id] ?? 0.2) - t.box.min.y, cx);
  return group(m);
}

export function buildBoat(b: Boat, palette: PaletteId = 'a'): THREE.Object3D {
  const id = kenneyBoatId(b);
  if (id && kenneyReady(id)) return kenneyBoat(b, id, palette);
  switch (b.kind) {
    case 'sail': return sailboat(b.v, !!b.loop);
    case 'motor': return motorboat(b.v);
    case 'buoy': return buoy(b.v);
    case 'float': return float(b.v);
    case 'duck': return duck(1);
    case 'duckling': return duck(0.56);
  }
}

/** Half length of a boat (wake size). */
export function boatSize(b: Boat): number {
  return b.kind === 'sail' ? 1.2 : b.kind === 'motor' ? 1.1 : b.kind === 'duck' ? 0.2 : b.kind === 'duckling' ? 0.11 : 0.2;
}

export interface BoatUniforms {
  uBoatPose: { value: THREE.Vector4[] };
  uBoatTilt: { value: THREE.Vector4[] };
}

const VERT_PARS = /* glsl */ `
attribute float aBoat;
uniform vec4 uBoatPose[${MAX_BOATS}];
uniform vec4 uBoatTilt[${MAX_BOATS}];
mat3 hwRotY( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c ); }
mat3 hwRotZ( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0 ); }
mat3 hwRotX( float a ) { float c = cos( a ), s = sin( a ); return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c ); }
`;
const POSE_NORMAL = /* glsl */ `
int hwI = int( aBoat + 0.5 );
vec4 hwPose = uBoatPose[ hwI ];
vec4 hwTilt = uBoatTilt[ hwI ];
mat3 hwR = hwRotY( hwPose.w ) * hwRotZ( hwTilt.y ) * hwRotX( hwTilt.x );
objectNormal = hwR * objectNormal;
`;
const POSE_VERTEX = /* glsl */ `
transformed = hwR * ( transformed * hwTilt.z ) + hwPose.xyz;
`;

/** KitMaterial (clay look, dusk glow) whose vertices are posed per boat. `dusk` replaces the shared dusk uniform. */
export class BoatMaterial extends KitMaterial {
  constructor(readonly boatUniforms: BoatUniforms, dusk: { value: number }) {
    super({ roughness: 0.7 });
    const base = this.onBeforeCompile;
    this.onBeforeCompile = (shader, renderer) => {
      base.call(this, shader, renderer);
      shader.uniforms.uBoatPose = boatUniforms.uBoatPose;
      shader.uniforms.uBoatTilt = boatUniforms.uBoatTilt;
      shader.uniforms.uDusk = dusk;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${POSE_NORMAL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${POSE_VERTEX}`);
    };
    this.customProgramCacheKey = () => 'hw-water-boats';
  }
}

export interface Boats {
  mesh: THREE.Mesh;
  uniforms: BoatUniforms;
  recolor(p: PaletteId): void;
  /** Re-bake every boat (e.g. once the Kenney models have loaded, or for a palette); swaps the mesh's geometry. */
  rebuild(p: PaletteId): void;
}

/** One boat baked in its local frame (bow +x, waterline y = 0). */
export function bakeBoat(b: Boat, palette: PaletteId): Baked {
  return bakeGeometry(buildBoat(b, palette), palette, { resolve: resolveWaterRole });
}

function bakeFleet(boats: Boat[], palette: PaletteId): Baked {
  const list: Baked[] = boats.map((b) => bakeBoat(b, palette));
  const merged = mergeBaked(list);
  for (const b of list) b.geometry.dispose();
  const nv = merged.geometry.getAttribute('position').count;
  const idx = new Float32Array(nv);
  let off = 0;
  list.forEach((b, i) => {
    const n = b.geometry.getAttribute('position').count;
    idx.fill(i, off, off + n);
    off += n;
  });
  merged.geometry.setAttribute('aBoat', new THREE.BufferAttribute(idx, 1));
  return merged;
}

export function buildBoats(boats: Boat[], palette: PaletteId, dusk: { value: number }): Boats {
  if (boats.length > MAX_BOATS) throw new Error(`water: ${boats.length} boats > ${MAX_BOATS}`);
  let merged = bakeFleet(boats, palette);
  const uniforms: BoatUniforms = {
    uBoatPose: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4(0, -50, 0, 0)) },
    uBoatTilt: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4(0, 0, 1, 0)) },
  };
  const mesh = new THREE.Mesh(merged.geometry, new BoatMaterial(uniforms, dusk));
  mesh.name = 'water:boats';
  mesh.frustumCulled = false; // vertices are boat-local; the shader places them
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    uniforms,
    recolor: (p) => recolorBaked(merged, p),
    rebuild(p) {
      const next = bakeFleet(boats, p);
      const old = mesh.geometry;
      mesh.geometry = next.geometry;
      merged = next;
      old.dispose();
    },
  };
}
