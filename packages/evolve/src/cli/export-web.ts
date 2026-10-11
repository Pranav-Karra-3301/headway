// Owner: T8. `export-web`: data/ → apps/web/public/data/{champion,generations}.json (the web's offline fallback for /api).
//
//   pnpm --filter @headway/evolve exec tsx src/cli/export-web.ts [--data data] [--out apps/web/public/data] [--no-sim]
//
// Shapes match the worker exactly: champion.json = GET /api/champion `{ policy, generation, train, val }`,
// generations.json = GET /api/generations `{ generations, rounds, baseline, reference }` (full records, oldest first).
// Reads data/generations/*.json and data/rounds/*.json (any file names; a file may hold one record or an array), plus optional
// data/baseline.json and data/reference.json (a SplitScore, or `{ score }` / `{ train }`). Whatever is missing is computed with the
// real sim on the train/val splits (g0 bootstrap when data/ is empty, the ref line) unless --no-sim.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { G0, REF, validatePolicy } from '@headway/sim';
import type { Generation, Policy, Round, RunResult, SplitScore } from '@headway/sim';
import { topFindings } from '../aggregate';
import {
  DATA_DIR, WEB_DATA_DIR, evaluateOn, inputPath, outputPath, parseArgs, paxH, readGenerations, readJsonDir, runIfMain, signedPct, splitInstances,
  unwrapRecords, writeJson,
} from './sweep';

export interface ChampionJson { policy: Policy; generation: Generation | null; train: SplitScore | null; val: SplitScore | null }
export interface GenerationsJson { generations: Generation[]; rounds: Round[]; baseline: SplitScore | null; reference: SplitScore | null }
export type Evaluate = (policy: Policy, split: 'train' | 'val') => { score: SplitScore; results: RunResult[] };

/** The real sim on the spec §7 train/val instances. */
export const simEvaluate: Evaluate = (policy, split) => evaluateOn(policy, splitInstances(split));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRound = (v: unknown): v is Round =>
  isObj(v) && typeof v.id === 'string' && typeof v.number === 'number' && Array.isArray(v.proposals);
const isSplitScore = (v: unknown): v is SplitScore => isObj(v) && typeof v.J === 'number' && isObj(v.metrics);

/** `<dataDir>/rounds/*.json`, by number then id; duplicates by id keep the last file read. */
export function readRounds(dataDir: string, warn: (msg: string) => void = () => {}): Round[] {
  const byId = new Map<string, Round>();
  for (const r of unwrapRecords(readJsonDir(join(dataDir, 'rounds'), warn), isRound, 'round', 'rounds')) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
}

/** A SplitScore file, or `{ score }` / `{ train }` wrappers; null when missing or unreadable. */
export function readScore(path: string): SplitScore | null {
  if (!existsSync(path)) return null;
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isSplitScore(v)) return v;
    if (isObj(v) && isSplitScore(v.score)) return v.score;
    if (isObj(v) && isSplitScore(v.train)) return v.train;
  } catch {
    // fall through
  }
  return null;
}

export function buildWebData(a: { generations: Generation[]; rounds: Round[]; baseline: SplitScore | null; reference: SplitScore | null }): {
  champion: ChampionJson; generations: GenerationsJson;
} {
  const generations = [...a.generations].sort((x, y) => x.number - y.number);
  const rounds = [...a.rounds].sort((x, y) => x.number - y.number || x.id.localeCompare(y.id));
  const latest = generations[generations.length - 1];
  const champion: ChampionJson = latest
    ? { policy: latest.policy, generation: latest, train: latest.train ?? null, val: latest.val ?? null }
    : { policy: G0, generation: null, train: null, val: null };
  const baseline = a.baseline ?? generations.find((g) => g.number === 0)?.train ?? null;
  return { champion, generations: { generations, rounds, baseline, reference: a.reference } };
}

export interface ExportResult { champion: ChampionJson; generations: GenerationsJson; files: Array<{ path: string; bytes: number }>; notes: string[] }

