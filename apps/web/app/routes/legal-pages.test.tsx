import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { MigratedScreen, migrated } from '../migration/registry';
import { legalHtml, PAGES } from '../../client/legal.js';
import { byId } from '../lib/legacy';
import { ROUTES } from '../lib/routes';
import type { TextScreenModel } from '../lib/screen-state';

const EMAIL = 'team@example.org';
const model = (screen: 'S36' | 'S37', feedbackEmail = EMAIL) =>
  ({
    screen,
    view: 'ready',
    params: {},
    query: {},
    core: {},
    glossary: {},
    release: {
      id: 'test',
      dataBase: '/data/',
      origin: 'https://budget.example',
      sigmaUrl: '',
      feedbackEmail,
    },
  }) as TextScreenModel;
const react = (screen: 'S36' | 'S37', email?: string) =>
  parseHTML(
    renderToStaticMarkup(
      <MigratedScreen model={model(screen, email)} navigation={{ go() {}, announce() {} }} />,
    ),
  ).document.querySelector('.legal')!;
const legacy = (screen: 'S36' | 'S37', email = EMAIL) =>
  parseHTML(`<div>${String(legalHtml(screen, email))}</div>`).document.querySelector('.legal')!;
const shape = (root: Element) => ({
  headings: [...root.querySelectorAll('h2')].map((h) => [h.id, h.textContent]),
  links: [...root.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
  text: root.textContent!.replace(/\s+/g, ' ').trim(),
});

describe.each(['S36', 'S37'] as const)('%s', (screen) => {
  it('is a React screen with its own address, no period and a description for search engines', () => {
    const route = byId[screen];
    expect(migrated(screen)).toBe(true);
    expect(route).toMatchObject({ periods: 'none', nav: false, group: 'ref' });
    expect(route.pattern).toMatch(/^\/[a-z]+$/);
    expect(route.desc.length).toBeGreaterThanOrEqual(50);
    expect(route.desc.length).toBeLessThanOrEqual(160);
    expect(ROUTES.filter((r) => r.title === route.title)).toHaveLength(1);
  });
  it('shows the same text, headings and links in React and in the legacy twin', () => {
    expect(shape(react(screen))).toEqual(shape(legacy(screen)));
    expect(shape(react(screen)).headings.map(([id]) => id)).toEqual(PAGES[screen].map((s) => s.id));
  });
  it("links the team's address, else the feedback screen", () => {
    const mail = shape(react(screen)).links.find(([text]) => text === EMAIL);
    expect(mail).toEqual([EMAIL, `mailto:${EMAIL}`]);
    const without = shape(react(screen, '')).links.find(
      ([text]) => text === 'страницата „Обратна връзка“',
    );
    expect(without?.[1]).toBe('/vrazka');
    expect(shape(react(screen, '')).links.some(([text]) => text === EMAIL)).toBe(false);
    expect(shape(legacy(screen, '')).links).toEqual(shape(react(screen, '')).links);
  });
});

it('says what the code does: no cookies, no address kept, MCP arguments not stored', () => {
  const text = shape(react('S36')).text;
  expect(text).toContain('няма бисквитки');
  expect(text).toContain('Сайтът не пази IP адреси');
  expect(text).toContain('Те не се записват');
  // the terms follow the licence block of /api (client/pages/s25-api.js): public data without a licence of its own
  expect(shape(react('S37')).text).toContain('нямат отделен лиценз');
  for (const s of ['S36', 'S37'] as const)
    expect(shape(react(s)).text).not.toMatch(/предстои|работна група/i);
});
