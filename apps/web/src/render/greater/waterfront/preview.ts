// Owner: G3. Preview: /greater-waterfront-dev.html — the waterfront on the G0 roads around the town board.
// Query flags: view=<u visible vertically> tx, tz=<look-at> palette=a|b|c light=day|dusk post=0|1 town=0|1 roads=0|1
//   boats=0|1 land=0 (hide the preview-only bay + shore stand-ins; E2 owns the real water) interactive=1
// Presets: v=harbour | lakeshore | beach | point (overrides view/tx/tz).
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { Stage } from '../../post/stage';
import type { LightMode, PaletteId } from '../../types';
import { greaterGrid } from '../grid';
import { createGreaterRoadsLayer, preloadGreaterRoads } from '../roads/index';
import { createWaterfrontLayer, preloadWaterfront, WF } from './index';

const q = new URLSearchParams(location.search);
const PRESETS: Record<string, [number, number, number]> = {
  harbour: [34, 44, 27], lakeshore: [40, -36, 46], beach: [30, 18, 31], point: [30, 2, 44], east: [48, 40, 22], south: [60, -20, 42],
};
const pre = PRESETS[q.get('v') ?? ''];
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const light = (q.get('light') === 'dusk' ? 'dusk' : 'day') as LightMode;
const msg = document.getElementById('msg')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;

async function main(): Promise<void> {
  const grid = greaterGrid(TOWN);
  const stage = new Stage(canvas, {
    bounds: grid.bounds, palette, light, maxHeight: 14, post: q.get('post') !== '0', preserveDrawingBuffer: true, autoQuality: false,
    camera: { view: pre ? pre[0] : num('view', 104), target: { x: pre ? pre[1] : num('tx', 0), z: pre ? pre[2] : num('tz', 2) }, interactive: q.get('interactive') === '1' },
  });
  await Promise.all([preloadGreaterRoads(), preloadWaterfront(TOWN)]);
  if (q.get('roads') !== '0') stage.scene.add(createGreaterRoadsLayer(TOWN, { palette }).object);
  if (q.get('land') !== '0') stage.scene.add(bayStandIn(grid));
  if (q.get('town') !== '0') {
    try {
      const mod = await import('../../town/index');
      stage.scene.add(mod.createStaticTown(TOWN, { palette, detail: 'toy' }).object);
    } catch (e) {
      console.warn('[greater-waterfront] static town unavailable', e);
    }
  }
  const t0 = performance.now();
  const wf = createWaterfrontLayer(TOWN, { palette, boats: q.get('boats') !== '0' });
  const ms = performance.now() - t0;
  stage.scene.add(wf.object);
  const s = wf.stats;
  const stats = `waterfront · ${wf.plan.runs.length} runs · ${wf.plan.decks.length} decks · ${s.items} items · ${s.boats} boats · ${s.trees} trees · ${s.drawCalls} layer calls · ${(s.vertices / 1000).toFixed(0)}k verts · ${ms.toFixed(0)} ms`;
  msg.textContent = stats;
  const clock = new THREE.Clock();
  let frames = 0;
  stage.renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    wf.update({ timeS: clock.elapsedTime });
    stage.render(dt);
    if (++frames === 3) {
      const info = stage.renderer.info.render;
      msg.textContent = `${stats} · scene ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
      (window as unknown as { __waterfrontReady: boolean }).__waterfrontReady = true;
    }
  });
  addEventListener('resize', () => stage.resize());
}

/** Preview-only stand-ins for E2: a flat bay at the waterline and a sandy slope from the shore down into it. */
function bayStandIn(grid: ReturnType<typeof greaterGrid>): THREE.Group {
  const g = new THREE.Group();
  const b = grid.bounds, pad = 14;
  const wgeo = new THREE.PlaneGeometry(b.maxX - b.minX + 2 * pad, b.maxZ - b.minZ + 2 * pad);
  wgeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: '#8FD3D3', roughness: 0.4 }));
  water.position.set((b.minX + b.maxX) / 2, WF.waterY, (b.minZ + b.maxZ) / 2);
  water.receiveShadow = true;
  g.add(water);
  // sand skirt: shore (y 0) → 1.6 u seaward (y −1)
  const S = grid.shore, pos: number[] = [];
  for (let i = 0; i + 1 < S.length; i++) {
    const a = S[i]!, c = S[i + 1]!, L = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    const n = { x: (c.z - a.z) / L, z: -(c.x - a.x) / L }; // seaward (left of east → west travel)
    const a2 = { x: a.x + n.x * 1.6, z: a.z + n.z * 1.6 }, c2 = { x: c.x + n.x * 1.6, z: c.z + n.z * 1.6 };
    pos.push(a.x, -0.01, a.z, a2.x, -1.0, a2.z, c.x, -0.01, c.z, c.x, -0.01, c.z, a2.x, -1.0, a2.z, c2.x, -1.0, c2.z);
  }
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sgeo.computeVertexNormals();
  const sand = new THREE.Mesh(sgeo, new THREE.MeshStandardMaterial({ color: '#EAD9B5', roughness: 1, side: THREE.DoubleSide }));
  sand.receiveShadow = true;
  g.add(sand);
  const under = new THREE.Mesh(wgeo.clone(), new THREE.MeshStandardMaterial({ color: '#D9C8A2', roughness: 1 }));
  under.position.set((b.minX + b.maxX) / 2, -1.2, (b.minZ + b.maxZ) / 2);
  g.add(under);
  return g;
}

main().catch((e) => {
  msg.textContent = `error: ${(e as Error).message}`;
  console.error(e);
});
