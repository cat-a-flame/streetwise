// Downloads the 23 district boundaries (OSM admin_level=9) into public/data/districts.geojson
// so the app does not have to ask Overpass on every cold start.
import { writeFile } from 'node:fs/promises';
import osmtogeojson from 'osmtogeojson';
import { BUDAPEST } from '../src/config.js';
import { ENDPOINTS as OVERPASS_ENDPOINTS } from '../server/overpass-proxy.js';

const { south, west, north, east } = BUDAPEST.bounds;
const query = `[out:json][timeout:90];rel["boundary"="administrative"]["admin_level"="9"](${south},${west},${north},${east});out geom;`;
// Some Overpass servers answer 406 to clients without an identifying User-Agent.
const headers = {
  'User-Agent': 'streetwise/0.1 (https://github.com/cat-a-flame/streetwise)',
  Accept: 'application/json',
};

// 502/504 from overpass-api.de usually means "busy right now": retry a few rounds,
// with a per-attempt timeout so a stalled mirror cannot hang the script.
const ROUNDS = 3;
const ATTEMPT_TIMEOUT_MS = 120_000;
let raw;
for (let round = 1; round <= ROUNDS && !raw; round++) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`[${round}/${ROUNDS}] Lekérdezés: ${endpoint} (akár 2 percig is tarthat)`);
      const res = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, {
        headers,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
      if (/runtime error/i.test(raw.remark || '')) throw new Error(raw.remark);
      break;
    } catch (e) {
      raw = undefined;
      console.warn(`  sikertelen: ${e.name === 'TimeoutError' ? 'időtúllépés' : e.message}`);
    }
  }
  if (!raw && round < ROUNDS) await new Promise((r) => setTimeout(r, 10_000));
}
if (!raw) throw new Error('Egyik Overpass szerver sem válaszolt.');

const gj = osmtogeojson(raw, { flatProperties: true });
const keep = gj.features.filter((f) => /Polygon/.test(f.geometry?.type) && /ker/i.test(f.properties?.name || ''));
await writeFile(
  new URL('../public/data/districts.geojson', import.meta.url),
  JSON.stringify({
    type: 'FeatureCollection',
    features: keep.map((f) => ({ ...f, properties: { name: f.properties.name, ref: f.properties.ref } })),
  }),
);
console.log(`${keep.length} kerület mentve`);
