// Relay for routing requests (public transport via Transitous/MOTIS, car via OSRM).
// Runs server-side so requests carry an identifying User-Agent, which both services
// ask for and browsers cannot set. Only validated coordinates/times are forwarded,
// so this cannot be used as an open proxy.
const UA = 'streetwise/0.1 (https://github.com/cat-a-flame/streetwise)';
const TRANSIT = 'https://api.transitous.org/api/v6/plan';
const CAR = [
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  'https://router.project-osrm.org/route/v1/driving',
];
const NUM = /^-?\d{1,3}(\.\d{1,7})?$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/;

const fail = (status, error) => ({ status, body: JSON.stringify({ error }) });

function point(s) {
  const [lat, lon, extra] = String(s ?? '').split(',');
  if (extra !== undefined || !NUM.test(lat ?? '') || !NUM.test(lon ?? '')) return null;
  return { lat: Number(lat), lon: Number(lon) };
}

async function get(url, timeoutMs) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} -> ${res.status}`);
  return text;
}

// Plan responses carry turn-by-turn steps and stop lists the app does not show.
export function slimPlan(text) {
  const json = JSON.parse(text);
  const clean = (it) => {
    for (const leg of it.legs || []) {
      delete leg.steps;
      delete leg.intermediateStops;
      delete leg.alerts;
    }
    delete it.fareTransfers;
    return it;
  };
  return JSON.stringify({ itineraries: (json.itineraries || []).map(clean), direct: (json.direct || []).map(clean) });
}

export async function relayRoute(params) {
  const kind = params.get('kind');
  const from = point(params.get('from'));
  const to = point(params.get('to'));
  if (!from || !to) return fail(400, 'bad coordinates');
  try {
    if (kind === 'transit') {
      const time = params.get('time');
      if (!ISO.test(time ?? '')) return fail(400, 'bad time');
      const q = new URLSearchParams({
        fromPlace: `${from.lat},${from.lon}`,
        toPlace: `${to.lat},${to.lon}`,
        time,
        arriveBy: 'true',
        detailedLegs: 'false',
        language: 'hu',
      });
      return { status: 200, body: slimPlan(await get(`${TRANSIT}?${q}`, 8500)) };
    }
    if (kind === 'car') {
      const path = `${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`;
      let last;
      for (const base of CAR) {
        try {
          return { status: 200, body: await get(`${base}/${path}`, 4500) };
        } catch (e) {
          last = e;
        }
      }
      return fail(502, last?.message || 'no car router answered');
    }
    return fail(400, 'bad kind');
  } catch (e) {
    return fail(e.name === 'TimeoutError' ? 504 : 502, e.message);
  }
}
