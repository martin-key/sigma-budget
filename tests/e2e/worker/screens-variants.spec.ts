import { auditScreen } from '../screens/browser.ts';
import { test, expect, openScreen } from '../screens/fixtures.ts';
import { periodCases, withQuery } from '../screens/cases.ts';
for (const entry of periodCases)
  test.describe(`${entry.route} ${entry.period}`, () => {
    test.use({ display: entry.display });
    test('period data or recovery', async ({ page, siteURL }) => {
      test.setTimeout(150_000);
      await openScreen(page, siteURL, withQuery(entry.address, { per: entry.period }));
      expect(await page.evaluate(auditScreen, entry.route)).toEqual([]);
      if (entry.supported)
        await expect(page.locator('article.page')).toHaveAttribute('data-view', 'ready');
      else {
        await expect(page.locator('article.page')).toHaveAttribute('data-view', 'empty');
        await expect(
          page.locator('#view [data-state="empty"] [data-action="set-period"]').first(),
        ).toBeVisible();
      }
    });
  });
