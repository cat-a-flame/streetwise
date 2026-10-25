// Downloads the 23 district boundaries (OSM admin_level=9) into public/data/districts.geojson
// so the app does not have to ask Overpass on every cold start.
import { writeFile } from 'node:fs/promises';
import osmtogeojson from 'osmtogeojson';
import { BUDAPEST, OVERPASS_ENDPOINTS } from '../src/config.js';

const { south, west, north, east } = BUDAPEST.bounds;
const query = `[out:json][timeout:90];rel["boundary"="administrative"]["admin_level"="9"](${south},${west},${north},${east});out geom;`;
// Some Overpass servers answer 406 to clients without an identifying User-Agent.
const headers = {
  'User-Agent': 'streetwise/0.1 (https://github.com/cat-a-flame/streetwise)',
  Accept: 'application/json',
};

let raw;
for (const endpoint of OVERPASS_ENDPOINTS) {
  try {
    console.log(`Lekérdezés: ${endpoint}`);
    const res = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
    break;
  } catch (e) {
    console.warn(`  sikertelen: ${e.message}`);
  }
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
