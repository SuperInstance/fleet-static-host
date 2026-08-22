#!/usr/bin/env python3
"""
seed/build_seed.py — build quilt sheets from the papers/writings sources.

Renders markdown through the SAME pipeline as build_site.py (imported, not
duplicated) so cell bodies are byte-identical with the static builds, then
emits quilt Sheet JSON to seed/sheets/<sheet>.json for seed/push.sh.

Sheets:
  papers   — paper.<slug> doc cells + papers.index
  writings — writing.<slug> doc cells + writings.index
  lobby    — greeting, cards (one cell per trail), counts, and the
             lobby.total formula cell (recomputed on the edge per request).
"""
import html as html_mod
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build_site as bs  # noqa: E402  (the original pipeline — single source of truth)

OUT = ROOT / "seed" / "sheets"


def paper_sheets():
    cells = []
    entries = []
    for fname in bs.PAPER_ORDER:
        src = bs.PAPERS_SRC / fname
        if not src.exists():
            print(f"  !! missing paper: {fname}")
            continue
        text = src.read_text(encoding="utf-8")
        title = bs.first_title(text)
        meta = bs.extract_meta(text)
        body_html = bs.render_markdown(text)
        meta_rows = []
        for key in ("Paper Number", "Date", "Status", "Authors", "Predecessors"):
            if key in meta:
                meta_rows.append(f"<p><strong>{html_mod.escape(key)}:</strong> {html_mod.escape(meta[key])}</p>")
        meta_html = f'<div class="meta">{"".join(meta_rows)}</div>' if meta_rows else ""
        slug = src.stem
        doc = f'<article class="doc">{meta_html}{body_html}</article>'
        cells.append({
            "id": f"paper.{slug}",
            "kind": "value",
            "value": {
                "slug": slug,
                "title": title,
                "title_tag": f"{title} — Fleet Papers",
                "subtitle": f"<em>{html_mod.escape(title)}</em>",
                "crumbs": [["Papers", "/papers/"]],
                "body": doc,
                "math": True,
            },
            "config": {"description": f"Paper: {title}"},
        })
        num = meta.get("Paper Number", "")
        note = bs.PAPER_NOTES.get(num) or bs.PAPER_NOTES.get(slug, "")
        entries.append({
            "num": (f"Paper {num}" if num else "Synthesis"),
            "title": title,
            "desc": note or bs.first_para(text),
            "slug": slug,
        })
        print(f"  paper cell: paper.{slug}")

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
    cells.append({
        "id": "papers.index",
        "kind": "value",
        "value": {
            "title_tag": "Fleet Papers",
            "subtitle": "Papers <em>&mdash; the research line</em>",
            "crumbs": [["Papers", None]],
            "body": "".join(listing),
        },
        "config": {"description": "Papers directory index"},
    })
    return {"id": "papers", "title": "Fleet Papers", "cells": cells}


