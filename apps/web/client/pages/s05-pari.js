import { institutions, cellValue } from '../budget-2027.js';
import { periodIndex } from '../annual.js';
import { selectPeriod } from '../periods.js';
// S05 · Парите · #/pari · next S06 · periods all (G3, taken over from G1)
// The money overview: five big cards, each a question, one number and one short answer, each a link to the screen that answers it.
//   1 Откъде идват парите?     → S06  total revenue of the chosen period and its two biggest sources (D01, D05)
//   2 Къде отиват парите?       → S07  total expenditure and its two biggest functions; by kind of spending for 2024–2025 (D01, D04, D03)
//   3 Кой харчи парите?         → S10  the biggest own budget among the budgets of the 2026 law (D08)
//   4 Какво променят мерките?    → S12  how many measures the 2026 budget holds and what they add up to (D12)
//   5 Накъде вървим?            → S13  the balance in 2028 against 2026 (D01)
// Every figure is read from the data sets in `needs` and printed by the shared formatters (amount() and kpi() honour „Показвай в“:
// млн. €, % от БВП, на човек, и в лева). Cards 3–5 are always about 2026 and the forecast; their labels say so. A set that did not load
// makes only its own card pending.
import { html } from '../html.js';
import { icon } from '../icons.js';
import { pct, NBSP } from '../format.js';
import { kpi } from '../ui/kpi.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';
import { amount, periodStatus } from '../view.js';

export const needs = [
  'core',
  'outlook',
  'revenue?',
  'expenditure?',
  'ministries?',
  'measures?',
  'budget2027?',
];
export const styles = ['s05-pari'];
export const lede = () =>
  'Пет въпроса за парите на държавата, всеки с едно число и кратък отговор. Натисни картата, за да видиш подробностите.';

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const arr = (a) => (Array.isArray(a) ? a : []);
const yr = (y) => `${y}${NBSP}г.`;
const PENDING = 'Тези данни предстоят.';
/** a name inside a sentence: „Социални и здравни осигуровки“ -> „социални и здравни осигуровки“, an acronym such as „ДДС“ stays */
const lc = (s) => {
  const t = String(s);
  return /^[А-ЯA-Z]{2,}(?![а-яa-z])/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
};
/** the value of a by-year series in one year; null when the year or the value is missing */
const pick = (years, series, y) => {
  const v = arr(series)[arr(years).findIndex((key) => key === y)];
  return ok(v) ? v : null;
};
/** the two biggest of [{n, v}] with their share of the total, as [{n, s}] ("социални осигуровки", "25%"); null when there are not two */
function topTwo(items, total) {
  const t = items
    .filter((x) => ok(x.v))
    .sort((a, b) => b.v - a.v)
    .slice(0, 2);
  return t.length === 2 && ok(total) && total > 0
    ? t.map((x) => ({ n: lc(x.n), s: pct((x.v / total) * 100, 0) }))
    : null;
}

/** 1 · where the money comes from: КФП revenue of the chosen year, the two biggest groups of revenue */
function cardIncome(ctx, O, R, Y) {
  const K = O.kfp && O.kfp.revenue;
  let text = selectPeriod(ctx.annualRaw?.revenue, ctx.period.key).gaps?.groups || PENDING;
  if (R) {
    const t = topTwo(
      arr(R.groups).map((g) => ({ n: g.name, v: pick(R.periodKeys, g.mln, ctx.period.key) })),
      pick(R.periodKeys, R.total && R.total.mln, ctx.period.key),
    );
    if (t)
      text = `Най-голям дял от приходите идва от ${t[0].n} (${t[0].s}) и от ${t[1].n} (${t[1].s}).`;
  }
  return {
    ic: 'trendingUp',
    q: 'Откъде идват парите?',
    href: ctx.href('S06'),
    text,
    kpi: {
      label: `Общо приходи през ${yr(Y)}`,
      mln: pick(O.periodKeys, K && K.mln, ctx.period.key),
      pctGdp: pick(O.periodKeys, K && K.pctGdp, ctx.period.key),
      scope: 'kfp',
      status: periodStatus(ctx),
      source: O.meta.source,
      asOf: O.meta && O.meta.asOf,
    },
  };
}

