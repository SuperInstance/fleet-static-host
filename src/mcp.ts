// ============================================================================
//  MCP Fleet Bridge — minimal JSON-RPC 2.0 server surface (research/63)
// ============================================================================
//  DEVIATION FROM PAPER 63 §2 (documented): the paper specifies
//  @modelcontextprotocol/sdk + workers-mcp with the streamable-http transport.
//  This repo is deliberately dependency-light (wrangler + typescript only) and
//  the MCP surface we need for Phase 1 is tiny, so this module implements the
//  protocol by hand: a single stateless POST endpoint speaking JSON-RPC 2.0
//  with the streamable-http response shape (plain application/json replies,
//  no SSE stream, no sessions). Every MCP client that speaks streamable HTTP
//  works against this — initialize, tools/list, tools/call are all it takes.
//  The SDK swap-in point is handleMcp() alone if Phase 2 outgrows this.
//
//  SECURITY INVARIANT (paper 63 §3.2, research/61 §4.3): external agent walks
//  NEVER write forest_walks rows. Hebbian credit for MCP walks is 0 BY
//  ABSENCE — the schema has no provenance/multiplier column yet, so the only
//  correct Phase-1 behavior is zero inserts (a row with multiplier 0 would
//  still be COUNTed by every existing ln(1+COUNT(*)) query and poison the
//  weights). Every walk response is tagged provenance=external,
//  hebbian_credit=0 so audits can trust the marker. When the agent_tokens
//  migration lands (paper 63 §3.1) logging-with-credit can follow.
//
//  CAPS (paper 63 §5.3 mass-walk guard): depth hard-capped at 10, visited
//  nodes capped at 100 (early termination), best-first expansions capped at
//  24 D1 edge reads (also keeps total worker subrequests inside the free-tier
//  50-subrequest budget: 24 reads + embed + vectorize + node fetch + audit).

import { RateLimiter } from './uscp.ts';

export interface McpEnv {
  DB: D1Database;
  AI: Ai;
  CANON: Vectorize;
  /** Bearer token for the MCP endpoint — set via `wrangler secret put MCP_TOKEN`. */
  MCP_TOKEN?: string;
}

/** Host-side delegates so this module never imports index.ts (no cycles). */
export interface McpDeps {
  /** Delegates to the existing /canon/search implementation. */
  canonSearch: (q: string, limit: number | null) => Promise<any>;
}

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'fleet-forest-mcp';
const SERVER_VERSION = '1.0.0';
const SERVER_INSTRUCTIONS =
  'Read-only Phase-1 surface over the SuperInstance forest (research/63): ' +
  'forest_walk — bounded best-first walk from a seed/attractor node over Hebbian-boosted edges ' +
  '(external walks carry ZERO Hebbian credit and never mutate forest state); ' +
  'canon_search — semantic search over the ai-writings corpus; ' +
  'fleet_status — forest maintenance report + canon census.';

// --- caps -------------------------------------------------------------------
const MCP_WALK_DEPTH_DEFAULT = 3;   // paper 63 §4.1: depth default 3
const MCP_WALK_DEPTH_MAX = 10;      // paper 63 §5.3: hard maximum walk depth
const MCP_WALK_MAX_NODES = 100;     // paper 63 §5.3: early termination at 100 nodes
const MCP_WALK_MAX_EXPAND = 24;     // D1 edge reads per call (subrequest budget)
const MCP_WALK_MAX_SEEDS = 5;       // mass-walk guard: at most 5 explicit seeds
const MCP_WALK_LEN = 12;            // walked nodes returned
const MCP_WALK_DECAY = 0.85;        // same path-cooling as /forest/search
const MCP_WALK_MAX_Q = 400;         // same query cap as /forest/search
const MCP_SNIPPET_CHARS = 200;      // paper 63 §5.4: snippets only, no full text
const MCP_EDGES_REPORTED = 40;      // cap on the per-edge report list
const MCP_BODY_MAX = 64 * 1024;     // JSON-RPC POST bodies are tiny

