// Owner: T3b. 2D isometric placeholder renderer for the HUD dev harness (never shipped). Implements the
// TownRendererApi seam (project/pick/highlight) so QueueMarkers and the Inspector run exactly as in the app.
import type { RouteId, SimSnapshot, StopId } from '@headway/sim';
import { PALETTES } from '../../../render/palettes';
import type { LightMode, PaletteId, Pick, TownRendererApi } from '../../../render/types';
import { ROUTE_IDS, townMap } from '../format';
import { pointOn } from './devSim';
import type { Geo } from './devSim';

const C30 = Math.cos(Math.PI / 6);
const S30 = 0.5;

export function createDevRenderer(canvas: HTMLCanvasElement, geo: Geo, opts: { palette: PaletteId; light: LightMode }): TownRendererApi {
  const ctx = canvas.getContext('2d')!;
  let palette = opts.palette;
  let light = opts.light;
  let highlight: RouteId | null = null;
  let selected: Pick | null = null;
  let w = 0;
  let h = 0;
  let k = 10;
  let cx = 0;
  let cy = 0;
  let last: SimSnapshot | null = null;

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    k = Math.min((w * 0.86) / (124 * C30), (h * 0.7) / (124 * S30));
    cx = w / 2;
    cy = h * 0.56;
  };
  const P = (x: number, z: number, y = 0) => ({ x: cx + (x - z) * C30 * k, y: cy + (x + z) * S30 * k - y * k * 0.9 });

  const poly = (pts: Array<{ x: number; z: number }>, y = 0) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const s = P(p.x, p.z, y); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.closePath();
  };
  const fade = (hex: string, a: number) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  const rrect = (x: number, y: number, ww: number, hh: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x - ww / 2, y - hh / 2, ww, hh, r);
  };

  function draw(snap: SimSnapshot | null) {
    const pal = PALETTES[palette] ?? PALETTES.a;
    const dusk = light === 'dusk';
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, Math.max(w, h) * 0.75);
    g.addColorStop(0, dusk ? '#46507a' : '#f1f8f3');
    g.addColorStop(1, dusk ? pal.duskBg : pal.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // board slab
    const B = [{ x: -36, z: -26 }, { x: 36, z: -26 }, { x: 36, z: 26 }, { x: -36, z: 26 }];
    ctx.save();
    ctx.shadowColor = 'rgba(20,30,50,0.22)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    poly(B, -1.6);
    ctx.fillStyle = pal.boardEdge;
    ctx.fill();
    ctx.restore();
    poly(B);
    ctx.fillStyle = pal.board;
    ctx.fill();

    // neighbourhood pads (from the town map when loaded) and the stadium bowl
    const map = townMap();
    const hoods = map?.neighborhoods?.length ? map.neighborhoods : [
      { id: 'campus', center: { x: -14, z: -16 }, radius: 11 }, { id: 'downtown', center: { x: 2, z: 2 }, radius: 9 },
      { id: 'apartments', center: { x: 2, z: 18 }, radius: 10 }, { id: 'stadium', center: { x: 24, z: -10 }, radius: 9 },
    ];
    for (const n of hoods) {
      const c = P(n.center.x, n.center.z);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, n.radius * k * C30 * Math.SQRT2, n.radius * k * S30 * Math.SQRT2, 0, 0, Math.PI * 2);
      ctx.fillStyle = fade(n.id === 'campus' || n.id === 'stadium' ? pal.lawn : pal.curb, 0.5);
      ctx.fill();
      if (n.id === 'stadium') {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 6.5 * k * C30 * Math.SQRT2, 6.5 * k * S30 * Math.SQRT2, 0, 0, Math.PI * 2);
        ctx.fillStyle = pal.stadium;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(c.x, c.y + 2, 4.2 * k * C30 * Math.SQRT2, 4.2 * k * S30 * Math.SQRT2, 0, 0, Math.PI * 2);
        ctx.fillStyle = pal.field;
        ctx.fill();
      }
    }
    for (const z of map?.zones ?? []) {
      const s0 = P(z.door.x, z.door.z, 0);
      const hgt = z.tags.includes('housing') ? 3.2 : z.tags.includes('hall') ? 2.4 : z.tags.includes('retail') ? 1.8 : 0;
      if (!hgt) continue;
      const top = P(z.door.x, z.door.z, hgt);
      rrect(s0.x, (s0.y + top.y) / 2, 2.2 * k, s0.y - top.y + 1.2 * k, 0.4 * k);
      ctx.fillStyle = pal.wall[(z.id.length) % pal.wall.length]!;
      ctx.fill();
      rrect(top.x, top.y, 2.2 * k, 1.1 * k, 0.4 * k);
      ctx.fillStyle = pal.roof[(z.id.length) % pal.roof.length]!;
      ctx.fill();
    }

    // rail
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    geo.rail.loop.pts.forEach((p, i) => { const s = P(p.x, p.z); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.strokeStyle = pal.ballast;
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = pal.ties;
    ctx.lineWidth = 0.9 * k;
    ctx.stroke();
    ctx.setLineDash([]);

    // routes (road ribbons in route colours; highlight dims the others)
    ROUTE_IDS.forEach((r, i) => {
      const loop = geo.routes[r].loop;
      const dim = highlight !== null && highlight !== r;
      ctx.beginPath();
      loop.pts.forEach((p, j) => { const s = P(p.x + (i - 1) * 0.5, p.z + (i - 1) * 0.5); if (j) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.strokeStyle = pal.road;
      ctx.lineWidth = 1.6 * k;
      ctx.stroke();
      ctx.strokeStyle = fade(pal.route[i]!, dim ? 0.18 : highlight === r ? 1 : 0.8);
      ctx.lineWidth = (highlight === r ? 0.75 : 0.45) * k;
      ctx.stroke();
    });

    // stations + stops
    for (const sid of Object.keys(geo.stations) as Array<keyof Geo['stations']>) {
      const p = geo.stations[sid];
      poly([{ x: p.x - 3.2, z: p.z - 1 }, { x: p.x + 3.2, z: p.z - 1 }, { x: p.x + 3.2, z: p.z + 1 }, { x: p.x - 3.2, z: p.z + 1 }], 0.5);
      ctx.fillStyle = pal.platform;
      ctx.fill();
      poly([{ x: p.x - 2.6, z: p.z - 0.8 }, { x: p.x + 2.6, z: p.z - 0.8 }, { x: p.x + 2.6, z: p.z + 0.2 }, { x: p.x - 2.6, z: p.z + 0.2 }], 2.2);
      ctx.fillStyle = pal.canopy;
      ctx.fill();
    }
    for (const id of Object.keys(geo.stops) as StopId[]) {
      const p = geo.stops[id];
      const s = P(p.x, p.z, 1.6);
      const sel = selected?.kind === 'stop' && selected.id === id;
      ctx.fillStyle = pal.post;
      ctx.fillRect(s.x - 1, s.y, 2, 1.6 * k * 0.9);
      rrect(s.x, s.y, 1.9 * k, 1.1 * k, 4);
      ctx.fillStyle = sel ? pal.accent : pal.stop;
      ctx.fill();
    }

    if (!snap) return;
    // waiting people
    for (const person of snap.people) {
      if (person.state !== 'waiting' || !person.at) continue;
      const base = person.at.kind === 'stop' ? geo.stops[person.at.id] : geo.stations[person.at.id];
      const dir = person.at.kind === 'stop' ? geo.queueDir[person.at.id] ?? { x: 1, z: 0 } : { x: 1, z: 0 };
      const slot = person.slot ?? 0;
      const row = Math.floor(slot / 6);
      const col = slot % 6;
      const x = base.x + dir.x * (1.4 + col * 0.7) - dir.z * row * 0.7;
      const z = base.z + dir.z * (1.4 + col * 0.7) + dir.x * row * 0.7;
      const s = P(x, z, 0.4);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 0.32 * k, 0, Math.PI * 2);
      ctx.fillStyle = pal.shirt[person.tint % pal.shirt.length]!;
      ctx.fill();
    }
    // vehicles
    for (const v of snap.vehicles) {
      const loop = v.path.kind === 'route' ? geo.routes[v.path.routeId].loop : geo.rail.loop;
      const p = pointOn(loop, v.dist);
      const s = P(p.x, p.z, 0.8);
      const sel = selected && selected.id === v.id;
      const dim = highlight !== null && v.routeId !== highlight;
      ctx.save();
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.translate(s.x, s.y);
      const ang = Math.atan2((Math.sin(p.heading) + Math.cos(p.heading)) * S30, (Math.cos(p.heading) - Math.sin(p.heading)) * C30);
      ctx.rotate(ang);
      if (sel) {
        rrect(0, 0, (v.kind === 'train' ? 9 : 4.4) * k, 2.4 * k, 1.2 * k);
        ctx.fillStyle = fade(pal.accent, 0.25);
        ctx.fill();
      }
      if (v.kind === 'train') {
        for (const off of [-2.2, 2.2]) {
          rrect(off * k, 0, 4.1 * k, 1.5 * k, 0.5 * k);
          ctx.fillStyle = pal.train;
          ctx.fill();
        }
      } else {
        rrect(0, 0, 3.2 * k, 1.35 * k, 0.45 * k);
        ctx.fillStyle = pal.bus;
        ctx.fill();
        const ri = v.routeId ? ROUTE_IDS.indexOf(v.routeId) : 0;
        rrect(0, 0.42 * k, 3.2 * k, 0.32 * k, 0.15 * k);
        ctx.fillStyle = pal.route[ri]!;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  resize();
  return {
    render(_prev, next) { last = next; draw(next); },
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      let best: Pick | null = null;
      let bestD = 28;
      for (const v of last?.vehicles ?? []) {
        const loop = v.path.kind === 'route' ? geo.routes[v.path.routeId].loop : geo.rail.loop;
        const p = pointOn(loop, v.dist);
        const s = P(p.x, p.z, 0.8);
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bestD) { bestD = d; best = { kind: v.kind, id: v.id }; }
      }
      for (const id of Object.keys(geo.stops) as StopId[]) {
        const s = P(geo.stops[id].x, geo.stops[id].z, 1.6);
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bestD) { bestD = d; best = { kind: 'stop', id }; }
      }
      return best;
    },
    select(p) { selected = p; draw(last); },
    highlightRoute(id) { highlight = id; draw(last); },
    setPalette(p) { palette = p; draw(last); },
    setDetail() {},
    setLight(l) { light = l; draw(last); },
    project(x, y, z) { const s = P(x, z, y); return { x: s.x, y: s.y, visible: s.x > -50 && s.y > -50 && s.x < w + 50 && s.y < h + 50 }; },
    resize() { resize(); draw(last); },
    dispose() {},
  };
}
