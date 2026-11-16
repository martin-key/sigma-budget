import type { Page } from '@playwright/test';
import { test, expect } from '../visitor-fixtures.ts';
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
for (const width of [1280, 390]) {
  test(`shared EUR/GDP views at ${width}px`, async ({ freshContext, siteURL }) => {
    async function fresh(saved = 'eur', javaScriptEnabled = true) {
      const context = await freshContext({
        viewport: { width, height: 900 },
        javaScriptEnabled,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      });
      if (javaScriptEnabled)
        await context.addInitScript((unit) => {
          if (location.protocol.startsWith('http'))
            localStorage.setItem('bns.prefs.v1', JSON.stringify({ unit }));
        }, saved);
      const page = await context.newPage();
      return page;
    }
    async function go(page: Page, path: string) {
      await page.goto(path.startsWith('http') ? path : siteURL + path);
      await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
    }
    async function chartUnit(page: Page, expected: string) {
      const unit = expect.poll(() =>
        page.evaluate(
          async (path) => (await import(path)).chartSpec('s13-rev-exp')?.sub ?? null,
          '/js/ui/chart.js',
        ),
      );
      if (expected === 'pct') await unit.toBe('% от БВП');
      else await unit.toMatch(/€/);
    }
    async function links(page: Page): Promise<Record<'full' | 'short' | 'embed', string>> {
      return page.evaluate(async (path) => {
        const share = await import(path),
          spec = share.get('s13-b-rev-exp');
        return {
          full: share.linkFor(spec),
          short: share.shortLink(spec),
          embed: share.embedHash(spec),
        };
      }, '/js/share.js');
    }
    await test.step('Споделени проценти, SSR и embed', async () => {
      const page = await fresh('eur');
      await go(page, '/prognoza?per=2029.forecast&unit=pct');
      await expect(page.locator('input[name="s13-unit"][value="pct"]')).toBeChecked();
      await chartUnit(page, 'pct');
      const ssr = await fresh('eur', false);
      await ssr.goto(page.url());
      await expect(ssr.locator('input[name="s13-unit"][value="pct"]')).toBeChecked();
      const shared = await links(page);
      for (const url of Object.values(shared))
        expect(new URL(url, siteURL).searchParams.getAll('unit')).toEqual(['pct']);
      const twin = await fresh('eur');
      await go(twin, shared.full);
      await expect(twin.locator('input[name="s13-unit"][value="pct"]')).toBeChecked();
      await chartUnit(twin, 'pct');
      const embed = await fresh('eur');
      await go(embed, shared.embed);
      await chartUnit(embed, 'pct');
      expect(
        new URL(
          (await embed.locator('.s29-brand').getAttribute('href'))!,
          siteURL,
        ).searchParams.getAll('unit'),
      ).toEqual(['pct']);
      await page.locator('input[name="s13-unit"][value="eur"]').check();
      await expect(page).toHaveURL(/[?&]unit=eur(?:&|$)/);
      await chartUnit(page, 'eur');
      const euros = await links(page),
        opposite = await fresh('pct');
      await go(opposite, euros.full);
      await expect(opposite.locator('input[name="s13-unit"][value="eur"]')).toBeChecked();
      await chartUnit(opposite, 'eur');
      const law = await fresh('eur');
      await go(law, '/zakon?unit=pct');
      await expect(law.locator('#s14-unit-pct')).toBeChecked();
      const noJsLaw = await fresh('eur', false);
      await noJsLaw.goto(law.url());
      await expect(noJsLaw.locator('#s14-unit-pct')).toBeChecked();
      await law.locator('#s14-unit-eur').check();
      await expect(law).toHaveURL(/[?&]unit=eur(?:&|$)/);
      await expect(law.locator('#s14-unit-eur')).toBeChecked();
      await go(page, '/pari?unit=pct');
      await page.locator('article a[href^="/prihodi"]').first().click();
      await expect(page).toHaveURL(
        (url) =>
          url.pathname.startsWith('/prihodi') && url.searchParams.getAll('unit').join() === 'pct',
      );
      await expect(page.locator('article.page:not([data-route="S05"])')).toHaveAttribute(
        'data-ready',
        '1',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    });
  });
}
