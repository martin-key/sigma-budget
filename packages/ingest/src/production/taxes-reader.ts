import { budgetSourceCells } from '@sigma-budget/dataset-schema';
import { basename } from 'node:path';
import {
  readWorkbook,
  workbookCell,
  type PinnedFile,
  type Workbook,
} from '../readers/workbooks/index.js';

export type BudgetTable = {
  file: string;
  sha256: string;
  sheet: string;
  year: number;
  period: number;
  scope: 'state' | 'consolidated' | 'central' | 'social' | 'local';
  columns: { id: string; unit: 'BGN' | 'EUR' }[];
  rows: { row: number; label: string; source: (number | null)[]; eur: (number | null)[] }[];
  checks: Record<string, number>;
};
export type DifferenceRegistry = Record<
  string,
  { file: string; differences: Record<string, number> }
>;
const norm = (s: unknown) =>
  String(s ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
const sourceUnits = (n: number) => {
  const v = Math.round(n * 1e7);
  if (!Number.isSafeInteger(v) || Math.abs(n * 1e7 - v) > 0.001)
    throw new Error('Unexpected source precision');
  return v;
};
const euro = (n: number, unit: 'BGN' | 'EUR') =>
  Number((n / 1e7 / (unit === 'BGN' ? 1.95583 : 1)).toFixed(6));
export function assertBudgetChecks(table: BudgetTable, registry: DifferenceRegistry): void {
  const expected = registry[table.sha256];
  if (expected && expected.file !== table.file) throw new Error('Difference file mismatch');
  const differences = Object.fromEntries(
    Object.entries(table.checks).filter(([, value]) => value !== 0),
  );
  if (
    JSON.stringify(Object.entries(differences).sort()) !==
    JSON.stringify(Object.entries(expected?.differences ?? {}).sort())
  )
    throw new Error(
      'Unregistered source differences: ' + table.file + ' ' + JSON.stringify(differences),
    );
}
/** Saved caches only. Integer tenths of source currency units remove binary floating point noise, without a tolerance on identities. */
export function parseBudgetTable(w: Workbook, filename: string): BudgetTable {
  if (w.sheetNames.length !== 1) throw new Error('Expected one budget worksheet');
  const s = w.sheets[w.sheetNames[0]!]!;
  const state = /^State__?Bud_/.test(filename);
  let year: number, period: number, scope: BudgetTable['scope'], columns: BudgetTable['columns'];
  let labelCol: number;
  const cell = (r: number, c: number) => workbookCell(s, String.fromCharCode(65 + c) + r);
  if (state) {
    if (!/^State_Bud(?: \(2\))?$/.test(s.name)) throw new Error('State budget sheet');
    const m = /КЪМ (\d{2})\.(\d{2})\.(202[56])/.exec(String(cell(3, 1).value));
    if (!m) throw new Error('State budget period');
    year = Number(m[3]);
    period = Number(m[2]);
    scope = 'state';
    labelCol = 1;
    if (
      period < 1 ||
      period > (year === 2025 ? 12 : 9) ||
      Number(m[1]) !== new Date(Date.UTC(year, period, 0)).getUTCDate()
    )
      throw new Error('State budget reporting date');
    columns = ['law', 'execution'].map((id, i) => {
      const t = norm(cell(7, i + 2).value);
      const unit = /евро/.test(t) ? 'EUR' : /лв\./.test(t) ? 'BGN' : null;
      if (
        !unit ||
        !norm(cell(5, i + 2).value)
          .toLowerCase()
          .includes(i ? 'изпълнение' : 'закон')
      )
        throw new Error('State budget units/columns');
      if (id === 'execution' && unit !== (year === 2025 ? 'BGN' : 'EUR'))
        throw new Error('Execution currency');
      return { id, unit };
    });
  } else {
    const m = /^(Cons|Central|Soc|Local)_([24])Q_(202[456])_BG\.xls$/.exec(filename);
    if (!m) throw new Error('Quarterly filename');
    year = Number(m[3]);
    period = Number(m[2]);
    scope = ({ Cons: 'consolidated', Central: 'central', Soc: 'social', Local: 'local' } as const)[
      m[1] as 'Cons' | 'Central' | 'Soc' | 'Local'
    ];
    labelCol = scope === 'social' ? 1 : 0;
    const sheets = {
      consolidated: 'Consolid_BG',
      central: 'Central_BG',
      social: 'SS_BG',
      local: 'Local_BG',
    };
    if (
      s.name !== sheets[scope] ||
      s.rows !== 57 ||
      period !== (year === 2026 ? 2 : 4) ||
      (year === 2025 && scope === 'central')
    )
      throw new Error('Quarterly scope/period');
    const unit = norm(cell(5, labelCol).value);
    if (unit !== (year === 2026 ? 'млн. евро' : 'млн. лева'))
      throw new Error('Quarterly Bulgarian units');
    columns = Array.from({ length: period }, (_, i) => {
      if (
        cell(4, labelCol + 1 + i).value !== `Q${i + 1}` ||
        cell(5, labelCol + 1 + i).value !== year
      )
        throw new Error('Quarterly header');
      return { id: `Q${i + 1}`, unit: year === 2026 ? 'EUR' : 'BGN' };
    });
  }
  const rows: BudgetTable['rows'] = [];
  const registered = budgetSourceCells[w.sha256];
  if (
    !registered ||
    registered.file !== filename ||
    registered.scope !== scope ||
    registered.year !== year ||
    registered.period !== period
  )
    throw new Error('Unregistered budget source positions');
  for (const row of registered.rows) {
    const label = norm(cell(row, labelCol).value);
    if (!label) throw new Error('Missing budget row label');
    const source = columns.map((_, i) => {
      const c = cell(row, labelCol + 1 + i);
      const blank = registered.blanks.some(
        (entry) => entry.row === row && entry.column === c.address.replace(/\d+$/, ''),
      );
      if (c.formula && (c.value === null || c.value === '' || c.cache === 'missing'))
        throw new Error('Missing formula cache');
      if (blank) {
        if (c.value !== null || c.formula || !['blank', 'missing'].includes(c.type))
          throw new Error('Registered blank budget cell changed');
        return null;
      }
      if (
        c.type !== 'number' ||
        typeof c.value !== 'number' ||
        !Number.isFinite(c.value) ||
        c.cache === 'missing'
      )
        throw new Error('Non-numeric budget cell');
      return sourceUnits(c.value);
    });
    rows.push({
      row,
      label,
      source,
      eur: source.map((n, i) => (n === null ? null : euro(n, columns[i]!.unit))),
    });
  }
  // Published row indices are evidence addresses, not inferred amounts.
  const checks: Record<string, number> = {};
  const find = (re: RegExp) => {
    const found = rows.filter((r) => re.test(r.label));
    if (found.length !== 1) throw new Error('Missing/ambiguous budget label: ' + re);
    return found[0]!;
  };
  const equation = (id: string, target: number, terms: [number, number][]) => {
    const lhs = rows.find((r) => r.row === target);
    if (!lhs) throw new Error('Missing identity target ' + id);
    for (let c = 0; c < columns.length; c++) {
      if (lhs.source[c] === null) {
        if (terms.some(([r]) => rows.find((x) => x.row === r)?.source[c] != null))
          throw new Error('Partial identity ' + id);
        continue;
      }
      // Only the registered physical blanks denote no entry.
      const sum = terms.reduce(
        (n, [r, sign]) => n + sign * (rows.find((x) => x.row === r)?.source[c] ?? 0),
        0,
      );
      checks[id + '/' + columns[c]!.id] = lhs.source[c]! - sum;
    }
  };
  const eq = (id: string, re: RegExp, parts: RegExp[]) =>
    equation(
      id,
      find(re).row,
      parts.map((p) => [find(p).row, 1]),
    );
  if (state) {
    const tax = find(/^Данъчни приходи$/),
      nt = find(/^Неданъчни приходи$/),
      grant = find(/^Помощи$/),
      ex = find(/^Разходи$/),
      tr = find(/^Трансфери \(нето\)$/);
    equation(
      'tax-components',
      tax.row,
      rows.filter((r) => r.row > tax.row && r.row < nt.row).map((r) => [r.row, 1]),
    );
    equation('revenue', find(/^I\. ПРИХОДИ/).row, [
      [tax.row, 1],
      [nt.row, 1],
      [grant.row, 1],
    ]);
    equation(
      'non-tax',
      nt.row,
      rows.filter((r) => r.row > nt.row && r.row < grant.row).map((r) => [r.row, 1]),
    );
    const expenditure = rows.filter(
      (r) => r.row > ex.row && r.row < tr.row && !/^Лихви по/.test(r.label),
    );
    equation(
      'expenditure',
      ex.row,
      expenditure.map((r) => [r.row, 1]),
    );
    eq('interest', /^Лихви - общо$/, [/^Лихви по външни/, /^Лихви по вътрешни/]);
    equation('expenditure-transfers', find(/^II\./).row, [
      [ex.row, 1],
      [tr.row, 1],
    ]);
    const paid = find(/^(Предоставени на:|Предоставени трансфери)$/),
      received = find(/^(Получени от:|Получени трансфери)$/),
      eu = find(/^III\./),
      bal = find(/^IV\./),
      fin = find(/^V\./);
    equation('transfers-net', tr.row, [
      [paid.row, 1],
      [received.row, -1],
    ]);
    equation(
      'transfers-paid',
      paid.row,
      rows.filter((r) => r.row > paid.row && r.row < received.row).map((r) => [r.row, 1]),
    );
    equation(
      'transfers-received',
      received.row,
      rows
        .filter((r) => r.row > received.row && r.row < eu.row && !/^в т\./.test(r.label))
        .map((r) => [r.row, 1]),
    );
    equation('balance', bal.row, [
      [find(/^I\. ПРИХОДИ/).row, 1],
      [find(/^II\./).row, -1],
      [eu.row, -1],
    ]);
    equation('financing-balance', fin.row, [[bal.row, -1]]);
    eq('financing', /^V\./, [/^Външно финансиране/, /^Вътрешно финансиране/, /^и възмездни/]);
  } else {
    for (const [id, lhs, rhs] of [
      ['tax-components', 10, [11, 12, 13, 14, 15, 16, 17, 18, 19]],
      ['revenue', 8, [10, 21, 23]],
      ['current-expenditure', 28, [30, 31, 32, 35, 38]],
      ['expenditure', 26, [28, 40, 41, 42]],
      ['subsidies', 32, [33, 34]],
      ['interest', 35, [36, 37]],
      ['financing', 49, [50, 51, 52, 54]],
    ] as const)
      equation(
        id,
        lhs,
        rhs.map((r) => [r, 1]),
      );
    equation('balance', 47, [
      [8, 1],
      [26, -1],
      ...(scope === 'consolidated' ? [] : [[44, 1] as [number, number]]),
    ]);
    equation('financing-balance', 49, [[47, -1]]);
  }
  return {
    file: filename,
    sha256: w.sha256,
    sheet: s.name,
    year,
    period,
    scope,
    columns,
    rows,
    checks,
  };
}
export function readBudgetTable(input: PinnedFile): BudgetTable {
  return parseBudgetTable(readWorkbook({ ...input, format: 'xls' }), basename(input.path));
}
