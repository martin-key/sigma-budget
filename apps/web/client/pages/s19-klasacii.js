// S19 · Класации и сравнения · #/klasacii · next S24 · periods all (G3)
// Two views. „Топ 5 / 10“: eight rankings of the 2026 budget (functions and lines, growth over 2025, spenders, programmes, measures by
// effect, taxes, municipalities by transfer per resident, lines behind the 2025 execution pace). „Година срещу година“: any two years
// 2024–2028 side by side (difference in euro, in percent, as a share of GDP or per person).
// Every figure is read from the data sets in `needs` (expenditure D03/D04, revenue D05, outlook, ministries D08, programs D09, measures D12,
// municipalities D19, execution D06); nothing is typed from memory. An optional set that did not load makes only its own block pending.
// Controls live in the query: ?tab=top|godini · ?n=5|10 · ?kat=razhodi-fn|razhodi-vid|prihodi|kfp · ?a=2025 · ?b=2026
import { html } from '../html.js';
import { icon } from '../icons.js';
import { num, pct, pp, delta, date, monthName, NBSP, DASH, EUR_RATE } from '../format.js';
import { block } from '../ui/block.js';
import { callout } from '../ui/cards.js';
import { chips } from '../ui/chips.js';
import { field, selectInput } from '../ui/forms.js';
import { ranklist } from '../ui/ranklist.js';
import { seg } from '../ui/seg.js';
import { dataTable, tableData } from '../ui/table.js';
import { tabs } from '../ui/tabs.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';
import { pendingState } from '../ui/states.js';
import { moneyCol, change } from '../view.js';
import * as M from '../muni.js';

/* ------------------------------------------------------------------ constants */
const TABS = ['top', 'godini'];
const YEARS = [2024, 2025, 2026, 2027, 2028];
const KATS = [
  ['razhodi-fn', 'Разходи по функции'],
  ['razhodi-vid', 'Разходи по вид'],
  ['prihodi', 'Приходи по източник'],
  ['kfp', 'Приходи, разходи и салдо'],
];
const BASE_MIN = 100; // млн. €: a percent change from a smaller base is not ranked (a line of 2 млн. € „growing 90%“ says nothing)
const LAG_THR = 10; // пр.п.: the same rule as S15 on its default threshold
const LONG = 80; // a name longer than this is shown by its short form (as on S10)
const TAX_IDS = ['dds', 'osiguritelni', 'ddfl', 'akcizi', 'korporativen', 'drugi'];
const REV_ROWS = ['rev.tax', 'rev.nontax', 'rev.grants'];
const EXP_ROWS = [
  'exp.personnel',
  'exp.maint',
  'exp.interest',
  'exp.social',
  'exp.subsidies',
  'exp.capex',
  'exp.abroad',
  'exp.reserve',
];
const FLAT = { actual: 'отчет', prelim: 'предв. отчет', plan: 'план', forecast: 'прогноза' };
const VS = {
  actual: 'отчета',
  prelim: 'предварителния отчет',
  plan: 'плана',
  forecast: 'прогнозата',
};
const MLN = `${NBSP}млн.${NBSP}€`;
const SCOPE_MIN = {
  key: 'zdb-vedomstva',
  label: 'Бюджети на ведомствата',
  note: 'не е целият бюджет',
};
const SCOPE_PRG = {
  key: 'prb-programi',
  label: 'Програмни бюджети',
  note: 'без ЕС и други средства',
};
const SCOPE_MER = {
  key: 'merki-2026',
  label: 'Мерки за 2026 г.',
  note: 'ефект върху бюджетното салдо',
};

/* ------------------------------------------------------------------ small helpers */
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const r1 = (v) => Math.round(v * 10 + 1e-9) / 10;
const bgc = (a, b) => String(a).localeCompare(String(b), 'bg');
const pick = (v, list, d) => (list.includes(v) ? v : d);
const yr = (y) => `${y}${NBSP}г.`;
const shortName = (name, short) => (name.length <= LONG ? name : short || name);
const listNames = (names) =>
  names.length > 1
    ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
    : names[0] || '';
/** the explicit CSV/„Копирай“ table of a block whose printed value is not the raw one */
const twinOf = (columns, rows) => () => tableData({ columns, rows });

/** GDP in млн. € of a year: Annex 3 unrounded value (the percentages of the budget documents are computed from it), else the rounded one; the core value only for 2026 */
function gdpOf(ctx, year) {
  const o = ctx.data && ctx.data.outlook;
  const i = arr(o && o.years).indexOf(year);
  const g = o && o.gdp;
  const v =
    i >= 0
      ? [g && g.mlnPrecise && g.mlnPrecise[i], g && g.mln && g.mln[i]].find((x) => fin(x) && x > 0)
      : null;
  if (fin(v)) return v;
  const k = year === 2026 && ctx.core && ctx.core.kpis ? ctx.core.kpis.gdp : null;
  return k ? ([k.mlnPrecise, k.mln].find((x) => fin(x) && x > 0) ?? null) : null;
}
const pg = (ctx, mln, year) => {
  const g = gdpOf(ctx, year);
  return fin(mln) && g ? (mln / g) * 100 : null;
};
const personsOf = (ctx) => {
  const p = ctx.core && ctx.core.population && ctx.core.population.persons;
  return fin(p) && p > 0 ? p : null;
};
/** the data vintage of each year of the outlook: {2024:'actual', 2025:'prelim', 2026:'plan', 2027:'forecast', …} */
function kindsOf(ctx) {
  const o = ctx.data && ctx.data.outlook,
    out = {};
  arr(o && o.years).forEach((y, i) => {
    out[y] = arr(o.vintage)[i] ?? null;
  });
  return out;
}
const yearWord = (K, y) => (FLAT[K[y]] ? `${y} (${FLAT[K[y]]})` : String(y));

/** the amount of a change as the visitor reads it: млн. €, € на човек or пр.п. от БВП (follows „Показвай в“ and „на човек“), „и в лева“ as an addendum.
 *  → {kind, raw (rounded as shown: ranks, CSV), text, unitLabel} */