// --- rate limit (paper 63 §3.3, in-isolate token bucket like the walk-log) --
// Burst capacity 10, refill 1/s = sustained 60/min. Per-token (hashed) key.
// Walk requests cost 1 + floor(depth / MCP_WALK_DEPTH_MAX) tokens (§3.3).
const mcpLimiter = new RateLimiter(10, 1);

// ============================================================================
//  Pure helpers (exported for tests)
// ============================================================================

/** Clamp a user-supplied walk depth to the paper-63 caps. */
export function clampDepth(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return MCP_WALK_DEPTH_DEFAULT;
  return Math.min(MCP_WALK_DEPTH_MAX, Math.max(1, Math.floor(n)));
}

/** Constant-time-ish string equality — no early exit on first mismatch. */
export function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Bearer check for the Authorization header (MCP_TOKEN compare). */
export function bearerOk(authHeader: string | null, expected: string | undefined | null): boolean {
  if (!expected) return false;
  const m = /^Bearer\s+(.+)$/.exec(authHeader || '');
  return !!m && timingSafeEq(m[1], expected);
}

export interface RpcError { code: number; message: string; data?: unknown }
export interface RpcResponse {
  jsonrpc: '2.0';
  id: any;
  result?: unknown;
  error?: RpcError;
}
export type RpcOutcome = RpcResponse | null; // null = notification: no reply

export const RPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

