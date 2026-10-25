import { checkOverpass } from '../../server/overpass-proxy.js';

export default async () =>
  new Response(JSON.stringify(await checkOverpass(), null, 2), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const config = { path: '/api/overpass-check' };