export function exportWeb(o: { dataDir?: string; outDir?: string; evaluate?: Evaluate | null; now?: () => string; warn?: (msg: string) => void } = {}): ExportResult {
  const dataDir = o.dataDir ?? DATA_DIR;
  const outDir = o.outDir ?? WEB_DATA_DIR;
  const notes: string[] = [];
  const note = (s: string) => {
    notes.push(s);
    o.warn?.(s);
  };
  const evaluate = o.evaluate === undefined ? simEvaluate : o.evaluate;
  let simBroken = false;
  const tryEval = (policy: Policy, split: 'train' | 'val') => {
    if (!evaluate || simBroken) return null;
    try {
      return evaluate(policy, split);
    } catch (err) {
      simBroken = true;
      note(`sim unavailable (${policy.meta.id} on ${split}): ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  let generations = readGenerations(dataDir, note);
  const rounds = readRounds(dataDir, note);
  for (const g of generations) {
    const v = validatePolicy(g.policy);
    if (!v.ok) note(`generation ${g.id}: policy does not validate (${v.errors[0]})`);
    if (!isSplitScore(g.train) || !isSplitScore(g.val)) note(`generation ${g.id}: missing train/val scores`);
  }
  let baseline = readScore(join(dataDir, 'baseline.json'));
  let reference = readScore(join(dataDir, 'reference.json'));

  if (generations.length === 0) {
    note(`no generations in ${join(dataDir, 'generations')}${evaluate ? ' — bootstrapping g0 with the sim' : ''}`);
    const train = tryEval(G0, 'train');
    const val = train ? tryEval(G0, 'val') : null;
    if (train && val) {
      generations = [{
        id: 'g0', number: 0, parentId: null, policy: G0, fromProposal: null, explanation: G0.meta.summary,
        train: train.score, val: val.score, findings: topFindings(train.results, 8), createdAt: (o.now ?? (() => new Date().toISOString()))(),
      }];
    }
  }
  if (!baseline && !generations.some((g) => g.number === 0)) baseline = tryEval(G0, 'train')?.score ?? null;
  if (!reference) reference = tryEval(REF, 'train')?.score ?? null;

  const data = buildWebData({ generations, rounds, baseline, reference });
  const files = [
    { path: join(outDir, 'champion.json'), value: data.champion, pretty: true },
    { path: join(outDir, 'generations.json'), value: data.generations, pretty: false },
  ].map((f) => ({ path: f.path, bytes: writeJson(f.path, f.value, f.pretty) }));
  return { ...data, files, notes };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

export async function main(argv: string[], deps: { log?: (s: string) => void; evaluate?: Evaluate | null } = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => console.log(s));
  const args = parseArgs(argv, ['help']);
  if (args.flag('help')) {
    log('usage: tsx src/cli/export-web.ts [--data data] [--out apps/web/public/data] [--no-sim]');
    return 0;
  }
  const dataArg = args.get('data');
  const outArg = args.get('out');
  const r = exportWeb({
    dataDir: dataArg ? inputPath(dataArg) : DATA_DIR,
    outDir: outArg ? outputPath(outArg) : WEB_DATA_DIR,
    evaluate: args.flag('sim', true) ? (deps.evaluate === undefined ? simEvaluate : deps.evaluate) : null,
  });
  const c = r.champion;
  const base = r.generations.baseline;
  const delta = c.train && base && base.J > 0 ? signedPct(((c.train.J - base.J) / base.J) * 100) : null;
  log(`champion ${c.generation?.id ?? `${c.policy.meta.id} (built-in, unscored)`}${c.train ? ` · J_train ${paxH(c.train.J)} pax-h` : ''}${delta ? ` (${delta} vs g0)` : ''}`
    + ` · ${r.generations.generations.length} generations · ${r.generations.rounds.length} rounds`
    + ` · baseline ${base ? paxH(base.J) : '—'} · reference ${r.generations.reference ? paxH(r.generations.reference.J) : '—'}`);
  for (const f of r.files) log(`wrote ${f.path} (${kb(f.bytes)})`);
  for (const n of r.notes) log(`note: ${n}`);
  return 0;
}

runIfMain(import.meta.url, main);
