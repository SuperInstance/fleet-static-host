-- forest: chunk graph for topology-augmented recall (the forest lane)
-- nodes = canon chunks (ids identical to Vectorize ai-writings-canon path-style ids)
CREATE TABLE IF NOT EXISTS forest_nodes (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forest_edges (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ref','near')),
  weight REAL NOT NULL,
  PRIMARY KEY (src, dst, kind)
);
CREATE INDEX IF NOT EXISTS idx_forest_edges_src ON forest_edges (src);
