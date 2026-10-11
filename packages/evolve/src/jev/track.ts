// Owner: T6. Jev-track designers (spec §9 "What evolves"): LLM designers rewrite only the policy's `advisor`
// (instructions, askWhen thresholds, hold options); candidates are validated against the champion and scored with Jev on
// the comparison seeds by the caller. fetch-free: the LlmClient is injected.
import { FEATURES, validatePolicy } from '@headway/sim';
import type { Policy, RunResult } from '@headway/sim';
import { extractJson } from '../extract';
import type { LlmClient } from '../llm';
import type { JevAdvisor, JevArm } from './compare';

const MAX_INSTRUCTIONS = 1200;
const MAX_ECHO = 6_000;
const TEMPERATURES = [0.4, 0.7, 1.0];

export type JevDesignParse =
  | { ok: true; advisor: JevAdvisor; summary: string; rationale: string }
  | { ok: false; errors: string[] };
export type JevDesign =
  | { ok: true; advisor: JevAdvisor; summary: string; rationale: string; repaired: boolean; model: string }
  | { ok: false; errors: string[]; model: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function jevDesignerSystemPrompt(champion: Policy): string {
  const maxHold = Math.min(90, champion.params?.maxHoldS ?? 60);
  const features = Object.entries(FEATURES.bus_at_stop).map(([k, s]) => `  - ${k} (${s.min}–${s.max}): ${s.desc}`).join('\n');
  return `You tune Jev, a fast decision model (TypeSafe System One), for one narrow decision in a bus + train transit simulation: a bus is ready to leave a stop paired with a train station; should it depart now or hold for some seconds?

How Jev is used
- Jev is asked only at station stops (Stadium Station on Route 3, University Station on Route 1) and only when every askWhen condition holds. Otherwise the rule-based policy decides.
- Code builds the options from holdOptionsS: 0 becomes "Depart now", N becomes "Hold N s" (clamped to the policy's maxHoldS = ${maxHold} s and a 180 s hold budget per loop).
- Jev reads a situation text plus your operating instructions and returns a probability for each option; the most likely option is applied.
- Example situation: "Bus b1 (Route 1) at University Station. 18 aboard of 40. Train arrives in 34 s with 14 riders transferring to Route 1. Next Route 1 bus is 6 min behind. Previous Route 1 bus left 4 min ago (target spacing 5 min). 3 still waiting here; 41 waiting at the next two stops."

Objective: minimise J, the total passenger journey time in seconds (walk + wait + ride, plus a large penalty for riders who never finish). A hold helps riders who would otherwise miss this bus (train transfers, late arrivals) and can even out the spacing between buses on a route; it costs every rider aboard and everyone waiting further along the route the held seconds. Asking Jev when nothing can be gained only adds risk.

You may change only the advisor
- askWhen: 0–6 conditions { "f": feature, "op": "<" | "<=" | ">" | ">=" | "==", "v": number }; all must hold. Features (bus_at_stop):
${features}
- holdOptionsS: 2–8 distinct whole numbers, each 0 or between 5 and ${maxHold}. Include 0 unless Jev must always hold.
- instructions: plain English, at most ${MAX_INSTRUCTIONS} characters. Refer to facts that appear in the situation text (train arrival time, riders transferring, minutes to the bus behind and since the bus ahead, target spacing, riders waiting here and at the next two stops, riders aboard). Give concrete thresholds and say when to depart now.

Reply with JSON only:
{ "summary": "one sentence, at most 200 characters", "rationale": "why this should lower J", "advisor": { "provider": "jev", "enabled": true, "askWhen": [...], "holdOptionsS": [...], "instructions": "..." } }`;
}

export function jevDesignerUserPrompt(a: { current: JevAdvisor; evidence: string }): string {
  return `# Current advisor
${JSON.stringify(a.current, null, 2)}

# Evidence (same seeds the candidates will be scored on)
${a.evidence}

Propose an improved advisor now as a single JSON object with "summary", "rationale" and "advisor". JSON only.`;
}

/** Extracts `{ summary, rationale, advisor }` (or a bare advisor) and validates the advisor merged into `base`. */
export function parseJevDesign(text: string, base: Policy): JevDesignParse {
  const obj = extractJson(text);
  if (!isObj(obj)) return { ok: false, errors: ['reply contains no JSON object'] };
  const raw = isObj(obj.advisor) ? obj.advisor : typeof obj.instructions === 'string' ? obj : null;
  if (!raw) return { ok: false, errors: ['missing "advisor" object'] };
  const advisor = {
    provider: 'jev',
    enabled: true,
    askWhen: raw.askWhen,
    holdOptionsS: raw.holdOptionsS,
    instructions: typeof raw.instructions === 'string' ? raw.instructions.trim() : raw.instructions,
  } as JevAdvisor;
  const errors: string[] = [];
  if (typeof advisor.instructions === 'string' && advisor.instructions.length === 0) errors.push('advisor.instructions: must not be empty');
  const v = validatePolicy({ ...structuredClone(base), advisor });
  if (!v.ok) errors.push(...v.errors.filter((e) => e.startsWith('advisor')));
  if (errors.length > 0) return { ok: false, errors };
  const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 200) : '';
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.slice(0, 1200) : '';
  return { ok: true, advisor: structuredClone(advisor), summary, rationale };
}

