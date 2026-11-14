import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  monthName,
  pythonRound,
} from '../common/format.js';
import { pythonNumberAt } from '../common/numbers.js';

export interface CatalogEditorialRow {
  [key: string]: unknown;
  id: string;
  title: string;
  text: string;
  related: string[];
}
export interface CatalogEditorialInput {
  traps: readonly CatalogEditorialRow[];
  methodology: readonly CatalogEditorialRow[];
  owners: ReadonlyMap<string, { object: Record<string, any> }>;
  execution: { latest: { month: number } };
  manifest: Record<string, { url: string; http_status: number; retrieved: string }>;
  eur: number;
}
export function catalogPythonStringAt(holder: object, key: string): string {
  const value: unknown = (holder as Record<string, unknown>)[key];
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Invalid display value');
  if (pythonNumberAt(holder, key, value).kind === 'int') return String(value);
  if (Object.is(value, -0)) return '-0.0';
  const [mantissa, power] = value.toExponential().split('e'),
    exponent = Number(power);
  if (exponent < -4 || exponent >= 16)
    return `${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  return String(value) + (Number.isInteger(value) ? '.0' : '');
}
const pythonTruth = (v: unknown): boolean =>
  v != null &&
  v !== false &&
  v !== 0 &&
  v !== '' &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 0);
function listAnd(items: string[]): string {
  if (!items.length) throw new Error('Empty list in editorial text');
  return items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} и ${items.at(-1)}`;
}
function substitute(
  row: CatalogEditorialRow | undefined,
  values: readonly (string | number)[],
): CatalogEditorialRow {
  if (!row) throw new Error('Missing editorial definition');
  let i = 0;
  const text = row.text.replace(/%[sd]/g, () => {
    if (i >= values.length) throw new Error('Missing editorial value');
    return String(values[i++]);
  });
  if (i !== values.length) throw new Error('Unexpected editorial value');
  return { ...row, text, related: [...row.related] };
}
/**
 * The authored access text decides what it cites. The historical text (kept in the frozen catalog evidence) names the
 * blocked sites, the probe date and the last month; the launch text names only the last month.
 */
