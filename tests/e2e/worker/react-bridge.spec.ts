import { test, expect } from '../fixtures.ts';
test('redirect, anchors, history and search', async ({ page, siteURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !(
        message.location().url === siteURL + '/nyama-takava-stranitsa' &&
        message.text().includes('status of 404')
      )
    )
      errors.push(message.text());
  });
  await test.step('Постоянен redirect', async () => {
    const response = await page.goto(siteURL + '/za-proekta?to=s26-legend');
    expect((await response!.request().redirectedFrom()!.response())!.status()).toBe(301);
    await expect(page).toHaveURL(siteURL + '/danni');
    await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
  });
  await test.step('Съдържание и история', async () => {
    await page.goto(siteURL + '/api');
    await expect(page.locator('article.page')).toHaveAttribute('data-ready', '1');
    const anchors = page.locator('nav.s25-toc a[href]');
    await expect(anchors).toHaveCount(4);
    for (const address of await anchors.evaluateAll((links) =>
      links.map((a) => a.getAttribute('href')!),
    )) {
      const target = page.locator('#' + new URL(address, siteURL).searchParams.get('to'));
      await page.locator(`nav.s25-toc a[href="${address}"]`).click();
      await expect(target).toBeFocused();
      await expect(target).toBeInViewport();
    }
    await page.locator('a[href="/prihodi"]').first().click();
    await expect(page.locator('article.page')).toHaveAttribute('data-route', 'S06');
    await page.goBack();
    await expect(page.locator('article.page')).toHaveAttribute('data-route', 'S25');
  });
  await test.step('Търсене от несъществуващ адрес', async () => {
    expect((await page.goto(siteURL + '/nyama-takava-stranitsa'))!.status()).toBe(404);
    await page.locator('#s30-q').fill('  ДДС   бюджет  ');
    await page.locator('.s30-go').click();
    await expect(page.locator('article.page')).toHaveAttribute('data-route', 'S28');
    await expect(page).toHaveURL((url) => url.searchParams.get('q')?.startsWith('ДДС ') === true);
  });
  expect(errors).toEqual([]);
});
