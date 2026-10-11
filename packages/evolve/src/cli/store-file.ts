// Owner: T4. EvolveStore over JSON files (Node only; the Worker uses D1). Layout, read by export-web too:
//   <dir>/generations/<id>.json   one Generation per file (g0, g1, …)
//   <dir>/rounds/<id>.json        one Round per file, proposals included (R1, R2, …); saveRound upserts by id
// Writes are atomic (temp file + rename), so a crash never leaves a half-written record.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Generation, Proposal, Round } from '@headway/sim';
import type { EvolveStore } from '../round';

export interface FileStore extends EvolveStore {
  readonly dir: string;
  /** Every generation, oldest first. */
  generations(): Generation[];
  /** Every round, by number. */
  rounds(): Round[];
  /** Marks rounds a crashed run left `running` as `failed` (finishedAt = now) and returns them. */
  failStaleRounds(now: string): Round[];
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function readDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as T;
      } catch (e) {
        throw new Error(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)} (fix or remove the file)`);
      }
    });
}

function writeRecord(dir: string, id: string, value: unknown): void {
  if (!SAFE_ID.test(id) || id.includes('..')) throw new Error(`unsafe id ${JSON.stringify(id)} for a record file`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.json`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function createFileStore(dir: string, o: { bootstrap?: () => Generation | Promise<Generation> } = {}): FileStore {
  const genDir = join(dir, 'generations');
  const roundDir = join(dir, 'rounds');
  const generations = () => readDir<Generation>(genDir).sort((a, b) => a.number - b.number);
  const rounds = () => readDir<Round>(roundDir).sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
  const saveGeneration = (g: Generation) => writeRecord(genDir, g.id, g);
  const saveRound = (r: Round) => writeRecord(roundDir, r.id, r);

  return {
    dir,
    generations,
    rounds,
    async champion() {
      const all = generations();
      const latest = all[all.length - 1];
      if (latest) return latest;
      if (!o.bootstrap) throw new Error(`no generations in ${genDir} (bootstrap g0 first)`);
      const g0 = await o.bootstrap();
      saveGeneration(g0);
      return g0;
    },
    async history(limit) {
      if (limit <= 0) return [];
      const proposals: Proposal[] = rounds().flatMap((r) => r.proposals ?? []);
      return proposals.slice(-limit);
    },
    async nextRoundNumber() {
      return rounds().reduce((max, r) => Math.max(max, r.number), 0) + 1;
    },
    async saveRound(r) {
      saveRound(r);
    },
    async saveGeneration(g) {
      saveGeneration(g);
    },
    failStaleRounds(now) {
      const stale = rounds().filter((r) => r.status === 'running').map((r): Round => ({ ...r, status: 'failed', finishedAt: now }));
      for (const r of stale) saveRound(r);
      return stale;
    },
  };
}
