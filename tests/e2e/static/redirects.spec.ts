import { test, expect, enableHashRoutes } from '../fixtures.ts';
test.use({ serviceWorkers: 'block' });
const CASES: [string, string, string, Record<string, string>, string[]][] = [
  ['#/deystvie?tab=otkrij', 'S01', '/', {}, ['tab']],
  ['#/deystvie?tab=sravni', 'S01', '/', {}, ['tab']],
  ['#/moyat-byudzhet', 'S07', '/razhodi', {}, []],
  ['#/moyat-byudzhet?per=2026.law', 'S07', '/razhodi', {}, []],
  ['#/razhodi/obrazovanie/deynosti', 'S08', '/razhodi/obrazovanie', {}, []],
  ['#/klasacii', 'S07', '/razhodi', {}, []],
  ['#/klasacii?tab=godini', 'S07', '/razhodi', {}, ['tab']],
  [
    '#/proekti',
    'S10',
    '/vedomstva',
    {
      tab: 'programi',
    },
    [],
  ],
  [
    '#/proekti/pr-01',
    'S10',
    '/vedomstva',
    {
      tab: 'programi',
    },
    [],
  ],
  ['#/plashtania', 'S15', '/izpalnenie', {}, []],
  ['#/plashtania/999000012', 'S15', '/izpalnenie', {}, []],
  [
    '#/izpalnenie/pera',
    'S15',
    '/izpalnenie',
    {
      pera: 'rev,exp',
    },
    [],
  ],
  [
    '#/izpalnenie/sravnenie?g1=2024&g2=2026&mesec=3&obhvat=nat',
    'S15',
    '/izpalnenie',
    {
      g1: '2024',
      g2: '2026',
      mesec: '3',
      obhvat: 'nat',
      rez: 'mesec',
    },
    [],
  ],
  ['#/izpalnenie?ed=1&prag=2', 'S15', '/izpalnenie', {}, ['ed', 'prag']],
  [
    '#/izpalnenie?pok=saldo',
    'S15',
    '/izpalnenie',
    {
      pokazatel: 'balance',
    },
    ['pok'],
  ],
  ['#/razhodi?po=vedomstva', 'S10', '/vedomstva', {}, ['po']],
  [
    '#/razhodi?po=vid',
    'S07',
    '/razhodi',
    {
      po: 'vid',
    },
    [],
  ],
  ['#/patevoditel', 'S04', '/5-minuti', {}, []],
  [
    '#/patevoditel/2',
    'S04',
    '/5-minuti',
    {
      to: 's04-scene2',
    },
    [],
  ],
  [
    '#/patevoditel/4',
    'S04',
    '/5-minuti',
    {
      to: 's04-scene5',
    },
    [],
  ],
  [
    '#/patevoditel/7',
    'S04',
    '/5-minuti',
    {
      to: 's04-scene4',
    },
    [],
  ],
  ['#/patevoditel/8', 'S18', '/danaci', {}, []],
  ['#/za-proekta', 'S24', '/danni', {}, []],
  ['#/za-proekta?to=s26-legend', 'S24', '/danni', {}, ['to']],
];
test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
test('retired addresses preserve query context', async ({ context, siteURL }) => {
  test.setTimeout(300_000); // All 24 original eight-second readiness failures can be reported.
  await enableHashRoutes(context);
  for (const [old, sid, path, want, gone] of CASES)
    await test.step(old, async () => {
      const page = await context.newPage();
      try {
        const errors: string[] = [];
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text().slice(0, 160));
        });
        page.on('pageerror', (e) => errors.push('EXC ' + String(e).slice(0, 160)));
        await page.goto(siteURL + '/index.html' + old);
        let ready = true;
        try {
          await page.waitForFunction(
            (id) => {
              const a = document.querySelector<HTMLElement>('#view article.page');
              return !!a && a.dataset.route === id && a.dataset.ready === '1';
            },
            sid,
            { timeout: 8000 },
          );
        } catch {
          ready = false;
        }
        expect.soft(ready, `${old}: screen is not ${sid}`).toBe(true);
        const hash = await page.evaluate(() => location.hash);
        const address = hash.slice(1);
        const separator = address.indexOf('?');
        const gotPath = separator < 0 ? address : address.slice(0, separator);
        const qs = separator < 0 ? '' : address.slice(separator + 1);
        const query = new URLSearchParams(qs);
        expect.soft(gotPath, old + ': final path').toBe(path);
        // parse_qs keeps the first nonempty value for each key.
        for (const [key, value] of Object.entries(want))
          expect.soft(query.getAll(key).find(Boolean), old + ': query ' + key).toBe(value);
        for (const key of gone)
          expect
            .soft(query.getAll(key).some(Boolean), old + ': query should be gone: ' + key)
            .toBe(false);
        expect.soft(errors, old + ': browser errors').toEqual([]);
      } finally {
        await page.close();
      }
    });
});