function dText(ctx, dMln, dPg) {
  const unit = ctx.store.get('unit'),
    per = ctx.store.get('perPerson'),
    lv = ctx.store.get('leva');
  if (unit === 'pct' && fin(dPg))
    return { kind: 'pct', raw: r1(dPg), text: pp(dPg, 1), unitLabel: 'пр.п. от БВП' };
  const persons = per ? personsOf(ctx) : null;
  if (persons && fin(dMln)) {
    const e = (dMln * 1e6) / persons;
    return {
      kind: 'person',
      raw: Math.round(e),
      text: `${num(e, 0, { sign: true })}${NBSP}€ на човек${lv ? ` (≈${NBSP}${num(e * EUR_RATE, 0, { sign: true })}${NBSP}лв.)` : ''}`,
      unitLabel: '€ на човек',
    };
  }
  if (!fin(dMln)) return { kind: 'mln', raw: null, text: DASH, unitLabel: 'млн. €' };
  return {
    kind: 'mln',
    raw: r1(dMln),
    unitLabel: 'млн. €',
    text: `${num(dMln, 1, { sign: true })}${MLN}${lv ? ` (≈${NBSP}${num(dMln * EUR_RATE, 1, { sign: true })}${NBSP}млн.${NBSP}лв.)` : ''}`,
  };
}
/** a plain amount in млн. € (not following „на човек“ / „% от БВП“: measures and lag are fixed units); „и в лева“ as an addendum */
function amt(ctx, v, d = 1, sign = false) {
  if (!fin(v)) return DASH;
  const eur = `${num(v, d, { sign })}${MLN}`;
  return ctx.store.get('leva')
    ? `${eur} (≈${NBSP}${num(v * EUR_RATE, d, { sign })}${NBSP}млн.${NBSP}лв.)`
    : eur;
}
const pendingBlock = (id, title, text, o = {}) =>
  block({
    id,
    title,
    status: 'pending',
    scope: o.scope,
    source: o.source,
    body: pendingState({ title, text, source: o.source }),
  });

/* ------------------------------------------------------------------ the query */
function ctl(ctx) {
  const q = ctx.query || {};
  const y = ctx.period && ctx.period.year;
  const dflt = YEARS.includes(y) ? (y === YEARS[0] ? [y, y + 1] : [y - 1, y]) : [2025, 2026];
  const yearOf = (v) => {
    const x = Number(v);
    return YEARS.includes(x) ? x : null;
  };
  return {
    tab: pick(q.tab, TABS, 'top'),
    n: Number(q.n) === 10 ? 10 : 5,
    kat: pick(
      q.kat,
      KATS.map((k) => k[0]),
      'razhodi-fn',
    ),
    a: yearOf(q.a) ?? dflt[0],
    b: yearOf(q.b) ?? dflt[1],
  };
}

/* ------------------------------------------------------------------ models (null = the data is not there: the block says „Предстои“) */
/** the nine functions and their 26 lines (the parts of a function; a function without parts is one line), 2025 „Програма“ → 2026 „Проект“ */
function fnModel(ctx) {
  const F = ctx.data.expenditure && ctx.data.expenditure.functions;
  if (!F || !arr(F.items).length) return null;
  const i25 = arr(F.years).indexOf(2025),
    i26 = arr(F.years).indexOf(2026);
  if (i25 < 0 || i26 < 0) return null;
  const at = (a) => ({ v: fin(arr(a)[i26]) ? a[i26] : null, p: fin(arr(a)[i25]) ? a[i25] : null });
  const fns = F.items
    .map((it) => ({ id: it.id, name: it.short || it.name, full: it.name, ...at(it.mln) }))
    .filter((x) => fin(x.v));
  const lines = [];
  for (const it of F.items) {
    const fn = it.short || it.name;
    if (arr(it.parts).length)
      for (const p of it.parts) {
        const x = at(p.mln);
        if (fin(x.v))
          lines.push({ id: it.id, name: cap(p.name), fn, sub: `във функция „${fn}“`, ...x });
      }
    else {
      const x = at(it.mln);
      if (fin(x.v)) lines.push({ id: it.id, name: fn, fn, sub: 'цялата функция', ...x });
    }
  }
  return {
    F,
    fns,
    lines,
    lab25: arr(F.yearLabels)[i25] || '2025',
    lab26: arr(F.yearLabels)[i26] || '2026',
    kind25: arr(F.vintage)[i25],
    asOf: ctx.data.expenditure.meta && ctx.data.expenditure.meta.asOf,
  };
}

/** the tax and contribution groups of the revenue (the other two groups are not taxes) */
function taxModel(ctx) {
  const R = ctx.data.revenue;
  const i25 = arr(R && R.years).indexOf(2025),
    i26 = arr(R && R.years).indexOf(2026);
  if (!R || i25 < 0 || i26 < 0) return null;
  const total = R.total && fin(R.total.mln && R.total.mln[i26]) ? R.total.mln[i26] : null;
  const items = TAX_IDS.map((id) => arr(R.groups).find((g) => g.id === id))
    .filter((g) => g && fin(arr(g.mln)[i26]))
    .map((g) => ({
      id: g.id,
      name: g.name,
      v: g.mln[i26],
      p: fin(g.mln[i25]) ? g.mln[i25] : null,
      share: total ? (g.mln[i26] / total) * 100 : null,
    }));
  return items.length
    ? { items, total, kind25: arr(R.vintage)[i25], asOf: R.meta && R.meta.asOf }
    : null;
}

/** the budgets of the 2026 law, by size (хил. € in the data → млн. €) */
function minModel(ctx) {
  const D = ctx.data.ministries;
  const raw0 = arr(D && D.items).filter((m) => m && m.id != null && m.name && fin(m.expKhil));
  if (!raw0.length) return null;
  const kinds = D.kinds && typeof D.kinds === 'object' ? D.kinds : {};
  const byId = new Map();
  const items = raw0.map((m) => {
    const it = {
      id: String(m.id),
      name: String(m.name).trim(),
      short: String(m.short || '').trim(),
      kind: kinds[m.kind] || '',
      v: m.expKhil / 1000,
      change: m.change && fin(m.change.pct) ? { pct: m.change.pct, basis: m.change.basis } : null,
    };
    byId.set(it.id, it);
    return it;
  });
  return { items, byId, asOf: D.meta && D.meta.asOf };
}
function changeText(c) {
  if (!c) return 'няма сравнение с 2025 г.';
  const star = c.basis === 'program-budget' ? '*' : '';
  return Math.abs(c.pct) < 0.05
    ? `без промяна спрямо 2025 г.${star}`
    : `${delta(c.pct, 1)}${star} спрямо 2025 г.`;
}

