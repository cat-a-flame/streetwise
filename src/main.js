import './style.css';
import { analyze } from './analysis.js';
import { fetchArea, PARTS } from './api/overpass.js';
import { geocodeFixed, searchPlaces } from './api/nominatim.js';
import { BUDAPEST } from './config.js';
import { findDistrict, loadDistricts } from './districts.js';
import { DESTINATIONS } from './destinations.js';
import { fetchCar, fetchTransit } from './api/routing.js';
import { debounce, esc, newId } from './lib/util.js';
import * as mapUi from './map.js';
import * as panel from './panel.js';
import { exportJson, loadPlaces, parseImport, savePlaces } from './store.js';

const $ = (sel) => document.querySelector(sel);
const inspectEl = $('#tab-inspect');
const placesEl = $('#tab-places');

const state = {
  districts: [],
  dests: DESTINATIONS.map((d) => ({ ...d, state: 'loading' })),
  routes: {}, // destId -> { transit, car } for the inspected point
  open: new Set(), // destinations whose route options are expanded
  places: loadPlaces(),
  filter: 'all',
  selectedId: null,
  editing: null, // { draft, isNew }
  last: null, // { pt, label, result, cached }
  token: 0,
  abort: null,
};

/* ---------- tabs ---------- */

function showTab(name) {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  inspectEl.hidden = name !== 'inspect';
  placesEl.hidden = name !== 'places';
  if (name === 'places') renderPlaces();
}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) showTab(t.dataset.tab);
});

/* ---------- inspection ---------- */

const inBudapest = (p) => {
  const b = BUDAPEST.bounds;
  return p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
};

function renderInspect() {
  const l = state.last;
  if (!l?.result) return;
  const district = findDistrict(state.districts, l.pt);
  mapUi.highlightDistrict(district?.properties.num);
  inspectEl.innerHTML = panel.renderResult(l.result, {
    district, label: l.label, status: l.status, errors: l.errors, dests: state.dests, routes: state.routes, openIds: state.open,
  });
}

/* ---------- routes to the fixed destinations ---------- */

const destById = (id) => state.dests.find((d) => d.id === id);

function fillDest(id) {
  const el = document.getElementById(`dest-${id}`);
  if (el && state.last) el.innerHTML = panel.renderDest(destById(id), state.routes[id], state.open.has(id), state.last.pt);
}

async function loadRoutes(id) {
  const d = destById(id);
  const from = state.last?.pt;
  if (!d?.lat || !from || state.routes[id]) return;
  const token = state.token;
  state.routes[id] = { pending: true };
  fillDest(id);
  const wrap = (p) => p.then((value) => ({ value }), (e) => ({ error: e.message }));
  const [transit, car] = await Promise.all([wrap(fetchTransit(from, d)), wrap(fetchCar(from, d))]);
  if (token !== state.token) return;
  state.routes[id] = { transit, car };
  fillDest(id);
}

function toggleRoutes(id) {
  if (state.open.has(id)) {
    state.open.delete(id);
    mapUi.clearRoute();
  } else state.open.add(id);
  fillDest(id);
}

function showRoute(id, kind, i) {
  const r = state.routes[id];
  if (!r) return;
  if (kind === 'car') mapUi.showRoute([{ geometry: r.car.value.geometry, color: '#17375e' }]);
  else mapUi.showRoute(r.transit.value[i].legs.map((l) => ({ geometry: l.geometry, color: l.color, dashed: !l.transit })));
  document.querySelectorAll(`#dest-${id} .route`).forEach((b) => b.classList.toggle('sel', b.dataset.kind === kind && Number(b.dataset.i) === i));
}

