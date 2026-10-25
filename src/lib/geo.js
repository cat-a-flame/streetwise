const M_LAT = 110540;
const M_LON = 111320;
const rad = (d) => (d * Math.PI) / 180;

// Local flat projection around `o`, in meters. Good enough at city scale.
export const toXY = (o, p) => [
  (p.lon - o.lon) * Math.cos(rad(o.lat)) * M_LON,
  (p.lat - o.lat) * M_LAT,
];
export const fromXY = (o, x, y) => ({
  lat: o.lat + y / M_LAT,
  lon: o.lon + x / (Math.cos(rad(o.lat)) * M_LON),
});

export function haversine(a, b) {
  const R = 6371008.8;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestOnSegment(o, a, b) {
  const [ax, ay] = toXY(o, a);
  const [bx, by] = toXY(o, b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? (-ax * dx - ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { dist: Math.hypot(x, y), x, y };
}

// pts: [{lat, lon}]
export function distToPolyline(o, pts) {
  let best = { dist: Infinity, point: null };
  if (pts.length === 1) {
    return { dist: haversine(o, pts[0]), point: pts[0] };
  }
  for (let i = 1; i < pts.length; i++) {
    const n = nearestOnSegment(o, pts[i - 1], pts[i]);
    if (n.dist < best.dist) best = { dist: n.dist, point: fromXY(o, n.x, n.y) };
  }
  return best;
}

export const lineLength = (pts) => {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += haversine(pts[i - 1], pts[i]);
  return sum;
};

// GeoJSON ring: [[lon, lat], ...]
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// rings: GeoJSON Polygon coordinates (outer ring first, then holes)
export function pointInPolygon(p, rings) {
  if (!rings.length || !pointInRing(p.lon, p.lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(p.lon, p.lat, rings[i])) return false;
  return true;
}

export function distToPolygon(o, rings) {
  if (pointInPolygon(o, rings)) return { dist: 0, point: { lat: o.lat, lon: o.lon } };
  let best = { dist: Infinity, point: null };
  for (const ring of rings) {
    const d = distToPolyline(o, ring.map(([lon, lat]) => ({ lat, lon })));
    if (d.dist < best.dist) best = d;
  }
  return best;
}

export function ringsBBox(rings) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of rings[0]) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return { w, s, e, n };
}

export const inBBox = (p, b) => p.lon >= b.w && p.lon <= b.e && p.lat >= b.s && p.lat <= b.n;

// Flatten Polygon / MultiPolygon geometry into [{rings, bbox}]
export function polygonsOf(geometry) {
  if (!geometry) return [];
  const list =
    geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates
    : [];
  return list.map((rings) => ({ rings, bbox: ringsBBox(rings) }));
}