/** the programmes (not the policies: a policy is the sum of its programmes) by the spender's own budget of 2026 */
function progModel(ctx, mm) {
  const D = ctx.data.programs;
  if (!D || !Array.isArray(D.items) || !Array.isArray(D.fields)) return null;
  const ix = {};
  D.fields.forEach((f, i) => {
    ix[f] = i;
  });
  if (['ministry', 'code', 'name', 'level', 'prb2026', 'prb2025'].some((f) => !(f in ix)))
    return null;
  const NO = fin(D.sentinels && D.sentinels.noData) ? D.sentinels.noData : -1;
  const known = (v) => (fin(v) && v !== NO ? v : null);
  const rows = [];
  for (const r of D.items) {
    if (r[ix.level] === 'policy') continue;
    const k = known(r[ix.prb2026]),
      k25 = known(r[ix.prb2025]);
    if (k === null || !r[ix.code]) continue;
    const ministry = String(r[ix.ministry] ?? '');
    const min = mm && mm.byId.get(ministry);
    let g = { kind: 'none' };
    if (r[ix.isNew] === 1 || (k25 === 0 && k > 0)) g = { kind: 'new' };
    else if (k25 !== null && k25 > 0) g = { kind: 'num', v: ((k - k25) / k25) * 100 };
    rows.push({
      ministry,
      code: String(r[ix.code]),
      name: String(r[ix.name] ?? '').trim(),
      v: k / 1000,
      mName: min ? shortName(min.name, min.short) : `ведомство ${ministry}`,
      g,
    });
  }
  return rows.length ? { rows, asOf: D.meta && D.meta.asOf } : null;
}
function growthWords(g) {
  if (g.kind === 'num')
    return Math.abs(g.v) < 0.05 ? 'без промяна спрямо 2025 г.' : `${delta(g.v, 1)} спрямо 2025 г.`;
  if (g.kind === 'new') return 'ново: за 2025 г. няма средства';
  return 'няма сравнение с 2025 г.';
}

/** the measures with a 2026 effect on the balance; twins (the same measure in the short and in the discretionary list, linked by `related`) count once */
function measModel(ctx) {
  const D = ctx.data.measures;
  const items = arr(D && D.items);
  if (!items.length) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const root = new Map(items.map((i) => [i.id, i.id]));
  const find = (x) => {
    while (root.get(x) !== x) {
      root.set(x, root.get(root.get(x)));
      x = root.get(x);
    }
    return x;
  };
  for (const i of items)
    for (const r of arr(i.related)) if (byId.has(r)) root.set(find(i.id), find(r));
  const sets = new Map();
  for (const i of items) {
    const k = find(i.id);
    if (!sets.has(k)) sets.set(k, []);
    sets.get(k).push(i);
  }
  const rank = (i) => (i.tab === 'short' ? 0 : i.tab === 'discretionary' ? 1 : 2);
  const eff = (i) =>
    i.balanceEffectMln && fin(i.balanceEffectMln['2026']) ? i.balanceEffectMln['2026'] : null;
  const reps = [];
  for (const list of sets.values()) {
    const have = list.filter((i) => eff(i) !== null).sort((a, b) => rank(a) - rank(b));
    if (have.length) reps.push(have[0]);
  }
  const rows = reps
    .map((i) => ({
      it: i,
      eff: eff(i),
      raw: i.effectMln && fin(i.effectMln['2026']) ? i.effectMln['2026'] : null,
    }))
    .filter((r) => r.eff !== 0);
  const bySize = (a, b) => Math.abs(b.eff) - Math.abs(a.eff) || bgc(a.it.name, b.it.name);
  return {
    D,
    plus: rows.filter((r) => r.eff > 0).sort(bySize),
    minus: rows.filter((r) => r.eff < 0).sort(bySize),
    counted: reps.length,
    twins: items.filter((i) => eff(i) !== null).length - reps.length,
    asOf: D.meta && D.meta.asOf,
  };
}
function effectWords(it, v) {
  if (!fin(v) || v === 0) return '';
  if (it.kind === 'revenue') return v > 0 ? 'повече приходи' : 'по-малко приходи';
  if (it.kind !== 'expenditure') return '';
  if (it.estimateKind === 'avoided') return 'избегнати разходи';
  return v > 0 ? 'повече разходи' : 'по-малко разходи';
}

/** municipalities by the main transfers per resident (the figure of the data) */
function munModel(ctx) {
  const D = ctx.data.municipalities;
  const list = arr(D && D.items).filter((m) => m && m.name);
  const per = list
    .filter((m) => M.pcOf(m) !== null)
    .sort((a, b) => M.pcOf(b) - M.pcOf(a) || bgc(a.name, b.name));
  return per.length >= 2
    ? { per, year: D.populationYear, asOf: D.meta && D.meta.asOf, noPop: list.length - per.length }
    : null;
}

/** the 2026 KFP lines whose execution is behind the pace of 2025 (the rule of S15: two shares in percentage points, flagged from 10 пр.п.) */
function lagModel(ctx) {
  const ex = ctx.data.execution;
  const cur = ex && ex.data && ex.data['2026'],
    plan = ex && ex.plan2026 && ex.plan2026.kfp,
    pace = ex && ex.pace && ex.pace['2025'];
  if (!cur || !cur.kfp || !plan || !pace || !fin(cur.months) || cur.months < 1) return null;
  const m = cur.months;
  const nameOf = (id) => {
    const r = arr(ex.rows).find((x) => x.id === id);
    return r ? r.short || r.label : id;
  };
  const at = (a, i) => (Array.isArray(a) && fin(a[i]) ? a[i] : null);
  const rows = [...REV_ROWS, ...EXP_ROWS, 'eucontrib'].map((id) => {
    const c = at(cur.kfp[id], m - 1),
      p = fin(plan[id]) ? plan[id] : null;
    const pc = fin(c) && fin(p) && p > 0 ? (c / p) * 100 : null;
    const pa = Array.isArray(pace[id]) && pace[id].length === 12 ? pace[id] : null;
    const ps = pa ? at(pa, m - 1) : null;
    const diff = fin(pc) && fin(ps) ? r1(r1(pc) - r1(ps)) : null;
    return { id, name: nameOf(id), c, p, pc, ps, diff };
  });
  const asOf = arr(cur.asOf)[m - 1] || (ex.meta && ex.meta.asOf) || null;
  const behind = rows
    .filter((r) => r.diff !== null && r.diff <= -LAG_THR + 1e-9)
    .sort((a, b) => a.diff - b.diff || bgc(a.name, b.name));
  return { rows, behind, m, asOf, measured: rows.filter((r) => r.diff !== null).length };
}

