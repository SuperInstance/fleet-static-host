#!/usr/bin/env bash
# Push seed sheets into the deployed (or local) quilt backend.
#   BASE=http://localhost:8787 QUILT_SEED_KEY=... bash seed/push.sh
# Remote default: the live worker.
set -euo pipefail
BASE="${BASE:-https://fleet-static-host.casey-digennaro.workers.dev}"
KEY="${QUILT_SEED_KEY:?set QUILT_SEED_KEY (must match `wrangler secret put QUILT_SEED_KEY`)}"
DIR="$(cd "$(dirname "$0")" && pwd)/sheets"
for sheet in papers writings lobby trails; do
  echo "→ pushing sheet: $sheet → $BASE"
  curl -sS -X POST "$BASE/api/quilt/sheet?id=$sheet" \
    -H "X-Quilt-Key: $KEY" \
    -H "Content-Type: application/json" \
    --data-binary @"$DIR/$sheet.json"
  echo
done
echo "→ verifying:"
curl -sS "$BASE/api/quilt/cells" | head -c 1200
echo
