import { auditScreen } from '../screens/browser.ts';
import { test, expect, openScreen } from '../screens/fixtures.ts';
import { stateCases, withQuery } from '../screens/cases.ts';
for (const entry of stateCases)
  test.describe(`${entry.route} ${entry.display} ${entry.state}`, () => {
    test.use({ display: entry.display });
    test('visible screen state', async ({ page, siteURL }) => {
      test.setTimeout(150_000);
      await openScreen(page, siteURL, withQuery(entry.address, { demo: entry.state }));
      expect(await page.evaluate(auditScreen, entry.route)).toEqual([]);
      if (entry.state === 'offline') {
        await expect(page.locator('#offline')).toBeVisible();
        await expect(page.locator('#offline')).toHaveAttribute('data-state', 'offline');
        await expect(page.locator('#offline')).not.toHaveText('');
        await expect(page.locator('article.page')).toHaveAttribute(
          'data-view',
          /^(ready|empty|pending)$/,
        );
        const banner = await page.locator('#offline').boundingBox(),
          article = await page.locator('article.page').boundingBox();
        expect(banner!.y + banner!.height, 'Offline banner above screen').toBeLessThanOrEqual(
          article!.y,
        );
      } else {
        await expect(page.locator('article.page')).toHaveAttribute('data-view', entry.state);
        const state = page.locator(`#view [data-state="${entry.state}"]`);
        await expect(state).toBeVisible();
        if (entry.state === 'loading') await expect(state).toHaveAttribute('role', 'status');
        if (entry.state === 'error') {
          await expect(state).toHaveAttribute('role', 'alert');
          await expect(state.locator('button[data-action="retry"]')).toBeVisible();
        }
      }
    });
  });
