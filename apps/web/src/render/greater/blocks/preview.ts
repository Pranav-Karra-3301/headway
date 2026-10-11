// Owner: G2. Preview: /greater-blocks-dev.html — the outer neighbourhoods on G0's greater-town roads around the town
// board, with the game's look (Stage: lights, sky, post chain). Query flags:
//   view=<u visible vertically>  tx, tz=<look-at>  palette=a|b|c  light=day|dusk  post=0|1  town=0|1  land=0|1
//   blocks=0 (roads only)   hl=1 (highlight fade on)
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { Stage } from '../../post/stage';
import type { LightMode, PaletteId } from '../../types';
import { greaterGrid } from '../grid';
import { createGreaterRoadsLayer, preloadGreaterRoads } from '../roads/index';
import { createGreaterBlocksLayer, preloadGreaterBlocks } from './layer';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const light = (q.get('light') === 'dusk' ? 'dusk' : 'day') as LightMode;
const msg = document.getElementById('msg')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;

async function main(): Promise<void> {
  const grid = greaterGrid(TOWN);
  const stage = new Stage(canvas, {
    bounds: grid.bounds, palette, light, maxHeight: 14, post: q.get('post') !== '0', preserveDrawingBuffer: true, autoQuality: false,
    camera: { view: num('view', 104), target: { x: num('tx', 0), z: num('tz', 2) }, interactive: q.get('interactive') === '1' },
  });
  await Promise.all([preloadGreaterRoads(), q.get('blocks') !== '0' ? preloadGreaterBlocks(TOWN) : Promise.resolve()]);
  const roads = createGreaterRoadsLayer(TOWN, { palette });
  stage.scene.add(roads.object);
  const t0 = performance.now();
  const blocks = q.get('blocks') !== '0' ? createGreaterBlocksLayer(TOWN, { palette }) : null;
  const buildMs = performance.now() - t0;
  if (blocks) stage.scene.add(blocks.object);
  if (blocks && q.get('hl') === '1') blocks.setFade(0.6);

  let town: { object: THREE.Object3D; update(dt: number): void } | null = null;
  if (q.get('town') !== '0') {
    try {
      const mod = await import('../../town/index');
      town = mod.createStaticTown(TOWN, { palette, detail: 'toy' });
      stage.scene.add(town.object);
    } catch (e) {
      console.warn('[greater-blocks] static town unavailable', e);
    }
  }
  if (q.get('land') !== '0') stage.scene.add(landStandIns(grid));
  if (q.has('solo')) stage.scene.add(await solo(q.get('solo')!));

  const s = blocks?.stats;
  const stats = s ? `${s.items} items · ${s.trees} trees · ${s.lots} lots · ${s.poles} poles · ${s.meshes} meshes · ${s.placeholders} placeholders · build ${buildMs.toFixed(0)} ms` : 'roads only';
  msg.textContent = `greater blocks · ${stats}`;
  const clock = new THREE.Clock();
  let frames = 0;
  stage.renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    town?.update(dt);
    blocks?.update({ dtS: dt });
    stage.render(dt);
    if (++frames === 3) {
      const info = stage.renderer.info.render;
      msg.textContent = `greater blocks · ${stats} · ${info.calls} calls (whole scene) · ${(info.triangles / 1000).toFixed(0)}k tris`;
      (window as unknown as { __greaterReady: boolean }).__greaterReady = true;
    }
  });
  addEventListener('resize', () => stage.resize());
}

/** ?solo=<kind>: four copies at rot 0, π/2, π, −π/2 along x (front faces +z at rot 0), at tx/tz. */
async function solo(kind: string): Promise<THREE.Object3D> {
  const { createRegistry } = await import('../../assets/index');
  const { createClayKit, createClayKitShared, placementSeed } = await import('../../town/kitContext');
  const { kenneyIdsFor, preloadKenney } = await import('../../assets/kenney/index');
  const reg = createRegistry();
  await preloadKenney(kenneyIdsFor([kind]));
  const sh = createClayKitShared(reg.roles, palette);
  const g = new THREE.Group();
  [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((rot, i) => {
    const x = num('tx', 0) - 7.5 + i * 5, z = num('tz', 2);
    g.add(reg.build(createClayKit(sh, placementSeed(kind, x, z)), { kind, x, z, rot }));
  });
  g.position.y = 3;
  return g;
}

/** Preview-only stand-ins: a flat bay (E2 owns the real water) and soft mounds on the ridge-spur cells (E1 terrain). */
function landStandIns(grid: ReturnType<typeof greaterGrid>): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape(grid.water.map((p) => new THREE.Vector2(p.x, -p.z)));
  const wgeo = new THREE.ShapeGeometry(shape);
  wgeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: '#7FC6C9', roughness: 0.35 }));
  water.position.y = -0.3;
  water.receiveShadow = true;
  g.add(water);
  const b = grid.bounds;
  const sgeo = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ);
  sgeo.rotateX(-Math.PI / 2);
  const sand = new THREE.Mesh(sgeo, new THREE.MeshStandardMaterial({ color: '#E6D6B4', roughness: 1 }));
  sand.position.set((b.minX + b.maxX) / 2, -0.6, (b.minZ + b.maxZ) / 2);
  g.add(sand);
  const mound = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: '#7DBB8A', roughness: 0.95 });
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    if (grid.use[r]![c] !== 'hill') continue;
    const p = { x: grid.origin.x + (c + 0.5) * grid.tile, z: grid.origin.z + (r + 0.5) * grid.tile };
    const m = new THREE.Mesh(mound, mat);
    m.scale.set(3.5, 1.3 + ((c * 7 + r * 13) % 5) * 0.3, 3.5);
    m.position.set(p.x, -0.2, p.z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

main().catch((e) => {
  msg.textContent = `error: ${(e as Error).message}`;
  console.error(e);
});
