import { test, expect, openScreen } from '../screens/fixtures.ts';
import { sharingCases } from '../screens/sharing-cases.ts';
import { downloadBytes, parseCsv } from '../helpers.ts';
import { fitsViewport, targetVisible } from '../screens/interactions.ts';

for (const entry of sharingCases)
  test.describe(`share ${entry.id}`, () => {
    test.use({ display: entry.display, permissions: ['clipboard-read', 'clipboard-write'] });
    test('copy, reopen target, CSV and PNG', async ({ page, browser, browserEvents, siteURL }) => {
      await openScreen(page, siteURL, entry.samples[0]!);
      const opener = page
        .getByRole('button', { name: /^Сподели/ })
        .filter({ visible: true })
        .first();
      await opener.click();
      const menu = page.getByRole('dialog', { name: /Сподел/ });
      await expect(menu).toBeVisible();
      await menu.getByRole('button', { name: /^Копирай връзка/ }).click();
      await expect(page.getByText('Връзката е копирана.', { exact: true })).toBeVisible();
      const url = await page.evaluate(() => navigator.clipboard.readText());
      expect(new URL(url).origin).toBe(new URL(siteURL).origin);
      const id = new URLSearchParams(url.split('?')[1]).get('to');
      expect(id).toBeTruthy();
      const fresh = await browser.newContext({
        viewport: page.viewportSize()!,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      });
      try {
        await browserEvents.trackContext(fresh);
        const targetPage = await fresh.newPage();
        await targetPage.goto(url);
        await targetVisible(targetPage, id!);
      } finally {
        await fresh.close();
      }
      await opener.click();
      await expect(menu).toBeVisible();
      const csvAction = menu.getByRole('button', { name: /CSV/ });
      const imageAction = menu.getByRole('button', { name: /^Изтегли изображение/ });
      if (!entry.png) await expect(imageAction).toHaveCount(0);
      // Some narrative blocks offer an image and a link but have no tabular data.
      if (entry.csv) {
        const pending = page.waitForEvent('download');
        await csvAction.click();
        const csv = await pending;
        expect(csv.suggestedFilename()).toBe(`bns-${entry.key}-${id}.csv`.toLowerCase());
        const bytes = await downloadBytes(csv);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        expect(text).not.toMatch(/undefined|NaN/);
        const [header, ...rows] = parseCsv(text);
        expect(rows.length).toBeGreaterThan(0);
        const source = header!.indexOf('източник');
        expect(source).toBeGreaterThanOrEqual(0);
        for (const row of rows) {
          expect(row).toHaveLength(header!.length);
          expect(row[source]!.trim()).not.toBe('');
        }
      } else {
        await expect(csvAction).toHaveCount(0);
      }
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      if (!entry.png) return;
      await opener.click();
      await expect(menu).toBeVisible();
      const pending = page.waitForEvent('download');
      await imageAction.click();
      const png = await downloadBytes(await pending);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(800);
      // Decode the actual download: a blank canvas can still have a valid PNG header.
      const pixels = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + base64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set<number>();
        for (let i = 0; i < data.length; i += 16)
          colors.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
        return colors.size;
      }, png.toString('base64'));
      expect(pixels).toBeGreaterThan(16);
    });
  });
test('sharing menu from the keyboard', async ({ page, siteURL }) => {
  await openScreen(page, siteURL, '#/prihodi');
  const opener = page
    .getByRole('button', { name: /^Сподели/ })
    .filter({ visible: true })
    .first();
  await opener.focus();
  await opener.press('Enter');
  const menu = page.getByRole('dialog', { name: /Сподел/ });
  await fitsViewport(menu);
  await expect.poll(() => menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(opener).toBeFocused();
});
test('same-page targets reveal a tab, a disclosure and a plain block', async ({
  page,
  siteURL,
}) => {
  await openScreen(page, siteURL, '#/prihodi');
  const ids = [
    await page
      .getByRole('tabpanel', { includeHidden: true })
      .last()
      .locator('[id]')
      .first()
      .getAttribute('id'),
    await page.locator('#view details:not([open]) [id]').first().getAttribute('id'),
    's06-views',
  ];
  for (const id of ids) {
    expect(id).toBeTruthy();
    await page.evaluate((id) => {
      const url = new URL(location.href);
      const [path, query] = url.hash.split('?');
      const params = new URLSearchParams(query);
      params.set('to', id!);
      location.hash = path + '?' + params;
    }, id);
    await targetVisible(page, id!);
  }
});
