import test from 'node:test';
import assert from 'node:assert/strict';
import { relayOverpass } from '../server/overpass-proxy.js';

test('relay sends a User-Agent and hedges past a hung mirror', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    seen.push([String(url).split('?')[0], opts.headers['User-Agent'], opts.headers.Accept]);
    if (seen.length === 1) {
      return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))));
    }
    return Promise.resolve(new Response('{"elements":[]}', { status: 200 }));
  };
  try {
    const r = await relayOverpass('[out:json];out;', { hedgeMs: 50, totalMs: 2000 });
    assert.equal(r.status, 200);
    assert.equal(seen.length, 2);
    assert.match(seen[0][1], /^streetwise/);
    assert.equal(seen[0][2], 'application/json');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('relay moves on after an error and reports the last one if all fail', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('busy', { status: 502 });
  try {
    const r = await relayOverpass('q', { hedgeMs: 10, totalMs: 2000 });
    assert.equal(r.status, 502);
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
