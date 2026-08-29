-- Forest walk logs — Hebbian edge deepening
-- Records each hop in a forest traversal for learning edge weights over time
CREATE TABLE IF NOT EXISTS forest_walks (
  ts INTEGER NOT NULL,
  src TEXT NOT NULL,
  dst TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forest_walks_ts ON forest_walks (ts);
CREATE INDEX IF NOT EXISTS idx_forest_walks_edge ON forest_walks (src, dst);
