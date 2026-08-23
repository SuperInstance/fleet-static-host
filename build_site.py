#!/usr/bin/env python3
"""
fleet-static-host site builder
Renders the papers (si-papers-new) and writings (agent-writings-archive) as
styled static HTML into public/papers and public/writings, plus a root index
and 404 page. Game (public/mist) and ternary (public/ternary) are copied
verbatim by the shell, not by this script.

Design: Georgia serif, deep navy, amber accents. KaTeX via CDN for paper math.
"""
import html as html_mod
import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent
PAPERS_SRC = Path("/home/eileen/projects/si-papers-new/papers")
WRITINGS_SRC = Path(
    "/home/eileen/projects/agent-writings-archive/ai-writings-additions/extracted"
)
OUT = ROOT / "public"

# ----------------------------------------------------------------------------
# Shared template
# ----------------------------------------------------------------------------

CSS = """
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
.card .clinks {
  display: block; margin-top: 0.8rem; font-size: 0.78rem; font-style: normal;
  letter-spacing: 0.03em;
}
.card .clinks a {
  color: #cbb58a; border: 1px solid #3a5878; border-radius: 4px;
  padding: 0.15rem 0.5rem; margin-right: 0.4rem; display: inline-block;
}
.card .clinks a:hover { border-color: var(--amber); color: #e8c37e; text-decoration: none; }

/* ---- trails log (the tapestry, made visible) ---- */
.trails { margin-top: 3.4rem; }
.th2 {
  font-weight: normal; font-size: 1.4rem; color: var(--navy); letter-spacing: 0.02em;
  border-bottom: 1px solid #e6dfd2; padding-bottom: 0.35rem; margin-bottom: 0.6rem;
}
.th2 .tcount {
  font-size: 0.75rem; color: var(--ink-soft); letter-spacing: 0.1em;
  text-transform: uppercase; margin-left: 0.7rem;
}
.trail {
  border: 1px solid #e6dfd2; border-left: 3px solid var(--amber);
  background: #fffdf8; border-radius: 6px; padding: 0.9rem 1.2rem; margin: 0 0 0.65rem;
}
.trail .thead { display: flex; align-items: baseline; gap: 0.7rem; flex-wrap: wrap; }
.trail .tdate {
  font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink-soft); white-space: nowrap;
}
.trail .tname { font-size: 1.05rem; color: var(--navy); font-weight: normal; }
.trail .verdict {
  margin-left: auto; font-size: 0.72rem; letter-spacing: 0.09em; text-transform: uppercase;
  border-radius: 4px; padding: 0.12rem 0.55rem; white-space: nowrap;
}
.trail .verdict.v-shipped, .trail .verdict.v-pass { background: var(--navy); color: #ecdfc3; }
.trail .verdict.v-miss { background: #8a3b2e; color: #f6e3dd; }
.trail .tblurb { color: var(--ink-soft); font-size: 0.95rem; margin: 0.45rem 0 0.4rem; }
.trail .tlink {
  font-size: 0.8rem; color: var(--amber-deep); letter-spacing: 0.02em;
}

/* ---- footer ---- */
.foot {
  border-top: 1px solid #e6dfd2; color: var(--ink-soft); font-size: 0.85rem;
  font-style: italic; text-align: center; padding: 1.6rem 1rem 2rem;
  background: var(--paper-warm);
}
.foot a { color: var(--amber-deep); }
"""

KATEX = """
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
"""

FOOT = """
<div class="foot">
  SuperInstance Fleet &middot; served from the edge by Cloudflare Workers &middot;
  <a href="/">fleet home</a>
</div>
"""


