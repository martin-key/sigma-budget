import { createRequire } from 'node:module';
import type { AxeResults, RunOptions } from 'axe-core';
import type { Page } from '@playwright/test';
import { test, expect } from '../audit-fixtures.ts';
import { downloadBytes, parseCsv } from '../helpers.ts';

const require = createRequire(import.meta.url);

test.use({
  serviceWorkers: 'allow',
  colorScheme: 'light',
  reducedMotion: 'reduce',
  bypassCSP: true,
  viewport: { width: 390, height: 844 },
});

test.describe('measure cards on phones', () => {
  for (const width of [320, 390]) {
    test(`tabs and law-index labels fit at ${width}px`, async ({ page, visit }) => {
      await visit('/merki');
      await page.setViewportSize({ width, height: 844 });
      for (const key of ['prihodni', 'razhodni', 'zakoni']) {
        const tab = page.locator(`[role="tab"][data-key="${key}"]`);
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expectNoPageOverflow(page);
        const buttons = page.locator('#s12-27-lists [role="tab"]');
        expect(await buttons.count()).toBeGreaterThan(0);
        const offenders = await buttons.evaluateAll((elements) =>
          elements
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map((element) => ({
              id: element.id,
              text: element.textContent?.trim(),
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            })),
        );
        expect(offenders, 'tab labels must fit their buttons').toEqual([]);
      }
      await expect(page.locator('[role="tab"][data-key="zakoni"]')).toContainText(
        'Мерки по закони',
      );
      await expect(page.locator('#s12-27-zakoni')).toContainText(
        'Мерките от таблици II-7 и II-8 са подредени по закона, когато мотивите посочват такъв.',
      );
    });
  }
  test('every measure retains its three years and folded motives at 390px', async ({
    page,
    visit,
  }) => {
    await visit('/merki');
    await page.locator('[role="tab"][data-key="prihodni"]').click();
    const cards = page.locator('[role="tabpanel"]:not([hidden]) .m27-card');
    expect(await cards.count()).toBeGreaterThan(0);
    const offenders = await page.locator('article *').evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.getClientRects().length &&
            getComputedStyle(element).overflowX === 'auto' &&
            element.scrollWidth > element.clientWidth + 1,
        )
        .map((element) => ({
          id: element.id,
          tag: element.tagName,
          className: element.getAttribute('class'),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        })),
    );
    expect(offenders, 'visible scroll containers must fit their content').toEqual([]);
    await expectNoPageOverflow(page);
    expect(((await cards.count()) + 1) * 3).toBe(
      await page.locator('#s12-II_7-table tbody tr').count(),
    );
    for (const card of await cards.all()) {
      const values = card.locator('.m27-year');
      await expect(values).toHaveCount(3);
      for (const [i, year] of ['2027', '2028', '2029'].entries()) {
        const row = values.nth(i);
        await expect(row.locator('dt')).toContainText(year);
        await expect(row.locator('dd')).toBeVisible();
        await expect(row.locator('dd')).toHaveText(/\S/);
        const box = await row.boundingBox();
        expect(box).not.toBeNull();
        const viewportWidth = page.viewportSize()!.width;
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
      }
      await expect(card.locator('details.s12-quote blockquote')).toHaveCount(1);
    }
  });
  test('search deep link focuses the measure value and CSV retains every original row', async ({
    page,
    visit,
  }) => {
    await visit('/merki?per=2028.forecast&to=s12-II_7-1-1');
    await expect(page.locator('#s12-II_7-1-1')).toBeFocused();
    await expect(page.locator('#s12-II_7-1-1')).toBeInViewport();
    await page.locator('[data-share="s12-II_7"]').click();
    const pending = page.waitForEvent('download');
    await page.locator('[data-act="csv"]').click();
    const rows = parseCsv(
      (await downloadBytes(await pending)).toString('utf8').replace(/^\uFEFF/, ''),
    );
    expect(rows.length).toBe((await page.locator('#s12-II_7-table tbody tr').count()) + 1);
    expect(rows[0]).toContain('Произход');
    expect(rows[0]).toContain('Връзка към произхода');
  });
});

