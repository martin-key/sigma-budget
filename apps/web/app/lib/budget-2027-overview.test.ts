import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { provideScope } from '../../client/env.js';
import { parse } from '../../client/data.js';
import { requestState } from '../../client/store.js';
import { build, frameHtml, resolve } from '../../client/render.js';
import { tableData } from '../../client/ui/table.js';
import { comparison, cellOf, COMPARE } from '../../client/budget-2027-compare.js';
import { MEASURES_2027, measureText } from '../../client/measures-2027.js';

const read = (path: string) =>
  readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8');
const release = (name: string) => parse(name, read(`data/release/${name}.json`));
// Independent expected values: the pinned extraction of the АСБП 2027–2029 motives, not the presentation adapter.
const forecast = JSON.parse(read('data/inputs/budget_forecast_2027.json'));
const annex3 = (label: string) =>
  forecast.tables.annex3_mln.rows.find((r: any) => r.label === label).values;
const doc = release('budget2027');

afterEach(() => provideScope(() => null));
async function page(address: string) {
  const url = new URL(address, 'https://budget.test');
  const r = resolve(address);
  const scope = {
    url,
    origin: url.origin,
    state: requestState(r.query.per),
    data: new Map(),
    maps: {} as Record<string, Map<string, any>>,
    load: async (name: string) => release(name),
  };
  provideScope(() => scope);
  const vm = await build(r.route, r.params, r.query);
  const html = String(frameHtml(vm));
  return { vm, scope, html, document: parseHTML(html).document };
}

it('compares the 2027 draft with the 2026 expected result from the same Annex 3', () => {
  const data = Object.fromEntries(
    ['outlook', 'revenue', 'expenditure'].map((n) => [n, release(n)]),
  );
  const rows = comparison(data);
  const pairs: [string, string][] = [
    ['rev', 'Приходи, помощи и дарения'],
    ['exp', 'Общо разходи и Вноска в общия бюджет на ЕС'],
    ['exp.capex', 'Капиталови разходи'],
    ['exp.interest', 'Лихви'],
    ['exp.personnel', 'Персонал'],
  ];
  for (const [id, label] of pairs) {
    const row = rows.find((r) => r.id === id)!;
    const printed = annex3(label);
    expect(row.cells['2026.expected']?.value, id).toBe(printed[1]);
    expect(row.cells['2027.draft']?.value, id).toBe(printed[2]);
  }
  // the 2025 column is the report every annual screen uses, never a forecast
  expect(COMPARE[0]).toBe('2025.report');
  const capex2025 = cellOf(data, 'exp.capex', '2025.report');
  expect(capex2025?.vintage).toMatch(/^(actual|prelim)$/);
  const balance = rows.find((r) => r.id === 'bal')!;
  expect(balance.cells['2027.draft']?.value).toBe(annex3('Бюджетно салдо (+/-)')[2]);
});

it('answers the main bill view with the key figures, the comparison and the capital expenditure', async () => {
  const { vm, scope, html, document } = await page('/byudzhet-2027');
  expect(vm.title).toBe('Бюджет 2027');
  expect(html).not.toMatch(/NaN|undefined/);
  // a sentence that ends with a year does not get a second full stop after „г.“
  expect(html).not.toMatch(/г\.\./);
  for (const id of [
    'b27-nakratko',
    'b27-sravnenie',
    'b27-kapitalovi',
    'b27-prihodi',
    'b27-razhodi',
    'b27-merki',
    'b27-vedomstva',
    's34-projects',
    'b27-obshtini',
    'b27-dalg',
    's34-bill',
  ])
    expect(document.getElementById(id), id).not.toBeNull();
  expect(document.querySelectorAll('#b27-nakratko .kpi')).toHaveLength(6);
  const table = tableData(scope.maps.table.get('b27-sravnenie-table'));
  const capex = table.rows.find((r: any) => r[0] === 'Капиталови разходи')!;
  const printed = annex3('Капиталови разходи');
  expect(capex.slice(2, 4)).toEqual([printed[1], printed[2]]);
  // the change column is the plain difference of the two printed numbers
  expect(capex[4]).toBe(Math.round((printed[2] - printed[1]) * 10) / 10);
  expect((vm as { answer?: string }).answer).toContain('капиталовите разходи');
  // the capital expenditure of every institution budget, read from its own printed row
  const ranked = scope.maps.attached.get('b27-kapitalovi-vedomstva').table;
  const list = typeof ranked === 'function' ? ranked() : ranked;
  expect(list.rows.length).toBeGreaterThan(5);
});

it.each([
  'b27-nakratko',
  'b27-sravnenie',
  'b27-kapitalovi',
  'b27-prihodi',
  'b27-razhodi',
  'b27-merki',
  'b27-vedomstva',
  'b27-obshtini',
  'b27-dalg',
])(
  'keeps the overview section %s on the November bill, apart from the October plan',
  async (id) => {
    const { vm, document } = await page('/byudzhet-2027?to=' + id);
    expect(vm.title).toBe('Бюджет 2027');
    expect(document.getElementById(id)).not.toBeNull();
  },
);

it('keeps one checked companion entry for every printed measure', () => {
  for (const table of ['II_7', 'II_8'] as const) {
    const rows = doc.forecast[table].filter((r: any) => r.label !== 'Общо:');
    expect(MEASURES_2027[table]).toHaveLength(rows.length);
    rows.forEach((r: any, i: number) =>
      expect(measureText(table, i, r.label), r.label).not.toBeNull(),
    );
  }
  // a row that is not the same any more keeps its printed label and no title
  expect(measureText('II_7', 0, 'Друга мярка')).toBeNull();
});

it('lays out every 2027 measure as a card with its three effects and a quote of the motives', async () => {
  const { document, html } = await page('/merki');
  const cards = [...document.querySelectorAll('.m27-card')];
  const total = ['II_7', 'II_8'].reduce(
    (n, t) => n + doc.forecast[t].filter((r: any) => r.label !== 'Общо:').length,
    0,
  );
  expect(cards).toHaveLength(total);
  for (const card of cards) {
    const years = card.querySelectorAll('.m27-year');
    expect(years).toHaveLength(3);
    for (const [k, year] of [...years].entries())
      expect(year.getAttribute('id')).toMatch(new RegExp(`^s12-II_[78]-\\d+-${k}$`));
    expect(card.querySelector('blockquote.s12-quote-text')?.textContent?.length).toBeGreaterThan(
      40,
    );
  }
  for (const key of ['prihodni', 'razhodni', 'zakoni'])
    expect(document.querySelector(`[role="tab"][data-key="${key}"]`)).not.toBeNull();
  expect(html).toContain('Сборове по мерките');
  expect(html).not.toMatch(/NaN|undefined|г\.\./);
  // the windfall tax: the printed effect and its reversal the next year
  const windfall = document.getElementById('m27-svrahpechalba')!;
  expect(windfall.textContent).toContain('+800,0');
  expect(windfall.textContent).toContain('−800,0');
});

it('opens the list of a shared measure by its tab', async () => {
  const { document } = await page('/merki?spisak=razhodni');
  const tab = document.querySelector('[role="tab"][data-key="razhodni"]')!;
  expect(tab.getAttribute('aria-selected')).toBe('true');
});
