// D1 access: typed rows (migrations/0001_init.sql, 0002_meta.sql), row <-> contract mappers, queries, upserts.
import type { Emphasis, FailureFinding, Generation, Metrics, Policy, Proposal, Round, SplitScore } from '@headway/sim';

export interface GenerationRow {
  id: string; number: number; parent_id: string | null; from_proposal: string | null; policy_json: string; explanation: string;
  j_train: number; j_val: number; train_json: string; val_json: string; findings_json: string; created_at: string;
}
export interface RoundRow {
  id: string; number: number; champion_before: string; champion_after: string | null; status: string;
  started_at: string; finished_at: string | null; events_json: string;
}
/** `metrics_json` holds `{ train, val }` (both SplitScore | null), so a Proposal round-trips exactly. */
export interface ProposalRow {
  id: string; round_id: string; designer: number; model: string; emphasis: string; summary: string | null; rationale: string | null;
  policy_json: string | null; valid: number; errors_json: string | null; j_train: number | null; j_val: number | null;
  delta_train_pct: number | null; metrics_json: string | null; findings_json: string | null; narrative: string | null;
}

function parse<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ---------- mappers ----------
export function generationToRow(g: Generation): GenerationRow {
  return {
    id: g.id, number: g.number, parent_id: g.parentId, from_proposal: g.fromProposal, policy_json: JSON.stringify(g.policy),
    explanation: g.explanation, j_train: g.train.J, j_val: g.val.J, train_json: JSON.stringify(g.train), val_json: JSON.stringify(g.val),
    findings_json: JSON.stringify(g.findings), created_at: g.createdAt,
  };
}

export function rowToGeneration(r: GenerationRow): Generation {
  return {
    id: r.id, number: r.number, parentId: r.parent_id, policy: parse<Policy>(r.policy_json, {} as Policy), fromProposal: r.from_proposal,
    explanation: r.explanation, train: parse<SplitScore>(r.train_json, {} as SplitScore), val: parse<SplitScore>(r.val_json, {} as SplitScore),
    findings: parse<FailureFinding[]>(r.findings_json, []), createdAt: r.created_at,
  };
}

export function roundToRow(r: Round): Omit<RoundRow, 'events_json'> {
  return {
    id: r.id, number: r.number, champion_before: r.championBefore, champion_after: r.championAfter, status: r.status,
    started_at: r.startedAt, finished_at: r.finishedAt,
  };
}

export function rowToRound(r: RoundRow, proposals: Proposal[]): Round {
  return {
    id: r.id, number: r.number, championBefore: r.champion_before, championAfter: r.champion_after ?? r.champion_before,
    status: r.status as Round['status'], proposals, startedAt: r.started_at, finishedAt: r.finished_at,
  };
}

export function proposalToRow(p: Proposal): ProposalRow {
  return {
    id: p.id, round_id: p.roundId, designer: p.designer, model: p.model, emphasis: p.emphasis, summary: p.summary, rationale: p.rationale,
    policy_json: p.policy ? JSON.stringify(p.policy) : null, valid: p.valid ? 1 : 0, errors_json: JSON.stringify(p.errors),
    j_train: p.train?.J ?? null, j_val: p.val?.J ?? null, delta_train_pct: p.deltaTrainPct,
    metrics_json: JSON.stringify({ train: p.train, val: p.val }), findings_json: JSON.stringify(p.findings), narrative: p.narrative,
  };
}

export function rowToProposal(r: ProposalRow): Proposal {
  const m = parse<{ train?: SplitScore | null; val?: SplitScore | null }>(r.metrics_json, {});
  return {
    id: r.id, roundId: r.round_id, designer: r.designer as Proposal['designer'], model: r.model, emphasis: r.emphasis as Emphasis,
    summary: r.summary ?? '', rationale: r.rationale ?? '', policy: r.policy_json ? parse<Policy | null>(r.policy_json, null) : null,
    valid: r.valid === 1, errors: parse<string[]>(r.errors_json, []), train: m.train ?? null, val: m.val ?? null,
    deltaTrainPct: r.delta_train_pct, findings: parse<FailureFinding[]>(r.findings_json, []), narrative: r.narrative ?? '',
  };
}

// ---------- reads ----------
export async function latestGeneration(db: D1Database): Promise<Generation | null> {
  const row = await db.prepare('SELECT * FROM generations ORDER BY number DESC LIMIT 1').first<GenerationRow>();
  return row ? rowToGeneration(row) : null;
}

