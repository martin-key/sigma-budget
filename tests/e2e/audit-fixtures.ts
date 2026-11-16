import { test as base, expect } from './fixtures.ts';

export const test = base.extend<{ visit: (path: string) => Promise<void> }>({
  visit: async ({ page, siteURL }, use) => {
    await use(async (path: string): Promise<void> => {
      await page.goto(siteURL + path);
      await expect(page.locator('#view')).not.toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('article[data-ready]')).toHaveAttribute('data-ready', '1', {
        timeout: 30_000,
      });
    });
  },
});
export { expect };
