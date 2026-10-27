import { MODES, MODE_ORDER, STATUS } from './config.js';
import { haversine } from './lib/geo.js';
import { esc, fmtDist, fmtNum } from './lib/util.js';
import { fmtClock } from './lib/time.js';
import { intToRoman } from './lib/util.js';

const walk = (w) => `<span class="num">~${fmtDist(w.meters)}</span> <span class="dim">· ~${w.minutes} perc séta</span>`;

export function renderIdle() {
  return `<div class="empty">
    <h2>Válassz egy helyet</h2>
    <p>Kattints a térképre, vagy keress rá egy utcára vagy városrészre (pl. <em>Istvánmező</em>). Megmutatjuk a boltokat, a megállókat, a zöldterületet és a közvilágítást a környéken.</p>
  </div>`;
}

export function renderLoading(pt) {
  return `<div class="loading"><span class="spin"></span> Környék lekérdezése…<div class="dim">${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}</div></div>`;
}

export function renderError(msg, detail) {
  return `<div class="error"><b>Nem sikerült lekérdezni az adatokat.</b><p>${esc(msg)}</p>${detail ? `<p class="note tech">${esc(detail)}</p>` : ''}<button class="btn" data-act="retry">Újra</button></div>`;
}

function shops(list) {
  if (!list.length) return `<p class="dim">1,5 km-en belül nincs szupermarket vagy kisbolt az OSM-ben.</p>`;
  return `<ul class="rows">${list
    .map(
      (s, i) => `<li><button class="row" data-act="focus" data-key="shop-${i}">
        <span class="row-main">${esc(s.name)}<small>${s.extra ? `legközelebbi ${esc(s.extra)}` : s.type === 'supermarket' ? 'Szupermarket' : 'Kisbolt'}</small></span>
        <span class="row-side">${walk(s.walk)}</span></button></li>`,
    )
    .join('')}</ul>`;
}

function transport(t) {
  return MODE_ORDER.map((mode) => {
    const mm = MODES[mode];
    const stops = t[mode];
    const body = stops.length
      ? stops
          .map(
            (s, i) => `<button class="row" data-act="focus" data-key="${mode}-${i}">
          <span class="row-main">${esc(s.name)}
            <span class="chips">${s.lines.map((l) => `<span class="chip" style="--c:${mm.color}">${esc(l)}</span>`).join('') || '<small>vonalak nincsenek az OSM-ben</small>'}</span>
          </span>
          <span class="row-side">${walk(s.walk)}</span></button>`,
          )
          .join('')
      : `<p class="dim">Nincs a közelben.</p>`;
    return `<div class="mode"><h4><span class="sq" style="background:${mm.color};color:${mm.text}">${mm.letter}</span>${mm.label}</h4>${body}</div>`;
  }).join('');
}

function green(g) {
  const pct = Math.round(g.coverage * 100);
  const park = g.nearestPark
    ? `<button class="row" data-act="focus" data-key="park"><span class="row-main">${esc(g.nearestPark.name)}<small>legközelebbi park</small></span><span class="row-side">${
        g.nearestPark.dist < 5 ? '<span class="num">bent vagy</span>' : walk(g.nearestPark.walk)
      }</span></button>`
    : `<p class="dim">1,2 km-en belül nincs park az OSM-ben.</p>`;
  return `
    <div class="score" title="Súlyozás: zöldfelület 50%, fák 30%, park távolsága 20%. 10 = ≥30% zöld, ≥150 fa, park 100 m-en belül.">
      <span class="score-n">${g.score}<small>/10</small></span>
      <span class="score-l">zöld pontszám</span>
    </div>
    <dl class="kv">
      <div><dt>Zöldfelület 400 m-en belül</dt><dd><span class="num">${pct}%</span></dd></div>
      <div><dt>Fák száma 400 m-en belül</dt><dd><span class="num">${fmtNum(g.trees)}</span></dd></div>
    </dl>
    <div class="bar"><i style="width:${Math.min(pct, 100)}%"></i></div>
    ${park}
    <p class="note">A fák az OSM-ben nem teljesen feltérképezettek, a szám alsó becslés.</p>`;
}