export async function listGenerations(db: D1Database): Promise<Generation[]> {
  const { results } = await db.prepare('SELECT * FROM generations ORDER BY number ASC').all<GenerationRow>();
  return results.map(rowToGeneration);
}

export async function getGeneration(db: D1Database, id: string): Promise<Generation | null> {
  const row = await db.prepare('SELECT * FROM generations WHERE id = ?1').bind(id).first<GenerationRow>();
  return row ? rowToGeneration(row) : null;
}

function groupProposals(rows: ProposalRow[]): Map<string, Proposal[]> {
  const byRound = new Map<string, Proposal[]>();
  for (const row of rows) {
    const list = byRound.get(row.round_id) ?? [];
    list.push(rowToProposal(row));
    byRound.set(row.round_id, list);
  }
  return byRound;
}

/** All rounds (oldest first) with their proposals (by designer). */
export async function listRounds(db: D1Database): Promise<Round[]> {
  const [rounds, proposals] = await db.batch<RoundRow | ProposalRow>([
    db.prepare('SELECT * FROM rounds ORDER BY number ASC, id ASC'),
    db.prepare('SELECT * FROM proposals ORDER BY designer ASC, id ASC'),
  ]);
  const byRound = groupProposals(proposals.results as ProposalRow[]);
  return (rounds.results as RoundRow[]).map((r) => rowToRound(r, byRound.get(r.id) ?? []));
}

export async function getRound(db: D1Database, id: string): Promise<Round | null> {
  const [rounds, proposals] = await db.batch<RoundRow | ProposalRow>([
    db.prepare('SELECT * FROM rounds WHERE id = ?1').bind(id),
    db.prepare('SELECT * FROM proposals WHERE round_id = ?1 ORDER BY designer ASC, id ASC').bind(id),
  ]);
  const row = rounds.results[0] as RoundRow | undefined;
  return row ? rowToRound(row, (proposals.results as ProposalRow[]).map(rowToProposal)) : null;
}

/** The round a proposal belongs to (generation → producing round). */
export async function roundIdOfProposal(db: D1Database, proposalId: string): Promise<string | null> {
  const row = await db.prepare('SELECT round_id FROM proposals WHERE id = ?1').bind(proposalId).first<{ round_id: string }>();
  return row?.round_id ?? null;
}

export const META_BASELINE = 'baseline';
export const META_REFERENCE = 'reference';

