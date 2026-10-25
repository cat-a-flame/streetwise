import { BUDAPEST, NOMINATIM_URL } from '../config.js';
import { createLimiter } from '../lib/http.js';

const LS_KEY = 'sw:geo:v1';
const MAX_ENTRIES = 80;
const TTL = 14 * 24 * 3600 * 1000;

// Nominatim usage policy: max 1 request/second.
const limiter = createLimiter(1100);

let cache = {};
try {
  cache = JSON.parse(localStorage.getItem(LS_KEY)) || {};
} catch {
  cache = {};
}

function persist() {
  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => cache[a].t - cache[b].t);
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete cache[k];
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    /* quota / private mode */
  }
}

// NFC so "é" typed as e + combining accent matches the precomposed form OSM uses.
export const normalizeQuery = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export const foldAccents = (s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

function mapResult(r) {
  const a = r.address || {};
  const street = [a.road, a.house_number].filter(Boolean).join(' ');
  const name = r.name || street || r.display_name.split(',')[0];
  const sub = [...new Set([a.suburb, a.neighbourhood, a.quarter, a.city_district].filter(Boolean))]
    .filter((x) => x !== name)
    .join(', ');
  const [s, n, w, e] = (r.boundingbox || []).map(Number);
  const gj = r.geojson;
  return {
    id: r.place_id,
    lat: Number(r.lat),
    lon: Number(r.lon),
    name,
    sub,
    type: r.addresstype || r.type,
    bbox: [s, n, w, e].every(Number.isFinite) ? { s, n, w, e } : null,
    outline: gj && (gj.type === 'Polygon' || gj.type === 'MultiPolygon') ? gj : null,
  };
}

async function request(q, signal) {
  const { south, west, north, east } = BUDAPEST.bounds;
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '6',
    addressdetails: '1',
    'accept-language': 'hu',
    countrycodes: 'hu',
    viewbox: `${west},${north},${east},${south}`,
    bounded: '1',
    polygon_geojson: '1',
    polygon_threshold: '0.0003',
  });
  return limiter(async () => {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, { signal });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return (await res.json()).map(mapResult);
  }, signal);
}

export async function searchPlaces(raw, signal) {
  const q = normalizeQuery(raw);
  if (q.length < 3) return [];
  const key = q.toLocaleLowerCase('hu');
  const hit = cache[key];
  if (hit && Date.now() - hit.t < TTL) return hit.results;

  let results = await request(q, signal);
  const folded = foldAccents(q);
  if (!results.length && folded !== q) results = await request(folded, signal);

  cache[key] = { t: Date.now(), results };
  persist();
  return results;
}