/* ------------------------------------------------------------------ „Топ 5 / 10“: the blocks (each one a ranked list) */
const bigFirst = (a, b) => b.v - a.v || bgc(a.name, b.name);
const dot = (...parts) => parts.filter(Boolean).join(' · ');
const pair = (...blocks) => html`<div class="s19-pair">${blocks}</div>`;
const growthLine = (v, p) => {
  const c = change(v, p);
  return c === null
    ? 'няма сравнение с 2025 г.'
    : Math.abs(c) < 0.05
      ? 'без промяна спрямо 2025 г.'
      : `${delta(c, 1)} спрямо 2025 г.`;
};
const pctOf = (v, p) => {
  const c = change(v, p);
  return c === null ? null : r1(c);
};

/** one ranked block. `items` are ranklist items (value = the bar); `fmt` prints the value when it is not an amount; `table` = the CSV when the printed value is not the raw one */
function rankBox(o) {
  const list = o.items.length
    ? ranklist({
        id: `${o.id}-l`,
        label: o.title,
        ordered: true,
        fmt: o.fmt,
        unitLabel: o.unitLabel,
        categoryLabel: o.categoryLabel,
        max: o.max,
        items: o.items,
      })
    : html`<p class="muted">${o.none || 'Няма какво да подредим.'}</p>`;
  return block({
    id: o.id,
    title: o.title,
    sub: o.sub,
    scope: o.scope,
    status: o.status,
    source: o.source,
    asOf: o.asOf,
    foot: o.foot,
    share: o.table ? { table: o.table } : undefined,
    body: list,
  });
}
const pendingPair = (ids, titles, text, o) =>
  pair(pendingBlock(ids[0], titles[0], text, o), pendingBlock(ids[1], titles[1], text, o));

/* 1 · functions and lines of the expenditure */
function fnBlocks(ctx, C, FM) {
  const o = { scope: 'kfp', source: ['asbp'] };
  const ids = ['s19-b-funkcii', 's19-b-pera'],
    T = ['Най-големите функции на разходите', 'Най-големите пера в разходите'];
  if (!FM) return pendingPair(ids, T, 'Разходите по функции предстоят.', o);
  const tot = FM.fns.reduce((t, x) => t + x.v, 0);
  const base = {
    ...o,
    asOf: FM.asOf,
    foot: fnFoot(FM),
    categoryLabel: 'Позиция',
    unitLabel: 'млн. €',
  };
  const item = (x, s) => ({
    label: x.name,
    sub: s,
    value: x.v,
    pctGdp: pg(ctx, x.v, 2026),
    href: ctx.href('funkciya', { fn: x.id }),
  });
  return pair(
    rankBox({
      ...base,
      id: ids[0],
      title: T[0],
      sub: 'За какво отиват парите.',
      items: [...FM.fns]
        .sort(bigFirst)
        .slice(0, C.n)
        .map((x) =>
          item(x, dot(`${pct((x.v / tot) * 100, 1)} от разходите`, growthLine(x.v, x.p))),
        ),
    }),
    rankBox({
      ...base,
      id: ids[1],
      title: T[1],
      sub: 'По-малки части на функциите, например пенсиите.',
      items: [...FM.lines]
        .sort(bigFirst)
        .slice(0, C.n)
        .map((x) => item(x, dot(x.sub, growthLine(x.v, x.p)))),
    }),
  );
}
const fnFoot = (FM) =>
  `Сумите са за 2026 г. („${FM.lab26}“ в разходната таблица). Ръстът е спрямо колоната „${FM.lab25}“, а не спрямо отчета за 2025 г.`;

/* 2 · the lines that grow and fall most against 2025 (in the shown unit; the percent is in the line under the name) */
function growthBlocks(ctx, C, FM) {
  const o = { scope: 'kfp', source: ['asbp'] };
  const ids = ['s19-b-rast', 's19-b-spad'],
    T = ['Най-голям ръст спрямо 2025 г.', 'Най-голямо намаление спрямо 2025 г.'];
  if (!FM) return pendingPair(ids, T, 'Разходите по функции предстоят.', o);
  const rows = FM.lines
    .filter((x) => fin(x.p))
    .map((x) => {
      const g1 = pg(ctx, x.v, 2026),
        g0 = pg(ctx, x.p, 2025);
      return { ...x, d: dText(ctx, x.v - x.p, fin(g1) && fin(g0) ? g1 - g0 : null) };
    })
    .filter((x) => x.d.raw); // a change that rounds to zero in the shown unit is not a change
  const up = rows
    .filter((x) => x.d.raw > 0)
    .sort((a, b) => b.d.raw - a.d.raw || bgc(a.name, b.name))
    .slice(0, C.n);
  const down = rows
    .filter((x) => x.d.raw < 0)
    .sort((a, b) => a.d.raw - b.d.raw || bgc(a.name, b.name))
    .slice(0, C.n);
  const max = Math.max(0, ...up.concat(down).map((x) => Math.abs(x.d.raw)));
  const unitLabel = rows.length ? rows[0].d.unitLabel : 'млн. €';
  const mk = (id, title, list, none) =>
    rankBox({
      ...o,
      id,
      title,
      asOf: FM.asOf,
      none,
      max,
      fmt: (v, it) => it.text,
      unitLabel,
      categoryLabel: 'Перо',
      foot: fnFoot(FM),
      items: list.map((x) => ({
        label: x.name,
        sub: dot(x.sub, growthLine(x.v, x.p)),
        value: Math.abs(x.d.raw),
        text: x.d.text,
        href: ctx.href('funkciya', { fn: x.id }),
      })),
      table: twinOf(
        [
          { key: 'n', label: 'Перо' },
          { key: 'f', label: 'Функция' },
          { key: 'a', label: '2025 г.', unit: 'млн. €' },
          { key: 'b', label: '2026 г.', unit: 'млн. €' },
          { key: 'd', label: 'Промяна', unit: unitLabel },
          { key: 'c', label: 'Промяна', unit: '%' },
        ],
        list.map((x) => ({ n: x.name, f: x.fn, a: x.p, b: x.v, d: x.d.raw, c: pctOf(x.v, x.p) })),
      ),
    });
  return pair(
    mk(ids[0], T[0], up, 'Нито едно перо не расте спрямо 2025 г.'),
    mk(ids[1], T[1], down, 'Нито едно перо не намалява спрямо 2025 г.'),
  );
}

