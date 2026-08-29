-- forest-refresh — scheduled maintenance reports (research/62 toolyard #1)
-- Archive-style only: the refresh run computes decayed weights and writes a
-- report row per run. NOTHING is deleted — prune candidates are reported,
-- never removed. Two tables:
--   forest_refresh         — full report JSON, one row per run (latest wins
--                            for GET /api/forest/refresh, history kept intact)
--   forest_refresh_history — one-line human-readable summary per run
CREATE TABLE IF NOT EXISTS forest_refresh (
  ts INTEGER PRIMARY KEY,
  report_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forest_refresh_history (
  ts INTEGER PRIMARY KEY,
  summary TEXT NOT NULL
);
