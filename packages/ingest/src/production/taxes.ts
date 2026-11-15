import consolidationDifferences from './taxes-consolidation-differences.json' with { type: 'json' };
import { RESOLVED_PENDING } from './supplements.js';
import { join } from 'node:path';
import { metadata } from '../common/metadata.js';
import type { ExecutionContext } from '../release-build/types.js';
import { readBudgetTable, assertBudgetChecks, type BudgetTable } from './taxes-reader.js';
import differences from './taxes-source-differences.json' with { type: 'json' };
import type { GraphStage } from '../build/graph.js';

export function assertConsolidation(tables: BudgetTable[]): void {
  for (const year of [2024, 2026]) {
    const scopes = ['consolidated', 'central', 'social', 'local'];
    const set = scopes.map((scope) => tables.filter((t) => t.year === year && t.scope === scope));
    if (set.some((a) => a.length !== 1)) throw new Error('Missing/duplicate consolidation scope');
    const [cons, ...parts] = set.map((a) => a[0]!);
    const observation = (
      consolidationDifferences as Record<
        string,
        { year: number; sources: Record<string, string>; differences: Record<string, number> }
      >
    )[cons!.sha256];
    if (
      !observation ||
      observation.year !== year ||
      Object.keys(observation.sources).sort().join(',') !== 'central,local,social' ||
      !parts.every((t) => observation.sources[t.scope] === t.sha256)
    )
      throw new Error('Consolidation transfer source pins');
    const observed: Record<string, number> = {};
    for (let c = 0; c < cons!.columns.length; c++) {
      const transfers = parts.map((t) => t.rows.find((r) => r.row === 44));
      if (transfers.some((r) => !r || r.source[c] === null))
        throw new Error('Consolidation transfer row missing');
      observed['net-transfers/' + cons!.columns[c]!.id] = transfers.reduce(
        (n, r) => n + r!.source[c]!,
        0,
      );
    }
    if (
      JSON.stringify(Object.entries(observed).sort()) !==
      JSON.stringify(Object.entries(observation.differences).sort())
    )
      throw new Error('Consolidation transfers: unregistered source difference');
    // The GFS tables use identical rows; revenue, expenditure and balances are additive;
    // net transfers have only the exact SHA-bound source residuals. Do not apply to 2025: its central table is unavailable.
    for (const row of cons!.rows)
      for (let c = 0; c < cons!.columns.length; c++) {
        const found = parts.map((t) => t.rows.find((r) => r.row === row.row));
        if (found.some((r) => !r)) throw new Error('Consolidation row missing');
        const actual = row.source[c];
        if (actual === null) continue;
        const total = found.reduce((n, r) => n + (r!.source[c] ?? 0), 0);
        if (actual !== total)
          throw new Error(`Consolidation ${year}/${row.row}/${c}: ${actual! - total}`);
      }
  }
}
export function readTaxDatasets(context: Readonly<ExecutionContext>) {
  const originals = context.inputs.filter((f) =>
    /^data\/originals\/(state_budget|fiscal_quarterly)\/.*\.xls$/i.test(f.path),
  );
  if (originals.length !== 32) throw new Error('Expected exactly 32 tax/subsector originals');
  const tables = originals
    .map((f) => {
      const table = readBudgetTable({
        path: join(context.preparedInputRoot ?? context.exportRoot, f.path),
        sha256: f.sha256,
      });
      assertBudgetChecks(table, differences);
      return table;
    })
    .sort((a, b) => a.year - b.year || a.period - b.period || a.scope.localeCompare(b.scope));
  const monthly = tables.filter((t) => t.scope === 'state'),
    quarterly = tables.filter((t) => t.scope !== 'state');
  if (
    monthly.length !== 21 ||
    new Set(monthly.map((t) => t.year + '-' + t.period)).size !== 21 ||
    quarterly.length !== 11
  )
    throw new Error('Budget series coverage');
  assertConsolidation(quarterly);
  const reportingDate = (table: BudgetTable, multiplier: number) =>
    new Date(Date.UTC(table.year, table.period * multiplier, 0)).toISOString().slice(0, 10);
  const common = {
    sourceIntegerScale: 10000000,
    conversionRate: 1.95583,
    unit: 'млн. €',
    notes: [
      'Оригиналните суми се пазят като цели числа в една десетмилионна от посочения милион. Преобразуването в евро е по 1,95583 лв.; представянето е до шест знака.',
      'Празна клетка остава null; не се замества с нула или с план от друг месец. При проверка на сбор празните съставни редове са без запис.',
      'Проверките са в оригиналната валута преди преобразуването. Подписаните разлики на източника са обвързани с SHA-256; сумите не се коригират.',
    ],
  };
  return {
    'state-budget.json': {
      meta: metadata(
        'D36',
        'Държавен бюджет: месечни приходи, разходи и данъци',
        context.buildDate,
        {
          source: ['minfin'],
          asOf: reportingDate(monthly.at(-1)!, 1),
          sourceNote: 'МФ, официални XLS таблици; придобиване чрез браузър на 13.11.2026 г.',
          unit: 'млн. €',
        },
      ),
      schema: 'state-budget/1',
      sourcePage: 'https://www.minfin.bg/bg/statistics/18',
      ...common,
      scope: 'държавен бюджет',
      frequency: 'monthly-cumulative',
      tables: monthly,
      limitations: [
        'Това е държавният бюджет, а не консолидираната фискална програма.',
        'За януари–юни 2026 г. оригиналите не съдържат суми в колоната „Закон“.',
      ],
    },
    'kfp-subsectors.json': {
      meta: metadata(
        'D37',
        'КФП: тримесечни приходи, разходи и данъци по подсектори',
        context.buildDate,
        {
          source: ['minfin'],
          asOf: reportingDate(quarterly.at(-1)!, 3),
          sourceNote: 'МФ, официални XLS таблици; придобиване чрез браузър на 13.11.2026 г.',
          unit: 'млн. €',
        },
      ),
      schema: 'kfp-subsectors/1',
      sourcePage: 'https://www.minfin.bg/bg/statistics/6',
      ...common,
      scope: 'КФП по подсектори',
      frequency: 'quarterly-flows',
      tables: quarterly,
      missing: [
        {
          year: 2025,
          scope: 'central',
          reason:
            'Връзката на МФ „Централно правителство 2025 г.“ предоставя таблицата за 2024 г. Данни за централното правителство през 2025 г. не са включени и не са изчислявани по остатък.',
        },
      ],
      limitations: [
        'Всяка колона е поток само за тримесечието. Социалноосигурителните фондове включват ДОО и НЗОК, без отделно представяне.',
        'Месечни сборове за фондовете и общините се публикуват в бюджетния бюлетин на МФ (PDF); месечната серия не е включена в това издание. Държавният бюджет е представен месечно, а подсекторите — тримесечно.',
      ],
    },
  };
}
/** Budget outputs are the graph's named-file collection. Extend that collection in one stage,
 * before core, catalog, search and publication read it; no post-publication file injection. */
