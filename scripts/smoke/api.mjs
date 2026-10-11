// Deploy smoke (spec §12): /api/champion returns a structurally valid policy and /api/generations has >= 1 entry.
// Shallow checks only: the harness stays dependency-free (no zod, no @headway/sim).

const FLEET = 6;

async function getJson(url, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { error: `unreachable (${e.cause?.code ?? e.name ?? e.message})` };
  }
  const text = await res.text();
  if (!res.ok) return { error: `HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}` };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: `not JSON (${(res.headers.get('content-type') ?? 'no content-type').split(';')[0]}; starts ${JSON.stringify(text.slice(0, 40))})` };
  }
}

/** Problems with a Policy-shaped value (empty when it looks valid). */
export function policyProblems(p) {
  const out = [];
  if (!p || typeof p !== 'object') return ['policy missing'];
  if (typeof p.meta?.id !== 'string' || !p.meta.id) out.push('policy.meta.id missing');
  if (!Array.isArray(p.rules)) out.push('policy.rules is not an array');
  else if (p.rules.length > 24) out.push(`policy has ${p.rules.length} rules (max 24)`);
  if (!p.defaults || typeof p.defaults !== 'object') out.push('policy.defaults missing');
  const alloc = p.params?.allocation;
  if (!alloc || typeof alloc !== 'object') out.push('policy.params.allocation missing');
  else {
    const sum = Object.values(alloc).reduce((s, v) => s + (typeof v === 'number' ? v : NaN), 0);
    if (sum !== FLEET) out.push(`policy.params.allocation sums to ${sum}, expected ${FLEET}`);
  }
  return out;
}

/** @returns {Promise<{ ok: boolean, failures: string[], notes: string[] }>} */
export async function checkApi(base, { timeoutMs = 15_000 } = {}) {
  const failures = [];
  const notes = [];
  const [champ, gens] = await Promise.all([getJson(`${base}/api/champion`, timeoutMs), getJson(`${base}/api/generations`, timeoutMs)]);

  if (champ.error) failures.push(`/api/champion ${champ.error}`);
  else {
    const probs = policyProblems(champ.body?.policy);
    if (probs.length) failures.push(`/api/champion: ${probs.join('; ')}`);
    else {
      const p = champ.body.policy;
      notes.push(`/api/champion: policy ${p.meta.id} (gen ${p.meta.generation ?? '?'}, ${p.rules.length} rules)`);
    }
  }

  if (gens.error) failures.push(`/api/generations ${gens.error}`);
  else if (!Array.isArray(gens.body?.generations)) failures.push('/api/generations: no generations array');
  else if (gens.body.generations.length < 1) failures.push('/api/generations: no generations (publish at least g0)');
  else {
    const bad = gens.body.generations.filter((g) => policyProblems(g?.policy).length > 0).map((g) => g?.id ?? '?');
    if (bad.length) failures.push(`/api/generations: invalid policy in ${bad.join(', ')}`);
    const n = gens.body.generations.length;
    notes.push(`/api/generations: ${n} generation${n === 1 ? '' : 's'}, ${gens.body.rounds?.length ?? 0} rounds`);
  }
  return { ok: failures.length === 0, failures, notes };
}
