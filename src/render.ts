// =============================================================================
//  render.ts — the small render layer that keeps the current typography.
// =============================================================================
//  CSS, the KaTeX includes, the footer, and the page() template are a faithful
//  port of build_site.py (same bytes in the output HTML). Content arrives as
//  quilt cell values rendered at seed time by the very same Python markdown
//  pipeline, so /papers/<slug> and /writings/<slug> pages stay byte-identical
//  with the static builds that superinstance.ai and luciddreamer already link.
// =============================================================================

export function escapeHtml(s: string): string {
  // Mirrors Python html.escape(s, quote=True)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const CSS = `
:root {
  --navy-deep: #0d1b2e;
  --navy: #16283f;
  --navy-soft: #24405e;
  --amber: #d97706;
  --amber-deep: #b45309;
  --paper: #faf7f1;
  --paper-warm: #f3eee4;
  --ink: #22303f;
  --ink-soft: #5b6b7c;
  --rule: #e2dbcd;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: Georgia, 'Times New Roman', serif;
  background: var(--paper);
  color: var(--ink);
  line-height: 1.7;
  font-size: 1.06rem;
}
a { color: var(--amber-deep); text-decoration: none; }
a:hover { color: var(--amber); text-decoration: underline; }

/* ---- header band ---- */
.band {
  background: linear-gradient(160deg, var(--navy-deep) 0%, var(--navy) 55%, #1c3450 100%);
  color: #f2ede3;
  border-bottom: 3px solid var(--amber);
}
.band-inner {
  max-width: 62rem; margin: 0 auto; padding: 2.6rem 1.4rem 2.2rem;
}
.crumbs {
  font-family: Georgia, serif; font-size: 0.85rem; letter-spacing: 0.14em;
  text-transform: uppercase; color: #9db3c9; margin-bottom: 0.9rem;
}
.crumbs a { color: #cbb58a; }
.band h1 {
  font-weight: normal; font-size: 2.1rem; line-height: 1.25; letter-spacing: 0.01em;
}
.band h1 em { font-style: italic; color: #e8c37e; }
.band .subtitle { color: #b8c8d9; margin-top: 0.6rem; font-style: italic; }

/* ---- document body ---- */
.doc {
  max-width: 44rem; margin: 0 auto; padding: 3rem 1.4rem 4.5rem;
}
.doc h2 {
  font-weight: normal; font-size: 1.55rem; color: var(--navy);
  margin: 2.6rem 0 0.9rem; line-height: 1.3;
  border-bottom: 1px solid #e6dfd2; padding-bottom: 0.35rem;
}
.doc h3 { font-weight: normal; font-size: 1.22rem; color: var(--navy-soft); margin: 2rem 0 0.6rem; }
.doc h4 { font-size: 1.05rem; color: var(--navy-soft); margin: 1.6rem 0 0.5rem; font-style: italic; font-weight: normal; }
.doc p { margin: 0 0 1.15rem; }
.doc ul, .doc ol { margin: 0 0 1.2rem 1.6rem; }
.doc li { margin-bottom: 0.4rem; }
.doc blockquote {
  margin: 1.4rem 0; padding: 0.7rem 1.3rem; border-left: 3px solid var(--amber);
  background: var(--paper-warm); color: #43525f; font-style: italic;
}
.doc blockquote p { margin-bottom: 0.5rem; }
.doc code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.88em; background: #eee7d8; padding: 0.1em 0.35em; border-radius: 3px;
}
.doc pre {
  background: var(--navy-deep); color: #dbe5f0; padding: 1.1rem 1.3rem;
  border-radius: 6px; overflow-x: auto; margin: 1.4rem 0; line-height: 1.5;
}
.doc pre code { background: none; padding: 0; font-size: 0.85rem; color: inherit; }
.doc table {
  border-collapse: collapse; margin: 1.6rem 0; font-size: 0.92rem; width: 100%;
}
.doc th {
  text-align: left; background: var(--navy); color: #ecdfc3;
  padding: 0.5rem 0.8rem; font-weight: normal; letter-spacing: 0.04em;
}
.doc td { border-bottom: 1px solid #e6dfd2; padding: 0.45rem 0.8rem; vertical-align: top; }
.doc tr:nth-child(even) td { background: var(--paper-warm); }
.doc hr { border: none; border-top: 1px solid #e6dfd2; margin: 2.4rem 0; }
.doc strong { color: var(--navy); }
.katex-display { overflow-x: auto; overflow-y: hidden; padding: 0.35rem 0; }

/* ---- metadata block ---- */
.meta {
  background: var(--paper-warm); border: 1px solid #e6dfd2; border-left: 3px solid var(--amber);
  padding: 1rem 1.3rem; margin: 0 0 2.2rem; font-size: 0.92rem; color: var(--ink-soft);
}
.meta p { margin: 0; }
.meta strong { color: var(--navy); font-style: italic; }

/* ---- index (directory) pages ---- */
.listing { max-width: 62rem; margin: 0 auto; padding: 2.8rem 1.4rem 4.5rem; }
.listing h2 {
  font-weight: normal; font-size: 1.4rem; color: var(--navy);
  margin: 2.4rem 0 0.4rem; letter-spacing: 0.02em;
}
.listing .groupnote { color: var(--ink-soft); font-style: italic; margin-bottom: 1rem; font-size: 0.95rem; }
.entry {
  display: block; padding: 1rem 1.2rem; margin: 0 0 0.65rem;
  border: 1px solid #e6dfd2; background: #fffdf8; border-radius: 6px;
  transition: border-color 0.15s, transform 0.15s;
}
.entry:hover { border-color: var(--amber); transform: translateX(3px); text-decoration: none; }
.entry .num {
  font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--amber-deep); display: block; margin-bottom: 0.2rem;
}
.entry .title { font-size: 1.12rem; color: var(--navy); }
.entry:hover .title { color: var(--amber-deep); }
.entry .desc { color: var(--ink-soft); font-size: 0.92rem; margin-top: 0.25rem; font-style: italic; }

/* ---- root cards ---- */
.lobby { max-width: 62rem; margin: 0 auto; padding: 3rem 1.4rem 4.5rem; }
.lobby .lede { max-width: 40rem; color: var(--ink-soft); font-style: italic; margin-bottom: 2.2rem; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: 1.1rem; }
.card {
  display: block; background: var(--navy-deep); color: #e9e2d3;
  border-radius: 8px; padding: 1.6rem 1.5rem 1.4rem; border: 1px solid #27425f;
  border-top: 3px solid var(--amber); min-height: 11rem;
  transition: transform 0.15s, border-color 0.15s;
}
.card:hover { transform: translateY(-4px); border-color: var(--amber); text-decoration: none; }
.card .kicker {
  font-size: 0.75rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: #cbb58a; margin-bottom: 0.5rem; display: block;
}
.card .name { font-size: 1.45rem; color: #f4ead2; display: block; margin-bottom: 0.5rem; }
.card .blurb { font-size: 0.92rem; color: #a9bccf; line-height: 1.55; font-style: italic; }

/* ---- footer ---- */
.foot {
  border-top: 1px solid #e6dfd2; color: var(--ink-soft); font-size: 0.85rem;
  font-style: italic; text-align: center; padding: 1.6rem 1rem 2rem;
  background: var(--paper-warm);
}
.foot a { color: var(--amber-deep); }
`;

const KATEX = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script>
  document.addEventListener("DOMContentLoaded", function() {
    if (window.renderMathInElement) {
      renderMathInElement(document.body, {
        delimiters: [
          {left: "$$", right: "$$", display: true},
          {left: "$", right: "$", display: false}
        ],
        throwOnError: false
      });
    }
  });
</script>
`;

const FOOT = `
<div class="foot">
  SuperInstance Fleet &middot; served from the edge by Cloudflare Workers &middot;
  <a href="/">fleet home</a>
</div>
`;

const FAVICON =
  "<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%230d1b2e'/%3E%3Ccircle cx='50' cy='50' r='22' fill='none' stroke='%23d97706' stroke-width='7'/%3E%3Ccircle cx='50' cy='50' r='7' fill='%23d97706'/%3E%3C/svg%3E\">";

/** Faithful port of build_site.py's page() — crumbs are [label, href|null][]. */
export function page(
  title: string,
  subtitle: string,
  crumbs: [string, string | null][] | null,
  body: string,
  math = false,
): string {
  const katex = math ? KATEX : '';
  let crumbHtml = '';
  if (crumbs) {
    const parts: string[] = [];
    for (const [label, href] of crumbs.slice(0, -1)) {
      parts.push(`<a href="${href}">${label}</a>`);
    }
    parts.push(escapeHtml(crumbs[crumbs.length - 1][0]));
    crumbHtml = parts.join(' &rsaquo; ');
  }
  const suffix = crumbHtml ? ' &rsaquo; ' + crumbHtml : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${FAVICON}
<style>${CSS}</style>
${katex}
</head>
<body>
<header class="band">
  <div class="band-inner">
    <div class="crumbs"><a href="/">Fleet</a>${suffix}</div>
    <h1>${subtitle}</h1>
  </div>
</header>
${body}
${FOOT}
</body>
</html>
`;
}

// ============================================================================
//  Doc cells (papers/writings) — value shape produced by seed/build_seed.py
// ============================================================================

export interface DocCell {
  slug: string;
  title: string;
  title_tag: string;
  subtitle: string;
  crumbs: [string, string | null][];
  body: string;
  math: boolean;
}

export function renderDoc(cell: DocCell): string {
  return page(cell.title_tag, cell.subtitle, cell.crumbs, cell.body, cell.math);
}

export interface IndexCell {
  title_tag: string;
  subtitle: string;
  crumbs: [string, string | null][];
  body: string;
}

export function renderIndex(cell: IndexCell): string {
  return page(cell.title_tag, cell.subtitle, cell.crumbs, cell.body, false);
}

// ============================================================================
//  Lobby — rendered live from quilt cells (sheet "lobby")
// ============================================================================

export interface CardCell {
  kicker: string;
  name: string;
  href: string;
  blurb: string;
}

export function renderLobby(
  greeting: string,
  cards: CardCell[],
  piecesCount: number,
  trailsCount: number,
  total: number,
): string {
  const cardHtml = cards
    .map(
      (c) =>
        `<a class="card" href="${c.href}"><span class="kicker">${escapeHtml(c.kicker)}</span>` +
        `<span class="name">${escapeHtml(c.name)}</span><span class="blurb">${escapeHtml(c.blurb)}</span></a>`,
    )
    .join('');
  const quiltLine =
    `<p class="groupnote">Content backend: <strong>quilt</strong> — ${total} documents live as reactive cells in D1 ` +
    `(lobby.pieces ${piecesCount} + lobby.trails ${trailsCount} = <code>lobby.total</code> ${total}, ` +
    `a formula cell recomputed on the edge at every request). Edit cell <code>lobby.greeting</code> via ` +
    `<code>POST /api/quilt/set/lobby/lobby.greeting</code> and watch this page change.</p>`;
  const body = `<div class="lobby">
  <div class="lede">${escapeHtml(greeting)}</div>
  <div class="cards">${cardHtml}</div>
  ${quiltLine}
</div>`;
  return page('Fleet Static Host', 'The Fleet <em>&mdash; everything, one place</em>', null, body);
}
