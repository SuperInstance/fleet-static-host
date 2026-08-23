// USCP sink tests — pure helper coverage (no D1, no network).
// Run: npm test  (node --experimental-strip-types)

import {
  validateEnvelope, sanitizeData, mergeTelemetry, RateLimiter,
  ALLOWED_SIGNALS, USCP_MAX_PACKETS,
} from '../src/uscp.ts';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${extra}`); }
};

const packet = (signal_type = 'block_mined', data = { item: 'iron_scrap' }) => ({
  payload: { signal_type, data },
  metadata: { lore_ref: `lore://worldbible/items#${data.item ?? 'x'}`, t: 1000 },
});
const envelope = (packets, source = 'scrapcraft') => ({ source, packets });

console.log('\nUSCP sink · envelope validation');
ok('valid envelope passes', validateEnvelope(envelope([packet()])).ok === true);
ok('source carried through', validateEnvelope(envelope([packet()])).source === 'scrapcraft');
ok('missing source rejected', validateEnvelope({ packets: [packet()] }).status === 400);
ok('missing packets rejected', validateEnvelope({ source: 'x' }).status === 400);
ok('empty packets rejected', validateEnvelope(envelope([])).status === 400);
ok('unknown signal_type rejected', validateEnvelope(envelope([packet('nuclear_launch')])).status === 400);
ok('every allowed signal validates',
  [...ALLOWED_SIGNALS].every((s) => validateEnvelope(envelope([packet(s, {})])).ok));
ok('bad lore_ref rejected', validateEnvelope(envelope([{
  payload: { signal_type: 'block_mined', data: {} },
  metadata: { lore_ref: 'http://evil.example', t: 1 },
}])).status === 400);
ok('missing t rejected', validateEnvelope(envelope([{
  payload: { signal_type: 'block_mined', data: {} },
  metadata: { lore_ref: 'lore://x' },
}])).status === 400);
ok('non-object body rejected', validateEnvelope(null).status === 400);
ok(`too many packets rejected (max ${USCP_MAX_PACKETS})`,
  validateEnvelope(envelope(Array.from({ length: USCP_MAX_PACKETS + 1 }, () => packet()))).status === 413);

console.log('\nUSCP sink · server-side scrub');
ok('clean structured data survives',
  JSON.stringify(validateEnvelope(envelope([packet('coach_radio', { dir: 'tx', intent: 'goto', n: 2 })])).packets[0].data)
    === JSON.stringify({ dir: 'tx', intent: 'goto', n: 2 }));
ok('free text dropped server-side',
  !('text' in validateEnvelope(envelope([packet('coach_radio', { text: 'please help me mister robot' })])).packets[0].data));
ok('nested objects dropped',
  !('nest' in validateEnvelope(envelope([packet('block_mined', { nest: { a: 1 } })])).packets[0].data));
ok('long tokens truncated to 32',
  validateEnvelope(envelope([packet('block_mined', { item: 'a'.repeat(99) })])).packets[0].data.item.length === 32);

console.log('\nUSCP sink · latest-wins merge');
{
  const flat = (ps) => validateEnvelope(envelope(ps)).packets;
  const p1 = flat([packet('block_mined', { item: 'iron_scrap' })]);
  const p2 = flat([packet('block_mined', { item: 'copper_wire' }), packet('block_mined', { item: 'gear' })]);
  const m1 = mergeTelemetry(null, p1);
  ok('first merge counts 1', m1.count === 1 && m1.last.item === 'iron_scrap');
  ok('lore carried', m1.lore === 'lore://worldbible/items#iron_scrap');
  const m2 = mergeTelemetry(m1, p2);
  ok('counts accumulate', m2.count === 3);
  ok('latest data wins', m2.last.item === 'gear');
}

console.log('\nUSCP sink · rate limiter');
{
  let t = 0;
  const rl = new RateLimiter(3, 1, () => t); // burst 3, 1 token/s
  ok('first 3 pass', rl.take('a') && rl.take('a') && rl.take('a'));
  ok('4th rejected', rl.take('a') === false);
  ok('other key unaffected', rl.take('b') === true);
  t += 60_000;
  ok('refill over time lets it back in', rl.take('a') === true);
  {
    const r2 = new RateLimiter(2, 1, () => { t += 500; return t; }); // +0.5 tokens per call
    const seq = [r2.take('k'), r2.take('k'), r2.take('k'), r2.take('k')];
    ok('gradual refill pattern', JSON.stringify(seq) === JSON.stringify([true, true, true, false]));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
