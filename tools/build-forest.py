#!/usr/bin/env python3
"""
THE FOREST LANE — graph builder
================================
Topology-augmented recall over the canon. Builds a chunk graph on top of the
existing Vectorize index `ai-writings-canon` (bge-m3, 1024-dim, cosine):

  * NODES = chunks, chunked IDENTICALLY to the canon insert (recovered from
    the original /tmp/vectorize-canon.py: \\n{3,}→\\n\\n, paragraph-accumulate
    <1200 chars, overflow paragraph [:2400]) so node ids match canon ids:
      id = relpath.replace('/','__') + '::' + chunk   (truncated [:96])
  * EDGES (D1 table forest_edges(src,dst,kind,weight)):
      'ref'  — markdown links/wikilinks between corpus files; every chunk of
               the source links every chunk of the target (weight 1.0)
      'near' — per chunk, top-3 cosine neighbors above 0.6 across the whole
               corpus, resolved by batch-querying the live Vectorize index
               (weight = cosine similarity)

Deterministic: files sorted, chunks in order, neighbors score-desc.
Writes forest-nodes.sql / forest-edges.sql for `wrangler d1 execute --remote`
plus a stats log to tools/forest-build.log.
"""

import json
import os
import re
import sys
import time
import urllib.request

ACCOUNT = "049ff5e84ecf636b53b162cbb580aae6"
INDEX = "ai-writings-canon"
CORPUS = "/home/eileen/projects/ai-writings"
CURATED_DIRS = ["papers", "seed-canon", "zkcanvas-visions", "doctrine", "research", "identity", "docs"]

EMBED_BATCH = 32
NEAR_TOP_K = 3
NEAR_MIN_SIM = 0.6
QUERY_TOPK = 10          # includes self + v2:: duplicates; deduped below
TEXT_CAP_D1 = 2000        # text stored in D1 for walk display


def token():
    cfg = os.path.expanduser("~/.wrangler/config/default.toml")
    m = re.search(r'oauth_token = "([^"]+)"', open(cfg).read())
    return m.group(1)


T = token()


