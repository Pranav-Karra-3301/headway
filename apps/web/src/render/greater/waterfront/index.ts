// Owner: G3. Greater-town waterfront layer: the lakeshore promenade, boardwalks, piers, the harbour at Marina Rd,
// pavilion, lamps, benches, bins, a café kiosk, flags, trees and moored boats — planned by ./plan from the G0 grid.
//
//   await preloadWaterfront();                       // Kenney models behind the registry kinds (lamps, trees, boats)
//   const wf = createWaterfrontLayer(TOWN, { palette });
//   scene.add(wf.object);  …  wf.update({ timeS });  // boats bob ≤ 0.06 u
//
// Draw calls: 1 static mesh (decks, paving, rails, furniture — baked, clay KitMaterial) + 1 InstancedMesh per tree
// prototype (≤ 6, sway) + 1 mesh per moored boat (bobbing, ≤ 10). Lamp heads glow at dusk (palette role `lamp`).
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import { createRegistry, type AssetRegistry } from '../../assets/index';
import { kenneyIdsFor, preloadKenney } from '../../assets/kenney/index';
import { bakeGeometry, recolorBaked, type Baked } from '../../kit/bake';
import type { FrameContext, RenderLayer } from '../../layers';
import { KitMaterial } from '../../materials';
import { createClayKit, createClayKitShared, disposeClayKitShared, placementSeed, roleResolver } from '../../town/kitContext';
import type { PaletteId } from '../../types';
import { buildBoardwalk, buildBollard, buildDeck, buildPavilion, buildPromenade, buildSeaWall, buildTelescope, WF_ROLES } from './build';
import { planWaterfront, type WaterfrontPlan, type WfItem } from './plan';

export { planWaterfront, inWaterfront, runAt, WF } from './plan';
export type { WaterfrontPlan, WfRun, WfDeck, WfItem, WfPavilion, RunKind, DeckKind } from './plan';
export { WF_ROLES } from './build';

export interface WaterfrontOptions {
  palette?: PaletteId;
  /** Moored boats (default true). Turn off if E2's marina already fills the harbour. */
  boats?: boolean;
  /** Share a registry (e.g. the composer's); default: one built here. */
  registry?: AssetRegistry;
}

export interface WaterfrontLayer extends RenderLayer {
  readonly plan: WaterfrontPlan;
  readonly stats: { drawCalls: number; items: number; boats: number; trees: number; vertices: number };
  update(ctx: Pick<FrameContext, 'timeS'> | FrameContext): void;
}

let sharedRegistry: AssetRegistry | null = null;
function registry(): AssetRegistry {
  if (!sharedRegistry) sharedRegistry = createRegistry();
  return sharedRegistry;
}

/** Registry kinds the waterfront places (for preloading their Kenney models). */
export function waterfrontKinds(map: TownMap): string[] {
  return [...new Set(planWaterfront(map).items.map((i) => i.kind).filter((k) => !k.startsWith('wf.')))].sort();
}

/** Preload every Kenney model the waterfront's registry kinds use (call before createWaterfrontLayer). */
export function preloadWaterfront(map: TownMap): Promise<void> {
  registry();
  return preloadKenney(kenneyIdsFor(waterfrontKinds(map)));
}

const BOB = { amp: 0.05, roll: 0.035 };
/** Registry kinds drawn as swaying InstancedMeshes (everything else bakes into the static mesh). */
const TREE_KINDS = new Set(['veg.oak', 'veg.maple', 'veg.birch', 'veg.poplar', 'veg.cherry', 'veg.pine']);

