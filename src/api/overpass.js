import { OVERPASS_ENDPOINTS, RADIUS } from '../config.js';
import { createLimiter } from '../lib/http.js';
import { cacheGet, cacheSet } from '../lib/idb.js';

const TTL = 7 * 24 * 3600 * 1000;
const limiter = createLimiter(1500);

const GREEN_LEISURE = '^(park|garden|nature_reserve)$';
const GREEN_LANDUSE = '^(grass|forest|recreation_ground|village_green|meadow)$';
const GREEN_NATURAL = '^(wood|scrub|grassland|heath)$';
const STREET_TYPES =
  '^(residential|living_street|pedestrian|footway|path|cycleway|steps|unclassified|tertiary|secondary|primary|trunk)$';

// Snapped point -> one request covering shops, stops (+ their route relations),
// green areas, trees and street lighting.
export function buildQuery({ lat, lon }) {
  const at = `${lat},${lon}`;
  const { shop, stop, metro, green, park, lit, pad } = RADIUS;
  const greenAround = `(around:${green + pad},${at})`;
  return `[out:json][timeout:60];
nwr["shop"~"^(supermarket|convenience)$"](around:${shop + pad},${at});
out center tags;
(
  node["highway"="bus_stop"](around:${stop + pad},${at});
  node["railway"="tram_stop"](around:${stop + pad},${at});
)->.surface;
node["railway"="station"]["station"="subway"](around:${metro + pad},${at})->.metro;
node(around.metro:250)["public_transport"="stop_position"]["subway"="yes"]->.metropos;
(.surface;.metro;.metropos;)->.stops;
.stops out body;
rel(bn.stops)["route"~"^(bus|tram|trolleybus|subway)$"];
out body;
(
  way["leisure"~"${GREEN_LEISURE}"]${greenAround};
  rel["leisure"~"${GREEN_LEISURE}"]${greenAround};
  way["landuse"~"${GREEN_LANDUSE}"]${greenAround};
  rel["landuse"~"${GREEN_LANDUSE}"]${greenAround};
  way["natural"~"${GREEN_NATURAL}"]${greenAround};
  rel["natural"~"${GREEN_NATURAL}"]${greenAround};
  way["leisure"="park"](around:${park + pad},${at});
  rel["leisure"="park"](around:${park + pad},${at});
);
out geom;
node["natural"="tree"]${greenAround};
out skel qt;
way["highway"~"${STREET_TYPES}"](around:${lit + pad},${at});
out geom;`;
}

async function runOverpass(query, signal) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const json = await limiter(async () => {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          signal,
        });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        return res.json();
      }, signal);
      if (/runtime error/i.test(json.remark || '')) throw new Error(json.remark);
      return json;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

export const snap = (v) => Math.round(v * 1000) / 1000;

export async function fetchArea(pt, signal) {
  const snapped = { lat: snap(pt.lat), lon: snap(pt.lon) };
  const key = `ow:v1:${snapped.lat.toFixed(3)},${snapped.lon.toFixed(3)}`;
  const cached = await cacheGet(key, TTL);
  if (cached) return { raw: cached, cached: true };
  const raw = await runOverpass(buildQuery(snapped), signal);
  await cacheSet(key, raw);
  return { raw, cached: false };
}

export async function fetchDistrictsFromOverpass(signal) {
  const key = 'districts:v1';
  const cached = await cacheGet(key, 30 * 24 * 3600 * 1000);
  if (cached) return cached;
  const { south, west, north, east } = { south: 47.33, west: 18.9, north: 47.65, east: 19.36 };
  const raw = await runOverpass(
    `[out:json][timeout:90];rel["boundary"="administrative"]["admin_level"="9"](${south},${west},${north},${east});out geom;`,
    signal,
  );
  await cacheSet(key, raw);
  return raw;
}
