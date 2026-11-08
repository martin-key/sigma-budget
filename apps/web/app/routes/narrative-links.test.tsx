// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

afterEach(() => {
  delete (window as Window & { __HASH_ROUTES__?: boolean }).__HASH_ROUTES__;
  vi.resetModules();
});

it('keeps timeline links inside legacy hash navigation', async () => {
  (window as Window & { __HASH_ROUTES__?: boolean }).__HASH_ROUTES__ = true;
  vi.resetModules();
  const { timeline } = await import('../components/NarrativeUI');
  const { isAppHref } = await import('../../client/loc.js');
  const container = document.createElement('div');
  container.innerHTML = renderToString(
    timeline({
      label: 'Събития',
      items: [
        { title: 'Отчет', href: '#/izpalnenie?mesec=9' },
        { title: 'Източник', href: 'https://example.org/source' },
      ],
    }),
  );
  const links = [...container.querySelectorAll('a')];
  expect(links[0].getAttribute('href')).toBe('#/izpalnenie?mesec=9');
  expect(isAppHref(links[0].getAttribute('href'))).toBe(true);
  expect(links[1].getAttribute('href')).toBe('https://example.org/source');
});
