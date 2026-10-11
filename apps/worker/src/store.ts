// /api/evolve persistence: the one-running-round lock (rounds.status, spec §11) and a D1-backed EvolveStore.
import type { EvolveStore } from '@headway/evolve';
import type { Generation, Round } from '@headway/sim';
import { latestGeneration, recentProposals, saveRoundStatements, upsertGeneration } from './db';

/** A running round older than this no longer blocks a new one (its worker most likely died). */
export const ROUND_STALE_MS = 10 * 60_000;

export type RoundClaim =
  | { ok: true; id: string; number: number }
  | { ok: false; running: { id: string; startedAt: string } | null };

/**
 * Atomically (one D1 batch = one transaction): marks stale running rounds failed (all of them with `force`), then inserts
 * round `R{max+1}` as running unless another round is still running. The claimed row is the lock; `runRound`'s own
 * saves then update it in place.
 */
export async function claimRound(db: D1Database, o: { nowMs: number; championId: string; force?: boolean }): Promise<RoundClaim> {
  const now = new Date(o.nowMs).toISOString();
  const staleBefore = new Date(o.nowMs - ROUND_STALE_MS).toISOString();
  const [, claimed] = await db.batch<{ id: string; number: number }>([
    db
      .prepare(`UPDATE rounds SET status = 'failed', finished_at = ?1 WHERE status = 'running' AND (?3 = 1 OR started_at < ?2)`)
      .bind(now, staleBefore, o.force ? 1 : 0),
    db
      .prepare(
        `INSERT INTO rounds (id, number, champion_before, champion_after, status, started_at, finished_at, events_json)
         SELECT 'R' || n, n, ?2, ?2, 'running', ?1, NULL, '[]' FROM (SELECT COALESCE(MAX(number), 0) + 1 AS n FROM rounds)
         WHERE NOT EXISTS (SELECT 1 FROM rounds WHERE status = 'running')
         RETURNING id, number`,
      )
      .bind(now, o.championId),
  ]);
  const row = claimed.results[0];
  if (row) return { ok: true, id: row.id, number: row.number };
  const running = await db
    .prepare(`SELECT id, started_at FROM rounds WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`)
    .first<{ id: string; started_at: string }>();
  return { ok: false, running: running ? { id: running.id, startedAt: running.started_at } : null };
}

/**
 * `EvolveStore` over D1 for one claimed round. `champion()` is the newest generation, or — on an empty database —
 * g0 built by `bootstrap()` and saved, so the history has its root.
 */
export function createD1Store(db: D1Database, o: { round: { id: string; number: number }; bootstrap: () => Promise<Generation> }): EvolveStore {
  return {
    async champion() {
      const g = await latestGeneration(db);
      if (g) return g;
      const g0 = await o.bootstrap();
      await upsertGeneration(db, g0).run();
      return g0;
    },
    history: (limit) => recentProposals(db, limit),
    nextRoundNumber: async () => o.round.number,
    async saveRound(r: Round) {
      if (r.id !== o.round.id) throw new Error(`this store saves round ${o.round.id}, not ${r.id}`);
      await db.batch(saveRoundStatements(db, r));
    },
    async saveGeneration(g: Generation) {
      await upsertGeneration(db, g).run();
    },
  };
}
