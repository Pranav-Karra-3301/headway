// Owner: G4. Preview: /greater-traffic-dev.html — greater-town traffic on G0's roads around the town board, with the
// game's look (Stage). Query flags:
//   view=<u visible vertically>  tx, tz=<look-at>  palette=a|b|c  light=day|dusk  post=0|1  cars=<n>  seed=<n>
//   town=0 (plain board instead of the static town)  train=0 (no stand-in train / level-crossing demo)  land=0
//   speed=<×real time>  warm=<s>  handoff=1 (demo town hand-off: cars drive into / out of the board ports)
//   hw=0 (without G1's expressway lanes + layer; on by default when G1 has landed)
import * as THREE from 'three';
import { pointAt, TOWN } from '@headway/sim';
import { Stage } from '../../post/stage';
import type { LightMode, PaletteId } from '../../types';
import { greaterGrid } from '../grid';
import { createGreaterRoadsLayer, preloadGreaterRoads, roadColors } from '../roads/index';
import type { Lane } from '../grid';
import type { PortLike, TrafficGraph } from './graph';
import { createGreaterTrafficLayer, preloadGreaterTraffic } from './layer';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const light = (q.get('light') === 'dusk' ? 'dusk' : 'day') as LightMode;
const msg = document.getElementById('msg')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const TRAIN_SPEED = 9.6; // u/s real at the app's default 8× (1.2 u/s sim)

async function main(): Promise<void> {
  const grid = greaterGrid(TOWN);
  const stage = new Stage(canvas, {
    bounds: grid.bounds, palette, light, maxHeight: 14, post: q.get('post') !== '0', preserveDrawingBuffer: true, autoQuality: false,
    camera: { view: num('view', 104), target: { x: num('tx', 0), z: num('tz', 2) }, interactive: q.get('interactive') === '1' },
  });
  await Promise.all([preloadGreaterRoads(), preloadGreaterTraffic()]);
  stage.scene.add(createGreaterRoadsLayer(TOWN, { palette }).object);

  let town: { object: THREE.Object3D; update(dt: number): void } | null = null;
  if (q.get('town') !== '0') {
    try {
      const mod = await import('../../town/index');
      town = mod.createStaticTown(TOWN, { palette, detail: 'toy' });
      stage.scene.add(town.object);
    } catch (e) {
      console.warn('[greater-traffic] static town unavailable', e);
    }
  }
  if (!town) stage.scene.add(plainBoard());
  if (q.get('land') !== '0') stage.scene.add(landStandIns(grid));

  // G1's expressway (lanes + layer) when it has landed: hw=0 to preview G0's streets alone
  let hw: { lanes: Lane[]; ports: PortLike[] } | null = null;
  if (q.get('hw') !== '0') {
    try {
      const [net, lay] = await Promise.all([import('../highway/network'), import('../highway/layer')]);
      await lay.preloadGreaterHighway();
      stage.scene.add(lay.createGreaterHighwayLayer(TOWN, { palette }).object);
      const n = net.greaterLanes(TOWN);
      hw = { lanes: n.lanes, ports: n.ports as PortLike[] };
    } catch (e) {
      console.warn('[greater-traffic] G1 highway unavailable', e);
    }
  }

  const handoff = q.get('handoff') === '1';
  const traffic = createGreaterTrafficLayer(TOWN, {
    palette, seed: num('seed', 1), cars: num('cars', hw ? 48 : 40), warm: num('warm', 150), ...(hw ?? {}),
    ...(handoff ? { onBoardExit: () => undefined, boardShare: 0.3 } : {}),
  });
  stage.scene.add(traffic.object);
  if (q.get('land') !== '0') stage.scene.add(approachStandIns(traffic.graph, palette));

  const train = q.get('train') !== '0' ? trainStandIn() : null;
  if (train) stage.scene.add(train.object);
  let trainDist = 0;

  const ports = [...traffic.graph.boardIn.keys()];
  let admitT = 0;
  const speed = num('speed', 1);
  const clock = new THREE.Clock();
  let frames = 0;
  stage.renderer.setAnimationLoop(() => {
    const dt = Math.min(0.1, clock.getDelta()) * speed;
    town?.update(dt);
    trainDist = (trainDist + dt * TRAIN_SPEED) % TOWN.rail.loop.length;
    train?.place(trainDist);
    if (handoff && (admitT -= dt) <= 0) { admitT = 2.5; traffic.admit(ports[Math.floor(Math.random() * ports.length)]!); }
    traffic.tick(dt, { trainDist: train ? trainDist : null });
    stage.render(dt);
    if (++frames === 3 || frames % 60 === 0) {
      const info = stage.renderer.info.render;
      msg.textContent = `greater traffic · ${traffic.model.cars.length} vehicles (${traffic.vehicles}) · ${traffic.graph.lanes.length} lanes · ${traffic.graph.sources.length} world exits · scene ${info.calls} calls`;
      (window as unknown as { __greaterTrafficReady: boolean }).__greaterTrafficReady = true;
    }
  });
  addEventListener('resize', () => stage.resize());
}

