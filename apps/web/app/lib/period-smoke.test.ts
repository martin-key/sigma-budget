import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { date } from '../../client/format.js';
import { provideScope } from '../../client/env.js';
import { parse } from '../../client/data.js';
import { requestState, store } from '../../client/store.js';
import { renderScreen } from './screen.server';
import { revExpChart } from '../../client/pages/s13-prognoza.js';
import { render as rankingView } from '../../client/pages/s19-klasacii.js';
import { tableData } from '../../client/ui/table.js';
import { csvFor } from '../../client/share.js';
import { build, frameHtml, resolve } from '../../client/render.js';
const load = async (name: string) =>
  parse(
    name,
    readFileSync(new URL(`../../../../data/release/${name}.json`, import.meta.url), 'utf8'),
  );

async function annualDocument(address: string) {
  const url = new URL(address, 'https://budget.test');
  const r = resolve(address);
  const scope = {
    url,
    origin: url.origin,
    state: requestState(r.query.per),
    data: new Map(),
    load,
  };
  provideScope(() => scope);
  try {
    const vm = await build(r.route, r.params, r.query);
    return parseHTML(String(frameHtml(vm))).document;
  } finally {
    provideScope(() => null);
  }
}

it('does not attach July function notes to the newer annual series', async () => {
  const oldNotes = (await load('expenditure')).functions.notes;
  for (const path of ['/razhodi', '/razhodi/drugi', '/razhodi/obrazovanie']) {
    const document = await annualDocument(path + '?per=2028.forecast');
    const text = document.querySelector('article')?.textContent;
    for (const note of oldNotes) expect(text).not.toContain(note.text);
    expect(text).not.toContain('е програмата от таблицата към проекта');
    expect(document.querySelector('article[data-view="ready"]')).not.toBeNull();
  }
});

for (const per of ['2026.law']) {
  it(`does not relabel the old core debt figure as ${per}`, async () => {
    const document = await annualDocument('/prognoza?per=' + per);
    const debt = [...document.querySelectorAll('#s13-kpis .kpi')].find((tile) =>
      tile.textContent?.includes('Държавен дълг'),
    );
    expect(debt?.querySelector('.kpi-num')?.textContent).toBe('Няма данни');
    expect(debt?.textContent).toContain('Няма съпоставими данни за дълга за избрания период.');
  });
}

it('GDP controls, tiles and publication date follow the same selected record', async () => {
  const current = await annualDocument('/bvp?y=2025&per=2029.forecast');
  expect(current.querySelector('#s31-kpis h2')?.textContent).toContain('2029');
  expect(current.querySelector('.s31-controls input[checked]')?.getAttribute('value')).toBe(
    '2029.forecast',
  );
  expect(current.querySelector('.s31-controls input')?.getAttribute('data-query')).toBe('per');
  const historical = await annualDocument('/bvp?per=2025.report');
  expect(historical.querySelector('#s31-kpis h2')?.textContent).toContain('2025');
  expect(historical.querySelector('#s31-kpis .block-asof')?.textContent).toContain(
    date((await load('outlook')).meta.asOf),
  );
});
for (const path of [
  '/pari',
  '/prihodi',
  '/prihodi/dds',
  '/razhodi',
  '/razhodi/obrazovanie',
  '/prognoza',
  '/bvp',
  '/5-minuti',
  '/vedomstva',
  '/dalg',
  '/zakon',
]) {
  for (const per of [
    '2024.report',
    '2025.report',
    '2026.law',
    '2026.expected',
    '2027.draft',
    '2029.forecast',
  ]) {
    it(`${path} ${per}`, async () => {
      const url = new URL(path + '?per=' + per, 'https://budget.test');
      const scope = { url, origin: url.origin, state: requestState(per), data: new Map(), load };
      provideScope(() => scope);
      try {
        const r = resolve(url.pathname + url.search);
        const vm = await build(r.route, r.params, r.query);
        const text = String(frameHtml(vm));
        expect(text).not.toContain('NaN');
        expect(text).not.toContain('undefined');
        expect(vm.view).not.toBe('error');
      } finally {
        provideScope(() => null);
      }
    });
  }
}

