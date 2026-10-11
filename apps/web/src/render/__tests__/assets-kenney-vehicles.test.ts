// Owner: K2 Kenney vehicles + boats. Every kn.car.* / kn.boat.* kind: catalog entry matches its spec, spec sizes cover
// the Kenney models (manifest size × KENNEY_SCALE) within footprint ±10 % / height ±25 %, triangle budgets, Kenney
// ids declared for preloading, toy fallbacks inside the footprint before models load, and — with synthetic templates
// installed — palette paint per placement (deterministic, varied, -1 keeps), identity colours kept, boats sunk to
// the waterline.
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG, CATALOG_BY_KIND } from '../assets/catalog';
import {
  CAR_PAINTS, KENNEY_TRAIN, register, VEHICLE_KENNEY_IDS, VEHICLE_KINDS, VEHICLE_SPECS, vehicleChoice, vehicleSpec,
} from '../assets/families/kenney-vehicles';
import { _setKenneyTemplate, KENNEY_SCALE, kenneyIdsFor, type KenneyId, type KenneyKit, type KenneyPartInfo } from '../assets/kenney';
import manifestJson from '../assets/kenney/manifest.json';
import type { KenneyTemplate } from '../assets/kenney/template';
import { AssetRegistry } from '../assets/registry';
import { PALETTES } from '../palettes';

interface Entry { name: string; size: [number, number, number]; tris: number }
const MANIFEST = manifestJson as unknown as Record<KenneyKit, Entry[]>;
const entry = (id: KenneyId): Entry => {
  const [kit, name] = id.split('/') as [KenneyKit, string];
  const e = MANIFEST[kit]?.find((x) => x.name === name);
  if (!e) throw new Error(`not in manifest: ${id}`);
  return e;
};
const scaled = (id: KenneyId) => entry(id).size.map((s) => s * KENNEY_SCALE[id.split('/')[0] as KenneyKit]) as [number, number, number];
const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7919 + 13);

function vehicleRegistry(): AssetRegistry {
  const r = new AssetRegistry();
  register(r);
  return r;
}
function bbox(o: THREE.Object3D): THREE.Vector3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
}

describe('K2 catalog + specs', () => {
  it('every spec kind has a catalog entry with the same footprint/height, and every kn.car/kn.boat entry has a spec', () => {
    for (const s of VEHICLE_SPECS) {
      const c = CATALOG_BY_KIND.get(s.kind);
      expect(c, s.kind).toBeDefined();
      expect([c!.w, c!.d, c!.h], s.kind).toEqual([s.w, s.d, s.h]);
    }
    const catalogKinds = CATALOG.filter((c) => /^kn\.(car|boat)\./.test(c.kind)).map((c) => c.kind).sort();
    expect(catalogKinds).toEqual([...VEHICLE_KINDS].sort());
    expect(new Set(VEHICLE_KINDS).size).toBe(VEHICLE_KINDS.length);
  });

  it('models fit their kind: width/length within footprint +10 %, height within ±25 % (mixed kinds: ≤ +25 %)', () => {
    for (const s of VEHICLE_SPECS) {
      for (const id of s.ids) {
        const [w, h, l] = scaled(id);
        expect(w, `${s.kind} ${id} width`).toBeLessThanOrEqual(s.w * 1.1);
        expect(l, `${s.kind} ${id} length`).toBeLessThanOrEqual(s.d * 1.1);
        expect(h, `${s.kind} ${id} height`).toBeLessThanOrEqual(s.h * 1.25);
        if (s.ids.length === 1) {
          expect(h, `${s.kind} height`).toBeGreaterThanOrEqual(s.h * 0.75);
          expect(l, `${s.kind} length`).toBeGreaterThanOrEqual(s.d * 0.8);
        }
      }
    }
  });

  it('cars sit next to our 3.3 u bus like real cars (1.2–2.3 u long, narrower than the bus); triangle budgets', () => {
    for (const s of VEHICLE_SPECS) {
      for (const id of s.ids) {
        const [w, , l] = scaled(id);
        const tris = entry(id).tris;
        if (s.boat) { expect(tris, id).toBeLessThanOrEqual(3000); continue; }
        expect(l, id).toBeGreaterThan(1.2); expect(l, id).toBeLessThan(2.3);
        expect(w, id).toBeLessThan(1.25);
        expect(tris, id).toBeLessThanOrEqual(3200);
      }
    }
  });

  it('registers every kind (street family, instanced) and declares its Kenney models for preloading', () => {
    const r = vehicleRegistry();
    for (const kind of VEHICLE_KINDS) {
      const def = r.get(kind);
      expect(def, kind).toBeDefined();
      expect(def!.instanced).toBe(true);
      expect(kenneyIdsFor([kind]).sort(), kind).toEqual([...vehicleSpec(kind)!.ids].sort());
    }
    expect([...kenneyIdsFor(VEHICLE_KINDS)].sort()).toEqual([...VEHICLE_KENNEY_IDS].sort());
  });

  it('keeps our train (v7 evaluation)', () => {
    expect(KENNEY_TRAIN).toBeNull();
  });
});

