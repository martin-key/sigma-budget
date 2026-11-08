import { createHash } from 'node:crypto';

export interface AnnualColumn {
  year: number;
  vintage?: string;
}
export interface AnnualRow {
  label: string;
  values: (number | null)[];
  units: string[];
}
export interface AnnualTable {
  columns: AnnualColumn[];
  rows: AnnualRow[];
}
export interface AnnualForecast {
  tables: Record<string, AnnualTable>;
}
export interface AnnualCell {
  value: number;
  unit: string;
  provenance: string;
}
export interface AnnualEntry {
  id: string;
  label: string;
  cell: AnnualCell;
  printedPctGdp?: AnnualCell;
}
export interface AnnualPeriod {
  periodKey: string;
  year: number;
  status: string;
  vintage: string;
  publication: string;
  sourceRefs: string[];
  series: Record<string, AnnualCell>;
  rows: AnnualEntry[];
  gaps: Record<string, string>;
  primaryBalanceNote?: string;
  macro?: { label: string; cell: AnnualCell }[];
  printedPctGdp?: Record<string, AnnualCell>;
  groups?: Record<string, AnnualCell>;
  functions?: { label: string; cell: AnnualCell; printedPctGdp: AnnualCell }[];
}
export interface AnnualProjection {
  outlook: Record<string, AnnualPeriod>;
  revenue: Record<string, AnnualPeriod>;
  expenditure: Record<string, AnnualPeriod>;
}
const periods = [
  ['2026.law', 'law', 'plan', 'програма'],
  ['2026.expected', 'expected', 'expected', 'очаквано'],
  ['2027.draft', 'draft', 'plan', 'проект'],
  ['2028.forecast', 'forecast', 'forecast', 'прогноза'],
  ['2029.forecast', 'forecast', 'forecast', 'прогноза'],
] as const;
const groups: Record<string, number[]> = {
  dds: [11],
  osiguritelni: [7],
  nedanachni: [19],
  pomoshti: [28],
  ddfl: [6],
  akcizi: [12],
  korporativen: [3],
  drugi: [13, 14, 15],
};
const functionRows = [0, 4, 10, 11, 12, 16, 19, 24, 31];
const hash = (path: string) => createHash('sha256').update(path).digest('hex').slice(0, 24);

// Python Decimal(str(number)) sums the printed decimal values before converting back to float.
function decimalSum(values: number[]): number {
  const pieces = values.map((v) => {
    if (!Number.isFinite(v)) throw new Error('Non-finite annual operand');
    const [mantissa, exponentText] = String(v).toLowerCase().split('e');
    const exponent = Number(exponentText ?? '0');
    const [integer, fraction = ''] = mantissa!.split('.');
    return { integer: BigInt(integer! + fraction), scale: fraction.length - exponent };
  });
  const scale = Math.max(0, ...pieces.map((p) => p.scale));
  const total = pieces.reduce((sum, p) => sum + p.integer * 10n ** BigInt(scale - p.scale), 0n);
  const sign = total < 0n ? '-' : '';
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, '0');
  return Number(
    scale ? `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}` : sign + digits,
  );
}

