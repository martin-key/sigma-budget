import { annualSource } from '../ui/annual-source.js';
import { stateDebt } from '../budget-2027.js';
import { periodIndex, previousPeriodIndex } from '../annual.js';
import { selectPeriod } from '../periods.js';
import { annualGap } from '../ui/annual.js';
// S13 · Накъде вървим? 2026–2029 · #/prognoza · next S17 · periods all
// Data: outlook.json (D01+D02+D15: the fiscal frame 2024–2028 and the macro forecast, from the motives of the bill) and, when it
// exists, debt.json (D13: government debt, `zdd`). Every figure on the screen is read or computed from those files; a missing
// file gives a „Предстои“ state, never a number. The charts and the tiles honour „% от БВП“ / „на човек“ (view.chartUnit, kpi).
// The shell has no unit control, so the screen carries its own („Покажи сумите в“) and writes the shared `unit` preference.
import { html, esc } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { chart } from '../ui/chart.js';
import { dataTable } from '../ui/table.js';
import { seg } from '../ui/seg.js';
import { disclosure } from '../ui/disclosure.js';
import { callout } from '../ui/cards.js';
import { gl } from '../ui/gl.js';
import { pendingState } from '../ui/states.js';
import { yIndex, change, chartUnit } from '../view.js';
import { num, pct, money, date, DASH, NBSP } from '../format.js';

export const needs = ['budget2027-provenance?', 'core', 'outlook', 'budget2027?'];
export const styles = ['s13-prognoza'];

/* ---------------------------------------------------------------- words and small helpers */
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
/** under the year on the axis (a line break keeps five categories readable on a phone) */
const WORD = {
  law: 'закон',
  expected: 'очаквано',
  draft: 'проект',
  actual: 'отчет',
  prelim: 'предв.\nотчет',
  plan: 'план',
  forecast: 'прогноза',
};
const LONG = {
  law: 'Приет закон',
  expected: 'Оценка на МФ, не отчет',
  draft: 'Проект на МФ',
  actual: 'Отчет',
  prelim: 'Предварителен отчет',
  plan: 'План по проекта',
  forecast: 'Прогноза',
};
/** lower-cases only the first letter, so „МФ“ stays an abbreviation inside a sentence */
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (a, n) =>
  Array.isArray(a) && a.length === n ? a : Array.from({ length: n }, () => null);
