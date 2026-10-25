import { STATUS } from './config.js';

const KEY = 'sw:places:v1';
const GEOM_OK = {
  Point: (c) => Array.isArray(c) && c.length >= 2 && c.every(Number.isFinite),
  LineString: (c) => Array.isArray(c) && c.length >= 2 && c.every(GEOM_OK_POINT),
  MultiLineString: (c) => Array.isArray(c) && c.length >= 1 && c.every((l) => Array.isArray(l) && l.length >= 2 && l.every(GEOM_OK_POINT)),
  Polygon: (c) => Array.isArray(c) && c.length >= 1 && c.every((r) => Array.isArray(r) && r.length >= 4 && r.every(GEOM_OK_POINT)),
};
function GEOM_OK_POINT(p) {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

export function sanitizePlace(p) {
  if (!p || typeof p !== 'object') return null;
  const g = p.geometry;
  if (!g || !GEOM_OK[g.type]?.(g.coordinates)) return null;
  if (!STATUS[p.status]) return null;
  return {
    id: String(p.id || ''),
    name: String(p.name ?? '').slice(0, 120),
    note: String(p.note ?? '').slice(0, 4000),
    status: p.status,
    geometry: { type: g.type, coordinates: g.coordinates },
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Number(p.updatedAt) || Date.now(),
  };
}

export function loadPlaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return (raw?.places || []).map(sanitizePlace).filter((p) => p && p.id);
  } catch {
    return [];
  }
}

export function savePlaces(places) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, places }));
    return true;
  } catch {
    return false;
  }
}

export function exportJson(places) {
  return JSON.stringify({ app: 'streetwise', version: 1, exportedAt: new Date().toISOString(), places }, null, 2);
}

// Returns valid places; throws on unusable input.
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Érvénytelen JSON fájl.');
  }
  const list = Array.isArray(data) ? data : data?.places;
  if (!Array.isArray(list)) throw new Error('A fájlban nincs „places” lista.');
  const places = list.map(sanitizePlace).filter((p) => p && p.id);
  if (!places.length && list.length) throw new Error('Egyetlen hely sem volt érvényes.');
  return { places, skipped: list.length - places.length };
}
