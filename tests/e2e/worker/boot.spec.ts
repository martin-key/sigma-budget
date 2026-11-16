import { setTimeout as delay } from 'node:timers/promises';
import { test, expect, gate, contextOptions } from '../fixtures.ts';
import { within } from '../helpers.ts';
test.use({ serviceWorkers: 'block' });

for (const route of ['/', '/razhodi', '/api'])
  for (const phase of ['domcontentloaded', 'commit'] as const) {
    test(`first mobile tap ${route} at ${phase}`, async ({ browser, siteURL }) => {
      const context = await browser.newContext({
        ...contextOptions,
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      const release = gate(),
        requested = gate();
      try {
        const page = await context.newPage();
        await page.route('**/react-bridge.js', async (request) => {
          requested.release();
          await release.promise;
          await request.continue();
        });
        await page.route('**/js/main.js', async (request) => {
          await delay(1000);
          await request.continue();
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(siteURL + route, { waitUntil: phase });
        await page.locator('#btn-menu').tap();
        try {
          await page.waitForSelector('dialog.sheet-drawer[open]', { timeout: 3000 });
          await within(requested.promise, 5000, 'React bridge requested before release');
          expect(release.released, 'React still held during first tap').toBe(false);
        } finally {
          release.release();
        }
        await page.waitForSelector('article[data-ready="1"]', { timeout: 30000 });
        expect(await page.locator('dialog.sheet-drawer').isVisible(), route).toBe(true);
        expect(await page.locator('#btn-menu').getAttribute('aria-expanded'), route).toBe('true');
        expect(errors, route).toEqual([]);
      } finally {
        release.release();
        await context.close();
      }
    });
  }
for (const [route, screen] of [
  ['/nyama-takava', 'S30'],
  ['/api', 'S25'],
  ['/proverka', 'S35'],
  ['/zakon', 'S14'],
  ['/novo', 'S16'],
]) {
  test(`isolated screen ${screen}`, async ({ browser, siteURL }) => {
    const context = await browser.newContext(contextOptions);
    try {
      const page = await context.newPage(),
        loaded = new Set<string>(),
        errors: string[] = [];
      page.on('request', (request) => {
        for (const match of request.url().matchAll(/\/screen-(S\d+)-/g)) loaded.add(match[1]!);
      });
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('React error'))
          errors.push(message.text());
      });
      await page.goto(siteURL + route, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#view[data-react-owned] article[data-ready="1"]', {
        timeout: 30000,
      });
      expect([...loaded], route).toEqual([screen]);
      expect(errors, route).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
for (const choice of ['period', 'default-period', 'same-default-period', 'unit', 'share']) {
  test(`early ${choice} with core held`, async ({ browser, siteURL }) => {
    const context = await browser.newContext({
      ...contextOptions,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      if (['default-period', 'same-default-period'].includes(choice))
        await page.addInitScript(
          "localStorage.setItem('bns.prefs.v1', JSON.stringify({period:'2026.draft', unit:'eur'}))",
        );
      const release = gate();
      await page.route('**/data/core.json', async (request) => {
        await release.promise;
        await request.continue();
      });
      const at = new Date('2026-01-01T00:00:00Z');
      await page.clock.install({ time: at });
      await page.clock.pauseAt(new Date(at.getTime() + 1000));
      try {
        await page.goto(siteURL + '/razhodi', { waitUntil: 'domcontentloaded' });
        expect(
          await page.evaluate("import('/js/router.js').then(m => m.router.current === null)"),
          'interaction precedes startup',
        ).toBe(true);
        if (choice === 'period') {
          await page.locator('#btn-period').click({ force: true });
          await page
            .getByRole('dialog')
            .locator('input[value="2024.report"]')
            .click({ force: true });
          expect(page.url()).toContain('per=2024.report');
        } else if (['default-period', 'same-default-period'].includes(choice)) {
          for (const value of choice === 'default-period'
            ? ['2024.report', '2027.draft']
            : ['2027.draft']) {
            await page.locator('#btn-period').click({ force: true });
            await page
              .getByRole('dialog')
              .locator(`input[value="${value}"]`)
              .click({ force: true });
            if (value === '2027.draft' && choice === 'same-default-period')
              await page.keyboard.press('Escape');
          }
          expect(
            await page.evaluate("import('/js/store.js').then(m => m.store.get('period'))"),
          ).toBe('2027.draft');
          expect(page.url()).not.toContain('per=');
        } else if (choice === 'unit') {
          await page.locator('.unit-switch input[value="pct"]').click({ force: true });
          expect(page.url()).toContain('unit=pct');
        } else {
          await page.locator('[data-share]').first().click({ force: true });
          expect(await page.getByText('Този блок не може да се споделя.').count()).toBe(0);
        }
        expect(
          await page.evaluate("import('/js/router.js').then(m => m.router.current === null)"),
          'startup still held',
        ).toBe(true);
      } finally {
        release.release();
        await page.clock.resume();
      }
      await page.waitForSelector('article[data-route="S07"][data-ready="1"]');
      if (choice === 'period') {
        expect(await page.evaluate("import('/js/store.js').then(m => m.store.get('period'))")).toBe(
          '2024.report',
        );
        expect(page.url()).toContain('per=2024.report');
      } else if (['default-period', 'same-default-period'].includes(choice)) {
        await expect(page.locator('.context')).toContainText('2027');
        expect(page.url()).not.toContain('per=');
      } else if (choice === 'unit') {
        expect(await page.evaluate("import('/js/store.js').then(m => m.store.get('unit'))")).toBe(
          'pct',
        );
        expect(await page.locator('.unit-switch input[value="pct"]').isChecked()).toBe(true);
        expect(page.url()).toContain('unit=pct');
      } else await page.waitForSelector('dialog[open] .share-menu');
    } finally {
      await context.close();
    }
  });
}
for (const control of ['period', 'search'])
  test(`${control} before React`, async ({ browser, siteURL }) => {
    const context = await browser.newContext(contextOptions);
    const release = gate();
    try {
      const page = await context.newPage();
      await page.route('**/react-bridge.js', async (request) => {
        await release.promise;
        await request.continue();
      });
      await page.goto(siteURL + (control === 'period' ? '/zakon' : '/razhodi'), {
        waitUntil: 'domcontentloaded',
      });
      if (control === 'period') {
        await page.locator('#btn-period').click();
        expect(
          await page
            .getByRole('dialog')
            .locator('input[type=radio]:not(:disabled)')
            .evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).value)),
        ).toEqual(['2026.law']);
        expect(await page.evaluate("import('/js/store.js').then(m => m.store.get('period'))")).toBe(
          '2026.law',
        );
      } else {
        await page.locator('#btn-search').click();
        await page.waitForSelector('dialog.palette[open] input');
        await page.waitForSelector('dialog.palette a[href]');
      }
    } finally {
      release.release();
      await context.close();
    }
  });
for (const pattern of ['**/screen-S25-*.js', '**/text-*.js'])
  test(`cancelled navigation SEO ${pattern}`, async ({ browser, siteURL }) => {
    const context = await browser.newContext(contextOptions);
    const release = gate(),
      requested = gate(),
      completed = gate();
    try {
      const page = await context.newPage();
      await page.route(pattern, async (request) => {
        requested.release();
        await release.promise;
        await request.continue();
        completed.release();
      });
      const snapshot =
        "Array.from(document.head.querySelectorAll('title, meta[name=description], meta[property], link[rel=canonical], #ld-page'), n => n.outerHTML)";
      let before: unknown;
      try {
        await page.goto(siteURL + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('article[data-ready="1"]');
        await page.evaluate("import('/js/router.js').then(m => m.router.go('/api'))");
        await within(requested.promise, 10000, 'cancelled route module requested');
        await page.evaluate("import('/js/router.js').then(m => m.router.go('/razhodi'))");
        await page.waitForSelector('article[data-route="S07"][data-ready="1"]');
        before = await page.evaluate(snapshot);
      } finally {
        release.release();
      }
      await within(completed.promise, 10000, 'cancelled module released');
      await page.waitForTimeout(500);
      expect(await page.evaluate(snapshot), pattern).toEqual(before);
      expect(await page.locator('article.page').getAttribute('data-route')).toBe('S07');
    } finally {
      release.release();
      await context.close();
    }
  });
