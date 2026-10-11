import { it } from 'vitest';
import { TOWN } from '@headway/sim';
import { greaterGrid, roadAt } from '../../grid';
it('dump', () => {
  if (!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.G0_DUMP) return; // G0_DUMP=1 vitest … --silent=false
  const g = greaterGrid(TOWN);
  const ch: Record<string, string> = { straight: '─', crossing: '≡', bend: '┐', curve: '◜', tee: '┬', cross: '┼', roundabout: 'O', end: 'e', connector: 'S' };
  const lines: string[] = [];
  lines.push('    ' + Array.from({ length: g.cols }, (_, c) => (c % 10).toString()).join(''));
  for (let r = 0; r < g.rows; r++) {
    let s = String(r).padStart(3) + ' ';
    for (let c = 0; c < g.cols; c++) {
      const u = g.use[r]![c]!;
      if (u === 'board') s += '#';
      else if (u === 'highway') s += '=';
      else if (u === 'water') s += '~';
      else if (u === 'hill') s += '^';
      else if (u === 'rail') s += '+';
      else if (u === 'road') { const t = roadAt(g, c, r)!; s += t.bridge ? 'B' : t.railCrossing ? 'X' : t.kind === 'straight' ? (t.open.includes('e') ? '─' : '│') : ch[t.kind] ?? '?'; }
      else { const b = g.blocks.find((b) => c >= b.cells.c && c < b.cells.c + b.cells.w && r >= b.cells.r && r < b.cells.r + b.cells.h); s += b ? b.zone[0]! : '.'; }
    }
    lines.push(s);
  }
  console.log(lines.join('\n'));
  console.log('roads', g.roads.length, 'lanes', g.lanes.length, 'ports', g.ports.map((p) => `${p.id}(${p.kind}) @${p.p.x.toFixed(1)},${p.p.z.toFixed(1)} in=${p.inLane} out=${p.outLane} edge=${p.townEdge ?? ''}`).join(' | '));
  console.log('blocks', g.blocks.map((b) => `${b.id} ${b.cells.w}x${b.cells.h} ${b.zone} d=${b.density} [${b.frontage.map((f) => f.side + ':' + f.street).join(',')}]`).join('\n'));
  console.log('junctions', g.junctions.map((j) => `${j.id}:${j.kind}${j.signals ? '*' : ''}`).join(' '));
  console.log('streets', g.streets.map((s) => `${s.name}(${s.cls}) ${s.paths.length} ${s.paths.reduce((a, p) => a + p.length, 0).toFixed(0)}u`).join(' | '));
});
