import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures.ts';
import { downloadBytes } from '../helpers.ts';
test.use({ serviceWorkers: 'block' });
// Parse first-response HTML without executing its scripts, as html.unescape/re.sub did.
const text = (page: Page, markup: string) =>
  page.evaluate(
    (value) => {
      const decoder = document.createElement('textarea');
      decoder.innerHTML = value;
      return decoder.value;
    },
    markup.replace(/<[^>]+>/g, ' '),
  );
const spaces = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');
const CASES: [string | null, string, string][] = [
  [null, '2027.draft', ''],
  ['2026.law', '2026.law', ''],
  ['2026.draft', '2026.law', 'Старият адрес'],
  ['2027.forecast', '2027.draft', 'Прогнозата за 2027'],
  ['2028.forecast', '2028.forecast', 'Прогнозата за 2028'],
  ['2026.expected', '2026.expected', ''],
  ['2027.draft', '2027.draft', ''],
  ['2029.forecast', '2029.forecast', ''],
  ['unknown', '2027.draft', 'Непознат период'],
];
const ready = 'article.page[data-ready="1"]';
test('SSR period notices, raw input and distinct alias HTML without JavaScript', async ({
  request,
  page,
  siteURL,
}) => {
  const first = new Map<string | null, string>();
  for (const [requested, , notice] of CASES) {
    const url = siteURL + '/pari' + (requested ? '?per=' + requested : '');
    const response = await request.get(url);
    const markup = await response.text();
    expect.soft(response.status(), 'SSR status ' + requested).toBe(200);
    expect.soft(response.url(), 'SSR must not redirect ' + requested).toBe(url);
    expect.soft(await text(page, markup), 'SSR notice ' + requested).toContain(notice);
    if (requested)
      expect.soft(markup, 'SSR raw per retained ' + requested).toContain('per=' + requested);
    first.set(requested, markup);
  }
  expect(first.get('2026.draft'), 'alias and canonical HTML differ').not.toBe(
    first.get('2026.law'),
  );
  expect(first.get('2027.forecast'), 'forecast alias and draft HTML differ').not.toBe(
    first.get('2027.draft'),
  );
});
for (const hashMode of [false, true]) {
  test.describe(hashMode ? 'hash addresses' : 'path addresses', () => {
    test.use({ reducedMotion: 'reduce' });
    const address = '/' + (hashMode ? '#/pari' : 'pari');
    test.beforeEach(async ({ page }) => {
      if (hashMode) await page.addInitScript('window.__HASH_ROUTES__=true');
    });
    for (const [requested, canonical, notice] of CASES)
      test(`first client paint ${requested}`, async ({ page, siteURL }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        const url = siteURL + address + (requested ? '?per=' + requested : '');
        await page.goto(url);
        await page.waitForSelector(ready);
        const state = await page.evaluate<{ period: string }>(
          "import('/js/store.js').then(m => m.store.snapshot())",
        );
        expect.soft(state.period, 'client canonical state ' + requested).toBe(canonical);
        expect.soft(page.url(), 'first client paint keeps input URL ' + requested).toBe(url);
        if (notice)
          expect
            .soft(await page.locator('.period-notice').innerText(), 'client notice ' + requested)
            .toContain(notice);
        expect.soft(errors, 'client errors ' + requested).toEqual([]);
      });
    for (const [old, canonical, notice] of CASES.filter((c) =>
      ['2026.draft', '2027.forecast', '2028.forecast'].includes(c[0] ?? ''),
    ))
      test(`migrate storage ${old}`, async ({ page, siteURL }) => {
        await page.addInitScript(
          (value) =>
            localStorage.setItem('bns.prefs.v1', JSON.stringify({ period: value, unit: 'eur' })),
          old,
        );
        await page.goto(siteURL + address);
        await page.waitForFunction((p) => location.href.includes('per=' + p), canonical);
        await page.waitForFunction(
          "async p => (await import('/js/store.js')).store.get('period')===p",
          canonical,
        );
        expect
          .soft(await page.locator('.period-notice').innerText(), 'storage notice ' + old)
          .toContain(notice);
        const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('bns.prefs.v1')!));
        expect.soft(prefs, 'old period removed ' + old).not.toHaveProperty('period');
        expect.soft(prefs.unit, 'unit preserved ' + old).toBe('eur');
      });
    for (const variant of ['url-wins', 'corrupt', 'blocked'])
      test(`preferences ${variant}`, async ({ page, siteURL }) => {
        if (variant === 'blocked')
          await page.addInitScript(
            "Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})",
          );
        else if (variant === 'corrupt')
          await page.addInitScript("localStorage.setItem('bns.prefs.v1','broken')");
        else
          await page.addInitScript(
            "localStorage.setItem('bns.prefs.v1',JSON.stringify({period:'2027.forecast',unit:'eur'}))",
          );
        await page.goto(siteURL + address + (variant === 'url-wins' ? '?per=2026.expected' : ''));
        await page.waitForSelector(ready);
        expect
          .soft(
            await page.evaluate("import('/js/store.js').then(m => m.store.get('period'))"),
            variant + ' state',
          )
          .toBe(variant === 'url-wins' ? '2026.expected' : '2027.draft');
        expect
          .soft(
            await page.locator('.period-notice').count(),
            variant + ' never shows stored alias notice',
          )
          .toBe(0);
      });
  });
}
const PRODUCTS = [
  ['/vedomstva', '47', 's10-bill-table'],
  ['/vedomstvo/3800', 'чл. 33', 's11-bill-rows'],
  ['/obshtini', '5 162 139,3', 's20-bill-table'],
  ['/obshtina/BLG03', '60 265,9', 's21-transfers-2027-table'],
  ['/dalg', '44 343,9', 's17-debt-table'],
  ['/prognoza', '2027–2029', 's13-rev-exp'],
  ['/vedomstva?variant=billMc', 'Вариант на Министерския съвет', 's10-bill-table'],
  [
    '/obshtini?per=2029.forecast',
    'Няма индивидуално общинско разпределение',
    's20-framework-table',
  ],
];
test('product SSR/client parity and real variant CSV', async ({ page, request, siteURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [path, expected, target] of PRODUCTS) {
    const response = await request.get(siteURL + path);
    expect(response.ok(), 'SSR product fetch ' + path).toBe(true);
    expect
      .soft(spaces(await text(page, await response.text())), '2027 SSR product ' + path)
      .toContain(expected);
    await page.goto(siteURL + path);
    await page.waitForSelector(ready);
    await page.waitForSelector('#' + target);
    expect
      .soft(spaces(await page.locator('article.page').innerText()), '2027 client product ' + path)
      .toContain(expected);
  }
  await page.goto(siteURL + '/vedomstva?variant=billMc');
  await page.waitForSelector(ready);
  await page.click('[data-share="s10-bill-list"]');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: false }).click();
  const csv = (await downloadBytes(await download)).toString('utf8').replace(/^\uFEFF/, '');
  expect.soft(csv, 'variant in real CSV download').toContain('Вариант на Министерския съвет');
  expect.soft(csv, 'period in real CSV download').toContain('2027.draft');
  expect.soft(csv, 'cell provenance in real CSV download').toContain('budget2027-provenance.json#');
});
for (const width of [1280, 390])
  test(`period selector at ${width}px`, async ({ page, siteURL }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(siteURL + '/pari');
    await page.waitForSelector(ready);
    await page.click('#btn-period');
    const group = page
      .locator('fieldset.period-year')
      .filter({ has: page.locator('input[value="2026.law"]') });
    expect
      .soft(
        await group
          .locator('input')
          .evaluateAll((items) => items.map((i) => (i as HTMLInputElement).value)),
        '2026 year group',
      )
      .toEqual(['2026.law', '2026.expected']);
    expect
      .soft(await page.locator('input[type="radio"][name^="per"]').count(), 'seven ordered options')
      .toBe(7);
    await page.screenshot({ path: testInfo.outputPath(`period-selector-${width}.png`) });
    await page.keyboard.press('Escape');
    expect
      .soft(
        await page.locator('#btn-period').evaluate((b) => document.activeElement === b),
        'period focus restored',
      )
      .toBe(true);
  });
