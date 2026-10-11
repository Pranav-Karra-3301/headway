-- Small key/value store for published singletons: baseline and reference SplitScores (part 2 may cache scores here too).
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
