// =============================================================================
//  fleet-static-host — Worker entry
// =============================================================================
//  Architecture (the honest split):
//    * STATIC BUILDS RIDE ASSETS — /mist (game export) and /ternary (ROM
//      visualizer) are build artifacts served straight from Cloudflare's
//      asset tier; they never invoke this Worker.
//    * CONTENT RIDES QUILT — papers, writings, and the lobby are quilt cells
//      (sheets `papers`, `writings`, `lobby`) persisted in D1 (`quilt-fleet-db`)
//      through quilt-cloudflare's D1Storage. A tiny render layer (src/render.ts)
//      keeps the original typography byte-for-byte.
//    * Every content URL that superinstance.ai / luciddreamer link to keeps
//      working: worker-first routing for /papers/*, /writings/*, /, /api/*,
//      with the pre-quilt static HTML still deployed as a cold fallback
//      (if D1 ever misses, the Worker serves the asset copy).
//
//  Quilt engine: vendored in src/quilt.ts from SuperInstance/quilt-cloudflare
//  @ 3c293f6 (upstream untouched).
// =============================================================================

import { D1Storage, QuiltEngine, type Sheet } from './quilt';
import { page, renderDoc, renderIndex, renderLobby, type DocCell, type IndexCell, type CardCell, type TrailCell, type YardSignal } from './render';
import {
  USCP_SHEET, USCP_CELL_PREFIX, USCP_MAX_BODY_BYTES,
  RateLimiter, validateEnvelope, mergeTelemetry, type UscpPacket, type TelemetryCell,
} from './uscp';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  QUILT_SEED_KEY?: string;
  AI: Ai;
  CANON: Vectorize;
}

const AUTHOR = 'fleet-static-host';
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HTML_RE = /^(.*)\.html$/;
const PUBLIC_SET_PREFIX = 'lobby.';
const PUBLIC_SET_MAX = 400;

