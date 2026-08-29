// MCP bridge tests — JSON-RPC 2.0 envelope shape (no D1, no network).
// Run: npm test  (node --experimental-strip-types tests/mcp.test.mjs)
//
// Covers the paper-63 Phase-1 surface: initialize / tools/list / tools/call
// envelopes, error codes, walk depth caps, and the bearer check. Tool bodies
// that need D1/AI/Vectorize are exercised against invalid params only —
// validation happens before any env access by design.

import { dispatchRpc, bearerOk, clampDepth, RPC_ERRORS } from '../src/mcp.ts';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${extra}`); }
};

const ctx = {
  env: null, // untouched by every path below
  deps: { canonSearch: async () => { throw new Error('not under test'); } },
  tokenHash: 'test',
};
const call = (msg) => dispatchRpc(msg, ctx);

console.log('\nMCP bridge · initialize');
{
  const r = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  ok('returns a result envelope', r?.jsonrpc === '2.0' && r?.id === 1 && !('error' in r));
  ok('protocol version advertised', r?.result?.protocolVersion === '2025-06-18');
  ok('serverInfo present', typeof r?.result?.serverInfo?.name === 'string');
  ok('tools capability advertised', 'tools' in (r?.result?.capabilities ?? {}));
  ok('instructions present', typeof r?.result?.instructions === 'string');
}

console.log('\nMCP bridge · ping + notifications');
{
  const r = await call({ jsonrpc: '2.0', id: 2, method: 'ping' });
  ok('ping returns empty result', r?.id === 2 && JSON.stringify(r?.result) === '{}');
  const n = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
  ok('initialized notification stays silent', n === null);
  const u = await call({ jsonrpc: '2.0', method: 'notifications/unknown-thing' });
  ok('unknown notification stays silent', u === null);
}

console.log('\nMCP bridge · tools/list (paper 63 §4.1 Phase 1 surface)');
{
  const r = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const tools = r?.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  ok('exactly the three Phase-1 tools', JSON.stringify(names) === JSON.stringify(['forest_walk', 'canon_search', 'fleet_status']), JSON.stringify(names));
  ok('every tool has a description', tools.every((t) => typeof t.description === 'string' && t.description.length > 10));
  ok('every inputSchema is an object schema', tools.every((t) => t.inputSchema?.type === 'object'));
  ok('canon_search requires query', tools.find((t) => t.name === 'canon_search')?.inputSchema?.required?.[0] === 'query');
  const fw = tools.find((t) => t.name === 'forest_walk')?.inputSchema;
  ok('forest_walk exposes query/depth/seed_nodes', !!fw?.properties?.query && !!fw?.properties?.depth && !!fw?.properties?.seed_nodes);
  ok('forest_walk depth capped at 10 in schema (§5.3)', fw?.properties?.depth?.maximum === 10);
}

console.log('\nMCP bridge · tools/call errors');
{
  const r = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'not_a_tool', arguments: {} } });
  ok('unknown tool → -32602 (spec example)', r?.error?.code === RPC_ERRORS.INVALID_PARAMS);
  ok('error message names the tool', /Unknown tool/.test(r?.error?.message ?? ''));
  const r2 = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'forest_walk', arguments: {} } });
  ok('forest_walk without query or seeds → -32602', r2?.error?.code === RPC_ERRORS.INVALID_PARAMS && /query/.test(r2?.error?.message));
  const r3 = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'canon_search', arguments: { query: '' } } });
  ok('canon_search empty query → -32602', r3?.error?.code === RPC_ERRORS.INVALID_PARAMS);
}

console.log('\nMCP bridge · envelope validation');
{
  const r = await call({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
  ok('unadvertised method → -32601', r?.error?.code === RPC_ERRORS.METHOD_NOT_FOUND);
  const r2 = await call({ id: 8, method: 'ping' });
  ok('missing jsonrpc → -32600', r2?.error?.code === RPC_ERRORS.INVALID_REQUEST);
  const r3 = await call([{}]);
  ok('batch array → -32600 (batches removed in 2025-06-18)', r3?.error?.code === RPC_ERRORS.INVALID_REQUEST);
}

console.log('\nMCP bridge · walk depth caps (paper 63 §5.3)');
{
  ok('default depth is 3', clampDepth(undefined) === 3);
  ok('depth clamps up from below 1', clampDepth(0) === 1 && clampDepth(-5) === 1);
  ok('depth clamps down from above 10', clampDepth(11) === 10 && clampDepth(1000) === 10);
  ok('depth 10 passes through', clampDepth(10) === 10);
  ok('numeric string accepted', clampDepth('4') === 4);
  ok('garbage falls back to default', clampDepth('banana') === 3);
}

console.log('\nMCP bridge · bearer auth (paper 63 §3 spirit)');
{
  ok('correct bearer accepted', bearerOk('Bearer s3cret-token', 's3cret-token') === true);
  ok('wrong bearer rejected', bearerOk('Bearer wrong', 's3cret-token') === false);
  ok('missing header rejected', bearerOk(null, 's3cret-token') === false);
  ok('wrong scheme rejected', bearerOk('Basic s3cret-token', 's3cret-token') === false);
  ok('no expected token → always reject', bearerOk('Bearer x', undefined) === false && bearerOk(null, null) === false);
  ok('prefix mismatch rejected', bearerOk('Bearer s3cret-token-x', 's3cret-token') === false);
  ok('empty token rejected', bearerOk('Bearer ', 's3cret-token') === false);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} · ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