/* 3 · the spenders */
function minBlock(ctx, C, MM) {
  const id = 's19-b-vedomstva',
    title = 'Най-големите бюджети на ведомствата';
  const o = { scope: SCOPE_MIN, source: ['zdb', 'bill', 'prb'] };
  if (!MM) return pendingBlock(id, title, 'Бюджетите на ведомствата предстоят.', o);
  const list = [...MM.items].sort(bigFirst).slice(0, C.n);
  const star = list.some((m) => m.change && m.change.basis === 'program-budget');
  return rankBox({
    ...o,
    id,
    title,
    asOf: MM.asOf,
    sub: 'Колко пари получава всяко ведомство по закона за 2026 г.',
    categoryLabel: 'Ведомство',
    unitLabel: 'млн. €',
    foot: star
      ? '* Промяната е по програмния бюджет към проекта на закона, а не по сумата в закона.'
      : undefined,
    items: list.map((m) => ({
      label: shortName(m.name, m.short),
      sub: dot(m.kind, changeText(m.change)),
      value: m.v,
      pctGdp: pg(ctx, m.v, 2026),
      href: ctx.href('vedomstvo', { code: m.id }),
    })),
  });
}

/* 4 · the programmes */
function progBlock(ctx, C, PM) {
  const id = 's19-b-programi',
    title = 'Най-големите програми';
  const o = { scope: SCOPE_PRG, source: ['prb', 'zdb'] };
  if (!PM) return pendingBlock(id, title, 'Програмите на ведомствата предстоят.', o);
  const list = [...PM.rows].sort(bigFirst).slice(0, C.n);
  return rankBox({
    ...o,
    id,
    title,
    asOf: PM.asOf,
    sub: 'Програмите, по които ведомствата харчат най-много от собствения си бюджет.',
    categoryLabel: 'Програма',
    unitLabel: 'млн. €',
    items: list.map((r) => ({
      label: r.name,
      sub: dot(r.mName, growthWords(r.g)),
      value: r.v,
      pctGdp: pg(ctx, r.v, 2026),
      href: ctx.href('vedomstvo', { code: r.ministry, program: r.code }),
    })),
  });
}

/* 5 · the measures with the biggest effect on the 2026 balance */
function measBlocks(ctx, C, MS) {
  const o = { scope: SCOPE_MER, source: ['asbp', 'bill'] };
  const ids = ['s19-b-merki-plus', 's19-b-merki-minus'],
    T = ['Мерки, които носят най-много пари', 'Мерки, които струват най-много пари'];
  if (!MS) return pendingPair(ids, T, 'Мерките в бюджета предстоят.', o);
  const max = Math.max(
    0,
    MS.plus[0] ? MS.plus[0].eff : 0,
    MS.minus[0] ? Math.abs(MS.minus[0].eff) : 0,
  );
  const labels = MS.D.tabLabels || {};
  const foot = `Ефектът е върху бюджетното салдо за 2026 г.: „+“ го подобрява, „−“ го влошава.${MS.twins > 0 ? ' Мерките, които проектът описва на две места, са преброени веднъж.' : ''}`;
  const mk = (id, title, list, none) => {
    const rows = list.slice(0, C.n);
    return rankBox({
      ...o,
      id,
      title,
      asOf: MS.asOf,
      none,
      max,
      foot,
      fmt: (v, it) => it.text,
      unitLabel: 'млн. €',
      categoryLabel: 'Мярка',
      items: rows.map((r) => ({
        label: r.it.name,
        sub: dot(effectWords(r.it, r.raw), labels[r.it.tab]),
        value: Math.abs(r.eff),
        text: amt(ctx, r.eff, 1, true),
        href: ctx.href('merki', { id: r.it.id }),
      })),
      table: twinOf(
        [
          { key: 'n', label: 'Мярка' },
          { key: 'k', label: 'Какво променя' },
          { key: 'e', label: 'Ефект върху салдото за 2026 г.', unit: 'млн. €' },
        ],
        rows.map((r) => ({ n: r.it.name, k: effectWords(r.it, r.raw), e: r.eff })),
      ),
    });
  };
  return pair(
    mk(ids[0], T[0], MS.plus, 'Няма мерки, които да подобряват салдото.'),
    mk(ids[1], T[1], MS.minus, 'Няма мерки, които да влошават салдото.'),
  );
}

/* 6 · the taxes and contributions */
function taxBlock(ctx, C, TX) {
  const id = 's19-b-danaci',
    title = 'Най-големите данъци и осигуровки';
  const o = { scope: 'kfp', source: ['asbp'] };
  if (!TX) return pendingBlock(id, title, 'Приходите по източници предстоят.', o);
  const list = [...TX.items].sort(bigFirst).slice(0, C.n);
  return rankBox({
    ...o,
    id,
    title,
    asOf: TX.asOf,
    sub: 'Колко пари се очаква да влязат в бюджета през 2026 г.',
    categoryLabel: 'Данък',
    unitLabel: 'млн. €',
    foot: `Дяловете са от всички приходи. Ръстът е спрямо ${VS[TX.kind25] || 'отчета'} за 2025 г.`,
    items: list.map((x) => ({
      label: x.name,
      sub: dot(x.share === null ? '' : `${pct(x.share, 1)} от приходите`, growthLine(x.v, x.p)),
      value: x.v,
      pctGdp: pg(ctx, x.v, 2026),
      href: ctx.href('prihodi', { source: x.id }),
    })),
  });
}

/* 7 · the municipalities: the most and the least main transfers per resident */
function munBlocks(ctx, C, MU) {
  const o = { scope: 'nat', source: ['zdb', 'eurostat'] };
  const ids = ['s19-b-obshtini-max', 's19-b-obshtini-min'],
    T = ['Общини с най-много пари на жител', 'Общини с най-малко пари на жител'];
  if (!MU) return pendingPair(ids, T, 'Данните за общините предстоят.', o);
  const n = Math.min(C.n, Math.floor(MU.per.length / 2)),
    lv = ctx.store.get('leva'),
    max = M.pcOf(MU.per[0]);
  const mk = (id, title, list) =>
    rankBox({
      ...o,
      id,
      title,
      asOf: MU.asOf,
      max,
      sub: 'Основните трансфери от държавния бюджет по закона за 2026 г., разделени на жителите.',
      categoryLabel: 'Община',
      unitLabel: '€ на жител',
      foot: MU.year ? `Жителите са по данни към ${MU.year} г.` : undefined,
      fmt: (v) => M.eurText(v, 0, lv),
      items: list.map((m) => ({
        label: m.name,
        sub: `област ${m.region}`,
        value: M.pcOf(m),
        href: ctx.href('obshtina', { code: m.id }),
      })),
    });
  return pair(mk(ids[0], T[0], MU.per.slice(0, n)), mk(ids[1], T[1], MU.per.slice(-n).reverse()));
}

