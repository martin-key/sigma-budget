import { metadata } from '../common/metadata.js';
import { catalogPythonStringAt } from './catalog-editorial.js';
import { pythonFloat } from './context.js';
import { AnnualLineage, pointer, type BillExtraction } from './annual-lineage.js';
import type { AnnualCell } from './fiscal-annual.js';

const PUBLICATION = '2026-11-06';
const SOURCE_NOTE = 'МФ, публикация от 06.11.2026.';
const UNIT = 'хил. €';
const DEFAULT = '2027.draft';
const projectPeriods = ['2027.draft', '2028.forecast', '2029.forecast'];
const forecastPeriods: Record<number, string> = {
  2026: '2026.expected',
  2027: DEFAULT,
  2028: '2028.forecast',
  2029: '2029.forecast',
};
const normalize = (text: string) =>
  text
    .replace(
      /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu,
      '',
    )
    .replaceAll('–', '-');
export function numericBillCell(text: string | null): number {
  const s = normalize(text || '');
  if (s === '-') return 0;
  const n = pythonFloat(s.replaceAll(',', '.'));
  if (n === null || !Number.isFinite(n)) throw new Error('Invalid physical number');
  return n;
}
const truth = (x: any) =>
  x != null &&
  x !== false &&
  x !== 0 &&
  x !== '' &&
  (!Array.isArray(x) || x.length !== 0) &&
  (typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length !== 0);
