import osmtogeojson from 'osmtogeojson';
import { MODE_ORDER, RADIUS, WALK_DETOUR, WALK_M_PER_MIN } from './config.js';
import {
  distToPolygon, distToPolyline, fromXY, haversine, inBBox, pointInPolygon, polygonsOf,
} from './lib/geo.js';

const ROUTE_MODE = { subway: 'metro', tram: 'tram', bus: 'bus', trolleybus: 'trolleybus' };
const TAG_MODE = { subway: 'metro', tram: 'tram', bus: 'bus', trolleybus: 'trolleybus' };
const MAX_STOPS = { metro: 2, tram: 2, bus: 3, trolleybus: 2 };
const ROAD_TYPES = new Set([
  'residential', 'living_street', 'pedestrian', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk',
]);
const LIT_YES = new Set(['yes', '24/7', 'automatic', 'sunset-sunrise', 'night']);

const GREEN = {
  leisure: new Set(['park', 'garden', 'nature_reserve']),
  landuse: new Set(['grass', 'forest', 'recreation_ground', 'village_green', 'meadow']),
  natural: new Set(['wood', 'scrub', 'grassland', 'heath']),
};
const isGreenTags = (t) =>
  !!t && !t.highway && (GREEN.leisure.has(t.leisure) || GREEN.landuse.has(t.landuse) || GREEN.natural.has(t.natural));

// Green score constants: 10 = >=30% green cover, >=150 trees, park within 100 m
const SCORE = { cover: 0.3, trees: 150, parkFar: 800 };

export const walkInfo = (straightM) => {
  const m = straightM * WALK_DETOUR;
  return { meters: m, minutes: Math.max(1, Math.round(m / WALK_M_PER_MIN)) };
};

const coordOf = (el) =>
  el.lat != null ? { lat: el.lat, lon: el.lon } : el.center ? { lat: el.center.lat, lon: el.center.lon } : null;

function lineLabel(tags, mode) {
  const ref = tags.ref?.trim();
  if (!ref) return null;
  return mode === 'metro' && /^\d+$/.test(ref) ? `M${ref}` : ref;
}

const lineSort = (a, b) => {
  const na = parseInt(a.replace(/\D/g, ''), 10);
  const nb = parseInt(b.replace(/\D/g, ''), 10);
  return (isNaN(na) ? 1e9 : na) - (isNaN(nb) ? 1e9 : nb) || a.localeCompare(b, 'hu');
};

function analyzeShops(els, pt) {
  return els
    .filter((e) => e.tags && (e.tags.shop === 'supermarket' || e.tags.shop === 'convenience'))
    .map((e) => {
      const c = coordOf(e);
      if (!c) return null;
      const dist = haversine(pt, c);
      return {
        ...c,
        dist,
        walk: walkInfo(dist),
        type: e.tags.shop,
        name: e.tags.name || e.tags.brand || (e.tags.shop === 'supermarket' ? 'Szupermarket' : 'Kisbolt'),
      };
    })
    .filter((s) => s && s.dist <= RADIUS.shop)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);
}