function lit(l) {
  if (l.share == null) {
    return `<p class="dim">Ezen a környéken az utak nincsenek <code>lit</code> címkével ellátva, nincs adat.</p>`;
  }
  const pct = Math.round(l.share * 100);
  return `
    <dl class="kv"><div><dt>Világított utak aránya</dt><dd><span class="num">${pct}%</span></dd></div>
    <div><dt>Címkézett úthossz</dt><dd><span class="num">${Math.round(l.coverage * 100)}%</span> <span class="dim">(${fmtNum(l.totalKm, 1)} km)</span></dd></div></dl>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="note">300 m-es sugarú körben, a <code>lit=yes/no</code> címkével ellátott utak hossza alapján. Alacsony címkézettségnél az arány bizonytalan.</p>`;
}

const MODE_LABEL = { WALK: 'séta' };
const modeColor = (l) => l.color || '#17375e';

function option(o, kind, destId, i) {
  const chips = o.legs
    .map((l) =>
      l.transit
        ? `<span class="chip" style="--c:${modeColor(l)}">${esc(l.name || l.mode)}</span>`
        : `<span class="walk">${l.minutes}′ ${MODE_LABEL[l.mode] || esc(l.mode.toLowerCase())}</span>`,
    )
    .join('<span class="sep">›</span>');
  return `<button class="row route" data-act="show-route" data-dest="${esc(destId)}" data-kind="${kind}" data-i="${i}">
    <span class="row-main"><span class="chips">${chips}</span><small>${fmtClock(o.start)} → ${fmtClock(o.end)}${o.transfers > 0 ? ` · ${o.transfers} átszállás` : ' · átszállás nélkül'}</small></span>
    <span class="row-side"><span class="num">${o.minutes} perc</span></span></button>`;
}

export function renderRoutes(dest, { transit, car }) {
  const t =
    transit.error ? `<p class="dim">Tömegközlekedés: nem sikerült (${esc(transit.error)}).</p>`
    : transit.value.length
      ? `<h5>Tömegközlekedés <small>hétköznap 9:00-ra érkezve</small></h5>${transit.value.map((o, i) => option(o, 'transit', dest.id, i)).join('')}`
      : `<p class="dim">Tömegközlekedés: nem találtam útvonalat.</p>`;
  const c =
    car.error ? `<p class="dim">Autó: nem sikerült (${esc(car.error)}).</p>`
    : `<h5>Autóval</h5><button class="row route" data-act="show-route" data-dest="${esc(dest.id)}" data-kind="car" data-i="0">
        <span class="row-main"><span>${fmtNum(car.value.km, 1)} km</span><small>forgalom nélkül számolva</small></span>
        <span class="row-side"><span class="num">${car.value.minutes} perc</span></span></button>`;
  return t + c;
}

function summary(d, r, from) {
  const km = haversine(from, d) / 1000;
  const dist = `<span class="num">${fmtNum(km, 1)} km</span> légvonalban`;
  if (!r) return `<div class="dim sum">${dist}</div>`;
  if (r.pending) return `<div class="dim sum">${dist} · <span class="spin"></span> menetidő keresése…</div>`;
  const t = r.transit.error ? 'nem sikerült' : r.transit.value.length ? `<b class="num">${r.transit.value[0].minutes} perc</b>` : 'nincs útvonal';
  const c = r.car.error ? 'nem sikerült' : `<b class="num">${r.car.value.minutes} perc</b> <span class="dim">(${fmtNum(r.car.value.km, 1)} km)</span>`;
  return `<div class="dim sum">${dist}</div>
    <dl class="kv times"><div><dt>Tömegközlekedés</dt><dd>${t}</dd></div><div><dt>Autó</dt><dd>${c}</dd></div></dl>`;
}

export function renderDest(d, r, open, from) {
  const head = `<h4>${esc(d.name)}</h4>`;
  if (d.state === 'loading') return `${head}<p class="dim">Cím keresése…</p>`;
  if (!d.lat) return `${head}<p class="dim">A cím nem található.</p>`;
  const ready = r && !r.pending;
  return `${head}<div class="dim addr">${esc(d.label)}</div>${summary(d, r, from)}
    ${ready ? `<button class="btn small" data-act="routes" data-dest="${esc(d.id)}">${open ? 'Útvonalak elrejtése' : 'Útvonalak mutatása'}</button>` : ''}
    ${ready && open ? `<div class="routes">${renderRoutes(d, r)}</div>` : ''}`;
}

export function renderDestinations(dests, routes, openIds, from) {
  return dests
    .map((d) => `<div class="dest" id="dest-${esc(d.id)}">${renderDest(d, routes[d.id], openIds.has(d.id), from)}</div>`)
    .join('');
}

