// Owner: C1 (camera study). World-layer occlusion without per-triangle raycasts: rasterise every lit mesh of the
// world layer (terrain, rocks, forests, portals, lighthouse, boats, bridges …) into a grid of occupied height
// ranges once, then march each sample's camera ray through the grid. Conservative (a triangle fills its cells'
// whole xz bounds), O(triangles) to build and ~(40 u / step) per ray.
import * as THREE from 'three';
import type { V3 } from './views';

export interface HeightField {
  x0: number; z0: number; cell: number; nx: number; nz: number;
  /** Occupied height range per cell (lo > hi = empty). */
  lo: Float32Array; hi: Float32Array;
  /** Which object filled each cell last (for labels). */
  who: Int32Array; names: string[];
}

export interface HeightFieldOptions {
  cell?: number;
  /** Geometry entirely below this height (water, beach, base slab, the board) never occludes. */
  minY?: number;
  include?: (m: THREE.Mesh) => boolean;
}

/** Vertex attributes of plain / kit-baked geometry. Anything else (e.g. water's `aBoat`, the sky's `aDrift`) means
 *  the vertex shader poses the mesh, so its buffer positions are not where it is drawn. */
const PLAIN_ATTRIBUTES = new Set(['position', 'normal', 'uv', 'uv1', 'color', 'tangent', 'aGlow', 'aTint']);

/** Lit, visible meshes with plain geometry only: screen-space backdrops, custom-shader props (sky, ridges) and
 *  shader-posed meshes (boats) are skipped. */
export function defaultInclude(m: THREE.Mesh): boolean {
  if (!m.visible || m.userData.noOcclude || m.userData.noPick) return false;
  if ((m.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) return false;
  if (Object.keys(m.geometry.attributes).some((a) => !PLAIN_ATTRIBUTES.has(a))) return false;
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return mats.every((x) => x && !(x as THREE.ShaderMaterial).isShaderMaterial && x.visible && !(x.transparent && x.opacity < 0.5));
}

export function buildHeightField(root: THREE.Object3D, extent: { minX: number; maxX: number; minZ: number; maxZ: number }, o: HeightFieldOptions = {}): HeightField {
  const cell = o.cell ?? 0.5, minY = o.minY ?? 0.05, include = o.include ?? defaultInclude;
  const nx = Math.ceil((extent.maxX - extent.minX) / cell), nz = Math.ceil((extent.maxZ - extent.minZ) / cell);
  const hf: HeightField = {
    x0: extent.minX, z0: extent.minZ, cell, nx, nz,
    lo: new Float32Array(nx * nz).fill(Infinity), hi: new Float32Array(nx * nz).fill(-Infinity), who: new Int32Array(nx * nz).fill(-1), names: [],
  };
  const stamp = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, id: number) => {
    if (y1 < minY) return;
    const i0 = Math.max(0, Math.floor((x0 - hf.x0) / cell)), i1 = Math.min(nx - 1, Math.floor((x1 - hf.x0) / cell));
    const k0 = Math.max(0, Math.floor((z0 - hf.z0) / cell)), k1 = Math.min(nz - 1, Math.floor((z1 - hf.z0) / cell));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const c = k * nx + i;
      if (y0 < hf.lo[c]!) hf.lo[c] = Math.max(y0, minY);
      if (y1 > hf.hi[c]!) { hf.hi[c] = y1; hf.who[c] = id; }
    }
  };
  root.updateMatrixWorld(true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m4 = new THREE.Matrix4(), box = new THREE.Box3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !include(mesh)) return;
    let hidden = false;
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (!p.visible) { hidden = true; break; }
    if (hidden) return;
    const id = hf.names.push(mesh.name || mesh.parent?.name || mesh.type) - 1;
    const geo = mesh.geometry;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    if (inst) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, m4);
        box.copy(geo.boundingBox!).applyMatrix4(m4.premultiply(mesh.matrixWorld));
        stamp(box.min.x, box.max.x, box.min.z, box.max.z, box.min.y, box.max.y, id);
      }
      return;
    }
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const start = Math.max(0, geo.drawRange.start), end = Math.min(n, geo.drawRange.start + geo.drawRange.count);
    for (let t = start; t + 2 < end; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
      stamp(Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z), Math.min(a.y, b.y, c.y), Math.max(a.y, b.y, c.y), id);
    }
  });
  return hf;
}

/** Label of the world object blocking the ray p + t·d before it climbs above maxY, or null. */
export function heightFieldHit(hf: HeightField, p: V3, d: V3, maxY = 40, skip = 0.3): string | null {
  if (d.y <= 1e-6) return null;
  const step = hf.cell * 0.5, tMax = (maxY - p.y) / d.y;
  for (let t = skip; t <= tMax; t += step) {
    const x = p.x + d.x * t, z = p.z + d.z * t, y = p.y + d.y * t;
    const i = Math.floor((x - hf.x0) / hf.cell), k = Math.floor((z - hf.z0) / hf.cell);
    if (i < 0 || k < 0 || i >= hf.nx || k >= hf.nz) continue;
    const cI = k * hf.nx + i;
    if (y >= hf.lo[cI]! && y <= hf.hi[cI]!) return hf.names[hf.who[cI]!] ?? 'world';
  }
  return null;
}
