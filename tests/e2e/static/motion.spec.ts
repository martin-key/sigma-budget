import { test, expect, enableHashRoutes } from '../fixtures.ts';
import { observeLayoutShifts, runningAnimations } from '../motion-probes.ts';
import { expectedPlan } from '../expected.ts';
import type { Browser } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
const plan = expectedPlan();
async function motionContext(browser: Browser, width: number, reducedMotion: boolean) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    hasTouch: width < 700,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    viewport: { width, height: width >= 700 ? 900 : 844 },
  });
  await enableHashRoutes(context);
  return context;
}
for (const reducedMotion of [true, false]) {
  test(
    reducedMotion
      ? 'reduced motion shows final values without animation'
      : 'motion settles on final values',
    async ({ browser, siteURL }) => {
      const context = await motionContext(browser, 1280, reducedMotion);
      try {
        const page = await context.newPage();
        await page.goto(siteURL + '/index.html#/');
        await expect(page.locator('#s15-b-plan .prog-text').first()).toBeVisible();
        const percentages = page.locator('#s15-b-plan .prog-text');
        await expect(percentages).toHaveText(plan.bars, { timeout: 3000 });
        const expectedWidths = plan.widths.map((width) => Number(width.replace('%', '')));
        const fills = page.locator('#s15-b-plan .prog-fill');
        // the bars grow for a moment after the text is final: wait for them to settle
        await expect
          .poll(
            () =>
              fills.evaluateAll(
                (elements, expected) =>
                  Math.max(
                    ...elements.map((element, index) =>
                      Math.abs(
                        (element.getBoundingClientRect().width /
                          element.parentElement!.getBoundingClientRect().width) *
                          100 -
                          expected[index]!,
                      ),
                    ),
                  ),
                expectedWidths,
              ),
            { message: 'visible bar width', timeout: 3000 },
          )
          .toBeLessThanOrEqual(0.1);
        if (reducedMotion) expect(await page.evaluate(runningAnimations)).toBe(0);
      } finally {
        await context.close();
      }
    },
  );
}
for (const width of [1280, 390, 320])
  for (const route of ['#/', '#/izpalnenie', '#/razhodi', '#/prihodi', '#/vedomstva', '#/5-minuti'])
    test(`motion layout shift ${width} ${route}`, async ({ browser, siteURL }) => {
      const shifts: number[] = [];
      for (const reducedMotion of [true, false]) {
        const context = await motionContext(browser, width, reducedMotion);
        try {
          const page = await context.newPage();
          await page.addInitScript(observeLayoutShifts);
          await page.goto(siteURL + '/index.html' + route);
          await expect(page.locator('h1')).toBeVisible();
          // Layout shifts are collected for three seconds: longer than the entrance and count-up.
          await page.waitForTimeout(3000);
          shifts.push(await page.evaluate(() => window.__cls));
        } finally {
          await context.close();
        }
      }
      expect(shifts[1]!, `CLS motion ${shifts[1]} vs reduced ${shifts[0]}`).toBeLessThanOrEqual(
        shifts[0]! + 0.01,
      );
    });
