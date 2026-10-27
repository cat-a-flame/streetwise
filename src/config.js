export const BUDAPEST = {
  center: [47.4979, 19.0402],
  zoom: 12,
  bounds: { south: 47.33, west: 18.9, north: 47.65, east: 19.36 },
};

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Same-origin relay (Netlify function / Vite middleware), see server/overpass-proxy.js
export const OVERPASS_ENDPOINTS = ['/api/overpass'];

// Meters. `pad` widens every Overpass query so one cached response (snapped to
// ~100 m) still covers the exact clicked point.
export const RADIUS = {
  shop: 1500,
  chain: 3000, // nearest Spar / Lidl, searched wider than the general shop list
  stop: 600,
  metro: 1500,
  green: 400,
  park: 1200,
  lit: 300,
  pad: 100,
};

export const WALK_DETOUR = 1.3; // straight line -> street network estimate
export const WALK_M_PER_MIN = 80;

export const DISTRICT_NAMES = {
  1: 'Budavár',
  2: 'Rózsadomb, Víziváros',
  3: 'Óbuda-Békásmegyer',
  4: 'Újpest',
  5: 'Belváros-Lipótváros',
  6: 'Terézváros',
  7: 'Erzsébetváros',
  8: 'Józsefváros',
  9: 'Ferencváros',
  10: 'Kőbánya',
  11: 'Újbuda',
  12: 'Hegyvidék',
  13: 'Angyalföld, Újlipótváros',
  14: 'Zugló',
  15: 'Rákospalota, Pestújhely',
  16: 'Mátyásföld, Sashalom',
  17: 'Rákosmente',
  18: 'Pestszentlőrinc-Pestszentimre',
  19: 'Kispest',
  20: 'Pesterzsébet',
  21: 'Csepel',
  22: 'Budafok-Tétény',
  23: 'Soroksár',
};

export const STATUS = {
  like: { label: 'Tetszik', color: '#2e7d4f' },
  dislike: { label: 'Nem tetszik', color: '#b3261e' },
  neutral: { label: 'Semleges', color: '#7d7a70' },
};

export const MODES = {
  metro: { label: 'Metró', letter: 'M', color: '#1d1d1b', text: '#fff' },
  tram: { label: 'Villamos', letter: 'V', color: '#e8b100', text: '#1d1d1b' },
  bus: { label: 'Busz', letter: 'B', color: '#1b5fa8', text: '#fff' },
  trolleybus: { label: 'Trolibusz', letter: 'T', color: '#c0392b', text: '#fff' },
};
export const MODE_ORDER = ['metro', 'tram', 'bus', 'trolleybus'];
