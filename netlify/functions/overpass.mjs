import { relayOverpass } from '../../server/overpass-proxy.js';

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async (req) => {
  try {
    const data = new URL(req.url).searchParams.get('data');
    const { status, body } = await relayOverpass(data);
    if (status !== 200) return new Response(body, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    // Streamed: buffered responses are capped at 6 MB, streamed ones at 20 MB.
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'X-Payload-Bytes': String(bytes.length) },
    });
  } catch (e) {
    return json(500, { error: `relay: ${e.name}: ${e.message}` });
  }
};

export const config = { path: '/api/overpass' };
