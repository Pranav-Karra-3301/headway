// Owner: G0. Dressable blocks: the free cells of the greater grid split into rectangles (largest first), each with
// the sides that face a street and a zone hint for G2/G3 (pure data).
import type { Block, ZoneHint } from '../grid';
import { cellCenter, cellRect, inGrid, inRect, type CellRect, type Dir, type GridFrame } from './cells';
import type { Network } from './plan';

export function findBlocks(g: GridFrame, net: Network): Block[] {
  const { cols, rows } = g;
  const free = (c: number, r: number) => inGrid(g, c, r) && net.use[r]![c] === 'free';
  const taken = new Uint8Array(cols * rows);
  const rects: CellRect[] = [];
  for (;;) {
    // run of free, untaken cells to the right of every cell
    const run = new Int16Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      run[i] = free(c, r) && !taken[i] ? 1 + (c + 1 < cols ? run[i + 1]! : 0) : 0;
    }
    let best: CellRect | null = null, bestScore = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let w = run[r * cols + c]!;
      for (let h = 1; w > 0 && r + h - 1 < rows; h++) {
        w = Math.min(w, run[(r + h - 1) * cols + c]!);
        if (w <= 0) break;
        const score = w * h * 100 + Math.min(w, h);
        if (score > bestScore) { bestScore = score; best = { c, r, w, h }; }
      }
    }
    if (!best) break;
    rects.push(best);
    for (let r = best.r; r < best.r + best.h; r++) for (let c = best.c; c < best.c + best.w; c++) taken[r * cols + c] = 1;
  }

  const B = g.board, bounds = cellRect(g, B.c, B.r, B.w, B.h);
  const eastExit = net.pieces.find((p) => p.id === 'rb-e');
  const eastZ = eastExit ? cellCenter(g, eastExit.cells.c + 1, eastExit.cells.r + 1).z : 0;
  const streetOf = (c: number, r: number): string | null => {
    if (!inGrid(g, c, r) || net.use[r]![c] !== 'road') return null;
    const pi = net.pieceAt[r * cols + c]!;
    return pi >= 0 ? net.pieces[pi]!.street : net.streetAt[r * cols + c] ?? '';
  };
  const touchesBoard = (k: CellRect): boolean => {
    for (let c = k.c - 1; c <= k.c + k.w; c++) for (const r of [k.r - 1, k.r + k.h]) if (inRect(B, c, r)) return true;
    for (let r = k.r; r < k.r + k.h; r++) for (const c of [k.c - 1, k.c + k.w]) if (inRect(B, c, r)) return true;
    return false;
  };

  return rects
    .sort((a, b) => a.r - b.r || a.c - b.c)
    .map((k): Block => {
      const frontage: Block['frontage'] = [];
      const sides: Array<[Dir, Array<[number, number]>]> = [
        ['n', Array.from({ length: k.w }, (_, i) => [k.c + i, k.r - 1] as [number, number])],
        ['s', Array.from({ length: k.w }, (_, i) => [k.c + i, k.r + k.h] as [number, number])],
        ['w', Array.from({ length: k.h }, (_, i) => [k.c - 1, k.r + i] as [number, number])],
        ['e', Array.from({ length: k.h }, (_, i) => [k.c + k.w, k.r + i] as [number, number])],
      ];
      for (const [side, cells] of sides) {
        const names = cells.map(([c, r]) => streetOf(c, r)).filter((s): s is string => s !== null);
        if (names.length * 2 >= cells.length || names.length >= 2) frontage.push({ side, street: mostCommon(names) });
      }
      const rect = cellRect(g, k.c, k.r, k.w, k.h);
      const ctr = { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
      let zone: ZoneHint;
      if (k.c + k.w >= cols && k.c >= cols - 1) zone = 'waterfront';
      else if (k.r >= rows - 2) zone = 'waterfront';
      else if (k.r + k.h <= B.r - 2 || k.c + k.w <= 1) zone = 'verge';
      else if (touchesBoard(k)) zone = 'frontage';
      else if (k.w * k.h <= 2) zone = 'park';
      else if (ctr.x < bounds.minX) zone = ctr.z < 0 ? 'suburb' : 'industrial';
      else if (ctr.x > bounds.maxX) zone = ctr.z < eastZ ? 'suburb' : 'commercial';
      else if (ctr.z < bounds.minZ) zone = 'suburb';
      else zone = ctr.x < bounds.minX + 16 ? 'industrial' : 'commercial';
      return { id: `b${k.c}-${k.r}`, cells: k, rect, zone, frontage };
    });
}

function mostCommon(xs: string[]): string {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  let best = xs[0] ?? '', bn = 0;
  for (const [x, k] of n) if (k > bn) { best = x; bn = k; }
  return best;
}
