import { test as base, expect, type BrowserContextOptions } from '@playwright/test';
import { staticRoot, startStaticServer } from '../../apps/web/scripts/serve.ts';
export const test = base.extend<{}, { siteURL: string }>({
  siteURL: [
    async ({}, use, workerInfo) => {
      if (workerInfo.project.name === 'static') {
        const site = await startStaticServer(staticRoot(), 0, { fallback: false });
        try {
          await use(site.url);
        } finally {
          await site.close();
        }
      } else {
        const url = process.env.E2E_WORKER_URL;
        if (!url)
          throw new Error(
            'Set E2E_WORKER_URL to the running built Worker (e.g. http://127.0.0.1:8814)',
          );
        expect(new URL(url).hostname, 'loopback Worker required').toBe('127.0.0.1');
        await use(url.replace(/\/+$/, ''));
      }
    },
    { scope: 'worker' },
  ],
});
export { expect };
export const contextOptions: BrowserContextOptions = { serviceWorkers: 'block' };
/** Route gates preserve real network/DOM events while explicitly holding a module or data file. */
export function gate() {
  let resolve!: () => void;
  let released = false;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    release: () => {
      released = true;
      resolve();
    },
    get released() {
      return released;
    },
  };
}
