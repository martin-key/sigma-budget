// The КФП of the 2027 draft next to 2026 and 2025, read only from the release (no number is typed here).
// 2026 and 2027 come from Annex 3 of the АСБП 2027–2029 (byPeriod of revenue.json, expenditure.json and outlook.json, МФ 06.11.2026);
// 2024 and 2025 are the report columns that every annual screen uses for „2024 · Отчет“ and „2025 · Отчет“ (selectPeriod: the legacy
// columns of the same files, with the vintage the publisher gave them, e.g. a preliminary report).
import { selectPeriod, periodByKey } from './periods.js';

/** the three years of the comparison: last year's report, this year's expected result, next year's draft */
export const COMPARE = ['2025.report', '2026.expected', '2027.draft'];
/** the capital expenditure line from the oldest report to the end of the framework */
export const CAPEX_YEARS = [
  '2024.report',
  '2025.report',
  '2026.expected',
  '2027.draft',
  '2028.forecast',
  '2029.forecast',
];

const ok = (x) => typeof x === 'number' && Number.isFinite(x);
const val = (cell) => (ok(cell?.value) ? cell.value : null);

// One indicator: the Annex 3 row of the November publication and the matching row of the report columns.
//   file: which dataset, annex: row id in byPeriod[k].rows, legacy: row id in the report columns, series: an outlook series instead of rows
export const INDICATORS = [
  {
    id: 'rev',
    label: 'Приходи, помощи и дарения',
    file: 'revenue',
    annex: 'annex3_mln.r0',
    legacy: 'r.total',
    level: 0,
  },
  {
    id: 'rev.tax',
    label: 'Данъчно-осигурителни приходи',
    file: 'revenue',
    annex: 'annex3_mln.r1',
    legacy: 'r.tax',
    level: 1,
  },
  {
    id: 'rev.vat',
    label: 'ДДС',
    file: 'revenue',
    annex: 'annex3_mln.r11',
    legacy: 'r.vat',
    level: 2,
  },
  {
    id: 'rev.social',
    label: 'Социални и здравни осигуровки',
    file: 'revenue',
    annex: 'annex3_mln.r7',
    legacy: 'r.social',
    level: 2,
  },
  {
    id: 'rev.pit',
    label: 'Данък върху доходите на физическите лица',
    file: 'revenue',
    annex: 'annex3_mln.r6',
    legacy: 'r.pit',
    level: 2,
  },
  {
    id: 'rev.excise',
    label: 'Акцизи',
    file: 'revenue',
    annex: 'annex3_mln.r12',
    legacy: 'r.excise',
    level: 2,
  },
  {
    id: 'rev.corp',
    label: 'Корпоративен данък',
    file: 'revenue',
    annex: 'annex3_mln.r3',
    legacy: 'r.corp',
    level: 2,
  },
  {
    id: 'rev.nontax',
    label: 'Неданъчни приходи',
    file: 'revenue',
    annex: 'annex3_mln.r19',
    legacy: 'r.nontax',
    level: 1,
  },
  {
    id: 'rev.grants',
    label: 'Помощи и дарения (основно от ЕС)',
    file: 'revenue',
    annex: 'annex3_mln.r28',
    legacy: 'r.grants',
    level: 1,
  },
  {
    id: 'exp',
    label: 'Разходи с вноската в бюджета на ЕС',
    file: 'expenditure',
    annex: 'annex3_mln.r31',
    legacy: 'x.total',
    level: 0,
  },
  {
    id: 'exp.personnel',
    label: 'Персонал (заплати и осигуровки)',
    file: 'expenditure',
    annex: 'annex3_mln.r35',
    legacy: 'x.personnel',
    level: 1,
  },
  {
    id: 'exp.maint',
    label: 'Издръжка',
    file: 'expenditure',
    annex: 'annex3_mln.r39',
    legacy: 'x.maint',
    level: 1,
  },
  {
    id: 'exp.social',
    label: 'Социални и здравноосигурителни плащания',
    file: 'expenditure',
    annex: 'annex3_mln.r44',
    legacy: 'x.social',
    level: 1,
  },
  {
    id: 'exp.pensions',
    label: 'от тях пенсии',
    file: 'expenditure',
    annex: 'annex3_mln.r45',
    legacy: 'x.pensions',
    level: 2,
  },
  {
    id: 'exp.subsidies',
    label: 'Субсидии и текущи трансфери',
    file: 'expenditure',
    annex: 'annex3_mln.r41',
    legacy: 'x.subsidies',
    level: 1,
  },
  {
    id: 'exp.capex',
    label: 'Капиталови разходи',
    file: 'expenditure',
    annex: 'annex3_mln.r50',
    legacy: 'x.capex',
    level: 1,
  },
  {
    id: 'exp.interest',
    label: 'Лихви',
    file: 'expenditure',
    annex: 'annex3_mln.r57',
    legacy: 'x.interest',
    level: 1,
  },
  {
    id: 'exp.eu',
    label: 'Вноска в бюджета на ЕС',
    file: 'expenditure',
    annex: 'annex3_mln.r60',
    legacy: 'x.eucontrib',
    level: 1,
  },
  { id: 'bal', label: 'Бюджетно салдо', file: 'outlook', series: 'balance', level: 0 },
];
export const indicator = (id) => INDICATORS.find((x) => x.id === id);