/** Two-car stand-in train on the rail loop (preview only; the town renderer owns the real one). */
function trainStandIn(): { object: THREE.Group; place(dist: number): void } {
  const object = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#E5484D', roughness: 0.6 });
  const roof = new THREE.MeshStandardMaterial({ color: '#F4F1EA', roughness: 0.7 });
  const cars = [0, 1].map(() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 1.3), mat);
    body.position.y = 0.8;
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.18, 1.2), roof);
    top.position.y = 1.48;
    body.castShadow = top.castShadow = true;
    g.add(body, top);
    object.add(g);
    return g;
  });
  const L = TOWN.rail.loop.length;
  return {
    object,
    place(dist) {
      cars.forEach((g, i) => {
        const p = pointAt(TOWN.rail.loop, (((dist - 2.2 - i * 4.5) % L) + L) % L);
        g.position.set(p.x, 0, p.z);
        g.rotation.y = p.heading;
      });
    },
  };
}

/** Preview-only asphalt under the approach lanes beyond the grid (G1's highway / E1 tunnels / E2 causeways own
 *  the real ones). */
function approachStandIns(graph: TrafficGraph, palette: PaletteId): THREE.Mesh {
  const pos: number[] = [];
  const W = 1.6, y = 0.035;
  for (const l of [...graph.sources, ...graph.sinks]) {
    const [a, b] = [l.poly.points[0]!, l.poly.points[l.poly.points.length - 1]!];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
    // the lane is right of the road centre: shift left by the lane offset so two lanes share one strip
    const cx = dz, cz = -dx; // left of the lane (G0 rightOf(d) = (-d.z, d.x))
    const o = 0.6;
    const p = (q: { x: number; z: number }, s: number) => [q.x + cx * (o + s * W), y, q.z + cz * (o + s * W)];
    pos.push(...p(a, -1), ...p(b, -1), ...p(b, 1), ...p(a, -1), ...p(b, 1), ...p(a, 1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: roadColors(palette).lane, roughness: 0.95, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

function plainBoard(): THREE.Mesh {
  const b = TOWN.bounds;
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, 1, b.maxZ - b.minZ), new THREE.MeshStandardMaterial({ color: '#A8D8B9', roughness: 0.9 }));
  m.position.set(0, -0.5, 0);
  m.receiveShadow = true;
  return m;
}

/** Preview-only stand-ins for E2's bay and E1's ridge spur (same as G0's roads preview). */
function landStandIns(grid: ReturnType<typeof greaterGrid>): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape(grid.water.map((p) => new THREE.Vector2(p.x, -p.z)));
  const wgeo = new THREE.ShapeGeometry(shape);
  wgeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({ color: '#7FC6C9', roughness: 0.35 }));
  water.position.y = -0.3;
  water.receiveShadow = true;
  g.add(water);
  const b = grid.bounds, pad = 12;
  const sgeo = new THREE.PlaneGeometry(b.maxX - b.minX + 2 * pad, b.maxZ - b.minZ + 2 * pad);
  sgeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(sgeo, new THREE.MeshStandardMaterial({ color: '#A9D5A6', roughness: 1 }));
  ground.position.set((b.minX + b.maxX) / 2, -0.6, (b.minZ + b.maxZ) / 2);
  ground.receiveShadow = true;
  g.add(ground);
  const mound = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: '#7DBB8A', roughness: 0.95, flatShading: true });
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    if (grid.use[r]![c] !== 'hill') continue;
    const m = new THREE.Mesh(mound, mat);
    m.scale.set(3.5, 1.3 + ((c * 7 + r * 13) % 5) * 0.3, 3.5);
    m.position.set(grid.origin.x + (c + 0.5) * grid.tile, -0.2, grid.origin.z + (r + 0.5) * grid.tile);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

main().catch((e) => {
  msg.textContent = `error: ${(e as Error).message}`;
  console.error(e);
});
