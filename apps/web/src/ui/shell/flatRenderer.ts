// Fallback town view (T3a): a flat 2D map used only when the 3D TownRenderer is unavailable (WebGL failure, or the
// renderer still a no-op stub). Same TownRendererApi, so picking, the inspector and queue markers keep working.
import { TOWN, deadheadPath, pointAt, routeById } from '@headway/sim';
import type { PersonView, Polyline, RouteId, SimSnapshot, StationId, StopId, TownMap, VehicleView } from '@headway/sim';
import { PALETTES } from '../../render/palettes';
import { SCENERY } from '../../render/scenery';
import type { SceneryItem } from '../../render/scenery';
import type { LightMode, PaletteId, Pick, TownRendererApi } from '../../render/types';

const ROUTES: RouteId[] = ['r1', 'r2', 'r3'];
/** Kit footprints (w along x, d along z with the front facing +z), from render/scenery.ts. */
const FOOTPRINT: Record<string, [number, number]> = {
  small: [3, 3], tall: [3.2, 3.2], hall: [6.6, 3.2], shop: [2.6, 2.4], house: [2.8, 2.2], townhouses: [4.5, 2.4],
  cafe: [2.8, 2.3], dorm: [4.6, 3.2], library: [5.4, 4], clockTower: [2.3, 2.3], stadium: [10.8, 8.4],
};
const TOP_PX = 96;
const BOTTOM_PX = 130;
const SIDE_PX = 40;

interface Xform { s: number; ox: number; oz: number }