export interface McpToolCtx {
  env: McpEnv;
  deps: McpDeps;
  tokenHash: string;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** Validated args -> MCP tool result. Throws on invalid params. */
  run: (args: Record<string, unknown>, ctx: McpToolCtx) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

// ============================================================================
//  Tool: forest_walk (paper 63 §4.1) — read-only Hebbian-boosted bounded walk
// ============================================================================

interface WalkVisit { id: string; score: number; hops: number }

const toolForestWalk: McpTool = {
  name: 'forest_walk',
  description:
    'Bounded best-first walk of the forest graph. Starts from seed_nodes (node ids) or, if only a query is given, ' +
    'drops into its attractor chunk via semantic search, then expands over forest_edges using Hebbian-boosted weights ' +
    '(base + ln(1+walk_count), factor clamped to <=1). Read-only: external walks carry zero Hebbian credit and never ' +
    'mutate forest state. Results carry 200-char snippets, not full text.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: `Query text used to find the attractor start node (max ${MCP_WALK_MAX_Q} chars). Required unless seed_nodes is given.` },
      depth: { type: 'integer', description: `Walk depth in hops (default ${MCP_WALK_DEPTH_DEFAULT}, hard max ${MCP_WALK_DEPTH_MAX}).`, default: MCP_WALK_DEPTH_DEFAULT, maximum: MCP_WALK_DEPTH_MAX, minimum: 1 },
      seed_nodes: { type: 'array', items: { type: 'string' }, description: `Optional explicit start node ids (max ${MCP_WALK_MAX_SEEDS}). Overrides the query attractor.`, maxItems: MCP_WALK_MAX_SEEDS },
    },
  },
  async run(args, ctx) {
    const q = typeof args.query === 'string' ? args.query.trim().slice(0, MCP_WALK_MAX_Q) : '';
    const depth = clampDepth(args.depth);
    const seedRaw = Array.isArray(args.seed_nodes) ? args.seed_nodes : [];
    const seeds = seedRaw.map((s) => String(s || '').slice(0, 96)).filter(Boolean).slice(0, MCP_WALK_MAX_SEEDS);
    if (!q && !seeds.length) {
      throw new McpParamsError('forest_walk needs a query (attractor drop) or at least one seed_nodes id');
    }
    const { env } = ctx;

    // --- resolve start nodes -------------------------------------------------
    const frontier: WalkVisit[] = [];
    const visited = new Map<string, WalkVisit>();
    let drop: { id: string; score: number } | null = null;
    let seedsUsed: string[] = [];

    if (seeds.length) {
      const rows = await env.DB
        .prepare(`SELECT id FROM forest_nodes WHERE id IN (${seeds.map(() => '?').join(',')})`)
        .bind(...seeds)
        .all()
        .catch((e: any) => { throw new Error(`seed lookup failed: ${e?.message}`); });
      const found = (rows.results || []).map((r: any) => r.id as string);
      if (!found.length) throw new McpParamsError('none of the seed_nodes exist in the forest');
      const unknown = seeds.filter((s) => !found.includes(s));
      for (const id of found) {
        const v: WalkVisit = { id, score: 1, hops: 0 };
        frontier.push(v); visited.set(id, v);
      }
      if (unknown.length) console.warn(`mcp forest_walk: unknown seed nodes ignored: ${unknown.join(', ')}`);
      seedsUsed = found;
    } else {
      // embed + attractor drop (same shape as /forest/search step 1)
      let embedding: number[];
      try {
        const out: any = await env.AI.run('@cf/baai/bge-m3', { text: [q] });
        embedding = out?.data?.[0] ?? out?.embeddings?.[0];
        if (!Array.isArray(embedding) || embedding.length === 0) throw new Error('no vector');
      } catch (e: any) {
        throw new Error(`embedding failed: ${e?.message}`);
      }
      try {
        const res = await env.CANON.query(embedding, { topK: 6, returnMetadata: 'all' });
        const matches = (res?.matches || []).filter((m: VectorizeMatch) => m.metadata?.path && m.metadata?.chunk != null);
        if (!matches.length) throw new Error('no attractor — the index returned nothing');
        const canonical = matches.find((m) => !m.id.startsWith('v2::')) || matches[0];
        const p = canonical.metadata!.path as string;
        const c = canonical.metadata!.chunk as number;
        drop = { id: `${p}::${c}`.replace(/\//g, '__').slice(0, 96), score: canonical.score };
      } catch (e: any) {
        throw new Error(`vectorize query failed: ${e?.message}`);
      }
      const v: WalkVisit = { id: drop.id, score: drop.score, hops: 0 };
      frontier.push(v); visited.set(drop.id, v);
    }

    // --- best-first expansion over boosted edges -----------------------------
    const edgesFollowed: Array<{ src: string; dst: string; kind: string; base: number; walk_count: number; boosted: number }> = [];
    let expanded = 0;
    while (expanded < MCP_WALK_MAX_EXPAND) {
      frontier.sort((a, b) => b.score - a.score);
      const node = frontier.shift();
      if (!node) break;
      if (node.hops >= depth) continue; // deeper than asked; still counted as visited
      if (visited.size > MCP_WALK_MAX_NODES) break; // §5.3 early termination
      expanded++;
      const rows = await env.DB
        .prepare(
          `SELECT fe.dst, fe.kind, fe.weight AS base, COUNT(fw.rowid) AS walk_count
           FROM forest_edges fe
           LEFT JOIN forest_walks fw ON fw.src = fe.src AND fw.dst = fe.dst
           WHERE fe.src = ?
           GROUP BY fe.dst, fe.kind, fe.weight`,
        )
        .bind(node.id)
        .all()
        .catch((e: any) => { throw new Error(`edge read failed: ${e?.message}`); });
      for (const e of (rows.results || []) as any[]) {
        const base = e.base as number;
        const walkCount = e.walk_count as number;
        const boosted = base + Math.log(1 + walkCount);
        if (edgesFollowed.length < MCP_EDGES_REPORTED) {
          edgesFollowed.push({ src: node.id, dst: e.dst as string, kind: e.kind as string, base, walk_count: walkCount, boosted: Math.round(boosted * 1e6) / 1e6 });
        }
        // Hebbian-boosted factor, clamped to <=1 so the walk still cools.
        const score = node.score * MCP_WALK_DECAY * Math.min(1, boosted);
        const prev = visited.get(e.dst as string);
        if (!prev || score > prev.score) {
          const v: WalkVisit = { id: e.dst as string, score, hops: node.hops + 1 };
          visited.set(v.id, v);
          frontier.push(v);
        }
      }
    }

    // --- walked nodes with snippets (dedupe by file path, drop first) --------
    const ordered = [...visited.values()].sort((a, b) => b.score - a.score);
    const seenPaths = new Set<string>();
    const picked: WalkVisit[] = [];
    for (const v of ordered) {
      const path = v.id.split('::')[0].replace(/__/g, '/');
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);
      picked.push(v);
      if (picked.length >= MCP_WALK_LEN) break;
    }
    const ids = picked.map((v) => v.id);
    const nodeRows = ids.length
      ? (await env.DB
          .prepare(`SELECT id, path, chunk, text FROM forest_nodes WHERE id IN (${ids.map(() => '?').join(',')})`)
          .bind(...ids)
          .all()
          .catch((e: any) => { throw new Error(`node read failed: ${e?.message}`); })).results || []
      : [];
    const byId = new Map<string, any>(nodeRows.map((r: any) => [r.id, r]));

    const walk = picked.map((v) => {
      const n = byId.get(v.id);
      return {
        id: v.id,
        path: n?.path ?? v.id.split('::')[0].replace(/__/g, '/'),
        chunk: n?.chunk ?? null,
        snippet: String(n?.text ?? '').slice(0, MCP_SNIPPET_CHARS),
        score: Math.round(v.score * 1e6) / 1e6,
        hops: v.hops,
      };
    });

    const payload = {
      provenance: 'external',
      hebbian_credit: 0,
      note: 'read-only walk — no forest_walks rows written (research/61 §4.3; paper 63 §3.2 zero-credit default)',
      query: seedsUsed.length ? null : (q || null),
      depth,
      seeds: seedsUsed.length ? seedsUsed : drop ? [drop.id] : [],
      walk,
      edges: edgesFollowed,
      stats: {
        nodes_visited: visited.size,
        edges_followed: edgesFollowed.length,
        expansions: expanded,
        caps: { max_depth: MCP_WALK_DEPTH_MAX, max_nodes: MCP_WALK_MAX_NODES, max_expand: MCP_WALK_MAX_EXPAND, snippet_chars: MCP_SNIPPET_CHARS },
      },
    };
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  },
};

