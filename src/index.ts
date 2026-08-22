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
import { page, renderDoc, renderIndex, renderLobby, type DocCell, type IndexCell, type CardCell } from './render';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  QUILT_SEED_KEY?: string;
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
    const totalSafe = total ?? (typeof pieces === 'number' && typeof trails === 'number' ? pieces + trails : 0);

    if (typeof greeting !== 'string' || !Array.isArray(cardOrder)) {
      throw new Error('lobby sheet incomplete');
    }
    const cards: CardCell[] = [];
    for (const id of cardOrder) {
      const c = value(id) as CardCell | undefined;
      if (c && c.href) cards.push(c);
    }
    const body = renderLobby(greeting, cards, pieces ?? 0, trails ?? 0, totalSafe);
    return html(body, 'no-cache');
  } catch (e: any) {
    console.error(`lobby fell back to static: ${e?.message}`);
    return env.ASSETS.fetch(req);
  }
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
