import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import historical from './__fixtures__/execution-851e90f.json';
import { parse } from '../../client/data.js';
import { execModel, planBasis } from '../../client/exec.js';
import { planBlock, planModel, planCsv } from '../../client/ui/plan.js';
import { provideScope } from '../../client/env.js';
import * as share from '../../client/share.js';
import { model, summaryBlock } from '../../client/pages/s16-novo.js';

const current = readFileSync(
  new URL('../../../../data/release/execution.json', import.meta.url),
  'utf8',
);
afterEach(() => {
  provideScope(() => null);
  share.reset(null);
});

for (const ssr of [false, true]) {
  it(`preserves the 851e90f draft values, labels, sources and CSV headers (SSR=${ssr})`, () => {
    if (ssr) provideScope(() => scope);
    const scope = {
      origin: 'https://budget.test',
      url: new URL('https://budget.test/'),
      state: {},
      maps: {},
    };
    const ex = parse('execution', JSON.stringify(historical));
    const C = execModel(ex);
    const rendered = String(planBlock(C));
    const capex = planModel(C)!.rows.find((r) => r.id === 'exp.capex')!;
    expect(capex.plan).toBe(9360.6);
    expect(capex.share).toBe(46.89);
    expect(rendered).toContain('Отчет спрямо проект');
    expect(rendered).toContain('9,36');
    expect(rendered).toContain('46,9');
    expect(rendered).toContain('приложение 3');
    expect(rendered).toContain('data-src="kfp,asbp"');
    expect(rendered).not.toContain('Отчет спрямо закон');
    expect(rendered).not.toContain('приложение 1');
    const csv = planCsv(planModel(C)!);
    expect(csv.columns[2]).toBe('План за 2026 г., млрд. €');
    expect(csv.rows[2][2]).toBe(9.3606);
    expect(share.get('s15-b-plan')!.source).toEqual(['kfp', 'asbp']);
  });
  it(`renders the adopted law only with both metadata fields (SSR=${ssr})`, () => {
    const scope = {
      origin: 'https://budget.test',
      url: new URL('https://budget.test/'),
      state: {},
      maps: {},
    };
    if (ssr) provideScope(() => scope);
    const ex = parse('execution', current);
    const C = execModel(ex);
    expect(String(planBlock(C))).toContain('Отчет спрямо закон');
    expect(String(planBlock(C))).toContain('Програма по ЗДБРБ 2026, МФ, приложение 1');
    expect(planModel(C)!.rows[2].plan).toBe(9408.1);
    expect(planModel(C)!.rows[2].share).toBe(46.66);
    expect(String(planBlock(C))).toContain('9,41');
    expect(planCsv(planModel(C)!).columns[2]).toBe('План по ЗДБРБ 2026, млн. €');
    expect(planCsv(planModel(C)!).rows[2][2]).toBe('9408.1');
    for (const missing of ['periodKey', 'basis']) {
      const sparse = structuredClone(ex);
      delete sparse.plan2026[missing];
      expect(planBasis(sparse).adopted).toBe(false);
    }
  });
}

it('carries the feed denominator citation and sources into the summary and shared text', () => {
  const citation = 'Програма по ЗДБРБ 2026, МФ, приложение 1';
  const ctx = {
    data: {
      feed: {
        highlights: {
          asOf: '2026-09-30',
          month: 9,
          capexPctPlan: 46.66,
          planBasis: { citation, source: ['budget2027'] },
        },
      },
    },
    query: {},
    href: () => '/izpalnenie',
  };
  expect(String(summaryBlock(model(ctx)))).toContain(citation);
  const spec = share.get('s16-b-summary')!;
  expect(spec.text).toContain(citation);
  expect(spec.source).toEqual(['kfp', 'budget2027']);
});