// ============================================================================
//  Tool: canon_search (paper 63 §4.1) — delegates to the existing search
// ============================================================================

const toolCanonSearch: McpTool = {
  name: 'canon_search',
  description:
    'Semantic full-text search over the ai-writings canon corpus (bge-m3 embeddings + Vectorize, with the Hebbian ' +
    'tie-breaker boost). Delegates to the same implementation as GET /canon/search.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (max 400 chars).', maxLength: 400 },
      limit: { type: 'integer', description: 'Maximum results (default 20, max 100).', default: 20, minimum: 1, maximum: 100 },
    },
    required: ['query'],
  },
  async run(args, ctx) {
    const q = typeof args.query === 'string' ? args.query.trim().slice(0, MCP_WALK_MAX_Q) : '';
    if (!q) throw new McpParamsError('canon_search needs a non-empty query');
    const limitRaw = args.limit == null ? 20 : parseInt(String(args.limit), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;
    const res = await ctx.deps.canonSearch(q, limit).catch((e: any) => ({ ok: false, error: `canon search failed: ${e?.message}` }));
    return {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      isError: res?.ok === false,
    };
  },
};

// ============================================================================
//  Tool: fleet_status (paper 63 §4.1) — refresh report + canon census
// ============================================================================

const toolFleetStatus: McpTool = {
  name: 'fleet_status',
  description:
    'Fleet health at a glance: latest forest maintenance report (hourly cron), canon corpus census (D1 chunks/files + ' +
    'Vectorize vector count), timestamp of the last logged human walk, and the available tool list.',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const { env } = ctx;
    const [refreshRow, canonCounts, lastWalk, indexInfo] = await Promise.all([
      env.DB.prepare('SELECT ts, report_json FROM forest_refresh ORDER BY ts DESC LIMIT 1').first().catch(() => null),
      env.DB.prepare('SELECT COUNT(*) AS chunks, COUNT(DISTINCT path) AS files FROM forest_nodes').first().catch(() => null),
      env.DB.prepare('SELECT MAX(ts) AS last FROM forest_walks').first().catch(() => null),
      env.CANON.describe().catch(() => null),
    ]);
    let forestHealth: any = null;
    try {
      if (refreshRow?.report_json) {
        const r = JSON.parse(refreshRow.report_json as string);
        forestHealth = {
          ts: r.ts ?? refreshRow.ts ?? null,
          source: r.source ?? null,
          total_edges: r.total_edges ?? null,
          prune_candidates: r.prune_candidates ?? null,
          hub_alarm_count: r.hub_alarm?.count ?? null,
        };
      }
    } catch { /* keep null */ }
    const payload = {
      forest_health: forestHealth,
      canon_count: {
        chunks: canonCounts?.chunks ?? null,
        files: canonCounts?.files ?? null,
        vector_count: (indexInfo as VectorizeIndexInfo | null)?.vectorCount ?? null,
      },
      last_walk: lastWalk?.last ?? null,
      available_tools: MCP_TOOLS.map((t) => t.name),
    };
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
  },
};