const pick = (a, i) => (Array.isArray(a) && ok(a[i]) ? a[i] : null);
const maxAbs = (...lists) => Math.max(0, ...lists.flat().filter(ok).map(Math.abs));
const joinAnd = (parts) =>
  parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`;
/** „2026 г.“ with a no-break space, so that „г.“ never stands alone on a line */
const yr = (y) => `${y}${NBSP}г.`;
const yearsText = (ys) =>
  ys.length === 1 ? `${yr(ys[0])}` : `${ys.slice(0, -1).join(', ')} и ${yr(ys[ys.length - 1])}`;

/** everything the screen needs from outlook.json, in one place; arrays are aligned to `years` */
function frame(ctx) {
  const o = ctx.data.outlook;
  const years = Array.isArray(o.years) ? o.years : [];
  const n = years.length;
  const kinds = years.map((_, i) => (WORD[o.vintage?.[i]] ? o.vintage[i] : 'forecast'));
  const ser = (key) => ({ mln: list(o.kfp?.[key]?.mln, n), pg: list(o.kfp?.[key]?.pctGdp, n) });
  const plan = periodIndex(o, ctx);
  const at = plan;
  return {
    o,
    sources: o.meta.source,
    years,
    n,
    kinds,
    plan,
    sel: at >= 0 ? at : Math.max(plan, 0),
    asOf: o.meta?.asOf,
    gdp: list(o.gdp?.mln, n),
    rev: ser('revenue'),
    exp: ser('expenditure'),
    bal: ser('balance'),
    int: ser('interest'),
    span: n ? `${years[0]}–${years[n - 1]}` : '',
  };
}

/** government debt aligned to the years of the outlook; null while debt.json is missing or has no usable series */
function debtOf(ctx, f) {
  const records = f.o.periodKeys.map((key) => stateDebt(ctx.data.budget2027, key));
  if (!records.some(Boolean)) return null;
  return {
    mln: records.map((r) => r?.total?.value ?? null),
    pg: records.map((r) => r?.pctGdp?.value ?? null),
    origins: records.map((r) => r?.total?.provenance || ''),
  };
}

/** the year on the axis, then what kind of numbers it is */
const cats = (f) => f.years.map((y, i) => `${y}\n${WORD[f.kinds[i]]}`);
/** „1,06 млрд. €“ or „0,8% от БВП“, as the chart currently shows it */
const unitTxt = (u, v) =>
  !ok(v) ? DASH : u.kind === 'pct' ? `${pct(v, u.d)} от БВП` : `${u.fmt(v)}${NBSP}${u.unit}`;

/** a line that is dashed where the numbers are a forecast is drawn as two series with one colour (ECharts cannot dash a part of one series) */
const FC = ' (прогноза)';
const baseName = (n) => (String(n).endsWith(FC) ? String(n).slice(0, -FC.length) : String(n));
function splitLine(f, name, vals, color) {
  const k = firstForecast(f); // index of the first forecast point
  if (k == null) return [{ name, data: vals, color }];
  if (k < 1) return [{ name: name + FC, data: vals, color, dashed: true }];
  const cut = k - 1; // the last point that is not a forecast: both halves meet there
  return [
    { name, data: vals.map((v, i) => (i <= cut ? v : null)), color },
    { name: name + FC, data: vals.map((v, i) => (i >= cut ? v : null)), color, dashed: true },
  ];
}

/** tooltip: the year and the kind of numbers in the heading, one row per series with its unit */
const tip = (f, u) => (ps) => {
  const seen = new Set();
  const rows = []
    .concat(ps)
    .filter((p) => ok(p.value))
    .sort(
      (a, b) =>
        Number(String(a.seriesName).endsWith(FC)) - Number(String(b.seriesName).endsWith(FC)),
    )
    .filter((p) => {
      const k = baseName(p.seriesName);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (!rows.length) return '';
  const i = rows[0].dataIndex;
  const sw = (c) =>
    `<span style="display:inline-block;width:10px;height:10px;border-radius:var(--r-1);margin-right:6px;background:${esc(c)}"></span>`;
  return (
    `<div style="font-weight:700;margin-bottom:4px">${esc(`${yr(f.years[i])} · ${LONG[f.kinds[i]]}`)}</div>` +
    rows
      .map(
        (p) =>
          `<div style="display:flex;gap:12px;justify-content:space-between;align-items:center"><span>${sw(p.color)}${esc(baseName(p.seriesName))}</span><b style="font-variant-numeric:tabular-nums">${esc(unitTxt(u, p.value))}</b></div>`,
      )
      .join('')
  );
};

/** one plain sentence about a series: the accessible name of the chart and the text of „Сподели“ */
function describe(name, verbs, years, vals, tx) {
  const pts = vals.map((v, i) => ({ v, y: years[i] })).filter((p) => ok(p.v));
  if (pts.length < 2) return '';
  const a = pts[0],
    b = pts[pts.length - 1];
  const rises = pts.every((p, i) => !i || p.v >= pts[i - 1].v),
    falls = pts.every((p, i) => !i || p.v <= pts[i - 1].v);
  if (rises && falls) return `${name}: ${tx(a.v)} във всички години.`;
  if (rises || falls)
    return `${name} ${rises ? verbs[0] : verbs[1]} от ${tx(a.v)} през ${yr(a.y)} до ${tx(b.v)} през ${yr(b.y)}`;
  const hi = Math.max(...pts.map((p) => p.v)),
    lo = Math.min(...pts.map((p) => p.v));
  const when = (x) => yearsText(pts.filter((p) => p.v === x).map((p) => p.y));
  return `${name}: най-голямата стойност е ${tx(hi)} през ${when(hi)}, най-малката — ${tx(lo)} през ${when(lo)}.`;
}
const PLURAL = ['растат', 'намаляват'],
  SINGULAR = ['расте', 'намалява'];

/** the table twin of a chart: the published numbers, always in млн. € and % от БВП, whatever the chart shows */
function twin(f, items) {
  const columns = [
    { key: 'y', label: 'Година' },
    { key: 'v', label: 'Вид данни' },
  ];
  items.forEach((it, k) =>
    columns.push(
      { key: `m${k}`, label: it.name, unit: 'млн. €', d: 1, num: true },
      { key: `p${k}`, label: it.name, unit: '% от БВП', d: 1, num: true },
      { key: `src${k}`, label: `${it.name}: произход`, csvOnly: true },
    ),
  );
  const rows = f.years.map((y, i) => {
    const r = {
      y: String(y),
      v: LONG[f.kinds[i]],
      _status: f.kinds[i] === 'forecast' ? 'forecast' : 'real',
    };
    items.forEach((it, k) => {
      r[`m${k}`] = it.s.mln[i];
      r[`p${k}`] = it.s.pg[i];
      r[`src${k}`] =
        it.s.origins?.[i] ||
        f.o.records?.[i]?.series?.[
          {
            Приходи: 'revenue',
            Разходи: 'expenditure',
            Дефицит: 'balance',
            Салдо: 'balance',
            'Лихви по дълга': 'interest',
          }[it.name]
        ]?.provenance ||
        '';
    });
    return r;
  });
  return { columns, rows };
}
const scaled = (s, sign) => ({
  mln: s.mln.map((v) => (ok(v) ? v * sign : null)),
  pg: s.pg.map((v) => (ok(v) ? v * sign : null)),
});
const cv = (u, s) => s.mln.map((m, i) => u.conv(m, s.pg[i]));
const firstForecast = (f) => {
  const k = f.kinds.indexOf('forecast');
  return k >= 0 ? k : undefined;
};

/* ---------------------------------------------------------------- the four charts (one builder each, shared with the embed view) */
export function revExpChart(ctx, f = frame(ctx)) {
  const u = chartUnit(ctx, { pct: true, max: maxAbs(f.rev.mln, f.exp.mln) });
  const rev = cv(u, f.rev),
    exp = cv(u, f.exp),
    tx = (v) => unitTxt(u, v);
  return {
    id: 's13-rev-exp',
    type: 'line',
    title: `Приходи и разходи, ${f.span}`,
    sub: u.unit,
    categories: cats(f),
    categoryLabel: 'Година',
    min: 0,
    d: u.d,
    fmt: u.fmt,
    height: 300,
    option: { ...u.option(), tooltip: { formatter: tip(f, u) } },
    series: [...splitLine(f, 'Приходи', rev, '--rev'), ...splitLine(f, 'Разходи', exp, '--exp')],
    desc: `${describe('Приходите', PLURAL, f.years, rev, tx)} ${describe('Разходите', PLURAL, f.years, exp, tx)}`.trim(),
    table: twin(f, [
      { name: 'Приходи', s: f.rev },
      { name: 'Разходи', s: f.exp },
    ]),
  };
}

/** columns by the kind of numbers: reported (отчет, предварителен отчет), plan of the bill, forecast */
const grpOf = (k) =>
  k === 'actual' || k === 'prelim'
    ? 'rep'
    : ['plan', 'law', 'draft'].includes(k)
      ? 'plan'
      : k === 'expected'
        ? 'expected'
        : 'fc';
function groupNames(f) {
  const rep = new Set(f.kinds.filter((k) => grpOf(k) === 'rep'));
  const planYears = f.years.filter((_, i) => ['plan', 'law', 'draft'].includes(f.kinds[i]));
  const planKinds = new Set(f.kinds.filter((k) => ['plan', 'law', 'draft'].includes(k)));
  return {
    rep:
      rep.size === 2
        ? 'Отчет и предварителен отчет'
        : rep.has('prelim')
          ? LONG.prelim
          : LONG.actual,
    plan:
      planYears.length === 1
        ? `${planKinds.has('draft') ? 'Проект' : planKinds.has('law') ? 'Закон' : 'План'} за ${yr(planYears[0])}`
        : 'Закон и проект',
    expected: LONG.expected,
    fc: LONG.forecast,
  };
}
function barsByKind(ctx, f, o) {
  const u = chartUnit(ctx, { pct: true, max: maxAbs(o.s.mln) });
  const vals = cv(u, o.s),
    names = groupNames(f),
    tx = (v) => unitTxt(u, v);
  const groups = [
    { g: 'rep', color: '--data' }, // series-1 is the same near-black as --data, so plans and limits use series 5
    { g: 'plan', color: 5 },
    { g: 'expected', color: 2 },
    { g: 'fc', color: 'other' },
  ].filter((x) => f.kinds.some((k) => grpOf(k) === x.g));
  return {
    id: o.id,
    type: 'bar',
    stack: true,
    title: `${o.title}, ${f.span}`,
    sub: u.unit,
    categories: cats(f),
    categoryLabel: 'Година',
    min: o.min,
    d: u.d,
    fmt: u.fmt,
    height: 300,
    option: { ...u.option(), tooltip: { formatter: tip(f, u) } },
    series: groups.map((x) => ({
      name: names[x.g],
      color: x.color,
      data: vals.map((v, i) => (grpOf(f.kinds[i]) === x.g ? v : null)),
    })),
    desc: describe(o.noun, o.verbs, f.years, vals, tx),
    table: twin(f, [{ name: o.title, s: o.s }]),
  };
}
/** the deficit is drawn as a positive size („Дефицит“) when every year is a deficit; any surplus turns it into the plain signed balance */
const allDeficit = (f) => f.bal.mln.some(ok) && f.bal.mln.every((v) => !ok(v) || v <= 0);
export function deficitChart(ctx, f = frame(ctx)) {
  const def = allDeficit(f);
  return barsByKind(ctx, f, {
    id: 's13-deficit',
    title: def ? 'Дефицит' : 'Салдо',
    noun: def ? 'Дефицитът' : 'Салдото',
    verbs: SINGULAR,
    s: scaled(f.bal, def ? -1 : 1),
    min: def ? 0 : undefined,
  });
}
export function interestChart(ctx, f = frame(ctx)) {
  return barsByKind(ctx, f, {
    id: 's13-interest',
    title: 'Лихви по дълга',
    noun: 'Лихвите',
    verbs: PLURAL,
    s: f.int,
    min: 0,
  });
}
export function debtChart(ctx, f = frame(ctx), d = debtOf(ctx, f)) {
  if (!d) return null;
  const u = chartUnit(ctx, { pct: d.pg.some(ok), max: maxAbs(d.mln) });
  const vals = cv(u, d),
    tx = (v) => unitTxt(u, v);
  return {
    id: 's13-debt',
    type: 'line',
    title: `Държавен дълг, ${f.span}`,
    sub: u.unit,
    categories: cats(f),
    categoryLabel: 'Година',
    min: 0,
    d: u.d,
    fmt: u.fmt,
    height: 300,
    option: { ...u.option(), tooltip: { formatter: tip(f, u) } },
    series: splitLine(f, 'Държавен дълг', vals, '--data'),
    desc: describe('Държавният дълг', SINGULAR, f.years, vals, tx),
    table: twin(f, [{ name: 'Държавен дълг', s: d }]),
  };
}
/** what the embed view gets while debt.json is missing: a spec with no data, which chart() turns into the standard empty state */
const noDebt = {
  id: 's13-debt',
  type: 'line',
  title: 'Държавен дълг',
  categories: [],
  series: [{ name: 'Държавен дълг', data: [] }],
  emptyText: 'Числата за дълга по години още не са включени.',
};

export const embeds = {
  's13-rev-exp': (ctx) => ({
    chart: revExpChart(ctx),
    source: ctx.data.outlook.meta.source,
    asOf: ctx.data.outlook.meta?.asOf,
    status: 'forecast',
  }),
  's13-deficit': (ctx) => ({
    chart: deficitChart(ctx),
    source: ctx.data.outlook.meta.source,
    asOf: ctx.data.outlook.meta?.asOf,
    status: 'forecast',
  }),
  's13-interest': (ctx) => ({
    chart: interestChart(ctx),
    source: ctx.data.outlook.meta.source,
    asOf: ctx.data.outlook.meta?.asOf,
    status: 'forecast',
  }),
  's13-debt': (ctx) => ({
    chart: debtChart(ctx) || noDebt,
    source: ctx.data.outlook.meta.source,
    asOf: ctx.data.outlook.meta?.asOf,
    status: 'forecast',
  }),
};

/* ---------------------------------------------------------------- „Накратко“: plain sentences computed from the numbers */
function points(f, d) {
  const out = [];
  const i = f.plan >= 0 ? f.plan : f.sel,
    y = f.years[i],
    k = f.kinds[i];
  const withPg = (m, g) => `${money(m)}${ok(g) ? ` (${pct(g, 1)} от БВП)` : ''}`;
  const rv = f.rev.mln[i],
    ex = f.exp.mln[i],
    bl = f.bal.mln[i];
  const lead =
    k === 'plan' ? `По проекта на бюджета за ${yr(y)}` : `За ${yr(y)} (${lowerFirst(LONG[k])})`;
  if (ok(rv) && ok(ex))
    out.push(
      `${lead} приходите са ${withPg(rv, f.rev.pg[i])}, а разходите — ${withPg(ex, f.exp.pg[i])}.`,
    );

  if (ok(bl)) {
    const g = f.bal.pg[i],
      share = ok(g) ? ` — ${pct(Math.abs(g), 1)} от БВП` : '';
    out.push(
      bl < 0
        ? `Разходите са повече от приходите с ${money(-bl)}. Това е дефицит${share}.`
        : bl > 0
          ? `Приходите са повече от разходите с ${money(bl)}. Това е излишък${share}.`
          : 'Приходите и разходите са равни.',
    );
  }

  const fc = f.years
    .map((_, j) => j)
    .filter((j) => j > i && f.kinds[j] === 'forecast' && ok(f.bal.mln[j]));
  if (ok(bl) && fc.length) {
    const seq = [bl, ...fc.map((j) => f.bal.mln[j])];
    if (seq.every((v) => v <= 0)) {
      const mags = seq.map(Math.abs);
      const parts = fc.map(
        (j) =>
          `${withPg(Math.abs(f.bal.mln[j]), ok(f.bal.pg[j]) ? Math.abs(f.bal.pg[j]) : null)} през ${yr(f.years[j])}`,
      );
      const dec = mags.every((m, n) => !n || m < mags[n - 1]),
        inc = mags.every((m, n) => !n || m > mags[n - 1]);
      out.push(
        dec || inc
          ? `Очаква се дефицитът да ${dec ? 'намалява' : 'нараства'}: ${joinAnd(parts)}`
          : `Прогнозата за дефицита е ${joinAnd(parts)}`,
      ); // the parts end with „г.“, which closes the sentence
    } else {
      out.push(
        `Прогноза за салдото: ${joinAnd(fc.map((j) => `${money(f.bal.mln[j])} през ${yr(f.years[j])}`))}`,
      );
    }
  }

  const last = f.years
    .map((_, j) => j)
    .filter((j) => j > i && ok(f.int.mln[j]))
    .pop();
  const ia = f.int.mln[i];
  if (ok(ia) && last != null) {
    const ib = f.int.mln[last],
      A = withPg(ia, f.int.pg[i]),
      B = withPg(ib, f.int.pg[last]);
    out.push(
      ib === ia
        ? `Лихвите по дълга са ${money(ia)} през ${yr(y)} и ${money(ib)} през ${yr(f.years[last])}`
        : `Лихвите по дълга ${ib > ia ? 'растат' : 'намаляват'}: от ${A} през ${yr(y)} до ${B} през ${yr(f.years[last])}`,
    );
  }

  if (d) {
    const dl = f.years
      .map((_, j) => j)
      .filter((j) => j > i && ok(d.mln[j]))
      .pop();
    if (ok(d.mln[i]) && dl != null)
      out.push(
        `Държавният дълг е ${withPg(d.mln[i], d.pg[i])} през ${yr(y)} и ${withPg(d.mln[dl], d.pg[dl])} през ${yr(f.years[dl])} (прогноза).`,
      );
  }

  // the economy behind the budget: real growth and inflation, from the macro frame
  const row = (id) =>
    Array.isArray(f.o.macroRows) ? f.o.macroRows.find((r) => r.id === id) : null;
  const z = f.n - 1,
    yl = f.years[z],
    gr = row('gdpGrowth'),
    hi = row('hicp');
  const g0 = pick(gr?.values, i),
    g1 = pick(gr?.values, z),
    h0 = pick(hi?.values, i),
    h1 = pick(hi?.values, z);
  const eco = [];
  if (z > i && ok(g0) && ok(g1))
    eco.push(
      g0 >= 0 && g1 >= 0
        ? `Очаква се икономиката да расте с ${pct(g0, 1)} през ${yr(y)} и с ${pct(g1, 1)} през ${yr(yl)}`
        : `Реалният растеж на БВП е ${pct(g0, 1)} през ${yr(y)} и ${pct(g1, 1)} през ${yr(yl)}`,
    );
  if (z > i && ok(h0) && ok(h1))
    eco.push(
      h1 === h0
        ? `Очаква се инфлацията да е ${pct(h0, 1)} през ${yr(y)} и през ${yr(yl)}`
        : `Очаква се инфлацията да ${h1 < h0 ? 'спадне' : 'се повиши'} от ${pct(h0, 1)} през ${yr(y)} до ${pct(h1, 1)} през ${yr(yl)}`,
    );
  if (eco.length) out.push(eco.join(' '));
  return out;
}

function summaryBlock(ctx, f, d) {
  const pts = points(f, d);
  const note = callout({
    kind: 'info',
    title: 'Чии са тези числа?',
    body: html`<p>${annualSource(ctx, f.o)}</p>`,
  });
  return block({
    id: 's13-sum',
    title: 'Накратко',
    scope: 'kfp',
    status: 'forecast',
    statusLabel: f.years[0] === 2027 ? 'Проект и прогноза' : 'Закон, оценка и прогноза',
    source: f.sources,
    asOf: f.asOf,
    share: { text: pts.join(' ') },
    body: html`<div class="s13-sum stack">
      ${pts.length ? html`<ul class="s13-points" data-gl-scan>${pts.map((t) => html`<li>${t}</li>`)}</ul>` : pendingState({ title: 'Накратко', text: 'Числата за приходите и разходите още не са налични.' })}
      ${note}
    </div>`,
  });
}

/* ---------------------------------------------------------------- controls and tiles */
function controls(ctx) {
  return html`<div class="s13-controls">
    <span class="s13-controls-label">Покажи сумите в:</span>
    ${seg({
      name: 's13-unit',
      label: 'Покажи сумите в',
      value: ctx.store.get('unit'),
      options: [
        { value: 'eur', label: 'В евро' },
        { value: 'pct', label: '% от БВП' },
      ],
    })}
    <p class="s13-howto small muted">Под всяка година пише какви са числата: отчет, предварителен отчет, план по проекта или прогноза. Пунктирът в линиите и сивите колони показват прогноза.</p>
  </div>`;
}

/** change against the previous year: percent in money mode, percentage points in „% от БВП“ mode */
function tileDelta(showPct, cur, prev, curG, prevG, prevYear) {
  if (prevYear == null) return null;
  const label = `спрямо ${yr(prevYear)}`;
  if (showPct)
    return ok(curG) && ok(prevG) ? { value: curG - prevG, d: 1, unit: 'пр.п.', label } : null;
  const c = change(cur, prev);
  return c == null ? null : { value: c, d: 1, unit: '%', label };
}

function kpiBlock(ctx, f, debt) {
  const i = f.sel,
    p = previousPeriodIndex(f.o, ctx),
    kind = f.kinds[i],
    inPct = ctx.store.get('unit') === 'pct';
  const prevYear = p >= 0 ? f.years[p] : null;
  /** one tile from a млн. € series (+ % от БВП); `sign` turns a negative balance into the size of the deficit */
  const tile = (label, mln, pg, o = {}) => {
    const sign = o.sign ?? 1;
    const cur = ok(mln?.[i]) ? mln[i] * sign : null,
      curG = ok(pg?.[i]) ? pg[i] * sign : null;
    const prev = p >= 0 && ok(mln?.[p]) ? mln[p] * sign : null,
      prevG = p >= 0 && ok(pg?.[p]) ? pg[p] * sign : null;
    const showPct = inPct && ok(curG);
    const same = cur == null || prev == null || cur >= 0 === prev >= 0; // a deficit that turned into a surplus has no meaningful percent change
    return kpi({
      label,
      gl: o.gl,
      scope: o.scope,
      mln: cur,
      pctGdp: curG,
      delta: same ? tileDelta(showPct, cur, prev, curG, prevG, prevYear) : null,
      sub:
        o.sub ??
        (showPct ? (ok(cur) ? money(cur) : null) : ok(curG) ? `${pct(curG, 1)} от БВП` : null),
    });
  };
  const bal = f.bal.mln[i];
  const balTile =
    ok(bal) && bal > 0
      ? tile('Излишък', f.bal.mln, f.bal.pg, { gl: 'byudzheten-izlishak' })
      : ok(bal) && bal < 0
        ? tile('Дефицит', f.bal.mln, f.bal.pg, { sign: -1, gl: 'byudzheten-defitsit' })
        : tile('Салдо', f.bal.mln, f.bal.pg, { gl: 'byudzhetno-saldo' });

  // A matching year alone cannot establish the publication or status of debt.
  let dm = null,
    dg = null,
    dpm = null,
    dpg = null,
    dsub = 'Няма съпоставими данни за дълга за избрания период.';
  if (debt) {
    dm = debt.mln[i];
    dg = debt.pg[i];
    dpm = p >= 0 ? debt.mln[p] : null;
    dpg = p >= 0 ? debt.pg[p] : null;
    dsub = ok(dm) ? null : 'Няма съпоставими данни за дълга за избрания период.';
  }
  const dShow = inPct && ok(dg);
  const debtTile = kpi({
    label: 'Държавен дълг',
    gl: 'darzhaven-dalg',
    scope: 'zdd',
    mln: dm,
    pctGdp: dg,
    delta: tileDelta(dShow, dm, dpm, dg, dpg, prevYear),
    sub: dsub ?? (dShow ? (ok(dm) ? money(dm) : null) : ok(dg) ? `${pct(dg, 1)} от БВП` : null),
  });

  const gdp = kpi({
    label: 'БВП',
    gl: 'bvp',
    mln: f.gdp[i],
    delta: tileDelta(false, f.gdp[i], p >= 0 ? f.gdp[p] : null, null, null, prevYear),
  });
  const year = f.years[i];
  return block({
    id: 's13-kpis',
    title: `Числата за ${yr(year)}`,
    scope: 'kfp',
    status: kind === 'forecast' ? 'forecast' : 'real',
    statusLabel: LONG[kind],
    sub: `${LONG[kind]}.${p >= 0 ? ` Сравнението е с ${yr(prevYear)} (${lowerFirst(LONG[f.kinds[p]])}).` : ''}`,
    source: f.sources,
    asOf: f.asOf,
    share: {
      text: `${yr(year)} (${lowerFirst(LONG[kind])}): приходи ${money(f.rev.mln[i])}, разходи ${money(f.exp.mln[i])}.`,
    },
    body: kpiGrid(
      [
        tile('Приходи', f.rev.mln, f.rev.pg),
        tile('Разходи', f.exp.mln, f.exp.pg),
        balTile,
        debtTile,
        tile('Лихви по дълга', f.int.mln, f.int.pg, { gl: 'lihva' }),
        gdp,
      ],
      { label: `Основни числа за ${yr(year)}` },
    ),
  });
}

/* ---------------------------------------------------------------- chart blocks */
function chartBlock(f, spec, o) {
  return block({
    id: o.id,
    title: o.title,
    sub: o.sub,
    scope: o.scope || 'kfp',
    status: 'forecast',
    statusLabel:
      f.years[0] === 2027 ? 'Проект 2027 и прогноза 2028–2029' : 'Отчет, закон, оценка и прогноза',
    source: f.sources,
    asOf: f.asOf,
    share: { text: spec.desc || o.sub, embed: spec.id },
    body: chart(spec),
  });
}
function debtBlock(ctx, f, d) {
  const spec = debtChart(ctx, f, d);
  if (spec)
    return chartBlock(f, spec, {
      id: 's13-b-debt',
      title: 'Държавен дълг',
      scope: 'zdd',
      sub: 'Таблица VI-1 на АСБП 2027–2029: прогноза за държавния дълг по ЗДД. Не е дългът на целия сектор „Държавно управление“.',
    });
  return block({
    id: 's13-b-debt',
    title: 'Държавен дълг',
    scope: 'zdd',
    status: 'pending',
    source: f.sources,
    sub: 'Колко е държавният дълг по години.',
    body: pendingState({
      title: 'Няма съпоставим периоден ред за дълга',
      text: 'Периодните данни за дълга още не са включени. Историческите публикации и законовите тавани са на отделния екран за дълга.',
      source: f.sources,
      action: { href: ctx.href('S17'), label: 'Към екрана за дълга', primary: false },
    }),
  });
}

/* ---------------------------------------------------------------- macro frame */
const macroKind = (f, i) => (f.o.macroVintage?.[i] === 'actual' ? 'отчет' : 'прогноза');
function macroBlock(ctx, f) {
  if (selectPeriod(ctx.annualRaw?.outlook, ctx.period.key).gaps?.macro)
    return annualGap(ctx, ctx.annualRaw.outlook, ['macro']);
  const o = f.o,
    i = f.sel,
    p = previousPeriodIndex(f.o, ctx);
  const rows = Array.isArray(o.macroRows) ? o.macroRows : [];
  const row = (id) => rows.find((r) => r.id === id);
  const real = o.macroVintage?.[i] === 'actual';
  const tile = (id, label, slug, sub) => {
    const r = row(id),
      v = pick(r?.values, i),
      pv = p >= 0 ? pick(r?.values, p) : null;
    return kpi({
      label,
      gl: slug,
      value: ok(v) ? pct(v, 1) : null,
      sub,
      delta:
        ok(v) && ok(pv)
          ? { value: v - pv, d: 1, unit: 'пр.п.', label: `спрямо ${yr(f.years[p])}` }
          : null,
    });
  };
  const toRow = (r) => ({
    n: `${r.short || r.label}, ${r.unit}`,
    level: r.level || 0,
    d: r.unit === 'млн. €' ? 0 : 1,
    ...Object.fromEntries(f.years.map((_, k) => [`y${k}`, pick(r.values, k)])),
  });
  const cols = (first = 'Показател') => [
    {
      key: 'n',
      label: first,
      fmt: (v, r) => (r.level ? html`<span class="s13-sub">${v}</span>` : v),
    },
    ...f.years.map((y, k) => ({
      key: `y${k}`,
      label: String(y),
      unit: macroKind(f, k),
      num: true,
      fmt: (v, r) => (ok(v) ? num(v, r.d) : DASH),
    })),
  ];
  const key = ['gdp', 'gdpGrowth', 'hicp', 'unemployment'].map(row).filter(Boolean).map(toRow);
  const groups = (Array.isArray(o.macroGroups) ? o.macroGroups : [])
    .map((g) => ({ g, rows: (g.rows || []).map(row).filter(Boolean).map(toRow) }))
    .filter((x) => x.rows.length);
  const more = groups.length
    ? disclosure({
        id: 's13-macro-more',
        title: 'Всички макропоказатели',
        meta: `${groups.reduce((a, x) => a + x.rows.length, 0)} реда`,
        body: html`<div class="stack">${groups.map(
          (x) => html`<section class="s13-group" aria-labelledby="s13-mg-${x.g.id}">
      <h3 class="s13-group-h" id="s13-mg-${x.g.id}">${x.g.name}</h3>
      ${dataTable({
        id: `s13-macro-${x.g.id}`,
        caption: `${x.g.name}, ${f.span}`,
        columns: cols('Показател'),
        rows: x.rows,
        dense: true,
        note: x.rows.some((r) => r.level)
          ? 'Редовете с отстъп са подредени под реалния растеж на БВП, както в таблицата на източника.'
          : null,
      })}
    </section>`,
        )}</div>`,
      })
    : '';
  return block({
    id: 's13-macro',
    title: 'Макроикономическа рамка',
    scope: 'kfp',
    status: real ? 'real' : 'forecast',
    statusLabel: real ? 'Отчет' : 'Прогноза',
    sub: `Очакванията за икономиката, на които се основава проектът на бюджет. Показани са числата за ${yr(f.years[i])} (${macroKind(f, i)}).`,
    source: f.sources,
    asOf: o.macroAsOf || f.asOf,
    share: {
      text: `Макроикономическа рамка, ${f.span}: реален растеж на БВП, инфлация (ХИПЦ) и безработица по години.`,
    },
    body: html`<div class="stack">
      ${kpiGrid(
        [
          tile(
            'gdpGrowth',
            'Реален растеж на БВП',
            'realen-rast',
            'Растеж на БВП без ефекта на цените',
          ),
          tile(
            'hicp',
            'Инфлация (ХИПЦ)',
            'inflatsiya',
            'Средногодишно поскъпване на потребителските стоки и услуги',
          ),
          tile('unemployment', 'Безработица', null, 'Дял на безработните от работната сила'),
        ],
        { label: `Макроикономически показатели за ${yr(f.years[i])}` },
      )}
      <p class="s13-howto small muted">Промяната е в ${gl('protsenten-punkt', 'процентни пунктове')} (пр.п.) спрямо предходната година.</p>
      ${key.length ? dataTable({ id: 's13-macro-key', caption: `Основни макропоказатели, ${f.span}`, columns: cols('Показател'), rows: key, dense: true }) : ''}
      ${more}
    </div>`,
  });
}

/* ---------------------------------------------------------------- notes and the two versions of the document */
/** the data's own wording, without the references to field names of the JSON file */
const clean = (t) =>
  String(t || '')
    .replace(/\s*Различията са в „versions“\./, '')
    .replace(/,? която е в „[^“]*“/, '')
    .trim()
    .replace(/(\d) (г\.|млн\.|млрд\.)/g, `$1${NBSP}$2`)
    .replace(/(млн\.|млрд\.) €/g, `$1${NBSP}€`); // „2026 г.“ and „4,3 млн. €“ never break in the middle
function notesBlock(f) {
  const o = f.o;
  const notes = (Array.isArray(o.notes) ? o.notes : []).filter((n) => n && n.text);
  const two = notes.find((n) => n.id === 'twoVersions');
  const rest = notes.filter((n) => n.id !== 'twoVersions');
  const vers = Array.isArray(o.versions) ? o.versions : [];
  const idx = f.years
    .map((_, k) => k)
    .filter((k) => vers.some((r) => ok(r.diff?.[k]) && Math.abs(r.diff[k]) > 1e-9));
  const vtable =
    vers.length && idx.length
      ? dataTable({
          id: 's13-versions-t',
          caption: `Разлика между внесения документ и проекта от юни 2026${NBSP}г., млн. евро`,
          columns: [
            { key: 'n', label: 'Ред' },
            ...idx.map((k) => ({
              key: `d${k}`,
              label: String(f.years[k]),
              unit: 'млн. €',
              num: true,
              fmt: (v) => (ok(v) ? num(v, 1, { sign: true }) : DASH),
            })),
          ],
          rows: vers.map((r) => ({
            n: r.label,
            ...Object.fromEntries(idx.map((k) => [`d${k}`, pick(r.diff, k)])),
          })),
          dense: true,
          note: `Разлика = внесеният документ минус проектът от юни 2026${NBSP}г. Всички суми са в млн. €.`,
        })
      : null;
  const disc = vtable
    ? disclosure({
        id: 's13-versions',
        title: 'Разлики между двете версии на документа',
        meta: `${vers.length} реда`,
        body: vtable,
      })
    : '';
  if (!rest.length && !two && !disc) return '';
  return block({
    id: 's13-notes',
    title: 'Бележки към числата',
    status: 'real',
    pill: false,
    report: false,
    source: f.sources,
    share: false,
    asOf: f.asOf,
    body: html`<div class="stack">
      ${rest.length ? html`<ul class="s13-notes" data-gl-scan>${rest.map((n) => html`<li>${clean(n.text)}</li>`)}</ul>` : ''}
      ${two ? html`<p class="s13-note-two" data-gl-scan>${clean(two.text)}${disc ? ' Разликите са в таблицата по-долу.' : ''}</p>` : ''}
      ${disc}
    </div>`,
  });
}

/* ---------------------------------------------------------------- the screen */
/** for search and answer engines (js/seo.js): the sentences of the „Накратко“ block */
export const question = 'Какви са приходите, разходите и дефицитът на бюджета до 2029 г.?';
export function answer(ctx) {
  const f = frame(ctx);
  return f
    ? points(f, debtOf(ctx, f))
        .map((t) => String(t))
        .join(' ')
    : '';
}

export function render(ctx) {
  const f = frame(ctx),
    d = debtOf(ctx, f);
  const rev = revExpChart(ctx, f),
    def = deficitChart(ctx, f),
    int = interestChart(ctx, f);
  return {
    title: f.years[0] === 2027 ? 'Накъде вървим? 2027–2029' : 'Накъде вървим? 2026–2029',
    body: html`
      ${summaryBlock(ctx, f, d)}
      ${controls(ctx)}
      ${kpiBlock(ctx, f, d)}
      ${chartBlock(f, rev, { id: 's13-b-rev-exp', title: 'Приходи и разходи', sub: 'Колко държавата планира да събере и колко да похарчи по години.' })}
      ${chartBlock(f, def, { id: 's13-b-deficit', title: def.title, sub: allDeficit(f) ? 'Колко повече се харчи, отколкото се събира, по години.' : 'Разликата между приходите и разходите по години.' })}
      ${chartBlock(f, int, { id: 's13-b-interest', title: 'Лихви по дълга', sub: 'Колко се плаща за лихви по дълга по години.' })}
      ${debtBlock(ctx, f, d)}
      ${macroBlock(ctx, f)}
      ${notesBlock(f)}`,
  };
}

export function mount(root, ctx) {
  const onChange = (e) => {
    const t = e.target;
    if (t && t.name === 's13-unit' && t.checked) ctx.store.set('unit', t.value);
  };
  root.addEventListener('change', onChange);
  return () => root.removeEventListener('change', onChange);
}
