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
  dst TEXT NOT NULL              -- node id
);
CREATE INDEX idx_forest_walks_ts ON forest_walks (ts);
CREATE INDEX idx_forest_walks_edge ON forest_walks (src, dst);
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

**POST /api/forest/walk-log** logs a traversal (rate-limited to 30 req/s per IP, refill 2 tokens/s):

```json
{
  "hops": [
    {"src": "node_a", "dst": "node_b"},
    {"src": "node_b", "dst": "node_c"}
  ]
}
```

Returns `{"ok": true, "logged": 2}`.

## Live Application

The walk page (`/forest/index.html`) calls `logWalk()` after rendering each search walk, firing the beacon asynchronously (no-throw).