/** 2 · where the money goes: КФП expenditure of the chosen year; the two biggest functions (2026 on), else the two biggest kinds of spending */
const ECON = [
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
function cardSpend(ctx, O, X, Y) {
  const K = O.kfp && O.kfp.expenditure,
    F = X && X.functions,
    E = X && X.economic;
  let t = null;
  if (F?.items?.some((it) => ok(it.mln?.[periodIndex(F, ctx)])))
    t = topTwo(
      arr(F.items).map((it) => ({
        n: it.short || it.name,
        v: pick(F.periodKeys, it.mln, ctx.period.key),
      })),
      pick(F.periodKeys, F.totalMln, ctx.period.key),
    );
  else if (E && !selectPeriod(ctx.annualRaw?.expenditure, ctx.period.key).gaps?.economicDetails) {
    const rows = arr(E.rows),
      tot = rows.find((r) => r.id === 'x.total');
    t = topTwo(
      rows
        .filter((r) => ECON.includes(r.id))
        .map((r) => ({
          n: String(r.label).replace(/\s+-\s+общо$/, ''),
          v: pick(E.periodKeys, r.mln, ctx.period.key),
        })),
      pick(E.periodKeys, tot && tot.mln, ctx.period.key),
    );
  }
  return {
    ic: 'pieChart',
    q: 'Къде отиват парите?',
    href: ctx.href('S07'),
    text: t
      ? `Най-голям дял от разходите отива за ${t[0].n} (${t[0].s}) и за ${t[1].n} (${t[1].s}).`
      : selectPeriod(ctx.annualRaw?.expenditure, ctx.period.key).gaps?.functions || PENDING,
    kpi: {
      label: `Общо разходи през ${yr(Y)}`,
      mln: pick(O.periodKeys, K && K.mln, ctx.period.key),
      pctGdp: pick(O.periodKeys, K && K.pctGdp, ctx.period.key),
      scope: 'kfp',
      status: periodStatus(ctx),
      source: O.meta.source,
      asOf: O.meta && O.meta.asOf,
    },
  };
}

/** 3 · who spends: the biggest own budget among the budgets of the 2026 law (хил. € in the data, млн. € here) */
function cardAgencies(ctx, O, M) {
  if (ctx.period.key === '2027.draft') {
    const items = institutions(ctx.data.budget2027),
      top = items
        .filter((i) => cellValue(i.expenditure) !== null)
        .sort((a, b) => b.expenditure.value - a.expenditure.value)[0];
    return {
      ic: 'landmark',
      q: 'Кой харчи парите?',
      href: ctx.href('S10', {}, { per: '2027.draft' }),
      text: top
        ? `${top.name}. Общо ${items.length} бюджета по чл. 2–48 от основния проект.`
        : 'Това издание няма ведомствените бюджети за 2027 г.',
      kpi: {
        label: 'Най-голям ведомствен бюджет · проект 2027',
        mln: top ? top.expenditure.value / 1000 : null,
        scope: {
          key: 'zdb-vedomstva',
          label: 'Бюджети на ведомствата',
          note: 'не е целият бюджет',
        },
        source: ['budget2027'],
        asOf: ctx.data.budget2027?.publication,
      },
    };
  }
  if (ctx.period.key !== '2026.law')
    return {
      ic: 'landmark',
      q: 'Кой харчи парите?',
      href: ctx.href('S10'),
      text: 'Няма извлечени ведомствени бюджети за избрания период.',
      kpi: { label: ctx.period.label, value: null, status: 'pending' },
    };
  const items = arr(M && M.items).filter((it) => ok(it.expKhil));
  const top = items.slice().sort((a, b) => b.expKhil - a.expKhil)[0];
  const gdp = pick(O.periodKeys, O.gdp && O.gdp.mln, '2026.law'),
    mln = top ? top.expKhil / 1000 : null;
  return {
    ic: 'landmark',
    q: 'Кой харчи парите?',
    href: ctx.href('S10', {}, { per: '2026.law' }),
    text: top
      ? `Това е бюджетът на ${top.name}. Общо по закона са ${items.length} бюджета на министерства и други ведомства.`
      : PENDING,
    kpi: {
      label: `Най-голям бюджет на ведомство през ${yr(2026)}`,
      mln,
      pctGdp: mln !== null && ok(gdp) ? (mln / gdp) * 100 : null,
      scope: { key: 'zdb-vedomstva', label: 'Бюджети на ведомствата', note: 'не е целият бюджет' },
      status: 'real',
      source: ['zdb'],
      asOf: M && M.meta && M.meta.asOf,
    },
  };
}

/** 4 · what the measures change: how many, and what they add to revenue and take from expenditure (without the two indicative ones) */
function cardMeasures(ctx, O, MS) {
  if (['2027.draft', '2028.forecast', '2029.forecast'].includes(ctx.period.key))
    return {
      ic: 'fileText',
      q: 'Какво променят мерките?',
      href: ctx.href('S12', {}, { per: ctx.period.key }),
      text: 'Приходните и разходните мерки в таблици II-7 и II-8 на АСБП 2027–2029. Празните годишни клетки са обозначени.',
      kpi: {
        label:
          ctx.period.year === 2027
            ? 'Мерки в проекта за 2027'
            : `Мерки в прогнозата за ${ctx.period.year}`,
        value: '2027–2029',
        source: ['budget2027'],
        asOf: ctx.data.budget2027?.publication,
      },
    };
  const T = MS && MS.totals,
    C = MS && MS.counts,
    gdp = pick(O.periodKeys, O.gdp && O.gdp.mln, '2026.law');
  const part = (v) =>
    amount(ctx, {
      mln: Math.abs(v),
      pctGdp: ok(gdp) ? (Math.abs(v) / gdp) * 100 : null,
      scale: 'mln',
    });
  const r = T && T.revenueMln,
    e = T && T.expenditureMlnWithoutIndicative;
  return {
    ic: 'fileText',
    q: 'Какво променят мерките?',
    href: ctx.href('S12', {}, { per: '2026.law' }),
    text:
      ok(r) && ok(e)
        ? `Заедно те ${r >= 0 ? 'увеличават' : 'намаляват'} приходите с ${part(r)} и ${e <= 0 ? 'намаляват' : 'увеличават'} разходите с ${part(e)} (без двете индикативни мерки).`
        : PENDING,
    kpi: {
      // the measures and their effects are the bill's (S12 says so too), not a confirmed effect of the adopted law
      label: `Мерки по законопроекта за ${yr(2026)}`,
      value: C && ok(C.all) ? C.all : null,
      unit: 'мерки',
      scope: 'kfp',
      status: 'real',
      source: ['asbp', 'bill'],
      asOf: MS && MS.meta && MS.meta.asOf,
    },
  };
}

/** 5 · where we are heading: the balance in 2028 against 2026 (a deficit is shown as a positive number under the label „Дефицит“); yr() ends with a full stop, so these sentences add none */
function cardOutlook(ctx, O) {
  const publication = selectPeriod(ctx.annualRaw?.outlook, '2029.forecast');
  const B = O.kfp && O.kfp.balance;
  const startKey = ctx.period.year >= 2027 ? '2027.draft' : '2026.law',
    startYear = ctx.period.year >= 2027 ? 2027 : 2026;
  const b26 = pick(O.periodKeys, B && B.mln, startKey),
    b28 = pick(O.periodKeys, B && B.mln, '2029.forecast');
  const p26 = pick(O.periodKeys, B && B.pctGdp, startKey),
    p28 = pick(O.periodKeys, B && B.pctGdp, '2029.forecast');
  const both = ok(b26) && ok(b28);
  const A = (v, p) => amount(ctx, { mln: v, pctGdp: p });
  let text = PENDING;
  if (both && b26 < 0 && b28 < 0)
    text = `Прогнозата е дефицитът да ${b28 > b26 ? 'намалее' : 'нарасне'} от ${A(-b26, -p26)} през ${yr(startYear)} до ${A(-b28, -p28)} през ${yr(2029)}`;
  else if (both)
    text = `Салдото е ${A(b26, p26)} през ${yr(startYear)} и ${A(b28, p28)} през ${yr(2029)}`;
  return {
    ic: 'forecast',
    q: 'Накъде вървим?',
    href: ctx.href('S13'),
    text,
    kpi: {
      label: `${ok(b28) ? (b28 < 0 ? 'Дефицит' : 'Излишък') : 'Салдо'} през ${yr(2029)}`,
      mln: ok(b28) ? Math.abs(b28) : null,
      pctGdp: ok(p28) ? Math.abs(p28) : null,
      scope: 'kfp',
      status: 'forecast',
      source: publication.sourceRefs || [],
      asOf: publication.publication,
    },
  };
}

const card = (c) => html`<li class="s05-card">
  <div class="s05-top"><span class="s05-ic" aria-hidden="true">${icon(c.ic, { size: 26 })}</span><h2 class="s05-q"><a href="${c.href}">${c.q}</a></h2><span class="s05-go" aria-hidden="true">${icon('arrowRight', { size: 18 })}</span></div>
  ${kpi({ ...c.kpi, sub: c.text, cls: 's05-kpi' })}
</li>`;

export function render(ctx) {
  const D = ctx.data,
    O = D.outlook,
    Y = ctx.period.year;
  let first = true; // the КФП chip links to the glossary on the first card that carries it only
  const cards = [
    cardIncome(ctx, O, D.revenue, Y),
    cardSpend(ctx, O, D.expenditure, Y),
    cardAgencies(ctx, O, D.ministries),
    cardMeasures(ctx, O, D.measures),
    cardOutlook(ctx, O),
  ].map((c) => {
    if (c.kpi.scope !== 'kfp') return c;
    const scope = first ? 'kfp' : { key: 'kfp', gl: null };
    first = false;
    return { ...c, kpi: { ...c.kpi, scope } };
  });
  return html`${unitSwitch(ctx, { name: 's05-unit', note: 'Важи за сумите на картите.' })}
    <ul class="s05-cards" role="list">${cards.map(card)}</ul>`;
}

export function mount(root, ctx) {
  return bindUnitSwitch(root, ctx, 's05-unit');
}
