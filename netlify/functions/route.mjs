import { relayRoute } from '../../server/route-proxy.js';

export default async (req) => {
  const { status, body } = await relayRoute(new URL(req.url).searchParams);
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=900' : 'no-store' },
  });
};

export const config = { path: '/api/route' };
