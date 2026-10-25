import test from 'node:test';
import assert from 'node:assert/strict';
import { relayOverpass } from '../server/overpass-proxy.js';

test('relay sends a User-Agent and falls through failing mirrors', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push([String(url).split('?')[0], opts.headers['User-Agent'], opts.headers.Accept]);
    return seen.length === 1 ? new Response('nope', { status: 406 }) : new Response('{"elements":[]}', { status: 200 });
  };
  try {
    const r = await relayOverpass('[out:json];out;');
    assert.equal(r.status, 200);
    assert.equal(seen.length, 2);
    assert.match(seen[0][1], /^streetwise/);
    assert.equal(seen[0][2], 'application/json');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('relay rejects empty or oversized queries', async () => {
  assert.equal((await relayOverpass('')).status, 400);
  assert.equal((await relayOverpass('x'.repeat(30000))).status, 400);
});

import { slim } from '../server/overpass-proxy.js';
test('slim drops way node lists and non-node route members', () => {
  const out = JSON.parse(slim(JSON.stringify({ version: 0.6, elements: [
    { type: 'way', id: 1, nodes: [1, 2], geometry: [{ lat: 1, lon: 2 }], tags: { leisure: 'park' } },
    { type: 'relation', id: 2, tags: { route: 'bus', ref: '9' }, members: [{ type: 'way', ref: 5, role: '' }, { type: 'node', ref: 7, role: 'platform' }] },
    { type: 'relation', id: 3, tags: { leisure: 'park' }, members: [{ type: 'way', ref: 5, role: 'outer', geometry: [] }] },
  ] })));
  assert.equal(out.elements[0].nodes, undefined);
  assert.deepEqual(out.elements[1].members, [{ type: 'node', ref: 7 }]);
  assert.equal(out.elements[2].members.length, 1);
});
