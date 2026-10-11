// Owner: G3. Waterfront plan + layer: everything sits on waterfront land or open water (never roads, rail, ridge,
// board), clear of the rail, a harbour at Marina Rd, registered kinds, ≤ 20 draw calls, faces up, palette swaps.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { projectOnPolyline, TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { createRegistry } from '../../../assets/index';
import { cellOf, greaterGrid, inGrid, isWater } from '../../grid';
import { buildDeck, buildPromenade } from '../build';
import { createWaterfrontLayer, inWaterfront, planWaterfront, runAt, WF } from '../index';

const g = greaterGrid(TOWN);
const plan = planWaterfront(TOWN);
const useAt = (p: Vec2) => { const { c, r } = cellOf(g, p.x, p.z); return inGrid(g, c, r) ? g.use[r]![c]! : 'out'; };
const blockZone = (p: Vec2) => g.blocks.find((b) => p.x >= b.rect.minX && p.x < b.rect.maxX && p.z >= b.rect.minZ && p.z < b.rect.maxZ)?.zone;
/** Waterfront land, open water (incl. rail-margin water cells), or the bay just past the grid's south / east edge. */
const allowed = (p: Vec2) => {
  const u = useAt(p);
  if (u === 'free') return blockZone(p) === 'waterfront';
  if (u === 'water') return true;
  if (u === 'rail') return isWater(g, p.x, p.z);
  if (u === 'out') return p.z > g.bounds.maxZ || p.x > g.bounds.maxX;
  return false;
};
const railD = (p: Vec2) => projectOnPolyline(TOWN.rail.loop, p).d;

describe('waterfront plan', () => {
  it('is memoised and deterministic', () => {
    expect(planWaterfront(TOWN)).toBe(plan);
    expect(plan.runs.length).toBeGreaterThanOrEqual(3);
    expect(plan.runs.some((r) => r.kind === 'promenade' && r.length > 20)).toBe(true);
    expect(plan.runs.some((r) => r.kind === 'boardwalk' && r.length > 15)).toBe(true);
  });

  it('runs, decks and items stay on waterfront land / open water, never on roads, rail, ridge or the board', () => {
    const bad: string[] = [];
    for (const r of plan.runs) for (let s = 0; s <= r.length; s += 0.5) { const { p } = runAt(r, s); if (!allowed(p)) bad.push(`${r.id}@${s}`); }
    for (const d of plan.decks) for (let t = -0.5; t <= 0.5; t += 0.25) { const p = { x: d.c.x + d.dir.x * d.len * t, z: d.c.z + d.dir.z * d.len * t }; if (!allowed(p) && useAt(p) !== 'road') bad.push(d.id); }
    for (const it of plan.items) if (!allowed(it)) bad.push(`${it.kind}@${it.x.toFixed(1)},${it.z.toFixed(1)}`);
    expect(bad).toEqual([]);
  });

  it('keeps clear of the rail (beach run + bay bridge)', () => {
    const near = [...plan.items, ...plan.decks.map((d) => d.c), ...plan.runs.flatMap((r) => r.pts)].filter((p) => railD(p) < WF.railClear - 0.2);
    expect(near).toEqual([]);
  });

  it('builds the harbour at the end of Marina Rd with finger slips and moored boats', () => {
    expect(plan.harbour?.street).toBe('Marina Rd');
    expect(plan.decks.filter((d) => d.kind === 'finger').length).toBeGreaterThanOrEqual(4);
    const boats = plan.items.filter((i) => i.boat);
    expect(boats.length).toBeGreaterThanOrEqual(4);
    expect(boats.length).toBeLessThanOrEqual(10);
    for (const b of boats) { expect(b.y).toBe(WF.waterY); expect(isWater(g, Math.min(b.x, g.bounds.maxX - 0.01), Math.min(b.z, g.bounds.maxZ - 0.01))).toBe(true); }
  });

  it('places only registered kinds (or its own wf.* pieces) and exposes footprints', () => {
    const reg = createRegistry();
    const unknown = [...new Set(plan.items.map((i) => i.kind))].filter((k) => !k.startsWith('wf.') && !reg.get(k));
    expect(unknown).toEqual([]);
    const lamp = plan.items.find((i) => i.kind === 'st.lamp')!;
    expect(inWaterfront(plan, lamp, 0.5)).toBe(true);
    expect(inWaterfront(plan, { x: 0, z: 0 })).toBe(false);
  });
});

describe('waterfront layer (no Kenney preload: registry fallbacks)', () => {
  const layer = createWaterfrontLayer(TOWN, { palette: 'a' });
  const meshes: THREE.Mesh[] = [];
  layer.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });

  it('stays within 20 draw calls', () => {
    expect(meshes.length).toBe(layer.stats.drawCalls);
    expect(layer.stats.drawCalls).toBeLessThanOrEqual(20);
    expect(layer.stats.vertices).toBeGreaterThan(5000);
  });

  it('promenade paving and deck tops face up', () => {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let up = 0, down = 0;
    const scan = (root: THREE.Object3D, y: number) => {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m.material as THREE.Material).userData.role === 'wfRail') return; // posts stand on the deck
        const P = m.geometry.getAttribute('position'), I = m.geometry.getIndex();
        const n = I ? I.count : P.count;
        for (let t = 0; t < n; t += 3) {
          const ia = I ? I.getX(t) : t, ib = I ? I.getX(t + 1) : t + 1, ic = I ? I.getX(t + 2) : t + 2;
          a.fromBufferAttribute(P, ia).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(P, ib).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(P, ic).applyMatrix4(m.matrixWorld);
          if ([a, b, c].some((v) => Math.abs(v.y - y) > 1e-3)) continue;
          const nn = b.clone().sub(a).cross(c.clone().sub(a));
          if (nn.length() < 1e-6) continue;
          if (nn.y > 0) up++; else down++;
        }
      });
    };
    for (const r of plan.runs) if (r.kind === 'promenade') scan(buildPromenade(r), WF.paveTop);
    for (const d of plan.decks) scan(buildDeck(d), d.top);
    expect(up).toBeGreaterThan(100);
    expect(down).toBe(0);
  });

  it('bobs boats, swaps palettes and disposes', () => {
    const boat = meshes.find((m) => m.name.startsWith('waterfront:boat'))!;
    layer.update({ timeS: 0 });
    const y0 = boat.position.y;
    layer.update({ timeS: 1.1 });
    expect(boat.position.y).not.toBe(y0);
    expect(Math.abs(boat.position.y - WF.waterY)).toBeLessThanOrEqual(0.06);
    const stat = meshes.find((m) => m.name === 'waterfront:static')!;
    const col = stat.geometry.getAttribute('color') as THREE.BufferAttribute;
    const before = Array.from(col.array as Float32Array).slice(0, 300).join(',');
    layer.setPalette!('c');
    expect(Array.from(col.array as Float32Array).slice(0, 300).join(',')).not.toBe(before);
    layer.dispose();
  });
});
