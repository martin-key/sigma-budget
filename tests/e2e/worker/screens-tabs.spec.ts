import { test, expect, openScreen } from '../screens/fixtures.ts';
import { withQuery } from '../screens/cases.ts';
import { drawn } from '../screens/interactions.ts';

const cases = [
  { address: '#/prihodi', query: 'izgled' },
  { address: '#/vedomstva?per=2026.law', query: 'tab' },
  { address: '#/merki?per=2026.law', query: 'spisak' },
  { address: '#/merki?per=2027.draft', query: 'spisak' },
  { address: '#/vrazka', query: 'tab' },
];
for (const entry of cases)
  test(`tabs ${entry.address}`, async ({ page, siteURL }) => {
    await openScreen(page, siteURL, entry.address);
    // The public tab list is unique on each of these screens.
    const list = page.getByRole('tablist');
    const names = await list.getByRole('tab').allTextContents();
    const values = await list
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => (tab as HTMLElement).dataset.key!));
    const order = [...names.keys()].slice(1).concat(0);
    for (const i of order) {
      const tab = list.getByRole('tab', { name: names[i]!.trim(), exact: true });
      await tab.scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => scrollY);
      await tab.click();
      const panel = page.getByRole('tabpanel', { name: names[i]!.trim(), exact: true });
      await drawn(panel);
      await expect
        .poll(() => new URLSearchParams(page.url().split('?')[1]).get(entry.query))
        .toBe(values[i]);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, 0);
    }
    const first = list.getByRole('tab', { name: names[0]!.trim(), exact: true });
    await first.focus();
    await first.press('ArrowRight');
    await expect(
      list.getByRole('tab', { name: names[1]!.trim(), exact: true, selected: true }),
    ).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: names[1]!.trim(), exact: true })).toBeVisible();
    await expect
      .poll(() => new URLSearchParams(page.url().split('?')[1]).get(entry.query))
      .toBe(values[1]);
    await page.reload();
    await expect(page.getByRole('tabpanel', { name: names[1]!.trim(), exact: true })).toBeVisible();
    await openScreen(page, siteURL, withQuery(entry.address, { [entry.query]: 'unknown' }));
    await expect(page.getByRole('tabpanel', { name: names[0]!.trim(), exact: true })).toBeVisible();
  });