/** Designers in parallel (temperatures rotate), one repair attempt each. Never throws; failures come back as `ok: false`. */
export async function designJevAdvisors(o: {
  llm: LlmClient; model: string; champion: Policy; current: JevAdvisor; evidence: string;
  temperatures?: number[]; timeoutMs?: number; maxTokens?: number;
}): Promise<JevDesign[]> {
  const system = jevDesignerSystemPrompt(o.champion);
  const user = jevDesignerUserPrompt({ current: o.current, evidence: o.evidence });
  const temps = o.temperatures ?? TEMPERATURES;
  const call = (u: string, temperature: number) => o.llm.complete({
    model: o.model, system, user: u, temperature, json: true, maxTokens: o.maxTokens ?? 8_000, timeoutMs: o.timeoutMs ?? 90_000,
  });
  const one = async (temperature: number): Promise<JevDesign> => {
    let model = o.model;
    try {
      const first = await call(user, temperature);
      model = first.model || model;
      const p1 = parseJevDesign(first.text, o.champion);
      if (p1.ok) return { ...p1, repaired: false, model };
      const repairUser = `${user}\n\n# Your previous reply\n${first.text.slice(0, MAX_ECHO)}\n\n# Validation errors\n${p1.errors.slice(0, 20).map((e) => `- ${e}`).join('\n')}\n\nFix every error and reply again with the complete JSON object { "summary", "rationale", "advisor" }. JSON only.`;
      let second;
      try {
        second = await call(repairUser, temperature);
      } catch (e) {
        return { ok: false, errors: [...p1.errors, `repair call failed: ${errText(e)}`], model };
      }
      model = second.model || model;
      const p2 = parseJevDesign(second.text, o.champion);
      return p2.ok ? { ...p2, repaired: true, model } : { ok: false, errors: p2.errors, model };
    } catch (e) {
      return { ok: false, errors: [errText(e)], model };
    }
  };
  return Promise.all(temps.map((t) => one(t)));
}

/** Evidence for the designers (≤ ~4k chars): rules vs the current Jev arm, Jev's choices, sample situations, top findings. */
export function jevEvidence(a: { rules: JevArm; jev: JevArm; results: RunResult[] }): string {
  const row = (arm: JevArm) => {
    const m = arm.score.metrics;
    return `| ${arm.label} | ${Math.round(arm.score.J)} | ${arm.deltaPct.toFixed(2)}% | ${m.completionPct.toFixed(1)} | ${Math.round(m.meanWaitS)} | ${m.missedConnections} | ${m.transfersMade} | ${Math.round(m.effort.holdS)} |`;
  };
  const lines = [
    '| arm | J (pax·s) | ΔJ vs rules | completion % | mean wait s | missed connections | transfers | hold s |',
    '|---|---|---|---|---|---|---|---|',
    row(a.rules),
    row(a.jev),
  ];
  const s = a.jev.jev;
  if (s) {
    const chosen = Object.entries(s.chosen).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none';
    lines.push('', `Jev was asked ${s.asked} times (${s.answered} answered, ${s.timeouts} timeouts, ${s.errors} errors). Choices: ${chosen}.`);
    if (s.samples.length) {
      lines.push('', 'Sample situations and what Jev chose:');
      for (const x of s.samples.slice(0, 4)) lines.push(`- "${x.situation}" → ${x.chosen} (p ${x.p.toFixed(2)})`);
    }
  }
  const findings = a.results.flatMap((r) => r.findings ?? []).sort((x, y) => y.impactS - x.impactS).slice(0, 6);
  if (findings.length) {
    lines.push('', 'Top problems in the Jev runs:');
    for (const f of findings) lines.push(`- ${f.text}`);
  }
  return lines.join('\n').slice(0, 4_000);
}
