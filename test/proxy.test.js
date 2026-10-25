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
