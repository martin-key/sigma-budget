import { test, expect, openScreen } from '../screens/fixtures.ts';
import { displays } from '../screens/cases.ts';
import { drawn } from '../screens/interactions.ts';

const cases = [
  ['S06', '#/prihodi'],
  ['S07', '#/razhodi'],
  ['S08', '#/razhodi/obrazovanie'],
  ['S10', '#/vedomstva?per=2026.law'],
  ['S20', '#/obshtini?per=2026.law'],
] as const;
for (const display of displays)
  test.describe(display, () => {
    test.use({ display });
    for (const [id, address] of cases)
      test(`views ${id}`, async ({ page, siteURL }) => {
        await openScreen(page, siteURL, address);
        const root = page
          .locator('figure[data-views], .tmap[data-ui="treemap-list"]')
          .filter({ visible: true })
          .first();
        await expect(root).toBeVisible();
        const radios = root.getByRole('radio');
        const names = await radios.evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).labels?.[0]?.textContent?.trim() || ''),
        );
        for (const name of names) {
          const radio = root.getByRole('radio', { name, exact: true });
          await radio.check();
          await expect(radio).toBeChecked();
          await drawn(root);
          if (/таблица/i.test(name))
            await expect(root.locator('table').filter({ visible: true }).first()).toBeVisible();
          if (/списък/i.test(name)) await expect(root.locator('.tmap-list')).toBeVisible();
          await expect
            .poll(() =>
              root.evaluate((el) => {
                const box = el.getBoundingClientRect();
                return (
                  [...el.querySelectorAll('svg text')]
                    .filter((text) => text.getClientRects().length)
                    .every((text) => {
                      const r = text.getBoundingClientRect();
                      return !r.width || (r.left >= box.left - 2 && r.right <= box.right + 2);
                    }) &&
                  el.scrollWidth <= el.clientWidth + 1 &&
                  document.documentElement.scrollWidth <= innerWidth + 1
                );
              }),
            )
            .toBe(true);
        }
        // Tab from the preceding focus stop reaches the native radio group.
        const checked = root.getByRole('radio', { checked: true });
        await checked.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(checked).toBeFocused();
        const before = await checked.getAttribute('value');
        await page.keyboard.press('ArrowRight');
        await expect
          .poll(() => root.getByRole('radio', { checked: true }).getAttribute('value'))
          .not.toBe(before);
        await drawn(root);
      });
  });