it('chart share columns are apportioned to 100,0 like the lists beside them', async () => {
  for (const [path, list] of [
    ['/razhodi?per=2027.draft', /^s07-map-.+-pie-t$/],
    ['/prihodi?per=2027.draft', /^s06-by-source-t$/],
  ] as const) {
    const url = new URL(path, 'https://budget.test');
    const scope: { maps?: Record<string, Map<string, any>> } & Record<string, unknown> = {
      url,
      origin: url.origin,
      state: requestState('2027.draft'),
      data: new Map(),
      load,
    };
    provideScope(() => scope);
    try {
      const r = resolve(path);
      await build(r.route, r.params, r.query);
      const twins = [...(scope.maps?.table?.entries() || [])].filter(([id]) => list.test(id));
      expect(twins.length, path).toBeGreaterThan(0);
      for (const [id, spec] of twins) {
        const shares = spec.rows
          .map((row: { p: number | null }) => row.p)
          .filter((p: unknown) => p != null);
        const sum = shares.reduce((a: number, p: number) => a + p, 0);
        expect(Math.round(sum * 10) / 10, id).toBe(100);
        for (const p of shares) expect(Math.round(p * 10) / 10, id).toBe(p);
      }
    } finally {
      provideScope(() => null);
    }
  }
});

it('opens a revenue source whatever the case of its id', async () => {
  const lower = await annualDocument('/prihodi/dds');
  const upper = await annualDocument('/prihodi/DDS');
  expect(upper.querySelector('article')?.getAttribute('data-route')).toBe('S06');
  expect(upper.querySelector('h1')?.textContent).toBe(lower.querySelector('h1')?.textContent);
});

it('old pinned annual data stays unavailable instead of borrowing the current release', async () => {
  const url = new URL('https://budget.test/pari?per=2027.draft');
  const names: string[] = [];
  provideScope(() => ({
    url,
    origin: url.origin,
    state: requestState('2027.draft'),
    data: new Map(),
    load: async (name: string) => {
      names.push(name);
      const doc = await load(name);
      if (['outlook', 'revenue', 'expenditure'].includes(name)) delete doc.byPeriod;
      return doc;
    },
  }));
  try {
    const r = resolve('/pari?per=2027.draft');
    const vm = await build(r.route, r.params, r.query);
    const html = String(frameHtml(vm));
    expect(vm.view).toBe('empty');
    expect(html).toContain('Това издание няма този период');
    expect(html).toContain('data-current-release');
    expect(names).not.toContain('releases/current');
  } finally {
    provideScope(() => null);
  }
});

for (const per of ['2026.draft', '2027.forecast', '2028.forecast', 'unknown']) {
  it(`real SSR document exposes the raw-period notice without JavaScript: ${per}`, async () => {
    const url = new URL('https://budget.test/pari?per=' + per);
    const scope = { url, origin: url.origin, state: requestState(per), data: new Map(), load };
    provideScope(() => scope);
    try {
      const result = await renderScreen(url, {
        id: 'a'.repeat(64),
        dataBase: '/data/',
        origin: url.origin,
        sigmaUrl: '',
        feedbackEmail: '',
      });
      expect('redirect' in result).toBe(false);
      if ('doc' in result) {
        expect(result.doc.status).toBe(200);
        expect(result.doc.topbar).toContain('period-notice');
        expect(result.doc.footer).toContain('<nav');
        expect(result.doc.footer).not.toContain('[object Object]');
        expect(result.doc.prerendered).toContain('per=' + per);
      }
    } finally {
      provideScope(() => null);
    }
  });
}

it('law overview explains incomplete spending coverage instead of ranking the few known rows', async () => {
  const url = new URL('https://budget.test/pari?per=2026.law');
  provideScope(() => ({
    url,
    origin: url.origin,
    state: requestState('2026.law'),
    data: new Map(),
    load,
  }));
  try {
    const r = resolve('/pari?per=2026.law');
    const vm = await build(r.route, r.params, r.query);
    const html = String(frameHtml(vm));
    expect(html).toContain('Няма законова функционална разбивка.');
    expect(html).not.toContain('Най-голям дял от разходите отива');
  } finally {
    provideScope(() => null);
  }
});
it('annual CSV preserves published decimal precision and the law/expected distinction', async () => {
  const url = new URL('https://budget.test/prognoza?per=2026.expected');
  provideScope(() => ({
    url,
    origin: url.origin,
    state: requestState('2026.expected'),
    data: new Map(),
    load,
  }));
  try {
    const r = resolve(url.pathname + url.search);
    const vm = await build(r.route, r.params, r.query);
    const table = tableData(revExpChart(vm.ctx).table);
    const csv = csvFor({ table, source: ['budget2027'], period: '2026.expected', unit: 'млн. €' });
    const outlook = await load('outlook');
    for (const [key, label] of [
      ['2026.law', 'Приет закон'],
      ['2026.expected', 'Оценка на МФ, не отчет'],
      ['2027.draft', 'Проект на МФ'],
      ['2029.forecast', 'Прогноза'],
    ]) {
      const cell = outlook.byPeriod[key].series.revenue;
      const row = csv
        .split('\r\n')
        .find(
          (line: string) =>
            line.split(';')[0] === key.slice(0, 4) &&
            line.split(';')[1]?.replace(/^"|"$/g, '') === label,
        );
      expect(row?.split(';')[2].replace(/^"|"$/g, '')).toBe(String(cell.value).replace('.', ','));
    }
    expect(csv).toContain(';2026.expected;млн. €;');
    expect(csv).not.toContain('NaN');
  } finally {
    provideScope(() => null);
  }
});

