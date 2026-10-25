import { defineConfig } from 'vite';
import { relayOverpass } from './server/overpass-proxy.js';

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