def writing_sheets():
    cells = []
    groups = {k: [] for k in bs.CATEGORY_ORDER}
    for src in sorted(bs.WRITINGS_SRC.glob("*.md")):
        groups["chronicles"].append(src)
    for cat in bs.CATEGORY_ORDER[1:]:
        d = bs.WRITINGS_SRC / cat
        if d.is_dir():
            for src in sorted(d.glob("*.md")):
                groups[cat].append(src)

    listing = ['<div class="listing">', '<h2>Writings</h2>',
               '<p class="groupnote">The verbatim archive of the fleet\'s other voices — '
               'chronicles, poems, philosophy, and scenes, preserved exactly as they crossed the rail '
               'on 2026-08-19.</p>']
    total = 0
    for cat in bs.CATEGORY_ORDER:
        srcs = groups[cat]
        if not srcs:
            continue
        label, note = bs.CATEGORY_LABEL[cat]
        listing.append(f'<h2>{html_mod.escape(label)}</h2>')
        listing.append(f'<p class="groupnote">{html_mod.escape(note)}</p>')
        for src in srcs:
            text = src.read_text(encoding="utf-8")
            title = bs.first_title(text)
            body_html = bs.render_markdown(text)
            doc = f'<article class="doc">{body_html}</article>'
            slug = src.stem
            cells.append({
                "id": f"writing.{slug}",
                "kind": "value",
                "value": {
                    "slug": slug,
                    "title": title,
                    "title_tag": f"{title} — Fleet Writings",
                    "subtitle": f"<em>{html_mod.escape(title)}</em>",
                    "crumbs": [["Writings", "/writings/"], [label, None]],
                    "body": doc,
                    "math": False,
                },
                "config": {"description": f"Writing ({label}): {title}"},
            })
            listing.append(
                f'<a class="entry" href="{slug}.html">'
                f'<span class="title">{html_mod.escape(title)}</span>'
                f'<span class="desc">{html_mod.escape(bs.first_para(text))}</span></a>'
            )
            total += 1
            print(f"  writing cell: writing.{slug}")
    listing.append("</div>")
    cells.append({
        "id": "writings.index",
        "kind": "value",
        "value": {
            "title_tag": "Fleet Writings",
            "subtitle": "Writings <em>&mdash; voices from the fleet</em>",
            "crumbs": [["Writings", None]],
            "body": "".join(listing),
        },
        "config": {"description": "Writings directory index"},
    })
    print(f"  writings: {total} pieces")
    return {"id": "writings", "title": "Fleet Writings", "cells": cells}


def lobby_sheet(n_papers, n_writings):
    cards = []
    for kicker, name, href, blurb in bs.CARDS:
        key = name.lower().replace(" ", "-")
        cards.append({
            "id": f"lobby.card.{key}",
            "kind": "value",
            "value": {"kicker": kicker, "name": name, "href": href, "blurb": blurb},
            "config": {"description": f"Lobby card: {name}"},
        })
    pieces, trails = n_papers + n_writings, len(bs.CARDS)
    cells = [
        {
            "id": "lobby.greeting",
            "kind": "value",
            "value": ("The fleet's public shelf — a game, a machine that thinks in threes, "
                      "and two libraries of things the boats wrote. All of it served from the edge, "
                      "one Worker, no moving parts."),
            "config": {"description": "Lobby lede — live-editable via POST /api/quilt/set/lobby/lobby.greeting"},
        },
        {
            "id": "lobby.cards",
            "kind": "value",
            "value": [c["id"] for c in cards],
            "config": {"description": "Ordered lobby card cell ids"},
        },
        *cards,
        {"id": "lobby.pieces", "kind": "value", "value": pieces,
         "config": {"description": "Documents in quilt (papers + writings)"}},
        {"id": "lobby.trails", "kind": "value", "value": trails,
         "config": {"description": "Trails on the shelf (cards)"}},
        {"id": "lobby.total", "kind": "formula", "value": pieces + trails,
         "config": {"expr": "lobby.pieces + lobby.trails",
                    "description": "pieces + trails, recomputed on the edge at every request"}},
    ]
    edges = [["lobby.pieces", "lobby.total"], ["lobby.trails", "lobby.total"]]
    print(f"  lobby: {len(cells)} cells (pieces={pieces}, trails={trails}, total={pieces + trails})")
    return {"id": "lobby", "title": "Fleet Lobby", "cells": cells, "edges": edges}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    print("building papers sheet…")
    papers = paper_sheets()
    print("building writings sheet…")
    writings = writing_sheets()
    print("building lobby sheet…")
    n_papers = len([c for c in papers["cells"] if c["id"].startswith("paper.")])
    n_writings = len([c for c in writings["cells"] if c["id"].startswith("writing.")])
    lobby = lobby_sheet(n_papers, n_writings)
    for sheet in (papers, writings, lobby):
        path = OUT / f'{sheet["id"]}.json'
        path.write_text(json.dumps(sheet, ensure_ascii=False), encoding="utf-8")
        kb = path.stat().st_size / 1024
        print(f'  → {path.name}: {len(sheet["cells"])} cells, {kb:.0f} KB')
    print("done.")
