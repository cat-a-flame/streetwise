import { MODES, MODE_ORDER, STATUS } from './config.js';
import { esc, fmtDist, fmtNum } from './lib/util.js';
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

export function renderError(msg) {
  return `<div class="error"><b>Nem sikerült lekérdezni az adatokat.</b><p>${esc(msg)}</p><button class="btn" data-act="retry">Újra</button></div>`;
}

function shops(list) {
  if (!list.length) return `<p class="dim">1,5 km-en belül nincs szupermarket vagy kisbolt az OSM-ben.</p>`;
  return `<ul class="rows">${list
    .map(
      (s, i) => `<li><button class="row" data-act="focus" data-key="shop-${i}">
        <span class="row-main">${esc(s.name)}<small>${s.type === 'supermarket' ? 'Szupermarket' : 'Kisbolt'}</small></span>
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

function crime(district, safety) {
  if (!district) return `<p class="dim">Budapesten kívüli pont, nincs kerületi adat.</p>`;
  const entry = safety?.districts?.[String(district.properties.num)];
  const v = entry?.crimePer1000;
  const avg = safety?.cityAverage;
  if (v == null) {
    return `<p class="dim">Még nincs kitöltve. Add meg a <code>crimePer1000</code> értéket a <code>public/data/district-safety.json</code> fájlban (${intToRoman(district.properties.num)}. kerület).</p>`;
  }
  const meta = [safety.year, safety.source].filter(Boolean).join(' · ');
  return `<dl class="kv"><div><dt>Bűncselekmény / 1000 lakos</dt><dd><span class="num">${fmtNum(v, 1)}</span></dd></div>
    ${avg != null ? `<div><dt>Budapesti átlag</dt><dd><span class="num">${fmtNum(avg, 1)}</span></dd></div>` : ''}</dl>
    ${meta ? `<p class="note">${esc(meta)}</p>` : ''}`;
}

export function renderResult(res, { district, safety, label, cached }) {
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
  <section><h3>Kerületi bűnügyi alapadat</h3>${crime(district, safety)}</section>
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
