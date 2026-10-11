// Public reads: champion and the generation history (spec §11).
import { G0 } from '@headway/sim';
import type { SplitScore } from '@headway/sim';
import { Hono } from 'hono';
import { getGeneration, getMeta, getRound, latestGeneration, listGenerations, listRounds, META_BASELINE, META_REFERENCE, roundIdOfProposal } from '../db';
import type { AppContext } from '../env';
import { jsonError } from '../http';

export function publicRoutes(): Hono<AppContext> {
  const r = new Hono<AppContext>();

  /** `{ policy, generation, train, val }`; G0 with nulls until anything is published. */
  r.get('/api/champion', async (c) => {
    const g = await latestGeneration(c.env.DB);
    if (!g) return c.json({ policy: G0, generation: null, train: null, val: null });
    return c.json({ policy: g.policy, generation: g, train: g.train, val: g.val });
  });

  /** `{ generations, rounds, baseline, reference }`: full Generation[] (oldest first) and Round[] with proposals. */
  r.get('/api/generations', async (c) => {
    const [generations, rounds, baseline, reference] = await Promise.all([
      listGenerations(c.env.DB),
      listRounds(c.env.DB),
      getMeta<SplitScore>(c.env.DB, META_BASELINE),
      getMeta<SplitScore>(c.env.DB, META_REFERENCE),
    ]);
    return c.json({
      generations,
      rounds,
      baseline: baseline ?? generations.find((g) => g.number === 0)?.train ?? null,
      reference: reference ?? null,
    });
  });

  /** `{ generation, round }`: the round that produced it (with proposals), or null for g0. */
  r.get('/api/generations/:id', async (c) => {
    const id = c.req.param('id');
    const generation = await getGeneration(c.env.DB, id);
    if (!generation) return jsonError(c, 404, `generation "${id}" not found`);
    const roundId = generation.fromProposal ? await roundIdOfProposal(c.env.DB, generation.fromProposal) : null;
    const round = roundId ? await getRound(c.env.DB, roundId) : null;
    return c.json({ generation, round });
  });

  return r;
}
