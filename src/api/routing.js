import { cacheGet, cacheSet } from '../lib/idb.js';
import { decodePolyline } from '../lib/polyline.js';
import { commuteInstant } from '../lib/time.js';

const TTL = 12 * 3600 * 1000;
const r4 = (n) => n.toFixed(4);

async function relay(kind, from, to, extra = {}, signal) {
  const q = new URLSearchParams({ kind, from: `${from.lat},${from.lon}`, to: `${to.lat},${to.lon}`, ...extra });
  const res = await fetch(`/api/route?${q}`, { signal });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      /* gateway page */
    }
    throw new Error(msg);
  }
  return JSON.parse(text);
}

export function parseTransit(json) {
  const toOption = (it) => ({
    minutes: Math.round(it.duration / 60),
    start: it.startTime,
    end: it.endTime,
    transfers: it.transfers ?? Math.max(0, it.legs.filter((l) => l.routeShortName || l.displayName).length - 1),
    legs: it.legs.map((l) => {
      const transit = !['WALK', 'BIKE', 'CAR'].includes(l.mode);
      return {
        mode: l.mode,
        transit,
        minutes: Math.max(1, Math.round(l.duration / 60)),
        name: l.displayName || l.routeShortName || '',
        headsign: l.headsign || '',
        from: l.from?.name || '',
        to: l.to?.name || '',
        color: l.routeColor ? `#${l.routeColor.replace('#', '')}` : null,
        geometry: l.legGeometry ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6) : [],
      };
    }),
  });
  const options = (json.itineraries || []).map(toOption).sort((a, b) => a.minutes - b.minutes || a.transfers - b.transfers);
  // Same line sequence at several departure times: keep the fastest of each.
  const seen = new Set();
  const unique = options.filter((o) => {
    const k = o.legs.map((l) => (l.transit ? l.name : 'W')).join('>');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length) return unique.slice(0, 3);
  return (json.direct || []).map(toOption).slice(0, 1);
}

export function parseCar(json) {
  const route = json.routes?.[0];
  if (!route) throw new Error('nincs útvonal');
  return {
    minutes: Math.max(1, Math.round(route.duration / 60)),
    km: route.distance / 1000,
    geometry: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
  };
}

async function cached(key, load) {
  const hit = await cacheGet(key, TTL);
  if (hit) return hit;
  const value = await load();
  await cacheSet(key, value);
  return value;
}

export function fetchTransit(from, to, signal) {
  const arrive = commuteInstant();
  const key = `route:v1:transit:${r4(from.lat)},${r4(from.lon)}:${r4(to.lat)},${r4(to.lon)}:${arrive.toISOString()}`;
  return cached(key, async () => parseTransit(await relay('transit', from, to, { time: arrive.toISOString() }, signal)));
}

export function fetchCar(from, to, signal) {
  const key = `route:v1:car:${r4(from.lat)},${r4(from.lon)}:${r4(to.lat)},${r4(to.lon)}`;
  return cached(key, async () => parseCar(await relay('car', from, to, {}, signal)));
}
