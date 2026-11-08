import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { provideScope } from '../../client/env.js';
import { parse } from '../../client/data.js';
import { requestState } from '../../client/store.js';
import { renderScreen } from './screen.server';
import { revExpChart } from '../../client/pages/s13-prognoza.js';
import { tableData } from '../../client/ui/table.js';
import { csvFor } from '../../client/share.js';
import { build, frameHtml, resolve } from '../../client/render.js';
const load = async (name: string) =>
  parse(
    name,
    readFileSync(new URL(`../../../../data/release/${name}.json`, import.meta.url), 'utf8'),
  );
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
  const url = new URL('https://budget.test/pari');
  provideScope(() => ({ url, origin: url.origin, state: requestState(), data: new Map(), load }));
  try {
    const r = resolve('/pari');
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
    const url = new URL(path, 'https://budget.test');
    provideScope(() => ({ url, origin: url.origin, state: requestState(), data: new Map(), load }));
    try {
      const r = resolve(path);
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