/* 8 · the lines whose execution is furthest behind the pace of 2025 */
function lagBlock(ctx, C, LG) {
  const id = 's19-b-izostavashti',
    title = 'Пера, които изостават от хода на 2025 г.';
  const o = { scope: 'kfp', source: ['kfp', 'asbp'] };
  if (!LG) return pendingBlock(id, title, 'Месечният отчет за 2026 г. още не е зареден.', o);
  const list = LG.rows
    .filter((r) => r.diff !== null && r.diff < 0)
    .sort((a, b) => a.diff - b.diff || bgc(a.name, b.name))
    .slice(0, C.n);
  return rankBox({
    ...o,
    id,
    title,
    asOf: LG.asOf,
    sub: `Колко от годишния план е изпълнен към края на ${monthName(LG.m)} 2026 г., в сравнение с хода на 2025 г. по същото време.`,
    none: 'Нито едно перо не изостава от хода на 2025 г.',
    categoryLabel: 'Перо',
    unitLabel: 'пр.п.',
    fmt: (v, it) => it.text,
    foot: `Изоставането от ${LAG_THR} пр.п. нагоре е значително, както на екрана за изпълнението на бюджета.`,
    items: list.map((r) => ({
      label: r.name,
      value: Math.abs(r.diff),
      text: pp(r.diff, 1),
      href: ctx.href('izpalnenie'),
      sub: `Изпълнено ${pct(r.pc, 1)} от годишния план; по хода на 2025 г. до този месец — ${pct(r.ps, 1)}.${r.diff <= -LAG_THR + 1e-9 ? ' Изостава значително.' : ''}`,
    })),
    table: twinOf(
      [
        { key: 'n', label: 'Перо' },
        { key: 'c', label: 'Изпълнено от плана', unit: '%' },
        { key: 's', label: 'Ход на 2025 г.', unit: '%' },
        { key: 'd', label: 'Разлика', unit: 'пр.п.' },
      ],
      list.map((r) => ({ n: r.name, c: r1(r.pc), s: r1(r.ps), d: r.diff })),
    ),
  });
}

/* ------------------------------------------------------------------ „Година срещу година“: any two years side by side */
const CAT_TITLE = Object.fromEntries(KATS);
const ECON_ROWS = [
  'x.personnel',
  'x.maint',
  'x.scholarships',
  'x.subsidies',
  'x.social',
  'x.capex',
  'x.contingency',
  'x.reserve',
  'x.abroad',
  'x.interest',
  'x.eucontrib',
];

/** how a number of the years table is printed: млн. €, € на човек or % от БВП (a difference then in пр.п.); „и в лева“ is an addendum under the number */
function unitModel(ctx) {
  const lev = !!ctx.store.get('leva'),
    persons = ctx.store.get('perPerson') ? personsOf(ctx) : null;
  if (ctx.store.get('unit') === 'pct')
    return { kind: 'pct', unit: '% от БВП', dUnit: 'пр.п.', d: 1, k: 1, lev: false };
  if (persons)
    return { kind: 'person', unit: '€ на човек', dUnit: '€ на човек', d: 0, k: 1e6 / persons, lev };
  return { kind: 'mln', unit: 'млн. €', dUnit: 'млн. €', d: 1, k: 1, lev };
}
/** a number rounded the way num() prints it (half up on the decimal form): a printed difference then always equals the difference of the two printed numbers */
function rd(U, v) {
  if (!fin(v)) return null;
  const s = String(Math.abs(v));
  const n = s.includes('e') ? Math.abs(v) : Number(`${Math.round(Number(`${s}e${U.d}`))}e-${U.d}`);
  return v < 0 ? -n : n;
}
const levOf = (U, v) =>
  U.lev && fin(v)
    ? `≈${NBSP}${num(v * EUR_RATE, U.d)}${NBSP}${U.kind === 'person' ? 'лв.' : 'млн. лв.'}`
    : '';

const series = (years, a) => {
  const o = {};
  arr(years).forEach((y, i) => {
    o[y] = fin(arr(a)[i]) ? a[i] : null;
  });
  return o;
};
/** one line of a comparison: млн. € and % от БВП by year (the share from the data, else computed from the same GDP the budget documents use) */
const mkRow = (ctx, id, name, years, mln, gdpPct, kind = 'part') => ({
  id,
  name,
  kind,
  v: series(years, mln),
  g: series(years, gdpPct || arr(mln).map((m, i) => pg(ctx, m, arr(years)[i]))),
});

