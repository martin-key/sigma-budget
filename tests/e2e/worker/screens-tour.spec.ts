import { test, expect, openScreen } from '../screens/fixtures.ts';
import { routes, displays } from '../screens/cases.ts';
import { NAV_GROUPS } from '../../../apps/web/client/chrome.js';

for (const display of displays)
  test.describe(display, () => {
    test.use({ display });
    test('client navigation and browser history', async ({ page, siteURL }) => {
      await openScreen(page, siteURL, '#/nyama-takava');
      let previous = await page.title();
      const visited: { url: string; title: string; heading: string }[] = [];
      // The menu covers all public sections. Detail screens are reached through their parent links.
      for (const route of routes.filter((r) => r.nav)) {
        await page.evaluate(() => scrollTo(0, 400));
        if (display === 'touch')
          await page.getByRole('button', { name: 'Меню', exact: true }).click();
        else {
          const group = NAV_GROUPS.find(([, ids]) => ids.includes(route.id))!;
          await page
            .getByRole('navigation', { name: 'Основна навигация', exact: true })
            .getByRole('button', { name: group[0], exact: true })
            .click();
        }
        const dialog = page.getByRole('dialog').filter({ visible: true });
        const menu =
          display === 'touch'
            ? dialog.getByRole('navigation', { name: 'Всички раздели', exact: true })
            : dialog;
        await menu.getByRole('link', { name: route.short || route.title, exact: true }).click();
        const headings: Record<string, string> = {
          S03: 'Речник: бюджетът на разбираем език',
          S12: 'Мерки в проекта за бюджет 2027',
        };
        await verify(route.id, headings[route.id] || route.title);
        const children: Record<string, string> = { S07: 'S08', S10: 'S11', S20: 'S21' };
        const child = children[route.id];
        if (child) {
          const detail = routes.find((r) => r.id === child)!;
          const path = detail.samples[0]!.split('?')[0]!;
          if (route.id === 'S07')
            await page.getByRole('radio', { name: 'Списък', exact: true }).check();
          const link = page.locator(`#view a[href^="${path}"]`).filter({ visible: true }).first();
          const name = (await link.textContent())!.trim();
          await page.getByRole('link', { name, exact: true }).first().click();
          await verify(detail.id);
        }
      }
      // The palette preselects the first suggestion; its footer opens the complete result list.
      await page.keyboard.press('/');
      const search = page.getByRole('combobox', { name: 'Търси в сайта', exact: true });
      await search.fill('ДДС');
      const palette = page.getByRole('dialog', { name: 'Търсене в сайта', exact: true });
      await expect(
        palette
          .getByRole('listbox', { name: 'Резултати', exact: true })
          .getByRole('option')
          .first(),
      ).toBeVisible();
      await palette.getByRole('link', { name: 'Всички резултати', exact: true }).click();
      await verify('S28');
      async function verify(id: string, name?: string) {
        await expect(page.locator('article.page[data-ready="1"]')).toHaveAttribute(
          'data-route',
          id,
        );
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toHaveCount(1);
        if (name) await expect(heading).toHaveText(name);
        await expect(heading).toBeFocused();
        const text = (await heading.textContent())!.trim().replace(/\s+/g, ' ');
        // The home page leads with the site name; every other screen ends with it.
        await expect(page).toHaveTitle(
          id === 'S01' ? `СИГМА Бюджет · ${text}` : `${text} · СИГМА Бюджет`,
        );
        expect(await page.title()).not.toBe(previous);
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
        const period = page.getByRole('button', { name: /^Година и статус на данните:/ });
        if (routes.find((r) => r.id === id)!.periods === 'none') await expect(period).toBeHidden();
        else await expect(period).toBeVisible();
        previous = await page.title();
        visited.push({ url: page.url(), title: previous, heading: text });
      }
      let index = visited.length - 1;
      for (const direction of ['back', 'back', 'back', 'forward', 'forward']) {
        if (direction === 'back') {
          await page.goBack();
          index--;
        } else {
          await page.goForward();
          index++;
        }
        const wanted = visited[index]!;
        await expect(page).toHaveURL(wanted.url);
        await expect(page).toHaveTitle(wanted.title);
        await expect(
          page.getByRole('heading', { level: 1, name: wanted.heading, exact: true }),
        ).toBeFocused();
      }
    });
  });
