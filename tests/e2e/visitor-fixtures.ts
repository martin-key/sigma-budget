import type { BrowserContext, BrowserContextOptions } from '@playwright/test';
import { test as base, expect } from './fixtures.ts';
export const test = base.extend<{
  freshContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}>({
  freshContext: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [],
      errors: string[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({
        serviceWorkers: 'block',
        reducedMotion: 'reduce',
        ...options,
      });
      contexts.push(context);
      context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
      return context;
    });
    for (const context of contexts) await context.close();
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});
export { expect };
