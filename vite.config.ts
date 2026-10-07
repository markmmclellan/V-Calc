import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error plain JS module
import { scrape } from './scripts/scrape.mjs';

/**
 * Dev/preview-only endpoint: POST /api/refresh runs the op.gg scraper and streams progress as
 * newline-delimited JSON. (A browser can't fetch op.gg directly because of CORS, so the local
 * server does it.) Not available in a static deployment.
 */
function refreshEndpoint(): Plugin {
  let running = false;
  const handler = async (req: any, res: any, next: () => void) => {
    if (req.url?.split('?')[0] !== '/api/refresh') return next();
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end();
    }
    if (running) {
      res.statusCode = 409;
      return res.end(JSON.stringify({ type: 'error', message: 'A refresh is already running' }));
    }
    running = true;
    res.setHeader('content-type', 'application/x-ndjson');
    const send = (o: object) => res.write(JSON.stringify(o) + '\n');
    try {
      const r = await scrape({ onProgress: (done: number, total: number) => send({ type: 'progress', done, total }) });
      send({ type: 'done', ...r });
    } catch (e) {
      send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
      res.end();
    }
  };
  return {
    name: 'champions-refresh',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}

/** Short git commit of this build, or '' when git isn't available. */
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

export default defineConfig({
  plugins: [react(), refreshEndpoint()],
  base: './',
  // shown in the footer so you can tell which deploy you're looking at
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
});