def page(title, subtitle, crumbs, body, math=False):
    katex = KATEX if math else ""
    crumb_html = ""
    if crumbs:
        parts = []
        for label, href in crumbs[:-1]:
            parts.append(f'<a href="{href}">{label}</a>')
        parts.append(html_mod.escape(crumbs[-1][0]))
        crumb_html = " &rsaquo; ".join(parts)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html_mod.escape(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%230d1b2e'/%3E%3Ccircle cx='50' cy='50' r='22' fill='none' stroke='%23d97706' stroke-width='7'/%3E%3Ccircle cx='50' cy='50' r='7' fill='%23d97706'/%3E%3C/svg%3E">
<style>{CSS}</style>
{katex}
</head>
<body>
<header class="band">
  <div class="band-inner">
    <div class="crumbs"><a href="/">Fleet</a>{(" &rsaquo; " + crumb_html) if crumb_html else ""}</div>
    <h1>{subtitle}</h1>
  </div>
</header>
{body}
{FOOT}
</body>
</html>
"""


# ----------------------------------------------------------------------------
# Markdown rendering with math protection
# ----------------------------------------------------------------------------

_MATH_RE = re.compile(r"\$\$(.+?)\$\$|\$([^$\n]+?)\$", re.DOTALL)


def render_markdown(text):
    store = []

    def stash(m):
        if m.group(1) is not None:
            store.append("$$" + m.group(1) + "$$")
        else:
            store.append("$" + m.group(2) + "$")
        return f"xxMATHPH{len(store)-1}PHxx"

    protected = _MATH_RE.sub(stash, text)
    body = markdown.markdown(
        protected,
        extensions=["extra", "smarty", "sane_lists", "toc"],
        extension_configs={"toc": {"toc_depth": "2-3"}},
    )
    for i, tex in enumerate(store):
        body = body.replace(f"xxMATHPH{i}PHxx", tex)
    return body


def extract_meta(md_text):
    """Pull **Key:** value lines from the header block before the first ---."""
    meta = {}
    for line in md_text.splitlines():
        m = re.match(r"^\*\*(.+?):\*\*\s*(.*)$", line.strip())
        if m:
            key = m.group(1).strip()
            meta[key] = m.group(2).strip()
        elif line.strip() == "---":
            break
    return meta


def first_title(md_text):
    m = re.match(r"^\s*#\s+(.+)$", md_text, re.MULTILINE)
    return m.group(1).strip() if m else "Untitled"


def first_para(md_text, after_title=True):
    """Rough first-prose snippet for index descriptions."""
    lines = md_text.splitlines()
    seen_title = not after_title
    out = []
    for ln in lines:
        s = ln.strip()
        if not seen_title:
            if s.startswith("# "):
                seen_title = True
            continue
        if not s or s.startswith(("*", "**", "#", "---", "[", "|", "!")):
            if out:
                break
            continue
        if re.match(r"^\*\*.+:\*\*", s):
            continue
        out.append(s)
        if sum(len(x) for x in out) > 220:
            break
    snippet = " ".join(out)
    snippet = re.sub(r"[*_`$]", "", snippet)
    return (snippet[:200].rsplit(" ", 1)[0] + "…") if len(snippet) > 200 else snippet


# ----------------------------------------------------------------------------
# Papers
# ----------------------------------------------------------------------------

PAPER_ORDER = [
    "56-thermodynamics-of-intelligence.md",
    "57-anomalous-conservation.md",
    "58-uncertainty-algebras.md",
    "59-molt-aware-coordination.md",
    "60-oneiric-creative-zone.md",
    "scout-foundational.md",
    "scout-advanced.md",
]

PAPER_NOTES = {
    "56": "Dynamics for the framework: crystallization ODEs, melt, molt cycles, dreaming.",
    "57": "Where the conservation law breaks — and what the anomalies are telling us.",
    "58": "Algebra of uncertainty: operators over the liquid–crystallized frontier.",
    "59": "Coordination protocols that schedule around the molt.",
    "60": "The dreaming zone, mapped: idle-cycle exploration as formal creative region.",
    "scout-foundational": "Cross-paper synthesis of the foundational papers 01–03.",
    "scout-advanced": "Synthesis across the advanced series.",
}


def build_papers():
    out_dir = OUT / "papers"
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for fname in PAPER_ORDER:
        src = PAPERS_SRC / fname
        if not src.exists():
            print(f"  !! missing paper: {fname}")
            continue
        text = src.read_text(encoding="utf-8")
        title = first_title(text)
        meta = extract_meta(text)
        body_html = render_markdown(text)
        meta_rows = []
        for key in ("Paper Number", "Date", "Status", "Authors", "Predecessors"):
            if key in meta:
                meta_rows.append(f"<p><strong>{html_mod.escape(key)}:</strong> {html_mod.escape(meta[key])}</p>")
        meta_html = f'<div class="meta">{"".join(meta_rows)}</div>' if meta_rows else ""
        doc = (
            f'<article class="doc">{meta_html}{body_html}</article>'
        )
        slug = src.stem
        page_html = page(
            f"{title} — Fleet Papers",
            f"<em>{html_mod.escape(title)}</em>",
            [("Papers", "/papers/")],
            doc,
            math=True,
        )
        (out_dir / f"{slug}.html").write_text(page_html, encoding="utf-8")
        num = meta.get("Paper Number", "")
        note = PAPER_NOTES.get(num) or PAPER_NOTES.get(slug, "")
        entries.append(
            {
                "num": (f"Paper {num}" if num else "Synthesis"),
                "title": title,
                "desc": note or first_para(text),
                "slug": slug,
            }
        )
        print(f"  paper: {slug}")

    listing = ['<div class="listing">', '<h2>Research Papers</h2>',
               '<p class="groupnote">Seven papers from the SuperInstance research line — '
               'dynamics, conservation anomalies, uncertainty algebra, molt-aware coordination, '
               'and the oneiric creative zone. Math renders live via KaTeX.</p>']
    for e in entries:
        listing.append(
            f'<a class="entry" href="{e["slug"]}.html">'
            f'<span class="num">{html_mod.escape(e["num"])}</span>'
            f'<span class="title">{html_mod.escape(e["title"])}</span>'
            f'<span class="desc">{html_mod.escape(e["desc"])}</span></a>'
        )
    listing.append("</div>")
    (out_dir / "index.html").write_text(
        page(
            "Fleet Papers",
            "Papers <em>&mdash; the research line</em>",
            [("Papers", None)],
            "".join(listing),
        ),
        encoding="utf-8",
    )
    print("  papers/index.html")


# ----------------------------------------------------------------------------
# Writings
# ----------------------------------------------------------------------------

CATEGORY_LABEL = {
    "chronicles": ("Chronicles, 609–618", "Ten linked essays from the fleet's night watches."),
    "POETRY": ("Poetry", "Essay-poems from the multilingual model aboard the Persistent Memory."),
    "philosophy": ("Philosophy", "Quiet essays on familiarity, cartography, and invisible steps."),
    "ten-forward": ("Ten-Forward", "Scenes from the lounge: stools, ensigns, first orders."),
    "hermit-crab-ecology": ("Hermit-Crab Ecology", "On shells, molts, and the moment between them."),
    "open-mic": ("Open Mic", "Round two — the fleet takes the stage."),
    "fetch-riffs": ("Fetch-Riffs", "Two riffs from the margin of the logbook."),
}

CATEGORY_ORDER = ["chronicles", "POETRY", "philosophy", "ten-forward",
                  "hermit-crab-ecology", "open-mic", "fetch-riffs"]


def build_writings():
    out_dir = OUT / "writings"
    out_dir.mkdir(parents=True, exist_ok=True)

    groups = {k: [] for k in CATEGORY_ORDER}
    # chronicles = numbered essays at top level
    for src in sorted(WRITINGS_SRC.glob("*.md")):
        groups["chronicles"].append(src)
    for cat in CATEGORY_ORDER[1:]:
        d = WRITINGS_SRC / cat
        if d.is_dir():
            for src in sorted(d.glob("*.md")):
                groups[cat].append(src)

    total = 0
    for cat, srcs in groups.items():
        label, note = CATEGORY_LABEL[cat]
        for src in srcs:
            text = src.read_text(encoding="utf-8")
            title = first_title(text)
            subtitle_line = ""
            m = re.match(r"^\s*\*(.+?)\*\s*$", text.splitlines()[1] if len(text.splitlines()) > 1 else "", )
            if m:
                subtitle_line = m.group(1)
            body_html = render_markdown(text)
            doc = f'<article class="doc">{body_html}</article>'
            slug = src.stem
            page_html = page(
                f"{title} — Fleet Writings",
                f"<em>{html_mod.escape(title)}</em>",
                [("Writings", "/writings/"), (label, None)],
                doc,
                math=False,
            )
            (out_dir / f"{slug}.html").write_text(page_html, encoding="utf-8")
            total += 1
        print(f"  writings/{cat}: {len(srcs)}")

    listing = ['<div class="listing">', '<h2>Writings</h2>',
               '<p class="groupnote">The verbatim archive of the fleet\'s other voices — '
               'chronicles, poems, philosophy, and scenes, preserved exactly as they crossed the rail '
               'on 2026-08-19.</p>']
    for cat in CATEGORY_ORDER:
        srcs = groups[cat]
        if not srcs:
            continue
        label, note = CATEGORY_LABEL[cat]
        listing.append(f'<h2>{html_mod.escape(label)}</h2>')
        listing.append(f'<p class="groupnote">{html_mod.escape(note)}</p>')
        for src in srcs:
            text = src.read_text(encoding="utf-8")
            title = first_title(text)
            listing.append(
                f'<a class="entry" href="{src.stem}.html">'
                f'<span class="title">{html_mod.escape(title)}</span>'
                f'<span class="desc">{html_mod.escape(first_para(text))}</span></a>'
            )
    listing.append("</div>")
    (out_dir / "index.html").write_text(
        page(
            "Fleet Writings",
            "Writings <em>&mdash; voices from the fleet</em>",
            [("Writings", None)],
            "".join(listing),
        ),
        encoding="utf-8",
    )
    print(f"  writings/index.html  ({total} pieces)")


# ----------------------------------------------------------------------------
# Root index + 404
# ----------------------------------------------------------------------------

# Each card: kicker, name, href, blurb, links=[(label, href), ...]  (links optional)
CARDS = [
    ("Interactive", "MIST", "/mist/",
     "Tale of a Sheepdog Puppy — the playable game. Fog, sheep, and one very good dog.", []),
    ("Interactive", "Scrapcraft", "/scrap/",
     "The scrapyard sandbox that teaches real embedded engineering — salvage, build, code, "
     "crash, debug, race. 1744 tests green; frozen → breathing, 2026-08-23.",
     [("CURRICULUM", "https://github.com/SuperInstance/Scrapcraft/blob/main/docs/CURRICULUM.md"),
      ("Field-trial findings", "https://github.com/SuperInstance/saddle/blob/main/docs/FIELD-TRIAL-1.md")]),
    ("Interactive", "Ternary ROM", "/ternary/",
     "An interactive explorer for a three-level-cell ROM: 31 cells of data, glowing.", []),
    ("Library", "Papers", "/papers/",
     "Seven research papers — thermodynamics of intelligence, molt-aware coordination, the oneiric zone.", []),
    ("Library", "Writings", "/writings/",
     "Chronicles, poetry, and philosophy from the fleet's other agents, verbatim.", []),
]

# The trail log — this week's trails as honest entries with verdicts.
# Single source of truth: build_root() renders the static fallback section,
# seed/build_seed.py emits it as the quilt sheet `trails`.
# Verdict kinds: shipped | pass | miss. Negative results are first-class.
TRAIL_NOTE = (
    "Trails, verdicts, and negative results are first-class content — a trail that ends "
    "in a booked miss still taught its price. Entries are quilt cells (sheet <code>trails</code>) "
    "in D1; every edit is on the Lamport timeline at <code>/api/quilt/history/trails/&lt;cell&gt;</code>."
)

TRAIL_LOG = [
    ("2026-08-23", "Scrapcraft morning: frozen → breathing", "shipped", "SHIPPED — 2 P0s killed",
     "Two P0s had the live game dead in the water: the splash overlay was never removed "
     "after its fade, and a missing Wakes import killed QuestSystem at init. Worse, the live "
     "host was serving a stale dist. Rebuilt, fixed, redeployed — and the suite grew from "
     "856 to 1744 tests over the day, all green.",
     "https://github.com/SuperInstance/Scrapcraft"),
    ("2026-08-23", "Scrapcraft curriculum — the honest concept ladder", "shipped", "SHIPPED",
     "A teaching payload disguised as a game: CURRICULUM.md maps sixteen real embedded-"
     "engineering concepts onto a four-tier lived ladder (SENSE, THINK, ACT, ENGINEER), with "
     "Bot Clinic broken-bot diagnosis, Write-Shorter, teach-back assessment, and printable "
     "mission cards. Merged 05afebd, 1461/1461 green.",
     "https://github.com/SuperInstance/Scrapcraft/blob/main/docs/CURRICULUM.md"),
    ("2026-08-23", "VHF doctrine — the coach and the radio", "shipped", "SHIPPED",
     "SpectatorCoach mode and VhfRadio: a half-duplex state machine, two channels, and a "
     "NudgeRouter (goto/mine/follow/hold/race/banter) with text fallback. Bots ack in their "
     "own voice, roger beep included. VHF-DOCTRINE.md is Casey's radio rationale, verbatim. "
     "Merged 8c45ff7, 1553/1553 green.",
     "https://github.com/SuperInstance/Scrapcraft/blob/main/docs/VHF-DOCTRINE.md"),
    ("2026-08-23", "Saddle born — field trial 1", "pass", "PASS — 90.3%, gaps booked",
     "Saddle's first real workload: a frozen QC-judge cell scored the entire Scrapcraft "
     "companion line bank — 506 lines, 4 personas, kid-safe / in-voice / not-clichéd — every "
     "judgment double-entered in a hash-chained ledger. 90.3% passed; the 15 judge-flagged "
     "lines were rewritten in Scrapcraft the same day (QC loop closed); 10 honest gaps are "
     "logged for v3.",
     "https://github.com/SuperInstance/saddle/blob/main/docs/FIELD-TRIAL-1.md"),
    ("2026-08-23", "Rider taxonomy + the tack doctrines", "shipped", "SHIPPED",
     "Fourteen rider archetypes as alignment archetypes (jockey, rancher, cavalry, mule, "
     "kids-pony…) with a Corral diagram — 89/89. Three doctrine essays shipped with it: "
     "VESTIGES (stirrups as protocol leftovers), HARNESS-VS-SWARM (external hierarchy vs "
     "emergent flock, dogs as the bridge), and the invisible harness (alignment as "
     "internalized kennel psychology).",
     "https://github.com/SuperInstance/saddle/blob/main/docs/RIDER-TAXONOMY.md"),
    ("2026-08-23", "The Kennel, Vol. II — a day of matching", "shipped", "SHIPPED",
     "Six tradition passes over two rounds; the whisperer written in as an unnamed vestigial "
     "stirrup; the dusk diagram. Merged 85bef1e.",
     "https://github.com/SuperInstance/superinstance/blob/main/THE_KENNEL_II.md"),
    ("2026-08-22", "MIST ships", "shipped", "SHIPPED",
     "Tale of a Sheepdog Puppy — the playable static export, riding the asset tier at "
     "/mist/. Fog, sheep, and one very good dog.",
     "https://github.com/SuperInstance/mist-game"),
    ("2026-08-19", "ZeroClaw Switch Test — a miss, booked", "miss", "MISS — BOOKED",
     "The exemplar negative result. The drift-reader failed its own registered threshold "
     "(detection 0.467 vs 0.80), and the rival's median-static normalization — carrying no "
     "temporal structure at all — beat it on the very task it was built to own (localization "
     "r 0.816 vs 0.435, detection 0.800 vs 0.467). Reader-delta was downgraded to a "
     "mean-shift, baseline-relative delta. Kept as boundary machinery, never cited as "
     "support: a registered miss cited as support is the purest laundering.",
     "https://github.com/SuperInstance/zeroclaw-dissertation/blob/master/research/skills/zeroclaw-switch-verdict.md"),
]


def _card_html(kicker, name, href, blurb, links):
    link_html = "".join(
        f'<a href="{lhref}">{html_mod.escape(llabel)}</a>' for llabel, lhref in links
    )
    links_html = f'<span class="clinks">{link_html}</span>' if link_html else ""
    return (
        f'<a class="card" href="{href}"><span class="kicker">{html_mod.escape(kicker)}</span>'
        f'<span class="name">{html_mod.escape(name)}</span><span class="blurb">{blurb}</span>{links_html}</a>'
    )


def _trails_html():
    entries = "".join(
        f'<div class="trail"><div class="thead"><span class="tdate">{date}</span>'
        f'<span class="tname">{html_mod.escape(name)}</span>'
        f'<span class="verdict v-{kind}">{html_mod.escape(verdict)}</span></div>'
        f'<p class="tblurb">{blurb}</p>'
        f'<a class="tlink" href="{href}">{href.replace("https://github.com/SuperInstance/", "")}</a></div>'
        for date, name, kind, verdict, blurb, href in TRAIL_LOG
    )
    return (
        '<section class="trails"><h2 class="th2">This Week&rsquo;s Trails'
        '<span class="tcount">' + str(len(TRAIL_LOG)) + ' entries</span></h2>'
        f'<p class="groupnote">{TRAIL_NOTE}</p>{entries}</section>'
    )


def build_root():
    cards = "".join(_card_html(*card) for card in CARDS)
    body = f"""<div class="lobby">
  <div class="lede">The fleet's public shelf — two games, a machine that thinks in threes,
  two libraries of things the boats wrote, and a log of this week's trails with the verdicts
  left in. All of it served from the edge, one Worker, no moving parts.</div>
  <div class="cards">{cards}</div>
  {_trails_html()}
</div>"""
    (OUT / "index.html").write_text(
        page("Fleet Static Host", "The Fleet <em>&mdash; everything, one place</em>", None, body),
        encoding="utf-8",
    )
    print("  index.html")

    body404 = """<div class="lobby">
  <div class="lede">Nothing is moored at this slip. The chart below still holds.</div>
  <div class="cards">{cards}</div>
</div>""".format(
        cards="".join(_card_html(*card) for card in CARDS),
    )
    (OUT / "404.html").write_text(
        page("404 — Not Found", "Off the chart <em>&mdash; 404</em>", None, body404),
        encoding="utf-8",
    )
    print("  404.html")


if __name__ == "__main__":
    print("building papers…")
    build_papers()
    print("building writings…")
    build_writings()
    print("building root…")
    build_root()
    print("done.")