function accessValues(
  row: CatalogEditorialRow | undefined,
  [sites, checked, month]: readonly [string, string, string],
): readonly string[] {
  const slots = row?.text.match(/%[sd]/g)?.length ?? 0;
  if (slots === 1) return [month];
  if (slots === 3) return [sites, checked, month];
  throw new Error('Unexpected access editorial placeholders');
}
export function catalogEditorial(input: CatalogEditorialInput): {
  traps: Record<string, unknown>[];
  methodology: Record<string, unknown>[];
} {
  const get = (name: string) => {
    const value = input.owners.get(name)?.object;
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const outlook = get('outlook.json'),
    exp = get('expenditure.json'),
    comp = get('components.json'),
    law = get('law.json'),
    core = get('core.json');
  if (exp.functions.years[1] !== 2026 || outlook.years[2] !== 2026)
    throw new Error('catalog traps: the year index of 2026 changed');
  const number = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error('Invalid catalog numeric fact');
    return value;
  };
  const state = number(comp.budgets.state.expKhil) / 1000,
    kfp = number(outlook.kfp.expenditure.mln[2]),
    fn = number(exp.functions.totalMln[1]),
    cy = exp.cofog.years.at(-1),
    index = outlook.years.indexOf(cy);
  if (index < 0) throw new Error(`catalog traps: COFOG year ${cy} is not in the outlook years`);
  const version = outlook.versions as { diff: number[] }[],
    diffs = version.flatMap((r) => r.diff.map((x) => Math.abs(number(x)))),
    rows = version.filter((r) => r.diff.some((x) => Math.abs(number(x)) > 1e-9)).length;
  if (!diffs.length) throw new Error('Missing catalog version differences');
  const max = Math.max(...diffs);
  const changed = (law.budgets as Record<string, any>[])
    .filter((b) => pythonTruth(b.changed))
    .map((b) => catalogPythonStringAt(b, 'art'));
  const probes = Object.keys(input.manifest)
    .filter((k) => k.startsWith('probes/'))
    .sort()
    .map((k) => {
      const v = input.manifest[k]!;
      if (
        typeof v.url !== 'string' ||
        typeof v.http_status !== 'number' ||
        typeof v.retrieved !== 'string'
      )
        throw new Error(`Invalid probe: ${k}`);
      return { url: v.url, httpStatus: v.http_status, checked: v.retrieved.slice(0, 10) };
    });
  const bad = probes.filter((p) => p.httpStatus === 403);
  if (!bad.length) throw new Error('catalog traps: no recorded 403 probe');
  const sites: [string, string][] = [
    ['www.minfin.bg', 'на Министерството на финансите (minfin.bg)'],
    ['data.egov.bg', 'на портала data.egov.bg'],
    ['www.nsi.bg', 'на НСИ'],
  ];
  const blocked = sites
    .filter(([host]) => bad.some((p) => new URL(p.url).hostname === host))
    .map(([, label]) => label);
  const trap = new Map(input.traps.map((r) => [r.id, r])),
    method = new Map(input.methodology.map((r) => [r.id, r])),
    eur = formatNumber(number(input.eur), 5),
    dif = law.totals.diff,
    khil = '\u00a0хил.\u00a0€';
  const traps: Record<string, unknown>[] = [
    substitute(trap.get('eur-bgn'), [eur, eur]),
    substitute(trap.get('scope'), [formatMoney(state), formatMoney(kfp)]),
    substitute(trap.get('kfp-cofog'), [
      formatMoney(fn),
      catalogPythonStringAt(exp.cofog.years, String(exp.cofog.years.length - 1)),
      formatMoney(number(exp.cofog.total.mln.at(-1))),
      formatMoney(number(outlook.kfp.expenditure.mln[index])),
    ]),
    {
      ...substitute(
        trap.get('access'),
        accessValues(trap.get('access'), [
          listAnd(blocked),
          formatDate(bad[0]!.checked, true),
          monthName(input.execution.latest.month),
        ]),
      ),
      evidence: probes,
    },
    substitute(trap.get('two-versions'), [
      rows,
      formatNumber(pythonRound(max, 1), 1),
      exp.functions.versions.length,
    ]),
    substitute(trap.get('bill-law'), [
      law.counts.budgets ?? law.budgets.length,
      changed.length,
      listAnd(changed),
      formatNumber(number(dif.rev), 1, true) + khil,
      formatNumber(number(dif.exp), 1, true) + khil,
    ]),
  ];
  const k = core.kpis;
  const methodology: Record<string, unknown>[] = [
    substitute(method.get('calculator'), []),
    substitute(method.get('cash-accrual'), [
      formatDate(k.asOf, true),
      formatPercent(number(k.revenue.execPct)),
    ]),
    substitute(method.get('conversion'), [eur, eur]),
    substitute(method.get('statuses'), []),
    substitute(method.get('vintages'), []),
    substitute(method.get('units'), [formatNumber(number(k.gdp.mlnPrecise), 1)]),
  ];
  return { traps, methodology };
}

/** Current production releases scope the historical extraction without rewriting migration oracles. */
export function scopeAnnualCatalogTraps(
  traps: readonly CatalogEditorialRow[],
): CatalogEditorialRow[] {
  return traps.map((row) =>
    row.id === 'two-versions'
      ? {
          ...row,
          text: 'Историческото извличане от PDF (проект от юни 2026 г.) и внесения на 01.07.2026 г. DOCX се отнася само за старите масиви към проекта за 2026 г. Разликите са в %s реда на Приложение 3 (до %s млн. €) и %s реда на Табл. III-1; общите суми и осемте групи приходи съвпадат. Полетата „versions“ в „outlook“ и „expenditure“ описват тези исторически разлики. Серията byPeriod е отделна: 2026.expected е очаквано изпълнение, 2027.draft е проект, а 2028.forecast и 2029.forecast са прогнози. Приходите и икономическите разходни редове са от Приложение 3 (стр. 191–192), а разходите по функции са от Табл. III-1 (стр. 73) на АСБП 2027–2029, публикувана на 06.11.2026 г.',
        }
      : row,
  );
}
