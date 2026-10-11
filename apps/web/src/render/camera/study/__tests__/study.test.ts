// C1 camera study: pure math behind /camera-study.html — view basis, ray-vs-box occlusion, town composition into
// occluder boxes, gameplay samples, HUD-safe framing and per-view metrics. No WebGL.
import { describe, expect, it } from 'vitest';
import { nearestDist, pointAt, TOWN } from '@headway/sim';
import type { TownMap } from '@headway/sim';
import { SCENERY } from '../../../scenery';
import type { DistrictScenery } from '../../../districts/types';
import { CATALOG_BY_KIND } from '../../../assets/catalog';
import { CURRENT_RIG_VIEW, ISO_ELEV, STUDY_VIEWS, toImage, viewBasis } from '../views';
import { containsPoint, firstOccluder, rayBox, type Box } from '../occlusion';
import { composeStudyTown, placementBoxes, sceneryToPlacement, stationBoxes, studyBoxes } from '../town';
import { queueSlot, studySamples } from '../samples';
import { contentRect, fitView, hudBoxes, overlaps, safeRect } from '../fit';
import { measureView, rankViews, type StudyInput } from '../measure';
import { buildHeightField, heightFieldHit } from '../heightfield';
import * as THREE from 'three';

const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
const box = (o: Partial<Box> & Pick<Box, 'cx' | 'cz' | 'hx' | 'hz' | 'y1'>): Box => ({ y0: 0, rot: 0, cls: 'building', kind: 'test', ...o });

describe('views', () => {
  it('studies 30°, true iso and 45° at azimuths 35/45/55 and knows the current rig', () => {
    expect(ISO_ELEV).toBeCloseTo(35.264, 3);
    const pairs = STUDY_VIEWS.map((v) => `${v.elev.toFixed(2)}/${v.az}`);
    for (const e of [30, ISO_ELEV, 45]) for (const a of [35, 45, 55]) expect(pairs).toContain(`${e.toFixed(2)}/${a}`);
    expect(new Set(STUDY_VIEWS.map((v) => v.id)).size).toBe(STUDY_VIEWS.length);
    expect(CURRENT_RIG_VIEW.elev).toBeCloseTo((Math.atan2(62, Math.hypot(70, 70)) * 180) / Math.PI, 6);
    expect(CURRENT_RIG_VIEW.az).toBe(45);
  });

  it('builds an orthonormal camera basis looking from +x/+z', () => {
    for (const v of STUDY_VIEWS) {
      const b = viewBasis(v);
      for (const u of [b.d, b.right, b.up]) expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 9);
      expect(dot(b.d, b.right)).toBeCloseTo(0, 9);
      expect(dot(b.d, b.up)).toBeCloseTo(0, 9);
      expect(dot(b.right, b.up)).toBeCloseTo(0, 9);
      expect(b.d.y).toBeCloseTo(Math.sin((v.elev * Math.PI) / 180), 9);
      expect(b.d.x).toBeGreaterThan(0);
      expect(b.d.z).toBeGreaterThan(0);
      expect(b.right.y).toBeCloseTo(0, 9);
      expect(b.up.y).toBeGreaterThan(0);
    }
    const iso = viewBasis({ elev: ISO_ELEV, az: 45 });
    expect(iso.d.x).toBeCloseTo(iso.d.z, 9);
    // +x on the ground goes right-and-down on screen, +z goes left-and-down, up is up.
    const px = toImage(iso, { x: 1, y: 0, z: 0 }), pz = toImage(iso, { x: 0, y: 0, z: 1 }), py = toImage(iso, { x: 0, y: 1, z: 0 });
    expect(px.x).toBeGreaterThan(0); expect(px.y).toBeLessThan(0);
    expect(pz.x).toBeLessThan(0); expect(pz.y).toBeLessThan(0);
    expect(py.x).toBeCloseTo(0, 9); expect(py.y).toBeGreaterThan(0);
    // azimuth 35° looks more from the south: E–W streets read longer on screen than N–S ones
    const a35 = viewBasis({ elev: 35, az: 35 });
    const len = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    expect(len(toImage(a35, { x: 1, y: 0, z: 0 }))).toBeGreaterThan(len(toImage(a35, { x: 0, y: 0, z: 1 })));
  });
});