function json(data: any, status = 200, cors = true): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (cors) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Quilt-Key';
  }
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function html(body: string, cacheControl: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl },
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Quilt-Key',
        },
      });
    }

    try {
      // ------------------------------------------------------------------
      // Lobby — quilt-rendered index (sheet `lobby`)
      // ------------------------------------------------------------------
      if (path === '/') {
        return await handleLobby(req, env);
      }

      // ------------------------------------------------------------------
      // Papers — content cells in sheet `papers`
      // ------------------------------------------------------------------
      if (path === '/papers' || path === '/papers/') {
        return await handleIndex(req, env, 'papers');
      }
      if (path.startsWith('/papers/')) {
        return await handleDoc(req, env, 'papers', path.slice('/papers/'.length));
      }

      // ------------------------------------------------------------------
      // Writings — content cells in sheet `writings`
      // ------------------------------------------------------------------
      if (path === '/writings' || path === '/writings/') {
        return await handleIndex(req, env, 'writings');
      }
      if (path.startsWith('/writings/')) {
        return await handleDoc(req, env, 'writings', path.slice('/writings/'.length));
      }

      // ------------------------------------------------------------------
      // Quilt API — the backend is visibly alive
      // ------------------------------------------------------------------
      if (path === '/api/quilt' && req.method === 'GET') {
        return json({
          ok: true,
          backend: 'quilt (vendored from SuperInstance/quilt-cloudflare @ 3c293f6)',
          storage: 'D1 — quilt-fleet-db',
          endpoints: {
            'GET  /api/quilt/cells': 'all sheets + cells (id, kind, bytes, lamport t, author)',
            'GET  /api/quilt/cell/<sheet>/<cell>': 'full cell value',
            'GET  /api/quilt/history/<sheet>/<cell>': 'cell change history (Lamport timeline)',
            'POST /api/quilt/set/<sheet>/<cell>': 'set a cell value — public for lobby.*, key-protected otherwise (body {"value": ...})',
            'POST /api/quilt/sheet?id=<sheet>': 'load a sheet (seed) — requires X-Quilt-Key',
            'POST /api/uscp': 'USCP telemetry sink — validated + rate-limited, writes sheet `telemetry` (latest-wins per signal_type)',
            'GET  /api/uscp': 'telemetry summary (the LIVE YARD panel feed)',
          },
          demo: 'POST /api/quilt/set/lobby/lobby.greeting {"value":"..."} then reload / — the lobby is live.',
        });
      }

      if (path === '/api/quilt/health' && req.method === 'GET') {
        // Diagnostics: quilt formula cells evaluate via `new Function` —
        // verify dynamic eval actually works in this isolate.
        let evalOk = false;
        let evalError: string | undefined;
        try {
          const fn = new Function('a', 'b', 'with(arguments[2]) { return (a + b); }');
          evalOk = fn(31, 4, {}) === 35;
        } catch (e: any) {
          evalError = e?.message;
        }
        const storage = new D1Storage(env.DB, AUTHOR);
        const sheets = await storage.listSheets().catch(() => []);
        return json({ ok: true, d1: sheets.length > 0, sheets, dynamicEval: { ok: evalOk, error: evalError } });
      }

      if (path === '/api/quilt/cells' && req.method === 'GET') {
        const storage = new D1Storage(env.DB, AUTHOR);
        const sheets = await storage.listSheets();
        const summary = await env.DB
          .prepare(
            `SELECT sheet_id, id, kind, LENGTH(value) AS bytes, t, author,
                    datetime(updated_at / 1000, 'unixepoch') AS updated
             FROM cells ORDER BY sheet_id, id`,
          )
          .all();
        return json({
          ok: true,
          sheets,
          cellCount: (summary.results || []).length,
          cells: summary.results,
        });
      }

      let m = path.match(/^\/api\/quilt\/cell\/([^/]+)\/([^/]+)$/);
      if (m && req.method === 'GET') {
        const storage = new D1Storage(env.DB, AUTHOR);
        const hit = await storage.getValue(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
        if (!hit) return json({ error: 'cell not found' }, 404);
        return json({ ok: true, cellId: decodeURIComponent(m[2]), sheetId: decodeURIComponent(m[1]), ...hit });
      }

      m = path.match(/^\/api\/quilt\/history\/([^/]+)\/([^/]+)$/);
      if (m && req.method === 'GET') {
        const storage = new D1Storage(env.DB, AUTHOR);
        const history = await storage.getHistory(decodeURIComponent(m[1]), decodeURIComponent(m[2]), 50);
        return json({ ok: true, history });
      }

      m = path.match(/^\/api\/quilt\/set\/([^/]+)\/([^/]+)$/);
      if (m && req.method === 'POST') {
        const sheetId = decodeURIComponent(m[1]);
        const cellId = decodeURIComponent(m[2]);
        const body = await req.json().catch(() => null) as { value?: any } | null;
        if (!body || body.value === undefined) return json({ error: 'body must be {"value": ...}' }, 400);

        const isPublicCell = sheetId === 'lobby' && cellId.startsWith(PUBLIC_SET_PREFIX);
        const keyOk = env.QUILT_SEED_KEY && req.headers.get('X-Quilt-Key') === env.QUILT_SEED_KEY;
        if (!isPublicCell && !keyOk) {
          return json({ error: 'unauthorized — public writes are limited to lobby.* cells; others need X-Quilt-Key' }, 403);
        }
        if (isPublicCell && !keyOk) {
          if (typeof body.value === 'string' && body.value.length > PUBLIC_SET_MAX) {
            return json({ error: `public lobby values are capped at ${PUBLIC_SET_MAX} chars` }, 400);
          }
          if (cellId.startsWith('lobby.card.')) {
            return json({ error: 'card cells are key-protected' }, 403);
          }
        }

        const storage = new D1Storage(env.DB, AUTHOR);
        const engine = new QuiltEngine({ storage, sheetId, author: keyOk ? 'seed' : 'web' });
        await engine.loadFromStorage();
        try {
          await engine.set(cellId, body.value);
        } catch (e: any) {
          return json({ error: e.message }, 404);
        }
        const after = await engine.get(cellId);
        return json({ ok: true, sheetId, cellId, result: after });
      }

      if (path === '/api/quilt/sheet' && req.method === 'POST') {
        if (!env.QUILT_SEED_KEY || req.headers.get('X-Quilt-Key') !== env.QUILT_SEED_KEY) {
          return json({ error: 'unauthorized — X-Quilt-Key required' }, 403);
        }
        const sheetId = url.searchParams.get('id') || 'default';
        const sheet = await req.json().catch(() => null) as Sheet | null;
        if (!sheet || !Array.isArray(sheet.cells)) return json({ error: 'body must be a quilt Sheet JSON {cells, edges}' }, 400);
        const storage = new D1Storage(env.DB, AUTHOR);
        const engine = new QuiltEngine({ storage, sheetId, author: 'seed' });
        await engine.load(sheet);
        return json({ ok: true, sheetId, cells: sheet.cells.length, edges: (sheet.edges || []).length });
      }

      // ------------------------------------------------------------------
      // Canon — semantic search over the ai-writings corpus
      // (Vectorize `ai-writings-canon`, bge-m3 embeddings, 1024-dim)
      // ------------------------------------------------------------------
      if (path === '/canon/search' && req.method === 'GET') {
        return await handleCanonSearch(url, env);
      }

      // ------------------------------------------------------------------
      // Forest — topology-augmented recall over the same canon
      // (graph traversal over forest_edges in D1, not flat kNN)
      // ------------------------------------------------------------------
      if (path === '/forest/search' && req.method === 'GET') {
        return await handleForestSearch(url, env);
      }
      if (path === '/api/forest/graph' && req.method === 'GET') {
        return await handleForestGraph(env);
      }
      if (path === '/api/forest/node' && req.method === 'GET') {
        return await handleForestNode(url, env);
      }
      if (path === '/api/forest/walk-log' && req.method === 'POST') {
        return await handleForestWalkLog(req, env);
      }
      if (path === '/api/forest/weights' && req.method === 'GET') {
        return await handleForestWeights(url, env);
      }
      if (path === '/api/forest/walk-analytics' && req.method === 'GET') {
        return await handleForestWalkAnalytics(env);
      }
      if (path === '/api/forest/diff' && req.method === 'GET') {
        return await handleForestDiff(url, env);
      }
      // Embed-only bridge: the offline vectorizer embeds through this binding
      // instead of the REST API — worker bindings don't carry OAuth tokens
      // that rotate out from under long-running scripts.
      if (path === '/ai/embed' && req.method === 'POST') {
        return await handleEmbed(req, env);
      }

      // ------------------------------------------------------------------
      // USCP telemetry sink — games phone home here (opt-in on their side)
      // ------------------------------------------------------------------
      if (path === '/api/uscp' && req.method === 'POST') {
        return await handleUscpPost(req, env);
      }
      if (path === '/api/uscp' && req.method === 'GET') {
        return await handleUscpGet(env);
      }

      // ------------------------------------------------------------------
      // Everything else — the asset tier (mist, ternary, favicon, 404)
      // ------------------------------------------------------------------
      return env.ASSETS.fetch(req);
    } catch (e: any) {
      // D1/quilt failure must never break the shelf: try the static fallback.
      console.error(`quilt path failed (${path}): ${e?.message}`);
      try {
        const fallback = await env.ASSETS.fetch(req);
        if (fallback.status !== 404) return fallback;
      } catch (_) { /* fall through */ }
      return json({ error: e?.message || 'internal error' }, 500);
    }
  },
};

// ============================================================================
//  Content handlers
// ============================================================================

// ============================================================================
//  Safe arithmetic evaluator for formula cells
// ============================================================================
//  Workers disallow eval()/new Function() at request time, so quilt's
//  evalFormula (upstream) cannot run on the edge. For our formula cell we use
//  this tiny recursive-descent parser instead — identifiers resolve to sibling
//  cell values, numbers and + - * / ( ) are supported, anything else rejects.
//  Documented honestly in README ("what's quilt-backed vs shimmed").

