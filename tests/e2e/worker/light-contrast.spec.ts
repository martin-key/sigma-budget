import { ROUTES } from '../../../apps/web/app/lib/routes.ts';
import { test, expect } from '../audit-fixtures.ts';
import { expandContent, measureContrast } from '../contrast.ts';

const routes = ROUTES.filter((route) => !route.bare).map((route) => ({
  id: route.id,
  path: (route.samples[0] ?? '/nyama-takava').replace(/^#/, ''),
}));
const viewports = [
  { width: 1280, height: 900 },
  { width: 400, height: 800 },
];

test.describe('light contrast route coverage', () => {
  test.use({ serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' });
  for (const viewport of viewports) {
    test.describe(`${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport });
      for (const route of routes) {
        test(`${route.id} ${route.path}: chart text, placeholders and field boundaries`, async ({
          page,
          visit,
        }, testInfo) => {
          await visit(route.path);
          await expandContent(page);
          const result = await measureContrast(page);
          await testInfo.attach('contrast', {
            body: JSON.stringify(result, null, 2),
            contentType: 'application/json',
          });
          expect(result.textViolations, 'chart labels: 4.5 small text, 3 large text').toEqual([]);
          expect(result.placeholderViolations, 'placeholders: 4.5').toEqual([]);
          expect(result.boundaryViolations, 'field boundaries: 3').toEqual([]);
        });
      }
    });
  }
});