function analyzeTransport(els, pt) {
  // node id -> mode -> Set(line)
  const nodeLines = new Map();
  for (const rel of els) {
    const mode = rel.type === 'relation' && ROUTE_MODE[rel.tags?.route];
    if (!mode) continue;
    const line = lineLabel(rel.tags, mode);
    for (const m of rel.members || []) {
      if (m.type !== 'node') continue;
      if (!nodeLines.has(m.ref)) nodeLines.set(m.ref, new Map());
      const byMode = nodeLines.get(m.ref);
      if (!byMode.has(mode)) byMode.set(mode, new Set());
      if (line) byMode.get(mode).add(line);
    }
  }

  const stops = [];
  for (const el of els) {
    const t = el.tags;
    if (el.type !== 'node' || !t) continue;
    const isStop =
      t.highway === 'bus_stop' || t.railway === 'tram_stop' ||
      (t.railway === 'station' && t.station === 'subway') || t.public_transport === 'stop_position';
    if (!isStop) continue;

    const fromRoutes = nodeLines.get(el.id);
    let modes = fromRoutes ? [...fromRoutes.keys()] : [];
    if (!modes.length) {
      if (t.highway === 'bus_stop') modes = ['bus'];
      else if (t.railway === 'tram_stop') modes = ['tram'];
      else if (t.railway === 'station') modes = ['metro'];
      else modes = Object.keys(TAG_MODE).filter((k) => t[k] === 'yes').map((k) => TAG_MODE[k]);
    }
    const lines = {};
    for (const m of modes) {
      lines[m] = new Set(fromRoutes?.get(m) || []);
      if (m === 'metro' && t.line) for (const l of t.line.split(';')) lines[m].add(/^\d$/.test(l.trim()) ? `M${l.trim()}` : l.trim());
    }
    stops.push({ lat: el.lat, lon: el.lon, name: t.name || '', modes, lines, dist: haversine(pt, el) });
  }

  const out = {};
  for (const mode of MODE_ORDER) {
    const limit = mode === 'metro' ? RADIUS.metro : RADIUS.stop;
    const cands = stops.filter((s) => s.modes.includes(mode) && s.dist <= limit).sort((a, b) => a.dist - b.dist);
    const seen = new Set();
    const picked = [];
    for (const s of cands) {
      const key = s.name ? s.name.toLocaleLowerCase('hu') : `${s.lat},${s.lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Both directions of a stop are separate OSM nodes: merge their lines.
      const lines = new Set();
      for (const o of cands) {
        const related = o.name.toLocaleLowerCase('hu') === s.name.toLocaleLowerCase('hu') || mode === 'metro';
        if (related && haversine(s, o) <= 200) for (const l of o.lines[mode]) lines.add(l);
      }
      picked.push({
        mode, lat: s.lat, lon: s.lon, dist: s.dist, walk: walkInfo(s.dist),
        name: s.name || 'névtelen megálló',
        lines: [...lines].sort(lineSort),
      });
      if (picked.length >= MAX_STOPS[mode]) break;
    }
    out[mode] = picked;
  }
  return out;
}

function analyzeGreen(els, pt) {
  const greenEls = els.filter((e) => isGreenTags(e.tags) && (e.geometry || e.members));
  const gj = osmtogeojson({ elements: greenEls }, { flatProperties: true });
  const features = gj.features.filter((f) => /Polygon/.test(f.geometry?.type));
  const polys = features.flatMap((f) => polygonsOf(f.geometry).map((p) => ({ ...p, props: f.properties })));

  // Sample the 400 m circle on a 20 m grid and count the cells that fall in a green polygon.
  const r = RADIUS.green;
  const step = 20;
  let total = 0;
  let green = 0;
  for (let y = -r; y <= r; y += step) {
    for (let x = -r; x <= r; x += step) {
      if (x * x + y * y > r * r) continue;
      total++;
      const p = fromXY(pt, x, y);
      if (polys.some((po) => inBBox(p, po.bbox) && pointInPolygon(p, po.rings))) green++;
    }
  }
  const coverage = total ? green / total : 0;

  // Trees come back as `out skel` (no tags): any untagged node is a tree.
  let trees = 0;
  for (const el of els) if (el.type === 'node' && !el.tags && haversine(pt, el) <= r) trees++;

  let nearestPark = null;
  for (const po of polys) {
    if (po.props.leisure !== 'park') continue;
    const d = distToPolygon(pt, po.rings);
    if (!nearestPark || d.dist < nearestPark.dist) {
      nearestPark = { dist: d.dist, lat: d.point.lat, lon: d.point.lon, name: po.props.name || 'névtelen park' };
    }
  }
  if (nearestPark && nearestPark.dist > RADIUS.park) nearestPark = null;
  if (nearestPark) nearestPark.walk = walkInfo(nearestPark.dist);

  const parkTerm = nearestPark ? 1 - Math.min(Math.max(nearestPark.dist - 100, 0) / SCORE.parkFar, 1) : 0;
  const score = Math.round(
    10 * (0.5 * Math.min(coverage / SCORE.cover, 1) + 0.3 * Math.min(trees / SCORE.trees, 1) + 0.2 * parkTerm),
  );
  return { coverage, trees, nearestPark, score };
}

function analyzeStreets(els, pt) {
  const ways = els
    .filter((e) => e.type === 'way' && e.tags?.highway && e.geometry?.length > 1)
    .map((e) => ({ tags: e.tags, pts: e.geometry.map((g) => ({ lat: g.lat, lon: g.lon })) }));

  let lit = 0, unlit = 0, unknown = 0;
  for (const w of ways) {
    const status = LIT_YES.has(w.tags.lit) ? 'lit' : w.tags.lit === 'no' ? 'unlit' : 'unknown';
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1], b = w.pts[i];
      const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      if (haversine(pt, mid) > RADIUS.lit) continue;
      const len = haversine(a, b);
      if (status === 'lit') lit += len;
      else if (status === 'unlit') unlit += len;
      else unknown += len;
    }
  }
  const all = lit + unlit + unknown;
  const tagged = lit + unlit;
  const litShare = {
    share: tagged > 0 ? lit / tagged : null, // among ways that carry a lit tag
    coverage: all > 0 ? tagged / all : 0, // how much of the street network is tagged at all
    totalKm: all / 1000,
  };

  let nearest = null;
  for (const w of ways) {
    if (!w.tags.name || !ROAD_TYPES.has(w.tags.highway)) continue;
    const d = distToPolyline(pt, w.pts).dist;
    if (!nearest || d < nearest.dist) nearest = { dist: d, name: w.tags.name };
  }
  let street = null;
  if (nearest && nearest.dist <= 120) {
    const lines = ways
      .filter((w) => w.tags.name === nearest.name && ROAD_TYPES.has(w.tags.highway))
      .map((w) => w.pts.map((p) => [p.lon, p.lat]));
    street = { name: nearest.name, dist: nearest.dist, geometry: { type: 'MultiLineString', coordinates: lines } };
  }
  return { litShare, street };
}

// `out geom` puts null in geometry arrays for nodes it could not resolve.
function dropNullGeometry(els) {
  for (const el of els) {
    if (el.geometry) el.geometry = el.geometry.filter(Boolean);
    if (el.members) for (const m of el.members) if (m.geometry) m.geometry = m.geometry.filter(Boolean);
  }
  return els;
}

export function analyze(raw, pt) {
  const els = dropNullGeometry(raw.elements || []);
  const transport = analyzeTransport(els, pt);
  const { litShare, street } = analyzeStreets(els, pt);
  return {
    point: pt,
    shops: analyzeShops(els, pt),
    transport,
    green: analyzeGreen(els, pt),
    lit: litShare,
    street,
  };
}

