// Downloads the 23 district boundaries (OSM admin_level=9) into public/data/districts.geojson
// so the app does not have to ask Overpass on every cold start.
import { writeFile } from 'node:fs/promises';
import osmtogeojson from 'osmtogeojson';

const query =
  '[out:json][timeout:90];rel["boundary"="administrative"]["admin_level"="9"](47.33,18.9,47.65,19.36);out geom;';
const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass ${res.status}`);
const gj = osmtogeojson(await res.json(), { flatProperties: true });
const keep = gj.features.filter((f) => /Polygon/.test(f.geometry?.type) && /ker/i.test(f.properties?.name || ''));
await writeFile(
  new URL('../public/data/districts.geojson', import.meta.url),
  JSON.stringify({ type: 'FeatureCollection', features: keep.map((f) => ({ ...f, properties: { name: f.properties.name, ref: f.properties.ref } })) }),
);
console.log(`${keep.length} kerület mentve`);
