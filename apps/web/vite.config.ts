import { cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig, type Plugin } from 'vite';

// The browser part of the site stays the files of site/ (docs/adr/0002-react-router-ssr.md): its ES modules, styles, data and images are
// copied into the client build as they are. They are not Vite's publicDir, because the server imports the same modules (apps/web/client/render.js).
// apps/web/public/index.html is the shell of the static site; here every screen comes from the server, so it is not the start page. It is kept as
// app.html: the bare shell the service worker stores for offline use (apps/web/public/sw.js), which builds a screen from the copies it has.
function siteFiles(): Plugin {
  return {
    name: 'site-files',
    apply: 'build',
    writeBundle(options) {
      if (!options.dir || !/[\\/]client$/.test(options.dir)) return;
      cpSync(resolve('public'), options.dir, { recursive: true, filter: src => src !== resolve('public/index.html') });
      cpSync(resolve('client'), resolve(options.dir, 'js'), { recursive: true });
      cpSync(resolve('../../data/release'), resolve(options.dir, 'data'), { recursive: true });
      rmSync(resolve(options.dir, 'index.html'), { force: true });
      cpSync(resolve('public/index.html'), resolve(options.dir, 'app.html'));
    },
  };
}

export default defineConfig({
  publicDir: false,
  // a tag per build: part of the edge-cache key of a drawn screen (apps/web/workers/app.ts), so a new deploy never serves the HTML of the previous one
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' }, configPath: process.env.WRANGLER_CONFIG ? resolve('../..', process.env.WRANGLER_CONFIG) : './wrangler.jsonc' }),
    reactRouter(),
    siteFiles(),
  ],
});
