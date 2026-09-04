# fleet-static-host

One Cloudflare Worker for the fleet's public shelf — **static builds ride assets,
content rides quilt**. Live at `fleet-static-host.casey-digennaro.workers.dev`.

| Path | What | Backend |
|------|------|---------|
| `/scrap/` | **Scrapcraft** — the scrapyard sandbox that teaches embedded engineering | assets tier — a build, not content |
| `/mist/` | **MIST — Tale of a Sheepdog Puppy** (playable static export) | assets tier — a build, not content |
| `/ternary/` | **Ternary ROM** interactive visualizer | assets tier — a build, not content |
| `/papers/` | 7 SuperInstance research papers (KaTeX math) | **quilt cells in D1** |
| `/writings/` | 24 verbatim pieces from the agent-writings archive | **quilt cells in D1** |
| `/` | Lobby index + this week's **trails** (verdicts, misses included) | **quilt cells in D1** (live-rendered) |
| `/api/quilt/*` | The quilt backend, inspectable over HTTP | D1 |

## The split, honestly

**Static builds ride assets; content rides quilt.**

- `/scrap`, `/mist` and `/ternary` are *build artifacts* — compiled game exports and app
  bundles. They belong on Cloudflare's asset tier: free, cacheable, no Worker
  invocation per hit. They never touch the Worker.
- `/papers`, `/writings`, and the lobby are *content* — words someone wrote.
  Every document is a **quilt cell** (`paper.<slug>`, `writing.<slug>`) in a
  **quilt sheet** (`papers`, `writings`, `lobby`), persisted in the D1 database
  `quilt-fleet-db` through quilt-cloudflare's `D1Storage`, and read through the
  vendored quilt engine at request time. The **trails log** on the lobby is
  content too — sheet `trails`, one cell per entry (`trail.<slug>` + `trails.index`
  ordering + `trails.note` doctrine) — because trails, verdicts, and negative
  results are first-class content: the tapestry is only visible when failed
  trails stay on the wall. A tiny render layer (`src/render.ts`)
  keeps the original typography **byte-for-byte** — all 31 documents render
  identically to the previous static builds (verified by md5 on every URL).
- The old static `public/papers` + `public/writings` + `index.html` remain
  deployed as a **cold fallback**: if D1 ever misses or errors, the Worker
  serves the asset copy instead. No link rot is possible — `/papers/<slug>` and
  `/writings/<slug>` URLs are unchanged (superinstance.ai and luciddreamer
  links keep working).

> **Update 2026-09-03 (audit round 16):** re-verified by re-run — `npm test` 34/34,
> vendored `src/quilt.ts` re-diffed against upstream `src/worker.ts` @ `3c293f6`
> (pure removals: entrypoint/MCP demo only, zero additions), live endpoints all
> healthy (incl. `/mcp` POST → auth challenge as designed, `/ai/tts` + `/ai/embed`
> POST-routed). One drift found: live D1 now carries a **fifth sheet, `telemetry`**
> (single cell `uscp.block_mined`, from the USCP work) — not in the sheet list
> above and not read by any public page. Booked here rather than rewriting the
> original shelf-split story.

> **Update 2026-09-03 (audit round 6):** `run_worker_first` has since grown —
> `/ai/embed`, `/ai/tts`, `/canon/search`, `/forest/search`, `/mcp` and
> `/.well-known/mcp` are also Worker-routed now (see `wrangler.jsonc`). The
> Worker is no longer just the content shelf: it also hosts the canon/forest
> search surfaces, an MCP JSON-RPC bridge (`src/mcp.ts`, `/mcp`), TTS via the
> AI binding (`POST /ai/tts`), and USCP tooling (`src/uscp.ts`). Those live in
> the repo; the split described above still holds for the original shelf.

## The quilt engine

Vendored verbatim in `src/quilt.ts` from
[`SuperInstance/quilt-cloudflare`](../quilt-cloudflare) @ `3c293f6`
(2026-08-20) — the upstream repo is untouched. The package isn't on npm, so the
engine library classes (`QuiltEngine`, `D1Storage`, `parseSheet`, …) were
copied with attribution; only upstream's own Worker entrypoint/MCP demo was
left out (this Worker has its own).

### What's quilt-backed vs shimmed (honest notes)

- **Value cells, sheets, edges, history, writes, cascade** — run on the
  vendored engine verbatim. Every cell write goes through `engine.set()`:
  Lamport clock, D1 persist, history row.
