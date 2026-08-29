# MCP Fleet Bridge — Phase 1 (research/63, toolyard #10)

A Model Context Protocol surface on `fleet-static-host` so any MCP-compliant
agent (Claude Code, Cursor, Zed, OpenCode, third-party) can call fleet tools
natively. Phase 1 ships the three read-only tools from paper 63 §4.1.

## Endpoint

- **`POST /mcp`** (also `/api/mcp` and `/.well-known/mcp` — all identical)
- Protocol: **JSON-RPC 2.0**, stateless streamable-HTTP shape — plain
  `application/json` replies, no SSE stream, no sessions. `GET` returns
  `405 Allow: POST` (we offer no server→client stream). Protocol version
  advertised: `2025-06-18` (batching removed — arrays are rejected with
  `-32600`).

### Methods

| Method | Behavior |
|--------|----------|
| `initialize` | Returns protocol version, `capabilities.tools`, `serverInfo`, `instructions` |
| `notifications/initialized` (and any notification) | Accepted silently, `202 Accepted` |
| `ping` | Empty result |
| `tools/list` | The three tools with JSON-Schema `inputSchema` |
| `tools/call` | Runs a tool; unknown tool → `-32602` (spec example) |

### Tools (paper 63 §4.1 Phase 1)

- **`forest_walk`** — bounded best-first walk. Input: `query` (attractor drop
  via bge-m3 + Vectorize) and/or `seed_nodes` (explicit node ids, max 5),
  `depth` (default 3, **hard max 10**, §5.3). Traverses `forest_edges` with
  **Hebbian-boosted weights** (`base + ln(1+walk_count)`, factor clamped ≤ 1
  so the walk still cools). Output: walked nodes with 200-char snippets,
  followed edges with base/walk_count/boosted, stats + caps.
- **`canon_search`** — delegates to the exact `/canon/search` implementation
  (same code path, one search, no drift). Input: `query`, `limit` (default 20,
  max 100 — plumbed through as `?limit=` on the endpoint).
- **`fleet_status`** — latest hourly forest refresh report (cron, toolyard #1),
  canon census (D1 chunks/files + Vectorize vectorCount), last logged walk,
  available tools.

## Hebbian gating (paper 63 §3.2, research/61 §4.3)

**MCP walks never write `forest_walks` rows.** Hebbian credit is 0 by absence:
the schema has no provenance/multiplier column, and every existing weight query
is `ln(1 + COUNT(*))` — a "zero-credit" row would still be counted and poison
the weights. So Phase 1 external walks are strictly read-only; every walk
response carries `provenance: "external", hebbian_credit: 0`. Logging-with-
multiplier lands with the `agent_tokens` migration (paper 63 §3.1) in Phase 2.

## Caps (paper 63 §5.3 mass-walk guard)

| Cap | Value |
|-----|-------|
| Walk depth | 10 hard (default 3), clamped server-side |
| Visited nodes per walk | 100 (early termination) |
| Best-first expansions (D1 edge reads) | 24 (keeps total subrequests inside the free-tier 50) |
| Explicit seeds | 5 |
| Snippets | 200 chars — no full text in walk results (§5.4) |
| POST body | 64 KiB |

## Auth

Bearer token, constant-time compare, never hardcoded:

```
Authorization: Bearer <MCP_TOKEN>
```

`MCP_TOKEN` lives in the worker secret store — **not** in wrangler.jsonc:

```
npx wrangler secret put MCP_TOKEN --name fleet-static-host
```

(or from the repo dir: `npx wrangler secret put MCP_TOKEN`)

- No/incorrect token → HTTP 401 with a JSON-RPC error (`-32000`).
- **Dev fallback, clearly gated:** when `MCP_TOKEN` is unset, requests are
  accepted ONLY from local `wrangler dev` (detected by the absence of
  `CF-Connecting-IP`, which the Cloudflare edge always sets and clients cannot
  spoof). On the edge with no secret configured the endpoint returns 503 with
  setup instructions instead of silently opening up.

## Rate limiting (paper 63 §3.3)

Per-token (sha256-hashed key) token bucket in isolate memory, same `RateLimiter`
class as the walk-log: **burst 10, sustained 60/min**. A `forest_walk` call
costs `1 + floor(depth / 10)` tokens (2 at max depth). 429s include
`Retry-After: 1` (bucket refills 1 token/s). Scope is per-isolate — same
honest limitation as the walk-log limiter; DO-based limiting is Phase 2.

## Audit log (migration 0006)

Every JSON-RPC call appends to `mcp_audit(ts, token_hash, method, tool, ok,
duration_ms)` — token stored as a 16-hex-char sha256 prefix, never raw; no
payloads (queries may be sensitive). Inserts are best-effort: a failed insert
never breaks a tool call. Apply with:

```
npm run db:migrate:local    # and db:migrate:remote when deploying
```

## Deviation from paper 63 §2 (documented)

The paper specifies `@modelcontextprotocol/sdk` + `workers-mcp` with the
streamable-http transport. This repo is deliberately dependency-light
(wrangler + typescript only), so Phase 1 implements the protocol by hand:
one stateless POST endpoint speaking JSON-RPC 2.0 with plain-JSON replies —
the request/response subset of streamable-HTTP that every standard client
implements. Swap-in point if Phase 2 outgrows it: `handleMcp()` in
`src/mcp.ts` (plus the route block in `src/index.ts`).

Not yet implemented (Phase 2+ per paper rollout): D1 `agent_tokens` table with
per-agent Hebbian multipliers, Durable Object rate limiters, global fleet cap,
token suspension, `canon_get`, admin tools.

## Client config example (Claude Code / any streamable-HTTP MCP client)

```json
{
  "mcpServers": {
    "fleet-forest": {
      "type": "http",
      "url": "https://<worker-host>/mcp",
      "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
    }
  }
}
```

Smoke test:

```bash
curl -s https://<worker-host>/mcp \
  -H 'Authorization: Bearer <MCP_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
&& curl -s https://<worker-host>/mcp \
  -H 'Authorization: Bearer <MCP_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fleet_status","arguments":{}}}'
```

## Tests

`tests/mcp.test.mjs` — JSON-RPC envelope shape, error codes, depth caps,
bearer checks (pure functions; no D1/network). Runs via `npm test`.
