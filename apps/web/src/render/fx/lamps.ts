// Owner: T2.4. Street lamps. District lamps (A6 `st.lamp`, placed by D1–D5) only get their dusk glow here; where no
// district owns the ground, FX lines the streets with kit lamps on the kerb (`kerbLamps`, deterministic), drawn as
// one InstancedMesh whose globes glow through the KitMaterial dusk emission.
import * as THREE from 'three';
import { projectOnPolyline, ROAD_WIDTH, type TownMap, type Vec2 } from '@headway/sim';
import { bakeGeometry, makeStreetLamp, recolorBaked, setBakedDetail, type Baked } from '../kit';
import { KitMaterial } from '../materials';
import { SCENERY, sceneryFootprint, type SceneryItem } from '../scenery';
import type { PaletteId } from '../types';

export interface KerbLamp { x: number; z: number }
export interface KerbLampOptions {
  /** Spacing along a street (u). */
  spacing?: number;
  /** Extra veto (e.g. ground owned by a district). */
  blocked?: (p: Vec2) => boolean;
  /** Base scenery whose footprints lamps avoid (default SCENERY). */
  scenery?: readonly SceneryItem[];
}

const KERB = ROAD_WIDTH / 2 + 0.5;

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

/** Kerb positions every `spacing` u along every street, alternating sides, clear of junctions, stops, queues,
 *  platforms, the rail, other roads, base-scenery footprints and the board edge. Pure and deterministic. */
export function kerbLamps(map: TownMap, opts: KerbLampOptions = {}): KerbLamp[] {
  const spacing = opts.spacing ?? 7;
  const scenery = opts.scenery ?? SCENERY;
  const b = map.bounds;
  const boxes = scenery.map((it) => {
    const f = sceneryFootprint(it);
    const pad = it.kind === 'tree' ? 0.15 : it.kind === 'lawn' ? -0.4 : 0.3;
    return { minX: f.minX - pad, maxX: f.maxX + pad, minZ: f.minZ - pad, maxZ: f.maxZ + pad };
  });
  const ok = (p: Vec2): boolean => {
    if (p.x < b.minX + 1.5 || p.x > b.maxX - 1.5 || p.z < b.minZ + 1.5 || p.z > b.maxZ - 1.5) return false;
    for (const n of map.roads.nodes) if (Math.hypot(p.x - n.p.x, p.z - n.p.z) < 2.6) return false;
    for (const s of map.stops) {
      if (Math.hypot(p.x - s.p.x, p.z - s.p.z) < 2.6) return false;
      if (segDist(p, s.p, { x: s.p.x + s.queueDir.x * 5.5, z: s.p.z + s.queueDir.z * 5.5 }) < 1.0) return false;
    }
    for (const s of map.rail.stations) {
      if (Math.hypot(p.x - s.platform.x, p.z - s.platform.z) < 2.6) return false;
      if (segDist(p, s.platform, { x: s.platform.x + s.queueDir.x * 5.5, z: s.platform.z + s.queueDir.z * 5.5 }) < 1.0) return false;
    }
    if (projectOnPolyline(map.rail.loop, p).d < 1.7) return false;
    for (const e of map.roads.edges) if (projectOnPolyline(e.path, p).d < KERB - 0.1) return false;
    for (const f of boxes) if (p.x > f.minX && p.x < f.maxX && p.z > f.minZ && p.z < f.maxZ) return false;
    return !opts.blocked?.(p);
  };
  const out: KerbLamp[] = [];
  const edges = [...map.roads.edges].sort((a, c) => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));
  for (const e of edges) {
    const pts = e.path.points, L = e.path.length;
    if (L < 6) continue;
    const count = Math.max(1, Math.floor(L / spacing));
    const step = L / count;
    for (let i = 0; i < count; i++) {
      const s = step * (i + 0.5);
      // tangent at s from the polyline segment containing it
      let k = 0;
      while (k < pts.length - 2 && e.path.cum[k + 1]! < s) k++;
      const a = pts[k]!, c = pts[k + 1]!;
      const t = Math.max(0, Math.min(1, (s - e.path.cum[k]!) / (Math.hypot(c.x - a.x, c.z - a.z) || 1)));
      const len = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      const tx = (c.x - a.x) / len, tz = (c.z - a.z) / len;
      const px = a.x + (c.x - a.x) * t, pz = a.z + (c.z - a.z) * t;
      const side = i % 2 === 0 ? 1 : -1;
      const first = { x: px - tz * KERB * side, z: pz + tx * KERB * side };
      const second = { x: px + tz * KERB * side, z: pz - tx * KERB * side };
      const p = ok(first) ? first : ok(second) ? second : null;
      if (p) out.push({ x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000 });
    }
  }
  return out;
}

export interface LampPosts {
  readonly mesh: THREE.InstancedMesh;
  readonly material: KitMaterial;
  setPalette(p: PaletteId): void;
  dispose(): void;
}

/** Kit lamps at the given kerb positions: one InstancedMesh; globes glow at dusk (role `lamp`). */
export function createLampPosts(lamps: readonly KerbLamp[], palette: PaletteId = 'a'): LampPosts {
  const baked: Baked = bakeGeometry(makeStreetLamp(), palette);
  setBakedDetail(baked, true);
  const material = new KitMaterial();
  const mesh = new THREE.InstancedMesh(baked.geometry, material, Math.max(1, lamps.length));
  mesh.count = lamps.length;
  mesh.name = 'fx:lampPosts';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  lamps.forEach((l, i) => mesh.setMatrixAt(i, m.makeTranslation(l.x, 0, l.z)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return {
    mesh, material,
    setPalette(p) { recolorBaked(baked, p); },
    dispose() { baked.geometry.dispose(); material.dispose(); },
  };
}
