import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analysis.js';
import { distToPolygon, haversine, pointInPolygon, fromXY } from '../src/lib/geo.js';
import { foldAccents, normalizeQuery } from '../src/api/nominatim.js';
import { buildQueries } from '../src/api/overpass.js';
import { createLimiter } from '../src/lib/http.js';

const pt = { lat: 47.5, lon: 19.04 };
const at = (x, y) => fromXY(pt, x, y);
const square = (cx, cy, half) => [
  at(cx - half, cy - half), at(cx + half, cy - half), at(cx + half, cy + half), at(cx - half, cy + half), at(cx - half, cy - half),
].map((p) => ({ lat: p.lat, lon: p.lon }));

const fixture = {
  elements: [
    { type: 'node', id: 1, ...at(200, 0), tags: { shop: 'convenience', name: 'Közért' } },
    { type: 'way', id: 2, center: at(900, 0), tags: { shop: 'supermarket', name: 'Spar' } },
    // bus stop with two directions + route relations
    { type: 'node', id: 10, ...at(150, 0), tags: { highway: 'bus_stop', name: 'Teszt tér' } },
    { type: 'node', id: 11, ...at(160, 20), tags: { highway: 'bus_stop', name: 'Teszt tér' } },
    { type: 'relation', id: 20, tags: { type: 'route', route: 'bus', ref: '133E' }, members: [{ type: 'node', ref: 10, role: 'platform' }] },
    { type: 'relation', id: 21, tags: { type: 'route', route: 'bus', ref: '9' }, members: [{ type: 'node', ref: 11, role: 'platform' }] },
    { type: 'node', id: 12, ...at(400, 0), tags: { railway: 'station', station: 'subway', name: 'Metró' } },
    { type: 'node', id: 13, ...at(405, 0), tags: { public_transport: 'stop_position', subway: 'yes', name: 'Metró' } },
    { type: 'relation', id: 22, tags: { type: 'route', route: 'subway', ref: '2' }, members: [{ type: 'node', ref: 13, role: 'stop' }] },
    // park 100 m east (west edge at x=100), 100 m half-size
    {
      type: 'way', id: 30, tags: { leisure: 'park', name: 'Kis park' },
      geometry: square(200, 0, 100),
    },
    // trees: two inside 400 m, one outside
    { type: 'node', id: 40, ...at(10, 10) },
    { type: 'node', id: 41, ...at(-20, 30) },
    { type: 'node', id: 42, ...at(700, 0) },
    // streets
    { type: 'way', id: 50, tags: { highway: 'residential', name: 'Fő utca', lit: 'yes' }, geometry: [at(-100, 20), at(100, 20)] },
    { type: 'way', id: 51, tags: { highway: 'residential', name: 'Fő utca', lit: 'no' }, geometry: [at(100, 20), at(200, 20)] },
    { type: 'way', id: 52, tags: { highway: 'footway' }, geometry: [at(0, -50), at(100, -50)] },
  ],
};

test('shops: sorted by distance, far ones kept within radius', () => {
  const r = analyze(fixture, pt);
  assert.deepEqual(r.shops.map((s) => s.name), ['Közért', 'Spar']);
  assert.ok(Math.abs(r.shops[0].dist - 200) < 3);
  assert.equal(r.shops[0].walk.minutes, Math.round((200 * 1.3) / 80));
});

test('transport: merges lines of both directions, metro line prefixed', () => {
  const r = analyze(fixture, pt);
  assert.equal(r.transport.bus.length, 1);
  assert.deepEqual(r.transport.bus[0].lines, ['9', '133E']);
  assert.deepEqual(r.transport.metro[0].lines, ['M2']);
  assert.equal(r.transport.tram.length, 0);
});

test('green: coverage, trees, nearest park', () => {
  const g = analyze(fixture, pt).green;
  assert.equal(g.trees, 2);
  assert.ok(g.coverage > 0.05 && g.coverage < 0.4, `coverage ${g.coverage}`);
  assert.equal(g.nearestPark.name, 'Kis park');
  assert.ok(Math.abs(g.nearestPark.dist - 100) < 3);
  assert.ok(g.score >= 0 && g.score <= 10);
});

test('lit share is length weighted among tagged ways; street picked by name', () => {
  const { lit, street } = analyze(fixture, pt);
  assert.ok(Math.abs(lit.share - 200 / 300) < 0.03, `share ${lit.share}`);
  assert.ok(Math.abs(lit.coverage - 0.75) < 0.03);
  assert.equal(street.name, 'Fő utca');
  assert.equal(street.geometry.coordinates.length, 2);
});

test('geo helpers', () => {
  const sq = [square(0, 0, 50).map((p) => [p.lon, p.lat])];
  assert.ok(pointInPolygon(pt, sq));
  assert.ok(!pointInPolygon(at(80, 0), sq));
  assert.ok(Math.abs(distToPolygon(pt, [square(200, 0, 100).map((p) => [p.lon, p.lat])]).dist - 100) < 2);
  assert.ok(Math.abs(haversine(pt, at(300, 400)) - 500) < 5);
});

test('hungarian query normalisation', () => {
  assert.equal(normalizeQuery('  Istva\u0301nmezo\u030B  '), 'Istv\u00e1nmez\u0151');
  assert.equal(foldAccents('Istvánmező Őrmező űrlap'), 'Istvanmezo Ormezo urlap');
});

test('overpass query contains all sections', () => {
  const q = Object.values(buildQueries({ lat: 47.5, lon: 19.04 })).join('\n');
  for (const s of ['supermarket', 'bus_stop', 'tram_stop', 'subway', 'natural"="tree', 'highway', 'out geom']) assert.ok(q.includes(s), s);
});

test('limiter spaces tasks', async () => {
  const run = createLimiter(120);
  const times = [];
  await Promise.all([1, 2, 3].map(() => run(async () => times.push(Date.now()))));
  assert.ok(times[1] - times[0] >= 115 && times[2] - times[1] >= 115);
});
