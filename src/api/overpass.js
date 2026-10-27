import { OVERPASS_ENDPOINTS, RADIUS } from '../config.js';
import { createLimiter } from '../lib/http.js';
import { cacheGet, cacheSet } from '../lib/idb.js';

const TTL = 7 * 24 * 3600 * 1000;
const limiter = createLimiter(500, { serial: false });

const GREEN_LEISURE = '^(park|garden|nature_reserve)$';
const GREEN_LANDUSE = '^(grass|forest|recreation_ground|village_green|meadow)$';
const GREEN_NATURAL = '^(wood|scrub|grassland|heath)$';
const STREET_TYPES =
  '^(residential|living_street|pedestrian|footway|path|cycleway|steps|unclassified|tertiary|secondary|primary|trunk)$';

// Snapped point -> four small queries (a single big one outlasts the 10 s limit of
// serverless relays): shops + stops (+ route relations), green areas, trees, street lighting.
export function buildQueries({ lat, lon }) {
  const at = `${lat},${lon}`;
  const { shop, chain, stop, metro, green, park, lit, pad } = RADIUS;
  const greenAround = `(around:${green + pad},${at})`;
  const head = '[out:json][timeout:25];';
  return {
    poi: `${head}
nwr["shop"~"^(supermarket|convenience)$"](around:${shop + pad},${at});
out center tags;
nwr["shop"~"^(supermarket|convenience)$"]["name"~"spar|lidl",i](around:${chain + pad},${at});
out center tags;
nwr["shop"~"^(supermarket|convenience)$"]["brand"~"spar|lidl",i](around:${chain + pad},${at});
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
out body;`,
    green: `${head}
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
out geom;`,
    trees: `${head}
node["natural"="tree"]${greenAround};
out skel qt;`,
    lit: `${head}
way["highway"~"${STREET_TYPES}"](around:${lit + pad},${at});
out geom;`,
  };
}

const REQUEST_TIMEOUT = 20000;

// Per-attempt timeout so a hung server falls through to the next endpoint
// instead of leaving the UI loading forever.
async function post(endpoint, query, signal, timeoutMs) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    return await res.json();
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(ctrl.signal.reason === 'timeout' ? 'Az Overpass szerver nem válaszolt időben.' : e.message);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// `queued` = go through the shared rate limiter; the one-off district download
// must not block area lookups behind it.
async function runOverpass(query, signal, queued = true) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const timeout = queued ? REQUEST_TIMEOUT : 85000;
      const json = queued
        ? await limiter(() => post(endpoint, query, signal, timeout), signal)
        : await post(endpoint, query, signal, timeout);
      if (/runtime error/i.test(json.remark || '')) throw new Error(json.remark);
      return json;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
      lastErr.busy = /\b(429|502|503|504)\b|nem válaszolt/.test(e.message);
    }
  }
  throw lastErr;
}

export const snap = (v) => Math.round(v * 1000) / 1000;

// Runs async tasks with at most `n` in flight (Overpass allows ~2 slots per IP).
async function pool(tasks, n) {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

// The public Overpass servers are often at capacity (502/504): retry with backoff,
// per query, so parts that already succeeded are not repeated.
async function withRetry(task, signal, delays = [2000, 5000]) {
  for (let i = 0; ; i++) {
    try {
      return await task();
    } catch (e) {
      if (e.name === 'AbortError' || !e.busy || i >= delays.length) {
        if (e.busy) e.message = 'Az Overpass szerverek jelenleg túlterheltek. Próbáld újra egy perc múlva.';
        throw e;
      }
      await sleep(delays[i], signal);
    }
  }
}

export async function fetchArea(pt, signal) {
  const snapped = { lat: snap(pt.lat), lon: snap(pt.lon) };
  const key = `ow:v3:${snapped.lat.toFixed(3)},${snapped.lon.toFixed(3)}`;
  const cached = await cacheGet(key, TTL);
  if (cached) return { raw: cached, cached: true };
  const parts = await pool(
    Object.values(buildQueries(snapped)).map((q) => () => withRetry(() => runOverpass(q, signal), signal)),
    2,
  );
  const raw = { elements: parts.flatMap((p) => p.elements || []) };
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
    false,
  );
  await cacheSet(key, raw);
  return raw;
}
