import { test, expect, enableHashRoutes } from '../fixtures.ts';
import { measureLayout } from '../overlap-probes.ts';
import type { BrowserContext } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
test('overlap quick: all routes, sticky positions, print and extra samples', async ({
  browser,
  page,
  siteURL,
}) => {
  test.setTimeout(600_000);
  const base = siteURL + '/index.html';
  await enableHashRoutes(page);
  await page.goto(base);
  await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
  const routes: { id: string; bare?: boolean; samples: string[] }[] = (
    await page.evaluate(() => window.__ROUTES__)
  ).filter((route: { bare?: boolean }) => !route.bare);
  expect(routes.length).toBeGreaterThanOrEqual(26);
  await page.close();
  for (const route of routes)
    if (!route.samples.length) route.samples = ['#/nyama-takava-stranitsa'];
  const createContext = async (width: number) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      hasTouch: width < 700,
      viewport: { width: width, height: width >= 700 ? 900 : 844 },
    });
    await enableHashRoutes(context);
    return context;
  };
  const load = async (context: BrowserContext, h: string, errors: string[]) => {
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 140));
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 140)));
    page.on('requestfailed', (route) => errors.push('request: ' + route.url().slice(-60)));
    await page.goto(base + h);
    await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1', {
      timeout: 9000,
    });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return page;
  };
  for (const width of [1440, 1241, 390]) {
    const context = await createContext(width);
    try {
      for (const route of routes)
        await test.step(`${width} ${route.id}`, async () => {
          const errors: string[] = [],
            page = await load(context, route.samples[0]!, errors);
          try {
            expect
              .soft(
                await page.evaluate(measureLayout),
                `${route.id} at ${width}px: initial layout findings`,
              )
              .toEqual([]);
            expect.soft(errors, `${width} ${route.id}: errors`).toEqual([]);
            for (const frac of width === 390 ? [0.33, 0.66, 1] : [1]) {
              await page.evaluate(
                (f) => window.scrollTo(0, (document.body.scrollHeight - innerHeight) * f),
                frac,
              );
              const findings: { k: string; m: string }[] = await page.evaluate(measureLayout);
              expect
                .soft(
                  findings.filter((f) => ['overlap', 'outside'].includes(f.k)),
                  `${width} ${route.id}: scroll ${frac}`,
                )
                .toEqual([]);
            }
            const under = await page.evaluate(() => {
              const t = document.getElementById('tabbar');
              if (!t || getComputedStyle(t).display === 'none') return null;
              const top = t.getBoundingClientRect().top;
              const bad = [
                ...document.querySelectorAll('#footer a,#footer button,#footer summary'),
              ].filter((e) => {
                const d = e.closest('details');
                if (d && !d.open && !e.matches('summary')) return false;
                return (
                  e.getBoundingClientRect().bottom > top + 1 && e.getBoundingClientRect().height > 2
                );
              });
              return bad.length ? bad[0]!.textContent!.trim().slice(0, 24) : null;
            });
            expect.soft(under, `${width} ${route.id}: under tabbar`).toBeNull();
            if (width === 390) {
              await page.emulateMedia({ media: 'print' });
              await expect(page.locator('h1')).toBeVisible();
              const printLayout = await page.evaluate(() => [
                document.documentElement.scrollWidth - document.documentElement.clientWidth,
                !!document.querySelector('h1') &&
                  document.querySelector('h1')!.getBoundingClientRect().height > 0,
              ]);
              expect.soft(printLayout[0], route.id + ': print overflow').toBeLessThanOrEqual(1);
              expect.soft(printLayout[1], route.id + ': print heading').toBe(true);
            }
          } finally {
            await page.close();
          }
        });
    } finally {
      await context.close();
    }
  }
  const context = await createContext(1280);
  try {
    for (const route of routes)
      for (const h of route.samples.slice(1))
        await test.step(route.id + ' ' + h, async () => {
          const errors: string[] = [],
            page = await load(context, h, errors);
          try {
            expect.soft(errors, h + ': errors').toEqual([]);
            const findings: { k: string; m: string }[] = await page.evaluate(measureLayout);
            expect
              .soft(
                findings.filter((f) => ['overlap', 'hscroll'].includes(f.k)),
                h,
              )
              .toEqual([]);
          } finally {
            await page.close();
          }
        });
  } finally {
    await context.close();
  }
});
