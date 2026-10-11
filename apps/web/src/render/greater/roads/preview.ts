// Owner: G0. Preview: /greater-roads-dev.html — the greater-town road network around the town board, with the game's
// look (Stage: lights, sky, post chain). Query flags:
//   view=<u visible vertically>  tx, tz=<look-at>  palette=a|b|c  light=day|dusk  post=0|1
//   town=1 (T2.2 static town on the board; 0 = plain board + road strips)   lanes=1 (lane graph)   blocks=1 (zones)
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { Stage } from '../../post/stage';
import type { LightMode, PaletteId } from '../../types';
import { greaterGrid, type Lane, type ZoneHint } from '../grid';
import { createGreaterRoadsLayer, preloadGreaterRoads } from './layer';
import { offsetRight } from './lanes';

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
  await preloadGreaterRoads();
  const layer = createGreaterRoadsLayer(TOWN, { palette });
  stage.scene.add(layer.object);

  let town: { object: THREE.Object3D; update(dt: number): void } | null = null;
  if (q.get('town') !== '0') {
    try {
      const mod = await import('../../town/index');
      town = mod.createStaticTown(TOWN, { palette, detail: 'toy' });
      stage.scene.add(town.object);
    } catch (e) {
      console.warn('[greater-roads] static town unavailable, drawing plain strips', e);
    }
  }
  if (!town) stage.scene.add(plainTown());
  if (q.get('lanes') === '1') stage.scene.add(laneDebug(grid.lanes));
  if (q.get('blocks') === '1') stage.scene.add(blockDebug(grid.blocks));

  const stats = `${grid.roads.length} tiles · ${grid.lanes.length} lanes · ${grid.roundabouts.length} roundabouts · ${grid.blocks.length} blocks · kenney ${layer.kenney ? 'yes' : 'fallback'}`;
  msg.textContent = `greater roads · ${stats}`;
  const clock = new THREE.Clock();
  let frames = 0;
  stage.renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    town?.update(dt);
    stage.render(dt);
    if (++frames === 3) {
      const info = stage.renderer.info.render;
      msg.textContent = `greater roads · ${stats} · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
      (window as unknown as { __greaterReady: boolean }).__greaterReady = true;
    }
  });
  addEventListener('resize', () => stage.resize());
}

/** Board slab + the town's road strips + rail, when the static town is not available. */
function plainTown(): THREE.Group {
  const g = new THREE.Group();
  const b = TOWN.bounds;
  const board = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, 1, b.maxZ - b.minZ), new THREE.MeshStandardMaterial({ color: '#A8D8B9', roughness: 0.9 }));
  board.position.set(0, -0.5, 0);
  board.receiveShadow = true;
  g.add(board);
  const strip = (pts: Vec2[], closed: boolean, half: number, color: string, y: number) => {
    const P = closed ? [...pts, pts[0]!] : pts;
    const L = offsetRight(P, -half), R = offsetRight(P, half);
    const pos: number[] = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = L[i]!, b2 = L[i + 1]!, c = R[i + 1]!, d = R[i]!;
      pos.push(a.x, y, a.z, d.x, y, d.z, c.x, y, c.z, a.x, y, a.z, c.x, y, c.z, b2.x, y, b2.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    g.add(m);
  };
  for (const e of TOWN.roads.edges) strip(e.path.points, false, 1.2, '#F4EBDD', 0.04);
  strip(TOWN.rail.loop.points, true, 0.8, '#C9B79C', 0.03);
  return g;
}

const LANE_COLOR: Record<string, string> = {
  ring: '#1FA99A', parkway: '#F0A830', avenue: '#2E5BDA', radial: '#3E9A5F', local: '#6B7280',
  junction: '#9AA0A6', roundabout: '#8A6BD8', uturn: '#E5484D', highway: '#000000', ramp: '#000000',
};

function laneDebug(lanes: Lane[]): THREE.Group {
  const g = new THREE.Group();
  const mats = new Map<string, THREE.MeshBasicMaterial>();
  const mat = (k: string) => {
    let m = mats.get(k);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: LANE_COLOR[k] ?? '#000', depthTest: false }); mats.set(k, m); }
    return m;
  };
  for (const l of lanes) {
    const P = l.path.points;
    const L = offsetRight(P, -0.07), R = offsetRight(P, 0.07), y = 0.3;
    const pos: number[] = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = L[i]!, b = L[i + 1]!, c = R[i + 1]!, d = R[i]!;
      pos.push(a.x, y, a.z, d.x, y, d.z, c.x, y, c.z, a.x, y, a.z, c.x, y, c.z, b.x, y, b.z);
    }
    // arrow head at the end
    const e = P[P.length - 1]!, f = P[P.length - 2]!;
    const dl = Math.hypot(e.x - f.x, e.z - f.z) || 1, dx = (e.x - f.x) / dl, dz = (e.z - f.z) / dl;
    const tip = { x: e.x - dx * 0.05, z: e.z - dz * 0.05 }, base = { x: tip.x - dx * 0.45, z: tip.z - dz * 0.45 };
    pos.push(tip.x, y, tip.z, base.x - dz * 0.22, y, base.z + dx * 0.22, base.x + dz * 0.22, y, base.z - dx * 0.22);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(geo, mat(l.kind));
    m.renderOrder = 10;
    g.add(m);
  }
  return g;
}

const ZONE_COLOR: Record<ZoneHint, string> = {
  suburb: '#7FB069', commercial: '#E9785A', industrial: '#8C8FA3', park: '#3FA796', frontage: '#F2C14E', verge: '#B9C99A', waterfront: '#5A8BD6',
};

function blockDebug(blocks: ReturnType<typeof greaterGrid>['blocks']): THREE.Group {
  const g = new THREE.Group();
  for (const b of blocks) {
    const r = b.rect, inset = 0.25;
    const geo = new THREE.PlaneGeometry(r.maxX - r.minX - 2 * inset, r.maxZ - r.minZ - 2 * inset);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ZONE_COLOR[b.zone], transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.set((r.minX + r.maxX) / 2, 0.15, (r.minZ + r.maxZ) / 2);
    g.add(m);
    for (const f of b.frontage) {
      const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
      const w = f.side === 'n' || f.side === 's' ? r.maxX - r.minX - 1 : 0.35, d = f.side === 'e' || f.side === 'w' ? r.maxZ - r.minZ - 1 : 0.35;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), new THREE.MeshBasicMaterial({ color: '#1F2A44' }));
      const off = { n: [0, r.minZ - cz + 0.5], s: [0, r.maxZ - cz - 0.5], w: [r.minX - cx + 0.5, 0], e: [r.maxX - cx - 0.5, 0] }[f.side];
      bar.position.set(cx + off[0]!, 0.2, cz + off[1]!);
      g.add(bar);
    }
  }
  return g;
}

main().catch((e) => {
  msg.textContent = `error: ${(e as Error).message}`;
  console.error(e);
});