it('unavailable annual blocks carry reasons without invented pending IDs or statistic share actions', async () => {
  for (const path of ['/prognoza', '/bvp']) {
    const url = new URL(path + '?per=2026.law', 'https://budget.test');
    provideScope(() => ({
      url,
      origin: url.origin,
      state: requestState('2026.law'),
      data: new Map(),
      load,
    }));
    try {
      const r = resolve(url.pathname + url.search);
      const vm = await build(r.route, r.params, r.query);
      const html = String(frameHtml(vm));
      expect(html).not.toContain('data-pending-id="s13-debt-pending"');
      expect(html).not.toContain('имаме само едно число');
      expect(html).not.toContain('data-share="' + r.route.id.toLowerCase() + '-annual-coverage"');
      expect(html).toContain('Няма законова макропрогноза.');
    } finally {
      provideScope(() => null);
    }
  }
});

for (const [per, attribution] of [
  ['2026.law', 'Приет закон за 2026 г.'],
  ['2026.expected', 'Очаквано изпълнение за 2026 г.'],
  ['2027.draft', 'Проект за 2027 г.'],
  ['2028.forecast', 'Прогноза за 2028 г.'],
  ['2029.forecast', 'Прогноза за 2029 г.'],
  ['2024.report', 'Отчетни данни за 2024 г.'],
  ['2025.report', 'Отчетни данни за 2025 г.'],
]) {
  for (const [path, selector] of [
    ['/prognoza', '#s13-sum'],
    ['/prihodi', '#s06-notes'],
    ['/razhodi', '#s07-notes'],
    ['/razhodi?po=vid', '#s07-notes'],
  ]) {
    it(`attributes ${path} to the selected ${per} record`, async () => {
      const document = await annualDocument(`${path}${path.includes('?') ? '&' : '?'}per=${per}`);
      const text = document.querySelector(
        per === '2026.law' && path !== '/prognoza'
          ? `${path === '/prihodi' ? '#s06' : '#s07'}-annual-coverage`
          : selector,
      )?.textContent;
      expect(text).toContain(attribution);
      expect(text).not.toContain('Приетият закон може да се различава от проекта');
      expect(document.querySelector('article')?.textContent).not.toContain(
        'Приетият закон може да се различава от проекта',
      );
      if (!per.endsWith('report')) expect(text).toContain('06.11.2026');
    });
  }
  it(`discloses the frozen sector snapshot beside figures for ${per}`, async () => {
    const document = await annualDocument(`/bvp?per=${per}`);
    const sector = document.querySelector('#s31-b-sectors');
    expect(sector?.textContent).toContain('замразена снимка');
    expect(sector?.textContent).toContain('Има по-късни ревизии');
    expect(sector?.textContent).toContain('част от историческите оригинали липсват');
    expect(sector?.textContent).toContain('Версия на източника: 07.10.2026');
    expect(sector?.textContent).toContain('Придобиване: 09.10.2026');
    const link = [...(sector?.querySelectorAll('a') ?? [])].find(
      (a) => a.textContent?.trim() === 'Ограничения на изданието',
    );
    expect(link?.getAttribute('href')).toBe('/proverka?to=s35-coverage');
  });
}
it('scopes the displayed catalogue note without mutating its release', async () => {
  const originalCatalog = structuredClone(await load('catalog'));
  const document = await annualDocument('/danni');
  const note = document.querySelector('.s24-item[data-id="two-versions"]');
  for (const phrase of [
    'само за старите масиви към проекта за 2026',
    '2026.expected е очаквано изпълнение',
    '2027.draft е проект',
    '2028.forecast и 2029.forecast са прогнози',
    'Табл. III-1 (стр. 73)',
    'Приложение 3 (стр. 191–192)',
  ])
    expect(note?.textContent).toContain(phrase);
  expect(await load('catalog')).toEqual(originalCatalog);
});

