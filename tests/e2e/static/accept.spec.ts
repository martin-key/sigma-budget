import { test, expect, enableHashRoutes } from '../fixtures.ts';
import {
  readComparisonGrid,
  measureTouchTargets,
  measureOverflow,
  inspectFocus,
  ROUTES,
} from '../accept-probes.ts';
import { expectedPlan, expectedComparison, executionValue } from '../expected.ts';
test.use({
  serviceWorkers: 'block',
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
});
const rows = [
  ['rev', 'Приходи'],
  ['exp.total', 'Разходи'],
  ['balance', 'Салдо'],
] as const;
function number(s: string) {
  const match = s
    .replaceAll('−', '-')
    .replace(/[  ]/g, ' ')
    .match(/[-+]?\d[\d ]*(?:,\d+)?/);
  return match ? Number(match[0].replaceAll(' ', '').replace(',', '.')) : null;
}
test('acceptance numbers from independent release data', async ({ context, page, siteURL }) => {
  test.setTimeout(180_000);
  await enableHashRoutes(context);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 160));
  });
  page.on('pageerror', (e) => errors.push('EXC ' + String(e).slice(0, 160)));
  const base = siteURL + '/index.html';
  await page.goto(base + '#/');
  await expect(page.locator('#s15-b-plan .s15-plan-row').first()).toBeVisible({ timeout: 8000 });
  const home = (await page.locator('#s15-b-plan').innerText()).replace(/[   ]/g, ' '),
    plan = expectedPlan(),
    comparison = expectedComparison();
  for (const s of [...plan.sums, ...plan.cur]) expect.soft(home, 'home plan ' + s).toContain(s);
  await page.goto(base + '#/izpalnenie');
  await expect(page.locator('table.data').first()).toBeVisible({ timeout: 8000 });
  const comparisonText = (await page.locator('main').innerText())
    .replace(/[  ]/g, ' ')
    .replaceAll('−', '-');
  for (const s of [
    ...comparison.prev,
    ...comparison.cur,
    ...comparison.diff,
    comparison.balanceDiff,
  ])
    expect.soft(comparisonText, 'comparison reference ' + s).toContain(s.replaceAll('−', '-'));
  expect.soft(comparisonText).toContain('дефицит');
  expect.soft(comparisonText).not.toMatch(/-\d+[,.]\d+ ?млрд\. €, [+-]?\d/);
  for (const [g1, g2] of [
    [2025, 2026],
    [2024, 2025],
    [2024, 2026],
  ] as const)
    for (const scope of ['kfp', 'nat', 'eu'])
      for (const [month, mode] of [
        [g2 === 2026 ? 8 : 12, 'kum'],
        [g2 === 2026 ? 8 : 12, 'mesec'],
        [1, 'kum'],
        [1, 'mesec'],
        [5, 'kum'],
        [5, 'mesec'],
      ] as const) {
        const query = `?g1=${g1}&g2=${g2}&mesec=${month}&obhvat=${scope}&rez=${mode}`;
        await test.step(query, async () => {
          await page.goto(base + '#/izpalnenie' + query);
          await expect(page.locator('#s15-t-grid').first()).toBeVisible({ timeout: 8000 });
          await expect(page.locator('#s15-t-grid-cap')).toContainText(`${g1} и ${g2} г.`);
          await expect(page.locator('#s15-mesec')).toHaveValue(String(month));
          await expect(page.locator('#s15-obhvat')).toHaveValue(scope);
          await expect(page.locator('input[name="s15-rez"]:checked')).toHaveValue(
            mode === 'kum' ? 'natrupano' : mode,
          );
          const grid: Record<string, string[]> | null = await page.evaluate(readComparisonGrid);
          expect(grid, query + ': table').not.toBeNull();
          if (!grid) throw new Error('Missing comparison table');
          for (const [row, label] of rows) {
            const key = Object.keys(grid).find((k) => k.startsWith(label));
            expect(key, query + ': row ' + label).toBeDefined();
            if (!key) throw new Error('Missing comparison row: ' + label);
            const actualValues = grid[key]!.slice(1, 4).map(number),
              previousValue = executionValue(g1, scope, row, month, mode) / 1000,
              currentValue = executionValue(g2, scope, row, month, mode) / 1000;
            expect
              .soft(
                actualValues[0] !== null && Math.abs(actualValues[0]! - previousValue) <= 0.0051,
                query + ' ' + label + ' ' + g1,
              )
              .toBe(true);
            expect
              .soft(
                actualValues[1] !== null && Math.abs(actualValues[1]! - currentValue) <= 0.0051,
                query + ' ' + label + ' ' + g2,
              )
              .toBe(true);
            expect
              .soft(actualValues[2], query + ' ' + label + ' difference is numeric')
              .not.toBeNull();
            expect
              .soft(
                Math.abs(actualValues[2]! - (currentValue - previousValue)),
                query + ' ' + label + ' difference',
              )
              .toBeLessThanOrEqual(0.0101);
          }
        });
      }
  expect.soft(errors).toEqual([]);
});
for (const w of [1280, 768, 640, 390, 360, 320])
  test(`acceptance layout ${w}`, async ({ browser, siteURL }) => {
    test.setTimeout(120_000);
    const touch = w <= 768;
    const context = await browser.newContext({
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      hasTouch: touch,
      isMobile: false,
      viewport: { width: w, height: w >= 700 ? 900 : 800 },
    });
    try {
      await enableHashRoutes(context);
      const page = await context.newPage(),
        errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text().slice(0, 160));
      });
      page.on('pageerror', (e) => errors.push('EXC ' + String(e).slice(0, 160)));
      for (const [name, h, screen] of ROUTES)
        await test.step(name!, async () => {
          await page.goto(siteURL + '/index.html' + h);
          await expect(page.locator('h1').first()).toBeVisible({ timeout: 8000 });
          await expect(page.locator('article.page')).toHaveAttribute('data-route', screen!);
          await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const overflow = await page.evaluate(measureOverflow);
          expect.soft(overflow.page, name + ': page overflow').toBeLessThanOrEqual(0);
          expect.soft(overflow.wide, name + ': content overflow').toEqual([]);
          expect.soft(overflow.gridOver, name + ': grid overflow').toBeLessThanOrEqual(0);
          const missing = await page.evaluate(() =>
            [...document.querySelectorAll('figure .chart, .chart[data-ready="1"]')]
              .filter((c) => {
                const f = c.closest('figure, section.block');
                return f && !f.querySelector('table, details.fig-table, [data-attach]');
              })
              .map((c) => c.id || c.className)
              .slice(0, 3),
          );
          expect.soft(missing, name + ': chart table twins').toEqual([]);
          if (touch && [390, 768].includes(w))
            expect
              .soft(await page.evaluate(measureTouchTargets), name + ': touch targets')
              .toEqual([]);
        });
      expect.soft(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
for (const w of [1280, 390])
  test(`acceptance keyboard ${w}`, async ({ browser, siteURL }) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      viewport: { width: w, height: w >= 700 ? 900 : 800 },
    });
    try {
      await enableHashRoutes(context);
      const page = await context.newPage();
      for (const [name, h, screen] of [
        ['home', '#/', 'S01'],
        ['izpalnenie', '#/izpalnenie', 'S15'],
        ['danaci', '#/danaci', 'S18'],
        ['razhodi', '#/razhodi', 'S07'],
        ['tarsene', '#/tarsene', 'S28'],
      ] as const) {
        await page.goto(siteURL + '/index.html' + h);
        await expect(page.locator('h1').first()).toBeVisible({ timeout: 8000 });
        await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const stops: { n: string; ring: boolean; back: boolean; tag: string }[] = [];
        let back = 0;
        const missingFocusRings: string[] = [];
        for (let i = 0; i < 60; i++) {
          await page.keyboard.press('Tab');
          const f = await page.evaluate(inspectFocus);
          if (!f || f.tag === 'body') break;
          stops.push(f);
          if (!f.ring) missingFocusRings.push(f.n);
          if (f.back && i > 0) back++;
        }
        expect.soft(stops.length, name + ': tab stops').toBeGreaterThanOrEqual(8);
        expect.soft(missingFocusRings, name + ': visible focus').toEqual([]);
        expect.soft(back, name + ': DOM order').toBe(0);
        expect
          .soft(
            stops.filter((s) => !s.n),
            name + ': text names',
          )
          .toEqual([]);
      }
    } finally {
      await context.close();
    }
  });