export class FlatTownRenderer implements TownRendererApi {
  private palette: PaletteId = 'a';
  private light: LightMode = 'day';
  private highlighted: RouteId | null = null;
  private selected: Pick | null = null;
  private xf: Xform = { s: 1, ox: 0, oz: 0 };
  private cssW = 1;
  private cssH = 1;
  private last: { vehicles: Array<{ id: string; kind: 'bus' | 'train'; x: number; z: number }> } = { vehicles: [] };
  private deadheads = new Map<string, Polyline>();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly ctx: CanvasRenderingContext2D, private readonly map: TownMap = TOWN) {
    this.resize();
  }

  /** A 2D context if the canvas has no WebGL context yet (so the 3D renderer never touched it). */
  static tryCreate(canvas: HTMLCanvasElement, map: TownMap = TOWN): FlatTownRenderer | null {
    const ctx = canvas.getContext('2d');
    return ctx ? new FlatTownRenderer(canvas, ctx, map) : null;
  }

  resize(): void {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.cssW = Math.max(1, this.canvas.clientWidth);
    this.cssH = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = this.map.bounds;
    const w = this.cssW - SIDE_PX * 2;
    const h = this.cssH - TOP_PX - BOTTOM_PX;
    const s = Math.max(1, Math.min(w / (b.maxX - b.minX), h / (b.maxZ - b.minZ)));
    this.xf = { s, ox: SIDE_PX + (w - s * (b.maxX - b.minX)) / 2 - b.minX * s, oz: TOP_PX + (h - s * (b.maxZ - b.minZ)) / 2 - b.minZ * s };
  }

  private sx(x: number): number { return this.xf.ox + x * this.xf.s; }
  private sz(z: number): number { return this.xf.oz + z * this.xf.s; }

  project(x: number, _y: number, z: number): { x: number; y: number; visible: boolean } {
    const px = this.sx(x);
    const py = this.sz(z);
    return { x: px, y: py, visible: px >= 0 && py >= 0 && px <= this.cssW && py <= this.cssH };
  }

  private pathOf(v: VehicleView): Polyline | null {
    try {
      if (v.path.kind === 'rail') return this.map.rail.loop;
      if (v.path.kind === 'route') return routeById(this.map, v.path.routeId).path;
      const key = `${v.path.from}>${v.path.to}`;
      let p = this.deadheads.get(key);
      if (!p) { p = deadheadPath(this.map, v.path.from, v.path.to); this.deadheads.set(key, p); }
      return p;
    } catch {
      return null;
    }
  }

  private stroke(poly: Polyline, color: string, width: number, dash: number[] = []): void {
    const c = this.ctx;
    const pts = poly.points;
    if (pts.length < 2) return;
    c.beginPath();
    c.moveTo(this.sx(pts[0]!.x), this.sz(pts[0]!.z));
    for (let i = 1; i < pts.length; i++) c.lineTo(this.sx(pts[i]!.x), this.sz(pts[i]!.z));
    if (poly.closed) c.closePath();
    c.setLineDash(dash);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.stroke();
    c.setLineDash([]);
  }

  private queuePos(at: { kind: 'stop'; id: StopId } | { kind: 'platform'; id: StationId }, slot: number): { x: number; z: number } {
    if (at.kind === 'stop') {
      const s = this.map.stops.find((x) => x.id === at.id);
      if (s) return { x: s.p.x + s.queueDir.x * (0.9 + slot * 0.45), z: s.p.z + s.queueDir.z * (0.9 + slot * 0.45) };
    } else {
      const s = this.map.rail.stations.find((x) => x.id === at.id);
      if (s) return { x: s.platform.x + s.queueDir.x * (0.9 + slot * 0.45), z: s.platform.z + s.queueDir.z * (0.9 + slot * 0.45) };
    }
    return { x: 0, z: 0 };
  }

  render(prev: SimSnapshot, next: SimSnapshot, alpha: number): void {
    const c = this.ctx;
    const P = PALETTES[this.palette] ?? PALETTES.a;
    const s = this.xf.s;
    const dusk = this.light === 'dusk';
    c.clearRect(0, 0, this.cssW, this.cssH);

    // board
    const b = this.map.bounds;
    c.fillStyle = P.boardEdge;
    c.beginPath();
    c.roundRect(this.sx(b.minX), this.sz(b.minZ) + 6, (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s, 18);
    c.fill();
    c.fillStyle = dusk ? '#6E8F86' : P.board;
    c.beginPath();
    c.roundRect(this.sx(b.minX), this.sz(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s, 18);
    c.fill();

    // lawns, then roads, rail and buildings, then route ribbons
    for (const it of SCENERY) {
      if (it.kind !== 'lawn') continue;
      c.fillStyle = P.lawn;
      c.beginPath();
      c.roundRect(this.sx(it.x - (it.w ?? 4) / 2), this.sz(it.z - (it.d ?? 4) / 2), (it.w ?? 4) * s, (it.d ?? 4) * s, 0.6 * s);
      c.fill();
    }
    for (const e of this.map.roads.edges) this.stroke(e.path, P.road, 2.4 * s);
    for (const it of SCENERY) this.drawScenery(it, P);
    this.stroke(this.map.rail.loop, P.ballast, 1.6 * s);
    this.stroke(this.map.rail.loop, P.rail, 0.35 * s, [0.6 * s, 0.5 * s]);
    ROUTES.forEach((id, i) => {
      const r = this.map.routes.find((x) => x.id === id);
      if (!r) return;
      const faded = this.highlighted !== null && this.highlighted !== id;
      c.globalAlpha = faded ? 0.18 : this.highlighted === id ? 1 : 0.7;
      this.stroke(r.path, P.route[i] ?? r.color, (this.highlighted === id ? 0.75 : 0.45) * s);
      c.globalAlpha = 1;
    });

    // stations and stops
    for (const st of this.map.rail.stations) {
      c.fillStyle = P.platform;
      c.strokeStyle = P.canopy;
      c.lineWidth = 2;
      c.beginPath();
      c.roundRect(this.sx(st.platform.x) - 1.6 * s, this.sz(st.platform.z) - 0.8 * s, 3.2 * s, 1.6 * s, 4);
      c.fill();
      c.stroke();
    }
    for (const st of this.map.stops) {
      const sel = this.selected?.kind === 'stop' && this.selected.id === st.id;
      c.fillStyle = P.stop;
      c.strokeStyle = P.ink;
      c.lineWidth = sel ? 3 : 1.5;
      c.beginPath();
      c.arc(this.sx(st.p.x), this.sz(st.p.z), sel ? 0.8 * s : 0.6 * s, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    // people
    const t = prev.t + (next.t - prev.t) * alpha;
    const shirts = P.shirt;
    for (const p of next.people) {
      const pos = this.personPos(p, t);
      if (!pos) continue;
      c.globalAlpha = p.state === 'arrived' ? Math.max(0, 1 - (t - (p.t1 ?? t)) / 3) : 1;
      c.fillStyle = shirts[p.tint % shirts.length] ?? P.ink;
      c.beginPath();
      c.arc(this.sx(pos.x), this.sz(pos.z), Math.max(1.6, 0.22 * s), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // vehicles (interpolated by dist, wrapping on closed paths)
    const prevById = new Map(prev.vehicles.map((v) => [v.id, v]));
    const drawn: FlatTownRenderer['last']['vehicles'] = [];
    for (const v of next.vehicles) {
      const path = this.pathOf(v);
      if (!path) continue;
      const pv = prevById.get(v.id);
      let d = v.dist;
      if (pv && pv.path.kind === v.path.kind && JSON.stringify(pv.path) === JSON.stringify(v.path)) {
        let delta = v.dist - pv.dist;
        if (path.closed && Math.abs(delta) > path.length / 2) delta -= Math.sign(delta) * path.length;
        d = pv.dist + delta * alpha;
      }
      const at = pointAt(path, d);
      drawn.push({ id: v.id, kind: v.kind, x: at.x, z: at.z });
      const routeIdx = v.routeId ? ROUTES.indexOf(v.routeId) : -1;
      const faded = this.highlighted !== null && v.routeId !== this.highlighted && v.kind === 'bus';
      const len = (v.kind === 'train' ? 7.2 : 3.3) * s;
      const wid = (v.kind === 'train' ? 1.5 : 1.25) * s;
      c.save();
      c.translate(this.sx(at.x), this.sz(at.z));
      c.rotate(-at.heading);
      c.globalAlpha = faded ? 0.35 : 1;
      c.fillStyle = v.kind === 'train' ? P.train : P.bus;
      c.beginPath();
      c.roundRect(-len / 2, -wid / 2, len, wid, wid * 0.45);
      c.fill();
      if (routeIdx >= 0) {
        c.fillStyle = P.route[routeIdx] ?? P.accent;
        c.fillRect(-len / 2 + wid * 0.3, wid * 0.12, len - wid * 0.6, wid * 0.22);
      }
      if (this.selected && this.selected.id === v.id) {
        c.strokeStyle = P.accent;
        c.lineWidth = 3;
        c.beginPath();
        c.roundRect(-len / 2 - 4, -wid / 2 - 4, len + 8, wid + 8, wid * 0.6);
        c.stroke();
      }
      c.restore();
    }
    this.last = { vehicles: drawn };
  }

  private drawScenery(it: SceneryItem, P: (typeof PALETTES)['a']): void {
    if (it.kind === 'lawn' || it.kind === 'station') return;
    const c = this.ctx;
    const s = this.xf.s;
    if (it.kind === 'tree') {
      const leaf = P.leaf[(it.leaf ?? 0) % P.leaf.length] ?? P.lawn;
      c.fillStyle = leaf;
      c.beginPath();
      c.arc(this.sx(it.x), this.sz(it.z), 0.85 * (it.scale ?? 1) * s, 0, Math.PI * 2);
      c.fill();
      return;
    }
    const fp = FOOTPRINT[it.building ?? it.kind] ?? [3, 3];
    const quarter = Math.round(((it.rot ?? 0) / (Math.PI / 2)) % 2) !== 0;
    const w = (quarter ? fp[1] : fp[0]) * (it.scale ?? 1) * s;
    const d = (quarter ? fp[0] : fp[1]) * (it.scale ?? 1) * s;
    const x = this.sx(it.x) - w / 2;
    const y = this.sz(it.z) - d / 2;
    c.fillStyle = 'rgba(31, 42, 68, 0.12)';
    c.beginPath();
    if (it.kind === 'stadium') c.ellipse(this.sx(it.x) + 0.25 * s, this.sz(it.z) + 0.35 * s, w / 2, d / 2, 0, 0, Math.PI * 2);
    else c.roundRect(x + 0.25 * s, y + 0.35 * s, w, d, 0.5 * s);
    c.fill();
    if (it.kind === 'stadium') {
      c.fillStyle = P.stadium;
      c.beginPath();
      c.ellipse(this.sx(it.x), this.sz(it.z), w / 2, d / 2, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = P.field;
      c.beginPath();
      c.ellipse(this.sx(it.x), this.sz(it.z), w * 0.32, d * 0.28, 0, 0, Math.PI * 2);
      c.fill();
      return;
    }
    const roof = it.kind === 'hall' && it.building === 'hall' ? P.hallRoof
      : it.kind === 'clockTower' ? P.towerRoof
      : P.roof[(it.roof ?? 0) % P.roof.length] ?? P.roof[0]!;
    c.fillStyle = roof;
    c.beginPath();
    c.roundRect(x, y, w, d, 0.45 * s);
    c.fill();
  }

  private personPos(p: PersonView, t: number): { x: number; z: number } | null {
    if (p.state === 'waiting' && p.at) return this.queuePos(p.at, p.slot ?? 0);
    if (p.from && p.to) {
      if (p.state === 'arrived') return p.to;
      const t0 = p.t0 ?? t;
      const t1 = p.t1 ?? t;
      const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
      return { x: p.from.x + (p.to.x - p.from.x) * k, z: p.from.z + (p.to.z - p.from.z) * k };
    }
    return null;
  }

  pick(clientX: number, clientY: number): Pick | null {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    let best: Pick | null = null;
    let bestD = 14;
    for (const v of this.last.vehicles) {
      const d = Math.hypot(this.sx(v.x) - x, this.sz(v.z) - y);
      if (d < bestD) { bestD = d; best = { kind: v.kind, id: v.id }; }
    }
    if (best) return best;
    for (const st of this.map.stops) {
      const d = Math.hypot(this.sx(st.p.x) - x, this.sz(st.p.z) - y);
      if (d < bestD) { bestD = d; best = { kind: 'stop', id: st.id }; }
    }
    return best;
  }

  select(p: Pick | null): void { this.selected = p; }
  highlightRoute(id: RouteId | null): void { this.highlighted = id; }
  setPalette(p: PaletteId): void { this.palette = p; }
  setDetail(): void {}
  setLight(l: LightMode): void { this.light = l; }
  dispose(): void { this.ctx.clearRect(0, 0, this.cssW, this.cssH); }
}