describe('occlusion', () => {
  it('hits an axis-aligned box ahead of the ray and ignores boxes behind it', () => {
    const b = box({ cx: 3, cz: 0, hx: 0.5, hz: 1, y1: 2 });
    expect(rayBox({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, b)).toBeCloseTo(2.5, 9);
    expect(rayBox({ x: 0, y: 0.5, z: 0 }, { x: -1, y: 0, z: 0 }, b)).toBeNull();
    expect(rayBox({ x: 0, y: 2.5, z: 0 }, { x: 1, y: 0, z: 0 }, b)).toBeNull(); // passes over the roof
    // rising ray clears a low box but not a tall one
    const up = { x: Math.cos(Math.PI / 4), y: Math.sin(Math.PI / 4), z: 0 };
    expect(rayBox({ x: 0, y: 0.4, z: 0 }, up, box({ cx: 3, cz: 0, hx: 0.5, hz: 1, y1: 1 }))).toBeNull();
    expect(rayBox({ x: 0, y: 0.4, z: 0 }, up, box({ cx: 3, cz: 0, hx: 0.5, hz: 1, y1: 4 }))).not.toBeNull();
  });

  it('respects box rotation about y (three.js convention)', () => {
    // a 4 × 0.4 wall along x, turned a quarter: now it runs along z and blocks a ray going +x
    const wall = box({ cx: 3, cz: 0, hx: 2, hz: 0.2, y1: 3, rot: Math.PI / 2 });
    expect(rayBox({ x: 0, y: 1, z: 1.5 }, { x: 1, y: 0, z: 0 }, wall)).not.toBeNull();
    expect(rayBox({ x: 0, y: 1, z: 2.5 }, { x: 1, y: 0, z: 0 }, wall)).toBeNull();
    const flat = box({ cx: 3, cz: 0, hx: 2, hz: 0.2, y1: 3 });
    expect(rayBox({ x: 0, y: 1, z: 1.5 }, { x: 1, y: 0, z: 0 }, flat)).toBeNull();
    expect(containsPoint(wall, { x: 3, y: 1, z: 1.9 })).toBe(true);
    expect(containsPoint(wall, { x: 3.5, y: 1, z: 0 })).toBe(false);
  });

  it('never lets a box hide a point inside it and returns the first box hit', () => {
    const near = box({ cx: 2, cz: 0, hx: 0.5, hz: 0.5, y1: 2, kind: 'near' });
    const far = box({ cx: 5, cz: 0, hx: 0.5, hz: 0.5, y1: 2, kind: 'far' });
    const shell = box({ cx: 0, cz: 0, hx: 1, hz: 1, y1: 3, kind: 'shell' });
    const hit = firstOccluder({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, [far, shell, near]);
    expect(hit?.kind).toBe('near');
    expect(firstOccluder({ x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, [far, shell, near])).toBeNull();
  });
});

describe('study town', () => {
  it('maps base scenery to catalog kinds with honest sizes', () => {
    const tower = SCENERY.find((s) => s.kind === 'tall' && s.building === 'tall' && s.x > 10 && s.z > 5)!;
    expect(sceneryToPlacement(tower, TOWN)?.kind).toBe('res.tower'); // apartments
    const ct = SCENERY.find((s) => s.kind === 'clockTower')!;
    expect(sceneryToPlacement(ct, TOWN)?.kind).toBe('lm.clockTower');
    expect(sceneryToPlacement(SCENERY.find((s) => s.kind === 'stadium')!, TOWN)?.kind).toBe('lm.stadium');
    expect(sceneryToPlacement(SCENERY.find((s) => s.kind === 'lawn')!, TOWN)).toBeNull();
    expect(sceneryToPlacement(SCENERY.find((s) => s.kind === 'station')!, TOWN)).toBeNull();
    const tree = sceneryToPlacement({ kind: 'tree', x: 1, z: 2, variant: 2, scale: 1.2 }, TOWN)!;
    expect(tree.kind).toBe('veg.pine');
    expect(tree.scale).toBeCloseTo(1.2);
    for (const s of SCENERY) {
      const p = sceneryToPlacement(s, TOWN);
      if (p) expect(CATALOG_BY_KIND.has(p.kind)).toBe(true);
    }
  });

  it('turns placements into catalog boxes (rotation, scale, hedge length)', () => {
    const [a] = placementBoxes([{ kind: 'res.tower', x: 4, z: 5 }]);
    expect(a).toMatchObject({ cx: 4, cz: 5, hx: 1.75, hz: 1.75, y0: 0, y1: 7, cls: 'building' });
    const [h] = placementBoxes([{ kind: 'cp.hall', x: 0, z: 0, rot: Math.PI / 2, scale: 2 }]);
    expect(h!.hx).toBeCloseTo(7); expect(h!.hz).toBeCloseTo(3.5); expect(h!.y1).toBeCloseTo(7.6);
    expect(h!.rot).toBeCloseTo(Math.PI / 2);
    const [g] = placementBoxes([{ kind: 'veg.hedge', x: 0, z: 0, params: { length: 6 } }]);
    expect(g!.hx).toBeCloseTo(3); expect(g!.cls).toBe('tree');
    expect(placementBoxes([{ kind: 'lm.stadium', x: 0, z: 0 }])[0]!.cls).toBe('landmark');
    expect(placementBoxes([{ kind: 'st.lamp', x: 0, z: 0 }, { kind: 'nope.unknown', x: 0, z: 0 }])).toHaveLength(0);
  });

  it('models each station as its building plus the platform canopy, clear of the platform queue', () => {
    for (const st of TOWN.rail.stations) {
      const bs = stationBoxes(st.id);
      expect(bs.map((b) => b.kind).sort()).toEqual(['station.building', 'station.canopy']);
      for (const b of bs) expect(containsPoint(b, { x: st.platform.x, y: 0.95, z: st.platform.z })).toBe(false);
      expect(bs.find((b) => b.kind === 'station.canopy')!.y0).toBeGreaterThan(2);
    }
  });

  it('uses district items where districts are populated and base scenery elsewhere', () => {
    const empty = composeStudyTown(TOWN, [], SCENERY);
    expect(empty.sources.baseItems).toBeGreaterThan(20);
    expect(empty.sources.districtItems).toBe(0);
    expect(empty.stations).toHaveLength(3);
    const campus: DistrictScenery = {
      id: 'campus', region: { center: { x: -13, z: -7.3 }, radius: 10.5 },
      items: [{ kind: 'cp.library', x: -12, z: -6 }], paths: [], areas: [],
    };
    const t = composeStudyTown(TOWN, [campus], SCENERY);
    expect(t.sources.districtItems).toBe(1);
    expect(t.placements.some((p) => p.kind === 'cp.library')).toBe(true);
    expect(t.placements.some((p) => p.kind === 'lm.clockTower')).toBe(false); // base clock tower sits inside campus
    expect(t.placements.some((p) => p.kind === 'lm.stadium')).toBe(true);
    const square: DistrictScenery = { ...campus, region: { polygon: [{ x: -40, z: -40 }, { x: 40, z: -40 }, { x: 40, z: 40 }, { x: -40, z: 40 }] } };
    expect(composeStudyTown(TOWN, [square], SCENERY).sources.baseItems).toBe(0);
    expect(studyBoxes(empty).length).toBeGreaterThan(30);
  });
});

describe('samples', () => {
  it('grows queue slots along queueDir in parallel rows', () => {
    const p = { x: 4, z: -2 }, dir = { x: 0, z: 1 };
    const s = Array.from({ length: 12 }, (_, i) => queueSlot(p, dir, i));
    expect(s[0]!.z).toBeGreaterThan(p.z);
    expect(s[1]!.z).toBeGreaterThan(s[0]!.z);
    expect(s[6]!.x).not.toBeCloseTo(4);
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) expect(Math.hypot(s[i]!.x - s[j]!.x, s[i]!.z - s[j]!.z)).toBeGreaterThan(0.3);
  });

  it('samples every stop, platform queue, platform edge, route and the rail outside the tunnel', () => {
    const tunnel = { fromDist: 10, toDist: 28 };
    const all = studySamples(TOWN, { slots: 12, railTunnel: tunnel });
    const by = (c: string) => all.filter((s) => s.cls === c);
    const places = new Set(by('queue').map((s) => s.place));
    for (const s of TOWN.stops) { expect(places.has(s.id)).toBe(true); expect(by('stop').some((x) => x.place === s.id)).toBe(true); }
    for (const st of TOWN.rail.stations) { expect(places.has(st.id)).toBe(true); expect(by('platform').some((x) => x.place === st.id)).toBe(true); }
    expect(by('queue')).toHaveLength((TOWN.stops.length + TOWN.rail.stations.length) * 12);
    for (const r of TOWN.routes) {
      const rs = by('route').filter((s) => s.place === r.id);
      expect(rs.length).toBeGreaterThan(r.path.length / 1.2);
      for (const s of rs.slice(0, 40)) {
        const q = pointAt(r.path, nearestDist(r.path, { x: s.p.x, z: s.p.z }));
        expect(Math.hypot(q.x - s.p.x, q.z - s.p.z)).toBeLessThan(0.05);
      }
    }
    const rail = by('rail');
    expect(rail.length).toBeGreaterThan(100);
    const inTunnel = pointAt(TOWN.rail.loop, 19);
    expect(rail.some((s) => Math.hypot(s.p.x - inTunnel.x, s.p.z - inTunnel.z) < 0.6)).toBe(false);
    for (const s of all) expect(s.p.y).toBeGreaterThan(0);
  });
});

describe('fit', () => {
  it('lays the HUD out like the shell: top bar, bottom-left legend, bottom card, optional inspector', () => {
    const boxes = hudBoxes(1600, 1000);
    const top = boxes.find((b) => b.id === 'topbar')!;
    expect(top.y1).toBe(80);
    const legend = boxes.find((b) => b.id === 'legend')!;
    expect(legend.x0).toBe(0); expect(legend.y1).toBe(1000);
    expect(boxes.some((b) => b.id === 'inspector')).toBe(false);
    expect(hudBoxes(1600, 1000, { inspector: true }).some((b) => b.id === 'inspector')).toBe(true);
    expect(hudBoxes(1600, 1000, { mode: 'play' }).find((b) => b.id === 'bottom')!.y0).toBeLessThan(boxes.find((b) => b.id === 'bottom')!.y0);
  });

  it('picks the HUD-free rectangle that shows the content largest, with 4 % padding', () => {
    const boxes = hudBoxes(1600, 1000);
    const wide = safeRect(1600, 1000, boxes, { w: 2.4, h: 1 });
    const tall = safeRect(1600, 1000, boxes, { w: 1, h: 1 });
    for (const s of [wide, tall]) {
      for (const b of boxes) expect(overlaps(s.rect, b)).toBe(false);
      expect(s.inner.x0 - s.rect.x0).toBeCloseTo((s.rect.x1 - s.rect.x0) * 0.04, 6);
      expect(s.inner.y1).toBeLessThan(s.rect.y1);
    }
    expect(wide.rect.x1 - wide.rect.x0).toBeGreaterThan(tall.rect.x1 - tall.rect.x0); // wide content takes the full-width band
    const r = contentRect([{ x: -2, y: 1 }, { x: 3, y: -4 }]);
    expect(r).toEqual({ x0: -2, y0: -4, x1: 3, y1: 1 });
  });

  it('fits the transit network inside the inner safe rect, smaller when the inspector opens', () => {
    const v = { elev: ISO_ELEV, az: 45 };
    const closed = fitView(v, TOWN, { w: 1600, h: 1000 });
    const open = fitView(v, TOWN, { w: 1600, h: 1000 }, { inspector: true });
    expect(open.scale).toBeLessThan(closed.scale);
    for (const f of [closed, open]) {
      const basis = viewBasis(v);
      for (const s of [...TOWN.rail.loop.points.map((p) => ({ x: p.x, y: 0, z: p.z })), ...TOWN.stops.map((s) => ({ x: s.p.x, y: 2.6, z: s.p.z }))]) {
        const q = f.toScreen(toImage(basis, s));
        expect(q.x).toBeGreaterThanOrEqual(f.inner.x0 - 1e-6); expect(q.x).toBeLessThanOrEqual(f.inner.x1 + 1e-6);
        expect(q.y).toBeGreaterThanOrEqual(f.inner.y0 - 1e-6); expect(q.y).toBeLessThanOrEqual(f.inner.y1 + 1e-6);
      }
    }
  });
});

describe('measure', () => {
  const town = composeStudyTown(TOWN, [], SCENERY);
  const base: StudyInput = { map: TOWN, samples: studySamples(TOWN), boxes: studyBoxes(town), viewport: { w: 1600, h: 1000 } };

  it('hides nothing without occluders and everything behind a giant wall', () => {
    const v = STUDY_VIEWS[0]!;
    const none = measureView(v, { ...base, boxes: [] });
    for (const c of Object.values(none.hidden)) expect(c.frac).toBe(0);
    const wall: Box = box({ cx: 60, cz: 60, hx: 200, hz: 0.5, y1: 400, rot: Math.PI / 4 }); // runs across the view
    const all = measureView(v, { ...base, boxes: [wall] });
    for (const c of Object.values(all.hidden)) expect(c.frac).toBe(1);
  });

  it('is deterministic and hides no more from a higher camera (ground-standing boxes)', () => {
    const ground = base.boxes.filter((b) => b.y0 <= 0.01);
    const lo = measureView({ id: 'lo', elev: 30, az: 45 }, { ...base, boxes: ground });
    const hi = measureView({ id: 'hi', elev: 45, az: 45 }, { ...base, boxes: ground });
    expect(measureView({ id: 'lo', elev: 30, az: 45 }, { ...base, boxes: ground })).toEqual(lo);
    for (const c of Object.keys(lo.hidden) as Array<keyof typeof lo.hidden>) expect(hi.hidden[c].hidden).toBeLessThanOrEqual(lo.hidden[c].hidden);
    expect(hi.screen.groundPx).toBeGreaterThan(0);
    expect(lo.screen.personPx).toBeGreaterThan(hi.screen.personPx);
    expect(lo.fit.scale).toBeGreaterThan(0);
  });

  it('reports dwelling-vehicle occlusion, marker overlaps and per-place detail', () => {
    const r = measureView(STUDY_VIEWS[4]!, base);
    expect(r.behindVehicle.frac).toBeGreaterThanOrEqual(0);
    expect(r.behindVehicle.frac).toBeLessThanOrEqual(1);
    expect(r.screen.markerPairs).toBeGreaterThan(0);
    expect(r.perPlace.length).toBe(TOWN.stops.length + TOWN.rail.stations.length);
    expect(r.screen.queueSpacingMinPx).toBeGreaterThan(0);
    expect(r.screen.streetRatio).toBeCloseTo(1, 6); // az 45: both street directions read the same
  });

  it('ranks views by score, best first, with a dominated view last', () => {
    const rs = STUDY_VIEWS.map((v) => measureView(v, base));
    const ranked = rankViews(rs);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    const worse = { ...ranked[0]!, view: { id: 'worse', elev: 1, az: 1 }, hidden: Object.fromEntries(Object.entries(ranked[0]!.hidden).map(([k, v]) => [k, { ...v, hidden: v.n, frac: 1 }])) as typeof ranked[0]['hidden'] };
    const again = rankViews([...rs, worse]);
    expect(again[again.length - 1]!.view.id).toBe('worse');
  });

  it('works on any map shape (no TOWN-only assumptions)', () => {
    const tiny: TownMap = { ...TOWN, routes: TOWN.routes.slice(0, 1) };
    const r = measureView(STUDY_VIEWS[1]!, { ...base, map: tiny, samples: studySamples(tiny) });
    expect(r.hidden.route.n).toBeGreaterThan(0);
  });
});

describe('world height field', () => {
  const ext = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
  const scene = () => {
    const g = new THREE.Group();
    const hill = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial()); hill.position.set(10, 2, 0); hill.name = 'hill';
    const cloud = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), new THREE.MeshStandardMaterial()); cloud.position.set(-10, 10.5, 0); cloud.name = 'cloud';
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial()); sky.name = 'sky'; // screen-space quad at the origin
    const water = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), new THREE.MeshStandardMaterial()); water.position.y = -0.3;
    const pines = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 3, 6), new THREE.MeshStandardMaterial(), 2); pines.name = 'pines';
    pines.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 1.5, 10)); pines.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 1.5, -10));
    g.add(hill, cloud, sky, water, pines);
    return g;
  };
  const hf = buildHeightField(scene(), ext, { cell: 0.5 });
  const east = { x: 1, y: 0, z: 0 }, west = { x: -1, y: 0, z: 0 }, south = { x: 0, y: 0, z: 1 };
  it('blocks rays through solid terrain and instances, not under floating props or through skipped meshes', () => {
    expect(heightFieldHit(hf, { x: 0, y: 1, z: 0 }, east)).toBeNull(); // horizontal rays never climb: ignored
    const up = (v: { x: number; z: number }) => { const n = Math.hypot(v.x, v.z); return { x: (v.x / n) * 0.9, y: 0.1 / Math.hypot(0.9, 0.1) * 1, z: (v.z / n) * 0.9 }; };
    expect(heightFieldHit(hf, { x: 0, y: 1, z: 0 }, up(east))).toBe('hill');
    expect(heightFieldHit(hf, { x: 0, y: 1, z: 0 }, up(west))).toBeNull(); // passes under the cloud (y ≈ 2 at x = -10)
    expect(heightFieldHit(hf, { x: 0, y: 1, z: 0 }, up(south))).toBe('pines');
    expect(heightFieldHit(hf, { x: 0.2, y: 0.2, z: 0.2 }, { x: 0, y: 1, z: 0 })).toBeNull(); // the sky quad at the origin is skipped
    expect(heightFieldHit(hf, { x: -10, y: 9, z: 0 }, { x: 0, y: 1, z: 0 })).toBe('cloud'); // but a ray climbing into the cloud is blocked
    expect(heightFieldHit(hf, { x: 5, y: 0.1, z: 5 }, { x: 0, y: 1, z: 0 })).toBeNull(); // water below the board never occludes
  });
});