describe('K2 choice', () => {
  const kit = (seed: number) => createBasicKit({}, 0, seed);
  it('is deterministic per seed and varied across seeds (models + all palette paints)', () => {
    const random = vehicleSpec('kn.car.random')!;
    const models = new Set<string>(), paints = new Set<number>();
    for (const seed of Array.from({ length: 200 }, (_, i) => i * 31 + 1)) {
      const a = vehicleChoice(random, kit(seed)), b = vehicleChoice(random, kit(seed));
      expect(a).toEqual(b);
      models.add(a.id); paints.add(a.paint);
    }
    expect(models.size).toBeGreaterThanOrEqual(6);
    expect([...paints].sort()).toEqual(Array.from({ length: CAR_PAINTS }, (_, i) => i));
    expect(PALETTES.a.car.length).toBe(CAR_PAINTS);
    expect(PALETTES.b.car.length).toBe(CAR_PAINTS);
    expect(PALETTES.c.car.length).toBe(CAR_PAINTS);
  });
  it('honours params.model / params.paint; identity vehicles never repaint', () => {
    const random = vehicleSpec('kn.car.random')!;
    expect(vehicleChoice(random, kit(1), { model: 0, paint: 3 })).toMatchObject({ id: random.ids[0], paint: 3 });
    expect(vehicleChoice(random, kit(1), { model: -1, paint: -1 })).toMatchObject({ id: random.ids[random.ids.length - 1], paint: -1 });
    for (const kind of ['kn.car.taxi', 'kn.car.police', 'kn.car.ambulance', 'kn.car.firetruck', 'kn.boat.tug']) {
      expect(vehicleChoice(vehicleSpec(kind)!, kit(5), { paint: 2 }).paint, kind).toBe(-1);
    }
  });
});

describe('K2 builders before models load (toy fallback)', () => {
  it('every kind builds inside its footprint (+10 %) and height (±25 %)', () => {
    const r = vehicleRegistry();
    for (const s of VEHICLE_SPECS) {
      for (const seed of SEEDS.slice(0, 6)) {
        const k = createBasicKit(r.roles, 0, seed);
        const o = r.build(k, { kind: s.kind, x: 0, z: 0 });
        expect(o.userData.placeholder, s.kind).toBeUndefined();
        expect(o.userData.fallback, s.kind).toBe(true);
        const size = bbox(o);
        expect(size.x, `${s.kind} w`).toBeLessThanOrEqual(s.w * 1.1);
        expect(size.z, `${s.kind} d`).toBeLessThanOrEqual(s.d * 1.1);
        expect(size.y, `${s.kind} h`).toBeLessThanOrEqual(s.h * 1.25);
        expect(size.y, `${s.kind} h`).toBeGreaterThanOrEqual(s.boat ? s.h * 0.3 : s.h * 0.75);
      }
    }
  });
});

