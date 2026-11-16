import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as legacy from '../../../client/chrome.js';
import { ROUTES } from '../../lib/routes';
import { NAV_GROUPS, footerHtml } from './chrome';
import { FOOTER_NOTES } from '../../routes/launch-copy-test-helper';

// The navigation the owner set: two screens renamed (their addresses stay), the «Бюджет» group in this order, and a footer without the
// legend entry and without «За проекта», whose notes are now in its fine print. The browser side (dropdowns, phone «Меню», 44px targets at 320px) is checked in tests/e2e/screens.py (ch_popovers, ch_phone).
const BUDGET = ['S34', 'S05', 'S07', 'S06', 'S10', 'S12', 'S13', 'S20', 'S14'];
const BUDGET_NAMES = [
  'Бюджет 2027',
  'Годишната рамка',
  'Разходи',
  'Приходи',
  'Кой харчи',
  'Мерки',
  'Прогноза',
  'Общини',
  'Пътят на бюджета',
];
const byId = Object.fromEntries(ROUTES.map((r) => [r.id, r]));
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
// the names with their capital, in any inflection (the article form too), or in any case when quoted as a name; the lower-case phrases
// of running text are not names. Split, so that this file does not match its own scan.
const OLD = ['анни и ' + 'методик', 'анни и ' + 'проверк'];
const OLD_NAMES = new RegExp(
  [...OLD.map((name) => 'Д' + name), ...OLD.map((name) => '[„“”"«][Дд]' + name)].join('|'),
);
const FROZEN = [
  /(^|\/)(__fixtures__|fixtures|vendor)\//,
  /^(data|pipeline|reference)\//,
  /^packages\/ingest\/src\/production\/historical\//,
];
const TEXT = /\.(tsx?|m?js|cjs|py|json|jsonc|html|css|md|ya?ml|toml|txt|svg|xml|sh)$/;

function liveFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return listed
    .split('\0')
    .filter((rel) => rel && TEXT.test(rel) && !FROZEN.some((frozen) => frozen.test(rel)));
}

const footer = () => parseHTML(renderToString(<>{footerHtml({ wide: true })}</>)).document;
const legacyFooter = () =>
  parseHTML(`<footer>${String(legacy.footerHtml({ wide: true }))}</footer>`).document;
const group = (doc: Document, label: string) =>
  [...doc.querySelectorAll('details.foot-grp')]
    .find((d) => d.querySelector('summary')?.textContent?.trim() === label)
    ?.querySelectorAll('li a');

