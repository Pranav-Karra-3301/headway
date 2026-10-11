// Owner: C1 (camera study). Plain-text / markdown summary of a set of measured views (console, docs, final report).
import { visibilityOf, type ViewResult } from './measure';

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export function studyTable(rs: readonly ViewResult[]): string {
  const head = '| view | queues hidden | stops | platform edges | bus routes | rail | queue behind dwelling vehicle | px/u | person px | network % screen | queue gap px (min) | marker chips overlapping | inspector-open px/u | visibility | score |';
  const sep = '|' + '---|'.repeat(15);
  const rows = rs.map((r) => [
    r.view.label ?? r.view.id,
    `${pct(r.hidden.queue.frac)} (${pct(r.hidden.queue.solid / Math.max(1, r.hidden.queue.n))} w/o trees)`,
    pct(r.hidden.stop.frac), pct(r.hidden.platform.frac), pct(r.hidden.route.frac), pct(r.hidden.rail.frac),
    pct(r.behindVehicle.frac),
    r.fit.scale.toFixed(1), r.screen.personPx.toFixed(1), r.screen.networkPct.toFixed(1),
    r.screen.queueSpacingMinPx.toFixed(1), `${r.screen.markersInvolved}/${r.perPlace.length}`,
    r.fit.inspectorScale.toFixed(1), pct(visibilityOf(r)), r.score.toFixed(1),
  ].join(' | '));
  return [head, sep, ...rows.map((x) => `| ${x} |`)].join('\n');
}

export function placeTable(r: ViewResult): string {
  const rows = r.perPlace
    .filter((p) => p.queueHidden || p.spotHidden || p.behindVehicle)
    .map((p) => `| ${p.name} | ${p.queueHidden}/${p.queueN} | ${p.spotHidden}/${p.spotN} | ${p.behindVehicle}/${p.queueN} | ${p.by.join(', ')} |`);
  return ['| place | queue slots hidden | stop/edge hidden | behind dwelling vehicle | hidden by |', '|---|---|---|---|---|', ...rows].join('\n');
}
