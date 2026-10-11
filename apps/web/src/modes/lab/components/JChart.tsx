// Owner: T3d. Total passenger time by round, in passenger-hours (lower is better): dashed "Baseline (g0)" and
// "Hand-written" lines, the champion as a bold stepped line, one mark per round (filled = kept, hollow = rejected),
// and each kept drop annotated with its %. The generation/round timeline is the x axis (spec §10 Lab).
import type { Emphasis } from '@headway/sim';
import type { ChartData, ChartStep } from '../model';
import { fmtPaxH, fmtSignedPct } from '../format';

const W = 720;
const H = 230;
const PAD = { l: 62, r: 118, t: 26, b: 14 };

const hours = (j: number) => j / 3600;

/** 3–5 round ticks over [lo, hi] (1/2/5 × 10^k steps). */
function hourTicks(lo: number, hi: number): number[] {
  const span = Math.max(hi - lo, 1);
  const mag = 10 ** Math.floor(Math.log10(span / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 4.5) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1]! < hi) out.push(out[out.length - 1]! + step);
  return out;
}

/** Spread right-edge labels so they never overlap (min 14px apart). */
function spread<T extends { y: number }>(labels: T[]): T[] {
  const s = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < s.length; i++) if (s[i]!.y - s[i - 1]!.y < 14) s[i] = { ...s[i]!, y: s[i - 1]!.y + 14 };
  return s;
}

export interface JChartProps {
  data: ChartData;
  selectedStep: number | null;
  onPick(step: ChartStep): void;
  /** Emphasis per proposal id (unused by this chart; kept for callers). */
  emphasisOf?(proposalId: string): Emphasis | null;
}

export function JChart({ data, selectedStep, onPick }: JChartProps) {
  const steps = data.steps;
  const n = steps.length;
  const base = steps[0]?.trainJ ?? 0;
  const refJ = data.ref !== null && base > 0 ? base * (1 + data.ref / 100) : null;
  const vals = [...steps.map((s) => hours(s.trainJ)), ...(refJ === null ? [] : [hours(refJ)])];
  const lo0 = vals.length ? Math.min(...vals) : 0;
  const hi0 = vals.length ? Math.max(...vals) : 1;
  const pad = Math.max((hi0 - lo0) * 0.12, 1);
  const ticks = hourTicks(lo0 - pad, hi0 + pad * 0.6);
  const lo = ticks[0]!; const hi = ticks[ticks.length - 1]!;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (step: number) => PAD.l + (n <= 1 ? innerW / 2 : (step * innerW) / (n - 1));
  const y = (h: number) => PAD.t + ((hi - h) / (hi - lo || 1)) * innerH;
  const yJ = (j: number) => y(hours(j));

  // Champion stepped line: flat until a kept round, then a vertical drop.
  let d = '';
  steps.forEach((s, i) => {
    const px = x(s.step).toFixed(1); const py = yJ(s.trainJ).toFixed(1);
    if (i === 0) d = `M${px},${py}`;
    else d += `H${px}V${py}`;
  });
  const last = steps[n - 1];
  if (last) d += `H${(W - PAD.r).toFixed(1)}`;

  const drops = steps.slice(1).map((s, i) => ({ s, prev: steps[i]! }))
    .filter(({ s, prev }) => s.promoted && s.trainJ < prev.trainJ)
    .map(({ s, prev }) => ({ s, prev, pct: (s.trainJ / prev.trainJ - 1) * 100 }));

  const labels = spread([
    { key: 'g0', cls: 'g0', y: yJ(base), text: 'Baseline (g0)' },
    ...(refJ === null ? [] : [{ key: 'ref', cls: 'ref', y: yJ(refJ), text: 'Hand-written' }]),
    ...(last && last.step > 0 ? [{ key: 'now', cls: 'now', y: yJ(last.trainJ), text: `Now (${last.genId})` }] : []),
  ]);
  const sel = selectedStep === null ? null : steps[selectedStep] ?? null;

  return (
    <div className="lab-chart">
      <svg className="lab-chart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Total passenger time by round, in passenger-hours; lower is better">
        <text className="lab-chart__axis" x={PAD.l} y={PAD.t - 14}>passenger-hours</text>
        {ticks.map((t) => (
          <g key={t} className="lab-chart__tick">
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text x={PAD.l - 10} y={y(t)} dy="0.34em" textAnchor="end">{Math.round(t).toLocaleString('en-US')}</text>
          </g>
        ))}
        <line className="lab-chart__dash lab-chart__dash--g0" x1={PAD.l} x2={W - PAD.r} y1={yJ(base)} y2={yJ(base)} />
        {refJ !== null && <line className="lab-chart__dash lab-chart__dash--ref" x1={PAD.l} x2={W - PAD.r} y1={yJ(refJ)} y2={yJ(refJ)} />}
        {labels.map((l) => (
          <text key={l.key} className={`lab-chart__lbl lab-chart__lbl--${l.cls}`} x={W - PAD.r + 10} y={l.y} dy="0.34em">{l.text}</text>
        ))}
        {sel && <line className="lab-chart__guide" x1={x(sel.step)} x2={x(sel.step)} y1={PAD.t - 6} y2={H - PAD.b} />}
        {n > 1 && <path className="lab-chart__step" d={d} />}
        {drops.map(({ s, prev, pct }) => (
          <text key={`d${s.step}`} className="lab-chart__drop" x={x(s.step) + 8} y={(yJ(prev.trainJ) + yJ(s.trainJ)) / 2} dy="0.34em">
            {fmtSignedPct(pct)}
          </text>
        ))}
        {steps.map((s) => (
          <g key={s.step} className="lab-chart__pt" data-promoted={s.promoted || undefined} data-running={s.running || undefined}
            data-selected={s.step === selectedStep || undefined} onClick={() => onPick(s)}
            role="button" tabIndex={-1} aria-label={`${s.label}: ${fmtPaxH(s.trainJ)} passenger-hours`}>
            <circle className="lab-chart__hit" cx={x(s.step)} cy={yJ(s.trainJ)} r={14} />
            <circle className="lab-chart__dot" cx={x(s.step)} cy={yJ(s.trainJ)} r={s.promoted ? 6 : 5} />
            <title>{`${s.label}: ${fmtPaxH(s.trainJ)} passenger-hours${s.step > 0 ? ` (${fmtSignedPct(s.train)} vs g0)` : ''}${s.promoted ? '' : ` · rejected, ${s.genId} kept`}`}</title>
          </g>
        ))}
      </svg>
      <div className="lab-timeline" role="tablist" aria-label="Generations and rounds">
        {steps.map((s) => (
          <button key={s.step} type="button" role="tab" aria-selected={s.step === selectedStep}
            className="lab-tl" data-kind={s.promoted ? 'gen' : s.running ? 'running' : 'rejected'}
            style={{ left: `${(x(s.step) / W) * 100}%` }} onClick={() => onPick(s)}>
            <span className="lab-tl__id">{s.label}</span>
          </button>
        ))}
      </div>
      <ul className="lab-legend" aria-hidden="true">
        <li><i className="lab-legend__step" />Champion</li>
        <li><i className="lab-legend__kept" />Kept</li>
        <li><i className="lab-legend__rej" />Rejected</li>
      </ul>
    </div>
  );
}
