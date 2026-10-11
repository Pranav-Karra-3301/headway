// Owner: T2.1. Trees: 5 variants from primitives. Crowns are tint()-tagged so instanced forests give every
// tree its own jittered leaf colour; trunks keep the `trunk` role. `createForest` renders any number of trees
// as one InstancedMesh per variant (≤ 5 draw calls) with the swaying KitMaterial.
import * as THREE from 'three';
import { KitMaterial } from '../materials';
import { colorOf, DEFAULT_PALETTE, paletteOf, type Palette } from '../palettes';
import type { DetailMode, PaletteId } from '../types';
import { bakeGeometry, recolorBaked, setBakedDetail, type Baked } from './bake';
import { at, capsule, cone, cyl, prng, sphere, tint } from './prims';

export const TREE_VARIANTS = ['round', 'cluster', 'pine', 'poplar', 'bush'] as const;
export type TreeVariant = (typeof TREE_VARIANTS)[number];

/** Approximate unscaled crown radius / height per variant (for spacing). */
export const TREE_SIZE: Record<TreeVariant, { r: number; h: number }> = {
  round: { r: 0.78, h: 2.05 },
  cluster: { r: 0.85, h: 2.2 },
  pine: { r: 0.75, h: 2.45 },
  poplar: { r: 0.42, h: 2.65 },
  bush: { r: 0.7, h: 0.72 },
};

const variantName = (v: number | TreeVariant): TreeVariant =>
  typeof v === 'number' ? TREE_VARIANTS[((v % TREE_VARIANTS.length) + TREE_VARIANTS.length) % TREE_VARIANTS.length]! : v;

/** One tree, base at y = 0. `leaf` picks the palette leaf (or pine) colour for unbaked use. */
export function makeTree(variant: number | TreeVariant = 0, leaf = 0): THREE.Group {
  const name = variantName(variant);
  const g = new THREE.Group();
  g.name = `tree:${name}`;
  switch (name) {
    case 'round': {
      g.add(at(cyl(0.1, 0.14, 0.8, 'trunk', 0, 8), 0, 0.4, 0));
      const s = sphere(0.76, 'leaf', leaf, 16, 11); s.scale.set(1, 0.9, 1);
      g.add(tint(at(s, 0, 1.36, 0)));
      break;
    }
    case 'cluster': {
      g.add(at(cyl(0.1, 0.14, 0.9, 'trunk', 0, 8), 0, 0.45, 0));
      g.add(tint(at(sphere(0.55, 'leaf', leaf, 14, 10), -0.3, 1.3, 0.12)));
      g.add(tint(at(sphere(0.5, 'leaf', leaf, 14, 10), 0.34, 1.25, -0.14)));
      g.add(tint(at(sphere(0.46, 'leaf', leaf, 14, 10), 0.02, 1.74, 0.02)));
      break;
    }
    case 'pine': {
      g.add(at(cyl(0.08, 0.12, 0.6, 'trunk', 0, 8), 0, 0.3, 0));
      g.add(tint(at(cone(0.78, 1.0, 'pine', leaf, 12), 0, 0.95, 0)));
      g.add(tint(at(cone(0.6, 0.9, 'pine', leaf, 12), 0, 1.5, 0)));
      g.add(tint(at(cone(0.42, 0.8, 'pine', leaf, 12), 0, 2.05, 0)));
      break;
    }
    case 'poplar': {
      g.add(at(cyl(0.07, 0.1, 0.5, 'trunk', 0, 8), 0, 0.25, 0));
      g.add(tint(at(capsule(0.4, 1.45, 'leaf', leaf, 5, 12), 0, 1.45, 0)));
      break;
    }
    case 'bush': {
      const a = sphere(0.4, 'leaf', leaf, 12, 8); a.scale.set(1, 0.85, 1);
      const b = sphere(0.33, 'leaf', leaf, 12, 8); b.scale.set(1, 0.85, 1);
      const c = sphere(0.3, 'leaf', leaf, 12, 8); c.scale.set(1, 0.85, 1);
      g.add(tint(at(a, 0, 0.36, 0)), tint(at(b, 0.42, 0.28, 0.1)), tint(at(c, -0.38, 0.26, -0.08)));
      break;
    }
  }
  return g;
}

export interface TreePlacement {
  x: number; z: number;
  variant?: number | TreeVariant;
  /** Base scale (a ±15 % jitter is applied on top). */
  scale?: number;
  /** Yaw in radians (random when omitted). */
  rot?: number;
  /** Palette leaf/pine colour index (random when omitted). */
  leaf?: number;
}

export interface Forest {
  object: THREE.Group;
  meshes: THREE.InstancedMesh[];
  material: KitMaterial;
  setPalette(p: PaletteId | Palette): void;
  setDetail(d: DetailMode): void;
  dispose(): void;
}

/** Instanced trees: one InstancedMesh per variant, per-instance size/yaw/colour jitter, wind sway. */
export function createForest(trees: TreePlacement[], opts: { palette?: PaletteId; seed?: number; sway?: boolean } = {}): Forest {
  const rnd = prng(opts.seed ?? 7);
  const material = new KitMaterial({ sway: opts.sway ?? true });
  const object = new THREE.Group();
  object.name = 'forest';
  const meshes: THREE.InstancedMesh[] = [];
  const bakes: Baked[] = [];
  const jitter: Array<{ mesh: THREE.InstancedMesh; i: number; pine: boolean; leaf: number; dh: number; ds: number; dl: number }> = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  for (const name of TREE_VARIANTS) {
    const list = trees.filter((t) => variantName(t.variant ?? 0) === name);
    if (!list.length) continue;
    const baked = bakeGeometry(makeTree(name), opts.palette ?? DEFAULT_PALETTE);
    bakes.push(baked);
    const mesh = new THREE.InstancedMesh(baked.geometry, material, list.length);
    mesh.name = `trees:${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((t, i) => {
      const sc = (t.scale ?? 1) * (0.86 + rnd() * 0.28);
      q.setFromAxisAngle(up, t.rot ?? rnd() * Math.PI * 2);
      m4.compose(p.set(t.x, 0, t.z), q, s.set(sc, sc * (0.92 + rnd() * 0.16), sc));
      mesh.setMatrixAt(i, m4);
      jitter.push({ mesh, i, pine: name === 'pine', leaf: t.leaf ?? Math.floor(rnd() * 4), dh: (rnd() - 0.5) * 0.035, ds: (rnd() - 0.5) * 0.12, dl: (rnd() - 0.5) * 0.08 });
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
    object.add(mesh);
  }

  const col = new THREE.Color();
  const setPalette = (pal: PaletteId | Palette) => {
    const P = paletteOf(pal);
    for (const b of bakes) recolorBaked(b, P);
    for (const j of jitter) {
      col.set(colorOf(P, j.pine ? 'pine' : 'leaf', j.leaf)).offsetHSL(j.dh, j.ds, j.dl);
      j.mesh.setColorAt(j.i, col);
    }
    for (const m of meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  setPalette(opts.palette ?? DEFAULT_PALETTE);

  return {
    object, meshes, material, setPalette,
    setDetail: (d) => { for (const b of bakes) setBakedDetail(b, d === 'toy'); },
    dispose: () => { for (const b of bakes) b.geometry.dispose(); for (const m of meshes) m.dispose(); material.dispose(); },
  };
}
