// @vitest-environment jsdom
import { act, type CSSProperties } from 'react';
import * as client from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chromeDOM, chromeTree } from './chrome-tree';

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, hydrateRoot: vi.fn(actual.hydrateRoot) };
});

vi.mock('../../client/loc.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toHref: (s: string) => s,
}));
const coreState = vi.hoisted(() => ({ ready: true }));
vi.mock('../lib/legacy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  data: { get: () => (coreState.ready ? core : undefined) },
}));
import core from '../routes/__fixtures__/core.json';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const frozen = readFileSync(new NodeURL('../routes/__fixtures__/S26.html', import.meta.url), 'utf8')
  .replace(/<span class="theme-pick"[\s\S]*?<\/span>/, '')
  .replace(/(<div[^>]*id="mockbar"[^>]*>)[\s\S]*?<\/div>/, '$1</div>'); // Historical fixture is unchanged; the retired banner now has no children.
const hydrate = vi.mocked(client.hydrateRoot);
beforeEach(() => {
  vi.resetModules();
  hydrate.mockClear();
  coreState.ready = true;
});
afterEach(() => {
  act(() => {
    for (const result of hydrate.mock.results) if (result.type === 'return') result.value.unmount();
  });
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

for (const [id, focus] of [
  ['topbar', '.brand'],
  ['footer', 'a'],
  ['tabbar', 'a'],
]) {
  it(`${id} retains every element and pre-existing focus through adoption and its first refresh`, async () => {
    document.documentElement.innerHTML = frozen
      .replace(/^<!doctype html>\s*/i, '')
      .replace(/^<html[^>]*>|<\/html>$/g, '');
    const { refreshChrome } = await import('./bridge');
    const { byId } = await import('../lib/legacy');
    const containers = ['mockbar', 'topbar', 'footer', 'tabbar'].map(
      (key) => document.getElementById(key)!,
    );
    const elements = containers.map((node) => [...node.querySelectorAll('*')]);
    const focused = document.querySelector<HTMLElement>(`#${id} ${focus}`)!;
    focused.focus();
    expect(document.activeElement).toBe(focused);
    const options = {
      route: byId.S26,
      periods: byId.S26.periods,
      wide: true,
      cur: 'S26',
      from: 'za-proekta',
    };
    await act(async () => refreshChrome(options));
    expect(document.activeElement).toBe(focused);
    containers.forEach((node, index) =>
      expect([...node.querySelectorAll('*')]).toEqual(elements[index]),
    );
    await act(async () =>
      refreshChrome({
        ...options,
        route: byId.S06,
        periods: 'all',
        cur: 'S06',
        wide: false,
      }),
    );
    expect(document.activeElement).toBe(focused);
    containers.forEach((node, index) => {
      const updated = [...node.querySelectorAll('*')];
      expect(updated).toHaveLength(elements[index].length);
      updated.forEach((element, i) => expect(element).toBe(elements[index][i]));
    });
    expect(document.querySelector('#btn-period')?.hasAttribute('hidden')).toBe(false);
    expect(
      document.querySelector('#footer a[data-route="S06"]')?.getAttribute('aria-current'),
    ).toBe('page');
    expect(document.querySelector('#footer details')?.hasAttribute('open')).toBe(false);
  });
}

for (const selector of ['.sister-link', '[data-action="legend"]']) {
  it(`footer retains ${selector} focus when core data is late and then arrives`, async () => {
    document.documentElement.innerHTML = frozen
      .replace(/^<!doctype html>\s*/i, '')
      .replace(/^<html[^>]*>|<\/html>$/g, '');
    const { refreshChrome } = await import('./bridge');
    const { byId } = await import('../lib/legacy');
    const focused = document.querySelector<HTMLElement>(`#footer ${selector}`)!;
    focused.focus();
    const options = {
      route: byId.S26,
      periods: byId.S26.periods,
      wide: true,
      cur: 'S26',
      from: 'za-proekta',
    };
    for (const ready of [false, true]) {
      coreState.ready = ready;
      await act(async () => refreshChrome(options));
      expect(focused.isConnected).toBe(true);
      expect(document.activeElement).toBe(focused);
    }
  });
}

it('adopts label, inline style, boolean and SVG attributes without replacing their elements', async () => {
  document.body.innerHTML =
    '<div id="chrome"><label for="choice" style="color: red; --accent: blue"><button id="choice" disabled hidden>Избор</button><svg viewBox="0 0 24 24" focusable="false"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" d="M0 0h1" /></svg></label><details open><summary>Още</summary></details></div>';
  const container = document.getElementById('chrome')!;
  const elements = [...container.querySelectorAll('*')];
  const errors: unknown[] = [];
  let root: client.Root;
  await act(async () => {
    root = client.hydrateRoot(container, chromeDOM(container), {
      onRecoverableError: (error) => errors.push(error),
    });
  });
  const style = { color: 'red', '--accent': 'blue' } as CSSProperties;
  await act(async () =>
    root.render(
      chromeTree(
        <>
          <label htmlFor="choice" style={style}>
            <button id="choice" disabled hidden>
              Избор
            </button>
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fillRule="evenodd"
                d="M0 0h1"
              />
            </svg>
          </label>
          <details open>
            <summary>Още</summary>
          </details>
        </>,
      ),
    ),
  );
  [...container.querySelectorAll('*')].forEach((element, i) => expect(element).toBe(elements[i]));
  expect(container.querySelector('label')!.htmlFor).toBe('choice');
  expect(container.querySelector('label')!.style.getPropertyValue('--accent')).toBe('blue');
  expect(container.querySelector('button')!.disabled).toBe(true);
  expect(container.querySelector('button')!.hidden).toBe(true);
  expect(container.querySelector('path')!.getAttribute('stroke-width')).toBe('2');
  expect(container.querySelector('details')!.open).toBe(true);
  expect(errors).toEqual([]);
});
