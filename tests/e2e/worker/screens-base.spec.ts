import { test, expect, openScreen, deepPass } from '../screens/fixtures.ts';
import { auditScreen } from '../screens/browser.ts';
import { auditCases, routes } from '../screens/cases.ts';
import { VALUE_CHECKS, visibleValues } from '../screens/values.ts';
for (const entry of auditCases)
  test.describe(`${entry.route} ${entry.display} ${entry.address}`, () => {
    test.use({ display: entry.display });
    test('screen audit', async ({ page, siteURL }) => {
      test.setTimeout(150_000);
      await openScreen(page, siteURL, entry.address);
      expect(await page.evaluate(auditScreen, entry.route), 'Initial screen audit').toEqual([]);
      await deepPass(page);
      expect(await page.evaluate(auditScreen, entry.route), 'Expanded screen audit').toEqual([]);
    });
  });
for (const [routeId, expected] of Object.entries(VALUE_CHECKS))
  test.describe(`published values ${routeId}`, () => {
    test('published text', async ({ page, siteURL }) => {
      test.setTimeout(150_000);
      const route = routes.find((route) => route.id === routeId);
      expect(route, `Unknown value-check route ${routeId}`).toBeDefined();
      const found = new Set<string>();
      for (const address of route!.samples) {
        await openScreen(page, siteURL, address);
        await deepPass(page);
        for (const value of await visibleValues(page, routeId)) found.add(value);
      }
      expect(
        expected.all.filter((value) => !found.has(value)),
        `Published values missing on ${routeId}`,
      ).toEqual([]);
    });
  });
