import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import {
  institutions,
  municipalRows,
  stateDebt,
  strictSum,
  provenanceUrl,
  FRAMEWORK,
} from '../../client/budget-2027.js';
import { annualView } from '../../client/annual.js';
import { provideScope } from '../../client/env.js';
import { parse } from '../../client/data.js';
import { requestState } from '../../client/store.js';
import { build, frameHtml, resolve } from '../../client/render.js';
import { tableData } from '../../client/ui/table.js';
import { periodByKey } from '../../client/periods.js';
import { csvFor, linkFor, shortLink, reset as resetShare } from '../../client/share.js';
import { head } from '../../client/seo.js';
import { getIndex, stageOf, metaOf } from '../../client/searchlib.js';
import { planCsv } from '../../client/ui/plan.js';
import { revExpChart } from '../../client/pages/s13-prognoza.js';
const read = (path: string) =>
  readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8');
const release = (name: string) => parse(name, read(`data/release/${name}.json`));
// Independent expected values come from the pinned Python extraction, never from the presentation adapter.
const bill = JSON.parse(read('data/inputs/budget_bill_2027.json'));
const forecast = JSON.parse(read('data/inputs/budget_forecast_2027.json'));
const doc = release('budget2027');
const sourceIndex = release('budget2027-provenance');
it.each([
  ['institutions', 'Проект 2027', '2027.draft', 'По законопроекта 2027'],
  ['municipalities', 'Проект 2027', '2027.draft', 'По законопроекта 2027'],
  ['indicators', 'Проект 2027', '2027.draft', 'По законопроекта 2027'],
  ['indicators', 'Прогноза 2027', '2027.draft', 'Прогноза 2027'],
  ['indicators', 'Прогноза 2028', '2028.forecast', 'Прогноза 2028'],
  ['indicators', 'Прогноза 2029', '2029.forecast', 'Прогноза 2029'],
  ['measures', '2026', '2026.law', 'По законопроекта 2026'],
  ['measures', 'Прогноза 2028', '2028.forecast', 'Прогноза 2028'],
  ['institutions', 'Проект 2026', '2026.law', 'По законопроекта 2026'],
])('labels %s from publication metadata: %s', (group, period, key, expected) => {
  expect(stageOf(group, { period, href: `#/dalg?per=${key}` })).toBe(expected);
});
it.each([
  [
    'Данък върху доходите на физическите лица',
    'Основна ставка по Приложение 2 към законопроекта',
    'По законопроекта 2026',
  ],
  ['БВП', 'Макроикономическа прогноза', 'Прогноза 2026'],
  ['Изпълнение на КФП', 'Месечен отчет', 'Отчет 2026'],
  ['Приходи', 'КФП · отчет', 'Отчет 2026'],
])(
  'keeps the publication status of %s independently of its law-period destination',
  (title, sub, expected) => {
    expect(
      stageOf('indicators', { title, sub, period: '2026', href: '#/danaci?per=2026.law' }),
    ).toBe(expected);
  },
);
it('does not offer an old draft figure when annual search data is unavailable', async () => {
  const scope = {
    url: new URL('https://budget.test/tarsene'),
    state: requestState(),
    data: new Map(),
    maps: {},
    load: async (name: string) => {
      if (name === 'expenditure') throw new Error('Unavailable');
      return release(name);
    },
  };
  provideScope(() => scope);
  const index = await getIndex();
  expect(index.entries.some((e: any) => e.title === 'ДДС' && !e.href.includes('per='))).toBe(false);
  expect(
    index.entries.some((e: any) => e.group === 'institutions' && e.stage === 'Закон 2027'),
  ).toBe(false);
  const budgets = index.entries.filter(
    (e: any) =>
      ['institutions', 'municipalities'].includes(e.group) && e.href.includes('per=2027.draft'),
  );
  expect(budgets).toHaveLength(47 + 265);
  for (const entry of budgets) {
    expect(entry.stage).toBe('По законопроекта 2027');
    expect(metaOf(entry)).not.toContain('Закон 2027');
  }
  const forecasts = index.entries.filter((e: any) =>
    /^Държавен дълг по ЗДД 202[789]$/.test(e.title),
  );
  expect(forecasts).toHaveLength(3);
  for (const entry of forecasts) expect(metaOf(entry)).toContain('Прогноза ');
  const historicalMeasures = index.entries.filter(
    (e: any) => e.group === 'measures' && e.period === '2026',
  );
  expect(historicalMeasures).toHaveLength(52);
  for (const entry of historicalMeasures) expect(entry.stage).toBe('По законопроекта 2026');
  const billRate = index.entries.find((e: any) =>
    e.sub.includes('Основна ставка по Приложение 2 към законопроекта'),
  );
  expect(billRate?.stage).toBe('По законопроекта 2026');
  expect(metaOf(billRate)).not.toContain('Закон 2026');
});
it('localizes declared canonical decimals without losing precision or weakening formula protection', () => {
  const canonical = '-12345678901234567890.123456789';
  const csv = csvFor({
    table: {
      columns: ['Код', 'Сума'],
      decimalColumns: [1],
      rows: [
        ['01.02', canonical],
        ['x', '=1+1'],
      ],
    },
  });
  expect(
    csv
      .split('\r\n')[1]
      .split(';')
      .slice(0, 2)
      .map((s: string) => s.replace(/^"|"$/g, '')),
  ).toEqual(['01.02', '-12345678901234567890,123456789']);
  expect(csv).toContain("x;'=1+1;");
  expect(canonical).toBe('-12345678901234567890.123456789');
  const plan = planCsv({
    asOf: '2026-09-30',
    basis: { adopted: true, csvPlan: 'План' },
    rows: [{ name: 'Приходи', canonical: { cum: '33898.5', plan: '49615.3' }, share: 68.32 }],
  });
  expect(
    csvFor({ table: plan })
      .split('\r\n')[1]
      .split(';')
      .slice(0, 4)
      .map((s: string) => s.replace(/^"|"$/g, '')),
  ).toEqual(['Приходи', '33898,5', '49615,3', '68,32']);
});
afterEach(() => provideScope(() => null));
async function page(address: string, absent = false) {
  const url = new URL(address, 'https://budget.test');
  const r = resolve(address);
  const scope = {
    url,
    origin: url.origin,
    state: requestState(r.query.per),
    data: new Map(),
    maps: {} as Record<string, Map<string, any>>,
    load: async (name: string) => (name === 'budget2027' && absent ? undefined : release(name)),
  };
  provideScope(() => scope);
  const vm = await build(r.route, r.params, r.query);
  return {
    vm,
    scope,
    html: String(frameHtml(vm)),
    document: parseHTML(String(frameHtml(vm))).document,
  };
}
it.each([
  'ministries',
  'programs',
  'measures',
  'debt',
  'municipalities',
  'ministries-programs',
  'law',
  'geo-obshtini',
])('keeps the publication period in historical catalogue links: %s', async (name) => {
  const { document } = await page('/danni/' + name);
  const links = [...document.querySelectorAll('.s24-facts a[href]')]
    .map((a) => a.getAttribute('href')!.replace(/^#/, ''))
    .filter((h) =>
      /^\/(pari|razhodi|vedomstva|vedomstvo|merki|dalg|obshtini|obshtina|zakon)(?:\?|\/|$)/.test(h),
    );
  expect(links.length).toBeGreaterThan(0);
  for (const link of links)
    expect(new URL(link, 'https://budget.test').searchParams.get('per')).toBe('2026.law');
});
it.each([
  's34-kratko',
  's34-ppd',
  's34-caps-fig',
  's34-merki',
  's34-prihodi',
  's34-razhodi',
  's34-dalg',
  's34-esa-kfp',
])('restores the original budget-plan document for a shared section: %s', async (target) => {
  const { document, vm } = await page('/byudzhet-2027?to=' + target);
  expect(vm.title).toContain('Проект на бюджетен план до ЕК');
  expect(document.getElementById(target)).not.toBeNull();
  expect(document.getElementById('s34-bill')).toBeNull();
});
it('keeps new bill targets and explicit document choices separate', async () => {
  for (const address of [
    '/byudzhet-2027',
    '/byudzhet-2027?to=s34-bill',
    '/byudzhet-2027?variant=billMc&to=s34-mc-budget',
    '/byudzhet-2027?dokument=bill&to=s34-ppd',
  ]) {
    expect((await page(address)).vm.title).not.toContain('Проект на бюджетен план до ЕК');
  }
});
it('keeps the inferred October document in canonical and both sharing links', async () => {
  const { vm } = await page('/byudzhet-2027?to=s34-ppd');
  resetShare(vm.route);
  expect(linkFor({ id: 's34-ppd' })).toContain('dokument=plan');
  expect(shortLink({ id: 's34-ppd' })).toContain('dokument=plan');
  const canonical = head(vm, vm.title).tags.find((tag: any) => tag.attrs?.rel === 'canonical');
  expect(canonical && 'href' in canonical.attrs ? canonical.attrs.href : undefined).toContain(
    'dokument=plan',
  );
});
it.each(['/', '/5-minuti'])(
  'pins annual destinations on primary page %s to its displayed year',
  async (path) => {
    const { document, vm } = await page(path + '?per=2026.law');
    expect(vm.ctx!.period!.key).toBe('2027.draft');
    const links = [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href') || '')
      .filter((href) => /^\/(?:prihodi|razhodi|vedomstva)(?:[/?]|$)/.test(href));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links)
      expect(new URL(href, 'https://budget.test').searchParams.get('per')).toBe('2027.draft');
  },
);
it.each([
  ['/vedomstva', 's10-bill-list', 'Бюджети на ведомствата'],
  ['/vedomstvo/0600', 's11-budget-2027', 'Бюджети на ведомствата'],
  ['/obshtina/BLG03', 's21-transfers-2027', 'Трансфери от държавния бюджет'],
  ['/dalg', 's17-debt-2027', 'Държавен дълг по Закона за държавния дълг'],
  ['/dalg', 's17-limits-2027', 'фискалния резерв и държавния дълг'],
  ['/merki', 's12-II_7', 'Приходни мерки'],
  ['/5-minuti', 's04-scene5', 'Приходни и разходни мерки по АСБП 2027–2029'],
])('exports a semantic CSV scope for %s', async (path, id, scopeText) => {
  const { scope } = await page(path);
  const spec = scope.maps.share.get(id);
  expect(spec, id).toBeDefined();
  expect(csvFor({ ...spec, table: { columns: ['x'], rows: [[1]] } })).toContain(scopeText);
});
it.each([
  ['/merki', 's12-II_7', 's12-II_7-table'],
  ['/merki', 's12-II_8', 's12-II_8-table'],
  ['/obshtini', 's20-municipal-framework', 's20-framework-table'],
])(
  'keeps multi-year CSV row statuses independent of the selected period: %s %s',
  async (path, id, tableId) => {
    const exports: string[] = [];
    for (const per of FRAMEWORK) {
      const { scope, html } = await page(path + '?per=' + per);
      const spec = scope.maps.share.get(id);
      const table = tableData(scope.maps.table.get(tableId));
      expect(html).toContain('Законопроект 2027 и прогноза 2028–2029');
      expect(table.statuses).toEqual(
        table.rows.map((row: unknown[]) => (String(row[0]).includes('2027') ? 'real' : 'forecast')),
      );
      exports.push(csvFor({ ...spec, table }));
    }
    expect(exports[1]).toBe(exports[0]);
    expect(exports[2]).toBe(exports[0]);
  },
);
it('summarizes the investment programme without provenance noise', async () => {
  const { scope, html, document } = await page('/byudzhet-2027');
  for (const key of FRAMEWORK) expect(html).toContain(String(periodByKey(key)?.label));
  // Cell provenance stays in the CSV and the sources note, not in the project tables.
  for (const id of ['s34-projects-table', 's34-project-details'])
    expect(document.querySelector(`#${id}`)?.textContent).not.toMatch(/provenance|Произход/);
  expect(document.querySelector('#s34-projects #s34-projects-by-institution-fig')).not.toBeNull();
  const top = tableData(scope.maps.table.get('s34-projects-table'));
  expect(top.rows).toHaveLength(10);
  const all = tableData(scope.maps.table.get('s34-project-details'));
  expect(all.rows).toHaveLength(doc.projects.length);
  // The block's CSV is the project list, not the institution chart.
  const csv = csvFor(scope.maps.share.get('s34-projects'));
  expect(csv).toContain('Номер в приложението');
  expect(csv.trim().split('\r\n')).toHaveLength(doc.projects.length + 1);
  // Name, institution and appendix number are kept for the CSV; empty years stay empty, never zero.
  expect(all.columns.slice(0, 3)).toEqual(['Проект', 'Ведомство', 'Номер в приложението']);
  const gap = doc.projects.find((r: any) => Object.keys(r.gaps || {}).length);
  const row = all.rows.find((r: any) => r[2] === gap.id);
  const idx = Number(Object.keys(gap.gaps)[0]);
  expect(row?.[3 + idx]).toBe('');
  // The top ten are ordered by the printed sum of their three years.
  const totals = top.rows.map((r: any) =>
    r.slice(3, 6).reduce((a: number, v: any) => a + (v === '' ? 0 : v), 0),
  );
  expect(totals).toEqual([...totals].sort((a: number, b: number) => b - a));
});
it('filters the investment projects by the search query', async () => {
  const { scope, html } = await page('/byudzhet-2027?q=самолет');
  const all = tableData(scope.maps.table.get('s34-project-details'));
  expect(all.rows.length).toBeGreaterThan(0);
  expect(all.rows.length).toBeLessThan(doc.projects.length);
  expect(all.rows.every((r: any) => /самолет/i.test(r[0]))).toBe(true);
  expect(html).toMatch(/<details[^>]*id="s34-all-projects"[^>]*open/);
});
it('keeps glossary references and the overview scope meaningful', async () => {
  const { document } = await page('/rechnik/proekt-na-byudzheten-plan');
  expect(document.querySelector('.s03-see a')?.getAttribute('href')?.replace(/^#/, '')).toBe(
    '/byudzhet-2027?dokument=plan',
  );
  const overview = (await page('/pari')).html;
  expect(overview).toContain('Бюджети на ведомствата');
  expect(overview).toContain('не е целият бюджет');
  expect(overview).not.toContain('ОБХВАТ: ZDB-VEDOMSTVA');
  const plan = await page('/byudzhet-2027?dokument=plan');
  expect(plan.html).toContain('основния изглед за бюджет 2027');
  expect(plan.html).not.toContain('Не можем да потвърдим дали е публикуван');
});
it('preserves historical municipality next links and institution breadcrumbs', async () => {
  const law = await page('/zakon');
  expect(law.vm.view).toBe('ready');
  expect(law.html).toContain('/vedomstvo/0600?per=2026.law');
  const municipality = await page('/obshtina/BLG03?per=2026.law');
  expect(municipality.html).toContain('/obshtini?per=2026.law');
  const institution = await page('/vedomstvo/1300?per=2026.law');
  expect(institution.vm.crumbs.some((c: any) => c.href === '/vedomstva?per=2026.law')).toBe(true);
});
it('preserves the Council-of-Ministers variant in institution return links', async () => {
  const { document, vm } = await page('/vedomstvo/0600?variant=billMc');
  expect(
    document.querySelectorAll('a[href="/vedomstva?variant=billMc"]').length,
  ).toBeGreaterThanOrEqual(2);
  if (!vm.ctx) throw new Error('Institution context missing');
  expect(vm.ctx.href('S10')).toBe('/vedomstva?variant=billMc');
  expect(vm.ctx.href('S10', {}, { variant: 'bill' })).toBe('/vedomstva?variant=bill');
});
it('shows bill rows by their printed labels, without the unprinted marker or a repeated variant', async () => {
  const { document, html } = await page('/vedomstvo/1200');
  const policies = document.querySelector('#s11-bill-policies');
  expect(policies?.textContent).toContain('Всичко:');
  expect(html).not.toContain('unprinted');
  expect(
    [...(policies?.querySelectorAll('thead th') || [])].map((th) => th.textContent),
  ).not.toContain('Вариант');
});
it.each(['blg03', 'bLg03'])(
  'accepts municipality codes with existing case-insensitive semantics: %s',
  async (code) => {
    const expected = await page('/obshtina/BLG03');
    const actual = await page('/obshtina/' + code);
    expect(actual.vm.view).toBe('ready');
    expect(actual.vm.title).toBe(expected.vm.title);
    expect(actual.scope.maps.table.get('s21-transfers-2027-table').rows).toEqual(
      expected.scope.maps.table.get('s21-transfers-2027-table').rows,
    );
  },
);
it('provides row anchors for searched measures, preserving effects and blank cells', async () => {
  const { document } = await page('/merki?per=2028.forecast&to=s12-II_7-1-1');
  const effect = document.getElementById('s12-II_7-1-1')!;
  // the anchor is the 2028 value on the card of the measure; the card carries the printed row
  expect(effect.closest('.m27-card')?.textContent).toContain('електронно фактуриране');
  expect(effect.textContent).toContain('400,0');
  expect(effect.textContent).toContain('2028');
  const missing = document.getElementById('s12-II_7-1-0')!;
  expect(missing.textContent).toContain('Празна печатна клетка.');
  expect(missing.getAttribute('tabindex')).toBe('-1');
});
it('exports each forecast debt row with its own unit', async () => {
  const { scope } = await page('/dalg');
  const table = tableData(scope.maps.table.get('s17-debt-table'));
  const csv = csvFor({ table, period: '2027.draft', unit: 'По редове' });
  for (const [i, row] of table.rows.entries()) {
    const unit = table.units[i];
    expect(csv.split('\r\n')[i + 1]).toContain(`;2027.draft;${unit};`);
    expect(row[row.length - 1]).toBe(unit);
  }
  expect(csv).not.toContain(';хил. €;');
});
it.each(['2028.forecast', '2029.forecast'])(
  'keeps the selected framework measures in the overview for %s',
  async (period) => {
    const { html } = await page('/pari?per=' + period);
    expect(html).toContain('/merki?per=' + period);
    expect(html).not.toContain('Мерки по законопроекта за 2026');
  },
);
it('labels the 2026 measures in the overview as the bill’s, not the adopted law’s', async () => {
  const { html } = await page('/pari?per=2026.law');
  expect(html).toContain('Мерки по законопроекта за 2026');
  expect(html).not.toContain('Мерки в бюджета за 2026');
});
it('uses the 2027 draft by default and preserves explicit reports, law, expected and aliases', async () => {
  expect(requestState().period).toBe('2027.draft');
  for (const key of ['2024.report', '2025.report', '2026.law', '2026.expected', ...FRAMEWORK])
    expect(requestState(key).period).toBe(key);
  expect(requestState('2026.draft').period).toBe('2026.law');
  for (const path of ['/pari', '/vedomstva', '/obshtini', '/dalg', '/prognoza']) {
    const result = await page(path);
    expect(result.vm.ctx?.period?.key).toBe('2027.draft');
    expect(result.vm.view).toBe('ready');
    expect(result.html).not.toMatch(/NaN|undefined/);
    expect(result.html).toContain('2027');
  }
  expect((await page('/vedomstva?per=2026.law')).html).toContain('по закона за 2026 г.');
  expect((await page('/obshtini?per=2026.law')).html).toContain('2026');
  expect((await page('/dalg?per=2026.law')).html).toContain('2026');
});
it('matches all 47 institution budgets to independent article headlines, including shifted articles', () => {
  const items = institutions(doc);
  expect(items).toHaveLength(47);
  expect(new Set(items.map((i) => i.code)).size).toBe(47);
  for (const item of items) {
    expect(item.expenditure.value).toBe(bill.bill[item.article].headline.exp);
    expect(item.revenue?.value ?? null).toBe(bill.bill[item.article].headline.rev);
    expect(sourceIndex.entries[item.expenditure.provenance].variant).toBe('bill');
  }
  expect(items.find((i) => i.code === '3800')?.article).toBe(33);
  expect(items.find((i) => i.code === '8600')?.article).toBe(48);
  expect(items.find((i) => i.article === 32)?.code).toBe('art32');
  const expected =
    Object.entries<any>(bill.bill)
      .filter(([a]) => +a >= 2)
      .reduce((s, [, b]) => s + Math.round(b.headline.exp * 10), 0) / 10;
  expect(strictSum(items.map((i) => i.expenditure))).toBe(expected);
});
it('keeps the sparse Council of Ministers variant separate and never fills absent articles', async () => {
  const items = institutions(doc, 'billMc');
  expect(items).toHaveLength(1);
  expect(items[0].article).toBe(2);
  expect(items[0].expenditure.value).toBe(bill.billMc['2'].headline.exp);
  expect(items[0].expenditure.value).not.toBe(bill.bill['2'].headline.exp);
  expect(sourceIndex.entries[items[0].expenditure.provenance].variant).toBe('billMc');
  const missing = await page('/vedomstvo/1300?variant=billMc');
  expect(missing.html).toContain('Няма публикуван бюджет в този вариант');
  expect(missing.html).not.toContain('2 104 824');
  const changed = await page('/vedomstvo/3800');
  expect(changed.html).toContain('чл. 33');
  expect(changed.html).toContain('охран');
});
it('matches all 265 municipalities by identity and both article allocations and printed totals', () => {
  const rows = municipalRows(doc, release('municipalities'));
  expect(rows).toHaveLength(265);
  expect(rows.every((r: any) => r.id)).toBe(true);
  expect(new Set(rows.map((r: any) => r.id)).size).toBe(265);
  for (const row of rows) {
    const original = bill.municipal.art52.rows.find(
      (r: any) => r.name === row.name && r.region === row.region,
    );
    expect(row.cells.map((c: any) => c?.value ?? null)).toEqual(original.values);
    const delegated = bill.municipal.art53.rows.find(
      (r: any) => r.name === row.name && r.region === row.region,
    );
    expect(row.delegated.map((c: any) => c?.value ?? null)).toEqual(delegated.values);
  }
  for (let i = 0; i < 5; i++) {
    expect(strictSum(rows.map((r: any) => r.cells[i]))).toBe(bill.municipal.art52.total[i]);
    expect(doc.municipalTotals.art52[i].value).toBe(bill.municipal.art52.total[i]);
  }
  for (let i = 0; i < 10; i++)
    expect(doc.municipalTotals.art53[i].value).toBe(bill.municipal.art53.total[i]);
  expect(rows.find((r: any) => r.id === 'BLG03')?.cells[0].value).toBe(60265.9);
});
it('shows printed blanks as missing, never as a previous-year number or an inferred zero', () => {
  expect(strictSum([{ value: 1 }, undefined])).toBeNull();
  const incomplete = structuredClone(doc);
  delete incomplete.budgets.bill['12'].rows.find((r: any) => r.no === 'II.').cell;
  expect(institutions(incomplete).find((i) => i.code === '1300')?.expenditure).toBeUndefined();
  expect(stateDebt({ forecast: {} }, '2027.draft')).toBeNull();
});
it('uses VI-1 forecast amounts and printed GDP ratios, with distinct bill article limits', async () => {
  for (const [i, key] of FRAMEWORK.entries()) {
    const d = stateDebt(doc, key)!;
    expect(d.total?.value).toBe(forecast.tables.VI_1.rows[0].values[i + 2]);
    expect(d.pctGdp?.value).toBe(forecast.tables.VI_1.rows[1].values[i + 2]);
    expect(d.external?.value).toBe(forecast.tables.VI_1.rows[2].values[i + 2]);
  }
  expect(doc.debtLimits['66'].value).toBe(bill.articles['66'][0].amounts[0]);
  expect(doc.debtLimits['67'].value).toBe(bill.articles['67'][0].amounts[0]);
  expect(doc.debtLimits['68'].value).toBe(bill.articles['68'][0].amounts[0]);
  const d = await page('/dalg');
  expect(d.html).toContain('минимален фискален резерв');
  expect(d.html).toContain('максимален нов държавен дълг');
  const m = await page('/dalg?obhvat=maastricht');
  expect(m.html).toContain('Няма съпоставим периоден ред по Маастрихт');
  expect(m.html).not.toContain('44 343');
  expect((await page('/dalg?per=2028.forecast')).html).toContain('граници само за 2027');
});
it('charts the primary 2027–2029 publication with independently extracted amounts and legal labels', async () => {
  const { vm } = await page('/prognoza');
  expect((vm.ctx?.data as any).outlook.periodKeys).toEqual(FRAMEWORK);
  const chart = revExpChart(vm.ctx);
  expect(chart.categories).toEqual(['2027\nпроект', '2028\nпрогноза', '2029\nпрогноза']);
  const table = tableData(chart.table);
  for (const [i, row] of table.rows.entries()) {
    expect(row[2]).toBe(forecast.tables.annex3_mln.rows[0].values[i + 2]);
    expect(row[3]).toBe(forecast.tables.annex3_pct_gdp.rows[0].values[i + 2]);
    expect(sourceIndex.entries[row[4] as string].table).toBe('annex3_mln');
  }
  const historical = annualView(release('outlook'), 'outlook', release('outlook'), '2026.law');
  expect(historical.periodKeys).toContain('2026.law');
  expect(historical.periodKeys).toContain('2026.expected');
});
it('exports source IDs, full provenance links, selected period, units, release and bill variant in CSV', async () => {
  const { scope } = await page('/vedomstva?variant=billMc');
  const table = tableData(scope.maps.table.get('s10-bill-table'));
  const csv = csvFor({ table, source: ['budget2027'], period: '2027.draft', unit: 'хил. €' });
  expect(csv).toContain('Вариант на Министерския съвет');
  expect(csv).toContain(';2027.draft;хил. €;');
  expect(csv).toContain(institutions(doc, 'billMc')[0].expenditure.provenance);
  expect(csv).toContain('/data/budget2027-provenance.json#');
  const rid = 'a'.repeat(64);
  provideScope(() => ({ dataBase: `/data/releases/${rid}/data/` }));
  expect(provenanceUrl(doc.debtLimits['68'])).toBe(
    `/api/releases/${rid}/provenance/budget2027/${doc.debtLimits['68'].provenance}`,
  );
  const archive = readFileSync(
    new URL('../../../../data/originals/budget_2027/ZDBRB-2027.zip', import.meta.url),
  );
  expect(createHash('sha256').update(archive).digest('hex')).toBe(bill.source.sha256);
  expect(sourceIndex.documents.bill.memberSha256).toBe(bill.source.memberSha256);
  expect(sourceIndex.documents.forecast.memberSha256).toBe(forecast.source.pdf_sha256);
});
it('exposes missing programmes, absent future allocations and old releases explicitly', async () => {
  // The programme URL now uses a neutral unavailable-period explanation.
  expect((await page('/vedomstvo/1300/1300.01.01')).html).toContain(
    'Няма програма за избрания период',
  );
  expect((await page('/obshtina/BLG03?per=2029.forecast')).html).toContain(
    'Няма индивидуално общинско разпределение',
  );
  expect((await page('/obshtini?per=2029.forecast')).html).toContain('Общинска рамка 2027–2029');
  expect((await page('/vedomstva', true)).html).toContain('Това издание няма данните');
});

it('builds new institution navigation without calling historical programme models', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const path of ['/vedomstvo/3800', '/vedomstvo/art32', '/vedomstvo/art1']) {
      expect((await page(path)).vm.view).toBe('ready');
    }
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});
it('preserves the published measure blanks and signs in the 2027–2029 CSV', async () => {
  const { scope, html } = await page('/merki');
  const table = tableData(scope.maps.table.get('s12-II_7-table'));
  expect(table.rows[0][2]).toBe(forecast.tables.II_7.rows[0].values[0]);
  expect(table.rows[1][2]).toBe(forecast.tables.II_7.rows[0].values[1]);
  expect(table.rows[2][2]).toBe('');
  expect(html).toContain('Празна печатна клетка.');
  const csv = csvFor({ table, period: '2027–2029', unit: 'млн. €', source: ['budget2027'] });
  expect(csv).toContain('Празна печатна клетка.');
  expect(csv).toContain('-800');
});

it('keeps monthly execution on its actual 2026 context inside the primary 2027 guide', async () => {
  const { vm, scope, html } = await page('/5-minuti');
  expect((vm.ctx as any).data.core.kpis.year).toBe(2027);
  expect((vm.ctx as any).annualRaw.core.kpis.gdp.year).toBe(2026);
  expect(scope.maps.share.get('s04-scene1').period).toBe('2027.draft');
  expect(scope.maps.share.get('s04-scene6').period).toBe('2026.law');
  expect(html).toContain('Изпълнението през 2026 г.');
  const monthly = scope.maps.attached.get('s04-fig6').table;
  const table = typeof monthly === 'function' ? monthly() : monthly;
  const original = release('execution').canonical.latest.kfp;
  expect(table.rows[0][1]).toBe(original.rev.cum);
  expect(table.rows[0][2]).toBe(original.rev.plan);
});

it('does not append the main bill investment programme to the Council of Ministers overview', async () => {
  const { scope, html } = await page('/byudzhet-2027?variant=billMc');
  expect(html).not.toContain('id="s34-projects"');
  expect(html).toContain('Няма отделни общински и инвестиционни приложения');
  const table = tableData(scope.maps.table.get('s34-mc-table'));
  const expense = table.rows.find((r: any) => r[0] === 'II. РАЗХОДИ');
  expect(expense?.[1]).toBe(bill.billMc['1'].headline.exp);
});

it('registers only visible municipal share blocks for detail and forecast routes', async () => {
  for (const path of ['/obshtina/BLG03', '/obshtini?per=2029.forecast']) {
    const { scope, document } = await page(path);
    for (const id of scope.maps.share.keys())
      expect(document.getElementById(id), id).not.toBeNull();
  }
});

it('preserves municipal region-code URLs while reading only the 2027 allocations', async () => {
  const { scope } = await page('/obshtini?oblast=BLG');
  const rows = scope.maps.table.get('s20-bill-table').rows;
  const original = bill.municipal.art52.rows.filter((r: any) => r.region === 'ОБЛАСТ БЛАГОЕВГРАД');
  expect(rows).toHaveLength(original.length);
  // the bill's „ОБЛАСТ БЛАГОЕВГРАД“ is shown by the region name of the municipality identity
  expect(rows.every((r: any) => r.region === 'Благоевград')).toBe(true);
});

it.each(['/vedomstva', '/vedomstvo/1300', '/vedomstvo/art1'])(
  'shows the published institution tables without programme placeholders: %s',
  async (address) => {
    const { document } = await page(address);
    const body = document.querySelector('.page-body')!;
    expect(body.querySelector('table')).not.toBeNull();
    expect(body.textContent).not.toMatch(/Предстои|пълен програмен архив|Програмите за 2027/);
  },
);
it('keeps historical measure navigation with a neutral explanation', async () => {
  const { document } = await page('/merki/historical');
  expect(document.querySelector('article')!.textContent).toContain(
    'Мярката е от бюджета за 2026 г.',
  );
  expect(document.querySelector('.page-body [data-st="pending"]')).toBeNull();
  expect(document.querySelector('a[href*="merki?per=2027.draft"]')).not.toBeNull();
});
it('keeps feedback usable without a configured mail address', async () => {
  const { document } = await page('/vrazka');
  expect(document.querySelector('article')!.textContent).toContain('Запазване в браузъра');
  expect(document.querySelector('article')!.textContent).toContain('не се изпраща');
  expect(document.querySelector('article')!.textContent).not.toMatch(
    /Изпращането предстои|към екипа още|Общини и проекти \(предстои\)/,
  );
  expect(document.querySelector('#s27-ideya-topic option[value="obshtini"]')?.textContent).toBe(
    'Общини и проекти',
  );
});
it('keeps the budget-plan document limitations without a future-review placeholder', async () => {
  const { document } = await page('/byudzhet-2027?dokument=plan');
  const limitations = document.querySelector('#s34-lipsva')!;
  expect(limitations.textContent).toContain('Обхват на документа');
  expect(limitations.textContent).not.toContain('Предстои');
  expect(limitations.textContent).not.toContain('Оценката на Европейската комисия');
});

it.each(release('expenditure').functions.items.map((f: any) => f.id) as string[])(
  'omits the empty ministry block for function %s in the launch period',
  async (fn) => {
    const { document } = await page('/razhodi/' + fn);
    expect(document.querySelector('#s08-godini')).not.toBeNull();
    expect(document.querySelector('#s08-vedomstva')).toBeNull();
    expect(document.querySelector('.page-body')!.textContent).not.toContain(
      'Няма извлечени ведомствени бюджети',
    );
  },
);
it('keeps the glossary source and date without the working-group credit', async () => {
  const { document } = await page('/rechnik');
  const credit = document.querySelector('.s03-credit')!;
  expect(credit.querySelector('[data-src]')).not.toBeNull();
  expect(credit.textContent).not.toContain('Работна група');
});
