#!/usr/bin/env python3
"""
EMBED-QC — nightly embedding drift check (toolyard #13, engineering lane)
=========================================================================
Samples ~1% of the canon chunks, re-embeds them through the worker's embed
bridge (POST /ai/embed — bindings don't carry rotating tokens), fetches each
chunk's ORIGINAL vector straight from Vectorize (get-by-ids), and compares:

  * self_sim        — cosine(fresh embedding, stored vector). Low means the
                      embedding pipeline itself has drifted (model revision,
                      text truncation, chunking change).
  * neighbor_sim    — cosine(fresh embedding, stored vector of each 'near'
                      neighbor from forest_edges). The build stored top-3
                      neighbors above 0.6; if a chunk no longer clears
                      MIN_SIM against those stored neighbors, its
                      neighborhood has drifted out from under it.

Chunks with self_sim < MIN_SIM or mean neighbor_sim < MIN_SIM are flagged as
drift suspects. Report lands in tools/embed-qc-report.json; a summary prints.
Read-only against Vectorize/D1/the worker — safe to cron:

  0 3 * * *  cd /home/eileen/projects/fleet-static-host && python3 tools/embed-qc.py

Vectorize auth (get-by-ids) still needs the wrangler OAuth token, same as
build-forest.py; the embeddings themselves ride the bridge so the token is
only used for reads. Falls back to the REST AI endpoint if the bridge is
down (the tools pattern from build-forest.py).
"""

import argparse
import json
import math
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

WORKER = "https://fleet-static-host.casey-digennaro.workers.dev"
ACCOUNT = "049ff5e84ecf636b53b162cbb580aae6"
INDEX = "ai-writings-canon"
D1_DB = "19d1d2f3-d6ef-48bb-9475-253f303bfb37"  # quilt-fleet-db (wrangler.jsonc)
CORPUS = "/home/eileen/projects/ai-writings"
CURATED_DIRS = ["papers", "seed-canon", "zkcanvas-visions", "doctrine", "research", "identity", "docs"]

SAMPLE_RATE = 0.01
SAMPLE_SEED = 1337           # deterministic: nightly runs are comparable
MIN_SIM = 0.7                # drift threshold (self and neighbor)
EMBED_BATCH = 32             # bridge caps at 64 texts x 2000 chars
BRIDGE_CHAR_CAP = 2000       # /ai/embed slices text at 2000 chars (tracked, not hidden)
GETBYIDS_BATCH = 20          # API cap: "max id count is 20" (error 40007)
FULL_CAP = 4000              # matches build-forest.py's embedding input


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
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:300]
            last = f"HTTP {e.code}: {body}"
            if e.code < 500:
                raise RuntimeError(f"api rejected {url}: {last}")  # no point retrying a 4xx
        except Exception as e:
            last = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"api failed after {tries} tries: {url}: {last}")


