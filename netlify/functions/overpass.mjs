import { relayOverpass } from '../../server/overpass-proxy.js';

export default async (req) => {
  const data = new URL(req.url).searchParams.get('data');
  const { status, body } = await relayOverpass(data);
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
    },
  });
};

export const config = { path: '/api/overpass' };
