import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(
  new URL('../../tmp/pw-browsers', import.meta.url),
);
export default defineConfig({
  testDir: '.',
  outputDir: '../../tmp/e2e-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'worker', testMatch: 'worker/*.spec.ts' },
    { name: 'static', testMatch: 'static/*.spec.ts' },
  ],
});