def bridge_embed(texts):
    """POST the deployed worker's /ai/embed — no token needed, by design.
    Custom User-Agent: the edge challenges urllib's default UA with a 403."""
    req = urllib.request.Request(
        WORKER + "/ai/embed", data=json.dumps({"text": texts}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "fleet-embed-qc/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    if not d.get("ok") or not isinstance(d.get("vectors"), list):
        raise RuntimeError(f"bridge returned: {str(d)[:200]}")
    return d["vectors"]


def rest_embed(texts):
    d = api(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/run/@cf/baai/bge-m3",
            {"text": texts})
    if not d.get("success"):
        raise RuntimeError(str(d)[:300])
    return d["result"]["data"]


def embed(texts, via_bridge):
    if via_bridge:
        try:
            return bridge_embed(texts), True
        except Exception as e:
            log(f"[bridge] unreachable ({e}); falling back to REST AI for this run")
            via_bridge = False
    return rest_embed(texts), False


def get_by_ids(ids):
    found = {}
    for s in range(0, len(ids), GETBYIDS_BATCH):
        d = api(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/vectorize/v2/indexes/{INDEX}/get_by_ids",
                {"ids": ids[s:s + GETBYIDS_BATCH]})
        if not d.get("success"):
            raise RuntimeError(str(d)[:300])
        vectors = d["result"].get("vectors", d["result"]) if isinstance(d["result"], dict) else d["result"]
        for v in vectors:
            found[v["id"]] = v.get("values")
    return found


def d1_near_edges():
    """All stored 'near' edges: src -> [dst, ...] (one read-only D1 query)."""
    d = api(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{D1_DB}/query",
            {"sql": "SELECT src, dst FROM forest_edges WHERE kind = 'near'"})
    if not d.get("success"):
        raise RuntimeError(str(d)[:300])
    adj = {}
    for row in d["result"][0]["results"]:
        adj.setdefault(row["src"], []).append(row["dst"])
    return adj


# ── chunking: byte-identical to build-forest.py (ids must match the index) ──
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


def cosine(a, b):
    num = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return num / (na * nb)


log = lambda *a: print(*a, flush=True)


def main():
    ap = argparse.ArgumentParser(description="nightly embed drift QC over the canon")
    ap.add_argument("--rate", type=float, default=SAMPLE_RATE)
    ap.add_argument("--seed", type=int, default=SAMPLE_SEED)
    ap.add_argument("--min-sim", type=float, default=MIN_SIM)
    ap.add_argument("--limit", type=int, default=0, help="cap the sample size (smoke runs)")
    args = ap.parse_args()

    t0 = time.time()
    if not os.path.isdir(CORPUS):
        sys.exit(f"corpus not found: {CORPUS}")

    # 1 — rebuild the chunk list exactly as the index was built
    files = corpus_files()
    chunks = []
    for f in files:
        rel = os.path.relpath(f, CORPUS)
        for i, c in enumerate(chunks_of(f)):
            chunks.append({"id": node_id(rel, i), "path": rel, "chunk": i, "full": c[:FULL_CAP]})
    log(f"[corpus] {len(files)} files -> {len(chunks)} chunks")

    # 2 — deterministic 1% sample
    n = max(1, round(len(chunks) * args.rate))
    if args.limit:
        n = min(n, args.limit)
    rng = random.Random(args.seed)
    sample = rng.sample(chunks, n)
    log(f"[sample] {n} chunks ({args.rate:.0%}, seed {args.seed})")

    # 3 — stored near-neighbors for the sample (one D1 read)
    try:
        adj = d1_near_edges()
        log(f"[neighbors] {sum(len(v) for v in adj.values())} near edges loaded from D1")
    except Exception as e:
        log(f"[neighbors] D1 read failed ({e}) — neighbor check skipped, self-sim only")
        adj = {}

    # 4 — fetch original vectors: sampled ids + their stored neighbors.
    # Vectorize ids are capped at 64 bytes; forest node ids run to 96, so the
    # over-cap ones simply cannot be in the index (the insert would have been
    # rejected) — they are skipped here rather than failing the whole batch.
    MAX_ID_BYTES = 64
    want = set(c["id"] for c in sample)
    for c in sample:
        want.update(adj.get(c["id"], []))
    oversized = sum(1 for i in want if len(i.encode()) > MAX_ID_BYTES)
    want = set(i for i in want if len(i.encode()) <= MAX_ID_BYTES)
    log(f"[vectors] get-by-ids for {len(want)} ids"
        + (f" ({oversized} skipped: id > {MAX_ID_BYTES} bytes)" if oversized else ""))
    stored = get_by_ids(sorted(want))

    # 5 — re-embed through the bridge (fall back to REST if it's down)
    via_bridge = True
    vecs = [None] * n
    truncated = 0
    for s in range(0, n, EMBED_BATCH):
        batch = sample[s:s + EMBED_BATCH]
        texts = [c["full"] for c in batch]
        truncated += sum(1 for t in texts if len(t) > BRIDGE_CHAR_CAP and via_bridge)
        out, via_bridge = embed(texts, via_bridge)
        if len(out) != len(batch):
            sys.exit(f"embed returned {len(out)} vectors for {len(batch)} texts")
        for k, v in enumerate(out):
            vecs[s + k] = v
        log(f"  embedded {s + len(batch)}/{n} ({time.time()-t0:.0f}s)")
        time.sleep(0.25)
    log(f"[embed] done via {'bridge' if via_bridge else 'REST fallback'}; "
        f"{truncated} texts exceeded the bridge's {BRIDGE_CHAR_CAP}-char cap")

    # 6 — compare
    missing, suspects, self_sims = [], [], []
    for c, v in zip(sample, vecs):
        orig = stored.get(c["id"])
        if not orig:
            missing.append(c["id"])
            continue
        self_sim = cosine(v, orig)
        self_sims.append(self_sim)
        neigh_ids = [d for d in adj.get(c["id"], []) if stored.get(d)]
        neigh_sims = [cosine(v, stored[d]) for d in neigh_ids]
        mean_neigh = sum(neigh_sims) / len(neigh_sims) if neigh_sims else None
        is_suspect = self_sim < args.min_sim or (mean_neigh is not None and mean_neigh < args.min_sim)
        if is_suspect:
            reasons = []
            if self_sim < args.min_sim:
                reasons.append(f"self_sim {self_sim:.3f} < {args.min_sim}")
            if mean_neigh is not None and mean_neigh < args.min_sim:
                reasons.append(f"mean_neighbor_sim {mean_neigh:.3f} < {args.min_sim}")
            suspects.append({
                "id": c["id"], "path": c["path"], "chunk": c["chunk"],
                "self_sim": round(self_sim, 4),
                "mean_neighbor_sim": round(mean_neigh, 4) if mean_neigh is not None else None,
                "neighbors_checked": len(neigh_sims),
                "truncated_text": len(c["full"]) > BRIDGE_CHAR_CAP,
                "reason": "; ".join(reasons),
            })

    self_sims.sort()
    stats = {
        "checked": len(self_sims),
        "missing_from_index": len(missing),
        "mean_self_sim": round(sum(self_sims) / len(self_sims), 4) if self_sims else None,
        "min_self_sim": round(self_sims[0], 4) if self_sims else None,
        "p10_self_sim": round(self_sims[max(0, len(self_sims) // 10)], 4) if self_sims else None,
        "suspects": len(suspects),
        "run_seconds": round(time.time() - t0, 1),
    }

    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "params": {"rate": args.rate, "seed": args.seed, "min_sim": args.min_sim,
                   "limit": args.limit or None, "embed_via": "bridge" if via_bridge else "rest-fallback"},
        "corpus": {"files": len(files), "chunks": len(chunks)},
        "sample": {"requested": n, "checked": len(self_sims), "missing_from_index": len(missing)},
        "bridge_char_cap_truncated": truncated,
        "stats": stats,
        "suspects": suspects,
        "missing": missing,
    }
    outdir = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(outdir, "embed-qc-report.json"), "w") as f:
        json.dump(report, f, indent=2)

    log("[stats] " + json.dumps(stats))
    if missing:
        log(f"[warn] {len(missing)} sampled ids not in the index (corpus changed since build?): "
            + ", ".join(missing[:5]) + ("…" if len(missing) > 5 else ""))
    log(f"[done] {len(suspects)} drift suspect(s) < {args.min_sim} — report: tools/embed-qc-report.json")


if __name__ == "__main__":
    main()
