// Owner: T3d. Sealed-test results for the Lab panel ("never shown to agents", spec §7, §11).
// GET /api/sealed → /data/sealed.json → []. The row shape is read tolerantly (D1 rows, camelCase rows, or a policy map).
import type { Metrics } from '@headway/sim';
import { pctVs } from './model';

export interface SealedRow { policyId: string; J: number; metrics: Metrics | null; runs: number | null; simVersion: string | null; createdAt: string | null }

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (...xs: unknown[]): number | null => {
  for (const x of xs) if (typeof x === 'number' && Number.isFinite(x)) return x;
  return null;
};
const str = (...xs: unknown[]): string | null => {
  for (const x of xs) if (typeof x === 'string' && x) return x;
  return null;
};
function parseMetrics(x: unknown): Metrics | null {
  if (typeof x === 'string') {
    try { return parseMetrics(JSON.parse(x)); } catch { return null; }
  }
  return isObj(x) && typeof x.J === 'number' ? (x as unknown as Metrics) : null;
}

function toRow(x: unknown, key?: string): SealedRow | null {
  if (!isObj(x)) return null;
  const score = isObj(x.score) ? x.score : isObj(x.test) ? x.test : null;
  const policyId = str(x.policyId, x.policy_id, x.policy, key && !/^\d+$/.test(key) ? key : null);
  const J = num(x.jTest, x.j_test, x.J, x.j, score?.J);
  if (!policyId || J === null) return null;
  return {
    policyId, J,
    metrics: parseMetrics(x.metrics ?? x.metrics_json ?? score?.metrics),
    runs: num(x.runs, score?.runs),
    simVersion: str(x.simVersion, x.sim_version),
    createdAt: str(x.createdAt, x.created_at),
  };
}

const rank = (id: string) => (id === 'g0' ? -2 : id === 'ref' ? -1 : /^g(\d+)$/.test(id) ? Number(id.slice(1)) : 1e6);

export function normalizeSealed(raw: unknown): SealedRow[] {
  let items: Array<[unknown, string | undefined]> = [];
  if (Array.isArray(raw)) items = raw.map((x) => [x, undefined]);
  else if (isObj(raw)) {
    const list = [raw.results, raw.sealed, raw.rows, raw.items].find(Array.isArray) as unknown[] | undefined;
    items = list ? list.map((x) => [x, undefined]) : Object.entries(raw).map(([k, v]) => [v, k]);
  }
  const latest = new Map<string, SealedRow>();
  for (const [x, key] of items) {
    const row = toRow(x, key);
    if (!row) continue;
    const prev = latest.get(row.policyId);
    if (!prev || (row.createdAt ?? '') >= (prev.createdAt ?? '')) latest.set(row.policyId, row);
  }
  return [...latest.values()].sort((a, b) => rank(a.policyId) - rank(b.policyId) || a.policyId.localeCompare(b.policyId));
}

export interface SealedView extends SealedRow { label: string; vsBaselinePct: number | null; champion: boolean }

/** Baseline, reference and the champion (the given id, else the newest sealed generation), with Δ vs g0. */
export function sealedRows(rows: SealedRow[], championId: string | null): SealedView[] {
  const g0 = rows.find((r) => r.policyId === 'g0');
  const ref = rows.find((r) => r.policyId === 'ref');
  const gens = rows.filter((r) => /^g\d+$/.test(r.policyId) && r.policyId !== 'g0');
  const champ = (championId ? gens.find((r) => r.policyId === championId) : undefined) ?? gens[gens.length - 1];
  const out: SealedView[] = [];
  const add = (r: SealedRow | undefined, label: string, champion = false) => {
    if (r) out.push({ ...r, label, champion, vsBaselinePct: g0 ? Math.round(pctVs(r.J, g0.J) * 10) / 10 : null });
  };
  add(g0, 'Baseline g0');
  add(ref, 'Reference');
  add(champ, champ ? `Champion ${champ.policyId}` : 'Champion', true);
  return out;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function loadSealed(): Promise<SealedRow[]> {
  for (const url of ['/api/sealed', '/data/sealed.json']) {
    try {
      const rows = normalizeSealed(await getJson(url));
      if (rows.length) return rows;
    } catch { /* try the next source */ }
  }
  return [];
}
