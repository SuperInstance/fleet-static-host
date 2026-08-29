-- Forest walk session dedup — research/61 Phase 0 hardening (§4.3 session echo)
-- walk-log accepts an optional sessionId (uuid from the walk page's localStorage);
-- a (src, dst) pair logs at most once per session, so same-session rewalks
-- (echo) never inflate the Hebbian counter. Rows predating this migration
-- carry NULL session_id and never match a dedup lookup — legacy behavior intact.
ALTER TABLE forest_walks ADD COLUMN session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_forest_walks_edge_session ON forest_walks (src, dst, session_id);
