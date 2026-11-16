import { test, expect, enableHashRoutes } from '../fixtures.ts';
import { VIEWS, readControls, visibleShareIds } from '../share-probes.ts';
import type { Page } from '@playwright/test';
test.use({
  serviceWorkers: 'block',
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
});
async function settle(page: Page) {
  await expect(page.locator('h1')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
}
const linkFor = async (id: string): Promise<string | null> => {
  const share = await import(new URL('./js/share.js', location.href).href);
  const block = share.get(id);
  return block ? share.linkFor(block) : null;
};
for (const view of VIEWS)
  test(`shared view ${view}`, async ({ context, page, browser, siteURL }) => {
    await enableHashRoutes(context);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    const base = siteURL + '/index.html';
    await page.goto(base + view);
    await settle(page);
    const original = await page.evaluate(readControls);
    const ids: string[] = await page.evaluate(visibleShareIds);
    expect.soft(ids.length, `${view}: share menus`).toBeGreaterThan(0);
    const want = new URLSearchParams(view.split('?')[1] ?? '');
    for (const id of ids.slice(0, 6)) {
      const link: string | null = await page.evaluate(linkFor, id);
      expect(link, `${view} [${id}]: link`).toBeTruthy();
      if (!link) throw new Error('Missing shared link');
      const hash = link.slice(link.indexOf('#') + 1);
      const query = new URLSearchParams(hash.split('?')[1] ?? '');
      for (const [key, value] of want)
        expect.soft(query.get(key), `${view} [${id}] ?${key}`).toBe(value);
      const fresh = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: 1280, height: 900 },
        reducedMotion: 'reduce',
      });
      try {
        await enableHashRoutes(fresh);
        const opened = await fresh.newPage();
        await opened.goto(base + '#' + hash);
        await settle(opened);
        const now = await opened.evaluate(readControls);
        for (const key of ['h1', 'fields', 'pressed'] as const)
          expect.soft(now[key], `${view} [${id}] ${key}`).toBe(original[key]);
      } finally {
        await fresh.close();
      }
    }
    if (ids.length) {
      const button = page.locator(`[data-share="${ids[0]}"]`).first();
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await expect(page.locator('[data-act]').first()).toBeVisible({ timeout: 3000 });
      const acts: string[] = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-act]')].map((e) => e.dataset.act!),
      );
      expect
        .soft(
          acts.every((a) => ['png', 'copy-link', 'csv', 'report'].includes(a)) &&
            acts.includes('png') &&
            acts.includes('copy-link'),
          `${view}: menu ${acts}`,
        )
        .toBe(true);
      await page.keyboard.press('Escape');
    }
    expect.soft(errors, `${view}: script errors`).toEqual([]);
  });
