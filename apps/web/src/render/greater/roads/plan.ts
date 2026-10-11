// Owner: G0. The greater-town street plan: authored relative to the grid frame and the town's board exits, then
// rasterised into Kenney road tiles (pure data; see ../grid.ts for the overview).
//
// Plan (TOWN: board cols 7–24 × rows 7–19, exits N x=−2, W z=0, S x=−2, E z=14.6):
//   Ring Road        rows 5 / 21, cols 5 / 27 (east one cell further out: the east exit needs an S-bend connector)
//   exit roundabouts on the ring where each exit road leaves the board; the north one's north arm feeds G1's highway
//   Foothill Rd      col 1 (west), curving into the ring's north side and into the parkway in the south-west
//   Lakeshore Pkwy   row 24 (south) + col 30 (east), joining the ring's north side; waterfront strip beyond it
//   radials          Main St west (via Foothill Circle into the mountains), Atherton St south, South Rd east
//   locals           Hillside Ave, Quarry Rd (west), Mill St, Harbor St (south), Bayview Ave (east), Pier Rd
import { STREET_NAMES } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import type { KenneyId } from '../../assets/kenney/index';
import type { CellUse, Junction, JunctionArm, RoadCell, RoadClass, RoadTileKind, Roundabout } from '../grid';
import {
  DIR_VEC, DIRS, HIGHWAY_ROWS, OPPOSITE, STEP, cellCenter, inGrid, inRect, sideMid,
  type CellRect, type Dir, type GridFrame,
} from './cells';

export type Corner = 'sw' | 'se' | 'ne' | 'nw';
export interface Arm { c: number; r: number; side: Dir }
export interface Piece {
  id: string;
  kind: 'roundabout' | 'curve' | 'connector';
  cells: CellRect;
  /** Where roads leave the piece (arm cell + side). */
  arms: Arm[];
  street: string;
  name?: string;
  /** Curves: the footprint corner the arc is centred on. */
  corner?: Corner;
  /** Connector: the board-edge point it starts from (the town road's end) and the side it faces. */
  board?: { p: Vec2; side: Dir };
}

export interface StreetDef {
  name: string;
  cls: RoadClass;
  /** Cell waypoints; consecutive waypoints share a row or a column. */
  path: Array<[number, number]>;
}

export interface Network {
  use: CellUse[][];
  roads: RoadCell[];
  junctions: Junction[];
  roundabouts: Roundabout[];
  pieces: Piece[];
  streets: StreetDef[];
  /** Per cell (r * cols + c): link bitmask (n 1, e 2, s 4, w 8) of 1×1 road cells. */
  links: Uint8Array;
  /** Per cell: index into `pieces`, or −1. */
  pieceAt: Int16Array;
  /** Per cell: street name. */
  streetAt: Array<string | null>;
  streetClass: Map<string, RoadClass>;
}

export const BIT: Readonly<Record<Dir, number>> = { n: 1, e: 2, s: 4, w: 8 };
export const CLASS_RANK: Readonly<Record<RoadClass, number>> = { ring: 5, parkway: 4, avenue: 3, radial: 2, local: 1 };

/** Roundabout tile radii (kit 0.35 / 0.9 / 1.15 × 4 u). */
export const ROUNDABOUT = { islandR: 1.4, laneR: 3.6, outerR: 4.6, armR: 6 } as const;
/** 2×2 curve centreline radius (kit 1.5 × 4 u) and 1×1 bend radius. */
export const CURVE_R = 6;
export const BEND_R = 2;

// rotation about +y by +π/2 maps E→N→W→S (anticlockwise seen from above with north up)
const ROT_ORDER: readonly Dir[] = ['e', 'n', 'w', 's'];
const rotDir = (d: Dir, k: number): Dir => ROT_ORDER[(ROT_ORDER.indexOf(d) + k) % 4]!;
const maskOf = (ds: readonly Dir[]): number => ds.reduce((m, d) => m | BIT[d], 0);
export const dirsOf = (mask: number): Dir[] => DIRS.filter((d) => mask & BIT[d]);