/** the lines of one category with their years; null when its data is not there */
function catModel(ctx, kat, FM) {
  const D = ctx.data;
  if (kat === 'razhodi-fn') {
    const F = FM && FM.F;
    if (!F) return null;
    const rows = F.items.map((it) => mkRow(ctx, it.id, it.short || it.name, F.years, it.mln));
    rows.push(
      mkRow(ctx, 'sum', 'Общо за деветте функции', F.years, F.totalMln, F.totalPctGdp, 'total'),
    );
    return {
      rows,
      scope: 'kfp',
      source: ['asbp'],
      asOf: FM.asOf,
      label: (y) => arr(F.yearLabels)[arr(F.years).indexOf(y)] || String(y),
      foot: 'Таблицата по функции е за 2025–2028 г. Колоната за 2025 г. е програмата от проекта на бюджета, а не отчетът. Сборът не включва вноската в общия бюджет на ЕС.',
    };
  }
  if (kat === 'razhodi-vid') {
    const E = D.expenditure && D.expenditure.economic;
    if (!E) return null;
    const rows = ECON_ROWS.map((id) => arr(E.rows).find((r) => r.id === id))
      .filter(Boolean)
      .map((r) =>
        mkRow(ctx, r.id, String(r.label).replace(/\s+-\s+общо$/, ''), E.years, r.mln, r.pctGdp),
      );
    const t = arr(E.rows).find((r) => r.id === 'x.total');
    if (t)
      rows.push(
        mkRow(
          ctx,
          t.id,
          'Общо разходи, с вноската в бюджета на ЕС',
          E.years,
          t.mln,
          t.pctGdp,
          'total',
        ),
      );
    return {
      rows,
      scope: 'kfp',
      source: ['asbp'],
      asOf: D.expenditure.meta && D.expenditure.meta.asOf,
      foot: 'Сборът включва вноската в общия бюджет на ЕС.',
    };
  }
  if (kat === 'prihodi') {
    const R = D.revenue;
    if (!R || !arr(R.groups).length) return null;
    const rows = R.groups.map((g) => mkRow(ctx, g.id, g.name, R.years, g.mln, g.pctGdp));
    if (R.total)
      rows.push(mkRow(ctx, 'total', 'Общо приходи', R.years, R.total.mln, R.total.pctGdp, 'total'));
    return {
      rows,
      scope: 'kfp',
      source: ['asbp'],
      asOf: R.meta && R.meta.asOf,
      foot: 'Сборът на източниците е равен на общите приходи, с точност до закръгляването.',
    };
  }
  const O = D.outlook,
    K = O && O.kfp;
  if (!K) return null;
  const spec = [
    ['revenue', 'Приходи', 'part'],
    ['expenditure', 'Разходи, с вноската в бюджета на ЕС', 'part'],
    ['balance', 'Салдо (приходи минус разходи)', 'bal'],
    ['interest', 'От разходите: лихви', 'part'],
    ['primaryBalance', 'Първично салдо (салдото без лихвите)', 'bal'],
  ];
  const rows = spec
    .filter((s) => K[s[0]])
    .map((s) => mkRow(ctx, s[0], s[1], O.years, K[s[0]].mln, K[s[0]].pctGdp, s[2]));
  return {
    rows,
    lead: 'balance',
    rank: false,
    scope: 'kfp',
    source: ['asbp'],
    asOf: O.meta && O.meta.asOf,
    foot: 'Салдо с минус е дефицит: държавата харчи повече, отколкото събира.',
  };
}

/** one number or difference as a sentence reads it */
function amountText(U, v) {
  if (v === null) return DASH;
  return U.kind === 'pct'
    ? `${num(v, 1)}%${NBSP}от${NBSP}БВП`
    : U.kind === 'person'
      ? `${num(v, 0)}${NBSP}€ на човек`
      : `${num(v, 1)}${MLN}`;
}
function diffText(U, d) {
  if (d === null) return DASH;
  return U.kind === 'pct'
    ? pp(d, 1)
    : U.kind === 'person'
      ? `${num(d, 0, { sign: true })}${NBSP}€ на човек`
      : `${num(d, 1, { sign: true })}${MLN}`;
}

/** the table of the two years and the sentences above it */
function yearsModel(ctx, C, K, FM) {
  const cat = catModel(ctx, C.kat, FM);
  if (!cat) return null;
  const U = unitModel(ctx);
  const valueOf = (r, y) =>
    U.kind === 'pct' ? (fin(r.g[y]) ? r.g[y] : null) : fin(r.v[y]) ? r.v[y] * U.k : null;
  const lab = (y) => (cat.label ? cat.label(y) : yearWord(K, y));
  const rows = cat.rows.map((r) => {
    const va = valueOf(r, C.a),
      vb = valueOf(r, C.b),
      a = rd(U, va),
      b = rd(U, vb);
    const c = r.kind === 'bal' ? null : change(vb, va);
    return {
      id: r.id,
      n: r.name,
      kind: r.kind,
      a,
      b,
      d: a !== null && b !== null ? rd(U, b - a) : null,
      c: c === null ? null : r1(c),
    };
  });
  const labA = `${C.a}${NBSP}г.`,
    labB = `${C.b}${NBSP}г.`;
  const bits = [];
  const lead = rows.find((r) => (cat.lead ? r.id === cat.lead : r.kind === 'total'));
  if (lead && lead.a !== null && lead.b !== null) {
    bits.push(
      cat.lead
        ? `Салдото (приходи минус разходи) е ${amountText(U, lead.a)} през ${labA} и ${amountText(U, lead.b)} през ${labB}.`
        : `${lead.n}: ${amountText(U, lead.a)} през ${labA} и ${amountText(U, lead.b)} през ${labB}, тоест ${diffText(U, lead.d)}${lead.c === null ? '' : ` (${delta(lead.c, 1)})`}.`,
    );
  }
  if (cat.rank !== false) {
    const parts = rows.filter((r) => r.kind === 'part' && r.d !== null && r.d !== 0);
    const up = parts.filter((r) => r.d > 0).sort((x, y) => y.d - x.d)[0],
      down = parts.filter((r) => r.d < 0).sort((x, y) => x.d - y.d)[0];
    if (up) bits.push(`Най-голям ръст: ${up.n} (${diffText(U, up.d)}).`);
    if (down) bits.push(`Най-голямо намаление: ${down.n} (${diffText(U, down.d)}).`);
  }
  return {
    cat,
    U,
    rows,
    lab,
    labA,
    labB,
    summary: bits.join(' ').replace(/г\.\./g, 'г.'),
    forecast: [C.a, C.b].some((y) => K[y] === 'forecast'),
  };
}

function cellNum(U, v, sign) {
  if (v === null) return DASH;
  const lv = levOf(U, v);
  return lv
    ? html`${num(v, U.d, { sign })}<span class="s19-lev">${lv}</span>`
    : num(v, U.d, { sign });
}

function yearControls(C, K) {
  const yOpts = YEARS.map((y) => ({ value: String(y), label: yearWord(K, y) }));
  return html`<div class="s19-controls" role="group" aria-label="Какво да сравним">
    ${field({ id: 's19-kat', label: 'Какво сравняваме', control: selectInput({ id: 's19-kat', name: 'kat', options: KATS.map((k) => ({ value: k[0], label: k[1] })), value: C.kat, query: 'kat' }) })}
    ${field({ id: 's19-a', label: 'Първа година', control: selectInput({ id: 's19-a', name: 'a', options: yOpts, value: String(C.a), query: 'a' }) })}
    <button type="button" class="btn s19-swap" id="s19-swap" aria-label="Размени първата и втората година">${icon('transfer', { size: 18 })}<span>Размени</span></button>
    ${field({ id: 's19-b', label: 'Втора година', control: selectInput({ id: 's19-b', name: 'b', options: yOpts, value: String(C.b), query: 'b' }) })}
  </div>`;
}