export function safeEvalArithmetic(expr: string, env: Record<string, number | null>): number | null {
  let pos = 0;
  const s = expr;
  const ws = () => { while (pos < s.length && /\s/.test(s[pos])) pos++; };
  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      ws();
      const op = s[pos];
      if (op === '+' || op === '-') {
        pos++;
        const right = parseTerm();
        if (right === null) return null;
        left = op === '+' ? left + right : left - right;
      } else return left;
    }
  };
  const parseTerm = (): number | null => {
    let left = parseAtom();
    if (left === null) return null;
    for (;;) {
      ws();
      const op = s[pos];
      if (op === '*' || op === '/') {
        pos++;
        const right = parseAtom();
        if (right === null) return null;
        left = op === '*' ? left * right : left / right;
      } else return left;
    }
  };
  const parseAtom = (): number | null => {
    ws();
    if (s[pos] === '(') {
      pos++;
      const v = parseExpr();
      ws();
      if (s[pos] !== ')') return null;
      pos++;
      return v;
    }
    const num = /^\d+(\.\d+)?/.exec(s.slice(pos));
    if (num) {
      pos += num[0].length;
      return parseFloat(num[0]);
    }
    const id = /^[a-zA-Z_][a-zA-Z0-9_.]*/.exec(s.slice(pos));
    if (id) {
      pos += id[0].length;
      const key = id[0].replace(/\./g, '_');
      const v = env[id[0]] ?? env[key];
      return typeof v === 'number' ? v : null;
    }
    return null;
  };
  const result = parseExpr();
  ws();
  return pos === s.length && result !== null && Number.isFinite(result) ? result : null;
}

async function handleLobby(req: Request, env: Env): Promise<Response> {
  try {
    const storage = new D1Storage(env.DB, AUTHOR);
    // One D1 read of the lobby sheet; value cells come back via quilt's loader.
    const { cells } = await storage.load('lobby');
    if (!cells.length) throw new Error('lobby sheet empty');
    const value = (id: string): any => cells.find((c) => c.id === id)?.value;

    const greeting = value('lobby.greeting');
    const cardOrder = value('lobby.cards') as string[] | undefined;
    const pieces = value('lobby.pieces') as number | undefined;
    const trails = value('lobby.trails') as number | undefined;
    const log = value('lobby.log') as number | undefined;
    const yard = await loadYardSignals(env);
    const formulaCell = cells.find((c) => c.id === 'lobby.total');

    // Formula cell: quilt semantics (deps -> expr) but evaluated with the safe
    // parser, since Workers block new Function at request time.
    const envMap: Record<string, number | null> = {};
    for (const c of cells) {
      if (typeof c.value === 'number') envMap[c.id.replace(/\./g, '_')] = c.value;
    }
    const total =
      formulaCell?.config.expr
        ? safeEvalArithmetic(formulaCell.config.expr, envMap)
        : null;
    const totalSafe =
      total ??
      (typeof pieces === 'number' && typeof trails === 'number'
        ? pieces + trails + (typeof log === 'number' ? log : 0)
        : 0);

    if (typeof greeting !== 'string' || !Array.isArray(cardOrder)) {
      throw new Error('lobby sheet incomplete');
    }
    const cards: CardCell[] = [];
    for (const id of cardOrder) {
      const c = value(id) as CardCell | undefined;
      if (c && c.href) cards.push(c);
    }

    // Trails log (sheet `trails`) — optional by design: if the sheet is absent
    // or empty the lobby still renders; the static fallback carries a copy.
    let trailsNote: string | null = null;
    let trailCells: TrailCell[] = [];
    try {
      const ts = await storage.load('trails');
      const tval = (id: string): any => ts.cells.find((c) => c.id === id)?.value;
      const order = tval('trails.index') as string[] | undefined;
      const note = tval('trails.note') as string | undefined;
      if (Array.isArray(order)) {
        for (const id of order) {
          const t = tval(id) as TrailCell | undefined;
          if (t && t.name && t.href) trailCells.push(t);
        }
      }
      if (typeof note === 'string') trailsNote = note;
    } catch (e: any) {
      console.error(`trails sheet unavailable, skipping section: ${e?.message}`);
    }

    const body = renderLobby(greeting, cards, trailsNote, trailCells, pieces ?? 0, trails ?? 0, typeof log === 'number' ? log : null, totalSafe, yard);
    return html(body, 'no-cache');
  } catch (e: any) {
    console.error(`lobby fell back to static: ${e?.message}`);
    return env.ASSETS.fetch(req);
  }
}

// ============================================================================
//  Canon — semantic search over the ai-writings corpus
// ============================================================================
//  Every chunk of ~/projects/ai-writings was embedded with @cf/baai/bge-m3
//  (1024-dim, cosine) into Vectorize index `ai-writings-canon` with metadata
//  {path, chunk, text}. Here we embed the query with the same model and
//  ask the index for its neighbors. Results are deduped by path — the best
//  (highest-scoring) chunk speaks for its file; the rest are dropped for
//  display. The page at /canon drinks from this endpoint.

const CANON_TOP_K = 8;
const CANON_MAX_Q = 400;
// Hebbian boost gain. Deliberately tiny: this is a TIE-BREAKER tier that only
// reorders near-equal vector matches — it must never become a ranking channel
// of its own (0.05 * ln(1 + walk_count) saturates around ~0.35 even on a
// 1000-walk edge, well under a typical vector-score gap).
const CANON_HEBBIAN_GAIN = 0.05;

// Embed bridge caps: 64 texts × 2000 chars per call (vectorizer batch size).
const EMBED_MAX_TEXTS = 64;
const EMBED_MAX_CHARS = 2000;