- **Formula cells** — quilt's `evalFormula` uses `new Function`, which the
  Workers runtime blocks at request time ("Code generation from strings
  disallowed for this context"; `/api/quilt/health` reports this live). The
  lobby's `lobby.total` formula (`lobby.pieces + lobby.trails + lobby.log`) is therefore
  evaluated by a small safe arithmetic parser in `src/index.ts`
  (`safeEvalArithmetic`) with the same cell-identifier semantics. This is the
  one place quilt's edge story needed a shim — flagged here rather than hidden.
- **Markdown → HTML** happens at *seed time* via the original Python pipeline
  (`build_site.py`, `python3-markdown`, math-protected for KaTeX), so cell
  values hold rendered bodies and typography parity is exact by construction.

## Reactive demo (the backend is alive, not just a renderer)

```sh
BASE=https://fleet-static-host.casey-digennaro.workers.dev

# See every cell in every sheet
curl -s $BASE/api/quilt/cells | head

# Live-edit the lobby greeting (public writes: lobby.* only, ≤400 chars)
curl -s -X POST $BASE/api/quilt/set/lobby/lobby.greeting \
  -H 'Content-Type: application/json' \
  -d '{"value":"Hello from a quilt cell."}'
curl -s $BASE/ | grep Hello          # the lobby changed — no deploy

# Bump a count cell; the lobby.total formula follows on next request
curl -s -X POST $BASE/api/quilt/set/lobby/lobby.trails \
  -H 'Content-Type: application/json' -d '{"value":5}'

# The Lamport-timestamped history of every change
curl -s $BASE/api/quilt/history/lobby/lobby.greeting

# Runtime diagnostics (D1 reachable? dynamic eval allowed?)
curl -s $BASE/api/quilt/health
```

Writes outside `lobby.*` (and all sheet (re)seeds) require `X-Quilt-Key`
matching the `QUILT_SEED_KEY` Worker secret.

## Layout

```
src/
  index.ts       Worker: routing (worker-first for content), quilt reads/writes, API, assets fallback
  quilt.ts       vendored quilt-cloudflare engine @ 3c293f6 (verbatim, attributed — re-verified by diff, audit r6)
  render.ts      render layer: original CSS/template port + quilt-rendered lobby + trails log
  mcp.ts         MCP JSON-RPC 2.0 bridge at /mcp (see tools/MCP-BRIDGE.md; tests in tests/mcp.test.mjs)
  uscp.ts        USCP tooling (tests in tests/uscp.test.mjs)
migrations/
  0001_quilt_schema.sql   quilt's D1 schema (cells, edges, history, listeners, ai_usage)
  0002..0006_*.sql        forest walks, sessions, refresh, MCP audit tables
seed/
  build_seed.py  markdown -> quilt Sheet JSON (reuses build_site.py's pipeline exactly);
                 the trails sheet is built from build_site.py's TRAIL_LOG (single source)
  push.sh        POSTs sheets to /api/quilt/sheet (needs QUILT_SEED_KEY)
  sheets/        generated Sheet JSON (committed so re-seeding needs no Python)
public/          assets: scrap/, mist/, ternary/ (builds) + papers/, writings/, index.html, 404.html (cold fallback)
                 + canon/, forest/, demos/, openmic/, ops/, quilt/ (added after the shelf split)
tools/           forest builder + Hebbian notes, MCP bridge docs, canon dedupe/embed QC
build_site.py    original static builder — markdown pipeline + fallback generator + TRAIL_LOG
wrangler.jsonc   main + D1 binding (quilt-fleet-db) + assets (run_worker_first) + Vectorize (canon)
                 + AI binding + hourly cron
```

## Ops

```sh
# First-time setup (already done):
#   wrangler d1 create quilt-fleet-db
#   wrangler secret put QUILT_SEED_KEY

wrangler d1 migrations apply quilt-fleet-db --remote   # schema
python3 seed/build_seed.py                             # regenerate sheets from sources
QUILT_SEED_KEY=… bash seed/push.sh                     # seed cells (idempotent, INSERT OR REPLACE)
npx wrangler deploy
```

Re-seeding after editing sources: `build_seed.py` → `push.sh` (sheets are
replaced wholesale; history of past writes is preserved in the `history` table).
Content changes propagate within `max-age=300` on doc pages; the lobby is
`no-cache` (always current).

## Sources

- Game: `mist-game/out` (static export; a fix lane rebuilds it with basePath /mist)
- Scrapcraft: `Scrapcraft/dist` (static export; deploy is copy into `public/scrap/` + `npx wrangler deploy`)
- Ternary: `ternary-rom/web`
- Papers: `si-papers-new/papers`
- Writings: `agent-writings-archive/ai-writings-additions/extracted`
- Trails log entries: `build_site.py` `TRAIL_LOG` — each entry links its repo/story
- Engine: `quilt-cloudflare` (vendored; upstream untouched)