/** {value, pctGdp, provenance, vintage} of one indicator in one period, or null when the release has no such cell */
export function cellOf(data, id, key) {
  const it = indicator(id);
  const dataset = data?.[it?.file];
  if (!it || !dataset) return null;
  const rec = selectPeriod(dataset, key);
  if (!rec.available) return null;
  if (it.series) {
    if (rec.legacy) {
      const s = dataset.kfp?.[it.series];
      const value = s?.mln?.[rec.column];
      return ok(value)
        ? { value, pctGdp: s?.pctGdp?.[rec.column] ?? null, vintage: rec.vintage }
        : null;
    }
    const value = val(rec.series?.[it.series]);
    if (value === null) return null;
    const printed = val(rec.printedPctGdp?.[it.series]);
    return { value, pctGdp: printed, provenance: rec.series[it.series].provenance || '' };
  }
  if (rec.legacy) {
    const rows = dataset.economic?.rows || dataset.rows || [];
    const row = rows.find((r) => r.id === it.legacy);
    const value = row?.mln?.[rec.column];
    return ok(value)
      ? { value, pctGdp: row.pctGdp?.[rec.column] ?? null, vintage: rec.vintage }
      : null;
  }
  const row = (rec.rows || []).find((r) => r.id === it.annex);
  const value = val(row?.cell);
  return value === null
    ? null
    : { value, pctGdp: val(row.printedPctGdp), provenance: row.cell.provenance || '' };
}

/** the GDP of a period in млн. € (the outlook series of the publication, else the report column) */
export function gdpOf(data, key) {
  const o = data?.outlook;
  if (!o) return null;
  const rec = selectPeriod(o, key);
  if (!rec.available) return null;
  if (rec.legacy) return o.gdp?.mlnPrecise?.[rec.column] ?? o.gdp?.mln?.[rec.column] ?? null;
  return val(rec.series?.gdp);
}

/** a printed amount in another period: the change in млн. € and in % (null when either is missing or the base is zero) */
export function change(now, before) {
  if (!ok(now) || !ok(before)) return { abs: null, pct: null };
  const abs = Math.round((now - before) * 10) / 10;
  return { abs, pct: before === 0 ? null : (abs / Math.abs(before)) * 100 };
}

/** how the period is called under the year on an axis and in a column head */
export function periodWord(data, key) {
  const p = periodByKey(key);
  if (p.status === 'report') {
    const rec = data?.outlook ? selectPeriod(data.outlook, key) : null;
    return rec?.vintage === 'prelim' ? 'предварителен отчет' : 'отчет';
  }
  return (
    { expected: 'очаквано', draft: 'законопроект', forecast: 'прогноза', law: 'закон' }[p.status] ||
    ''
  );
}
export const periodHead = (data, key) => `${periodByKey(key).year} · ${periodWord(data, key)}`;

/** the whole comparison: one row per indicator, the three periods and the change of the draft against 2026 */
export function comparison(data) {
  return INDICATORS.map((it) => {
    const cells = Object.fromEntries(COMPARE.map((k) => [k, cellOf(data, it.id, k)]));
    const now = cells['2027.draft']?.value,
      before = cells['2026.expected']?.value;
    return { ...it, cells, change: change(now, before) };
  });
}

/** the totals of the adopted 2026 law that the November publication prints (Annex 1), for a sentence under the comparison */
export function lawTotals(data) {
  const law = (file, id) =>
    val((selectPeriod(data?.[file], '2026.law').rows || []).find((r) => r.id === id)?.cell);
  return {
    rev: law('revenue', 'annex1_execution2026.r0'),
    exp: law('expenditure', 'annex1_execution2026.r8'),
    capex: law('expenditure', 'annex1_execution2026.r11'),
    bal: val(selectPeriod(data?.outlook, '2026.law').series?.balance),
  };
}
