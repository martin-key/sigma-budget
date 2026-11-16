import { test as base, expect } from '../fixtures.ts';
import { initializeScreen, screenReady, revealScreen, type Finding } from './browser.ts';
import type { Page } from '@playwright/test';
export { expect };
export const test = base.extend<{
  display: 'desktop' | 'touch';
  browserEvents: { readAndClear(): Promise<Finding[]> };
}>({
  display: ['desktop', { option: true }],
  viewport: async ({ display }, use) =>
    use(display === 'desktop' ? { width: 1280, height: 900 } : { width: 400, height: 800 }),
  hasTouch: async ({ display }, use) => use(display === 'touch'),
  locale: 'bg-BG',
  timezoneId: 'Europe/Sofia',
  reducedMotion: 'reduce',
  colorScheme: 'light',
  serviceWorkers: 'block',
  actionTimeout: 15000,
  navigationTimeout: 20000,
  browserEvents: [
    async ({ page, context, siteURL }, use) => {
      const events: Finding[] = [];
      const record = (code: string, message: string) => events.push({ code, message });
      const origin = new URL(siteURL).origin;
      await context.exposeBinding('recordScreenEvent', (_source, event: Finding) => {
        events.push(event);
      });
      await context.addInitScript(initializeScreen);
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          !/Service Worker|serviceWorker|^Failed to load resource|preloaded using link preload but not used/i.test(
            message.text(),
          )
        )
          record('console-error', message.text());
      });
      page.on('pageerror', (error) => record('pageerror', String(error)));
      page.on('crash', () => record('crash', 'Page crashed'));
      page.on('dialog', async (dialog) => {
        record('dialog', dialog.message());
        await dialog.dismiss();
      });
      page.on('response', (response) => {
        if (response.status() >= 400) record('http', `${response.status()} ${response.url()}`);
      });
      page.on('requestfailed', (request) => {
        const message = request.failure()?.errorText || '';
        if (!message.includes('ERR_ABORTED'))
          record('request-failed', request.url() + ': ' + message);
      });
      page.on('request', (request) => {
        if (/^(https?|wss?|ftp):/.test(request.url()) && new URL(request.url()).origin !== origin)
          record('external', request.url());
      });
      const readAndClear = async () => {
        const cookies = await context.cookies();
        if (cookies.length) {
          record('cookie', cookies.map((cookie) => cookie.name).join(', '));
          await context.clearCookies();
        }
        return events.splice(0);
      };
      try {
        await use({ readAndClear });
      } finally {
        expect(await readAndClear(), 'Browser errors and cookies').toEqual([]);
      }
    },
    { auto: true },
  ],
});
export async function openScreen(page: Page, siteURL: string, address: string) {
  await page.goto(new URL('/' + address, siteURL).href);
  await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
  await page.waitForFunction(screenReady, undefined, { timeout: 15000, polling: 100 });
}
export async function deepPass(page: Page) {
  await page.evaluate(revealScreen);
  for (const list of await page.locator('#view [role="tablist"]').all()) {
    const tabs = list.locator('[role="tab"]');
    const selectedIndex = await tabs.evaluateAll((elements) =>
      elements.findIndex((element) => element.getAttribute('aria-selected') === 'true'),
    );
    const selected = selectedIndex >= 0 ? tabs.nth(selectedIndex) : undefined;
    for (const tab of await tabs.all()) {
      await tab.click();
      await page.evaluate(revealScreen);
      await page.waitForFunction(screenReady, undefined, { timeout: 15000, polling: 100 });
    }
    if (selected) await selected.click();
  }
  await page.evaluate(revealScreen);
  await page.waitForFunction(screenReady, undefined, { timeout: 15000, polling: 100 });
}
