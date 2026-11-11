// Presentation projections of the keyed annual DTO. Legacy column arrays are historical input only.
import { FRAMEWORK } from './budget-2027.js';
import { PERIODS, selectPeriod } from './periods.js';
const value = (cell) => cell?.value ?? null;
const sum = (cells) =>
  cells.every((v) => typeof v === 'number') ? cells.reduce((a, b) => a + b, 0) : null;
const norm = (text) =>
  String(text)
    .toLowerCase()
    .replace(/^р-ди/, 'разходи')
    .replace(/[^а-яa-z0-9]/g, '');
export const periodIndex = (doc, ctx) =>
  doc?.periodKeys?.findIndex((k) => k === ctx.period.key) ?? -1;
export const previousPeriodIndex = (doc, ctx) => {
  const year = ctx.period.year - 1;
  const key =
    year < 2026
      ? `${year}.report`
      : year === 2026
        ? '2026.expected'
        : year === 2027
          ? '2027.draft'
          : `${year}.forecast`;
  return doc?.periodKeys?.findIndex((k) => k === key) ?? -1;
};
export const annualRecord = (doc, ctx) => selectPeriod(doc, ctx.period.key);
const pctOf = (v, gdp) => (v != null && gdp > 0 ? (v / gdp) * 100 : null);

/** Arrays here are chart columns keyed by periodKeys; never a lookup by fiscal year. */
export function annualView(dataset, kind, outlook, key) {
  if (!dataset) return dataset;
  const records = PERIODS.filter((p) => !FRAMEWORK.includes(key) || FRAMEWORK.includes(p.key))
    .map((p) => selectPeriod(dataset, p.key))
    .filter((p) => p.available);
  const periodKeys = records.map((p) => p.periodKey),
    years = records.map((p) => p.year);
  const vintage = records.map((p) => (p.legacy ? p.vintage : p.status));
  const meta = {
    ...dataset.meta,
    ...(FRAMEWORK.includes(key)
      ? {
          title: {
            outlook: 'Рамка на КФП и макропрогноза 2027–2029',
            revenue: 'Приходи на КФП 2027–2029',
            expenditure: 'Разходи на КФП 2027–2029',
          }[kind],
          sourceNote:
            'МФ, АСБП 2027–2029, публикация от 06.11.2026. Проект за 2027 и прогнози за 2028–2029.',
        }
      : {}),
    source: FRAMEWORK.includes(key)
      ? ['budget2027']
      : dataset.byPeriod
        ? [...new Set([...(dataset.meta?.source || []), 'budget2027'])]
        : dataset.meta?.source,
    asOf: selectPeriod(dataset, key).publication || dataset.meta?.asOf,
  };
  const base = { ...dataset, meta, periodKeys, years, vintage, records, notes: [], versions: [] };
  const chartSeries = (fn, legacy) =>
    records.map((p) => (p.legacy ? (legacy(p.column) ?? null) : (fn(p) ?? null)));
  if (kind === 'outlook') {
    const kfp = Object.fromEntries(
      ['revenue', 'expenditure', 'balance', 'interest', 'financing', 'primaryBalance'].map(
        (key) => [
          key,
          {
            mln: chartSeries(
              (p) => value(p.series?.[key]),
              (i) => dataset.kfp?.[key]?.mln?.[i],
            ),
            pctGdp: chartSeries(
              (p) =>
                value(p.printedPctGdp?.[key]) ??
                pctOf(value(p.series?.[key]), value(p.series?.gdp)),
              (i) => dataset.kfp?.[key]?.pctGdp?.[i],
            ),
          },
        ],
      ),
    );
    const gdp = chartSeries(
      (p) => value(p.series?.gdp),
      (i) => dataset.gdp?.mlnPrecise?.[i] ?? dataset.gdp?.mln?.[i],
    );
    const macroRows = (dataset.macroRows || []).map((row) => ({
      ...row,
      values: chartSeries(
        (p) => value(p.macro?.find((r) => norm(r.label) === norm(row.label))?.cell),
        (i) => row.values?.[i],
      ),
    }));
    return {
      ...base,
      kfp,
      gdp: { ...dataset.gdp, mln: gdp, mlnPrecise: gdp },
      macroRows,
      macroAsOf: meta.asOf,
      macroVintage: records.map((p) =>
        p.legacy ? dataset.macroVintage?.[p.column] || p.vintage : 'forecast',
      ),
    };
  }
  const physical = (p, row) => p.rows?.find((r) => r.id === row)?.cell;
  const rowsTemplate = kind === 'revenue' ? dataset.rows : dataset.economic?.rows;
  const lawRows =
    kind === 'revenue'
      ? {
          'r.total': 0,
          'r.tax': 1,
          'r.direct': 2,
          'r.indirect': 3,
          'r.social': 4,
          'r.othertax': 5,
          'r.nontax': 6,
          'r.grants': 7,
        }
      : {
          'x.total': 8,
          'x.nonint': 9,
          'x.current': 10,
          'x.capex': 11,
          'x.abroad': 12,
          'x.contingency': 13,
          'x.interest': 14,
          'x.eucontrib': 15,
        };
  const rows = (rowsTemplate || []).map((row, ordinal) => {
    const at = (p) => {
      if (p.status === 'law') {
        if (row.id === 'x.exp') {
          const total = value(physical(p, 'annex1_execution2026.r8')),
            eu = value(physical(p, 'annex1_execution2026.r15'));
          return total != null && eu != null ? total - eu : null;
        }
        return value(physical(p, 'annex1_execution2026.r' + lawRows[row.id]));
      }
      return value(physical(p, 'annex3_mln.r' + (ordinal + (kind === 'revenue' ? 0 : 31))));
    };
    return {
      ...row,
      mln: chartSeries(at, (i) => row.mln?.[i]),
      pctGdp: chartSeries(
        (p) => {
          const id = 'annex3_mln.r' + (ordinal + (kind === 'revenue' ? 0 : 31));
          return p.status === 'law' ? null : value(p.rows?.find((r) => r.id === id)?.printedPctGdp);
        },
        (i) => row.pctGdp?.[i],
      ),
    };
  });
  if (kind === 'revenue') {
    const groups = (dataset.groups || []).map((group) => ({
      ...group,
      mln: chartSeries(
        (p) => value(p.groups?.[group.id]),
        (i) => group.mln?.[i],
      ),
      pctGdp: records.map((p) =>
        p.legacy
          ? (group.pctGdp?.[p.column] ?? null)
          : pctOf(
              value(p.groups?.[group.id]),
              value(selectPeriod(outlook, p.periodKey).series?.gdp),
            ),
      ),
    }));
    return {
      ...base,
      rows,
      groups,
      total: rows.find((r) => r.id === 'r.total') || { mln: [], pctGdp: [] },
    };
  }
  const F = dataset.functions || {};
  const items = (F.items || []).map((item) => ({
    ...item,
    parts: [],
    mln: records.map((p) =>
      p.legacy ? null : value(p.functions?.find((r) => norm(r.label) === norm(item.name))?.cell),
    ),
    pctGdp: records.map((p) =>
      p.legacy
        ? null
        : value(p.functions?.find((r) => norm(r.label) === norm(item.name))?.printedPctGdp),
    ),
  }));
  return {
    ...base,
    economic: { ...dataset.economic, rows, years, vintage, periodKeys },
    functions: {
      ...F,
      items,
      years,
      vintage,
      periodKeys,
      yearLabels: records.map(
        (p) => PERIODS.find((x) => x.key === p.periodKey)?.label || p.periodKey,
      ),
      totalMln: rows.find((r) => r.id === 'x.exp')?.mln || [],
      totalPctGdp: rows.find((r) => r.id === 'x.exp')?.pctGdp || [],
      reconcile: {},
      notes: [],
      versions: [],
    },
  };
}

