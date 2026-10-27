import { defineConfig } from 'vite';
import { checkOverpass, relayOverpass } from './server/overpass-proxy.js';
import { relayRoute } from './server/route-proxy.js';

// Same relay as the Netlify function, for `npm run dev` / `npm run preview`.
const overpassRelay = {
  name: 'overpass-relay',
  configureServer(s) {
    s.middlewares.use(handler);
  },
  configurePreviewServer(s) {
    s.middlewares.use(handler);
  },
};

async function handler(req, res, next) {
  if (req.url.startsWith('/api/route')) {
    const { status, body } = await relayRoute(new URL(req.url, 'http://x').searchParams);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    return res.end(body);
  }
  if (req.url.startsWith('/api/overpass-check')) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(await checkOverpass(), null, 2));
  }
  if (!req.url.startsWith('/api/overpass')) return next();
  const data = new URL(req.url, 'http://x').searchParams.get('data');
  const { status, body } = await relayOverpass(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

export default defineConfig({
  plugins: [overpassRelay],
  build: { chunkSizeWarningLimit: 700 },
});
