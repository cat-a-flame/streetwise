import osmtogeojson from 'osmtogeojson';
import { fetchDistrictsFromOverpass } from './api/overpass.js';
import { DISTRICT_NAMES } from './config.js';
import { pointInPolygon, polygonsOf } from './lib/geo.js';
import { romanToInt } from './lib/util.js';

function districtNumber(props) {
  const text = [props.name, props.official_name, props.ref, props['name:hu']].filter(Boolean).join(' ');
  const m = text.match(/\b([IVXL]{1,5})\.?\s*ker/i) || text.match(/^\s*([IVXL]{1,5})\.?\s*$/);
  const n = m ? romanToInt(m[1].toUpperCase()) : NaN;
  return n >= 1 && n <= 23 ? n : null;
}

function normalise(gj) {
  const byNum = new Map();
  for (const f of gj.features) {
    if (!f.geometry || !/Polygon/.test(f.geometry.type)) continue;
    const num = districtNumber(f.properties || {});
    if (!num || byNum.has(num)) continue;
    byNum.set(num, {
      type: 'Feature',
      geometry: f.geometry,
      properties: { num, name: DISTRICT_NAMES[num] },
    });
  }
  const features = [...byNum.values()].sort((a, b) => a.properties.num - b.properties.num);
  for (const f of features) f._polys = polygonsOf(f.geometry);
  return features;
}

// Prefers a pre-generated /data/districts.geojson (npm run fetch:districts),
// falls back to Overpass (cached in IndexedDB).
export async function loadDistricts(signal) {
  try {
    const res = await fetch('/data/districts.geojson', { signal });
    if (res.ok && /json/.test(res.headers.get('content-type') || '')) {
      const features = normalise(await res.json());
      if (features.length) return features;
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }
  const raw = await fetchDistrictsFromOverpass(signal);
  return normalise(osmtogeojson(raw, { flatProperties: true }));
}

export function findDistrict(features, pt) {
  return (
    features.find((f) =>
      f._polys.some(
        (p) =>
          pt.lon >= p.bbox.w && pt.lon <= p.bbox.e && pt.lat >= p.bbox.s && pt.lat <= p.bbox.n &&
          pointInPolygon(pt, p.rings),
      ),
    ) || null
  );
}

export async function loadSafety() {
  try {
    const res = await fetch('/data/district-safety.json');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
