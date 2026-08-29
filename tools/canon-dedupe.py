#!/usr/bin/env python3
"""
CANON-DEDUPE — exact-prefix duplicate deduplication planner (toolyard #6)
==========================================================================
Fetches duplicate groups from GET /api/canon/stats?groups=1, selects the
keeper chunk for each group (longest text, oldest path as tiebreak), and
writes a MERGE PLAN to tools/canon-dedupe-plan.json. Plan contains only
proposed actions (which chunks to keep/archive), with no writes to D1.
The plan is a proposal document; a human or future lane applies it.

Reads from D1 (forest_nodes) to fetch chunk texts; no auth needed for
the worker API call, but D1 read uses wrangler OAuth token.

Safe to run read-only against D1/the worker:

  python3 tools/canon-dedupe.py
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

WORKER = "https://fleet-static-host.casey-digennaro.workers.dev"
ACCOUNT = "049ff5e84ecf636b53b162cbb580aae6"
D1_DB = "19d1d2f3-d6ef-48bb-9475-253f303bfb37"


def token():
    cfg = os.path.expanduser("~/.wrangler/config/default.toml")
    if not os.path.exists(cfg):
        print(f"Error: wrangler config not found at {cfg}")
        sys.exit(1)
    m = re.search(r'oauth_token = "([^"]+)"', open(cfg).read())
    if not m:
        print("Error: oauth_token not found in wrangler config")
        sys.exit(1)
    return m.group(1)


T = token()


def log(msg):
    print(msg, file=sys.stderr)


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
                raise RuntimeError(f"api rejected {url}: {last}")
        except Exception as e:
            last = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"api failed after {tries} tries: {url}: {last}")


def get_stats():
    """Fetch duplicate groups from GET /api/canon/stats?groups=1."""
    try:
        req = urllib.request.Request(
            WORKER + "/api/canon/stats?groups=1",
            headers={"User-Agent": "canon-dedupe/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except Exception as e:
        raise RuntimeError(f"Failed to fetch stats: {e}")


def fetch_chunks(chunk_ids):
    """Fetch chunk texts from D1 by IDs."""
    if not chunk_ids:
        return {}

    placeholders = ",".join(["?" for _ in chunk_ids])
    d = api(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{D1_DB}/query",
            {"sql": f"SELECT id, text, path FROM forest_nodes WHERE id IN ({placeholders})",
             "params": chunk_ids})
    if not d.get("success"):
        raise RuntimeError(f"D1 query failed: {str(d)[:300]}")

    chunks = {}
    for row in d["result"][0]["results"]:
        chunks[row["id"]] = {
            "text": row["text"],
            "path": row["path"]
        }
    return chunks


def select_keeper(chunk_ids, chunks):
    """Select the keeper chunk: longest text, oldest path as tiebreak."""
    if not chunk_ids:
        return None

    candidates = [
        (chunk_ids[0], len(chunks[chunk_ids[0]]["text"]), chunks[chunk_ids[0]]["path"])
        if chunk_ids[0] in chunks else None
        for _ in []
    ]
    candidates = []
    for cid in chunk_ids:
        if cid in chunks:
            text_len = len(chunks[cid]["text"])
            path = chunks[cid]["path"]
            candidates.append((cid, text_len, path))

    if not candidates:
        return None

    # Sort by length descending, then by path ascending
    candidates.sort(key=lambda x: (-x[1], x[2]))
    return candidates[0][0]


def main():
    args_parser = argparse.ArgumentParser(description=__doc__)
    args_parser.parse_args()

    log("fetching duplicate groups...")
    stats = get_stats()

    if not stats.get("ok"):
        raise RuntimeError(f"stats fetch failed: {stats.get('error')}")

    dup_groups = stats.get("duplicates", {}).get("top_groups", [])
    if not dup_groups:
        log("no duplicate groups found")
        return

    log(f"found {len(dup_groups)} duplicate groups")

    plan = {
        "timestamp": int(time.time()),
        "duplicates_found": len(dup_groups),
        "actions": []
    }

    total_archived = 0
    total_text_freed = 0

    for group_idx, group in enumerate(dup_groups, 1):
        member_ids = group.get("member_ids", [])
        if len(member_ids) < 2:
            continue

        log(f"[{group_idx}/{len(dup_groups)}] group: prefix={group['prefix'][:20]}... "
            f"bucket={group['length_bucket']} members={len(member_ids)}")

        chunks = fetch_chunks(member_ids)
        keeper_id = select_keeper(member_ids, chunks)

        if not keeper_id:
            log(f"  → skipped (no valid chunks)")
            continue

        keeper_text = chunks[keeper_id]["text"]
        keeper_path = chunks[keeper_id]["path"]

        archive_ids = [cid for cid in member_ids if cid != keeper_id]
        group_text_freed = sum(len(chunks[cid]["text"]) for cid in archive_ids if cid in chunks)

        plan["actions"].append({
            "group_key": [group["prefix"], group["length_bucket"]],
            "keeper": {
                "id": keeper_id,
                "path": keeper_path,
                "text_length": len(keeper_text),
                "text_preview": keeper_text[:100]
            },
            "archive": [
                {
                    "id": cid,
                    "path": chunks[cid]["path"],
                    "text_length": len(chunks[cid]["text"])
                }
                for cid in archive_ids if cid in chunks
            ]
        })

        total_archived += len(archive_ids)
        total_text_freed += group_text_freed
        log(f"  ✓ keeper: {keeper_path} ({len(keeper_text)} chars) "
            f"archive: {len(archive_ids)} chunks ({group_text_freed} chars freed)")

    # Write plan
    plan_path = "tools/canon-dedupe-plan.json"
    with open(plan_path, "w") as f:
        json.dump(plan, f, indent=2)

    log(f"\n✓ plan written to {plan_path}")
    log(f"summary:")
    log(f"  duplicate groups: {len(dup_groups)}")
    log(f"  actions: {len(plan['actions'])}")
    log(f"  chunks to archive: {total_archived}")
    log(f"  text freed: {total_text_freed:,} chars")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"error: {e}")
        sys.exit(1)