for (const per of [
  '2024.report',
  '2025.report',
  '2026.law',
  '2026.expected',
  '2027.draft',
  '2028.forecast',
  '2029.forecast',
]) {
  for (const path of [
    ...[
      'dds',
      'osiguritelni',
      'nedanachni',
      'pomoshti',
      'ddfl',
      'akcizi',
      'korporativen',
      'drugi',
    ].map((id) => '/prihodi/' + id),
    ...[
      'obshti-sluzhbi',
      'otbrana-sigurnost',
      'obrazovanie',
      'zdraveopazvane',
      'sotsialni',
      'zhilishtno-sreda',
      'kultura-sport',
      'ikonomika',
      'drugi',
    ].map((id) => '/razhodi/' + id),
    '/vedomstva',
    '/vedomstvo/0200',
    '/vedomstvo/0200/0200.01.00',
    '/vedomstvo/0200/0200.01.01',
  ]) {
    it(`detail source and warning follow the record: ${path} ${per}`, async () => {
      const document = await annualDocument(`${path}?per=${per}`);
      const article = document.querySelector('article');
      expect(article).not.toBeNull();
      expect(article?.getAttribute('data-view')).not.toBe('error');
      expect(article?.textContent).not.toContain('Приетият закон може да се различава от проекта');
      expect(article?.textContent).not.toContain('Числата са от мотивите към проекта на бюджета');
      if (path.startsWith('/razhodi/') || path.startsWith('/prihodi/')) {
        const text = document.querySelector(
          per === '2026.law'
            ? '[id$="-annual-coverage"]'
            : path.startsWith('/razhodi/')
              ? '#s08-notes'
              : '#s06-notes',
        )?.textContent;
        expect(text).toContain(
          per.endsWith('report')
            ? `Отчетни данни за ${per.slice(0, 4)}`
            : per.endsWith('law')
              ? 'Приет закон за 2026'
              : per.endsWith('expected')
                ? 'Очаквано изпълнение за 2026'
                : per.endsWith('draft')
                  ? 'Проект за 2027'
                  : `Прогноза за ${per.slice(0, 4)}`,
        );
        if (!per.endsWith('report') && !per.endsWith('law')) {
          const doc = await load(path.startsWith('/razhodi/') ? 'expenditure' : 'revenue');
          const p = doc.byPeriod[per];
          const normalize = (text: string) =>
            text
              .toLowerCase()
              .replace(/^р-ди/, 'разходи')
              .replace(/[^а-яa-z0-9]/g, '');
          const name = doc.functions?.items.find((f: any) => f.id === path.split('/').at(-1))?.name;
          const cell = path.startsWith('/razhodi/')
            ? p.functions.find((f: any) => normalize(f.label) === normalize(name)).cell
            : p.rows[0].cell;
          const entry = (await load('budget2027-provenance')).entries[cell.provenance];
          expect(entry.period).toBe(per);
          expect(text).toContain(path.startsWith('/razhodi/') ? 'Табл. III-1' : 'Приложение 3');
          expect(text).toContain(`стр. ${entry.page}`);
        }
      }
    });
  }
  for (const po of ['funkcii', 'vid']) {
    if (per.endsWith('report') || per.endsWith('law')) continue;
    it(`overview sources resolve both displayed expenditure sections: ${per} ${po}`, async () => {
      const document = await annualDocument(`/razhodi?per=${per}&po=${po}`);
      const p = (await load('expenditure')).byPeriod[per];
      const entries = (await load('budget2027-provenance')).entries;
      const note = document.querySelector('#s07-notes')?.textContent;
      expect(note).toContain(
        `По функции: Табл. III-1, стр. ${entries[p.functions[0].cell.provenance].page}`,
      );
      expect(note).toContain(
        `По икономически вид: Приложение 3, стр. ${entries[p.rows[0].cell.provenance].page}`,
      );
    });
  }
}

