import { test, expect, openScreen } from '../screens/fixtures.ts';
import { fitsViewport } from '../screens/interactions.ts';
import { NAV_GROUPS, groupItems, navName } from '../../../apps/web/client/chrome.js';

test('skip to content', async ({ page, siteURL }) => {
  await openScreen(page, siteURL, '#/prihodi');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Към съдържанието', exact: true });
  await expect(skip).toBeFocused();
  await fitsViewport(skip);
  await skip.press('Enter');
  await expect
    .poll(() =>
      page
        .getByRole('main')
        .evaluate(
          (main) => main === document.activeElement || main.contains(document.activeElement),
        ),
    )
    .toBe(true);
});
test('search shortcuts, results and returning to the page', async ({ page, siteURL }) => {
  await openScreen(page, siteURL, '#/prihodi');
  const opener = page.getByRole('button', { name: 'Търсене', exact: true });
  for (const key of ['/', 'Control+k', 'button']) {
    await opener.focus();
    if (key === 'button') await opener.click();
    else await page.keyboard.press(key);
    const input = page.getByRole('combobox', { name: 'Търси в сайта', exact: true });
    await expect(input).toBeFocused();
    await input.fill('ДДС');
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    await input.press('ArrowDown');
    const selected = page.getByRole('option', { selected: true });
    const first = await selected.textContent();
    await input.press('ArrowDown');
    await expect(selected).not.toHaveText(first!);
    await input.press('Escape');
    await expect(input).toBeHidden();
    await expect(opener).toBeFocused();
  }
  await opener.click();
  const input = page.getByRole('combobox', { name: 'Търси в сайта', exact: true });
  await input.fill('ДДС');
  await expect(page.getByRole('option').first()).toBeVisible();
  await input.press('ArrowDown');
  const href = await page.getByRole('option', { selected: true }).getAttribute('href');
  await input.press('Enter');
  await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
});
test('header groups and Escape', async ({ page, siteURL }) => {
  await openScreen(page, siteURL, '#/tarsene');
  for (const [name, ids] of NAV_GROUPS) {
    const opener = page
      .getByRole('navigation', { name: 'Основна навигация', exact: true })
      .getByRole('button', { name, exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog').filter({ visible: true });
    for (const route of groupItems(ids)) {
      await expect(dialog.getByRole('link', { name: navName(route), exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
});
test.describe('phone', () => {
  test.use({ display: 'touch' });
  test('menu groups, navigation and period', async ({ page, siteURL }) => {
    await openScreen(page, siteURL, '#/tarsene');
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ visible: true });
    await expect
      .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    const navigation = dialog.getByRole('navigation', { name: 'Всички раздели', exact: true });
    for (const [name, ids] of NAV_GROUPS) {
      await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
      for (const route of groupItems(ids)) {
        await expect(
          navigation.getByRole('link', { name: navName(route), exact: true }),
        ).toBeVisible();
      }
    }
    await navigation.getByRole('link', { name: 'Приходи', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await page.getByRole('button', { name: /^Година и статус на данните:/ }).click();
    // Selecting a period navigates and removes this input; the address and label confirm the choice.
    await page.getByRole('radio', { name: /2026.*Закон/i }).click();
    await expect(page).toHaveURL(/[?&]per=2026.law/);
    await expect(page.getByRole('button', { name: /^Година и статус на данните:/ })).toContainText(
      '2026',
    );
  });
});
test('320px header fits with 44px controls', async ({ page, siteURL }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openScreen(page, siteURL, '#/prihodi');
  const header = page.locator('.mast-in');
  await fitsViewport(header);
  const buttons = header.getByRole('button');
  await expect(buttons.first()).toBeVisible();
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue;
    const rect = await button.boundingBox();
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
});
test('status legend returns focus', async ({ page, siteURL }) => {
  await openScreen(page, siteURL, '#/danni');
  const opener = page
    .getByRole('button', { name: /Какво означават статусите|Покажи легендата/ })
    .first();
  await opener.click();
  const dialog = page.getByRole('dialog').filter({ visible: true });
  await expect(
    dialog.getByRole('heading', { name: 'Легенда: какво означават белезите', exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText('Официални данни');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
