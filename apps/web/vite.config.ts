import { staticResponseHeaders } from './app/lib/security';
import { writeFileSync } from 'node:fs';
import { build as bundle, type Plugin as EsbuildPlugin } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig, type Plugin } from 'vite';
import { copyCandidate, readCandidate, type Candidate } from './scripts/candidate-data';

// An absolute candidate root (manifest.json, validation.json, receipt.json,
// data/) selects an isolated local acceptance build. Default release is unchanged.
const candidate = process.env.BUDGET_CANDIDATE
  ? readCandidate(resolve('../..', process.env.BUDGET_CANDIDATE))
  : null;

// Keep loc.js external: both the routes facade and the legacy router need the same location singleton.
function locationSingletonPlugin(): EsbuildPlugin {
  return {
    name: 'loc-singleton',
    setup(build) {
      build.onResolve({ filter: /loc\.js$/ }, () => ({ path: './loc.js', external: true }));
    },
  };
}

// React must import the browser's legacy modules by URL to share their data, store and router singletons.
function legacySingletonsPlugin(): EsbuildPlugin {
  return {
    name: 'legacy-singletons',
    setup(build) {
      build.onResolve({ filter: /client\// }, (args) => {
        const path = resolve(args.resolveDir, args.path);
        const clientRoot = '/apps/web/client/';
        if (path.includes(clientRoot)) {
          return { path: '/js/' + path.split(clientRoot)[1], external: true };
        }
      });
    },
  };
}

// The browser part of the site stays the files of site/ (docs/adr/0002-react-router-ssr.md): its ES modules, styles, data and images are
// copied into the client build as they are. They are not Vite's publicDir, because the server imports the same modules (apps/web/client/render.js).
// apps/web/public/index.html is the shell of the static site; here every screen comes from the server, so it is not the start page. It is kept as
// app.html: the bare shell the service worker stores for offline use (apps/web/public/sw.js), which builds a screen from the copies it has.
function siteFiles(candidate: Candidate | null): Plugin {
  return {
    name: 'site-files',
    apply: 'build',
    async writeBundle(options) {
      if (!options.dir || !/[\\/]client$/.test(options.dir)) return;
      cpSync(resolve('public'), options.dir, {
        recursive: true,
        filter: (src) => src !== resolve('public/index.html'),
      });
      cpSync(resolve('client'), resolve(options.dir, 'js'), { recursive: true });
      if (candidate) copyCandidate(candidate, resolve(options.dir, 'data'));
      else cpSync(resolve('../../data/release'), resolve(options.dir, 'data'), { recursive: true });
      await bundle({
        entryPoints: ['client/routes.js'],
        outfile: resolve(options.dir, 'js/routes.js'),
        bundle: true,
        format: 'esm',
        plugins: [locationSingletonPlugin()],
      });
      await bundle({
        entryPoints: ['app/migration/bridge.tsx'],
        outdir: resolve(options.dir, 'js'),
        entryNames: 'react-bridge',
        chunkNames: 'chunks/[name]-[hash]',
        splitting: true,
        bundle: true,
        format: 'esm',
        minify: true,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [legacySingletonsPlugin()],
      });
      writeFileSync(
        resolve(options.dir, '_headers'),
        staticResponseHeaders({
          ENVIRONMENT: process.env.CLOUDFLARE_ENV || 'production',
          NOINDEX: process.env.NOINDEX,
        }),
      );
      rmSync(resolve(options.dir, 'index.html'), { force: true });
      cpSync(resolve('public/index.html'), resolve(options.dir, 'app.html'));
    },
  };
}

export default defineConfig({
  publicDir: false,
  // a tag per build: part of the edge-cache key of a drawn screen (apps/web/workers/app.ts), so a new deploy never serves the HTML of the previous one
  define: {
    __BUILD__: JSON.stringify(Date.now().toString(36)),
    __BUDGET_CANDIDATE_RELEASE__: JSON.stringify(candidate?.releaseId ?? null),
  },
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      configPath: process.env.WRANGLER_CONFIG
        ? resolve('../..', process.env.WRANGLER_CONFIG)
        : './wrangler.jsonc',
    }),
    reactRouter(),
    siteFiles(candidate),
  ],
});
