import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BUDAPEST, MODES, STATUS, TILE_ATTRIBUTION, TILE_URL, RADIUS } from './config.js';
import { esc, intToRoman as toRoman } from './lib/util.js';

const DISTRICT_STYLE = { color: '#17375e', weight: 1.2, opacity: 0.7, fillColor: '#17375e', fillOpacity: 0.025 };
const DISTRICT_HOVER = { fillOpacity: 0.1, weight: 2 };
const DISTRICT_ACTIVE = { fillOpacity: 0.14, weight: 2.5, opacity: 1 };

let map, handlers;
let districtLayer, activeDistrict;
let inspectLayer, outlineLayer, placesLayer, draftLayer, drawLayer, destLayer, routeLayer;
const markerByKey = new Map();
const placeLayers = new Map();

const draw = { mode: null, pts: [] };

export function initMap(el, h) {
  handlers = h;
  const { south, west, north, east } = BUDAPEST.bounds;
  map = L.map(el, {
    center: BUDAPEST.center,
    zoom: BUDAPEST.zoom,
    minZoom: 10,
    maxBounds: [[south - 0.1, west - 0.15], [north + 0.1, east + 0.15]],
    zoomControl: false,
  });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);

  map.createPane('districts').style.zIndex = 350;
  map.createPane('places').style.zIndex = 450;
  inspectLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  destLayer = L.layerGroup().addTo(map);
  outlineLayer = L.layerGroup().addTo(map);
  placesLayer = L.layerGroup().addTo(map);
  draftLayer = L.layerGroup().addTo(map);
  drawLayer = L.layerGroup().addTo(map);

  const labelsByZoom = () => el.classList.toggle('hide-dlabels', map.getZoom() >= 15);
  map.on('zoomend', labelsByZoom);
  labelsByZoom();

  map.on('click', (e) => {
    if (draw.mode) return addVertex(e.latlng);
    handlers.onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && draw.mode) cancelDraw();
  });
  return map;
}

/* ---------- districts ---------- */

export function setDistricts(features) {
  districtLayer?.remove();
  districtLayer = L.geoJSON(features, {
    pane: 'districts',
    style: () => DISTRICT_STYLE,
    onEachFeature(f, layer) {
      const { num, name } = f.properties;
      layer.bindTooltip(
        `<b>${toRoman(num)}.</b><span>${esc(name)}</span>`,
        { permanent: true, direction: 'center', className: 'dlabel', interactive: false },
      );
      layer.on('mouseover', () => layer !== activeDistrict && layer.setStyle(DISTRICT_HOVER));
      layer.on('mouseout', () => layer !== activeDistrict && layer.setStyle(DISTRICT_STYLE));
      layer._num = num;
    },
  }).addTo(map);
}

export function highlightDistrict(num) {
  if (activeDistrict) activeDistrict.setStyle(DISTRICT_STYLE);
  activeDistrict = null;
  if (!districtLayer || !num) return;
  districtLayer.eachLayer((l) => {
    if (l._num === num) {
      activeDistrict = l;
      l.setStyle(DISTRICT_ACTIVE);
    }
  });
}

/* ---------- inspection ---------- */

const pinIcon = L.divIcon({ className: 'pin', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 11] });