export function withProductionBudgets(
  stages: readonly GraphStage[],
  datasets: Record<string, unknown>,
): GraphStage[] {
  const resolvedStages = stages.map((stage) => ({
    ...stage,
    run: (read: (id: string) => unknown) => resolveBudgetMetadata(stage.run(read)),
  }));
  return [
    { id: 'production-budget-datasets', requires: [], run: () => datasets },
    ...resolvedStages.map((stage) =>
      stage.id === 'budgets'
        ? {
            ...stage,
            requires: [...stage.requires, 'production-budget-datasets'],
            run: (read: (id: string) => unknown) => ({
              ...(stage.run(read) as Record<string, unknown>),
              ...(read('production-budget-datasets') as Record<string, unknown>),
            }),
          }
        : stage,
    ),
  ];
}

import { readPinnedFile } from '../readers/workbooks/index.js';
import type { Wave13bInput } from '../build/wave13b.js';
export function registerTaxCatalog(input: Wave13bInput, context: Readonly<ExecutionContext>): void {
  const path = 'data/originals/taxes-subsectors-acquisition.json';
  const fact = context.inputs.find((f) => f.path === path);
  if (!fact) throw new Error('Missing tax acquisition pin');
  const record = JSON.parse(
    readPinnedFile({
      path: join(context.preparedInputRoot ?? context.exportRoot, path),
      sha256: fact.sha256,
    }).toString(),
  ) as { files: { path: string; sha256: string; url: string; bytes: number; retrieved: string }[] };
  const definitions = [
    {
      slug: 'state-budget',
      file: 'state-budget.json',
      group: 'execution',
      title: 'Държавен бюджет: месечни данъци и изпълнение',
      desc: '2025–2026: закон и натрупано изпълнение, само за държавния бюджет.',
      screens: ['S06', 'S15'],
    },
    {
      slug: 'kfp-subsectors',
      file: 'kfp-subsectors.json',
      group: 'execution',
      title: 'КФП по подсектори: тримесечни данъци и изпълнение',
      desc: '2024–2026: потоци за тримесечието. Централното правителство за 2025 г. липсва: връзката на МФ предоставя таблицата за 2024 г.',
      screens: ['S06', 'S15', 'S35'],
    },
  ];
  input.catalog.definitions = [...input.catalog.definitions, ...definitions];
  input.search.authored = {
    ...input.search.authored,
    catalogDefinitions: [...input.search.authored.catalogDefinitions, ...definitions],
  };
  const primary = input.catalog.primary;
  primary.manifest = { ...primary.manifest };
  const files = [...primary.manifestFiles];
  for (const file of record.files) {
    const key = file.path.replace(/^data\/originals\//, '');
    primary.manifest[key] = { ...file, http_status: 200 };
    files.push([
      key,
      key,
      ['minfin'],
      [key.startsWith('state_budget/') ? 'state-budget' : 'kfp-subsectors'],
    ]);
  }
  primary.manifestFiles = files;
}

function resolveBudgetMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveBudgetMetadata);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'meta' && entry && typeof entry === 'object' && Array.isArray((entry as any).pending)
        ? {
            ...entry,
            pending: (entry as any).pending.filter((id: string) => !RESOLVED_PENDING.has(id)),
          }
        : resolveBudgetMetadata(entry),
    ]),
  );
}