async function handleEmbed(req: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'body must be JSON {text:[…]}' }, 400);
  }
  const texts: string[] = Array.isArray(body?.text) ? body.text : [];
  if (texts.length === 0 || texts.length > EMBED_MAX_TEXTS) {
    return json({ ok: false, error: `text must be an array of 1–${EMBED_MAX_TEXTS} strings` }, 400);
  }
  const clean = texts.map((t) => String(t).slice(0, EMBED_MAX_CHARS));
  try {
    const out: any = await env.AI.run('@cf/baai/bge-m3', { text: clean });
    const vectors = out?.data ?? out?.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== clean.length) {
      return json({ ok: false, error: 'embedding failed — model returned wrong shape' }, 502);
    }
    return json({ ok: true, vectors });
  } catch (e: any) {
    return json({ ok: false, error: `embedding failed: ${e?.message}` }, 502);
  }
}

async function handleCanonSearch(url: URL, env: Env): Promise<Response> {
  const q = (url.searchParams.get('q') || '').trim().slice(0, CANON_MAX_Q);
  if (!q) {
    return json({ ok: true, query: '', count: 0, results: [], hint: 'add ?q=… — the query is embedded with bge-m3 and matched against the ai-writings corpus' });
  }

  let embedding: number[];
  try {
    const out: any = await env.AI.run('@cf/baai/bge-m3', { text: [q] });
    embedding = out?.data?.[0] ?? out?.embeddings?.[0];
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return json({ ok: false, error: 'embedding failed — model returned no vector' }, 502);
    }
  } catch (e: any) {
    return json({ ok: false, error: `embedding failed: ${e?.message}` }, 502);
  }

  let matches: VectorizeMatch[] = [];
  try {
    const res = await env.CANON.query(embedding, { topK: CANON_TOP_K, returnMetadata: 'all' });
    matches = (res?.matches || []).filter((m: VectorizeMatch) => m.metadata?.path);
  } catch (e: any) {
    return json({ ok: false, error: `vectorize query failed: ${e?.message}` }, 502);
  }

  // Dedupe by path, keeping the best chunk per file (matches are score-desc).
  const seen = new Set<string>();
  const results = matches
    .filter((m) => {
      const p = m.metadata!.path as string;
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    })
    .map((m) => ({
      path: m.metadata!.path as string,
      chunk: m.metadata!.chunk as number | null,
      text: m.metadata!.text as string,
      score: m.score,
    }));

  // Hebbian tie-breaker: for each result chunk, look up its incident
  // forest_edges in D1 and add bonus = Σ 0.05 * ln(1 + walk_count) over those
  // edges. Deepened (well-walked) neighborhoods nudge near-ties; ?raw=1 skips
  // the graph read and returns pure vector ranking. The bonus is reported per
  // result so its contribution stays auditable.
  const raw = url.searchParams.get('raw') === '1';
  for (const r of results) {
    let boost = 0;
    if (!raw && r.chunk != null) {
      const nodeId = `${r.path}::${r.chunk}`.replace(/\//g, '__').slice(0, 96);
      try {
        const rows = await env.DB
          .prepare(
            `SELECT fe.src, fe.dst, COUNT(fw.rowid) AS walk_count
             FROM forest_edges fe
             LEFT JOIN forest_walks fw ON fw.src = fe.src AND fw.dst = fe.dst
             WHERE fe.src = ? OR fe.dst = ?
             GROUP BY fe.src, fe.dst`,
          )
          .bind(nodeId, nodeId)
          .all();
        for (const e of rows.results || []) {
          boost += CANON_HEBBIAN_GAIN * Math.log(1 + (e.walk_count as number));
        }
      } catch (e: any) {
        // Graph read failure must never break search: fall back to raw ranking.
        console.error(`canon boost read failed for ${nodeId}: ${e?.message}`);
      }
    }
    (r as any).boost = Math.round(boost * 1e6) / 1e6;
    r.score = Math.round((r.score + boost) * 1e6) / 1e6;
  }
  if (!raw) results.sort((a, b) => b.score - a.score);

  return json({ ok: true, query: q, count: results.length, raw, results });
}

// ============================================================================
//  Forest — traversal-as-cognition over the chunk graph
// ============================================================================
//  The doctrine (Casey's card): memory is not a warehouse of flat facts, it is
//  a weighted graph; the walk IS the thought. Here: embed the query, DROP into
//  the top-1 node (the attractor), then best-first expand over forest_edges
//  for N hops (default 2). Score of a node = drop_similarity × DECAY^hop ×
//  Π(edge weights along the path) — monotonically non-increasing down any
//  path, so the walk cools as it goes. Output deduped by file path; the walk
//  itself is the answer. /canon/search stays untouched for the A/B.

const FOREST_DECAY = 0.85;      // path_weight_decay per hop
const FOREST_MAX_Q = 400;
const FOREST_WALK_LEN = 8;
const FOREST_MAX_EXPAND = 48;   // best-first pops per query (D1 edge reads)
const FOREST_HOPS_MAX = 4;

interface ForestVisit { id: string; score: number; hops: number }