def api(url, payload, tries=5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, data=json.dumps(payload).encode(),
                headers={"Authorization": f"Bearer {T}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"api failed after {tries} tries: {url}: {last}")


def ai_embed(texts):
    d = api(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/run/@cf/baai/bge-m3",
            {"text": texts})
    if not d.get("success"):
        raise RuntimeError(str(d)[:300])
    return d["result"]["data"]


def vquery(vec):
    d = api(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/vectorize/v2/indexes/{INDEX}/query",
            {"vector": vec, "topK": QUERY_TOPK, "returnMetadata": "all"})
    if not d.get("success"):
        raise RuntimeError(str(d)[:300])
    return d["result"]["matches"]


# ── chunking: byte-identical to the canon insert ─────────────────────────
def chunks_of(path):
    txt = open(path, encoding="utf-8", errors="replace").read()
    txt = re.sub(r'\n{3,}', '\n\n', txt).strip()
    if not txt:
        return []
    parts, cur = [], ""
    for p in txt.split("\n\n"):
        if len(cur) + len(p) < 1200:
            cur = (cur + "\n\n" + p).strip()
        else:
            if cur:
                parts.append(cur)
            cur = p[:2400]
    if cur:
        parts.append(cur)
    return parts


def node_id(rel, i):
    return f"{rel}::{i}".replace("/", "__")[:96]


# ── corpus ────────────────────────────────────────────────────────────────
def corpus_files():
    files = []
    for d in CURATED_DIRS:
        base = os.path.join(CORPUS, d)
        for root, dirs, names in os.walk(base):
            dirs[:] = sorted(x for x in dirs if x != ".git")
            for n in sorted(names):
                if n.endswith(".md"):
                    files.append(os.path.join(root, n))
    return sorted(files)


# ── ref-edge extraction: markdown links + wikilinks ──────────────────────
MD_LINK = re.compile(r'\[[^\]]*\]\(([^)\s]+)[^)]*\)')
WIKI_LINK = re.compile(r'\[\[([^\]|]+)(?:\|[^\]]*)?\]\]')


def resolve_targets(src_rel, content, fileset):
    """Relative md links and [[wikilinks]] that land inside the corpus."""
    out = set()
    src_dir = os.path.dirname(src_rel)
    for m in MD_LINK.finditer(content):
        href = m.group(1).split("#")[0].strip()
        if not href or href.startswith(("http://", "https://", "mailto:", "/")):
            continue
        cand = os.path.normpath(os.path.join(src_dir, href))
        if cand in fileset:
            out.add(cand)
        elif not cand.endswith(".md") and (cand + ".md") in fileset:
            out.add(cand + ".md")
    for m in WIKI_LINK.finditer(content):
        name = m.group(1).strip()
        if not name:
            continue
        if "/" not in name:
            # bare wikilink: match any corpus file with that stem
            stem = name[:-3] if name.endswith(".md") else name
            hits = [f for f in fileset if os.path.basename(f)[:-3] == stem]
            for h in hits[:3]:
                if h != src_rel:
                    out.add(h)
            continue
        cand = os.path.normpath(name)
        if cand in fileset and cand != src_rel:
            out.add(cand)
    out.discard(src_rel)
    return out


# ── SQL emit ──────────────────────────────────────────────────────────────
def sq(s):
    return s.replace("'", "''")


def main():
    t0 = time.time()
    log = lambda *a: print(*a, flush=True)

    files = corpus_files()
    nodes = []  # {id, path, chunk, text, full}
    chunks_by_file = {}
    fileset = set()
    for f in files:
        rel = os.path.relpath(f, CORPUS)
        fileset.add(rel)
    for f in files:
        rel = os.path.relpath(f, CORPUS)
        ch = chunks_of(f)
        chunks_by_file[rel] = ch
        for i, c in enumerate(ch):
            nodes.append({"id": node_id(rel, i), "path": rel, "chunk": i,
                          "text": c[:TEXT_CAP_D1], "full": c[:4000]})
    log(f"[nodes] {len(files)} files -> {len(nodes)} chunks")

    # ── ref edges ─────────────────────────────────────────────────────────
    ref_edges = []
    linked_pairs = 0
    for f in files:
        rel = os.path.relpath(f, CORPUS)
        content = open(f, encoding="utf-8", errors="replace").read()
        for tgt in sorted(resolve_targets(rel, content, fileset)):
            linked_pairs += 1
            for i in range(len(chunks_by_file[rel])):
                for j in range(len(chunks_by_file[tgt])):
                    ref_edges.append((node_id(rel, i), node_id(tgt, j), 1.0))
    log(f"[ref] {linked_pairs} file links -> {len(ref_edges)} chunk edges")

    # ── embed all chunks ──────────────────────────────────────────────────
    log(f"[embed] {len(nodes)} chunks in batches of {EMBED_BATCH}")
    vecs = [None] * len(nodes)
    for s in range(0, len(nodes), EMBED_BATCH):
        batch = nodes[s:s + EMBED_BATCH]
        embs = ai_embed([n["full"] for n in batch])
        for k, e in enumerate(embs):
            vecs[s + k] = e
        if (s // EMBED_BATCH) % 10 == 0:
            log(f"  embedded {s + len(batch)}/{len(nodes)} ({time.time()-t0:.0f}s)")
        time.sleep(0.25)
    assert all(v is not None and len(v) == 1024 for v in vecs)
    log(f"[embed] done ({time.time()-t0:.0f}s)")

    # ── near edges: query the live index per chunk ────────────────────────
    near_edges = []
    missing_from_index = 0
    for idx, n in enumerate(nodes):
        matches = vquery(vecs[idx])
        # dedupe by (path, chunk); prefer path-style canonical ids
        best = {}
        for m in matches:
            md = m.get("metadata") or {}
            p, c = md.get("path"), md.get("chunk")
            if p is None or c is None:
                continue
            key = (p, c)
            if key not in best or m["score"] > best[key]:
                best[key] = m["score"]
        if (n["path"], n["chunk"]) not in best:
            missing_from_index += 1
        neigh = []
        for (p, c), score in best.items():
            if (p, c) == (n["path"], n["chunk"]):
                continue
            if score > NEAR_MIN_SIM:
                neigh.append((node_id(p, c), score))
        neigh.sort(key=lambda x: -x[1])
        for dst, score in neigh[:NEAR_TOP_K]:
            near_edges.append((n["id"], dst, round(score, 4)))
        if idx % 200 == 0:
            log(f"  queried {idx}/{len(nodes)} ({time.time()-t0:.0f}s) near so far {len(near_edges)}")
    log(f"[near] {len(near_edges)} edges (top-{NEAR_TOP_K} > {NEAR_MIN_SIM}); "
        f"{missing_from_index} chunks not self-found in index")

    # ── SQL emit ──────────────────────────────────────────────────────────
    outdir = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(outdir, "forest-nodes.sql"), "w") as f:
        f.write("DELETE FROM forest_nodes;\n")
        for n in nodes:
            f.write(f"INSERT INTO forest_nodes (id, path, chunk, text) VALUES "
                    f"('{sq(n['id'])}', '{sq(n['path'])}', {n['chunk']}, '{sq(n['text'])}');\n")
    all_edges = [(s, d, "ref", w) for s, d, w in ref_edges] + \
                [(s, d, "near", w) for s, d, w in near_edges]
    with open(os.path.join(outdir, "forest-edges.sql"), "w") as f:
        f.write("DELETE FROM forest_edges;\n")
        for s, d, k, w in all_edges:
            f.write(f"INSERT INTO forest_edges (src, dst, kind, weight) VALUES "
                    f"('{sq(s)}', '{sq(d)}', '{k}', {w});\n")
    dt = time.time() - t0
    stats = {
        "files": len(files), "nodes": len(nodes),
        "ref_edges": len(ref_edges), "ref_file_links": linked_pairs,
        "near_edges": len(near_edges), "missing_from_index": missing_from_index,
        "build_seconds": round(dt, 1),
    }
    log("[stats] " + json.dumps(stats))
    with open(os.path.join(outdir, "forest-build.log"), "a") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%S") + " " + json.dumps(stats) + "\n")


if __name__ == "__main__":
    main()
