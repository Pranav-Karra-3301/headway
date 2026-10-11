// Owner: G1. Preview: /greater-highway-dev.html — the expressway band with G0's greater-town roads, in the game's
// look (Stage: lights, sky, post chain). Query flags:
//   view=<u visible vertically>  tx, tz=<look-at>  palette=a|b|c  light=day|dusk  post=0|1
//   town=1 (static town on the board)  roads=0 (hide G0's roads layer)  lanes=1 (lane graph; overpass lanes at height)
//   cars=1 (a few debug cars driving the lane graph)  land=0 (hide the preview-only ground beyond the grid)
//   gallery=1 (Kenney piece gallery, see ./gallery.ts)
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { Stage } from '../../post/stage';
import { shared } from '../../materials';
import type { LightMode, PaletteId } from '../../types';
import { greaterGrid } from '../grid';
import { createGreaterRoadsLayer, preloadGreaterRoads } from '../roads/index';
import { offsetRight } from '../roads/lanes';
import { gallery } from './gallery';
import { createGreaterHighwayLayer, preloadGreaterHighway } from './layer';
import { greaterLanes, type GreaterNetwork } from './network';
import { laneHeightAt, type HighwayLane } from './plan';

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
    camera: { view: num('view', 64), target: { x: num('tx', -8), z: num('tz', -42) }, interactive: q.get('interactive') === '1' },
  });
  await Promise.all([preloadGreaterRoads(), preloadGreaterHighway()]);
  if (q.get('roads') !== '0') stage.scene.add(createGreaterRoadsLayer(TOWN, { palette }).object);
  const layer = createGreaterHighwayLayer(TOWN, { palette });
  stage.scene.add(layer.object);

  let town: { object: THREE.Object3D; update(dt: number): void } | null = null;
  if (q.get('town') === '1') {
    try {
      const mod = await import('../../town/index');
      town = mod.createStaticTown(TOWN, { palette, detail: 'toy' });
      stage.scene.add(town.object);
    } catch (e) {
      console.warn('[greater-highway] static town unavailable', e);
    }
  }
  if (q.get('land') !== '0') {
    // preview-only stand-in for the world ground beyond the grid (E1 / E3 own the real terrain and base)
    const b = grid.bounds;
    const geo = new THREE.PlaneGeometry(b.maxX - b.minX + 80, b.maxZ - b.minZ + 80);
    geo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#9ccfae', roughness: 1 }));
    ground.position.set((b.minX + b.maxX) / 2, -0.08, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = true;
    stage.scene.add(ground);
  }
  if (!town) {
    const b = TOWN.bounds;
    const board = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, 1, b.maxZ - b.minZ), new THREE.MeshStandardMaterial({ color: '#A8D8B9', roughness: 0.9 }));
    board.position.set(0, -0.5, 0);
    board.receiveShadow = true;
    stage.scene.add(board);
  }
  const net = greaterLanes(TOWN);
  if (q.get('lanes') === '1') stage.scene.add(laneDebug(net.lanes));
  const cars = q.get('cars') === '1' ? debugCars(net, stage.scene) : null;

  const stats = `${layer.plan.lanes.length} highway lanes · ${net.lanes.length} lanes total · ${net.ports.length} ports · kenney ${layer.kenney ? 'yes' : 'fallback'}`;
  msg.textContent = `greater highway · ${stats}`;
  const clock = new THREE.Clock();
  let frames = 0, t = 0;
  stage.renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    t += dt;
    shared.uTime.value = t;
    town?.update(dt);
    cars?.(dt);
    stage.render(dt);
    if (++frames === 3) {
      const info = stage.renderer.info.render;
      msg.textContent = `greater highway · ${stats} · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
      (window as unknown as { __highwayReady: boolean }).__highwayReady = true;
    }
  });
  addEventListener('resize', () => stage.resize());
}

const LANE_COLOR: Record<string, string> = { highway: '#E5484D', ramp: '#F0A830', junction: '#8A6BD8', radial: '#2E5BDA', roundabout: '#8A6BD8' };

function laneDebug(lanes: HighwayLane[]): THREE.Group {
  const g = new THREE.Group();
  const mats = new Map<string, THREE.MeshBasicMaterial>();
  const mat = (k: string) => {
    let m = mats.get(k);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: LANE_COLOR[k] ?? '#6B7280', depthTest: false }); mats.set(k, m); }
    return m;
  };
  for (const l of lanes) {
    const P = l.path.points;
    const L = offsetRight(P, -0.07), R = offsetRight(P, 0.07);
    const ys = P.map((_, i) => (l.y?.[i] ?? 0) + 0.25);
    const pos: number[] = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = L[i]!, b = L[i + 1]!, c = R[i + 1]!, d = R[i]!;
      pos.push(a.x, ys[i]!, a.z, d.x, ys[i]!, d.z, c.x, ys[i + 1]!, c.z, a.x, ys[i]!, a.z, c.x, ys[i + 1]!, c.z, b.x, ys[i + 1]!, b.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(geo, mat(l.kind));
    m.renderOrder = 10;
    g.add(m);
  }
  return g;
}

/** A handful of boxes driving the lane graph (debug only: G4 owns real traffic). */
function debugCars(net: GreaterNetwork, scene: THREE.Scene): (dt: number) => void {
  const starts = net.ports.flatMap((p) => ('inLanes' in p ? p.inLanes : p.kind === 'edge' && p.inLane ? [p.inLane] : []));
  const geo = new THREE.BoxGeometry(1.5, 0.6, 0.75);
  const colors = ['#E9785A', '#5A8BD6', '#F2C14E', '#3FA796', '#F6EEDC'];
  const cars = Array.from({ length: 26 }, (_, i) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length] }));
    mesh.castShadow = true;
    scene.add(mesh);
    return { mesh, lane: net.byId.get(starts[i % starts.length]!)!, d: (i * 7.3) % 20, seed: i };
  });
  return (dt) => {
    for (const c of cars) {
      c.d += dt * c.lane.speed * 0.8;
      while (c.d > c.lane.path.length) {
        c.d -= c.lane.path.length;
        const nx = c.lane.next;
        c.seed = (c.seed * 1103515245 + 12345) & 0x7fffffff;
        c.lane = nx.length ? net.byId.get(nx[c.seed % nx.length]!)! : net.byId.get(starts[c.seed % starts.length]!)!;
      }
      const P = c.lane.path;
      let i = 0;
      while (i + 2 < P.cum.length && P.cum[i + 1]! < c.d) i++;
      const a = P.points[i]!, b = P.points[i + 1] ?? a, t = (c.d - P.cum[i]!) / ((P.cum[i + 1] ?? P.cum[i]!) - P.cum[i]! || 1);
      c.mesh.position.set(a.x + (b.x - a.x) * t, laneHeightAt(c.lane, c.d) + 0.35, a.z + (b.z - a.z) * t);
      c.mesh.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    }
  };
}

if (q.get('gallery') === '1') gallery(canvas, msg).catch((e) => { msg.textContent = `error: ${(e as Error).message}`; });
else main().catch((e) => { msg.textContent = `error: ${(e as Error).message}`; console.error(e); });
