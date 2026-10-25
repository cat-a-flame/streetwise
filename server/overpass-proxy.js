// Server-side Overpass relay. Browsers cannot set a User-Agent and
// overpass-api.de answered the in-browser requests with 406, so the app asks this
// relay (Netlify function in production, Vite middleware locally) instead.
export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const HEADERS = {
  'User-Agent': 'streetwise/0.1 (https://github.com/cat-a-flame/streetwise)',
  Accept: 'application/json',
};

export async function relayOverpass(data, { totalMs = 50_000 } = {}) {
  if (!data || data.length > 20_000) return { status: 400, body: JSON.stringify({ error: 'bad query' }) };
  const deadline = Date.now() + totalMs;
  let last = { status: 502, body: JSON.stringify({ error: 'no upstream answered' }) };
  for (const endpoint of ENDPOINTS) {
    const left = deadline - Date.now();
    if (left < 3000) break;
    try {
      const res = await fetch(`${endpoint}?${new URLSearchParams({ data })}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(Math.min(left, 25_000)),
      });
      const body = await res.text();
      if (res.ok && !/runtime error/i.test(body.slice(0, 2000))) return { status: 200, body };
      last = { status: res.status === 200 ? 502 : res.status, body: JSON.stringify({ error: `${endpoint} -> ${res.status}`, detail: body.slice(0, 300) }) };
    } catch (e) {
      last = { status: 504, body: JSON.stringify({ error: `${endpoint} -> ${e.name}` }) };
    }
  }
  return last;
}
