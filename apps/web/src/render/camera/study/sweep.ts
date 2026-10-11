// Owner: C1 (camera study). A finer elevation × azimuth grid around the candidates: how sensitive each metric is to
// a few degrees of camera (a pick that only wins at one exact angle is tuned to today's layout, not robust).
import { measureView, type StudyInput } from './measure';
import { ISO_ELEV } from './views';

export const SWEEP_ELEVS = [30, ISO_ELEV, 38, 40, 45] as const;
export const SWEEP_AZS = [35, 40, 45, 50, 55] as const;

export interface SweepCell { elev: number; az: number; queue: number; stop: number; route: number; rail: number; scale: number; personPx: number }

export function sweepViews(input: StudyInput, elevs: readonly number[] = SWEEP_ELEVS, azs: readonly number[] = SWEEP_AZS): SweepCell[][] {
  return elevs.map((elev) => azs.map((az) => {
    const r = measureView({ id: `sweep-${elev.toFixed(2)}-${az}`, elev, az }, input);
    return {
      elev, az, queue: r.hidden.queue.frac, stop: r.hidden.stop.frac, route: r.hidden.route.frac, rail: r.hidden.rail.frac,
      scale: r.fit.scale, personPx: r.screen.personPx,
    };
  }));
}

export function sweepTable(grid: readonly SweepCell[][]): string {
  const azs = grid[0]?.map((c) => c.az) ?? [];
  const p = (x: number) => Math.round(100 * x);
  const rows = grid.map((row) => `| ${(Math.abs(row[0]!.elev - ISO_ELEV) < 1e-6 ? 35.26 : row[0]!.elev).toFixed(2)}° | ` +
    row.map((c) => `${p(c.queue)}/${p(c.stop)}/${p(c.route)}/${p(c.rail)} · ${c.scale.toFixed(1)}`).join(' | ') + ' |');
  return [`| elev \\ az | ${azs.join(' | ')} |`, '|---|' + '---|'.repeat(azs.length), ...rows].join('\n');
}
