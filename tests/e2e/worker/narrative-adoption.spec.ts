import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../fixtures.ts';
import { downloadBytes } from '../helpers.ts';
import { ROOT } from '../../../apps/web/scripts/serve.ts';
test.use({ serviceWorkers: 'allow' });

const FIXTURES = join(ROOT, 'apps/web/app/routes/__fixtures__');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const text = (els: Element[]) => els.map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
const twoFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

for (const path of ['/novo', '/novo?vid=law', '/zakon', '/zakon?per=2026.draft'])
  test(`server DOM adopted ${path}`, async ({ page, siteURL }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(
      "window.firstArticle=null;window.firstHeading=null;new MutationObserver(()=>{window.firstArticle ||= document.querySelector('article.page');window.firstHeading ||= document.querySelector('article h1');}).observe(document,{subtree:true,childList:true});",
    );
    await page.goto(siteURL + path);
    await page.waitForSelector('article[data-ready="1"]');
    expect(
      await page.evaluate(
        "window.firstArticle === document.querySelector('article.page') && window.firstHeading === document.querySelector('article h1')",
      ),
      path + ': server DOM adopted',
    ).toBe(true);
    expect(errors, path + ': no browser or React errors').toEqual([]);
    for (const [width, margin] of [
      [1280, 48],
      [400, 32],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const margins = await page
        .locator('.page-body > * + *')
        .evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).marginTop)));
      expect(
        margins.length,
        `${path}: section spacing at ${width}px must be nonempty`,
      ).toBeGreaterThan(0);
      expect(
        margins.every((value) => value === margin),
        `${path}: section spacing at ${width}px: ${margins}`,
      ).toBe(true);
    }
  });