describe('screen names', () => {
  it('S24 is «Методология» in the menu and keeps its question heading', () => {
    expect(byId.S24.short).toBe('Методология');
    expect(byId.S24.title).toBe('Откъде са данните?');
  });

  it('S35 is «Проверка на данните» as heading and in the menu', () => {
    expect(byId.S35.title).toBe('Проверка на данните');
    expect(byId.S35.short).toBe('Проверка на данните');
    expect(byId.S35.pattern).toBe('/proverka');
    expect(byId.S24.pattern).toBe('/danni/:set?');
  });

  it('no live file names a screen by its old name (frozen captures and fixtures excepted)', () => {
    const hits = liveFiles().filter((rel) => OLD_NAMES.test(readFileSync(join(ROOT, rel), 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('the «Бюджет» group', () => {
  it('has the order the owner set, in the React and the legacy chrome alike', () => {
    expect(NAV_GROUPS.find(([label]) => label === 'Бюджет')?.[1]).toEqual(BUDGET);
    expect(legacy.NAV_GROUPS).toEqual(NAV_GROUPS);
  });

  it('has that order in the route table too (the screen lists of S24 and S27, the sitemap and search ties follow it)', () => {
    expect(ROUTES.filter((r) => r.group === 'budget' && r.nav).map((r) => r.id)).toEqual(BUDGET);
  });
});

describe('one order of the screens', () => {
  it('the route table lists the screens of the menu in the order of the menu', () => {
    const menu = NAV_GROUPS.flatMap(([, ids]) => ids);
    expect(ROUTES.filter((r) => menu.includes(r.id)).map((r) => r.id)).toEqual(menu);
  });

  it('a screen that is not in the menu follows its parent or stands after all menu screens', () => {
    const ids = ROUTES.map((r) => r.id);
    const menu = NAV_GROUPS.flatMap(([, list]) => list);
    const lastOfMenu = Math.max(...menu.map((id) => ids.indexOf(id)));
    for (const r of ROUTES.filter((route) => !menu.includes(route.id))) {
      if (r.parent) expect(ids.indexOf(r.id)).toBe(ids.indexOf(r.parent) + 1);
      else expect(ids.indexOf(r.id)).toBeGreaterThan(lastOfMenu);
    }
  });

  it('is listed in that order in both footers', () => {
    for (const doc of [footer(), legacyFooter()])
      expect([...group(doc, 'Бюджет')!].map((a) => a.textContent?.trim())).toEqual(BUDGET_NAMES);
  });
});

describe('the footer', () => {
  it('has no legend entry and keeps the СИГМА link in the fine print, in both chromes', () => {
    for (const doc of [footer(), legacyFooter()]) {
      expect(doc.querySelector('[data-action="legend"]')).toBeNull();
      expect(doc.body.textContent).not.toContain('Легенда');
      const sigma = doc.querySelector('.fine .sister-link');
      expect(sigma?.textContent).toContain('СИГМА — обществени поръчки');
      expect(sigma?.getAttribute('href')).toMatch(/^https:\/\//);
    }
  });

  it('lists the renamed screens under «Данни и проект»', () => {
    for (const doc of [footer(), legacyFooter()])
      expect([...group(doc, 'Данни и проект')!].map((a) => a.textContent?.trim())).toEqual([
        'Методология',
        'Проверка на данните',
        'Отворени данни и API',
        'Обратна връзка',
      ]);
  });

  it('carries the notes of the retired «За проекта» page and the open code link just before СИГМА, in both chromes', () => {
    for (const doc of [footer(), legacyFooter()]) {
      const fine = doc.querySelector('.fine')!;
      const items = [...fine.children].map((c) => c.textContent?.replace(/\s+/g, ' ').trim());
      expect(items.slice(-6)).toEqual([
        ...FOOTER_NOTES,
        'Поверителност',
        'Условия за ползване',
        'Отворен код (друг сайт, в нов раздел)',
        'СИГМА — обществени поръчки (друг сайт, в нов раздел)',
      ]);
      expect(
        [...fine.querySelectorAll('a[data-route]')].map((a) => [
          a.getAttribute('data-route'),
          a.getAttribute('href'),
        ]),
      ).toEqual([
        ['S36', '/poveritelnost'],
        ['S37', '/usloviya'],
      ]);
      const code = fine.querySelector('a.code-link')!;
      expect(code.getAttribute('href')).toBe('https://github.com/midt-bg/sigma-budget');
      expect(code.getAttribute('target')).toBe('_blank');
      expect(code.getAttribute('rel')).toBe('noopener');
      expect(code.querySelector('.sr-only')?.textContent).toBe(' (друг сайт, в нов раздел)');
      // the wording about the publisher comes from the owner separately: the footer makes no claim about the status of the site
      expect(fine.textContent).not.toMatch(
        /официален сайт|неофициал|независим|граждан|прототип|министерств|МИДТ|издател/i,
      );
    }
  });

  it('is the same markup in the React and the legacy chrome (elements, attributes and text)', () => {
    const shape = (doc: Document) =>
      [...doc.querySelectorAll('.footer-in, .footer-in *')].map((el) => [
        el.tagName,
        [...el.attributes].map((a) => `${a.name}=${a.value}`).sort(),
        [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join('')
          .replace(/\s+/g, ' ')
          .trim(),
      ]);
    expect(shape(footer())).toEqual(shape(legacyFooter()));
  });
});

describe('header targets', () => {
  it('no rule of the site CSS makes the magnifier or «Меню» narrower than 44px', () => {
    const css = readFileSync(join(ROOT, 'apps/web/public/css/layout.css'), 'utf8');
    const small = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .filter(([, sel]) =>
        // a rule for the button itself (with a pseudo-class at most), not for something inside it
        sel
          .split(',')
          .some((part) =>
            /(\.(nav-search|menu-btn)|#btn-(search|menu))(:[\w-]+(\([^)]*\))?)*\s*$/.test(part),
          ),
      )
      .flatMap(([, sel, body]) =>
        [
          ...body.matchAll(
            /(?:^|;|\s)((?:min-|max-)?(?:width|height|inline-size|block-size)):\s*(\d+(?:\.\d+)?)px/g,
          ),
        ]
          .filter(([, , px]) => Number(px) < 44)
          .map(([, prop, px]) => `${sel.trim()} { ${prop}: ${px}px }`),
      );
    expect(small).toEqual([]);
  });
});
