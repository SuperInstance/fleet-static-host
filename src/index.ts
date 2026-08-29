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

  return json({ ok: true, query: q, count: results.length, results });
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
