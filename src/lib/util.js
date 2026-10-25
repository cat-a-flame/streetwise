const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function fmtDist(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10 || Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} km`;
}

export function fmtNum(n, digits = 0) {
  return n.toLocaleString('hu-HU', { maximumFractionDigits: digits });
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}${Math.random().toString(16).slice(2)}`;
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
export function romanToInt(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    if (!v) return NaN;
    const next = ROMAN[s[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}

export function intToRoman(n) {
  const map = [[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of map) while (n >= v) { out += r; n -= v; }
  return out;
}