/** Reads a meta value; null when missing (or when migration 0002 has not been applied yet). */
export async function getMeta<T>(db: D1Database, key: string): Promise<T | null> {
  try {
    const row = await db.prepare('SELECT value_json FROM meta WHERE key = ?1').bind(key).first<{ value_json: string }>();
    return row ? parse<T | null>(row.value_json, null) : null;
  } catch (err) {
    console.warn(`meta read failed (${key}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------- writes (prepared statements; run them in one db.batch for atomicity) ----------
export function upsertGeneration(db: D1Database, g: Generation): D1PreparedStatement {
  const r = generationToRow(g);
  return db
    .prepare(
      `INSERT INTO generations (id, number, parent_id, from_proposal, policy_json, explanation, j_train, j_val, train_json, val_json, findings_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(id) DO UPDATE SET number = excluded.number, parent_id = excluded.parent_id, from_proposal = excluded.from_proposal,
         policy_json = excluded.policy_json, explanation = excluded.explanation, j_train = excluded.j_train, j_val = excluded.j_val,
         train_json = excluded.train_json, val_json = excluded.val_json, findings_json = excluded.findings_json, created_at = excluded.created_at`,
    )
    .bind(r.id, r.number, r.parent_id, r.from_proposal, r.policy_json, r.explanation, r.j_train, r.j_val, r.train_json, r.val_json, r.findings_json, r.created_at);
}

/** Upserts the round row (events_json is left alone). Pair with `replaceProposals`. */
export function upsertRound(db: D1Database, round: Round): D1PreparedStatement {
  const r = roundToRow(round);
  return db
    .prepare(
      `INSERT INTO rounds (id, number, champion_before, champion_after, status, started_at, finished_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET number = excluded.number, champion_before = excluded.champion_before,
         champion_after = excluded.champion_after, status = excluded.status, started_at = excluded.started_at, finished_at = excluded.finished_at`,
    )
    .bind(r.id, r.number, r.champion_before, r.champion_after, r.status, r.started_at, r.finished_at);
}

export function upsertProposal(db: D1Database, p: Proposal): D1PreparedStatement {
  const r = proposalToRow(p);
  return db
    .prepare(
      `INSERT INTO proposals (id, round_id, designer, model, emphasis, summary, rationale, policy_json, valid, errors_json, j_train, j_val,
         delta_train_pct, metrics_json, findings_json, narrative)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT(id) DO UPDATE SET round_id = excluded.round_id, designer = excluded.designer, model = excluded.model,
         emphasis = excluded.emphasis, summary = excluded.summary, rationale = excluded.rationale, policy_json = excluded.policy_json,
         valid = excluded.valid, errors_json = excluded.errors_json, j_train = excluded.j_train, j_val = excluded.j_val,
         delta_train_pct = excluded.delta_train_pct, metrics_json = excluded.metrics_json, findings_json = excluded.findings_json,
         narrative = excluded.narrative`,
    )
    .bind(r.id, r.round_id, r.designer, r.model, r.emphasis, r.summary, r.rationale, r.policy_json, r.valid, r.errors_json, r.j_train,
      r.j_val, r.delta_train_pct, r.metrics_json, r.findings_json, r.narrative);
}

/** Statements that make the stored round (and exactly its proposal set) match `round`. */
export function saveRoundStatements(db: D1Database, round: Round): D1PreparedStatement[] {
  return [
    upsertRound(db, round),
    db
      .prepare('DELETE FROM proposals WHERE round_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))')
      .bind(round.id, JSON.stringify(round.proposals.map((p) => p.id))),
    ...round.proposals.map((p) => upsertProposal(db, p)),
  ];
}

export function upsertMeta(db: D1Database, key: string, value: unknown, now: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO meta (key, value_json, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), now);
}

// ---------- evolution: proposal history, round events ----------
/** The last `limit` proposals of finished rounds, oldest first (the designers' evidence digest, spec §8.3). */
export async function recentProposals(db: D1Database, limit: number): Promise<Proposal[]> {
  const { results } = await db
    .prepare(
      `SELECT p.* FROM proposals p JOIN rounds r ON r.id = p.round_id WHERE r.status != 'running'
       ORDER BY r.number DESC, p.designer DESC, p.id DESC LIMIT ?1`,
    )
    .bind(limit)
    .all<ProposalRow>();
  return results.map(rowToProposal).reverse();
}

export function setRoundEvents(db: D1Database, roundId: string, eventsJson: string): D1PreparedStatement {
  return db.prepare('UPDATE rounds SET events_json = ?2 WHERE id = ?1').bind(roundId, eventsJson);
}

/** Marks a round that is still `running` as failed (crash path; a finished round is left alone). */
export function failRunningRound(db: D1Database, roundId: string, now: string): D1PreparedStatement {
  return db.prepare(`UPDATE rounds SET status = 'failed', finished_at = ?2 WHERE id = ?1 AND status = 'running'`).bind(roundId, now);
}

// ---------- leaderboard ----------
export interface LeaderboardRow {
  id: string; name: string; scenario_id: string; seed: number; sim_version: string; j: number; metrics_json: string; replay_json: string;
  verified: number; champion_j: number | null; ip_hash: string | null; created_at: string;
}
/** One board line (`GET /api/leaderboard`). */
export interface LeaderboardEntry { rank: number; id: string; name: string; j: number; verified: boolean; championJ: number | null; createdAt: string }

export function insertLeaderboard(db: D1Database, r: LeaderboardRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO leaderboard (id, name, scenario_id, seed, sim_version, j, metrics_json, replay_json, verified, champion_j, ip_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(r.id, r.name, r.scenario_id, r.seed, r.sim_version, r.j, r.metrics_json, r.replay_json, r.verified, r.champion_j, r.ip_hash, r.created_at);
}

/** Top `limit` for a seed and sim version: each name's best entry (case-insensitive), lowest J first, earliest wins ties. */
export async function topLeaderboard(db: D1Database, seed: number, simVersion: string, limit = 20): Promise<LeaderboardEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, j, verified, champion_j, created_at FROM (
         SELECT id, name, j, verified, champion_j, created_at,
           ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY j ASC, created_at ASC, id ASC) AS rn
         FROM leaderboard WHERE seed = ?1 AND sim_version = ?2)
       WHERE rn = 1 ORDER BY j ASC, created_at ASC, id ASC LIMIT ?3`,
    )
    .bind(seed, simVersion, limit)
    .all<Pick<LeaderboardRow, 'id' | 'name' | 'j' | 'verified' | 'champion_j' | 'created_at'>>();
  return results.map((r, i) => ({
    rank: i + 1, id: r.id, name: r.name, j: r.j, verified: r.verified === 1, championJ: r.champion_j, createdAt: r.created_at,
  }));
}

/** Where `j` would place on the board: 1 + the names (other than `name`) whose best is strictly lower. */
export async function leaderboardRank(db: D1Database, seed: number, simVersion: string, name: string, j: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS better FROM (
         SELECT lower(name) AS n, MIN(j) AS best FROM leaderboard WHERE seed = ?1 AND sim_version = ?2 GROUP BY lower(name))
       WHERE n != lower(?3) AND best < ?4`,
    )
    .bind(seed, simVersion, name, j)
    .first<{ better: number }>();
  return (row?.better ?? 0) + 1;
}

// ---------- sealed test results ----------
export type SealedRole = 'champion' | 'baseline' | 'reference';
/** One policy's sealed-test score (`GET /api/sealed`). Never carries the seeds; `seedSet` is a fingerprint. */
export interface SealedEntry {
  id: string; policyId: string; role: SealedRole; simVersion: string; mapVersion: string; jTest: number; metrics: Metrics; runs: number;
  byScenario: Record<string, SplitScore>; deltaVsBaselinePct: number | null; seedSet: string; scenarios: string[]; createdAt: string;
}
export interface SealedResultRow { id: string; policy_id: string; sim_version: string; j_test: number; metrics_json: string; created_at: string }
/** `metrics_json` holds this envelope (the Metrics plus the evaluation context), like proposals' `{ train, val }`. */
type SealedDetail = Pick<SealedEntry, 'metrics' | 'role' | 'runs' | 'byScenario' | 'deltaVsBaselinePct' | 'seedSet' | 'scenarios' | 'mapVersion'>;

export function upsertSealed(db: D1Database, e: Omit<SealedEntry, 'id'>): D1PreparedStatement {
  const id = `${e.seedSet}|${e.createdAt}|${e.role}`;
  const detail: SealedDetail = {
    metrics: e.metrics, role: e.role, runs: e.runs, byScenario: e.byScenario, deltaVsBaselinePct: e.deltaVsBaselinePct,
    seedSet: e.seedSet, scenarios: e.scenarios, mapVersion: e.mapVersion,
  };
  return db
    .prepare(
      `INSERT INTO sealed_results (id, policy_id, sim_version, j_test, metrics_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET policy_id = excluded.policy_id, sim_version = excluded.sim_version, j_test = excluded.j_test,
         metrics_json = excluded.metrics_json, created_at = excluded.created_at`,
    )
    .bind(id, e.policyId, e.simVersion, e.jTest, JSON.stringify(detail), e.createdAt);
}

export function rowToSealed(r: SealedResultRow): SealedEntry {
  const d = parse<Partial<SealedDetail> & Partial<Metrics>>(r.metrics_json, {});
  // A bare Metrics object (rows written by hand / other tools) is accepted too.
  const metrics = (d.metrics ?? (typeof d.J === 'number' ? d : null)) as Metrics;
  const role: SealedRole = d.role ?? (r.policy_id === 'g0' ? 'baseline' : r.policy_id === 'ref' ? 'reference' : 'champion');
  return {
    id: r.id, policyId: r.policy_id, role, simVersion: r.sim_version, mapVersion: d.mapVersion ?? '', jTest: r.j_test, metrics, runs: d.runs ?? 0,
    byScenario: d.byScenario ?? {}, deltaVsBaselinePct: d.deltaVsBaselinePct ?? null, seedSet: d.seedSet ?? '', scenarios: d.scenarios ?? [],
    createdAt: r.created_at,
  };
}

/** Newest first. */
export async function listSealed(db: D1Database, limit = 60): Promise<SealedEntry[]> {
  const { results } = await db
    .prepare('SELECT * FROM sealed_results ORDER BY created_at DESC, id ASC LIMIT ?1')
    .bind(limit)
    .all<SealedResultRow>();
  return results.map(rowToSealed);
}
