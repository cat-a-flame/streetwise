import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline } from '../src/lib/polyline.js';
import { commuteInstant } from '../src/lib/time.js';
import { parseCar, parseTransit } from '../src/api/routing.js';
import { relayRoute, slimPlan } from '../server/route-proxy.js';

test('polyline decoding matches the reference example', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(pts.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('commute time is 09:00 Budapest on a weekday after now', () => {
  for (const now of ['2026-10-27T12:00:00Z', '2026-10-30T18:00:00Z', '2026-03-27T10:00:00Z', '2026-10-24T08:00:00Z']) {
    const t = commuteInstant(new Date(now));
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).format(t);
    assert.match(local, /09:00/);
    assert.doesNotMatch(local, /Sat|Sun/);
    assert.ok(t > new Date(now));
  }
  // Friday evening -> Monday
  assert.match(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Budapest', weekday: 'short' }).format(commuteInstant(new Date('2026-10-30T18:00:00Z'))), /Mon/);
});

const it = (minutes, legs) => ({ duration: minutes * 60, startTime: '2026-10-28T07:20:00+01:00', endTime: '2026-10-28T08:00:00+01:00', transfers: legs.filter((l) => l.routeShortName).length - 1, legs });
const leg = (mode, extra = {}) => ({ mode, duration: 300, from: { name: 'A' }, to: { name: 'B' }, legGeometry: { points: '_p~iF~ps|U_ulLnnqC', precision: 5 }, ...extra });

test('transit parsing: sorted, de-duplicated by line sequence, max 3', () => {
  const json = { itineraries: [
    it(50, [leg('WALK'), leg('BUS', { routeShortName: '9' })]),
    it(40, [leg('WALK'), leg('SUBWAY', { routeShortName: 'M3', routeColor: '0000ff' }), leg('TRAM', { routeShortName: '4' })]),
    it(45, [leg('WALK'), leg('BUS', { routeShortName: '9' })]),
  ] };
  const out = parseTransit(json);
  assert.deepEqual(out.map((o) => o.minutes), [40, 45]);
  assert.equal(out[0].legs[1].color, '#0000ff');
  assert.equal(out[0].transfers, 1);
  assert.equal(out[0].legs[0].geometry.length, 2);
  assert.equal(parseTransit({ itineraries: [], direct: [it(12, [leg('WALK')])] })[0].minutes, 12);
});

test('car parsing converts lon/lat to lat/lon', () => {
  const c = parseCar({ routes: [{ duration: 1500, distance: 14200, geometry: { coordinates: [[19.04, 47.5], [19.05, 47.51]] } }] });
  assert.equal(c.minutes, 25);
  assert.equal(c.km, 14.2);
  assert.deepEqual(c.geometry[0], [47.5, 19.04]);
  assert.throws(() => parseCar({ routes: [] }));
});

test('route relay validates input and slims plans', async () => {
  const bad = (qs) => relayRoute(new URLSearchParams(qs));
  assert.equal((await bad('kind=car&from=x&to=1,2')).status, 400);
  assert.equal((await bad('kind=car&from=47.5,19.0&to=47.6,19.1,9')).status, 400);
  assert.equal((await bad('kind=transit&from=47.5,19.0&to=47.6,19.1&time=tomorrow')).status, 400);
  assert.equal((await bad('kind=evil&from=47.5,19.0&to=47.6,19.1')).status, 400);
  const slim = JSON.parse(slimPlan(JSON.stringify({ itineraries: [{ legs: [{ steps: [1], intermediateStops: [2], alerts: [3], mode: 'BUS' }], fareTransfers: [1] }] })));
  assert.deepEqual(slim.itineraries[0].legs[0], { mode: 'BUS' });
});

test('route relay forwards a car request upstream with a User-Agent', async () => {
  const real = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, opts) => { seen = [String(url), opts.headers['User-Agent']]; return new Response('{"routes":[]}'); };
  try {
    const r = await relayRoute(new URLSearchParams('kind=car&from=47.5,19.0&to=47.6,19.1'));
    assert.equal(r.status, 200);
    assert.match(seen[0], /19,47\.5;19\.1,47\.6/);
    assert.match(seen[1], /^streetwise/);
  } finally { globalThis.fetch = real; }
});
