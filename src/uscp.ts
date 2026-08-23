// =============================================================================
//  USCP sink — telemetry from the fleet's games (RIFT-PHASE-1)
// =============================================================================
//  POST /api/uscp accepts Scrapcraft's Rift telemetry envelopes:
//    { source: 'scrapcraft',
//      packets: [ { payload: { signal_type, data },
//                  metadata: { lore_ref, t } } ] }
//
//  PRIVACY STANCE (mirrors the game's emitter, enforced here again — the
//  sink never trusts the client):
//    * Payloads are event kinds + small structured data only. The sink
//      re-scrubs every field: numbers, booleans, and single-token strings
//      (≤32 chars) survive; free text, objects, and arrays are dropped.
//    * No identifiers are accepted or stored — no player name, no session id.
//    * Writes land in quilt sheet `telemetry`, one cell per signal_type
//      (`uscp.<signal_type>`), latest-wins per key: {count, last, lore, t}.
//
//  Rate limiting: per-isolate token bucket keyed by client IP. Cheap and
//  honest about its scope (one isolate's memory) — good enough for a fleet.
// =============================================================================

export const USCP_SHEET = 'telemetry';
export const USCP_CELL_PREFIX = 'uscp.';

/** The only signal types accepted (mirrors the game's SIGNAL_TYPES). */
export const ALLOWED_SIGNALS: ReadonlySet<string> = new Set([
  'block_mined', 'item_crafted', 'program_run', 'lap_complete',
  'quest_complete', 'companion_line', 'coach_radio',
]);

export const USCP_MAX_PACKETS = 50;      // per request
export const USCP_MAX_BODY_BYTES = 32 * 1024;

/** Server-side scrub — same rule as the game: free text never ships. */
export function sanitizeData(data: any): Record<string, number | string | boolean> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && /^[a-z0-9_-]+$/i.test(v)) out[k] = v.slice(0, 32);
    // free text / nested / arrays: dropped by design
  }
  return out;
}

export interface UscpPacket {
  signal_type: string;
  data: Record<string, number | string | boolean>;
  lore_ref: string;
  t: number;
}

export interface ValidateResult {
  ok: boolean;
  error?: string;
  status?: number;
  packets?: UscpPacket[];
  source?: string;
}

/** Validate one envelope. Strict: shape errors reject the whole body (400). */
export function validateEnvelope(body: any): ValidateResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON envelope', status: 400 };
  const source = typeof body.source === 'string' ? body.source.slice(0, 32) : '';
  if (!source) return { ok: false, error: 'envelope.source required', status: 400 };
  if (!Array.isArray(body.packets)) return { ok: false, error: 'envelope.packets must be an array', status: 400 };
  if (body.packets.length === 0) return { ok: false, error: 'envelope.packets empty', status: 400 };
  if (body.packets.length > USCP_MAX_PACKETS)
    return { ok: false, error: `too many packets (max ${USCP_MAX_PACKETS})`, status: 413 };
  const packets: UscpPacket[] = [];
  for (const p of body.packets) {
    const st = p?.payload?.signal_type;
    if (!ALLOWED_SIGNALS.has(st)) return { ok: false, error: `unknown signal_type: ${String(st)}`, status: 400 };
    const lore = p?.metadata?.lore_ref;
    if (typeof lore !== 'string' || !lore.startsWith('lore://'))
      return { ok: false, error: 'metadata.lore_ref must be a lore:// uri', status: 400 };
    const t = p?.metadata?.t;
    if (typeof t !== 'number' || !Number.isFinite(t))
      return { ok: false, error: 'metadata.t must be a number', status: 400 };
    packets.push({ signal_type: st, data: sanitizeData(p.payload.data), lore_ref: lore.slice(0, 200), t });
  }
  return { ok: true, packets, source };
}

/** Latest-wins aggregation per signal_type key. */
export interface TelemetryCell {
  count: number;
  last: Record<string, number | string | boolean>;
  lore: string;
  t: number;
}

export function mergeTelemetry(prev: TelemetryCell | null, packets: UscpPacket[]): TelemetryCell {
  const newest = packets[packets.length - 1]!;
  return {
    count: (prev?.count ?? 0) + packets.length,
    last: newest.data,
    lore: newest.lore_ref,
    t: newest.t,
  };
}

// ── rate limiting ────────────────────────────────────────────────────────────

interface Bucket { tokens: number; last: number; }

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private capacity: number;
  private refillPerSec: number;
  private now: () => number;
  constructor(capacity = 10, refillPerSec = 0.5, now: () => number = Date.now) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
  }
  take(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.capacity, last: t }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.last) / 1000) * this.refillPerSec);
    b.last = t;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  }
  /** For tests / diagnostics. */
  size(): number { return this.buckets.size; }
}
