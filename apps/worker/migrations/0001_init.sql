CREATE TABLE rounds (id TEXT PRIMARY KEY, number INTEGER NOT NULL, champion_before TEXT NOT NULL, champion_after TEXT,
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, events_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE proposals (id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id), designer INTEGER NOT NULL,
  model TEXT NOT NULL, emphasis TEXT NOT NULL, summary TEXT, rationale TEXT, policy_json TEXT, valid INTEGER NOT NULL,
  errors_json TEXT, j_train REAL, j_val REAL, delta_train_pct REAL, metrics_json TEXT, findings_json TEXT, narrative TEXT);
CREATE TABLE generations (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, parent_id TEXT, from_proposal TEXT,
  policy_json TEXT NOT NULL, explanation TEXT NOT NULL, j_train REAL NOT NULL, j_val REAL NOT NULL,
  train_json TEXT NOT NULL, val_json TEXT NOT NULL, findings_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE leaderboard (id TEXT PRIMARY KEY, name TEXT NOT NULL, scenario_id TEXT NOT NULL, seed INTEGER NOT NULL,
  sim_version TEXT NOT NULL, j REAL NOT NULL, metrics_json TEXT NOT NULL, replay_json TEXT NOT NULL,
  verified INTEGER NOT NULL, champion_j REAL, ip_hash TEXT, created_at TEXT NOT NULL);
CREATE TABLE sealed_results (id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, sim_version TEXT NOT NULL,
  j_test REAL NOT NULL, metrics_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX leaderboard_seed_j ON leaderboard(seed, j);
