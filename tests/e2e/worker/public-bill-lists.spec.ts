import { test, expect } from '../visitor-fixtures.ts';
import { downloadBytes, parseCsv } from '../helpers.ts';
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
for (const width of [1280, 390]) {
  test(`current-bill lists at ${width}px`, async ({ freshContext, siteURL }, testInfo) => {
    const context = await freshContext({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    async function go(path: string) {
      await page.goto(siteURL + path);
      await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
    }
    const query = async (key: string, value: string) =>
      expect(page).toHaveURL((url) => url.searchParams.get(key) === value);
    async function checkLayout() {
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
    async function compareSSR(selector: string, backSelector?: string) {
      await expect(page.locator(selector).locator('tr').first()).toBeVisible();
      const staticContext = await freshContext({
        javaScriptEnabled: false,
        viewport: { width, height: 900 },
        serviceWorkers: 'allow',
      });
      try {
        const other = await staticContext.newPage();
        await other.goto(page.url());
        await expect
          .poll(() => other.locator(selector).innerText())
          .toBe(await page.locator(selector).innerText());
        if (backSelector)
          expect(await other.locator(backSelector).first().getAttribute('href')).toBe(
            await page.locator(backSelector).first().getAttribute('href'),
          );
      } finally {
        await staticContext.close();
      }
    }
    await test.step('Търсене, сортиране, CSV и връщане към списъците', async () => {
      await go('/vedomstva?variant=billMc');
      await expect(page.locator('#s10-bill-table tbody tr')).toHaveCount(1);
      await expect(page.locator('#s10-bill-table tbody')).toContainText('съдебната власт');
      await page.locator('#bill-variant').selectOption('bill');
      await expect(page.locator('#s10-bill-table tbody tr')).toHaveCount(47);
      let field = page.locator('#bill-q');
      await field.fill('  vatreshnite  ');
      await expect(page.locator('#s10-bill-table tbody tr')).toHaveCount(1);
      await expect(page.locator('#s10-bill-table tbody')).toContainText('вътрешните работи');
      await expect(field).toBeFocused();
      await expect(page.locator('#bill-count')).toHaveText('Намерени ведомства: 1.');
      await query('q', 'vatreshnite');
      await field.press('Escape');
      await expect(page.locator('#s10-bill-table tbody tr')).toHaveCount(47);
      await expect(field).toBeFocused();
      const sort = page.locator('#s10-bill-table .th-sort[data-key="expenditure"]');
      await sort.click();
      await sort.click();
      await query('sort', 'expenditure');
      await query('dir', 'desc');
      await expect(sort.locator('..')).toHaveAttribute('aria-sort', 'descending');
      await compareSSR('#s10-bill-table tbody');
      await field.fill('министерств');
      await expect(page.locator('#bill-count')).not.toHaveText('Намерени ведомства: 47.');
      const count = await page.locator('#s10-bill-table tbody tr').count();
      const first = await page.locator('#s10-bill-table tbody th').first().innerText();
      await page.locator('[data-share="s10-bill-list"]').click();
      const downloaded = page.waitForEvent('download');
      await page.locator('[data-act="csv"]').click();
      const csv = await downloadBytes(await downloaded);
      await testInfo.attach('institutions.csv', { body: csv, contentType: 'text/csv' });
      const rows = parseCsv(csv.toString('utf8').replace(/^\uFEFF/, ''));
      expect(rows).toHaveLength(count + 1);
      expect(rows[1]![0]).toBe(first);
      expect(rows[0]!).toContain('Разходи, хил. €');
      for (const [column, value] of [
        ['период', '2027.draft'],
        ['единица', 'хил. €'],
      ] as const) {
        expect(rows[0]!).toContain(column);
        expect(rows.slice(1).every((row) => row[rows[0]!.indexOf(column)] === value)).toBe(true);
      }
      expect(rows[0]!).toContain('източник');
      expect(rows[0]!).toContain('обхват');
      expect(rows.slice(1).every((row) => !!row[rows[0]!.indexOf('източник')])).toBe(true);
      expect(
        rows
          .slice(1)
          .every((row) => row[rows[0]!.indexOf('обхват')]!.includes('не е целият бюджет')),
      ).toBe(true);
      const shared: string = await page.evaluate(async (path) => {
        const share = await import(path);
        return share.linkFor(share.get('s10-bill-list'));
      }, '/js/share.js');
      const fresh = await freshContext({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
        reducedMotion: 'reduce',
      });
      try {
        const twin = await fresh.newPage();
        await twin.goto(shared);
        await expect(twin.locator('article.page')).toHaveAttribute('data-ready', '1');
        await expect(twin.locator('#s10-bill-table tbody tr')).toHaveCount(count);
        await expect(twin.locator('#s10-bill-table tbody th').first()).toHaveText(first);
        await expect(twin.locator('#s10-bill-table th[aria-sort="descending"]')).toHaveCount(1);
      } finally {
        await fresh.close();
      }
      await checkLayout();
      await page.locator('#s10-bill-table tbody a').first().click();
      await expect(page.locator('article[data-route=\"S11\"]')).toHaveAttribute('data-ready', '1');
      await query('q', 'министерств');
      await query('dir', 'desc');
      let back = 'main nav[aria-label="Трохи"] a[href*="/vedomstva"]';
      await compareSSR('#s11-bill-rows tbody', back);
      await page.locator(back).click();
      await expect(page.locator('#s10-bill-table tbody tr')).toHaveCount(count);
      await expect(page.locator('#s10-bill-table tbody th').first()).toHaveText(first);
      await field.fill('zzzzzzzz');
      await expect(page.locator('#bill-count')).toHaveText('Намерени ведомства: 0.');
      await expect(page.locator('#s10-bill-table tbody')).toContainText('изчисти търсенето');
      await page.locator('#s10-bill-table .th-sort[data-key="name"]').click();
      await expect(page.locator('#s10-bill-table tbody')).toContainText('Няма ведомства');
      await page.locator('[data-bill-clear]').click();
      await expect(field).toBeFocused();
      await expect(page.locator('#s10-bill-table tbody tr')).toHaveCount(47);
      await go('/obshtini?oblast=unknown&q=%20Благоевград%20');
      await expect(page.locator('#bill-oblast')).toHaveValue('');
      await expect(page.locator('#s20-bill-table tbody tr')).toHaveCount(1);
      await expect(page.locator('#s20-list-2027')).toContainText('Непозната област');
      await compareSSR('#s20-bill-table tbody');
      await go('/obshtini?oblast=BLG');
      field = page.locator('#bill-q');
      await field.fill('blagoevgrad');
      await expect(page.locator('#bill-count')).toHaveText('Намерени общини: 1.');
      await expect(field).toBeFocused();
      await page.locator('#s20-bill-table .th-sort[data-key="v0"]').click();
      await page.locator('#s20-bill-table .th-sort[data-key="v0"]').click();
      await checkLayout();
      await page.locator('#s20-bill-table tbody a').first().click();
      await expect(page.locator('article[data-route=\"S21\"]')).toHaveAttribute('data-ready', '1');
      await query('oblast', 'BLG');
      await query('q', 'blagoevgrad');
      back = 'main nav[aria-label="Трохи"] a[href*="/obshtini"]';
      await compareSSR('#s21-transfers-2027-table tbody', back);
      await checkLayout();
      await page.locator(back).click();
      await expect(page.locator('#bill-oblast')).toHaveValue('BLG');
      await expect(page.locator('#bill-q')).toHaveValue('blagoevgrad');
      await expect(page.locator('#s20-bill-table th[aria-sort="descending"]')).toHaveCount(1);
      field = page.locator('#bill-q');
      await field.fill('няматакаваобщина');
      await expect(page.locator('#bill-count')).toHaveText('Намерени общини: 0.');
      await checkLayout();
      await field.press('Escape');
      await expect(page.locator('#bill-count')).not.toHaveText('Намерени общини: 0.');
      await expect(page.locator('#bill-oblast')).toHaveValue('BLG');
      for (const [path, text] of [
        ['/prihodi?per=2028.forecast', '2028 · Прогноза'],
        ['/razhodi?per=2029.forecast', '2029 · Прогноза'],
        ['/obshtini?per=2028.forecast', '2028 · Прогноза'],
        ['/vedomstva?per=2026.law', '2026 · Закон'],
      ] as const) {
        await go(path);
        await expect(page.locator('.context')).toContainText(text);
      }
    });
  });
}
