// Owner: T3d. J_train / J_val by round (% vs g0, lower is better) with g0 + ref lines, every candidate proposal,
// and the generation timeline as the x axis (spec §10 Lab).
import type { CSSProperties } from 'react';
import type { Emphasis } from '@headway/sim';
import type { ChartData, ChartStep } from '../model';
import { fmtPaxH, fmtSignedPct } from '../format';

const W = 720;
const H = 180;
const PAD = { l: 46, r: 98, t: 18, b: 14 };
const EMPH: Emphasis[] = ['transfers', 'spacing', 'allocation'];

function tickLabel(v: number): string {
  if (Math.abs(v) < 1e-9) return '0%';
  const s = Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1);
  return `${v < 0 ? '−' : '+'}${s}%`;
}

export interface JChartProps {
  data: ChartData;
  selectedStep: number | null;
  onPick(step: ChartStep): void;
  /** Emphasis per proposal id (for candidate colours). */
  emphasisOf(proposalId: string): Emphasis | null;
}

export function JChart({ data, selectedStep, onPick, emphasisOf }: JChartProps) {
  const n = data.steps.length;
  const [lo, hi] = data.domain;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (step: number) => PAD.l + (n <= 1 ? innerW / 2 : (step * innerW) / (n - 1));
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo || 1)) * innerH;
  const train = data.steps.map((s) => [x(s.step), y(s.train)] as const);
  const val = data.steps.filter((s) => s.val !== null).map((s) => [x(s.step), y(s.val!)] as const);
  const line = (pts: ReadonlyArray<readonly [number, number]>) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const area = train.length > 1 ? `${line(train)}L${train[train.length - 1]![0].toFixed(1)},${(H - PAD.b).toFixed(1)}L${train[0]![0].toFixed(1)},${(H - PAD.b).toFixed(1)}Z` : '';
  const sel = selectedStep === null ? null : data.steps[selectedStep] ?? null;
  const best = data.steps.reduce<ChartStep | null>((b, s) => (!b || s.train < b.train ? s : b), null);

  return (
    <div className="lab-chart">
      <svg className="lab-chart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Total passenger time by round, relative to the start; lower is better">
        <defs>
          <linearGradient id="lab-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--lab-accent)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--lab-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {data.ticks.map((t) => (
          <g key={t} className="lab-chart__tick">
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text x={PAD.l - 10} y={y(t)} dy="0.34em" textAnchor="end">{tickLabel(t)}</text>
          </g>
        ))}
        <g className="lab-chart__ref lab-chart__ref--g0">
          <line x1={PAD.l} x2={W - PAD.r + 4} y1={y(0)} y2={y(0)} />
          <text x={W - PAD.r + 10} y={y(0)} dy="0.34em">start</text>
        </g>
        {data.ref !== null && (
          <g className="lab-chart__ref lab-chart__ref--ref">
            <line x1={PAD.l} x2={W - PAD.r + 4} y1={y(data.ref)} y2={y(data.ref)} />
            <text x={W - PAD.r + 10} y={y(data.ref)} dy="0.34em">hand-written {tickLabel(Math.round(data.ref * 10) / 10)}</text>
          </g>
        )}
        {sel && <line className="lab-chart__guide" x1={x(sel.step)} x2={x(sel.step)} y1={PAD.t - 6} y2={H - PAD.b} />}
        {area && <path className="lab-chart__area" d={area} />}
        {val.length > 1 && <path className="lab-chart__val" d={line(val)} pathLength={1} />}
        {train.length > 1 && <path className="lab-chart__train" d={line(train)} pathLength={1} />}
        {data.candidates.filter((c) => !c.promoted).map((c) => {
          const e = emphasisOf(c.proposalId);
          const cx = x(c.step) + ((c.designer ?? 1) - 1) * 9;
          const cy = y(Math.min(c.pct, hi));
          return (
            <g key={c.proposalId} className="lab-chart__cand" data-emphasis={e ?? undefined}
              style={{ '--d': `${c.step * 40 + 300}ms` } as CSSProperties}>
              <circle cx={cx} cy={cy} r={4.2} />
              {c.clipped && <path d={`M${cx - 4},${cy + 9}l4,-4l4,4`} className="lab-chart__clip" />}
              <title>{`${c.proposalId}${e ? ` (${e})` : ''}: ${fmtSignedPct(c.pct)} passenger time vs start`}</title>
            </g>
          );
        })}
        {val.map(([px, py], i) => <circle key={`v${i}`} className="lab-chart__vdot" cx={px} cy={py} r={3.2} />)}
        {data.steps.map((s) => (
          <g key={s.step} className="lab-chart__pt" data-promoted={s.promoted || undefined} data-running={s.running || undefined}
            data-selected={s.step === selectedStep || undefined} onClick={() => onPick(s)}
            role="button" tabIndex={-1} aria-label={`${s.label}: ${fmtSignedPct(s.train)} vs g0`}>
            <circle className="lab-chart__hit" cx={x(s.step)} cy={y(s.train)} r={14} />
            <circle className="lab-chart__dot" cx={x(s.step)} cy={y(s.train)} r={s.promoted ? 5.6 : 4} />
            <title>{`${s.label}${s.promoted ? '' : ` (champion ${s.genId})`}: J_train ${fmtPaxH(s.trainJ)} pax-h, ${fmtSignedPct(s.train)} vs g0${s.val !== null ? `; J_val ${fmtSignedPct(s.val)}` : ''}`}</title>
          </g>
        ))}
      </svg>
      <div className="lab-timeline" role="tablist" aria-label="Generations and rounds">
        {data.steps.map((s) => (
          <button key={s.step} type="button" role="tab" aria-selected={s.step === selectedStep}
            className="lab-tl" data-kind={s.promoted ? 'gen' : s.running ? 'running' : 'rejected'}
            data-best={best?.step === s.step || undefined}
            style={{ left: `${(x(s.step) / W) * 100}%` }} onClick={() => onPick(s)}>
            <span className="lab-tl__id">{s.label}</span>
            <span className="lab-tl__sub">{s.running ? 'live' : s.promoted ? (s.step === 0 ? 'start' : fmtSignedPct(s.train)) : 'kept ' + s.genId}</span>
          </button>
        ))}
      </div>
      <ul className="lab-legend" aria-hidden="true">
        <li><i className="lab-legend__train" />Training</li>
        <li><i className="lab-legend__val" />Unseen crowds</li>
        <li><i className="lab-legend__ref" />Hand-written plan</li>
        <li className="lab-legend__cands">
          {EMPH.map((e) => <i key={e} className="lab-legend__cand" data-emphasis={e} />)}
          AI ideas
        </li>
      </ul>
    </div>
  );
}
