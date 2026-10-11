// Owner: C1 (camera study). Plain-text / markdown summary of a set of measured views (console, docs, final report).
import { visibilityOf, type ViewResult } from './measure';

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export function studyTable(rs: readonly ViewResult[]): string {
  const head = '| view | stop queues | platform queues | stops | platform edges | bus routes | rail | queue behind dwelling vehicle | px/u | px/u 1280×720 | px/u inspector | person px | network % screen | queue gap px (min) | marker chips overlapping | visibility | score |';
  const sep = '|' + '---|'.repeat(17);
  const rows = rs.map((r) => [
    r.view.label ?? r.view.id,
    `${pct(r.hidden.queue.frac)} (${pct(r.hidden.queue.solid / Math.max(1, r.hidden.queue.n))} w/o trees)`,
    pct(r.hidden.platformQueue.frac), pct(r.hidden.stop.frac), pct(r.hidden.platform.frac), pct(r.hidden.route.frac), pct(r.hidden.rail.frac),
    pct(r.behindVehicle.frac),
    r.fit.scale.toFixed(1), (r.fit.alt['1280×720'] ?? 0).toFixed(1), r.fit.inspectorScale.toFixed(1), r.screen.personPx.toFixed(1), r.screen.networkPct.toFixed(1),
    r.screen.queueSpacingMinPx.toFixed(1), `${r.screen.markersInvolved}/${r.perPlace.length}`,
    pct(visibilityOf(r)), r.score.toFixed(1),
  ].join(' | '));
  return [head, sep, ...rows.map((x) => `| ${x} |`)].join('\n');
}

export function placeTable(r: ViewResult): string {
  const rows = r.perPlace
    .filter((p) => p.queueHidden || p.spotHidden || p.behindVehicle)
    .map((p) => `| ${p.name} | ${p.queueHidden}/${p.queueN} | ${p.spotHidden}/${p.spotN} | ${p.behindVehicle}/${p.queueN} | ${p.by.join(', ')} |`);
  return ['| place | queue slots hidden | stop/edge hidden | behind dwelling vehicle | hidden by |', '|---|---|---|---|---|', ...rows].join('\n');
}

/** Which occluders hide the most samples (per class) at a view — where x-ray or district layout pays off most. */
export function occluderTable(r: ViewResult, top = 10): string {
  const by = new Map<string, Record<string, number>>();
  for (const h of r.hiddenPoints) {
    const row = by.get(h.by) ?? {};
    row[h.cls] = (row[h.cls] ?? 0) + 1;
    by.set(h.by, row);
  }
  const total = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);
  const rows = [...by.entries()].sort((a, b) => total(b[1]) - total(a[1])).slice(0, top)
    .map(([k, x]) => `| ${k} | ${x.queue ?? 0} | ${x.platformQueue ?? 0} | ${x.stop ?? 0} | ${x.platform ?? 0} | ${x.route ?? 0} | ${x.rail ?? 0} |`);
  return ['| occluder | stop queue | platform queue | stop | platform edge | route | rail |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
}
