import { expect } from './fixtures.ts';
import type { Locator, Page } from '@playwright/test';

export async function fitsViewport(box: Locator) {
  await expect(box).toBeVisible();
  await expect
    .poll(() =>
      box.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
        );
      }),
    )
    .toBe(true);
}

export async function drawn(root: Locator) {
  await expect(root).toBeVisible();
  await expect
    .poll(() =>
      root.evaluate((el) =>
        [...el.querySelectorAll<HTMLElement>('.chart')]
          .filter((chart) => chart.getClientRects().length)
          .every((chart) => {
            const svg = chart.querySelector('svg');
            const r = chart.getBoundingClientRect();
            return (
              !!svg &&
              svg.querySelectorAll('path,rect,circle').length > 0 &&
              r.width > 100 &&
              r.height > 50 &&
              Math.abs(svg.getBoundingClientRect().width - r.width) <= 2
            );
          }),
      ),
    )
    .toBe(true);
}

export async function targetVisible(page: Page, id: string) {
  const target = page.locator(`[id=${JSON.stringify(id)}]`);
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await expect
    .poll(() =>
      target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const bar = document.querySelector('#topbar')?.getBoundingClientRect();
        return r.top >= (bar?.bottom ?? 0) - 2 && r.top < innerHeight;
      }),
    )
    .toBe(true);
  const panel = target.locator('xpath=ancestor-or-self::*[@role="tabpanel"]');
  if (await panel.count()) {
    const name = await panel.getAttribute('aria-labelledby');
    const tab = page.locator(`[id=${JSON.stringify(name)}]`);
    await expect(
      page.getByRole('tab', {
        name: (await tab.textContent())!.trim(),
        exact: true,
        selected: true,
      }),
    ).toBeVisible();
  }
}
