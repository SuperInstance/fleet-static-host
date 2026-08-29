# Forest Hebbian Edge Deepening

## The Mechanism

Every time a user traverses an edge in the forest graph (a hop from one node to another during a walk), that edge is logged to `forest_walks(ts, src, dst)`. The edge's weight then grows via the Hebbian learning rule:

```
boosted_weight = base_weight + ln(1 + walk_count)
```

Where:
- `base_weight` is the original learned weight from `forest_edges`
- `walk_count` is the number of times that specific (src, dst) edge has been traversed
- The logarithm dampens growth (diminishing returns per additional walk)

## The Philosophy

The forest is a topology: authors write papers, cite each other (ref edges), chunks cluster by semantic similarity (near edges). The base weights reflect this structure. But users are also structure: they think by walking. When users traverse an edge repeatedly, they're voting for that connection's cognitive salience. The Hebbian boost says: if the walk goes this way, make the walk easier next time. Positive feedback, bounded by log().

## Data Schema

```sql
CREATE TABLE forest_walks (
  ts INTEGER NOT NULL,           -- epoch seconds
  src TEXT NOT NULL,             -- node id
  dst TEXT NOT NULL,             -- node id
  session_id TEXT                -- optional uuid (walk page localStorage) — migration 0004
);
CREATE INDEX idx_forest_walks_ts ON forest_walks (ts);
CREATE INDEX idx_forest_walks_edge ON forest_walks (src, dst);
CREATE INDEX idx_forest_walks_edge_session ON forest_walks (src, dst, session_id);
```

## API

**GET /api/forest/weights** returns all edges with computed walk counts and boosted weights:

```json
{
  "ok": true,
  "count": 1248,
  "edges": [
    {
      "src": "ai-writings/deep-learning/chapter-3__2",
      "dst": "ai-writings/neural-nets/backprop__0",
      "kind": "near",
      "base": 0.82,
      "walk_count": 14,
      "boosted": 0.82 + ln(1 + 14) = 3.65
    }
  ]
}
```

**POST /api/forest/walk-log** logs a traversal (rate-limited to 30 req/s per IP, refill 2 tokens/s). An optional `sessionId` (uuid from the walk page's localStorage) dedups each (src, dst) pair per session — same-session echo never inflates the counter (research/61 §4.3):

```json
{
  "sessionId": "b6c1f0aa-9d3e-4c1a-8f22-2e1d5a7c9b41",
  "hops": [
    {"src": "node_a", "dst": "node_b"},
    {"src": "node_b", "dst": "node_c"}
  ]
}
```

Returns `{"ok": true, "logged": 2, "deduped": 0}` — `logged` counts rows actually inserted, `deduped` counts same-session skips.

**GET /api/forest/weights?decayed=1** computes the counter-decay effective weight from research/61 §3.3: each walk contributes `2^(−age_days/90)` to a per-edge sum `W`, and `boosted = base + ln(1 + W)`. Old walks fade with a 90-day half-life; the stored log stays append-only and rebuildable. Without `?decayed=1` the endpoint keeps the raw `boosted = base + ln(1 + walk_count)` behavior.

## Live Application

The walk page (`/forest/index.html`) calls `logWalk()` after rendering each search walk, firing the beacon asynchronously (no-throw).