/** Pure projection of the independently extracted 2027 forecast tables. */
export function buildAnnualPeriods(forecast: AnnualForecast): AnnualProjection {
  const result: AnnualProjection = { outlook: {}, revenue: {}, expenditure: {} };
  for (const [period, status, vintage, header] of periods) {
    const law = period === '2026.law';
    const column = law ? 0 : periods.findIndex(([key]) => key === period);
    const table = law ? 'annex1_execution2026' : 'annex3_mln';
    const record = (): AnnualPeriod => ({
      periodKey: period,
      year: Number(period.slice(0, 4)),
      status,
      vintage,
      publication: '2026-11-06',
      sourceRefs: ['budget2027'],
      series: {},
      rows: [],
      gaps: {},
    });
    const outlook = record(),
      revenue = record(),
      expenditure = record();
    result.outlook[period] = outlook;
    result.revenue[period] = revenue;
    result.expenditure[period] = expenditure;
    const cell = (
      file: string,
      name: string,
      rowIndex: number,
      col: number,
      path: string,
    ): AnnualCell => {
      const source = forecast.tables[name];
      const row = source?.rows[rowIndex],
        colInfo = source?.columns[col];
      if (!row || !colInfo || colInfo.year !== Number(period.slice(0, 4)))
        throw new Error(`Wrong year in ${name} column ${col}: ${period}`);
      const expected = name === 'I_2' ? 'прогноза' : header;
      if (colInfo.vintage !== expected)
        throw new Error(`Wrong vintage in ${name} column ${col}: ${period}`);
      const value = row.values[col],
        unit = row.units[col];
      if (typeof value !== 'number' || !Number.isFinite(value) || typeof unit !== 'string')
        throw new Error(`Non-numeric extraction cell: ${name} ${rowIndex}/${col}`);
      return { value, unit, provenance: hash(`${file}.json#/byPeriod/${period}/${path}`) };
    };
    const derived = (file: string, path: string, operands: AnnualCell[]): AnnualCell => ({
      value: decimalSum(operands.map((x) => x.value)),
      unit: 'млн. €',
      provenance: hash(`${file}.json#/byPeriod/${period}/${path}`),
    });
    const mapping: Record<string, number> = {
      revenue: 0,
      expenditure: law ? 8 : 31,
      balance: law ? 17 : 61,
      interest: law ? 14 : 57,
    };
    if (!law) mapping.financing = 62;
    for (const [name, row] of Object.entries(mapping))
      outlook.series[name] = cell('outlook', table, row, column, `series/${name}`);
    outlook.series.primaryBalance = derived('outlook', 'series/primaryBalance', [
      outlook.series.balance!,
      outlook.series.interest!,
    ]);
    outlook.primaryBalanceNote = 'Салдо плюс лихвени разходи; без корекция за лихвени приходи.';
    if (law) {
      outlook.gaps = {
        gdp: 'Няма законова макропрогноза в тази публикация.',
        macro: 'Няма законова макропрогноза.',
        financing: 'Не е отпечатано.',
      };
      revenue.gaps = {
        groups: 'Няма отделни ДДС, акцизи, корпоративни и ДДФЛ в законовата колона.',
      };
      expenditure.gaps = {
        functions: 'Няма законова функционална разбивка.',
        economicDetails: 'Няма подробни законови икономически редове.',
      };
    } else {
      outlook.series.gdp = cell('outlook', 'annex3_pct_gdp', 63, column, 'series/gdp');
      outlook.macro = Array.from({ length: 16 }, (_, i) => ({
        label: forecast.tables.I_2!.rows[i]!.label,
        cell: cell('outlook', 'I_2', i, column + 1, `macro/${i}/cell`),
      }));
      outlook.printedPctGdp = {};
      for (const [name, row] of Object.entries(mapping))
        outlook.printedPctGdp[name] = cell(
          'outlook',
          'annex3_pct_gdp',
          row,
          column,
          `printedPctGdp/${name}`,
        );
    }
    const addRows = (
      file: 'revenue' | 'expenditure',
      target: AnnualPeriod,
      start: number,
      end: number,
    ) => {
      for (let i = start; i < end; i++) {
        const row = forecast.tables[table]!.rows[i]!;
        if (row.values[column] === null) {
          target.gaps[`${table}.r${i}`] = 'Празна печатна клетка.';
          continue;
        }
        const n = target.rows.length;
        const entry: AnnualEntry = {
          id: `${table}.r${i}`,
          label: row.label,
          cell: cell(file, table, i, column, `rows/${n}/cell`),
        };
        if (!law)
          entry.printedPctGdp = cell(file, 'annex3_pct_gdp', i, column, `rows/${n}/printedPctGdp`);
        target.rows.push(entry);
      }
    };
    addRows('revenue', revenue, 0, law ? 8 : 31);
    addRows('expenditure', expenditure, law ? 8 : 31, law ? 16 : 61);
    if (!law) {
      revenue.groups = {};
      for (const [name, rows] of Object.entries(groups))
        revenue.groups[name] = derived(
          'revenue',
          `groups/${name}`,
          rows.map((r) => {
            const entry = revenue.rows.find((x) => x.id === `annex3_mln.r${r}`);
            if (!entry) throw new Error(`Missing revenue group row ${r}`);
            return entry.cell;
          }),
        );
      expenditure.functions = functionRows.map((row, i) => ({
        label: forecast.tables.III_1!.rows[row]!.label,
        cell: cell('expenditure', 'III_1', row, column - 1, `functions/${i}/cell`),
        printedPctGdp: cell(
          'expenditure',
          'III_1',
          row,
          column + 3,
          `functions/${i}/printedPctGdp`,
        ),
      }));
    }
  }
  return result;
}