test('feed and law interactions preserve fixtures, metadata and focus', async ({
  page,
  browser,
  siteURL,
}) => {
  await page.goto(siteURL + '/novo');
  await page.waitForSelector('article[data-ready="1"]');
  await page.evaluate(`(() => {
    window.queryCalls = [];
    const replace = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      if (new Error().stack.includes('setQuery')) window.queryCalls.push(args[2]);
      return replace(...args);
    };
  })()`);
  await page.locator('[data-query="vid=law"]').focus();
  await page.locator('[data-query="vid=law"]').click();
  await page.waitForFunction(
    `() => location.search.includes('vid=law') && document.querySelector('[data-query="vid=law"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('article')?.dataset.ready === '1'`,
  );
  await page.evaluate(twoFrames);
  expect(await page.evaluate('window.queryCalls.length'), 'feed filter invokes setQuery once').toBe(
    1,
  );
  expect(
    await page.evaluate('document.activeElement?.dataset.query'),
    'feed filter retains focus',
  ).toBe('vid=law');
  await page.locator('#s16-b-summary [data-src]').click();
  const inputs = JSON.parse(fixture('narrative-inputs.json'));
  const sources: string[] = inputs.feed.highlights.planBasis.source;
  const sourceText = await page.locator('[role=dialog]').innerText();
  for (const key of sources)
    expect(sourceText, 'feed source dialog preserves plan basis sources').toContain(
      inputs.core.sources[key].title,
    );
  await page.keyboard.press('Escape');
  expect(
    await page.locator('#s16-b-summary [data-src]').evaluate((el) => el === document.activeElement),
    'source dialog restores focus',
  ).toBe(true);
  await page.locator('#s16-rss-url').focus();
  expect(
    await page.locator('#s16-rss-url').evaluate((el) => {
      const input = el as HTMLInputElement;
      return input.selectionStart === 0 && input.selectionEnd === input.value.length;
    }),
    'RSS focus selects complete URL',
  ).toBe(true);
  await page.goto(siteURL + '/zakon');
  await page.waitForSelector('article[data-ready="1"]');
  await page.locator('#s14-bjudzheti [data-share]').click();
  expect(
    await page
      .locator('.share-menu [data-act]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.act)),
    'law share offers image, link, CSV and report',
  ).toEqual(['png', 'copy-link', 'csv', 'report']);
  const downloaded = page.waitForEvent('download');
  await page.locator('[data-act="csv"]').click();
  const actualCsv = await downloadBytes(await downloaded);
  const visitRelease =
    (await page.locator('meta[name="release-id"]').getAttribute('content')) || '';
  const fixtureRelease = JSON.parse(fixture('narrative-manifest.json')).releaseId;
  const expectedCsv = Buffer.from(
    fixture('S14-budgets.csv').replaceAll(';' + fixtureRelease + ';', ';' + visitRelease + ';'),
  );
  expect(visitRelease, 'law CSV HTML visit release').toMatch(/^[0-9a-f]{64}$/);
  // The byte comparison below also proves delimiters, quoting, BOM and CRLF.
  // Parse semicolon CSV independently of the application export code.
  const rows = parseCsv(actualCsv.toString('utf8').replace(/^\uFEFF/, ''));
  const releaseColumn = rows[0]!.indexOf('издание');
  expect(releaseColumn, 'CSV release column').toBeGreaterThanOrEqual(0);
  expect(rows.length, 'law CSV has data rows').toBeGreaterThan(1);
  expect(
    rows.slice(1).every((row) => row[releaseColumn] === visitRelease),
    'law CSV names HTML visit release in every row',
  ).toBe(true);
  expect(
    actualCsv.equals(expectedCsv),
    'law CSV matches independent table for this visit (bytes, BOM, line endings)',
  ).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('#s14-t-bjudzheti [data-key="law"]').click();
  const expectedContext = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const expected = await expectedContext.newPage();
    await expected.setContent(fixture('S14-sort.browser.html'));
    const sorted = '#s14-t-bjudzheti tbody tr';
    expect(
      await page.locator(sorted).evaluateAll(text),
      'sorted law rows equal independent main fixture',
    ).toEqual(await expected.locator(sorted).evaluateAll(text));
    expect(
      await page.evaluate('document.activeElement?.dataset.key'),
      'sorting retains focus',
    ).toBe('law');
    const beforeUnit = await page.locator('#view article.page').elementHandle();
    await page.locator('#s14-unit-pct').check();
    await page.waitForFunction((before) => {
      const view = document.getElementById('view');
      const article = view?.querySelector<HTMLElement>('article.page');
      return (
        !!article &&
        article !== before &&
        article.dataset.ready === '1' &&
        view!.getAttribute('aria-busy') !== 'true' &&
        article.querySelector('#s14-nakratko .kpi-unit')?.textContent === 'от БВП'
      );
    }, beforeUnit);
    await page.evaluate(twoFrames);
    await beforeUnit?.dispose();
    await expected.setContent(fixture('S14-pct.browser.html'));
    const kpis = '#s14-nakratko .kpi-value';
    expect(
      await page.locator(kpis).evaluateAll(text),
      'GDP percentages equal independent main fixture',
    ).toEqual(await expected.locator(kpis).evaluateAll(text));
    expect(await page.evaluate('document.activeElement.id'), 'unit switch retains focus').toBe(
      's14-unit-pct',
    );
    await page.goto(siteURL + '/zakon?to=s14-t-chl1-redove');
    await page.waitForSelector('article[data-ready="1"]');
    expect(
      await page.locator('#s14-t-chl1-redove').evaluate((el) => el.closest('details')!.open),
      'legacy deep target opens disclosure',
    ).toBe(true);
    await page.locator('.nav-main[data-grp="1"]').click();
    await page.locator('[role=dialog] a[href="/novo"]').click();
    await page.waitForSelector('article[data-route="S16"][data-ready="1"]');
    expect(
      await page.locator('#view').getAttribute('data-react-owned'),
      'navigation reaches React feed',
    ).not.toBeNull();
    await page.goBack();
    await page.waitForSelector('article[data-route="S14"][data-ready="1"]');
    expect(page.url(), 'Back stays owned by legacy navigation').toContain('/zakon');
  } finally {
    await expectedContext.close();
  }
});
/** RFC-style semicolon CSV: retain quoted newlines, double quotes and empty fields. */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ';' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
