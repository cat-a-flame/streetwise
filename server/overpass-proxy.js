// Ordered by how well they have answered from Netlify; the busy official servers stay as fallbacks.
export const ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const HEADERS = {
  'User-Agent': 'streetwise/0.1 (https://github.com/cat-a-flame/streetwise)',
  Accept: 'application/json',
};

async function attempt(endpoint, data, signal) {
  try {
    const res = await fetch(`${endpoint}?${new URLSearchParams({ data })}`, { headers: HEADERS, signal });
    const body = await res.text();
    if (res.ok && !/runtime error/i.test(body.slice(0, 2000))) return { ok: true, out: { status: 200, body: slim(body) } };
    return { ok: false, out: { status: res.status === 200 ? 502 : res.status, body: JSON.stringify({ error: `${endpoint} -> ${res.status}`, detail: body.slice(0, 300) }) } };
  } catch (e) {
    return { ok: false, out: { status: 504, body: JSON.stringify({ error: `${endpoint} -> ${e.name}` }) } };
  }
}

// Hedged: public mirrors are often at capacity, so if one has not answered after
// `hedgeMs` (or has failed) the next one is started too. First success wins.
export function relayOverpass(data, { totalMs = Number(process.env.OVERPASS_BUDGET_MS) || 9000, hedgeMs = 2000 } = {}) {
  if (!data || data.length > 20_000) return Promise.resolve({ status: 400, body: JSON.stringify({ error: 'bad query' }) });
  return new Promise((resolve) => {
    const ctrls = [];
    let next = 0;
    let pending = 0;
    let done = false;
    let hedge;
    let last = { status: 504, body: JSON.stringify({ error: 'no upstream answered in time' }) };

    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(hedge);
      clearTimeout(deadline);
      ctrls.forEach((c) => c.abort());
      resolve(r);
    };
    const deadline = setTimeout(() => finish(last), totalMs);

    const start = () => {
      clearTimeout(hedge);
      if (done) return;
      if (next >= ENDPOINTS.length) {
        if (!pending) finish(last);
        return;
      }
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      pending++;
      attempt(ENDPOINTS[next++], data, ctrl.signal).then((r) => {
        pending--;
        if (r.ok) return finish(r.out);
        last = r.out;
        start();
      });
      hedge = setTimeout(start, hedgeMs);
    };
    start();
  });
}

// Overpass `out body` ships far more than the app reads. Dropping it keeps the
// payload well under the 6 MB limit of buffered serverless responses.
export function slim(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return text;
  }
  for (const el of json.elements || []) {
    delete el.nodes;
    delete el.bounds;
    // Stop relations: only stop/platform nodes matter, not the route geometry.
    if (el.type === 'relation' && el.tags?.route && el.members) {
      el.members = el.members.filter((m) => m.type === 'node').map(({ type, ref }) => ({ type, ref }));
    }
  }
  return JSON.stringify({ elements: json.elements || [] });
}

// Diagnostic: one tiny query per mirror, in parallel, with status and timing.
export async function checkOverpass() {
  const data = '[out:json][timeout:5];node(47.4979,19.0402,47.4989,19.0412);out count;';
  return Promise.all(
    ENDPOINTS.map(async (endpoint) => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${endpoint}?${new URLSearchParams({ data })}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        const text = await res.text();
        return { endpoint, status: res.status, ms: Date.now() - t0, body: text.slice(0, 200) };
      } catch (e) {
        return { endpoint, error: `${e.name}: ${e.message}`, ms: Date.now() - t0 };
      }
    }),
  );
}
