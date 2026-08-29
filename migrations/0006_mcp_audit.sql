-- MCP bridge audit log (research/63 §5.2 provenance logging, Phase 1 scope)
-- One row per JSON-RPC call. Token is stored as a truncated sha256 hash —
-- never the raw bearer. Inserts are best-effort from the worker; failures
-- are logged and never break a tool call. No request/response payloads are
-- stored (queries may be sensitive; hashes only).
CREATE TABLE IF NOT EXISTS mcp_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,          -- epoch seconds
  token_hash TEXT NOT NULL,     -- first 16 hex chars of sha256(token); 'dev' for local fallback
  method TEXT NOT NULL,         -- initialize | tools/list | tools/call | …
  tool TEXT,                    -- tool name for tools/call, else NULL
  ok INTEGER NOT NULL,          -- 1 = no rpc error and no isError result
  duration_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_ts ON mcp_audit (ts);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_token ON mcp_audit (token_hash, ts);