const MCP_TOOLS: McpTool[] = [toolForestWalk, toolCanonSearch, toolFleetStatus];

// ============================================================================
//  JSON-RPC 2.0 dispatch (pure envelope logic — exported for tests)
// ============================================================================

class McpParamsError extends Error {}

function rpcError(id: any, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function textResult(payload: unknown, isError = false): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], ...(isError ? { isError } : {}) };
}

export async function dispatchRpc(msg: any, ctx: McpToolCtx): Promise<RpcOutcome> {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return rpcError(null, RPC_ERRORS.INVALID_REQUEST, 'invalid request — expected a single JSON-RPC 2.0 message object (batches removed in protocol 2025-06-18)');
  }
  const id = msg.id ?? null;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(id, RPC_ERRORS.INVALID_REQUEST, 'invalid request — need jsonrpc:"2.0" and a string method');
  }
  const isNotification = msg.id === undefined;

  // Notifications (no id): accept and stay silent (streamable-HTTP 202 above).
  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') return null;

  if (isNotification) return null; // unknown notifications are ignored per JSON-RPC 2.0

  switch (msg.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: SERVER_INSTRUCTIONS,
        },
      };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0', id,
        result: {
          tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        },
      };
    case 'tools/call': {
      const name = msg.params?.name;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) {
        return rpcError(id, RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${String(name)}`, { known: MCP_TOOLS.map((t) => t.name) });
      }
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return rpcError(id, RPC_ERRORS.INVALID_PARAMS, 'invalid arguments — expected an object');
      }
      try {
        const out = await tool.run(args, ctx);
        return { jsonrpc: '2.0', id, result: out };
      } catch (e: any) {
        if (e instanceof McpParamsError) {
          return rpcError(id, RPC_ERRORS.INVALID_PARAMS, e.message);
        }
        // Tool-level runtime failure: valid RPC envelope, isError content.
        console.error(`mcp tool ${name} failed: ${e?.message}`);
        return { jsonrpc: '2.0', id, result: textResult({ error: e?.message || 'tool failed' }, true) };
      }
    }
    default:
      return rpcError(id, RPC_ERRORS.METHOD_NOT_FOUND, `method not found: ${msg.method}`);
  }
}

// ============================================================================
//  HTTP surface — POST /mcp (also /api/mcp, /.well-known/mcp)
// ============================================================================

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function mcpResponse(data: unknown, status = 200): Response {
  return new Response(data == null ? null : JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...(data == null ? {} : { 'Content-Type': 'application/json' }),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function handleMcp(req: Request, env: McpEnv, deps: McpDeps): Promise<Response> {
  // Streamable-HTTP without an SSE stream: only POST is meaningful.
  // (GET would open a server->client stream; we decline with 405 per spec.)
  if (req.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }

  // --- auth (paper 63 §3 spirit: bearer token, per-token rate limit) --------
  let tokenHash = 'dev';
  if (env.MCP_TOKEN) {
    if (!bearerOk(req.headers.get('Authorization'), env.MCP_TOKEN)) {
      return mcpResponse({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'unauthorized — send Authorization: Bearer <MCP_TOKEN>' } }, 401);
    }
    tokenHash = (await sha256Hex(env.MCP_TOKEN)).slice(0, 16);
  } else {
    // Dev fallback, clearly gated: no MCP_TOKEN secret configured. Only local
    // wrangler dev (no CF-Connecting-IP — the edge always sets it) gets through.
    const onEdge = req.headers.get('CF-Connecting-IP') != null;
    if (onEdge) {
      return mcpResponse({ error: 'MCP_TOKEN secret not configured — run `wrangler secret put MCP_TOKEN` (see tools/MCP-BRIDGE.md)' }, 503);
    }
    console.warn('mcp: MCP_TOKEN unset — accepting local dev request without auth (dev fallback)');
  }

  // --- rate limit: burst 10, sustained 60/min, walk depth costs extra -------
  const peek: any = await req.clone().json().catch(() => null);
  const walkCost = peek?.method === 'tools/call' && peek?.params?.name === 'forest_walk'
    ? 1 + Math.floor(clampDepth(peek?.params?.arguments?.depth) / MCP_WALK_DEPTH_MAX)
    : 1;
  let accepted = true;
  for (let i = 0; i < walkCost; i++) {
    if (!mcpLimiter.take(`mcp:${tokenHash}`)) { accepted = false; break; }
  }
  if (!accepted) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Retry-After': '1', // token bucket refills 1 token/s
    });
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: peek?.id ?? null,
      error: { code: -32000, message: `rate limited — burst 10, sustained 60/min per token (this call cost ${walkCost})` },
    }, null, 2), { status: 429, headers });
  }

  // --- body size guard -------------------------------------------------------
  const contentLength = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (contentLength > MCP_BODY_MAX) {
    return mcpResponse({ jsonrpc: '2.0', id: null, error: { code: RPC_ERRORS.INVALID_REQUEST, message: `request body too large (max ${MCP_BODY_MAX} bytes)` } }, 413);
  }

  const msg: any = await req.json().catch(() => null);
  if (msg === null) {
    return mcpResponse({ jsonrpc: '2.0', id: null, error: { code: RPC_ERRORS.PARSE, message: 'parse error — body is not valid JSON' } }, 200);
  }

  const t0 = Date.now();
  const outcome = await dispatchRpc(msg, { env, deps, tokenHash });

  // --- audit (best-effort; failures never break the call) --------------------
  try {
    await env.DB
      .prepare('INSERT INTO mcp_audit (ts, token_hash, method, tool, ok, duration_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(
        Math.floor(Date.now() / 1000),
        tokenHash,
        typeof msg?.method === 'string' ? msg.method : '(invalid)',
        msg?.params?.name ?? null,
        outcome && !outcome.error && !(outcome as any)?.result?.isError ? 1 : 0,
        Date.now() - t0,
      )
      .run();
  } catch (e: any) {
    console.error(`mcp_audit insert failed (run migrations/0006): ${e?.message}`);
  }

  if (outcome === null) return new Response(null, { status: 202 }); // notification
  return mcpResponse(outcome);
}
