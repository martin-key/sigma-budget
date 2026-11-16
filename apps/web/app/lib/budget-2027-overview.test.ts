import { afterEach, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { provideScope } from '../../client/env.js';
import { parse } from '../../client/data.js';
import { requestState } from '../../client/store.js';
import { build, frameHtml, resolve } from '../../client/render.js';
import { tableData } from '../../client/ui/table.js';
import { selectPeriod } from '../../client/periods.js';
import { INDICATORS, CAPEX_YEARS } from '../../client/budget-2027-compare.js';
import { num, date, plural } from '../../client/format.js';
import { chartSpec } from '../../client/ui/chart.js';
import { comparison, cellOf, gdpOf, COMPARE } from '../../client/budget-2027-compare.js';
import { measureText } from '../../client/measures-2027.js';

const read = (path: string) =>
  readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8');
const release = (name: string) => parse(name, read(`data/release/${name}.json`));
// Independent expected values: the pinned extraction of the АСБП 2027–2029 motives, not the presentation adapter.
const forecast = JSON.parse(read('data/inputs/budget_forecast_2027.json'));
const annex3 = (label: string) =>
  forecast.tables.annex3_mln.rows.find((r: any) => r.label === label).values;
const doc = release('budget2027');
const texts = existsSync(new URL('../../../../data/release/measures2027.json', import.meta.url))
  ? release('measures2027')
  : JSON.parse(read('data/inputs/measures_2027.json'));
const { MEASURES_2027 } = texts;

afterEach(() => provideScope(() => null));
async function page(address: string, overrides: Record<string, any> = {}) {
  const url = new URL(address, 'https://budget.test');
  const r = resolve(address);
  const scope = {
    url,
    origin: url.origin,
    state: requestState(r.query.per),
    data: new Map(),
    maps: {} as Record<string, Map<string, any>>,
    load: async (name: string) =>
      overrides[name] ?? (name === 'measures2027' ? texts : release(name)),
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
  const articles = Object.keys(doc.budgets.bill)
    .map(Number)
    .filter((a) => a >= 2)
    .sort((a, b) => a - b);
  expect(document.getElementById('b27-kapitalovi')!.textContent).toContain(
    `(чл. ${articles[0]}–${articles.at(-1)})`,
  );
  // a sentence that ends with a year does not get a second full stop after „г.“
  expect(html).not.toMatch(/г\.\./);
  const order = [
    'b27-nakratko',
    'b27-sravnenie',
    'b27-kapitalovi',
    's34-projects',
    'b27-razhodi',
    'b27-vedomstva',
    'b27-more',
  ];
  const found = order.map((id) => document.getElementById(id));
  order.forEach((id, i) => expect(found[i], id).not.toBeNull());
  // headline figures first, then the comparison, the capital expenditure and the links last
  for (let i = 1; i < found.length; i++)
    expect(found[i - 1]!.compareDocumentPosition(found[i]!) & 4, order[i]).toBe(4);
  // the blocks that other screens own are links now, not copies
  for (const id of ['b27-prihodi', 'b27-merki', 'b27-obshtini', 'b27-dalg', 's34-bill'])
    expect(document.getElementById(id), id).toBeNull();
  expect(document.querySelectorAll('#b27-nakratko .kpi')).toHaveLength(6);
  const table = tableData(scope.maps.table.get('b27-sravnenie-table'));
  expect(table.rows).toHaveLength(19);
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

it('leads to the screens that own the rest of the draft and keeps the 2027 period', async () => {
  const { document } = await page('/byudzhet-2027');
  const links = [...document.querySelectorAll('#b27-more a.link-card')].map((a) =>
    a.getAttribute('href'),
  );
  for (const path of ['/prihodi', '/merki', '/vedomstva', '/obshtini', '/dalg', '/prognoza']) {
    const href = links.find((h) => h?.split('?')[0].endsWith(path));
    expect(href, path).toBeTruthy();
    expect(new URL(href!, 'https://budget.test').searchParams.get('per'), path).toBe('2027.draft');
  }
  // article 1 line by line, the Council of Ministers variant and the October plan stay reachable
  expect(links.some((h) => /\/vedomstvo\/art1\?/.test(h || ''))).toBe(true);
  expect(links.some((h) => /variant=billMc/.test(h || ''))).toBe(true);
  expect(links.some((h) => /dokument=plan/.test(h || ''))).toBe(true);
  // one or two figures of the draft in a card, read from the release: the printed sums of the measures
  const total = (t: string) =>
    doc.forecast[t].find((r: any) => r.label === 'Общо:').cells['0'].value as number;
  const measures = [...document.querySelectorAll('#b27-more a.link-card')].find((a) =>
    a.getAttribute('href')?.includes('/merki'),
  )!;
  const sign = (v: number) => num(v, 1, { sign: true });
  expect(measures.textContent).toContain(sign(total('II_7')));
  expect(measures.textContent).toContain(sign(total('II_8')));
});

it.each([
  'b27-nakratko',
  'b27-sravnenie',
  'b27-kapitalovi',
  'b27-razhodi',
  'b27-vedomstva',
  'b27-more',
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
      expect(measureText(texts, table, i, r.label), r.label).not.toBeNull(),
    );
  }
  // a row that is not the same any more keeps its printed label and no title
  expect(measureText(texts, 'II_7', 0, 'Друга мярка')).toBeNull();
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

it('compares the institutions as paired bars with the amount and the change', async () => {
  const { document } = await page('/byudzhet-2027');
  const fig = document.getElementById('b27-vedomstva-fig')!;
  const pairs = [...fig.querySelectorAll('.b27-pair')];
  expect(pairs).toHaveLength(15);
  const widths: number[] = [];
  for (const pair of pairs) {
    expect(pair.querySelector('.b27-pair-name a')?.getAttribute('href')).toMatch(/\d/);
    const values = pair.querySelectorAll('.b27-pair-v');
    expect(values).toHaveLength(2);
    expect(pair.querySelector('.b27-pair-pct')?.textContent).toMatch(/[+−]?\d+\s*%|—/);
    for (const f of pair.querySelectorAll('.b27-pair-fill'))
      widths.push(Number(/--w:([\d.]+)/.exec(f.getAttribute('style') || '')?.[1]));
  }
  expect(Math.max(...widths)).toBe(100);
  expect(widths.every((w) => w >= 0 && w <= 100)).toBe(true);
  // ordered by the 2027 amount, the exact values stay in the folded table
  const now = pairs.map((p) =>
    Number(p.querySelectorAll('.b27-pair-v')[1].lastChild!.textContent!.replace(/\D/g, '')),
  );
  expect(now).toEqual([...now].sort((a, b) => b - a));
  expect(document.querySelector('#b27-vedomstva-d #b27-vedomstva-table')).not.toBeNull();
});

it('explains the GDP vintages, preliminary report and capital expenditure scope', async () => {
  const data = Object.fromEntries(
    ['outlook', 'revenue', 'expenditure'].map((n) => [n, release(n)]),
  );
  // The July report column and November Annex 3 keep their own GDP denominators.
  expect(gdpOf(data, '2025.report')).toBe(116018.3);
  expect(gdpOf(data, '2026.expected')).toBe(130458.5);
  expect(gdpOf(data, '2027.draft')).toBe(141301.8);
  for (const key of COMPARE) {
    const cell = cellOf(data, 'exp.capex', key)!;
    expect(cell.pctGdp).toBeCloseTo(Math.round((cell.value / gdpOf(data, key)!) * 1000) / 10, 1);
  }
  expect(cellOf(data, 'exp.capex', '2025.report')?.vintage).toBe('prelim');
  const { document, scope } = await page('/byudzhet-2027');
  const text = document.getElementById('b27-sravnenie')!.textContent!.replace(/\s+/g, ' ');
  expect(text).toContain('за три години: предварителен отчет, очаквано изпълнение и законопроект');
  expect(text).toContain(
    `Дяловете от БВП за 2025 г. са спрямо БВП от „${release('core').sources.asbp.title}“`,
  );
  expect(text).toContain(
    `за 2026 г. и 2027 г. — спрямо БВП от „${release('core').sources.budget2027.title}“ от 06.11.2026 г.`,
  );
  expect(text).toContain(
    `В разчетите към закона редът „Капиталови“ е 9 408,1 млн. € и включва нетния прираст на държавния резерв. В Приложение 3 на „${release('core').sources.budget2027.title}“ прирастът е в отделен ред „Прираст на държавния резерв и изкупуване на земеделска продукция“, а капиталовите разходи в очакваното изпълнение са 9 360,6 млн. €.`,
  );
  expect(text).toContain('Според разчетите към закона за 2026 г. ');
  expect(text).not.toContain('По приетия закон');
  expect(tableData(scope.maps.table.get('b27-sravnenie-table')).columns[1]).toContain(
    'предв. отчет',
  );
  const series = chartSpec('b27-kapitalovi-fig').series;
  expect(series[0].name).toBe('2024 · отчет');
  expect(series[1].name).toBe('2025 · предварителен отчет');
  expect(series[0].data).toEqual([
    cellOf(data, 'exp.capex', '2024.report')!.value,
    null,
    null,
    null,
    null,
    null,
  ]);
  expect(series[1].data).toEqual([
    null,
    cellOf(data, 'exp.capex', '2025.report')!.value,
    null,
    null,
    null,
    null,
  ]);
});

it('uses the motives terms for the measures and explains the law grouping', async () => {
  const { document } = await page('/merki?per=2027.draft&spisak=zakoni');
  const text = (id: string, selector: string) =>
    document.querySelector(`#m27-${id} ${selector}`)!.textContent;
  expect(text('optimizaciya-10', '.s12-name')).toBe(
    'Целогодишен размер на оптимизацията с 10% на разходите за персонал',
  );
  expect(text('telk', '.s12-text')).toBe(
    'Подобряване на ефективността на механизмите за оценка и контрол при определяне на правото на достъп до лична помощ по Закона за личната помощ.',
  );
  expect(text('akciz-gaz', '.s12-name')).toBe(
    'Ефект от нулевата ставка на акциза за втечнен нефтен газ (LPG) и природен газ, прилагана за периода 1 октомври – 31 декември 2026 г.',
  );
  expect(text('akciz-zemedelie', '.s12-name')).toBe(
    'Ефект от еднократната допълнителна отстъпка за 2026 г. от акциза върху газьола в първичното селскостопанско производство',
  );
  expect(document.querySelector('article')!.textContent).not.toMatch(
    /По-строга|по-строг контрол|Съкращението с|пропан-бутан|Краят на/,
  );
  const tab = document.querySelector('[role="tab"][data-key="zakoni"]')!;
  expect(tab.textContent).toMatch(/^Мерки по закони \d+ закона$/);
  expect(tab.getAttribute('aria-selected')).toBe('true');
  const group = document.getElementById('s12-27-zakoni')!;
  expect(group.querySelector('h2')!.textContent).toBe('Мерки по закони');
  expect(group.textContent).toContain(
    'Мерките от таблици II-7 и II-8 са подредени по закона, когато мотивите посочват такъв. За 19 мерки мотивите не посочват закон и те не са включени тук.',
  );
  expect(group.querySelectorAll('.m27-law')).toHaveLength(
    Number(tab.querySelector('.tab-count')!.textContent!.split(' ')[0]),
  );
  // This is an index of the same cards, including the revised titles.
  for (const link of group.querySelectorAll('a')) {
    const anchor = new URL(link.getAttribute('href')!, 'https://budget.test').searchParams.get(
      'to',
    );
    expect(link.textContent).toBe(document.querySelector(`#${anchor} .s12-name`)!.textContent);
  }
  const old = await page('/merki?per=2026.law');
  expect(old.document.querySelector('article')!.textContent).toContain('Промени в други закони');
  expect(old.document.querySelector('article')!.textContent).not.toContain('Мерки по закони');
});

it('takes the report status, document names and publication date from the selected data', async () => {
  const core = release('core');
  core.sources.asbp.title = 'Предходна прогноза Тест';
  core.sources.budget2027.title = 'Текуща прогноза Тест';
  const outlook = release('outlook');
  outlook.vintage[outlook.years.indexOf(2025)] = 'actual';
  const budget2027 = release('budget2027');
  budget2027.publication = '2026-11-07';
  const { document } = await page('/byudzhet-2027', { core, outlook, budget2027 });
  const text = document.getElementById('b27-sravnenie')!.textContent!.replace(/\s+/g, ' ');
  expect(text).toContain('за три години: отчет, очаквано изпълнение и законопроект');
  expect(text).toContain('Числата за 2025 г. са отчет от „Предходна прогноза Тест“.');
  expect(text).toContain('Дяловете от БВП за 2025 г. са спрямо БВП от „Предходна прогноза Тест“');
  expect(text).toContain('спрямо БВП от „Текуща прогноза Тест“ от 07.11.2026 г.');
  expect(text).not.toMatch(/предварителен отчет|юлска|ноемврийска|АСБП 2026–2028|АСБП 2027–2029/);
});

it.each([
  ['akciz-tyutyun', 'Изпреварващо изпълнение на акцизния календар за тютюневите изделия'],
  [
    'dds-tyutyun',
    'Приходи от ДДС, произтичащи от изпреварващото изпълнение на акцизния календар за тютюневите изделия',
  ],
  ['sabiraemost-dds', 'Повишаване на събираемостта на ДДС'],
  ['sabiraemost-kd-ddfl', 'Повишаване на събираемостта на корпоративния данък и ДДФЛ'],
  [
    'danak-imoti',
    'Поетапно увеличение на базисната данъчна стойност при данъка върху недвижимите имоти',
  ],
  ['telk', 'Реформа в ТЕЛК: оценка и контрол при определяне на правото на достъп до лична помощ'],
])('uses the source terminology in the title and law-index link of %s', async (id, expected) => {
  const { document } = await page('/merki?per=2027.draft');
  expect(document.querySelector(`#m27-${id} .s12-name`)!.textContent).toBe(expected);
  const link = document.querySelector(`#s12-27-zakoni a[href*="to=m27-${id}"]`);
  if (id !== 'danak-imoti') expect(link?.textContent).toBe(expected);
});

it('states the aim of health financing measures and quotes the expenditure-group term', async () => {
  const { document } = await page('/merki?per=2027.draft&spisak=razhodni');
  expect(document.querySelector('#m27-zdraveopazvane .s12-text')!.textContent).toBe(
    'Мерки за оптимизиране на публичното финансиране на здравните дейности, насочени към подобряване на координацията, планирането и контрола върху разходите.',
  );
  expect(document.querySelector('#s12-II_8')!.textContent).toContain(
    'Мерки за оптимизиране на разходите за персонал и за повишаване на ефективността на публичните разходи.',
  );
});

it('shares the beginner revenue and expenditure sentence with its KFP scope', async () => {
  const { scope } = await page('/5-minuti?per=2027.draft');
  const text = scope.maps.share.get('s04-scene1').text.replace(/\s+/g, ' ');
  expect(text).toBe(
    'През 2027 г. по КФП са планирани приходи от 51,1 млрд. € и разходи от 56,0 млрд. €; разликата е дефицит от 4,9 млрд. €.',
  );
});

it('preserves every comparison cell from the release through the shared annual projection', () => {
  const data = Object.fromEntries(
    ['outlook', 'revenue', 'expenditure'].map((n) => [n, release(n)]),
  );
  for (const it of INDICATORS)
    for (const key of CAPEX_YEARS) {
      const dataset = data[it.file];
      const rec = selectPeriod(dataset, key);
      const cell = cellOf(data, it.id, key)!;
      if (it.series) {
        const source = rec.legacy ? dataset.kfp[it.series] : null;
        expect(cell.value).toBe(rec.legacy ? source.mln[rec.column] : rec.series[it.series].value);
        expect(cell.pctGdp).toBe(
          rec.legacy ? source.pctGdp[rec.column] : rec.printedPctGdp[it.series].value,
        );
      } else {
        const rows = dataset.economic?.rows || dataset.rows;
        const row = rows.find((r: any) => r.id === it.legacy);
        const source = rec.legacy ? row : rec.rows.find((r: any) => r.label === row.label);
        expect(cell.value).toBe(rec.legacy ? source.mln[rec.column] : source.cell.value);
        expect(cell.pctGdp).toBe(
          rec.legacy ? source.pctGdp[rec.column] : source.printedPctGdp.value,
        );
        if (!rec.legacy) expect(cell.provenance).toBe(source.cell.provenance);
      }
      if (rec.legacy) expect(cell.vintage).toBe(rec.vintage);
    }
});

it.each([1, 2])('derives dates and plural counts for %s records', async (count) => {
  const budget2027 = release('budget2027');
  const dbp2027 = release('dbp2027');
  budget2027.publication = '2026-11-08';
  dbp2027.doc.date = '2026-10-16';
  dbp2027.meta.retrieved = '2026-10-18';
  const council = dbp2027.edp.steps.find(
    (s: any) => s.src === 'ec-edp-bg' && s.title.startsWith('Съветът'),
  );
  council.d = '2026-07-11';
  council.text = council.text.replace(/Решение \(ЕС\) \d+\/\d+/, 'Решение (ЕС) 2026/9999');
  const deadline = dbp2027.edp.steps.find((s: any) => s.src === 'plan' && s.p === 6);
  deadline.d = '2026-10-17';
  const article1 = budget2027.budgets.bill[1];
  budget2027.budgets.bill = Object.fromEntries(
    Object.entries(budget2027.budgets.bill)
      .filter(([a]) => Number(a) >= 2)
      .slice(0, count)
      .map(([, b], i) => [60 + i, b]),
  );
  budget2027.budgets.bill[1] = article1;
  budget2027.municipal.art52 = budget2027.municipal.art52.slice(0, count);
  budget2027.projects = budget2027.projects.slice(0, count);
  for (const t of ['II_7', 'II_8'])
    budget2027.forecast[t] = budget2027.forecast[t]
      .filter((r: any) => r.label !== 'Общо:')
      .slice(0, count)
      .concat(budget2027.forecast[t].filter((r: any) => r.label === 'Общо:'));
  const overrides = { budget2027, dbp2027 };
  const overview = await page('/byudzhet-2027', overrides);
  expect(overview.vm.lede).toContain(date(budget2027.publication));
  expect(String(overview.vm.context)).toContain(date(budget2027.publication));
  const text = overview.document.querySelector('article')!.textContent!;
  expect(text).toContain(`МФ, ${date(budget2027.publication)}.`);
  expect(text).toContain(`От ${date(dbp2027.doc.date)}, по ЕСС 2010.`);
  expect(text).toContain(plural(count, 'бюджет', 'бюджета'));
  expect(text).toContain(plural(count, 'община', 'общини'));
  expect(text).toContain(plural(count, 'проект', 'проекта'));
  const measures = await page('/merki?per=2027.draft', overrides);
  expect(measures.document.getElementById('s12-27-stage')!.textContent).toContain(
    date(budget2027.publication),
  );
  for (const t of ['II_7', 'II_8'])
    expect(measures.document.getElementById(`s12-${t}`)!.textContent).toContain(
      plural(count, 'мярка', 'мерки'),
    );
  const plan = await page('/byudzhet-2027?dokument=plan', overrides);
  expect(plan.vm.title).toContain(date(dbp2027.doc.date));
  expect(plan.document.getElementById('s34-ne-potvardeno')!.textContent).toContain(
    council.text.match(/Решение \(ЕС\) (\d+\/\d+)/)[1],
  );
  expect(plan.document.getElementById('s34-ne-potvardeno')!.textContent).toContain(
    date(dbp2027.meta.retrieved),
  );
  expect(plan.document.getElementById('s34-sp1')!.textContent).toContain(
    'Препоръка 1 към България от 10.07.2026 г.',
  );
  expect(plan.document.getElementById('s34-ne-potvardeno')!.textContent).toContain(
    date(deadline.d),
  );
  expect(plan.document.getElementById('s34-ne-potvardeno')!.textContent).toContain(date(council.d));
  expect(plan.html).toContain('запазват стимулите за икономии на енергия');
  expect(plan.html).toContain('Да предприеме мерки за справяне със сивата икономика');
  expect(plan.html).toContain('Да засили събирането на данъци');
  expect(plan.document.getElementById('s34-lipsva')!.textContent).toContain(date(dbp2027.doc.date));
});

it('names the unclassified function in its lede and explains the law data gap per function', async () => {
  const name = release('expenditure').functions.items.find((r: any) => r.id === 'drugi').name;
  const draft = await page('/razhodi/drugi?per=2027.draft');
  expect(draft.vm.lede).toContain(`функция „${name}“`);
  expect(draft.vm.lede).not.toContain('Разходите, които не се вписват в другите функции.');
  const law = await page('/razhodi/drugi?per=2026.law');
  expect(law.vm.lede?.replace(/\s/g, ' ')).toBe(
    'За 2026 г. няма разбивка по функции в избрания запис. Разходите, които не се вписват в другите функции.',
  );
});

it('finds the Council decision number in the current release step', async () => {
  const council = release('dbp2027').edp.steps.find(
    (s: any) => s.src === 'ec-edp-bg' && s.title.startsWith('Съветът'),
  );
  const number = council.text.match(/Решение \(ЕС\) (\d+\/\d+)/)?.[1];
  expect(number).toBe('2026/1758');
  const plan = await page('/byudzhet-2027?dokument=plan');
  expect(plan.document.getElementById('s34-ne-potvardeno')!.textContent).toContain(
    `Номерът на решението (${number})`,
  );
});
