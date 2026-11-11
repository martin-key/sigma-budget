// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import document2027 from '../../../../data/release/budget2027.json';
import municipalities from '../../../../data/release/municipalities.json';
import { institutions, municipalRows } from '../../client/budget-2027.js';
import { mountBillSearch } from '../../client/pages/bill-views.js';
import { dataTable } from '../../client/ui/table.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it.each([
  ['S10', 'образованието', '1700'],
  ['S20', 'Благоевград', 'BLG03'],
])(
  'retains the first %s result link when the search field loses focus',
  async (screen, query, code) => {
    vi.useFakeTimers();
    const id = screen === 'S10' ? 's10-bill-table' : 's20-bill-table';
    const rows =
      screen === 'S10'
        ? institutions(document2027).map((item: { name: string }) => ({ name: item.name }))
        : municipalRows(document2027, municipalities).map((item: { name: string }) => ({
            name: item.name,
          }));
    document.body.innerHTML = `<input id="bill-q"><p id="bill-count"></p><button data-bill-clear></button>${dataTable({ id, columns: [{ key: 'name', label: 'Име' }], rows })}`;
    const state: Record<string, string | null> = {};
    const ctx = {
      route: { id: screen },
      query: state,
      period: { key: '2027.draft' },
      data: { budget2027: document2027, municipalities },
      setQuery: (values: Record<string, string | null>) => Object.assign(state, values),
      href: (_screen: string, params: { code: string }) => '/detail/' + params.code,
    };
    const cleanup = mountBillSearch(document.body, ctx);
    const input = document.querySelector<HTMLInputElement>('#bill-q')!;
    input.focus();
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    const link = document.querySelector<HTMLAnchorElement>(`#${id} tbody a`)!;
    expect(link.getAttribute('href')).toBe('/detail/' + code);
    link.focus();
    // Browsers commit the input's change on blur, before dispatching the link click.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(link.isConnected).toBe(true);
    expect(document.querySelector(`#${id} tbody a`)).toBe(link);
    expect(state.q).toBe(query);
    cleanup?.();
  },
);