test.describe('tablet tables and Budget 2027', () => {
  test.use({ viewport: { width: 820, height: 1180 } });
  test('expert table shows four columns', async ({ page, visit }) => {
    await visit('/merki?per=2028.forecast&to=s12-II_7-1-1');
    await expect(page.locator('.m27-card').first()).toBeVisible();
    await page.locator('#s12-II_7-d > summary').click();
    await expect(page.locator('#s12-II_7-table')).toBeVisible();
    await expect(page.locator('#s12-II_7-table th[scope="col"]')).toHaveCount(4);
  });
  test('overview keeps key figures, period links and searchable investment projects', async ({
    page,
    visit,
  }) => {
    await visit('/byudzhet-2027');
    await expect(page.locator('#b27-nakratko .kpi')).toHaveCount(6);
    await expect(page.locator('#b27-sravnenie-table')).toBeVisible();
    await expect(page.locator('#b27-kapitalovi-fig')).toBeVisible();
    const more = page.locator('#b27-more a.link-card');
    expect(await more.count()).toBeGreaterThanOrEqual(8);
    await expect(more.last()).toBeVisible();
    for (const path of ['/prihodi', '/merki', '/obshtini', '/dalg', '/prognoza'])
      await expect(
        page.locator(`#b27-more a.link-card[href*="${path}?"][href*="per=2027.draft"]`),
      ).toHaveCount(1);
    await expect(page.locator('#s34-projects .kpi')).toHaveCount(3);
    await expect(page.locator('#s34-projects-by-institution')).toBeVisible();
    const projects = page.locator('#s34-projects-table');
    await expect(projects).toBeVisible();
    await expect(projects.locator('thead th')).toHaveCount(4);
    await expect(projects.locator('tbody tr')).toHaveCount(10);
    await page.locator('#s34-all-projects > summary').click();
    await page.locator('#s34-q').fill('струма');
    await expect(page.locator('#s34-count')).toHaveText(/^Намерени проекти: [1-9]\d?\.$/);
    const count = await page.locator('#s34-project-details tbody tr').count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(226);
  });
  test('legacy measure has a heading', async ({ page, visit }) => {
    await visit('/merki/kr1?per=2026.law');
    await expect(page.locator('h1')).not.toBeEmpty();
  });
  test('print hides interactive controls and preserves the chart', async ({ page, visit }) => {
    await visit('/prihodi');
    await page.emulateMedia({ media: 'print' });
    await expect(
      page.locator(
        '.block-tools:visible, .seg:visible, .unit-switch:visible, .explorer:visible, .foot-nav:visible',
      ),
    ).toHaveCount(0);
    const chart = page.locator('.chart').first();
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute('data-ready', '1');
  });
  for (const path of ['/5-minuti?per=2026.law', '/5-minuti']) {
    test(`unique landmarks on ${path}`, async ({ page, visit }) => {
      await visit(path);
      if (path.includes('?'))
        await expect(page.locator('.s04-deep h3').first()).toHaveText('Влез по-дълбоко');
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const violations = await page.evaluate(
        async (options: RunOptions): Promise<AxeResults['violations']> => {
          const { axe } = window as unknown as {
            axe: { run: (document: Document, options: RunOptions) => Promise<AxeResults> };
          };
          return (await axe.run(document, options)).violations;
        },
        { runOnly: ['landmark-unique'] },
      );
      expect(violations).toEqual([]);
    });
  }
});
test.describe('Budget 2027 on phones', () => {
  test.use({ viewport: { width: 412, height: 900 } });
  test('overview fits 412px', async ({ page, visit }) => {
    await visit('/byudzhet-2027');
    await expectNoPageOverflow(page);
  });
});

async function expectNoPageOverflow(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.locator('html').evaluate((root) => {
          if (root.scrollWidth <= innerWidth) return [];
          const offenders = [...document.querySelectorAll('article *')]
            .filter(
              (element) =>
                element.getClientRects().length &&
                element.getBoundingClientRect().right > innerWidth,
            )
            .map((element) => ({
              id: element.id,
              tag: element.tagName,
              className: element.getAttribute('class'),
              right: element.getBoundingClientRect().right,
              viewportWidth: innerWidth,
            }));
          return [
            {
              id: root.id,
              tag: root.tagName,
              className: root.getAttribute('class'),
              right: root.scrollWidth,
              viewportWidth: innerWidth,
            },
            ...offenders,
          ];
        }),
      { message: 'page content must fit the viewport' },
    )
    .toEqual([]);
}
