// Owner: T3d. Number and label formatting for the Lab.
const MINUS = '−';

/** −6.1% / +2.0% / 0.0% (true minus sign). */
export function fmtSignedPct(x: number, digits = 1): string {
  const r = Number(x.toFixed(digits));
  if (r === 0) return `${(0).toFixed(digits)}%`;
  return `${r < 0 ? MINUS : '+'}${Math.abs(r).toFixed(digits)}%`;
}

/** J (passenger-seconds) → "4,120 pax-h" style number (no unit). */
export function fmtPaxH(jS: number): string {
  const h = jS / 3600;
  return h >= 100 ? Math.round(h).toLocaleString('en-US') : h.toFixed(1);
}

/** Seconds → "3.2 min" (no unit). */
export function fmtMin(s: number): string {
  return (s / 60).toFixed(1);
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

const MODEL_LABELS: Array<[RegExp, string]> = [
  [/deepseek[-_ ]?v4\.1[-_ ]?flash/i, 'DeepSeek V4.1 Flash'],
  [/deepseek[-_ ]?v4[-_ ]?pro/i, 'DeepSeek V4 Pro'],
  [/glm[-_ ]?5\.3[-_ ]?flash/i, 'GLM 5.3 Flash'],
  [/jev/i, 'Jev'],
];

/** "deepseek-ai/DeepSeek-V4.1-Flash" → "DeepSeek V4.1 Flash"; unknown ids are tidied up. */
export function modelLabel(model: string): string {
  for (const [re, label] of MODEL_LABELS) if (re.test(model)) return label;
  const base = model.split('@')[0]!.split('/').pop() ?? model;
  return base.replace(/[-_]+/g, ' ').trim() || model;
}

/** Where the designer ran: Luminal (primary) or the OpenRouter fallback. */
export function providerLabel(model: string): string {
  if (/@luminal/i.test(model) || /^deepseek-ai\//i.test(model)) return 'Luminal';
  if (/^(deepseek|z-ai|typesafe)\//i.test(model) || /openrouter/i.test(model)) return 'OpenRouter';
  return '';
}

/** "2026-10-11T15:04:00Z" → "15:04" (UTC wall clock is fine for a same-day demo). */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1]! : iso;
}