export function renderResult(res, { district, label, cached, dests, routes, openIds }) {
  const p = res.point;
  const dTitle = district ? `${intToRoman(district.properties.num)}. kerület · ${esc(district.properties.name)}` : 'Budapesten kívül';
  return `
  <header class="loc">
    <h2>${esc(label || res.street?.name || 'Kiválasztott pont')}</h2>
    <div class="dim">${esc(dTitle)} · <span class="num">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>${cached ? ' · <span title="Gyorsítótárból">mentett</span>' : ''}</div>
    <div class="actions">
      <button class="btn" data-act="mark-point">Pont jelölése</button>
      ${res.street ? `<button class="btn" data-act="mark-street">Utca jelölése: ${esc(res.street.name)}</button>` : ''}
    </div>
  </header>
  <section><h3>Élelmiszerbolt</h3>${shops(res.shops)}</section>
  <section><h3>Közlekedés</h3>${transport(res.transport)}</section>
  <section><h3>Zöldterület</h3>${green(res.green)}</section>
  <section><h3>Éjszakai biztonság · közvilágítás</h3>${lit(res.lit)}</section>
  <section><h3>Úti célok</h3>${renderDestinations(dests, routes, openIds, res.point)}</section>
  <p class="note foot">A gyaloglási táv becslés: légvonal × 1,3, 80 m/perc. Adatok: © OpenStreetMap-közreműködők.</p>`;
}

/* ---------- my places ---------- */

const statusSelect = (cur) =>
  `<div class="seg" role="radiogroup" aria-label="Értékelés">${Object.entries(STATUS)
    .map(
      ([k, v]) => `<label style="--c:${v.color}"><input type="radio" name="status" value="${k}" ${k === cur ? 'checked' : ''}><span>${v.label}</span></label>`,
    )
    .join('')}</div>`;

export function renderPlaceForm(draft, isNew) {
  return `<form class="pform" data-id="${esc(draft.id)}">
    <h3>${isNew ? 'Új hely' : 'Hely szerkesztése'}</h3>
    ${statusSelect(draft.status)}
    <label class="fld">Név<input name="name" maxlength="120" value="${esc(draft.name)}" placeholder="pl. Víg utca" autocomplete="off"></label>
    <label class="fld">Megjegyzés<textarea name="note" rows="4" maxlength="4000" placeholder="Zajos, jó a közlekedés, ...">${esc(draft.note)}</textarea></label>
    <div class="actions">
      <button class="btn primary" type="submit">Mentés</button>
      <button class="btn" type="button" data-act="cancel-form">Mégse</button>
      ${isNew ? '' : '<button class="btn danger" type="button" data-act="delete">Törlés</button>'}
    </div>
  </form>`;
}

const KIND = { Point: 'pont', LineString: 'utca', MultiLineString: 'utca', Polygon: 'terület' };

export function renderPlacesList(places, filter, selectedId) {
  const shown = filter === 'all' ? places : places.filter((p) => p.status === filter);
  const counts = (k) => (k === 'all' ? places.length : places.filter((p) => p.status === k).length);
  const chips = [['all', 'Mind'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])]
    .map(([k, l]) => `<button class="filter ${k === filter ? 'on' : ''}" data-act="filter" data-k="${k}">${l} <span class="num">${counts(k)}</span></button>`)
    .join('');
  const items = shown.length
    ? shown
        .map(
          (p) => `<li class="place ${p.id === selectedId ? 'sel' : ''}" style="--c:${STATUS[p.status].color}">
        <button class="place-main" data-act="zoom" data-id="${esc(p.id)}">
          <span class="place-title">${esc(p.name || 'Névtelen')} <small>${KIND[p.geometry.type]} · ${STATUS[p.status].label}</small></span>
          ${p.note ? `<span class="place-note">${esc(p.note)}</span>` : ''}
        </button>
        <button class="icon" data-act="edit" data-id="${esc(p.id)}" aria-label="Szerkesztés">Szerk.</button>
      </li>`,
        )
        .join('')
    : `<li class="empty-li dim">${places.length ? 'Nincs ilyen hely.' : 'Még nincs jelölt hely. Jelölj meg egy pontot, egy utcát, vagy rajzolj egy területet a térképen.'}</li>`;
  return `<div class="filters">${chips}</div><ul class="places">${items}</ul>
    <div class="io">
      <button class="btn" data-act="export">Exportálás (JSON)</button>
      <button class="btn" data-act="import">Importálás</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>
    <p class="note" id="io-msg" role="status"></p>`;
}