async function handleForestSearch(url: URL, env: Env): Promise<Response> {
  const q = (url.searchParams.get('q') || '').trim().slice(0, FOREST_MAX_Q);
  const hops = Math.min(FOREST_HOPS_MAX, Math.max(1, parseInt(url.searchParams.get('hops') || '2', 10) || 2));
  if (!q) {
    return json({ ok: true, query: '', drop: null, walk: [], stats: {}, hint: 'add ?q=…&hops=2 — the query is dropped into its attractor node and the walk expands over the forest_edges graph' });
  }

  // 1 — embed, drop into the attractor (best canonical node in the index)
  let embedding: number[];
  try {
    const out: any = await env.AI.run('@cf/baai/bge-m3', { text: [q] });
    embedding = out?.data?.[0] ?? out?.embeddings?.[0];
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return json({ ok: false, error: 'embedding failed — model returned no vector' }, 502);
    }
  } catch (e: any) {
    return json({ ok: false, error: `embedding failed: ${e?.message}` }, 502);
  }

  let dropScore = 0;
  let dropId = '';
  try {
    const res = await env.CANON.query(embedding, { topK: 6, returnMetadata: 'all' });
    const matches = (res?.matches || []).filter((m: VectorizeMatch) => m.metadata?.path && m.metadata?.chunk != null);
    if (!matches.length) return json({ ok: false, error: 'no attractor — the index returned nothing' }, 504);
    // prefer canonical path-style ids (the index also carries v2::hash dupes)
    const canonical = matches.find((m) => !m.id.startsWith('v2::')) || matches[0];
    dropScore = canonical.score;
    const p = canonical.metadata!.path as string;
    const c = canonical.metadata!.chunk as number;
    dropId = `${p}::${c}`.replace(/\//g, '__').slice(0, 96);
  } catch (e: any) {
    return json({ ok: false, error: `vectorize query failed: ${e?.message}` }, 502);
  }

  // 2 — best-first expansion over forest_edges
  const visited = new Map<string, ForestVisit>();
  const frontier: ForestVisit[] = [{ id: dropId, score: dropScore, hops: 0 }];
  visited.set(dropId, frontier[0]);
  let edgesFollowed = 0;
  let expanded = 0;
  while (expanded < FOREST_MAX_EXPAND) {
    frontier.sort((a, b) => b.score - a.score);
    const node = frontier.shift();
    if (!node) break;
    if (node.hops >= hops) continue; // deeper than asked; still counted as visited
    expanded++;
    let rows: any[] = [];
    try {
      const r = await env.DB
        .prepare('SELECT dst, kind, weight FROM forest_edges WHERE src = ?')
        .bind(node.id)
        .all();
      rows = r.results || [];
    } catch (e: any) {
      return json({ ok: false, error: `edge read failed: ${e?.message}` }, 500);
    }
    edgesFollowed += rows.length;
    for (const e of rows) {
      const score = node.score * FOREST_DECAY * (e.weight as number);
      const prev = visited.get(e.dst as string);
      if (!prev || score > prev.score) {
        visited.set(e.dst as string, { id: e.dst as string, score, hops: node.hops + 1 });
        frontier.push(visited.get(e.dst as string)!);
      }
    }
  }

  // 3 — the walk is the answer: score-desc, dedupe by file path (drop first)
  const ordered = [...visited.values()].sort((a, b) => b.score - a.score);
  const seenPaths = new Set<string>();
  const picked: ForestVisit[] = [];
  for (const v of ordered) {
    const path = v.id.split('::')[0].replace(/__/g, '/');
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    picked.push(v);
    if (picked.length >= FOREST_WALK_LEN) break;
  }

  const ids = picked.map((v) => v.id);
  const nodeRows = ids.length
    ? (await env.DB
        .prepare(`SELECT id, path, chunk, text FROM forest_nodes WHERE id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .all()).results || []
    : [];
  const byId = new Map<string, any>(nodeRows.map((r: any) => [r.id, r]));

  const walk = picked.map((v) => {
    const n = byId.get(v.id);
    return {
      path: n?.path ?? v.id.split('::')[0].replace(/__/g, '/'),
      chunk: n?.chunk ?? null,
      text: n?.text ?? '',
      score: Math.round(v.score * 1e6) / 1e6,
      hops: v.hops,
      id: v.id,
    };
  });

  const dropNode = byId.get(dropId);
  return json({
    ok: true,
    query: q,
    hops,
    drop: {
      path: dropNode?.path ?? dropId.split('::')[0].replace(/__/g, '/'),
      chunk: dropNode?.chunk ?? null,
      text: dropNode?.text ?? '',
      score: Math.round(dropScore * 1e6) / 1e6,
      id: dropId,
    },
    walk,
    stats: {
      nodes_visited: visited.size,
      edges_followed: edgesFollowed,
      decay: FOREST_DECAY,
      hops,
    },
  });
}

// ============================================================================
//  Forest graph bulk read — feeds /forest/map (the force-directed overview)
// ============================================================================
//  Nodes come back as (id, title) with the title trimmed to the corpus path;
//  chunk text stays out of the payload — the map fetches it per node on tap
//  via /api/forest/node. Edges are capped at FOREST_GRAPH_MAX_EDGES, keeping
//  the strongest (weight-desc) so the sampled graph keeps its backbone.

const FOREST_GRAPH_MAX_EDGES = 2000;
const FOREST_TITLE_MAX = 96;

async function handleForestGraph(env: Env): Promise<Response> {
  try {
    const [nodeRows, edgeRows] = await Promise.all([
      env.DB.prepare('SELECT id, path FROM forest_nodes').all(),
      env.DB.prepare('SELECT src, dst, kind, weight FROM forest_edges ORDER BY weight DESC LIMIT ?')
        .bind(FOREST_GRAPH_MAX_EDGES)
        .all(),
    ]);
    const nodes = (nodeRows.results || []).map((r: any) => ({
      id: r.id as string,
      title: (r.path as string).slice(0, FOREST_TITLE_MAX),
    }));
    const edges = (edgeRows.results || []).map((r: any) => ({
      src: r.src as string,
      dst: r.dst as string,
      kind: r.kind as string,
      weight: r.weight as number,
    }));
    return json({ ok: true, count: { nodes: nodes.length, edges: edges.length }, nodes, edges });
  } catch (e: any) {
    return json({ ok: false, error: `graph read failed: ${e?.message}` }, 500);
  }
}

async function handleForestNode(url: URL, env: Env): Promise<Response> {
  const id = (url.searchParams.get('id') || '').slice(0, 128);
  if (!id) return json({ ok: false, error: 'add ?id=…' }, 400);
  try {
    const row = await env.DB
      .prepare('SELECT id, path, chunk, text FROM forest_nodes WHERE id = ?')
      .bind(id)
      .first();
    if (!row) return json({ ok: false, error: 'node not found' }, 404);
    return json({ ok: true, node: row });
  } catch (e: any) {
    return json({ ok: false, error: `node read failed: ${e?.message}` }, 500);
  }
}

// ============================================================================
//  Forest walk logging — Hebbian edge deepening
// ============================================================================
//  Every traversal hop is logged to forest_walks(ts, src, dst) for learning.
//  Edge weights get boosted = base + ln(1 + walk_count) over time.
//  Phase 0 hardening (research/61 §4.3): a session-scoped id dedups (src,dst)
//  per session so same-session echo never inflates the counter; ?decayed=1
//  computes the counter-decay effective weight W = Σ 2^(−age_days/90) per edge.

const FOREST_SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const FOREST_DECAY_HALF_LIFE_DAYS = 90;

const forestWalkLimiter = new RateLimiter(30, 2);

async function handleForestWalkLog(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (!forestWalkLimiter.take(ip)) {
    return json({ error: 'rate limited' }, 429);
  }
  const body = await req.json().catch(() => null) as { hops?: Array<{ src: string; dst: string }>; sessionId?: string } | null;
  if (!body || !Array.isArray(body.hops) || body.hops.length === 0) {
    return json({ error: 'body must be {"hops":[{src,dst},…], "sessionId":…}' }, 400);
  }
  const sessionId =
    typeof body.sessionId === 'string' && FOREST_SESSION_ID_RE.test(body.sessionId)
      ? body.sessionId
      : null;
  const ts = Math.floor(Date.now() / 1000);
  const hops = body.hops.slice(0, 16); // cap to prevent abuse
  let logged = 0;
  let deduped = 0;
  for (const hop of hops) {
    const src = String(hop.src || '').slice(0, 96);
    const dst = String(hop.dst || '').slice(0, 96);
    if (!src || !dst) continue;
    try {
      if (sessionId) {
        const seen = await env.DB
          .prepare('SELECT 1 FROM forest_walks WHERE src = ? AND dst = ? AND session_id = ? LIMIT 1')
          .bind(src, dst, sessionId)
          .first();
        if (seen) { deduped++; continue; } // same-session echo: already counted
      }
      await env.DB.prepare('INSERT INTO forest_walks (ts, src, dst, session_id) VALUES (?, ?, ?, ?)').bind(ts, src, dst, sessionId).run();
      logged++;
    } catch (e: any) {
      console.error(`forest_walks insert failed: ${e?.message}`);
    }
  }
  return json({ ok: true, logged, deduped });
}

async function handleForestWeights(url: URL, env: Env): Promise<Response> {
  const decayed = url.searchParams.get('decayed') === '1';
  try {
    // Plain: boosted = base + ln(1 + walk_count). Decayed: each walk contributes
    // 2^(−age_days/90) to an effective counter W, boosted = base + ln(1 + W) —
    // the counter-decay shape from research/61 §3.3, computed read-time (lazy).
    const now = Math.floor(Date.now() / 1000);
    const edgeRows = await env.DB
      .prepare(decayed
        ? `
          SELECT fe.src, fe.dst, fe.kind, fe.weight,
                 COALESCE(COUNT(fw.rowid), 0) AS walk_count,
                 COALESCE(SUM(POW(0.5, (? - fw.ts) * 1.0 / 86400.0 / ${FOREST_DECAY_HALF_LIFE_DAYS})), 0) AS w
          FROM forest_edges fe
          LEFT JOIN forest_walks fw ON fe.src = fw.src AND fe.dst = fw.dst
          GROUP BY fe.src, fe.dst, fe.kind
        `
        : `
          SELECT fe.src, fe.dst, fe.kind, fe.weight,
                 COALESCE(COUNT(fw.rowid), 0) AS walk_count
          FROM forest_edges fe
          LEFT JOIN forest_walks fw ON fe.src = fw.src AND fe.dst = fw.dst
          GROUP BY fe.src, fe.dst, fe.kind
        `);
    const edgeRowsRes = await (decayed ? edgeRows.bind(now) : edgeRows).all();
    const edges = (edgeRowsRes.results || []).map((r: any) => {
      const walkCount = r.walk_count as number;
      const w = decayed ? (r.w as number) : walkCount;
      const boosted = (r.weight as number) + Math.log(1 + w);
      return {
        src: r.src as string,
        dst: r.dst as string,
        kind: r.kind as string,
        base: r.weight as number,
        walk_count: walkCount,
        ...(decayed ? { w: Math.round(w * 1e6) / 1e6 } : {}),
        boosted,
      };
    });
    return json({ ok: true, count: edges.length, ...(decayed ? { decayed: true, half_life_days: FOREST_DECAY_HALF_LIFE_DAYS } : {}), edges });
  } catch (e: any) {
    return json({ ok: false, error: `weights read failed: ${e?.message}` }, 500);
  }
}

async function handleForestWalkAnalytics(env: Env): Promise<Response> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 30 * 86400;

    // Total walks
    const totalRes = await env.DB.prepare('SELECT COUNT(*) AS total FROM forest_walks').first();
    const totalWalks = (totalRes?.total as number) || 0;

    // Unique edges touched
    const edgesRes = await env.DB
      .prepare('SELECT COUNT(DISTINCT src, dst) AS count FROM forest_walks')
      .first();
    const uniqueEdges = (edgesRes?.count as number) || 0;

    // Top 20 deepened edges by walk count
    const topEdgesRes = await env.DB
      .prepare(`
        SELECT src, dst, COUNT(*) AS walk_count
        FROM forest_walks
        GROUP BY src, dst
        ORDER BY walk_count DESC
        LIMIT 20
      `)
      .all();
    const topEdges = (topEdgesRes.results || []) as Array<{ src: string; dst: string; walk_count: number }>;

    // Walks per day (last 30 days)
    const dailyRes = await env.DB
      .prepare(`
        SELECT datetime(ts, 'unixepoch') AS date, COUNT(*) AS count
        FROM forest_walks
        WHERE ts >= ?
        GROUP BY datetime(ts, 'unixepoch')
        ORDER BY date
      `)
      .bind(thirtyDaysAgo)
      .all();
    const dailyWalks: Record<string, number> = {};
    for (const row of (dailyRes.results || []) as Array<{ date: string; count: number }>) {
      dailyWalks[row.date.split(' ')[0]] = row.count;
    }

    // Per-session hop counts (session as # of distinct edges per session)
    const sessionRes = await env.DB
      .prepare(`
        SELECT session_id, COUNT(DISTINCT src, dst) AS hop_count
        FROM forest_walks
        WHERE session_id IS NOT NULL
        GROUP BY session_id
      `)
      .all();
    const sessionStats = (sessionRes.results || []) as Array<{ session_id: string; hop_count: number }>;
    const avgHopsPerSession =
      sessionStats.length > 0
        ? sessionStats.reduce((sum, s) => sum + s.hop_count, 0) / sessionStats.length
        : 0;
    const maxHopsInSession = sessionStats.length > 0 ? Math.max(...sessionStats.map((s) => s.hop_count)) : 0;

    // Median walk count for hub warning
    const medianRes = await env.DB
      .prepare(`
        WITH edge_counts AS (
          SELECT COUNT(*) AS walk_count FROM forest_walks GROUP BY src, dst
        )
        SELECT walk_count FROM edge_counts ORDER BY walk_count LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM edge_counts)
      `)
      .first();
    const medianWalkCount = ((medianRes?.walk_count as number) || 0) + 1; // +1 to avoid div by 0

    // Hub warning: edges with >10x median
    const hubWarningEdges = topEdges.filter((e) => e.walk_count > medianWalkCount * 10);

    return json({
      ok: true,
      summary: {
        total_walks: totalWalks,
        unique_edges: uniqueEdges,
        avg_hops_per_session: Math.round(avgHopsPerSession * 100) / 100,
        max_hops_in_session: maxHopsInSession,
      },
      top_edges: topEdges,
      daily_walks: dailyWalks,
      hub_warning: {
        median_walk_count: medianWalkCount,
        edges_over_10x_median: hubWarningEdges.length,
        edges: hubWarningEdges,
      },
    });
  } catch (e: any) {
    return json({ ok: false, error: `analytics read failed: ${e?.message}` }, 500);
  }
}

async function handleForestDiff(url: URL, env: Env): Promise<Response> {
  try {
    const now = Math.floor(Date.now() / 1000);
    let then: number | null = null;
    let nowTs: number | null = null;

    // Parse query params: ?then=<ts>&now=<ts>
    const thenParam = url.searchParams.get('then');
    const nowParam = url.searchParams.get('now');
    if (thenParam) then = parseInt(thenParam, 10);
    if (nowParam) nowTs = parseInt(nowParam, 10);

    // If both provided, use them. Otherwise infer from forest_refresh or forest_walks.
    if (!then || !nowTs || !Number.isFinite(then) || !Number.isFinite(nowTs)) {
      // Try to load two most recent forest_refresh reports
      try {
        const refreshRows = await env.DB
          .prepare('SELECT ts, report_json FROM forest_refresh ORDER BY ts DESC LIMIT 2')
          .all();
        const refreshes = (refreshRows.results || []) as Array<{ ts: number; report_json: string }>;
        if (refreshes.length === 2) {
          then = refreshes[1].ts;
          nowTs = refreshes[0].ts;
        } else if (refreshes.length === 1) {
          nowTs = refreshes[0].ts;
          // Fall back to 24h before
          then = nowTs - 86400;
        }
      } catch {
        // forest_refresh table doesn't exist or is empty; proceed to fallback
      }

      // Fallback: 24 hours ago from now via forest_walks
      if (!then || !nowTs) {
        nowTs = now;
        then = now - 86400;
      }
    }

    // Load edges at both timestamps (walk counts as of each time)
    const thenWalks = new Map<string, number>();
    const nowWalks = new Map<string, number>();

    // Past: count walks up to 'then'
    try {
      const thenRows = await env.DB
        .prepare('SELECT src, dst, COUNT(*) AS cnt FROM forest_walks WHERE ts <= ? GROUP BY src, dst')
        .bind(then)
        .all();
      for (const r of (thenRows.results || []) as Array<{ src: string; dst: string; cnt: number }>) {
        const key = `${r.src}|${r.dst}`;
        thenWalks.set(key, r.cnt);
      }
    } catch (e: any) {
      console.error(`diff thenWalks read failed: ${e?.message}`);
    }

    // Present: count walks up to 'now'
    try {
      const nowRows = await env.DB
        .prepare('SELECT src, dst, COUNT(*) AS cnt FROM forest_walks WHERE ts <= ? GROUP BY src, dst')
        .bind(nowTs)
        .all();
      for (const r of (nowRows.results || []) as Array<{ src: string; dst: string; cnt: number }>) {
        const key = `${r.src}|${r.dst}`;
        nowWalks.set(key, r.cnt);
      }
    } catch (e: any) {
      console.error(`diff nowWalks read failed: ${e?.message}`);
    }

    // Compute deltas: (src|dst) -> (then_count, now_count, delta)
    const allKeys = new Set([...thenWalks.keys(), ...nowWalks.keys()]);
    const deltas: Array<{ src: string; dst: string; then: number; now: number; delta: number; weight_delta: number }> = [];
    for (const key of allKeys) {
      const [src, dst] = key.split('|');
      const thenCnt = thenWalks.get(key) || 0;
      const nowCnt = nowWalks.get(key) || 0;
      const delta = nowCnt - thenCnt;
      if (delta !== 0) {
        // Weight delta (with decay): boosted = base + ln(1 + w)
        // Approximate as Δ(ln(1 + w)) ≈ (nowCnt - thenCnt) / (1 + max(thenCnt, 1))
        const weightDelta = delta / (1 + Math.max(thenCnt, 1));
        deltas.push({ src, dst, then: thenCnt, now: nowCnt, delta, weight_delta: Math.round(weightDelta * 1e6) / 1e6 });
      }
    }

    // Added edges (now > 0, then = 0)
    const added = deltas.filter((d) => d.then === 0 && d.now > 0);
    // Removed edges (then > 0, now = 0)
    const removed = deltas.filter((d) => d.then > 0 && d.now === 0);
    // Top weight deltas (largest absolute change)
    const topDeltas = deltas.filter((d) => d.then > 0 && d.now > 0).sort((a, b) => Math.abs(b.weight_delta) - Math.abs(a.weight_delta)).slice(0, 20);

    // Hub alarm: edges that crossed 10x-median threshold during period
    let hubAlarms: Array<{ src: string; dst: string; now: number; median: number }> = [];
    try {
      // Median walk count across all edges at 'now'
      const medianRes = await env.DB
        .prepare(`
          WITH edge_counts AS (
            SELECT COUNT(*) AS walk_count FROM forest_walks WHERE ts <= ? GROUP BY src, dst
          )
          SELECT walk_count FROM edge_counts ORDER BY walk_count LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM edge_counts)
        `)
        .bind(nowTs)
        .first();
      const medianWalkCount = ((medianRes?.walk_count as number) || 1);
      const threshold = medianWalkCount * 10;

      // Edges that are now over threshold
      for (const d of deltas) {
        if (d.now >= threshold && d.then < threshold) {
          hubAlarms.push({ src: d.src, dst: d.dst, now: d.now, median: medianWalkCount });
        }
      }
    } catch (e: any) {
      console.error(`diff hub alarm read failed: ${e?.message}`);
    }

    return json({
      ok: true,
      period: { then, now: nowTs },
      stats: {
        edges_added: added.length,
        edges_removed: removed.length,
        edges_changed: deltas.filter((d) => d.then > 0 && d.now > 0).length,
      },
      added: added.sort((a, b) => b.now - a.now),
      removed: removed.sort((a, b) => b.then - a.then),
      top_weight_deltas: topDeltas,
      hub_alarms: hubAlarms,
    });
  } catch (e: any) {
    return json({ ok: false, error: `diff read failed: ${e?.message}` }, 500);
  }
}

// ============================================================================
//  USCP telemetry — sink + live summary
// ============================================================================

const uscpLimiter = new RateLimiter(10, 0.5);

async function handleUscpPost(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (!uscpLimiter.take(ip)) {
    return json({ error: 'rate limited — the yard is chatty; slow down' }, 429);
  }
  const raw = await req.text().catch(() => null);
  if (raw === null) return json({ error: 'unreadable body' }, 400);
  if (raw.length > USCP_MAX_BODY_BYTES) return json({ error: 'body too large' }, 413);
  const parsed = await (async () => { try { return JSON.parse(raw); } catch { return null; } })();
  const v = validateEnvelope(parsed);
  if (!v.ok) return json({ error: v.error }, v.status ?? 400);

  // Group by signal_type, then write one latest-wins cell per key.
  const bySignal = new Map<string, UscpPacket[]>();
  for (const p of v.packets!) {
    const list = bySignal.get(p.signal_type) || [];
    list.push(p);
    bySignal.set(p.signal_type, list);
  }
  const storage = new D1Storage(env.DB, 'uscp');
  const written: Record<string, number> = {};
  for (const [signal, packets] of bySignal) {
    const cellId = USCP_CELL_PREFIX + signal;
    try {
      // Cells are latest-wins per key: create the row on first sight.
      await env.DB
        .prepare(`INSERT OR IGNORE INTO cells (id, sheet_id, kind, value, value_type, t, author, created_at, updated_at)
                  VALUES (?, ?, 'value', '{}', 'object', 0, 'uscp', strftime('%s','now')*1000, strftime('%s','now')*1000)`)
        .bind(cellId, USCP_SHEET)
        .run();
      const prev = await storage.getValue(USCP_SHEET, cellId);
      const merged = mergeTelemetry((prev?.value as TelemetryCell) ?? null, packets);
      await storage.setValue(USCP_SHEET, cellId, merged, merged.t, 'uscp');
      written[signal] = packets.length;
    } catch (e: any) {
      // One bad key never fails the whole batch.
      console.error(`uscp write failed for ${signal}: ${e?.message}`);
    }
  }
  return json({ ok: true, source: v.source!, accepted: v.packets!.length, written });
}

async function loadYardSignals(env: Env): Promise<YardSignal[]> {
  try {
    const storage = new D1Storage(env.DB, AUTHOR);
    const { cells } = await storage.load(USCP_SHEET);
    return cells
      .filter((c) => c.id.startsWith(USCP_CELL_PREFIX))
      .map((c) => {
        const v = c.value as TelemetryCell;
        return { signal: c.id.slice(USCP_CELL_PREFIX.length), count: v?.count ?? 0, last: v?.last ?? {}, t: v?.t ?? 0 };
      })
      .filter((y) => y.count > 0)
      .sort((a, b) => b.count - a.count);
  } catch {
    return []; // telemetry sheet absent: the yard is simply quiet — never break the lobby
  }
}

async function handleUscpGet(env: Env): Promise<Response> {
  const yard = await loadYardSignals(env);
  return json({ ok: true, yard });
}

async function handleIndex(req: Request, env: Env, sheet: 'papers' | 'writings'): Promise<Response> {
  try {
    const storage = new D1Storage(env.DB, AUTHOR);
    const hit = await storage.getValue(sheet, `${sheet}.index`);
    const cell = hit?.value as IndexCell | undefined;
    if (!cell || !cell.body) throw new Error('index cell missing');
    return html(renderIndex(cell), 'public, max-age=300');
  } catch (e: any) {
    console.error(`${sheet} index fell back to static: ${e?.message}`);
    return env.ASSETS.fetch(req);
  }
}

async function handleDoc(req: Request, env: Env, sheet: 'papers' | 'writings', rawSlug: string): Promise<Response> {
  let slug = rawSlug.replace(/\/+$/, '');
  const hm = slug.match(HTML_RE);
  if (hm) slug = hm[1];
  if (slug === 'index') return handleIndex(req, env, sheet);
  if (!SLUG_RE.test(slug)) return env.ASSETS.fetch(req);
  try {
    const storage = new D1Storage(env.DB, AUTHOR);
    const hit = await storage.getValue(sheet, `${sheet === 'papers' ? 'paper' : 'writing'}.${slug}`);
    const cell = hit?.value as DocCell | undefined;
    if (!cell || !cell.body) throw new Error('doc cell missing');
    return html(renderDoc(cell), 'public, max-age=300');
  } catch (e: any) {
    console.error(`${sheet}/${slug} fell back to static: ${e?.message}`);
    return env.ASSETS.fetch(req);
  }
}