describe('K2 builders with Kenney templates', () => {
  const part = (role: string, paint: boolean, geo: THREE.BufferGeometry, shade = 0.03): KenneyTemplate['parts'][number] => {
    const info: KenneyPartInfo = { source: role, role, idx: 0, shade, paint, side: THREE.FrontSide };
    return { geometry: geo, info, tris: (geo.index?.count ?? 0) / 3 };
  };
  const install = (id: KenneyId) => {
    const [w, h, l] = scaled(id);
    const body = new THREE.BoxGeometry(w, h * 0.6, l).translate(0, h * 0.3, 0);
    const top = new THREE.BoxGeometry(w * 0.8, h * 0.4, l * 0.5).translate(0, h * 0.8, 0);
    const glass = new THREE.BoxGeometry(w * 0.7, h * 0.2, l * 0.3).translate(0, h * 0.7, 0);
    const box = new THREE.BoxGeometry(w * 0.5, h * 0.2, l * 0.2).translate(0, h * 0.5, 0);
    const parts = [part('knRed', true, body), part('knDark', false, top), part('knWhite', false, glass, -0.03), part('knGreen', false, box, -0.06)];
    const bb = new THREE.Box3(new THREE.Vector3(-w / 2, 0, -l / 2), new THREE.Vector3(w / 2, h, l / 2));
    const t: KenneyTemplate = { id, parts, box: bb, size: bb.getSize(new THREE.Vector3()), tris: 48 };
    _setKenneyTemplate(id, t);
  };
  beforeAll(() => { for (const id of VEHICLE_KENNEY_IDS) install(id); });
  const r = vehicleRegistry();
  const partOf = (o: THREE.Object3D, source: string) => {
    let out: KenneyPartInfo | undefined;
    o.traverse((c) => { const info = c.userData.kenney as KenneyPartInfo | undefined; if (info?.source === source) out = info; });
    return out!;
  };
  const paintOf = (o: THREE.Object3D) => partOf(o, 'knRed');
  const build = (kind: string, params = {}, seed = 3) => r.build(createBasicKit(r.roles, 0, seed), { kind, x: 0, z: 0, params });

  it('car windows take the palette glass role (boats keep theirs); delivery box takes the paint; cargo ship toned', () => {
    expect(partOf(build('kn.car.sedan'), 'knWhite')).toMatchObject({ role: 'glass', idx: 0 });
    expect(partOf(build('kn.car.taxi'), 'knWhite').role).toBe('glass');
    expect(partOf(build('kn.boat.speed'), 'knWhite').role).toBe('knWhite');
    expect(partOf(build('kn.car.delivery', { paint: 5 }), 'knGreen')).toMatchObject({ role: 'car', idx: 5 });
    expect(partOf(build('kn.car.garbage'), 'knGreen').role).toBe('knGreen');
    const ship = build('kn.boat.cargoShip');
    expect(partOf(ship, 'knGreen')).toMatchObject({ role: 'car', idx: 3 });
    expect(paintOf(ship)).toMatchObject({ role: 'car', idx: 0 });
  });

  it('wooden rowing boats keep their colour, also inside kn.boat.random', () => {
    expect(paintOf(build('kn.boat.row', { paint: 2 })).role).toBe('knRed');
    const random = vehicleSpec('kn.boat.random')!;
    const row = random.ids.indexOf('watercraft-pack/boat-row-small');
    expect(row).toBeGreaterThanOrEqual(0);
    expect(paintOf(build('kn.boat.random', { model: row, paint: 2 })).role).toBe('knRed');
    expect(paintOf(build('kn.boat.random', { model: 0, paint: 2 })).role).toBe('car');
  });

  it('uses the Kenney model, repaints everyday cars with the palette `car` role, keeps identity colours', () => {
    const sedan = r.build(createBasicKit(r.roles, 0, 3), { kind: 'kn.car.sedan', x: 0, z: 0, params: { paint: 4 } });
    expect(sedan.userData.fallback).toBeUndefined();
    expect(sedan.children[0]!.userData.kenneyId).toBe('car-kit/sedan');
    expect(paintOf(sedan)).toMatchObject({ role: 'car', idx: 4, shade: 0 });
    const keep = r.build(createBasicKit(r.roles, 0, 3), { kind: 'kn.car.sedan', x: 0, z: 0, params: { paint: -1 } });
    expect(paintOf(keep)).toMatchObject({ role: 'knRed', shade: 0.03 });
    const taxi = r.build(createBasicKit(r.roles, 0, 3), { kind: 'kn.car.taxi', x: 0, z: 0 });
    expect(paintOf(taxi).role).toBe('knRed');
  });

  it('parked cars get varied paints and models across placements; same placement → same look', () => {
    const looks = new Set<string>();
    for (const seed of SEEDS) {
      const a = r.build(createBasicKit(r.roles, 0, seed), { kind: 'kn.car.random', x: 0, z: 0 });
      const b = r.build(createBasicKit(r.roles, 0, seed), { kind: 'kn.car.random', x: 0, z: 0 });
      expect(a.userData.variant).toBe(b.userData.variant);
      looks.add(String(a.userData.variant));
    }
    expect(looks.size).toBeGreaterThanOrEqual(10);
  });

  it('boats sit with the waterline at the origin; cars stand on y = 0; all inside their footprints', () => {
    for (const s of VEHICLE_SPECS) {
      const o = r.build(createBasicKit(r.roles, 0, 9), { kind: s.kind, x: 0, z: 0 });
      o.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(o);
      if (s.boat) { expect(box.min.y, s.kind).toBeLessThan(-0.05); expect(box.min.y, s.kind).toBeGreaterThan(-0.4); }
      else expect(box.min.y, s.kind).toBeCloseTo(0, 5);
      const size = box.getSize(new THREE.Vector3());
      expect(size.x, s.kind).toBeLessThanOrEqual(s.w * 1.1);
      expect(size.z, s.kind).toBeLessThanOrEqual(s.d * 1.1);
    }
  });
});