function godiniPanel(ctx, C, K, FM) {
  const controls = yearControls(C, K);
  if (C.a === C.b) {
    return html`${controls}${callout({ kind: 'info', title: 'Избрана е една и съща година', body: html`<p>Избери две различни години, за да видиш какво се променя между тях.</p>` })}`;
  }
  const M = yearsModel(ctx, C, K, FM);
  const title = `${CAT_TITLE[C.kat]}: ${yr(C.a)} и ${yr(C.b)}`;
  if (!M)
    return html`${controls}${pendingBlock('s19-b-godini', title, 'Тези данни предстоят.', { scope: 'kfp', source: ['asbp'] })}`;
  const { U, cat } = M;
  const noFn = C.kat === 'razhodi-fn' && (C.a === 2024 || C.b === 2024);
  const columns = [
    {
      key: 'n',
      label: 'Показател',
      fmt: (v, r) => (r.kind === 'total' ? html`<strong>${v}</strong>` : v),
    },
    { key: 'a', label: M.lab(C.a), unit: U.unit, d: U.d, fmt: (v) => cellNum(U, v, false) },
    { key: 'b', label: M.lab(C.b), unit: U.unit, d: U.d, fmt: (v) => cellNum(U, v, false) },
    { key: 'd', label: 'Разлика', unit: U.dUnit, d: U.d, fmt: (v) => cellNum(U, v, true) },
    {
      key: 'c',
      label: 'Промяна',
      unit: '%',
      d: 1,
      fmt: (v) => (v === null ? DASH : num(v, 1, { sign: true })),
    },
  ];
  const table = dataTable({
    id: 's19-t-godini',
    caption: `${title}, в ${U.unit}`,
    columns,
    rows: M.rows,
  });
  return html`${controls}
    ${noFn ? callout({ kind: 'info', title: 'За 2024 г. няма разходи по функции', body: html`<p>Таблицата по функции започва от 2025 г. Разходите по вид са налични и за 2024 г.</p><p><button type="button" class="btn" data-query="kat=razhodi-vid">Покажи разходите по вид</button></p>` }) : ''}
    ${block({
      id: 's19-b-godini',
      title,
      sub: 'Разликата е втората година минус първата.',
      scope: cat.scope,
      status: M.forecast ? 'forecast' : 'real',
      source: cat.source,
      asOf: cat.asOf,
      foot: cat.foot,
      body: html`${M.summary ? html`<p class="s19-sum">${M.summary}</p>` : ''}${table}`,
    })}`;
}

/* ------------------------------------------------------------------ the page */
export const needs = [
  'core',
  'expenditure',
  'revenue',
  'outlook',
  'ministries?',
  'programs?',
  'measures?',
  'municipalities?',
  'execution?',
];
export const styles = ['s19-klasacii'];
export const lede = () =>
  'Кое е най-голямото, кое расте най-бързо и как една година се различава от друга: подредени списъци и сравнение по години, всичко от данните на бюджета.';

function topControls(ctx, C) {
  const y = ctx.period && ctx.period.year;
  return html`<div class="s19-controls s19-controls-top">
    <div class="s19-ctl"><span class="s19-ctl-l">Колко места да покажем</span>${seg({
      name: 's19-n',
      label: 'Колко места да покажем',
      value: String(C.n),
      query: 'n',
      options: [
        { value: '5', label: 'Първите 5' },
        { value: '10', label: 'Първите 10' },
      ],
    })}</div>
  </div>
  ${y && y !== 2026 ? callout({ kind: 'info', title: 'Класациите са за бюджета за 2026 г.', body: html`<p>Избраният период не ги променя. За да сравниш друга година с друга, използвай „Година срещу година“.</p><p><button type="button" class="btn" data-query="tab=godini">Към „Година срещу година“</button></p>` }) : ''}`;
}

export function render(ctx) {
  const C = ctl(ctx),
    K = kindsOf(ctx),
    FM = fnModel(ctx),
    MM = minModel(ctx);
  const top = html`<div class="s19-stack">${topControls(ctx, C)}
    ${fnBlocks(ctx, C, FM)}${growthBlocks(ctx, C, FM)}${minBlock(ctx, C, MM)}${progBlock(ctx, C, progModel(ctx, MM))}${measBlocks(ctx, C, measModel(ctx))}${taxBlock(ctx, C, taxModel(ctx))}${munBlocks(ctx, C, munModel(ctx))}${lagBlock(ctx, C, lagModel(ctx))}
  </div>`;
  const years = html`<div class="s19-stack">${godiniPanel(ctx, C, K, FM)}</div>`;
  return html`<div class="s19-head">${unitSwitch(ctx, { name: 's19-unit', note: 'Важи за сумите в класациите и в сравнението по години. Мерките, парите на жител и изоставането от плана са винаги в евро или в пунктове.' })}</div>
    ${tabs({
      id: 's19-tabs',
      label: 'Какво да покажем',
      active: C.tab,
      query: 'tab',
      tabs: [
        { key: 'top', label: 'Топ 5 / 10', body: top },
        { key: 'godini', label: 'Година срещу година', body: years },
      ],
    })}`;
}

let lastKey = null;
export function mount(root, ctx) {
  const off = bindUnitSwitch(root, ctx, 's19-unit');
  const C = ctl(ctx);
  const onClick = (e) => {
    const b = e.target && e.target.closest ? e.target.closest('#s19-swap') : null;
    if (b && root.contains(b)) ctx.setQuery({ a: String(C.b), b: String(C.a) });
  };
  root.addEventListener('click', onClick);
  // the shell announces its own switches (period, unit, per person); a change of this screen's choices is announced here
  const key = [C.tab, C.kat, C.a, C.b, C.n].join('|');
  if (ctx.kind === 'rerender' && lastKey && lastKey !== key) {
    const M =
      C.tab === 'godini' && C.a !== C.b ? yearsModel(ctx, C, kindsOf(ctx), fnModel(ctx)) : null;
    ctx.announce(
      M && M.summary
        ? M.summary
        : C.tab === 'godini'
          ? 'Избери две различни години.'
          : `Показваме първите ${C.n}.`,
    );
  }
  lastKey = key;
  return () => {
    off();
    root.removeEventListener('click', onClick);
  };
}