/** Kenney tiles at rot 0: model + open sides. */
const TILE_DEFS: Record<'straight' | 'crossing' | 'bend' | 'tee' | 'teeZebra' | 'cross' | 'crossZebra' | 'end', { model: string; open: Dir[] }> = {
  straight: { model: 'road-straight', open: ['e', 'w'] },
  crossing: { model: 'road-crossing', open: ['e', 'w'] },
  bend: { model: 'road-bend', open: ['w', 's'] },
  tee: { model: 'road-intersection', open: ['w', 'e', 's'] },
  teeZebra: { model: 'road-intersection-path', open: ['w', 'e', 's'] },
  cross: { model: 'road-crossroad', open: ['n', 'e', 's', 'w'] },
  crossZebra: { model: 'road-crossroad-path', open: ['n', 'e', 's', 'w'] },
  end: { model: 'road-end-round', open: ['e'] },
};
const CURVE_K: Record<Corner, number> = { sw: 0, se: 1, ne: 2, nw: 3 };

/** Every Kenney model the road layer may place (preload these). */
export const ROAD_MODELS: KenneyId[] = [
  ...new Set(Object.values(TILE_DEFS).map((t) => t.model)), 'road-curve', 'road-roundabout',
].map((m) => `city-kit-roads/${m}` as KenneyId);

/** Rotation (quarter turns) that maps a tile's rot-0 sides onto `mask`, or −1. */
export function solveRot(open0: readonly Dir[], mask: number): number {
  for (let k = 0; k < 4; k++) if (maskOf(open0.map((d) => rotDir(d, k))) === mask) return k;
  return -1;
}

interface Exit { side: Dir; p: Vec2; street: string }

/** Road ends on the board boundary (the same rule as world/layout.ts). */
export function boardExits(map: TownMap): Exit[] {
  const b = map.bounds, eps = 0.75, out: Exit[] = [];
  for (const e of map.roads.edges) {
    const pts = e.path.points;
    if (pts.length < 2) continue;
    for (const end of [pts[0]!, pts[pts.length - 1]!]) {
      const side: Dir | null = end.z <= b.minZ + eps ? 'n' : end.z >= b.maxZ - eps ? 's' : end.x <= b.minX + eps ? 'w' : end.x >= b.maxX - eps ? 'e' : null;
      if (side) out.push({ side, p: { x: end.x, z: end.z }, street: STREET_NAMES?.[e.id] ?? e.id });
    }
  }
  return out;
}

const RB_NAMES: Record<Dir, string> = { n: 'North Gate Circle', w: 'Main Street Circle', s: 'South Gate Circle', e: 'Lakeside Circle' };