async function inspect(pt, { label = null } = {}) {
  if (!inBudapest(pt)) {
    inspectEl.innerHTML = panel.renderError('A kiválasztott pont Budapesten kívül van.');
    return;
  }
  const token = ++state.token;
  state.routes = {};
  state.open.clear();
  mapUi.clearRoute();
  state.abort?.abort();
  state.abort = new AbortController();
  const elements = {};
  const status = Object.fromEntries(PARTS.map((n) => [n, 'pending']));
  const errors = {};
  state.last = { pt, label, status, errors, result: analyze({ elements: [] }, pt) };
  showTab('inspect');
  inspectEl.scrollTop = 0;

  const update = () => {
    const result = analyze({ elements: Object.values(elements).flat() }, pt);
    state.last = { pt, label, status, errors, result };
    mapUi.showInspection(result, pt);
    renderInspect();
  };
  update();
  for (const d of state.dests) if (d.lat) loadRoutes(d.id);

  try {
    await fetchArea(pt, state.abort.signal, (name, r) => {
      if (token !== state.token) return;
      if (r.error) {
        status[name] = 'failed';
        errors[name] = r.error.detail || r.error.message;
      } else {
        status[name] = 'ok';
        elements[name] = r.elements;
      }
      update();
    });
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

inspectEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, key } = b.dataset;
  const l = state.last;
  if (act === 'focus') mapUi.focusMarker(key);
  else if (act === 'retry' && l) inspect(l.pt, { label: l.label });
  else if (act === 'routes') toggleRoutes(b.dataset.dest);
  else if (act === 'show-route') showRoute(b.dataset.dest, b.dataset.kind, Number(b.dataset.i));
  else if (act === 'mark-point' && l) {
    openForm({ geometry: { type: 'Point', coordinates: [l.pt.lon, l.pt.lat] }, name: l.label || l.result?.street?.name || '' }, true);
  } else if (act === 'mark-street' && l?.result?.street) {
    openForm({ geometry: l.result.street.geometry, name: l.result.street.name }, true);
  }
});

/* ---------- my places ---------- */

function persist() {
  if (!savePlaces(state.places)) flash('A böngésző nem engedi a mentést (tele a tárhely?). Exportáld a helyeket!');
  $('#count').textContent = state.places.length ? `(${state.places.length})` : '';
}

function flash(msg) {
  const el = $('#io-msg');
  if (el) el.textContent = msg;
  else alert(msg);
}

function renderPlaces() {
  if (state.editing) {
    placesEl.innerHTML = panel.renderPlaceForm(state.editing.draft, state.editing.isNew);
    return;
  }
  placesEl.innerHTML = panel.renderPlacesList(state.places, state.filter, state.selectedId);
}

function syncMap() {
  mapUi.renderPlaces(state.places, state.selectedId);
}

function openForm(partial, isNew) {
  const now = Date.now();
  const draft = isNew
    ? { id: newId(), status: 'neutral', note: '', createdAt: now, updatedAt: now, name: '', ...partial }
    : { ...partial };
  state.editing = { draft, isNew };
  mapUi.showDraft(draft.geometry, draft.status);
  showTab('places');
  placesEl.querySelector('[name=name]')?.focus();
}

function closeForm() {
  state.editing = null;
  mapUi.showDraft(null);
  renderPlaces();
}

placesEl.addEventListener('change', (e) => {
  if (e.target.name === 'status' && state.editing) {
    state.editing.draft.status = e.target.value;
    mapUi.showDraft(state.editing.draft.geometry, e.target.value);
  }
});

placesEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const d = state.editing.draft;
  const saved = {
    ...d,
    name: form.name.value.trim(),
    note: form.note.value.trim(),
    status: form.status.value,
    updatedAt: Date.now(),
  };
  const i = state.places.findIndex((p) => p.id === saved.id);
  if (i >= 0) state.places[i] = saved;
  else state.places.push(saved);
  state.selectedId = saved.id;
  persist();
  syncMap();
  closeForm();
});

placesEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id, k } = b.dataset;
  if (act === 'filter') {
    state.filter = k;
    renderPlaces();
  } else if (act === 'zoom') {
    state.selectedId = id;
    mapUi.zoomToPlace(id);
    syncMap();
    renderPlaces();
  } else if (act === 'edit') {
    const p = state.places.find((x) => x.id === id);
    if (p) openForm(p, false);
  } else if (act === 'cancel-form') closeForm();
  else if (act === 'delete') {
    const d = state.editing.draft;
    if (!confirm(`Biztosan törlöd: ${d.name || 'névtelen hely'}?`)) return;
    state.places = state.places.filter((p) => p.id !== d.id);
    state.selectedId = null;
    persist();
    syncMap();
    closeForm();
  } else if (act === 'export') {
    const blob = new Blob([exportJson(state.places)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `streetwise-helyek-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } else if (act === 'import') $('#import-file').click();
});

placesEl.addEventListener('change', async (e) => {
  if (e.target.id !== 'import-file') return;
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { places, skipped } = parseImport(await file.text());
    const byId = new Map(state.places.map((p) => [p.id, p]));
    for (const p of places) byId.set(p.id, p);
    state.places = [...byId.values()];
    persist();
    syncMap();
    renderPlaces();
    flash(`${places.length} hely beimportálva${skipped ? `, ${skipped} érvénytelen kihagyva` : ''}.`);
  } catch (err) {
    flash(err.message);
  }
});

/* ---------- drawing ---------- */

const drawbar = $('#drawbar');
function onDrawChange({ mode, count }) {
  drawbar.hidden = !mode;
  document.querySelectorAll('[data-draw]').forEach((b) => b.classList.toggle('on', (b.dataset.draw === mode)));
  if (!mode) return;
  const need = mode === 'polygon' ? 3 : 2;
  $('#drawhint').textContent =
    (mode === 'polygon' ? 'Terület: ' : 'Utca: ') +
    (count < need ? `kattints a térképen (legalább ${need} pont), most ${count}` : `${count} pont, kattints tovább vagy nyomd meg a Kész gombot`);
  drawbar.querySelector('[data-draw-act=finish]').disabled = count < need;
}

document.querySelector('.tools').addEventListener('click', (e) => {
  const b = e.target.closest('[data-draw]');
  if (!b) return;
  if (mapUi.isDrawing() && b.classList.contains('on')) mapUi.cancelDraw();
  else mapUi.startDraw(b.dataset.draw);
});
drawbar.addEventListener('click', (e) => {
  const act = e.target.closest('[data-draw-act]')?.dataset.drawAct;
  if (act === 'undo') mapUi.undoVertex();
  else if (act === 'cancel') mapUi.cancelDraw();
  else if (act === 'finish') {
    const geometry = mapUi.finishDraw();
    if (geometry) openForm({ geometry }, true);
  }
});

/* ---------- search ---------- */

const qEl = $('#q');
const listEl = $('#results');
let results = [];
let active = -1;
let searchAbort;

function renderResults(msg) {
  if (msg) listEl.innerHTML = `<li class="msg">${esc(msg)}</li>`;
  else {
    listEl.innerHTML = results
      .map(
        (r, i) => `<li role="option" data-i="${i}" class="${i === active ? 'on' : ''}"><b>${esc(r.name)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</li>`,
      )
      .join('');
  }
  listEl.hidden = false;
}

function pick(i) {
  const r = results[i];
  if (!r) return;
  listEl.hidden = true;
  qEl.value = r.name;
  mapUi.showOutline(r.outline);
  if (r.bbox && r.outline) mapUi.fitBBox(r.bbox);
  else mapUi.flyToPoint(r, 16);
  inspect({ lat: r.lat, lon: r.lon }, { label: r.name });
}

const runSearch = debounce(async () => {
  const q = qEl.value;
  searchAbort?.abort();
  if (q.trim().length < 3) {
    listEl.hidden = true;
    return;
  }
  searchAbort = new AbortController();
  renderResults('Keresés…');
  try {
    results = await searchPlaces(q, searchAbort.signal);
    active = -1;
    results.length ? renderResults() : renderResults('Nincs találat Budapesten.');
  } catch (e) {
    if (e.name !== 'AbortError') renderResults('A keresés nem sikerült, próbáld újra.');
  }
}, 450);

qEl.addEventListener('input', runSearch);
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!results.length || listEl.hidden) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    renderResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (active >= 0) pick(active);
    else if (results.length && !listEl.hidden) pick(0);
  } else if (e.key === 'Escape') listEl.hidden = true;
});
listEl.addEventListener('click', (e) => {
  const li = e.target.closest('[data-i]');
  if (li) pick(Number(li.dataset.i));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) listEl.hidden = true;
});

/* ---------- boot ---------- */

mapUi.initMap($('#map'), {
  onMapClick: (pt) => inspect(pt),
  onPlaceClick: (id) => {
    if (state.editing) return;
    state.selectedId = id;
    syncMap();
    showTab('places');
    placesEl.querySelector('.place.sel')?.scrollIntoView({ block: 'nearest' });
  },
  onDrawChange,
});
inspectEl.innerHTML = panel.renderIdle();
persist();
syncMap();

(async () => {
  for (const d of state.dests) {
    try {
      const hit = await geocodeFixed(d.id, d.queries);
      Object.assign(d, hit ? { ...hit, state: 'ready' } : { state: 'missing' });
    } catch {
      d.state = 'missing';
    }
    mapUi.setDestinations(state.dests);
    if (state.last?.result) {
      renderInspect();
      if (d.lat) loadRoutes(d.id);
    }
  }
})();
loadDistricts()
  .then((features) => {
    state.districts = features;
    mapUi.setDistricts(features);
    renderInspect();
    if (state.last) mapUi.highlightDistrict(findDistrict(features, state.last.pt)?.properties.num);
  })
  .catch(() => {
    $('#map').insertAdjacentHTML('beforeend', '<div class="map-note">A kerülethatárokat nem sikerült betölteni.</div>');
  });
