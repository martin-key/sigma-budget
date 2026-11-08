// @vitest-environment jsdom
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import glossary from '../routes/__fixtures__/glossary.json';
import { MigratedScreen } from './registry';
import { mount, dispose } from './bridge';
import type { TextScreenModel } from '../lib/screen-state';
vi.mock('../../client/loc.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toHref: (s: string) => s,
}));
const model: TextScreenModel = {
  screen: 'S30',
  params: { path: 'missing' },
  query: {},
  core: {},
  glossary: {},
  release: { id: '', dataBase: '/data/', origin: '', sigmaUrl: '', feedbackEmail: '' },
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  act(() => dispose());
  document.body.innerHTML = '';
});
it('adopts the server subtree and React owns search; unmount releases the view', async () => {
  const navigation = { go: vi.fn(), announce: vi.fn() };
  document.body.innerHTML = `<div id="view">${renderToString(<MigratedScreen model={model} navigation={navigation} />)}</div>`;
  document.body.classList.add('bare');
  const heading = document.querySelector('h1');
  await act(async () => {
    await mount(model, navigation, true);
  });
  expect(document.querySelector('h1')).toBe(heading);
  expect(document.body.classList.contains('bare')).toBe(false);
  const input = document.querySelector('input')!;
  input.value = '  ДДС   бюджет  ';
  act(() =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(navigation.go).toHaveBeenCalledWith(
    '/tarsene?q=%D0%94%D0%94%D0%A1+%D0%B1%D1%8E%D0%B4%D0%B6%D0%B5%D1%82',
  );
  act(() => dispose());
  expect(document.getElementById('view')!.children).toHaveLength(0);
  document.getElementById('view')!.innerHTML = '<article>legacy</article>';
  expect(document.querySelector('article')!.textContent).toBe('legacy');
});
it('S26 demo selector changes the destinations and announces the selected screen', async () => {
  const navigation = { go: vi.fn(), announce: vi.fn(), openGlossary: vi.fn() };
  document.body.innerHTML = '<div id="view"></div>';
  await act(async () => {
    await mount({ ...model, screen: 'S26', glossary }, navigation);
  });
  const select = document.querySelector('select')!;
  act(() => {
    select.value = 'razhodi';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(document.querySelector('[data-s26-demo="empty"]')!.getAttribute('href')).toBe(
    '/razhodi?demo=empty',
  );
  expect(navigation.announce).toHaveBeenCalledWith('Връзките сочат към „Къде отиват парите?“.');
  const term = document.querySelector<HTMLAnchorElement>('a[data-gl]')!;
  act(() => term.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(navigation.openGlossary).toHaveBeenCalledWith(term, term.dataset.gl);
});