export function planNetwork(map: TownMap, g: GridFrame): Network {
  const { cols, rows, board: B } = g;
  const N = cols * rows;
  const at = (c: number, r: number) => r * cols + c;
  const c0 = B.c, c1 = B.c + B.w - 1, r0 = B.r, r1 = B.r + B.h - 1;

  // ---- exits → exit roundabouts (+ connector when the exit road is off the cell centre)
  const exits = boardExits(map);
  const colOf = (x: number) => Math.floor((x - g.origin.x) / g.tile);
  const rowOf = (z: number) => Math.floor((z - g.origin.z) / g.tile);
  const offCentre = (e: Exit): number => {
    const ctr = cellCenter(g, colOf(e.p.x), rowOf(e.p.z));
    return e.side === 'n' || e.side === 's' ? e.p.x - ctr.x : e.p.z - ctr.z;
  };
  const push: Record<Dir, number> = { n: 0, e: 0, s: 0, w: 0 };
  for (const e of exits) if (Math.abs(offCentre(e)) > 0.01 && e.side !== 'n') push[e.side] = 1;
  const ringN = r0 - 2, ringW = c0 - 2, ringS = r1 + 2 + push.s, ringE = c1 + 2 + push.e;
  if (push.w) throw new Error('greater grid: a misaligned west exit is not supported');

  const pieces: Piece[] = [];
  const rbAt: Partial<Record<Dir, { c: number; r: number }>> = {};
  const rbArms = (c: number, r: number): Arm[] => [
    { c, r: r - 1, side: 'n' }, { c: c + 1, r, side: 'e' }, { c, r: r + 1, side: 's' }, { c: c - 1, r, side: 'w' },
  ];
  const addRoundabout = (id: string, name: string, c: number, r: number, street: string) => {
    pieces.push({ id, kind: 'roundabout', name, street, cells: { c: c - 1, r: r - 1, w: 3, h: 3 }, arms: rbArms(c, r) });
  };
  for (const e of exits) {
    const misaligned = Math.abs(offCentre(e)) > 0.01;
    let c: number, r: number;
    if (e.side === 'n') { c = colOf(e.p.x); r = ringN; }
    else if (e.side === 's') { c = colOf(e.p.x); r = ringS; }
    else if (e.side === 'w') { c = ringW; r = rowOf(e.p.z); }
    else { c = ringE; r = rowOf(e.p.z); }
    if (misaligned) {
      // the connector cell sits between the board edge and the roundabout's inner arm
      const inward = OPPOSITE[e.side];
      const cc = e.side === 'e' ? c1 + 1 : e.side === 's' ? c : c;
      const cr = e.side === 's' ? r1 + 1 : r;
      pieces.push({
        id: `conn-${e.side}`, kind: 'connector', street: e.street, cells: { c: cc, r: cr, w: 1, h: 1 },
        arms: [{ c: cc, r: cr, side: e.side }], board: { p: e.p, side: inward },
      });
    }
    rbAt[e.side] = { c, r };
    addRoundabout(`rb-${e.side}`, RB_NAMES[e.side], c, r, e.street);
  }
  const need = (d: Dir) => rbAt[d] ?? (() => { throw new Error(`greater grid: no ${d} exit`); })();
  const rbW = need('w'), rbS = need('s'), rbE = need('e');
  need('n');

  // ---- outer lines
  const fw = 1;                     // Foothill Rd column
  const parkS = rows - 3;           // parkway row (south), waterfront rows beyond
  const parkE = cols - 2;           // parkway column (east), waterfront column beyond
  addRoundabout('rb-foothill', 'Foothill Circle', fw, rbW.r, 'Main St');
  const harbourC = Math.round((rbS.c + ringE) / 2);
  addRoundabout('rb-harbour', 'Harbour Circle', harbourC, parkS, 'Lakeshore Pkwy');

  const curve = (id: string, k: [number, number], inSide: Dir, outSide: Dir, street: string) => {
    const [kc, kr] = k;
    const a = STEP[inSide], b = STEP[outSide];
    const cs = [kc, kc + a.dc, kc + b.dc], rs = [kr, kr + a.dr, kr + b.dr];
    const cells = { c: Math.min(...cs), r: Math.min(...rs), w: 2, h: 2 };
    const corner = `${inSide === 'n' || inSide === 's' ? inSide : outSide}${inSide === 'e' || inSide === 'w' ? inSide : outSide}` as Corner;
    pieces.push({
      id, kind: 'curve', street, cells, corner,
      arms: [{ c: kc + a.dc, r: kr + a.dr, side: inSide }, { c: kc + b.dc, r: kr + b.dr, side: outSide }],
    });
  };
  // corner cell, side the road arrives from, side it leaves through
  curve('cv-outer-nw', [fw, ringN], 'e', 's', 'Foothill Rd');
  curve('cv-outer-sw', [fw, parkS], 'n', 'e', 'Lakeshore Pkwy');
  curve('cv-outer-se', [parkE, parkS], 'w', 'n', 'Lakeshore Pkwy');
  curve('cv-outer-ne', [parkE, ringN], 's', 'w', 'Lakeshore Pkwy');
  curve('cv-ring-sw', [ringW, ringS], 'e', 'n', 'Ring Rd');
  curve('cv-ring-se', [ringE, ringS], 'n', 'w', 'Ring Rd');

  const midR = (a: number, b: number) => Math.round((a + b) / 2);
  const ns = exits.find((e) => e.side === 's')?.street ?? 'Atherton St';
  const ws = exits.find((e) => e.side === 'w')?.street ?? 'Main St';
  const es = exits.find((e) => e.side === 'e')?.street ?? 'South Rd';
  const streets: StreetDef[] = [
    { name: 'Ring Rd', cls: 'ring', path: [[ringW, ringN], [ringE, ringN], [ringE, ringS], [ringW, ringS], [ringW, ringN]] },
    { name: 'Foothill Rd', cls: 'avenue', path: [[ringW, ringN], [fw, ringN], [fw, parkS]] },
    { name: 'Lakeshore Pkwy', cls: 'parkway', path: [[fw, parkS], [parkE, parkS], [parkE, ringN], [ringE, ringN]] },
    { name: ws, cls: 'radial', path: [[rbW.c - 1, rbW.r], [fw + 1, rbW.r]] },
    { name: ns, cls: 'radial', path: [[rbS.c, rbS.r + 1], [rbS.c, parkS]] },
    { name: es, cls: 'radial', path: [[rbE.c + 1, rbE.r], [parkE, rbE.r]] },
    { name: 'Hillside Ave', cls: 'local', path: [[fw, midR(ringN, rbW.r)], [ringW, midR(ringN, rbW.r)]] },
    { name: 'Quarry Rd', cls: 'local', path: [[fw, midR(rbW.r, ringS)], [ringW, midR(rbW.r, ringS)]] },
    { name: 'Mill St', cls: 'local', path: [[midR(ringW, rbS.c), ringS], [midR(ringW, rbS.c), parkS]] },
    { name: 'Harbor St', cls: 'local', path: [[harbourC, ringS], [harbourC, parkS - 1]] },
    { name: 'Bayview Ave', cls: 'local', path: [[ringE, midR(ringN, rbE.r)], [parkE, midR(ringN, rbE.r)]] },
    { name: 'Pier Rd', cls: 'local', path: [[harbourC, parkS + 1], [harbourC, parkS + 2]] },
  ];
  const streetClass = new Map(streets.map((s) => [s.name, s.cls] as const));
  for (const p of pieces) if (!streetClass.has(p.street)) streetClass.set(p.street, 'radial');

  // ---- rasterise
  const pieceAt = new Int16Array(N).fill(-1);
  pieces.forEach((p, i) => {
    for (let r = p.cells.r; r < p.cells.r + p.cells.h; r++) for (let c = p.cells.c; c < p.cells.c + p.cells.w; c++) {
      if (!inGrid(g, c, r)) throw new Error(`greater grid: piece ${p.id} leaves the grid`);
      if (pieceAt[at(c, r)]! >= 0) throw new Error(`greater grid: pieces ${pieces[pieceAt[at(c, r)]!]!.id} and ${p.id} overlap`);
      pieceAt[at(c, r)] = i;
    }
  });
  const links = new Uint8Array(N);
  const streetAt: Array<string | null> = new Array(N).fill(null);
  for (const s of streets) {
    for (let i = 0; i + 1 < s.path.length; i++) {
      let [c, r] = s.path[i]!;
      const [tc, tr] = s.path[i + 1]!;
      if (c !== tc && r !== tr) throw new Error(`greater grid: ${s.name} waypoints must share a row or column`);
      const dc = Math.sign(tc - c), dr = Math.sign(tr - r);
      const d: Dir = dc > 0 ? 'e' : dc < 0 ? 'w' : dr > 0 ? 's' : 'n';
      if (streetAt[at(c, r)] === null) streetAt[at(c, r)] = s.name;
      while (c !== tc || r !== tr) {
        const nc = c + dc, nr = r + dr;
        links[at(c, r)] |= BIT[d];
        links[at(nc, nr)] |= BIT[OPPOSITE[d]];
        if (streetAt[at(nc, nr)] === null) streetAt[at(nc, nr)] = s.name;
        c = nc; r = nr;
      }
    }
  }
  for (let i = 0; i < N; i++) if (pieceAt[i]! >= 0) links[i] = 0;

  // ---- use map
  const use: CellUse[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: CellUse[] = [];
    for (let c = 0; c < cols; c++) {
      const i = at(c, r);
      if (inRect(B, c, r)) row.push('board');
      else if (pieceAt[i]! >= 0 || links[i]) row.push('road');
      else if (r < HIGHWAY_ROWS) row.push('highway');
      else row.push('free');
    }
    use.push(row);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if ((r < HIGHWAY_ROWS || inRect(B, c, r)) && (links[at(c, r)] || pieceAt[at(c, r)]! >= 0)) {
      throw new Error(`greater grid: road at reserved cell ${c},${r}`);
    }
  }

  // ---- tiles
  const roads: RoadCell[] = [];
  const junctions: Junction[] = [];
  const roundabouts: Roundabout[] = [];
  const isZebraJunction = (c: number, r: number) => r === ringS || r === parkS || c === parkE;
  const crossingCells = new Set<number>();
  // zebra crossings on the radial cell next to every exit-side roundabout arm, and mid-way along the parkway
  for (const p of pieces) {
    if (p.kind !== 'roundabout') continue;
    for (const a of p.arms) {
      const s = STEP[a.side], nc = a.c + s.dc, nr = a.r + s.dr;
      if (!inGrid(g, nc, nr) || pieceAt[at(nc, nr)]! >= 0) continue;
      const m = links[at(nc, nr)]!;
      const cls = streetClass.get(streetAt[at(nc, nr)] ?? '') ?? 'local';
      if ((m === (BIT.e | BIT.w) || m === (BIT.n | BIT.s)) && (cls === 'radial' || cls === 'local')) crossingCells.add(at(nc, nr));
    }
  }
  for (const c of [Math.round((fw + midR(ringW, rbS.c)) / 2), Math.round((rbS.c + harbourC) / 2), Math.round((harbourC + parkE) / 2)]) {
    if (links[at(c, parkS)] === (BIT.e | BIT.w)) crossingCells.add(at(c, parkS));
  }

  const streetOfArm = (c: number, r: number, d: Dir): string => {
    const s = STEP[d], nc = c + s.dc, nr = r + s.dr;
    if (inGrid(g, nc, nr)) {
      const pi = pieceAt[at(nc, nr)]!;
      if (pi >= 0) return pieces[pi]!.street;
      const st = streetAt[at(nc, nr)];
      if (st) return st;
    }
    return streetAt[at(c, r)] ?? '';
  };
  const major = (names: string[]): string =>
    names.reduce((best, n) => ((CLASS_RANK[streetClass.get(n) ?? 'local'] ?? 0) > (CLASS_RANK[streetClass.get(best) ?? 'local'] ?? 0) ? n : best), names[0] ?? '');

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = at(c, r), m = links[i]!;
    if (!m) continue;
    const open = dirsOf(m);
    const n = open.length;
    let def: keyof typeof TILE_DEFS;
    let kind: RoadTileKind;
    if (n === 1) { def = 'end'; kind = 'end'; }
    else if (n === 2 && (m === (BIT.e | BIT.w) || m === (BIT.n | BIT.s))) {
      const z = crossingCells.has(i);
      def = z ? 'crossing' : 'straight'; kind = z ? 'crossing' : 'straight';
    } else if (n === 2) { def = 'bend'; kind = 'bend'; }
    else if (n === 3) { def = isZebraJunction(c, r) ? 'teeZebra' : 'tee'; kind = 'tee'; }
    else { def = isZebraJunction(c, r) ? 'crossZebra' : 'cross'; kind = 'cross'; }
    const k = solveRot(TILE_DEFS[def].open, m);
    if (k < 0) throw new Error(`greater grid: no rotation for ${def} at ${c},${r}`);
    const armStreets = open.map((d) => streetOfArm(c, r, d));
    roads.push({
      id: `t${c}-${r}`, kind, cells: { c, r, w: 1, h: 1 }, center: cellCenter(g, c, r), rot: (k * Math.PI) / 2,
      model: `city-kit-roads/${TILE_DEFS[def].model}` as KenneyId, open, street: n >= 3 ? major(armStreets) : streetAt[i] ?? '',
    });
    if (n === 1 || n >= 3) {
      const arms: JunctionArm[] = open.map((d, j) => ({ dir: DIR_VEC[d], p: sideMid(g, c, r, d), street: armStreets[j]! }));
      const classes = armStreets.map((s) => streetClass.get(s) ?? 'local');
      junctions.push({
        id: `j${c}-${r}`, kind: n === 1 ? 'end' : n === 3 ? 'tee' : 'cross', center: cellCenter(g, c, r), arms,
        signals: n >= 3 && classes.some((x) => x === 'ring' || x === 'parkway') && classes.some((x) => x !== 'local'),
      });
    }
  }
  for (const p of pieces) {
    const k = p.cells;
    const center = cellCenter(g, k.c + (k.w - 1) / 2, k.r + (k.h - 1) / 2);
    const open = [...new Set(p.arms.map((a) => a.side))];
    if (p.kind === 'roundabout') {
      roads.push({ id: p.id, kind: 'roundabout', cells: k, center, rot: 0, model: 'city-kit-roads/road-roundabout', open, street: p.street });
      roundabouts.push({ id: p.id, name: p.name ?? p.id, center, islandR: ROUNDABOUT.islandR, laneR: ROUNDABOUT.laneR, outerR: ROUNDABOUT.outerR });
      junctions.push({
        id: p.id, kind: 'roundabout', center, signals: false,
        arms: p.arms.map((a) => ({ dir: DIR_VEC[a.side], p: sideMid(g, a.c, a.r, a.side), street: streetOfArm(a.c, a.r, a.side) })),
      });
    } else if (p.kind === 'curve') {
      roads.push({
        id: p.id, kind: 'curve', cells: k, center, rot: (CURVE_K[p.corner!] * Math.PI) / 2,
        model: 'city-kit-roads/road-curve', open, street: p.street,
      });
    } else {
      roads.push({ id: p.id, kind: 'connector', cells: k, center, rot: 0, model: null, open: [p.board!.side, ...open], street: p.street });
    }
  }

  return { use, roads, junctions, roundabouts, pieces, streets, links, pieceAt, streetAt, streetClass };
}

/** Where a piece arm or a 1×1 link leads: another road cell (with a matching link/arm), or a port. */
export type Across =
  | { kind: 'road'; c: number; r: number }
  | { kind: 'port'; port: 'board' | 'edge' | 'highway' }
  | { kind: 'dangling' };

export function across(g: GridFrame, net: Network, c: number, r: number, d: Dir): Across {
  const s = STEP[d], nc = c + s.dc, nr = r + s.dr;
  if (!inGrid(g, nc, nr)) return { kind: 'port', port: 'edge' };
  if (inRect(g.board, nc, nr)) return { kind: 'port', port: 'board' };
  if (nr < HIGHWAY_ROWS) return { kind: 'port', port: 'highway' };
  const i = nr * g.cols + nc;
  const pi = net.pieceAt[i]!;
  if (pi >= 0) {
    const back = OPPOSITE[d];
    return net.pieces[pi]!.arms.some((a) => a.c === nc && a.r === nr && a.side === back) ? { kind: 'road', c: nc, r: nr } : { kind: 'dangling' };
  }
  return net.links[i]! & BIT[OPPOSITE[d]] ? { kind: 'road', c: nc, r: nr } : { kind: 'dangling' };
}