const pyOr = (...values: any[]) => values.find(truth);
function valueAt(bill: BillExtraction, path: string): { value: number; text: string } {
  const slash = path.lastIndexOf('/'),
    holder = pointer(bill, path.slice(0, slash)),
    key = path.slice(slash + 1);
  const value = pointer(bill, path);
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Non-numeric bill cell');
  return { value, text: catalogPythonStringAt(holder, key) };
}
type Physical = {
  table: string;
  page: number;
  printed: string;
  rawRow?: number;
  rawColumn?: number;
};
function physicalFinder(bill: BillExtraction) {
  const numeric = new Map<string | null, number | null>();
  const printedValues = new Map<string, Map<string, string>>();
  return (row: any, path: string, column: number | null): Physical => {
    const { value, text } = valueAt(bill, path);
    if (row.table != null) {
      const table = bill.tables.find((t: any) => t.id === row.table);
      if (!table) throw new Error('Missing physical table');
      if (table.page !== row.page) throw new Error('Physical table page mismatch');
      let values = printedValues.get(table.id);
      if (!values) {
        values = new Map();
        for (const raw of table.rawCells)
          for (const cell of raw) {
            if (cell) {
              const key = normalize(cell).replaceAll(',', '.');
              if (!values.has(key)) values.set(key, cell);
            }
          }
        printedValues.set(table.id, values);
      }
      const printed = values.get(text);
      if (printed === undefined) throw new Error(`Missing printed numeric evidence: ${path}`);
      return { table: row.table, page: row.page, printed };
    }
    const pages = Object.hasOwn(row, 'pages') ? row.pages : [row.page];
    if (!Array.isArray(pages)) throw new Error('Invalid physical pages');
    const identity = Object.hasOwn(row, 'id') ? row.id : Object.hasOwn(row, 'name') ? row.name : '';
    const candidates: Physical[] = [];
    const selectedTables = bill.tables.filter((table) => pages.includes(table.page));
    for (const table of selectedTables) {
      for (const [rowIndex, raw] of table.rawCells.entries()) {
        if (
          truth(identity) &&
          !raw.some((cell: string | null) => normalize(identity) === normalize(cell || ''))
        )
          continue;
        let ordinal = 0;
        for (const [columnIndex, cell] of raw.entries()) {
          if (!numeric.has(cell)) {
            try {
              numeric.set(cell, numericBillCell(cell));
            } catch {
              numeric.set(cell, null);
            }
          }
          const parsed = numeric.get(cell);
          if (parsed === null || parsed === undefined) continue;
          ordinal++;
          const selected = path.includes('/projects/')
            ? columnIndex === column
            : ordinal === column;
          if (parsed === value && (column === null || selected))
            candidates.push({
              table: table.id,
              page: table.page,
              printed: cell!,
              rawRow: rowIndex,
              rawColumn: columnIndex,
            });
        }
      }
    }
    if (candidates.length !== 1)
      throw new Error(`ambiguous physical cell ${path}: ${candidates.length}`);
    return candidates[0]!;
  };
}
export function physicalBillCell(
  bill: BillExtraction,
  row: any,
  path: string,
  column: number | null,
): Physical {
  return physicalFinder(bill)(row, path, column);
}
function billLeaf(
  lineage: AnnualLineage,
  findPhysical: ReturnType<typeof physicalFinder>,
  path: string,
  row: any,
  valuePath: string,
  period = DEFAULT,
  variant = 'bill',
  column: number | null = null,
): AnnualCell {
  const physical = findPhysical(row, valuePath, column);
  const match = /\/(?:rows|policiesRows|commitmentRows)\/(\d+)\//.exec(valuePath);
  return lineage.leaf('B', valuePath, `budget2027.json#/${path}`, UNIT, period, {
    table: physical.table,
    page: physical.page,
    label: pyOr(row.text, row.name, 'Без отпечатан етикет'),
    no: String(pyOr(row.no, row.n, row.name, 'unprinted')),
    column: {
      label: column === null ? 'Сума (хил. евро)' : `column ${column}`,
      year: Number(period.slice(0, 4)),
    },
    variant,
    printed: physical.printed,
    rowOrdinal: match ? Number(match[1]) : 0,
    ...(physical.rawRow !== undefined
      ? { rawRow: physical.rawRow, rawColumn: physical.rawColumn }
      : {}),
  });
}
/** Construct the current bill and provenance after the annual projection has used the same lineage. */
export function buildBudget2027(
  lineage: AnnualLineage,
  buildDate: string,
): { budget: Record<string, any>; provenance: Record<string, any> } {
  const bill = lineage.inputs.B;
  const findPhysical = physicalFinder(bill);
  if (bill.year !== 2027 || bill.unit !== 'хил. евро') throw new Error('Wrong bill year or unit');
  const budget: Record<string, any> = {
    meta: metadata('D34', 'Бюджет 2027: проект на МФ', buildDate, {
      source: ['budget2027'],
      sourceNote: SOURCE_NOTE,
      asOf: PUBLICATION,
    }),
    schema: 'budget2027/1',
    publication: PUBLICATION,
    defaultVariant: 'bill',
    budgets: {},
    municipal: {},
    projects: [],
    forecast: {},
    gaps: {
      programmes: 'Няма пълен програмен архив за 2027–2029.',
      municipalForecast: 'Няма индивидуални общински разпределения за 2028–2029.',
      law: 'Публикацията е проект; не е приет закон.',
    },
  };
  for (const variant of ['bill', 'billMc'] as const) {
    budget.budgets[variant] = {};
    for (const [article, item] of Object.entries(bill[variant]) as [string, any][]) {
      const target: Record<string, any> = {
        name: item.name,
        rows: [],
        policiesRows: [],
        commitmentRows: [],
      };
      for (const section of ['rows', 'policiesRows', 'commitmentRows'])
        for (const [i, row] of item[section].entries()) {
          if (row.value == null) continue;
          const path = `budgets/${variant}/${article}/${section}/${target[section].length}/cell`;
          const cell = billLeaf(
            lineage,
            findPhysical,
            path,
            row,
            `/${variant}/${article}/${section}/${i}/value`,
            DEFAULT,
            variant,
          );
          if (!Object.hasOwn(row, 'text')) throw new Error('Missing required budget row text');
          target[section].push({
            no: pyOr(row.no, 'unprinted'),
            label: pyOr(row.text, 'Без отпечатан етикет'),
            section: pyOr(row.sec, 'unprinted'),
            cell,
          });
        }
      budget.budgets[variant][article] = target;
    }
  }
  budget.municipalTotals = {};
  for (const section of ['art52', 'art53']) {
    const source = bill.municipal[section];
    if (!source) throw new Error(`Missing municipality section ${section}`);
    budget.municipal[section] = source.rows.map((row: any, i: number) => ({
      name: row.name,
      region: row.region,
      cells: row.values.map((_x: number, c: number) =>
        billLeaf(
          lineage,
          findPhysical,
          `municipal/${section}/${i}/cells/${c}`,
          row,
          `/municipal/${section}/rows/${i}/values/${c}`,
          DEFAULT,
          'bill',
          c + 1,
        ),
      ),
    }));
    const row = { name: 'ВСИЧКО:', page: Math.max(...source.pages) };
    budget.municipalTotals[section] = source.total.map((_x: number, c: number) =>
      billLeaf(
        lineage,
        findPhysical,
        `municipalTotals/${section}/${c}`,
        row,
        `/municipal/${section}/total/${c}`,
        DEFAULT,
        'bill',
        c + 1,
      ),
    );
  }
  for (const [i, row] of bill.projects.rows.entries()) {
    const project: Record<string, any> = {
      id: row.id,
      name: row.name,
      institution: row.institution,
      gaps: {},
      cells: {},
    };
    for (const [c, value] of row.values.entries())
      if (value === null) project.gaps[String(c)] = 'Празна печатна клетка.';
    for (const [c, period] of projectPeriods.entries())
      if (row.values[c] !== null)
        project.cells[String(c)] = billLeaf(
          lineage,
          findPhysical,
          `projects/${i}/cells/${c}`,
          row,
          `/projects/rows/${i}/values/${c}`,
          period,
          'bill',
          c + 3,
        );
    budget.projects.push(project);
  }
  budget.projectAnnualSums = {};
  for (const [c, period] of projectPeriods.entries()) {
    const operands = budget.projects
      .filter((p: any) => Object.hasOwn(p.cells, String(c)))
      .map((p: any) => p.cells[String(c)]);
    budget.projectAnnualSums[period] = lineage.derived(
      `budget2027.json#/projectAnnualSums/${period}`,
      period,
      'sum',
      operands,
      UNIT,
    );
  }
  budget.debtLimits = {};
  for (const article of ['66', '67', '68']) {
    const row = bill.articles[article]?.[0];
    if (!row) throw new Error(`Missing debt limit article ${article}`);
    const matches = [...row.text.matchAll(/(\d+(?:,\d+)?)\s+млрд\. евро/gu)];
    if (matches.length !== 1) throw new Error(`Ambiguous debt limit prose: ${article}`);
    const match = matches[0]!,
      output = `budget2027.json#/debtLimits/${article}`;
    const provenance = lineage.record(output, {
      document: 'bill',
      extraction: `/articles/${article}/0/text`,
      operation: 'parse-billion-euro',
      period: DEFAULT,
      variant: 'bill',
      page: row.page,
      unit: 'млрд. €',
      printed: match[0],
      label: pyOr(row.text, 'Без отпечатан етикет'),
    });
    budget.debtLimits[article] = {
      value: Number(match[1]!.replace(',', '.')),
      unit: 'млрд. €',
      provenance,
    };
  }
  for (const tableId of ['II_5', 'II_7', 'II_8', 'VI_1', 'VI_2', 'annex9']) {
    const table = lineage.inputs.F.tables[tableId]!;
    budget.forecast[tableId] = table.rows.map((row, i) => {
      const cells: Record<string, AnnualCell> = {},
        gaps: Record<string, string> = {};
      for (const [c, column] of table.columns.entries()) {
        const period = forecastPeriods[column.year];
        if (!period) continue;
        if (row.values[c] === null) {
          gaps[String(c)] = 'Празна печатна клетка.';
          continue;
        }
        cells[String(c)] = lineage.f(
          tableId,
          i,
          c,
          `budget2027.json#/forecast/${tableId}/${i}/cells/${c}`,
          period,
        );
      }
      return { label: row.label, cells, gaps };
    });
  }
  return {
    budget,
    provenance: {
      meta: metadata('D35', 'Произход на бюджетните числа за 2027', buildDate, {
        source: ['budget2027'],
        sourceNote: SOURCE_NOTE,
        asOf: PUBLICATION,
      }),
      schema: 'budget2027-provenance/1',
      documents: lineage.documents,
      entries: lineage.entries,
    },
  };
}