function badge(letter, color, text, title) {
  return L.divIcon({
    className: 'badge-wrap',
    html: `<span class="badge" style="background:${color};color:${text}" title="${esc(title)}">${esc(letter)}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export function showInspection(result, pt) {
  clearInspection();
  L.circle([pt.lat, pt.lon], {
    radius: RADIUS.green, color: '#17375e', weight: 1, dashArray: '4 5', fillOpacity: 0, interactive: false,
  }).addTo(inspectLayer);
  L.marker([pt.lat, pt.lon], { icon: pinIcon, keyboard: false, zIndexOffset: 1000 }).addTo(inspectLayer);

  const add = (key, item, icon, lines) => {
    const m = L.marker([item.lat, item.lon], { icon, title: item.name }).addTo(inspectLayer);
    m.bindPopup(`<b>${esc(item.name)}</b><br>${lines.map(esc).join('<br>')}`);
    markerByKey.set(key, m);
  };

  result.shops.forEach((s, i) =>
    add(`shop-${i}`, s, badge('É', '#2e6f40', '#fff', 'Élelmiszerbolt'), [s.type === 'supermarket' ? 'Szupermarket' : 'Kisbolt']));
  for (const [mode, stops] of Object.entries(result.transport)) {
    const mm = MODES[mode];
    stops.forEach((s, i) =>
      add(`${mode}-${i}`, s, badge(mm.letter, mm.color, mm.text, mm.label), [mm.label, s.lines.join(', ')]));
  }
  if (result.green.nearestPark) {
    add('park', result.green.nearestPark, badge('P', '#5b8a3c', '#fff', 'Park'), ['Legközelebbi park']);
  }
}

export function clearInspection() {
  inspectLayer.clearLayers();
  markerByKey.clear();
}

export function focusMarker(key) {
  const m = markerByKey.get(key);
  if (!m) return;
  map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.4 });
  m.openPopup();
}

export function showOutline(geojson) {
  outlineLayer.clearLayers();
  if (!geojson) return;
  L.geoJSON(geojson, {
    interactive: false,
    style: { color: '#17375e', weight: 2, dashArray: '6 4', fillOpacity: 0.04 },
  }).addTo(outlineLayer);
}

export function flyToPoint(pt, zoom = 16) {
  map.flyTo([pt.lat, pt.lon], Math.max(map.getZoom(), zoom), { duration: 0.5 });
}

export function fitBBox(b) {
  map.fitBounds([[b.s, b.w], [b.n, b.e]], { maxZoom: 16, padding: [40, 40] });
}

/* ---------- destinations & routes ---------- */

const DEST_COLOR = '#b45f06';

export function setDestinations(list) {
  destLayer.clearLayers();
  for (const d of list) {
    if (!d.lat) continue;
    L.marker([d.lat, d.lon], { icon: badge(d.short, DEST_COLOR, '#fff', d.name), title: d.name, zIndexOffset: 800 })
      .bindPopup(`<b>${esc(d.name)}</b><br>${esc(d.label || '')}`)
      .addTo(destLayer);
  }
}

export function showRoute(legs) {
  routeLayer.clearLayers();
  const all = [];
  for (const leg of legs) {
    if (leg.geometry.length < 2) continue;
    all.push(...leg.geometry);
    const style = leg.dashed
      ? { color: '#555', weight: 4, dashArray: '2 7', opacity: 0.9 }
      : { color: leg.color || '#17375e', weight: 6, opacity: 0.85 };
    L.polyline(leg.geometry, { ...style, interactive: false }).addTo(routeLayer);
  }
  if (all.length) map.fitBounds(all, { padding: [50, 50], maxZoom: 16 });
}

export function clearRoute() {
  routeLayer.clearLayers();
}

/* ---------- saved places ---------- */

function placeStyle(status) {
  const color = STATUS[status].color;
  return { color, weight: 5, opacity: 0.85, fillColor: color, fillOpacity: 0.28, pane: 'places', bubblingMouseEvents: false };
}

function layerFor(place, extra = {}) {
  return L.geoJSON(place.geometry, {
    style: () => placeStyle(place.status),
    pointToLayer: (_, ll) => L.circleMarker(ll, { ...placeStyle(place.status), radius: 9, fillOpacity: 0.7, ...extra }),
  });
}

export function renderPlaces(places, selectedId) {
  placesLayer.clearLayers();
  placeLayers.clear();
  for (const p of places) {
    const layer = layerFor(p);
    layer.eachLayer((l) => {
      l.on('click', () => handlers.onPlaceClick(p.id));
      if (p.id === selectedId) l.setStyle?.({ weight: 8, fillOpacity: 0.4 });
    });
    layer.bindTooltip(esc(p.name || STATUS[p.status].label), { sticky: true, className: 'ptip' });
    layer.addTo(placesLayer);
    placeLayers.set(p.id, layer);
  }
}

export function zoomToPlace(id) {
  const layer = placeLayers.get(id);
  if (!layer) return;
  const b = layer.getBounds();
  if (b.getNorthEast().equals(b.getSouthWest())) map.flyTo(b.getCenter(), 17, { duration: 0.4 });
  else map.flyToBounds(b, { maxZoom: 17, padding: [60, 60], duration: 0.4 });
}

export function showDraft(geometry, status) {
  draftLayer.clearLayers();
  if (!geometry) return;
  layerFor({ geometry, status }, { interactive: false }).addTo(draftLayer);
}

/* ---------- drawing ---------- */

function renderDraw() {
  drawLayer.clearLayers();
  const ll = draw.pts.map((p) => [p.lat, p.lng]);
  const style = { color: '#17375e', weight: 3, dashArray: '5 5', interactive: false };
  if (draw.mode === 'polygon' && ll.length >= 3) L.polygon(ll, { ...style, fillOpacity: 0.12 }).addTo(drawLayer);
  else if (ll.length >= 2) L.polyline(ll, style).addTo(drawLayer);
  for (const p of ll) L.circleMarker(p, { radius: 4, color: '#17375e', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(drawLayer);
  handlers.onDrawChange?.({ mode: draw.mode, count: draw.pts.length });
}

function addVertex(latlng) {
  draw.pts.push(latlng);
  renderDraw();
}

export function startDraw(mode) {
  draw.mode = mode;
  draw.pts = [];
  map.getContainer().classList.add('drawing');
  renderDraw();
}

export function undoVertex() {
  draw.pts.pop();
  renderDraw();
}

export function cancelDraw() {
  draw.mode = null;
  draw.pts = [];
  drawLayer.clearLayers();
  map.getContainer().classList.remove('drawing');
  handlers.onDrawChange?.({ mode: null, count: 0 });
}

export function finishDraw() {
  const { mode, pts } = draw;
  const need = mode === 'polygon' ? 3 : 2;
  if (!mode || pts.length < need) return null;
  const coords = pts.map((p) => [p.lng, p.lat]);
  const geometry =
    mode === 'polygon'
      ? { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
      : { type: 'LineString', coordinates: coords };
  cancelDraw();
  return geometry;
}

export const isDrawing = () => !!draw.mode;