it.each(['2024.report', '2027.draft'])('names the KFP revenue scope for %s', async (per) => {
  const document = await annualDocument('/prihodi?per=' + per);
  expect(document.querySelector('article')!.textContent).toMatch(/приходи(те)? по КФП/i);
  expect(document.querySelector('article')!.textContent).not.toMatch(
    /приходите на държавата|Държавата планира да събере/,
  );
});

it('names the KFP scope in the forecast and short overview', async () => {
  const forecast = await annualDocument('/prognoza?per=2027.draft');
  expect(forecast.getElementById('s13-b-rev-exp')!.textContent).toContain(
    'Приходите и разходите по консолидираната фискална програма по години.',
  );
  const overview = await annualDocument('/5-minuti?per=2027.draft');
  expect(overview.getElementById('s04-scene1')!.textContent).toContain(
    'по КФП са планирани приходи от',
  );
  expect(overview.getElementById('s04-scene1')!.textContent).toContain(
    'разходите по КФП са по-големи от приходите',
  );
});

it.each([
  ['2024.report', 'През 2024 г. приходите по КФП са', 'През 2024 г. разходите по КФП са'],
  [
    '2025.report',
    'Според предварителния отчет приходите по КФП през 2025 г. са',
    'Според предварителния отчет разходите по КФП през 2025 г. са',
  ],
  [
    '2026.law',
    'Според разчетите към закона за 2026 г. приходите по КФП са',
    'Според разчетите към закона за 2026 г. разходите по КФП са',
  ],
  [
    '2026.expected',
    'Очакваните приходи по КФП през 2026 г. са',
    'Очакваните разходи по КФП през 2026 г. са',
  ],
  [
    '2027.draft',
    'Според разчетите към законопроекта за 2027 г. приходите по КФП са',
    'Според разчетите към законопроекта за 2027 г. разходите по КФП са',
  ],
  [
    '2028.forecast',
    'Прогнозните приходи по КФП през 2028 г. са',
    'Прогнозните разходи по КФП през 2028 г. са',
  ],
  [
    '2029.forecast',
    'Прогнозните приходи по КФП през 2029 г. са',
    'Прогнозните разходи по КФП през 2029 г. са',
  ],
])(
  'states the publication status of revenue and expenditure in the lede for %s',
  async (per, revenue, expenditure) => {
    for (const [path, expected] of [
      ['/prihodi', revenue],
      ['/razhodi', expenditure],
    ]) {
      const document = await annualDocument(path + '?per=' + per);
      expect(document.querySelector('.lede')!.textContent!.replace(/\s+/g, ' ')).toContain(
        expected,
      );
    }
  },
);

it.each([
  ['2026.expected', 'Очакваните разходи по КФП'],
  [
    '2027.draft',
    'Според разчетите към законопроекта за 2027\u00a0г. разходите по КФП за образование са',
  ],
  ['2028.forecast', 'Прогнозните разходи по КФП'],
])('states the function expenditure status for %s', async (per, expected) => {
  const document = await annualDocument('/razhodi/obrazovanie?per=' + per);
  expect(document.querySelector('.lede')!.textContent).toContain(expected);
});

it('uses KFP in the beginner glossary link, share sentence and deficit explanations', async () => {
  const document = await annualDocument('/5-minuti?per=2027.draft');
  expect(document.querySelector('#s04-scene1 .s04-text a[data-gl="kfp"]')!.textContent).toBe('КФП');
  const forecast = await annualDocument('/prognoza?per=2027.draft');
  expect(forecast.getElementById('s13-b-deficit')!.textContent).toContain(
    'Дефицитът по КФП: превишението на разходите над приходите по години.',
  );
  // /klasacii redirects to /razhodi; exercise the preserved module directly.
  const ranking = parseHTML(
    String(
      rankingView({
        data: { outlook: await load('outlook') },
        core: await load('core'),
        store,
        period: { year: 2026 },
        query: { tab: 'godini', kat: 'kfp', a: '2025', b: '2026' },
        href: () => '/',
      }),
    ),
  ).document;
  expect(ranking.getElementById('s19-b-godini')!.textContent).toContain(
    'Салдо с минус е дефицит: разходите по КФП са по-големи от приходите.',
  );
  const debt = await annualDocument('/dalg?per=2026.law');
  expect(debt.querySelector('article')!.textContent).toContain(
    'Когато разходите по КФП са по-големи от приходите',
  );
});