export function createWaterfrontLayer(map: TownMap, opts: WaterfrontOptions = {}): WaterfrontLayer {
  let palette: PaletteId = opts.palette ?? 'a';
  const plan = planWaterfront(map);
  const reg = opts.registry ?? registry();
  const roles = { ...reg.roles, ...WF_ROLES };
  const resolve = roleResolver(roles);
  const kit = createClayKitShared(roles, palette);
  const object = new THREE.Group();
  object.name = 'greater-waterfront';
  const bakes: Baked[] = [];

  const staticMat = new KitMaterial({ roughness: 0.86 });
  const treeMat = new KitMaterial({ sway: true });
  const boatMat = new KitMaterial({ roughness: 0.7 });

  // ---- procedural pieces + static registry items → one baked mesh
  const statics = new THREE.Group();
  for (const run of plan.runs) {
    statics.add(run.kind === 'promenade' ? buildPromenade(run) : buildBoardwalk(run));
    if (run.kind === 'promenade') statics.add(buildSeaWall(run));
  }
  for (const d of plan.decks) statics.add(buildDeck(d));
  for (const p of plan.pavilions) statics.add(buildPavilion(p));

  const build = (it: WfItem): THREE.Object3D => {
    let o: THREE.Object3D;
    if (it.kind === 'wf.bollard') o = buildBollard();
    else if (it.kind === 'wf.telescope') o = buildTelescope();
    else o = reg.build(createClayKit(kit, placementSeed(it.kind, it.x, it.z)), { kind: it.kind, x: 0, z: 0, ...(it.params ? { params: it.params } : {}) });
    o.position.set(it.x, it.y, it.z);
    o.rotation.y = it.rot;
    if (it.scale) o.scale.setScalar(it.scale);
    return o;
  };

  const trees = new Map<string, { baked: Baked; ms: THREE.Matrix4[] }>();
  const boats: Array<{ mesh: THREE.Mesh; y: number; rot: number; ph: number }> = [];
  let items = 0;
  for (const it of plan.items) {
    if (it.boat && opts.boats === false) continue;
    const def = reg.get(it.kind);
    items++;
    if (def?.sway && TREE_KINDS.has(it.kind)) {
      const key = `${it.kind}#${String(it.params?.variant ?? 0)}`;
      let t = trees.get(key);
      if (!t) {
        const proto = reg.build(createClayKit(kit, placementSeed(it.kind, 0, Number(it.params?.variant ?? 0))), { kind: it.kind, x: 0, z: 0, ...(it.params ? { params: it.params } : {}) });
        t = { baked: bakeGeometry(proto, palette, { resolve }), ms: [] };
        trees.set(key, t);
        bakes.push(t.baked);
      }
      t.ms.push(new THREE.Matrix4().compose(new THREE.Vector3(it.x, it.y, it.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot), new THREE.Vector3().setScalar(it.scale ?? 1)));
      continue;
    }
    if (it.boat) {
      const proto = build({ ...it, x: 0, z: 0, y: 0, rot: 0 });
      const b = bakeGeometry(proto, palette, { resolve });
      bakes.push(b);
      const mesh = new THREE.Mesh(b.geometry, boatMat);
      mesh.name = `waterfront:boat:${it.kind}`;
      mesh.position.set(it.x, it.y, it.z);
      mesh.rotation.y = it.rot;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      object.add(mesh);
      boats.push({ mesh, y: it.y, rot: it.rot, ph: (it.x * 0.37 + it.z * 0.61) % (Math.PI * 2) });
      continue;
    }
    statics.add(build(it));
  }
  const sb = bakeGeometry(statics, palette, { resolve });
  bakes.push(sb);
  const staticMesh = new THREE.Mesh(sb.geometry, staticMat);
  staticMesh.name = 'waterfront:static';
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  staticMesh.matrixAutoUpdate = false;
  object.add(staticMesh);

  let treeCount = 0;
  for (const [key, t] of trees) {
    const mesh = new THREE.InstancedMesh(t.baked.geometry, treeMat, t.ms.length);
    mesh.name = `waterfront:tree:${key}`;
    t.ms.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    object.add(mesh);
    treeCount += t.ms.length;
  }
  // geometry from the procedural builders is cloned into the bake; free the kit's per-placement caches
  disposeClayKitShared(kit);

  const vertices = bakes.reduce((n, b) => n + b.geometry.getAttribute('position').count, 0);
  const stats = { drawCalls: 1 + trees.size + boats.length, items, boats: boats.length, trees: treeCount, vertices };

  return {
    name: 'greater-waterfront',
    object,
    plan,
    stats,
    update(ctx) {
      const t = ctx.timeS ?? 0;
      for (const b of boats) {
        b.mesh.position.y = b.y + Math.sin(t * 1.3 + b.ph) * BOB.amp;
        b.mesh.rotation.z = Math.sin(t * 1.05 + b.ph * 1.7) * BOB.roll;
        b.mesh.rotation.x = Math.sin(t * 0.9 + b.ph * 0.6) * BOB.roll * 0.6;
      }
    },
    setPalette(p: PaletteId) {
      palette = p;
      for (const b of bakes) recolorBaked(b, p);
    },
    dispose() {
      for (const b of bakes) b.geometry.dispose();
      staticMat.dispose();
      treeMat.dispose();
      boatMat.dispose();
    },
  };
}