/** Core is a view of the pinned annual dataset; monthly execution remains explicitly 2026 law. */
export function annualCore(core, outlook, revenue, expenditure, key) {
  if (!core || !outlook) return core;
  const p = selectPeriod(outlook, key);
  if (!p.available || p.legacy) return core;
  const number = (name) => value(p.series?.[name]);
  const kpis = {
    ...core.kpis,
    year: p.year,
    gdp: { mln: number('gdp'), mlnPrecise: number('gdp') },
  };
  for (const [name, source] of [
    ['revenue', 'revenue'],
    ['expenditure', 'expenditure'],
    ['balance', 'balance'],
  ]) {
    kpis[name] = {
      ...core.kpis[name],
      planMln: number(source),
      pctGdp: value(p.printedPctGdp?.[source]),
    };
  }
  const x = selectPeriod(expenditure, key),
    r = selectPeriod(revenue, key);
  return {
    ...core,
    kpis,
    revenueGroups:
      r.available && r.groups
        ? (core.revenueGroups || []).map((g) => ({
            ...g,
            mln: value(r.groups[g.id]),
            share: pctOf(value(r.groups[g.id]), number('revenue')),
          }))
        : [],
    functions:
      x.available && x.functions
        ? (core.functions || []).map((g) => ({
            ...g,
            mln: value(x.functions.find((f) => norm(f.label) === norm(g.name))?.cell),
            pctGdp: value(x.functions.find((f) => norm(f.label) === norm(g.name))?.printedPctGdp),
            share: pctOf(
              value(x.functions.find((f) => norm(f.label) === norm(g.name))?.cell),
              sum(x.functions.map((f) => value(f.cell))),
            ),
            yoyPct: null,
          }))
        : [],
  };
}
