import { isFramework } from '../budget-2027.js';
import { debtView, mountBillSearch, debtChart2027 } from './bill-views.js';
// S17 Колко дължим? (G3). The state debt counted two ways: by the State Debt Act (ЗДД: table VI-1 of the budget motives, 2024-2028)
// and by the Maastricht rules (Eurostat, 2015-2025, against the 60% line). Every number comes from debt.json (D13+D14); the financing of
// the deficit from execution.json (D16), interest and balance from outlook.json (D15). Nothing is typed from memory.
// The visitor picks the count in the query: ?obhvat=zdd (default) | maastricht. Charts honour „% от БВП“ and „на човек“ (view.chartUnit).
import { html, esc } from '../html.js';
import { num, pct, date, monthName, money, moneyParts, EUR_RATE, NBSP, DASH } from '../format.js';
import { block } from '../ui/block.js';
import { seg } from '../ui/seg.js';
import { dataTable } from '../ui/table.js';
import { chart } from '../ui/chart.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { emptyState } from '../ui/states.js';
import { callout } from '../ui/cards.js';
import { progress } from '../ui/progress.js';
import { gl } from '../ui/gl.js';
import { disclosure } from '../ui/disclosure.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';
import { chartUnit, moneyCol } from '../view.js';

const ZDD = 'zdd',
  MAA = 'maastricht';
const SCOPE_NAME = { zdd: 'Държавен дълг', maastricht: 'Дълг по Маастрихт' };
/** under the year on the axis: what kind of numbers it is (the line break keeps five columns readable on a phone) */
const WORD = { actual: 'отчет', prelim: 'предв.\nотчет', plan: 'план', forecast: 'прогноза' };
const LONG = {
  actual: 'Отчет',
  prelim: 'Предварителен отчет',
  plan: 'План по проекта на бюджета',
  forecast: 'Прогноза',
};

/* ------------------------------------------------------------------ small helpers */
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const list = (a, n) =>
  Array.isArray(a) && a.length === n ? a : Array.from({ length: n }, () => null);
const pick = (a, i) => (Array.isArray(a) && ok(a[i]) ? a[i] : null);
const lastOf = (a) => (Array.isArray(a) && a.length ? a[a.length - 1] : null);
const maxAbs = (...lists) => Math.max(0, ...lists.flat().filter(ok).map(Math.abs));
const diff = (a, b) => (ok(a) && ok(b) ? a - b : null);
const chg = (a, b) => (ok(a) && ok(b) && b !== 0 ? (a / b - 1) * 100 : null);
/** „2026 г.“ with a no-break space, so that „г.“ never stands alone on a line */
const yr = (y) => `${y}${NBSP}г.`;
/** a year ends in a period already ("2025 г."): close a sentence with one period only */
const endDot = (t) => (/[.!?]$/.test(t) ? t : `${t}.`);
const capFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const ORD = ['първото', 'второто', 'третото', 'четвъртото'];
/** '2026-Q1' -> „първото тримесечие на 2026 г.“ */
const qName = (id) => {
  const m = /^(\d{4})-Q([1-4])$/.exec(id || '');
  return m ? `${ORD[+m[2] - 1]} тримесечие на ${yr(m[1])}` : String(id || '');
};
/** '2026-Q1' -> „2026\nТ1“ (the year and the quarter on two lines: a phone shows only some of the 42 labels, but never overlapping ones) */
const qCat = (id) => {
  const m = /^(\d{4})-Q([1-4])$/.exec(id || '');
  return m ? `${m[1]}\nТ${m[2]}` : String(id || '');
};
const levTxt = (mln) => {
  const v = mln * EUR_RATE;
  return `≈${NBSP}${v >= 1000 ? `${num(v / 1000, 2)}${NBSP}млрд.` : `${num(v, 1)}${NBSP}млн.`}${NBSP}лв.`;
};
const withShare = (mln, pg) => `${money(mln)}${ok(pg) ? ` (${pct(pg, 1)} от БВП)` : ''}`;

/* ------------------------------------------------------------------ the model: what the headline shows, derived once */
export function model(ctx) {
  const d = ctx.data.debt;
  const q = ctx.query || {};
  const scope = q.obhvat === MAA ? MAA : ZDD;
  const meta = (d.scopes || []).find((s) => s.id === scope) || {};
  const z = d.zdd || {},
    m = d.maastricht || {};
  const S =
    scope === ZDD
      ? { years: z.years || [], mln: z.totalMln, pg: z.pctGdp, vint: z.vintage || [] }
      : {
          years: m.years || [],
          mln: m.bg && m.bg.mln,
          pg: m.bg && m.bg.pctGdp,
          vint: (m.years || []).map(() => 'actual'),
        };
  // the headline year follows the period the visitor chose; a count without that year (Maastricht has no 2026-2028) shows its last year, and says so
  const want = ctx.period ? ctx.period.year : null;
  let i = S.years.indexOf(want);
  const fallback = i < 0;
  if (fallback) i = S.years.indexOf(meta.latestActual);
  if (i < 0) i = S.years.length - 1;
  const Y = S.years[i];
  const pop = ctx.core && ctx.core.population ? ctx.core.population : null;
  return {
    ctx,
    d,
    z,
    m,
    scope,
    meta,
    S,
    i,
    Y,
    kind: S.vint[i] || 'actual',
    fallback,
    want,
    mln: pick(S.mln, i),
    pg: pick(S.pg, i),
    prevY: i > 0 ? S.years[i - 1] : null,
    pMln: i > 0 ? pick(S.mln, i - 1) : null,
    pPg: i > 0 ? pick(S.pg, i - 1) : null,
    eu: scope === MAA && m.eu27 ? pick(m.eu27.pctGdp, i) : null,
    persons: pop && ok(pop.persons) ? pop.persons : null,
    popDate: pop ? pop.date : null,
    asOf: scope === ZDD ? z.asOf : m.asOf,
    src: scope === ZDD ? ['asbp'] : ['eurostat'],
    lastYear: lastOf(S.years),
  };
}

/** the links that stay on this screen keep the chosen count */
export function keepQuery(ctx, over = {}) {
  const out = {};
  if (ctx.query && ctx.query.obhvat) out.obhvat = ctx.query.obhvat;
  return { ...out, ...over };
}

/* ------------------------------------------------------------------ words */
/** the plain lead of the screen: the debt of the chosen count, then what comes next */
export function ledeText(M) {
  const { d, scope, Y, kind } = M;
  if (!ok(M.mln)) return '';
  if (scope === MAA) {
    const eu = ok(M.eu) ? ` В Европейския съюз като цяло е ${pct(M.eu, 1)} от БВП.` : '';
    return `По методиката на Маастрихт дългът на България към края на ${yr(Y)} е ${withShare(M.mln, M.pg)}.${eu}`;
  }
  const L = d.latest && d.latest.zdd;
  if (kind === 'actual') {
    const next = L && Y === L.year && L.next && ok(L.next.mln) ? L.next : null;
    return `Държавният дълг към края на ${yr(Y)} е ${withShare(M.mln, M.pg)}.${next ? ` По проекта на бюджета за ${yr(next.year)} ще стане ${withShare(next.mln, next.pctGdp)}.` : ''}`;
  }
  const base =
    L && ok(L.mln)
      ? `Държавният дълг към края на ${yr(L.year)} е ${withShare(L.mln, L.pctGdp)}. `
      : '';
  const what =
    kind === 'plan'
      ? `По проекта на бюджета за ${yr(Y)} ще стане`
      : `Прогнозата на Министерството на финансите за края на ${yr(Y)} е`;
  return `${base}${what} ${withShare(M.mln, M.pg)}.`;
}

/** one sentence under the heading of the numbers: what the chosen count is */
function scopeLead(M) {
  if (M.scope === ZDD)
    return 'Това е дългът на държавата по Закона за държавния дълг, както го показва Министерството на финансите. Разделен е на външен и вътрешен.';
  const thr = M.m && M.m.thresholdPctGdp;
  return `Това е консолидираният брутен дълг на целия сектор „Държавно управление“. По него България се сравнява с Европейския съюз${ok(thr) ? ` и с референтната стойност от ${pct(thr, 0)} от БВП` : ''}.`;
}

/* ------------------------------------------------------------------ the controls band */
const ctl = (label, id, inner) =>
  html`<div class="field s17-ctl"><span class="field-label" id="${id}">${label}</span>${inner}</div>`;

export function controls(M) {
  const ctx = M.ctx;
  return html`<div class="s17-controls" role="group" aria-label="Какво да покажем">
    ${ctl(
      'Как се брои дългът',
      's17-obhvat-l',
      seg({
        name: 's17-obhvat',
        label: 'Как се брои дългът',
        value: M.scope,
        query: 'obhvat',
        cls: 's17-seg',
        options: [
          { value: ZDD, label: SCOPE_NAME[ZDD] },
          { value: MAA, label: SCOPE_NAME[MAA] },
        ],
      }),
    )}
    ${unitSwitch(ctx, { name: 's17-unit', note: 'Важи за графиките по години. Тримесечният дълг е само в евро.' })}
  </div>`;
}

/* ------------------------------------------------------------------ „Накратко“: the three numbers of the debt */
/** the top of the default view (no Eurostat): three numbers of the budget itself. The debt at the end of the last report year, the biggest new debt
 *  of the planned year (for 2026 the cap of the law, art. 67) and the interest of that year. A planned period (2026-2028) picks its own year. */
function zddTiles(M) {
  const { ctx, d, z } = M,
    o = ctx.data.outlook,
    nd = d.newDebt,
    L = d.latest && d.latest.zdd,
    yrs = z.years || [];
  const lim =
    d.limits && Array.isArray(d.limits.items)
      ? d.limits.items.find((x) => x.id === 'newDebt')
      : null;
  const y1 = M.kind === 'actual' ? M.Y : L && L.year,
    yp = M.kind !== 'actual' ? M.Y : L && L.next && L.next.year;
  const lev = (v) => (ctx.store.get('leva') && ok(v) ? `(${levTxt(v)})` : '');
  const parts = (v) => (ok(v) ? moneyParts(v) : null);
  // 1 · the debt at the end of the last report year, with its share of GDP and per person
  const i1 = yrs.indexOf(y1),
    v1 = pick(z.totalMln, i1),
    g1 = pick(z.pctGdp, i1),
    c1 = i1 > 0 ? chg(v1, pick(z.totalMln, i1 - 1)) : null;
  const p1 = parts(v1),
    per = ok(v1) && M.persons ? (v1 * 1e6) / M.persons : null;
  const t1 = kpi({
    label: `Държавен дълг към края на ${yr(y1)}`,
    value: p1 ? p1.v : null,
    unit: p1 ? p1.u : '',
    gl: 'darzhaven-dalg',
    status: (z.vintage || [])[i1] === 'actual' ? undefined : 'forecast',
    delta: ok(c1)
      ? { value: c1, unit: '%', d: 1, label: `спрямо края на ${yr(y1 - 1)}` }
      : undefined,
    sub:
      [
        ok(g1) ? `${pct(g1, 1)} от БВП` : '',
        ok(per) ? `${num(per, 0)}${NBSP}€ на човек` : '',
        lev(v1),
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
  });
  // 2 · the biggest new debt of the planned year: the law's cap for 2026, the Ministry's plan for 2027-2028
  const pl = nd && Array.isArray(nd.plan) ? nd.plan.find((p) => p.year === yp) : null,
    law = !!pl && pl.kind === 'limit';
  const v2 =
      law && lim && ok(lim.mln) ? lim.mln : pl && ok(pl.bln) ? Math.round(pl.bln * 1000) : null,
    p2 = parts(v2);
  const t2 = kpi({
    label: law ? `Най-много нов дълг през ${yr(yp)}` : `Планиран нов дълг през ${yr(yp)}`,
    value: p2 ? p2.v : null,
    unit: p2 ? p2.u : '',
    gl: 'nov-dalg-novo-zaemane',
    status: law ? undefined : 'forecast',
    sub: [
      law && lim
        ? `Горна граница по закона (чл. ${lim.art}${lim.para ? `, ал. ${lim.para}` : ''}), не е прогноза`
        : 'План на Министерството на финансите',
      lev(v2),
    ]
      .filter(Boolean)
      .join(' · '),
  });
  // 3 · the interest of the planned year (the consolidated fiscal programme, as in the chart below)
  const oi = o && Array.isArray(o.years) ? o.years.indexOf(yp) : -1,
    I = o && o.kfp && o.kfp.interest;
  const v3 = oi >= 0 && I ? pick(I.mln, oi) : null,
    g3 = oi >= 0 && I ? pick(I.pctGdp, oi) : null,
    c3 = oi > 0 && I ? chg(v3, pick(I.mln, oi - 1)) : null,
    p3 = parts(v3);
  const t3 = kpi({
    label: `Лихви през ${yr(yp)}`,
    value: p3 ? p3.v : null,
    unit: p3 ? p3.u : '',
    gl: 'lihva',
    status: oi >= 0 && o.vintage && o.vintage[oi] === 'actual' ? undefined : 'forecast',
    delta: ok(c3) ? { value: c3, unit: '%', d: 1, label: `спрямо ${yr(yp - 1)}` } : undefined,
    sub: [
      ok(g3) ? `${pct(g3, 1)} от БВП` : '',
      'Разход на консолидираната фискална програма',
      lev(v3),
    ]
      .filter(Boolean)
      .join(' · '),
  });
  const inc =
    law && lim && lim.includes
      ? note(
          `Най-големият нов дълг по закона включва ${lim.includes}${ok(lim.includesMln) ? ` (${money(lim.includesMln)})` : ''}. Всички граници на закона са в блока „Какви граници слага законът“ по-долу.`,
        )
      : '';
  return {
    items: [t1, t2, t3],
    note: inc,
    source: srcOf(M.src, law ? (d.limits && d.limits.source) || ['zdb'] : []),
    asOf: [M.asOf, law && d.limits ? d.limits.asOf : null].filter(Boolean).sort().pop(),
    sub: 'Три числа от самия бюджет: колко дължи държавата, колко най-много нов дълг може да поеме и колко струват лихвите.',
  };
}
export function kpisBlock(M) {
  const { ctx, Y, kind } = M;
  const mp = ok(M.mln) ? moneyParts(M.mln) : null;
  const status = kind === 'actual' ? undefined : 'forecast';
  const vs = M.prevY ? `спрямо края на ${yr(M.prevY)}` : undefined;
  const dMln = chg(M.mln, M.pMln),
    dPg = diff(M.pg, M.pPg);
  const per = mp && M.persons ? (M.mln * 1e6) / M.persons : null;
  const kindNote =
    kind === 'plan'
      ? 'План по проекта на бюджета'
      : kind === 'forecast'
        ? 'Прогноза на Министерството на финансите'
        : '';
  const lev = ctx.store.get('leva') && mp ? `(${levTxt(M.mln)})` : '';
  const thr = M.m && M.m.thresholdPctGdp;
  const tiles = M.scope === ZDD ? zddTiles(M) : null; // the default count: the budget's own three numbers; Maastricht keeps the old three
  const items = tiles
    ? tiles.items
    : [
        kpi({
          label: `${SCOPE_NAME[M.scope]} към края на ${yr(Y)}`,
          value: mp ? mp.v : null,
          unit: mp ? mp.u : '',
          status,
          gl: M.scope === ZDD ? 'darzhaven-dalg' : 'sektor-darzhavno-upravlenie',
          delta: ok(dMln) ? { value: dMln, unit: '%', d: 1, label: vs } : undefined,
          sub: [kindNote, lev].filter(Boolean).join(' · ') || undefined,
        }),
        kpi({
          label: 'Дял от БВП',
          value: ok(M.pg) ? pct(M.pg, 1) : null,
          unit: ok(M.pg) ? 'от БВП' : '',
          status,
          gl: 'dyal-ot-bvp',
          delta: ok(dPg) ? { value: dPg, unit: 'пр.п.', d: 1, label: vs } : undefined,
          sub:
            M.scope === MAA && ok(thr) ? `Референтна стойност: ${pct(thr, 0)} от БВП` : undefined,
        }),
        kpi({
          label: 'На човек от населението',
          value: ok(per) ? num(per, 0) : null,
          unit: ok(per) ? '€ на човек' : '',
          status,
          sub: M.persons
            ? `При население от ${num(M.persons / 1e6, 2)}${NBSP}млн. души${M.popDate ? ` (${dateG(M.popDate)})` : ''}`
            : undefined,
        }),
      ];
  const lastQ =
    M.scope === MAA && M.d.latest && M.d.latest.maastricht ? M.d.latest.maastricht.quarter : null;
  const fb =
    M.fallback && M.want
      ? html`<p class="s17-note">За ${yr(M.want)} няма данни по тази методика: тя стига до ${yr(M.lastYear)} Показана е последната налична година.</p>`
      : '';
  const qline =
    lastQ && ok(lastQ.mln)
      ? html`<p class="s17-note">Най-новото тримесечие е ${qName(lastQ.id)}: ${withShare(lastQ.mln, lastQ.pctGdp)}${lastQ.flag === 'p' ? ', предварителни данни' : ''}.</p>`
      : '';
  return block({
    id: 's17-b-kpi',
    level: 2,
    title: tiles
      ? 'Накратко: дългът, новият дълг и лихвите'
      : `Накратко: дългът към края на ${yr(Y)}`,
    scope: M.scope,
    source: tiles ? tiles.source : M.src,
    asOf: tiles ? tiles.asOf : M.asOf,
    status: tiles ? 'partial' : kind === 'actual' ? 'real' : 'forecast',
    statusLabel: tiles ? 'Отчет и прогноза' : undefined,
    sub: tiles ? tiles.sub : scopeLead(M),
    share: { text: ledeText(M) },
    body: html`${fb}${kpiGrid(items, { label: tiles ? 'Дълг, нов дълг и лихви' : 'Основни числа за дълга' })}${tiles ? tiles.note : ''}${qline}`,
  });
}

/* ------------------------------------------------------------------ chart specs (pure builders: the page and the embeds share them) */
const dateG = (iso) => `${date(iso, true)}${NBSP}г.`;
/** axis ticks with as few decimals as the tick needs (2,5 not 2,50), never more than two */
const axisNum = (v) => {
  if (!ok(v)) return DASH;
  for (let k = 0; k < 3; k++) if (Math.abs(v - Number(v.toFixed(k))) < 1e-9) return num(v, k);
  return num(v, 2);
};
/** „1,06 млрд. €“ or „0,8% от БВП“, as the chart currently shows it */
const unitTxt = (u, v) =>
  !ok(v) ? DASH : u.kind === 'pct' ? `${pct(v, u.d)} от БВП` : `${u.fmt(v)}${NBSP}${u.unit}`;
/** which population stands behind „на човек“ */
const personNote = (u, M) =>
  u.kind === 'person' && M.popDate
    ? ` „На човек“ е при населението към ${dateG(M.popDate)} за всички години.`
    : '';
const sw = (c) =>
  `<span style="display:inline-block;width:10px;height:10px;border-radius:var(--r-1);margin-right:6px;background:${esc(c)}"></span>`;
const rowTip = (c, name, text) =>
  `<div style="display:flex;gap:12px;justify-content:space-between;align-items:center"><span>${sw(c)}${esc(name)}</span><b style="font-variant-numeric:tabular-nums">${esc(text)}</b></div>`;
/** tooltip: a heading from head(i), one row per non-empty series, and the printed total from total(i) when there is one */
const tipOf =
  (head, u, total, totalLabel = 'Общо') =>
  (ps) => {
    const rows = [].concat(ps).filter((p) => ok(p.value));
    if (!rows.length) return '';
    const i = rows[0].dataIndex;
    const t = total ? total(i) : null;
    return (
      `<div style="font-weight:700;margin-bottom:4px">${esc(head(i))}</div>${rows.map((p) => rowTip(p.color, p.seriesName, unitTxt(u, p.value))).join('')}` +
      (ok(t) && rows.length > 1
        ? `<div style="margin-top:4px;padding-top:4px;border-top:1px solid currentColor">${rowTip('transparent', totalLabel, unitTxt(u, t))}</div>`
        : '')
    );
  };
const kindName = (vint, i) => LONG[vint && vint[i]] || '';
const catOf = (years, vint) => years.map((y, i) => `${y}\n${WORD[vint && vint[i]] || ''}`.trim());
/** one bold number under the year, as the second line of the category label: a stacked bar carries no total of its own, and a number
 *  inside a bar does not keep a readable contrast on every fill and theme; on the page background the number always does */
const catsWithValue = (years, words, vals, u) =>
  years.map((y, i) =>
    [String(y), ok(vals[i]) ? u.fmt(vals[i]) : DASH, words[i] || ''].join('\n').trim(),
  );
const VALUE_AXIS = {
  xAxis: {
    axisLabel: {
      formatter: (v) =>
        String(v)
          .split('\n')
          .map((t, i) => (i === 1 ? `{v|${t}}` : t))
          .join('\n'),
      rich: { v: { fontWeight: 700 } },
    },
  },
};
/** on a phone every second year label (counting back from the latest year) keeps the labels apart; the tooltip and the table still hold every year */
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 599px)').matches;
const thin = (n) => ({
  xAxis: { axisLabel: { interval: (i) => !narrow() || (n - 1 - i) % 2 === 0 } },
});
/** one plain sentence for the accessible name of a chart */
const spanText = (what, years, mlns, vint) => {
  const a = mlns.findIndex(ok);
  let b = -1;
  mlns.forEach((v, i) => {
    if (ok(v)) b = i;
  });
  if (a < 0 || a === b) return '';
  const tail =
    vint && (vint[b] === 'plan' || vint[b] === 'forecast')
      ? ` (${vint[b] === 'plan' ? 'по проекта на бюджета' : 'по прогнозата'})`
      : '';
  return endDot(
    `${what}: от ${money(mlns[a])} през ${yr(years[a])} до ${money(mlns[b])} през ${yr(years[b])}${tail}`,
  );
};

/** F36 / F39: the state debt by year, external and internal, 2024-2028 (ЗДД, table VI-1) */
export function zddSpec(M) {
  const z = M.z,
    yrs = z.years || [];
  if (!yrs.length || !Array.isArray(z.totalMln)) return null;
  const u = chartUnit(M.ctx, { pct: true, max: maxAbs(z.totalMln) });
  const at = (mln, pg) => yrs.map((_, i) => u.conv(pick(mln, i), pick(pg, i)));
  const ext = at(z.externalMln, z.externalPctGdp),
    dom = at(z.domesticMln, z.domesticPctGdp),
    tot = at(z.totalMln, z.pctGdp);
  const split = ext.some(ok) && dom.some(ok);
  const col = (key, label) => ({ key, label, unit: u.unit, d: u.d, num: true });
  return {
    id: 's17-zdd',
    type: 'bar',
    stack: split,
    title: 'Държавният дълг по години',
    sub: `${u.unit}, към края на годината.${split ? ' Числото под годината е общият дълг.' : ''}${personNote(u, M)}`,
    categories: split
      ? catsWithValue(
          yrs,
          yrs.map((_, i) => WORD[z.vintage && z.vintage[i]] || ''),
          tot,
          u,
        )
      : catOf(yrs, z.vintage),
    categoryLabel: 'Година',
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    labels: !split,
    height: 320,
    option: {
      ...u.option(),
      ...(split ? VALUE_AXIS : {}),
      tooltip: {
        formatter: tipOf(
          (i) => `${yr(yrs[i])} · ${kindName(z.vintage, i)}`,
          u,
          split ? (i) => tot[i] : null,
        ),
      },
    },
    series: split
      ? [
          { name: 'Външен дълг', color: 1, data: ext },
          { name: 'Вътрешен дълг', color: 2, data: dom },
        ]
      : [{ name: 'Държавен дълг', color: 1, data: tot }],
    desc: spanText('Държавният дълг', yrs, z.totalMln, z.vintage),
    table: {
      columns: [
        { key: 'y', label: 'Година' },
        { key: 'k', label: 'Вид данни' },
        ...(split ? [col('e', 'Външен дълг'), col('d', 'Вътрешен дълг')] : []),
        col('t', 'Общо'),
      ],
      rows: yrs.map((y, i) => ({
        y: String(y),
        k: kindName(z.vintage, i),
        e: ext[i],
        d: dom[i],
        t: tot[i],
        _status: z.vintage && z.vintage[i] === 'actual' ? 'real' : 'forecast',
      })),
    },
  };
}

/** F36: the debt by the Maastricht rules, Bulgaria only, 2015-2025 (amounts follow the unit switch) */
export function maastrichtSpec(M) {
  const m = M.m,
    yrs = m.years || [];
  if (!yrs.length || !m.bg || !Array.isArray(m.bg.mln)) return null;
  const u = chartUnit(M.ctx, { pct: true, max: maxAbs(m.bg.mln) });
  const v = yrs.map((_, i) => u.conv(pick(m.bg.mln, i), pick(m.bg.pctGdp, i)));
  return {
    id: 's17-maastricht',
    type: 'bar',
    title: 'Дългът на България по Маастрихт по години',
    sub: `${u.unit}, към края на годината.${personNote(u, M)}`,
    categories: yrs.map(String),
    categoryLabel: 'Година',
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    height: 300,
    option: {
      ...u.option(),
      ...thin(yrs.length),
      tooltip: { formatter: tipOf((i) => `${yr(yrs[i])}`, u) },
    },
    series: [{ name: 'България', color: 1, data: v }],
    desc: spanText('Дългът по Маастрихт', yrs, m.bg.mln),
    table: {
      columns: [
        { key: 'y', label: 'Година' },
        { key: 'v', label: 'Дълг по Маастрихт', unit: u.unit, d: u.d, num: true },
      ],
      rows: yrs.map((y, i) => ({ y: String(y), v: v[i] })),
    },
  };
}

/** F36: Bulgaria and the European Union as a share of GDP, with the 60% line; always % от БВП (amounts of different countries do not compare) */
export function euSpec(M) {
  const m = M.m,
    yrs = m.years || [];
  if (!yrs.length || !m.bg || !Array.isArray(m.bg.pctGdp)) return null;
  const n = yrs.length,
    thr = ok(m.thresholdPctGdp) ? m.thresholdPctGdp : null;
  const bg = list(m.bg.pctGdp, n),
    eu = list(m.eu27 && m.eu27.pctGdp, n);
  const u = { kind: 'pct', unit: '% от БВП', d: 1, fmt: (v) => (ok(v) ? num(v, 1) : DASH) };
  const series = [{ name: 'България', color: 1, data: bg }];
  if (eu.some(ok)) series.push({ name: 'Европейски съюз (27 държави)', color: 2, data: eu });
  if (thr != null)
    series.push({
      name: `Референтна стойност (${pct(thr, 0)} от БВП)`,
      color: '--warn',
      dashed: true,
      data: yrs.map(() => thr),
    });
  const i = n - 1;
  return {
    id: 's17-eu',
    type: 'line',
    title: 'Дългът като дял от БВП: България и Европейският съюз',
    sub: '% от БВП, към края на годината.',
    categories: yrs.map(String),
    categoryLabel: 'Година',
    unit: u.unit,
    d: 1,
    fmt: u.fmt,
    min: 0,
    height: 320,
    option: {
      ...thin(n),
      yAxis: { axisLabel: { formatter: axisNum } },
      tooltip: { formatter: tipOf((k) => yr(yrs[k]), u) },
    },
    series,
    desc: ok(bg[i])
      ? `През ${yr(yrs[i])} дългът на България е ${pct(bg[i], 1)} от БВП${ok(eu[i]) ? `, а на Европейския съюз като цяло ${pct(eu[i], 1)}` : ''}${thr != null ? `, при референтна стойност ${pct(thr, 0)}` : ''}.`
      : '',
    table: {
      columns: [
        { key: 'y', label: 'Година' },
        { key: 'b', label: 'България', unit: u.unit, d: 1, num: true },
        ...(eu.some(ok)
          ? [{ key: 'e', label: 'Европейски съюз (27 държави)', unit: u.unit, d: 1, num: true }]
          : []),
      ],
      rows: yrs.map((y, k) => ({ y: String(y), b: bg[k], e: eu[k] })),
    },
  };
}

/** the quarterly debt of general government (BNB series, flags from Eurostat), million euro -> the unit of the page without % от БВП (there is no quarterly GDP) */
export function quarterSpec(M) {
  const q = M.d.quarterly,
    g = q && q.bnbGg;
  if (!g || !Array.isArray(g.quarters) || !Array.isArray(g.mln)) return null;
  const u = chartUnit(M.ctx, { pct: false, max: maxAbs(g.mln) });
  const es = q.eurostat || {};
  const prelim = new Set((es.quarters || []).filter((_, i) => es.flags && es.flags[i] === 'p'));
  const v = g.mln.map((x) => u.conv(x, null));
  const finals = v.map((x, i) => (prelim.has(g.quarters[i]) ? null : x)),
    pre = v.map((x, i) => (prelim.has(g.quarters[i]) ? x : null));
  const label = (i) => qName(g.quarters[i]);
  const a = g.mln.findIndex(ok),
    b = g.mln.length - 1;
  const series = [{ name: 'Окончателни данни', color: 1, data: finals }];
  if (pre.some(ok)) series.push({ name: 'Предварителни данни', color: 'other', data: pre });
  return {
    id: 's17-quarterly',
    type: 'bar',
    stack: true,
    title: 'Дълг на сектор „Държавно управление“ по тримесечия',
    sub: `${u.unit}, към края на тримесечието.${personNote(u, M)}`,
    categories: g.quarters.map(qCat),
    categoryLabel: 'Тримесечие',
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    height: 300,
    option: {
      ...u.option(),
      xAxis: {
        axisLabel: {
          interval: (_, c) => String(c).endsWith('Т1'),
          formatter: (c) => String(c).split('\n')[0],
        },
      },
      tooltip: { formatter: tipOf(label, u) },
    },
    series,
    desc:
      a >= 0
        ? endDot(
            `Дългът на сектор „Държавно управление“ е ${money(g.mln[a])} в ${qName(g.quarters[a])} и ${money(g.mln[b])} в ${qName(g.quarters[b])}`,
          )
        : '',
    table: {
      columns: [
        { key: 'q', label: 'Тримесечие' },
        { key: 'v', label: 'Дълг', unit: u.unit, d: u.d, num: true },
        { key: 'f', label: 'Бележка' },
      ],
      rows: g.quarters.map((id, i) => ({
        q: qCat(id).replace('\n', ' '),
        v: v[i],
        f: prelim.has(id) ? (es.flagLabels && es.flagLabels.p) || 'предварителни данни' : '',
      })),
    },
  };
}

/* ---- interest and balance (outlook.json, the КФП): one bar per year, coloured by the kind of numbers */
const grpOf = (k) => (k === 'actual' || k === 'prelim' ? 'rep' : k === 'plan' ? 'plan' : 'fc');
function outlookFrame(M) {
  const o = M.ctx.data.outlook;
  if (!o || !Array.isArray(o.years) || !o.years.length) return null;
  const n = o.years.length;
  const ser = (key) => ({
    mln: list(o.kfp && o.kfp[key] && o.kfp[key].mln, n),
    pg: list(o.kfp && o.kfp[key] && o.kfp[key].pctGdp, n),
  });
  return {
    years: o.years,
    n,
    kinds: o.years.map((_, i) => (WORD[o.vintage && o.vintage[i]] ? o.vintage[i] : 'forecast')),
    interest: ser('interest'),
    balance: ser('balance'),
    asOf: o.meta && o.meta.asOf,
  };
}
function groupNames(f) {
  const rep = new Set(f.kinds.filter((k) => grpOf(k) === 'rep'));
  const planYears = f.years.filter((_, i) => f.kinds[i] === 'plan');
  return {
    rep:
      rep.size === 2
        ? 'Отчет и предварителен отчет'
        : rep.has('prelim')
          ? LONG.prelim
          : LONG.actual,
    plan: planYears.length === 1 ? `План за ${yr(planYears[0])}` : LONG.plan,
    fc: LONG.forecast,
  };
}
function yearBars(M, f, o) {
  const u = chartUnit(M.ctx, { pct: true, max: maxAbs(o.s.mln) });
  const v = o.s.mln.map((mln, i) =>
    u.conv(ok(mln) ? mln * o.sign : null, ok(o.s.pg[i]) ? o.s.pg[i] * o.sign : null),
  );
  const names = groupNames(f);
  const groups = [
    { g: 'rep', color: '--data' }, // series-1 is the same near-black as --data, so plans and limits use series 5
    { g: 'plan', color: 5 },
    { g: 'fc', color: 'other' },
  ].filter((x) => f.kinds.some((k) => grpOf(k) === x.g));
  return {
    id: o.id,
    type: 'bar',
    stack: true,
    title: o.title,
    sub: `${u.unit}, за годината.${personNote(u, M)}`,
    categories: catsWithValue(
      f.years,
      f.kinds.map((k) => WORD[k]),
      v,
      u,
    ),
    categoryLabel: 'Година',
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    min: o.min,
    height: 300,
    option: {
      ...u.option(),
      ...VALUE_AXIS,
      tooltip: { formatter: tipOf((i) => `${yr(f.years[i])} · ${LONG[f.kinds[i]]}`, u) },
    },
    series: groups.map((x) => ({
      name: names[x.g],
      color: x.color,
      data: v.map((x1, i) => (grpOf(f.kinds[i]) === x.g ? x1 : null)),
    })),
    desc: spanText(
      o.noun,
      f.years,
      o.s.mln.map((x) => (ok(x) ? x * o.sign : null)),
      f.kinds,
    ),
    table: {
      columns: [
        { key: 'y', label: 'Година' },
        { key: 'k', label: 'Вид данни' },
        { key: 'v', label: o.col, unit: u.unit, d: u.d, num: true },
      ],
      rows: f.years.map((y, i) => ({
        y: String(y),
        k: LONG[f.kinds[i]],
        v: v[i],
        _status: f.kinds[i] === 'forecast' ? 'forecast' : 'real',
      })),
    },
  };
}
export function interestSpec(M) {
  const f = outlookFrame(M);
  return f && f.interest.mln.some(ok)
    ? yearBars(M, f, {
        id: 's17-interest',
        title: 'Лихви по дълга',
        col: 'Лихви',
        noun: 'Лихвите',
        s: f.interest,
        sign: 1,
        min: 0,
      })
    : null;
}
/** a deficit in every year is drawn as the size of the deficit; any surplus turns it into the plain signed balance */
export function balanceSpec(M) {
  const f = outlookFrame(M);
  if (!f || !f.balance.mln.some(ok)) return null;
  const def = f.balance.mln.every((x) => !ok(x) || x <= 0);
  return yearBars(M, f, {
    id: 's17-balance',
    title: def ? 'Дефицит по години' : 'Салдо по години',
    col: def ? 'Дефицит' : 'Салдо',
    noun: def ? 'Дефицитът' : 'Салдото',
    s: f.balance,
    sign: def ? -1 : 1,
    min: def ? 0 : undefined,
  });
}

/* ------------------------------------------------------------------ how the deficit is financed (execution.json, КФП: the file keeps cumulative figures from January) */
const FIN_GROUPS = [
  {
    id: 'fin.ext',
    parts: ['fin.ext.markets', 'fin.ext.deposits', 'fin.ext.repay', 'fin.ext.securities'],
  },
  { id: 'fin.dom', parts: ['fin.dom.advances', 'fin.dom.refunds'] },
  { id: 'fin.priv', parts: ['fin.priv.shares'] },
];
const REST = 'Други пера (разлика)';
// below what one decimal of a million shows (0,0): rounding noise of the source, not a line worth printing
const tiny = (v) => !ok(v) || Math.abs(v) < 0.05;

/** the financing lines of one year: cumulative at the last reported month, the same month a year earlier, and month by month */
export function finModel(M) {
  const ex = M.ctx.data.execution;
  if (!ex || !ex.data || !Array.isArray(ex.rows)) return null;
  const ys = Object.keys(ex.data)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!ys.length) return null;
  const want = M.ctx.period ? M.ctx.period.year : null;
  const fallback = !ys.includes(want);
  const Y = fallback ? ys[ys.length - 1] : want;
  const cur = ex.data[Y],
    prev = ex.data[Y - 1] || null;
  const arr = (d, id) => (d && d.kfp && Array.isArray(d.kfp[id]) ? d.kfp[id] : null);
  const n = cur && Number.isInteger(cur.months) ? cur.months : 0;
  if (!n || !arr(cur, 'fin')) return null;
  const k = n - 1;
  const prevOk = !!prev && Number.isInteger(prev.months) && prev.months >= n && !!arr(prev, 'fin');
  const names = new Map(ex.rows.map((r) => [r.id, r.short || r.label]));
  const at = (d, id) => {
    const a = arr(d, id);
    return a && ok(a[k]) ? a[k] : null;
  };
  const mon = (id) => {
    const a = arr(cur, id);
    return Array.from({ length: n }, (_, i) =>
      a && ok(a[i]) && (i === 0 || ok(a[i - 1])) ? a[i] - (i ? a[i - 1] : 0) : null,
    );
  };
  const item = (id, name, lvl) => ({
    id,
    name: name || names.get(id) || id,
    lvl,
    cur: at(cur, id),
    prev: prevOk ? at(prev, id) : null,
    mon: mon(id),
  });
  const zero = (it) => tiny(it.cur) && tiny(it.prev) && it.mon.every(tiny);
  const sum = (its, f) => its.reduce((s, it) => s + (ok(f(it)) ? f(it) : 0), 0);
  // what is left of a total after the lines shown under it: computed here, never named as an operation
  const remainder = (id, lvl, top, its) => ({
    id,
    name: REST,
    lvl,
    cur: ok(top.cur) ? top.cur - sum(its, (it) => it.cur) : null,
    prev: ok(top.prev) ? top.prev - sum(its, (it) => it.prev) : null,
    mon: top.mon.map((v, i) => (ok(v) ? v - sum(its, (it) => it.mon[i]) : null)),
  });
  const total = item('fin', 'Общо финансиране (равно на дефицита)', 0);
  const groups = FIN_GROUPS.map((g) => {
    const top = item(g.id, null, 1);
    const parts = g.parts.map((id) => item(id, null, 2)).filter((it) => !zero(it));
    const rest = remainder(`${g.id}.rest`, 2, top, parts);
    return { top, parts, rest: zero(rest) ? null : rest };
  });
  const rest0 = remainder(
    'fin.rest',
    1,
    total,
    groups.map((g) => g.top),
  );
  const ext = groups[0].top,
    dom = groups[1].top;
  let opp = null;
  for (let i = 0; i < n; i++) {
    const a = ext.mon[i],
      b = dom.mon[i];
    if (!ok(a) || !ok(b) || a * b >= 0) continue;
    const s = Math.min(Math.abs(a), Math.abs(b));
    if (
      s >= 500 &&
      Math.abs(a + b) <= 0.2 * Math.max(Math.abs(a), Math.abs(b)) &&
      (!opp || s > opp.s)
    )
      opp = { i, a, b, s, t: total.mon[i] };
  }
  const plan =
    Y === 2026 && ex.plan2026 && ex.plan2026.kfp && ok(ex.plan2026.kfp.fin)
      ? ex.plan2026.kfp.fin
      : null;
  const asOf =
    Array.isArray(cur.asOf) && cur.asOf[k] ? cur.asOf[k] : (ex.meta && ex.meta.asOf) || null;
  return {
    Y,
    n,
    k,
    fallback,
    want,
    prevOk,
    total,
    groups,
    rest: zero(rest0) ? null : rest0,
    opp,
    plan,
    asOf,
    src: ['kfp'],
  };
}

/** the plain account of the financing: how much, and from where */
export function finText(F) {
  const t = F.total;
  if (!ok(t.cur)) return '';
  const [e, d, p] = F.groups.map((g) => g.top.cur);
  const part = (x, name) => (ok(x) ? `${name} ${money(x)}` : '');
  const parts = [
    part(e, 'външно финансиране (нето)'),
    part(d, 'вътрешно финансиране (нето)'),
    part(p, 'приватизация и възмездни средства'),
  ].filter(Boolean);
  const share =
    F.plan && t.cur >= 0
      ? ` Това е ${pct((t.cur / F.plan) * 100, 1)} от дефицита, планиран за цялата година (${money(F.plan)}).`
      : '';
  return `От началото на ${yr(F.Y)} до ${dateG(F.asOf)} ${t.cur >= 0 ? 'дефицитът' : 'излишъкът'} на консолидираната фискална програма е ${money(Math.abs(t.cur))}. Покрит е така: ${parts.join(', ')}.${share}`;
}

/** F37: the monthly financing, stacked by kind; a month's total is the deficit of that month */
export function financeSpec(M, F) {
  F = F || finModel(M);
  if (!F) return null;
  const [ge, gd, gp] = F.groups.map((g) => g.top);
  const u = chartUnit(M.ctx, {
    pct: false,
    max: maxAbs(ge.mon, gd.mon, gp.mon, F.rest ? F.rest.mon : []),
    d: undefined,
  });
  const cv = (a) => a.map((v) => u.conv(v, null));
  const cats = F.total.mon.map((_, i) => monthName(i + 1, true));
  const series = [
    { name: 'Външно финансиране (нето)', color: 1, data: cv(ge.mon) },
    { name: 'Вътрешно финансиране (нето)', color: 2, data: cv(gd.mon) },
    { name: 'Приватизация и възмездни средства', color: 3, data: cv(gp.mon) },
  ];
  if (F.rest) series.push({ name: 'Други пера', color: 4, data: cv(F.rest.mon) });
  const tot = cv(F.total.mon);
  const col = (key, label) => ({ key, label, unit: u.unit, d: u.d, num: true });
  return {
    id: 's17-finance',
    type: 'bar',
    stack: true,
    title: `Финансиране на дефицита през ${yr(F.Y)}, по месеци`,
    sub: `${u.unit}, нетно за месеца (не е натрупано от началото на годината)`,
    categories: cats,
    categoryLabel: 'Месец',
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    height: 320,
    option: {
      ...u.option(),
      tooltip: {
        formatter: tipOf(
          (i) => `${capFirst(monthName(i + 1))} ${F.Y}`,
          u,
          (i) => tot[i],
          'Общо (равно на дефицита за месеца)',
        ),
      },
    },
    series,
    desc: finText(F),
    table: {
      columns: [
        { key: 'm', label: 'Месец' },
        col('e', 'Външно финансиране (нето)'),
        col('d', 'Вътрешно финансиране (нето)'),
        col('p', 'Приватизация и възмездни средства'),
        ...(F.rest ? [col('o', 'Други пера')] : []),
        col('t', 'Общо'),
      ],
      rows: cats.map((c, i) => ({
        m: `${capFirst(monthName(i + 1))} ${F.Y}`,
        e: series[0].data[i],
        d: series[1].data[i],
        p: series[2].data[i],
        o: F.rest ? series[3].data[i] : null,
        t: tot[i],
      })),
    },
  };
}

const moneyCell = (mc, mln) => {
  const lev = mc.lev(mln);
  return html`${mc.text(mln)}${lev ? html`<span class="s17-lev">${lev}</span>` : ''}`;
};
const nameCell = (v, r) => html`<span class="s17-ind s17-ind-${r.lvl}">${v}</span>`;

/** the cumulative table: this year to the last month, the same month a year earlier */
export function finTable(M, F) {
  const mc = moneyCol(M.ctx, { d: 1 });
  const mname = monthName(F.n);
  const rowOf = (it) => ({
    name: it.name,
    lvl: it.lvl,
    cur: mc.raw(it.cur),
    prev: mc.raw(it.prev),
    curMln: it.cur,
    prevMln: it.prev,
  });
  const rows = [];
  F.groups.forEach((g) => {
    rows.push(rowOf(g.top));
    g.parts.forEach((p) => rows.push(rowOf(p)));
    if (g.rest) rows.push(rowOf(g.rest));
  });
  if (F.rest) rows.push(rowOf(F.rest));
  const col = (key, label, f) => ({
    key,
    label,
    num: true,
    unit: mc.unit,
    d: mc.d,
    fmt: (_v, r) => moneyCell(mc, r[f]),
  });
  return dataTable({
    id: 's17-t-fin',
    caption: `Финансиране на дефицита от началото на ${yr(F.Y)} до ${dateG(F.asOf)}`,
    columns: [
      { key: 'name', label: 'Пера на финансирането', fmt: nameCell },
      col('cur', `Към ${mname} ${F.Y}`, 'curMln'),
      ...(F.prevOk ? [col('prev', `Към ${mname} ${F.Y - 1}`, 'prevMln')] : []),
    ],
    rows,
    dense: true,
    total: { label: F.total.name, values: rowOf(F.total) },
    note: 'Нето е полученото минус платеното. Знакът минус означава, че през периода са платени повече пари, отколкото са получени. Редът „Други пера (разлика)“ е изчислен тук: общата сума на групата минус показаните под нея пера.',
  });
}

/** the same items month by month (months across): a closed disclosure under the table */
export function finMonths(M, F) {
  const mc = moneyCol(M.ctx, { d: 1 });
  const items = [];
  F.groups.forEach((g) => {
    items.push(g.top, ...g.parts);
    if (g.rest) items.push(g.rest);
  });
  if (F.rest) items.push(F.rest);
  const rows = items.map((it) => {
    const r = { name: it.name, lvl: it.lvl };
    it.mon.forEach((v, i) => {
      r[`m${i}`] = mc.raw(v);
    });
    return r;
  });
  const tv = { name: F.total.name, lvl: 0 };
  F.total.mon.forEach((v, i) => {
    tv[`m${i}`] = mc.raw(v);
  });
  const cols = [
    { key: 'name', label: 'Пера на финансирането', fmt: nameCell },
    ...F.total.mon.map((_, i) => ({
      key: `m${i}`,
      label: monthName(i + 1, true),
      num: true,
      d: mc.d,
    })),
  ];
  return disclosure({
    id: 's17-fin-months',
    title: 'Месец по месец, по пера',
    body: dataTable({
      id: 's17-t-fin-months',
      caption: `Нетно финансиране по месеци, ${yr(F.Y)}, ${mc.unit}`,
      columns: cols,
      rows,
      total: { label: F.total.name, values: tv },
      dense: true,
      note: 'Всяка колона е само един месец: разликата между натрупаното до него и натрупаното до предишния месец.',
    }),
  });
}

/** two big sums of opposite sign in one month: say only what is arithmetic */
export function oppNote(F) {
  const o = F.opp;
  if (!o) return '';
  const mn = monthName(o.i + 1);
  const outcome =
    o.t >= 0
      ? `Общо за месеца финансирането е ${money(o.t)}: толкова е дефицитът за месеца.`
      : `Общо за месеца финансирането е ${money(o.t)}: през месеца няма дефицит, а излишък от ${money(-o.t)}.`;
  return callout({
    kind: 'info',
    id: 's17-fin-opp',
    title: `Две големи суми с обратен знак през ${mn}`,
    body: html`<p>През ${mn} външното финансиране (нето) е ${money(o.a)}, а вътрешното е ${money(o.b)}. Двете суми са с противоположен знак и почти се уравновесяват. ${outcome}</p>`,
  });
}

/* ------------------------------------------------------------------ blocks */
const EMPTY_CHART = () =>
  emptyState({
    title: 'Няма данни за графиката',
    text: 'За избрания обхват и година няма стойности за тази графика.',
  });
const hasData = (s) =>
  !!s &&
  Array.isArray(s.series) &&
  s.series.some((x) => (x.data || []).some((v) => ok(v && typeof v === 'object' ? v.value : v)));
const note = (txt) => (txt ? html`<p class="s17-note">${txt}</p>` : '');
/** a chart that mixes reported and forecast years says so on its block */
const mixed = (kinds) => {
  const rep = kinds.some((k) => k === 'actual' || k === 'prelim'),
    fc = kinds.some((k) => k === 'plan' || k === 'forecast');
  return rep && fc
    ? { status: 'partial', statusLabel: 'Отчет и прогноза' }
    : fc
      ? { status: 'forecast' }
      : {};
};
const scopeNote = (M, id) => ((M.d.scopes || []).find((s) => s.id === id) || {}).note;
const noteText = (M, id) => {
  const n = (M.d.notes || []).find((x) => x.id === id);
  return n ? n.text : '';
};

function chartBlock(spec, o) {
  const has = hasData(spec);
  return block({
    id: o.id,
    level: 2,
    title: o.title,
    sub: o.sub,
    scope: o.scope,
    source: o.source,
    asOf: o.asOf,
    status: o.status,
    statusLabel: o.statusLabel,
    share: has ? { embed: spec.id, text: o.text || spec.desc } : false,
    body: has ? html`${o.pre || ''}${chart(spec)}${o.post || ''}` : EMPTY_CHART(),
  });
}
/** a dataset that did not load: the block keeps its place and says so */
const notLoaded = (id, title, scope) =>
  block({
    id,
    level: 2,
    title,
    scope,
    status: false,
    share: false,
    body: emptyState({
      title: 'Данните не са заредени',
      text: 'Презареди страницата. Ако проблемът остане, ползвай бутона „Намерих грешка“ под страницата.',
    }),
  });

/* ---- debt by year */
function zddBlock(M) {
  const z = M.z;
  return chartBlock(zddSpec(M), {
    id: 's17-b-zdd',
    title: 'Как се променя държавният дълг',
    sub: scopeNote(M, ZDD),
    scope: ZDD,
    source: z.source || ['asbp'],
    asOf: z.asOf,
    ...mixed(z.vintage || []),
    post: note(noteText(M, 'projection')),
  });
}
function maastrichtBlock(M) {
  const m = M.m;
  return chartBlock(maastrichtSpec(M), {
    id: 's17-b-maastricht',
    title: 'Как се променя дългът по Маастрихт',
    sub: scopeNote(M, MAA),
    scope: MAA,
    source: m.source || ['eurostat'],
    asOf: m.asOf,
  });
}
/** Bulgaria against the European Union, the 60% line, and the plain meter „скала до 60%“ */
function euBlock(M) {
  const m = M.m,
    thr = m.thresholdPctGdp,
    n = (m.years || []).length;
  const bg = n && m.bg ? pick(m.bg.pctGdp, n - 1) : null;
  let meter = '';
  if (ok(bg) && ok(thr) && thr > 0) {
    const gap = thr - bg;
    meter = html`<div class="s17-meter">${progress({ id: 's17-meter', label: `Скала до ${pct(thr, 0)} от БВП`, value: bg, max: thr, text: `${pct(bg, 1)} от БВП` })}
      <p class="s17-note">Към края на ${yr(m.years[n - 1])} България е ${num(Math.abs(gap), 1)} процентни пункта ${gap >= 0 ? 'под' : 'над'} референтната стойност от ${pct(thr, 0)}.</p></div>`;
  }
  return chartBlock(euSpec(M), {
    id: 's17-b-eu',
    title: 'България и Европейският съюз',
    sub: 'Колко е дългът спрямо размера на икономиката: България, Европейският съюз като цяло и референтната стойност.',
    scope: MAA,
    source: m.source || ['eurostat'],
    asOf: m.asOf,
    pre: meter,
    post: note(m.thresholdNote),
  });
}
function quarterBlock(M) {
  const g = M.d.quarterly && M.d.quarterly.bnbGg;
  const dev = M.d.check && M.d.check.eurostatQuarterlyVsBnbGgMaxDev;
  const agree = ok(dev)
    ? `Данните на БНБ и на Eurostat за дълга на сектор „Държавно управление“ съвпадат: най-голямата разлика е ${num(dev, 2)}${NBSP}млн.${NBSP}€.`
    : '';
  return chartBlock(quarterSpec(M), {
    id: 's17-b-quarterly',
    title: 'Дългът тримесечие по тримесечие',
    sub: 'Консолидиран брутен дълг на сектор „Държавно управление“ към края на всяко тримесечие.',
    scope: MAA,
    source: ['bnb', 'eurostat'],
    asOf: g && g.asOf,
    post: html`${note(noteText(M, 'quarterly'))}${note(agree)}`,
  });
}

/* ---- interest and the deficit (the КФП, outlook.json) */
function interestBlock(M) {
  const o = M.ctx.data.outlook;
  if (!o) return notLoaded('s17-b-interest', 'Колко струват лихвите', 'kfp');
  return chartBlock(interestSpec(M), {
    id: 's17-b-interest',
    title: 'Колко струват лихвите',
    sub: 'Лихвените разходи в консолидираната фискална програма.',
    scope: 'kfp',
    source: o.meta.source || ['asbp'],
    asOf: o.meta.asOf,
    ...mixed(o.vintage || []),
    post: interestDisclosure(M),
  });
}
function balanceBlock(M) {
  const o = M.ctx.data.outlook;
  if (!o) return notLoaded('s17-b-balance', 'Колко е дефицитът', 'kfp');
  return chartBlock(balanceSpec(M), {
    id: 's17-b-balance',
    title: 'Колко е дефицитът',
    sub: 'Разликата между разходите и приходите за годината в консолидираната фискална програма.',
    scope: 'kfp',
    source: o.meta.source || ['asbp'],
    asOf: o.meta.asOf,
    ...mixed(o.vintage || []),
  });
}

/* ---- how the deficit is covered */
function financeBlock(M, F) {
  if (!F) return notLoaded('s17-b-fin', 'Как се покрива дефицитът', 'kfp');
  const fb =
    F.fallback && F.want
      ? note(`За ${yr(F.want)} няма месечен отчет за изпълнението. Показана е ${yr(F.Y)}`)
      : '';
  const spec = financeSpec(M, F);
  return block({
    id: 's17-b-fin',
    level: 2,
    title: 'Как се покрива дефицитът',
    sub: 'Откъде идват парите, когато разходите са повече от приходите.',
    scope: 'kfp',
    source: F.src,
    asOf: F.asOf,
    share: { embed: spec.id, text: finText(F) },
    body: html`${fb}
      <div class="s17-lead">
        <p>Когато държавата похарчи повече, отколкото събере, разликата е ${gl('byudzheten-defitsit', 'дефицит')}. Парите за него идват от ${gl('nov-dalg-novo-zaemane', 'нов дълг')} и от други източници. Това се нарича финансиране.</p>
        <p>${finText(F)}</p>
      </div>
      ${chart(spec)}${oppNote(F)}
      <p class="s17-note">„Нето“ е полученото минус платеното. Знакът минус означава, че през периода са платени повече пари, отколкото са получени.</p>`,
  });
}
function financeTableBlock(M, F) {
  if (!F) return '';
  return block({
    id: 's17-b-fin-table',
    level: 2,
    title: 'Финансирането по пера',
    scope: 'kfp',
    source: F.src,
    asOf: F.asOf,
    sub: `Натрупано от началото на ${yr(F.Y)} до ${dateG(F.asOf)}${F.prevOk ? `, сравнено със същото време на ${yr(F.Y - 1)}` : ''}`,
    share: { text: finText(F) },
    body: html`${finTable(M, F)}${finMonths(M, F)}`,
  });
}

/* ---- the new debt: how much, of what, for what */
const lastRep = (nd) => {
  const k = Object.keys(nd || {})
    .filter((x) => /^y\d{4}$/.test(x))
    .sort()
    .pop();
  return k ? { year: Number(k.slice(1)), ...nd[k] } : null;
};
const DEBT_USES = [
  'рефинансиране на дълга в обращение',
  'покриване на бюджетния дефицит, включително за префинансиране по Плана за възстановяване и устойчивост',
  'придобиване на дялове, акции и съучастия',
  'други финансиращи операции',
];
const NEW_WORD = { rep: 'отчет', limit: 'горна\nграница', plan: 'план' };
const NEW_NAME = {
  rep: 'Отчет',
  limit: 'Горна граница по закона',
  plan: 'План на Министерството на финансите',
};

export function newDebtSpec(M) {
  const nd = M.d.newDebt;
  if (!nd) return null;
  const rows = [];
  const r = lastRep(nd);
  if (r && ok(r.totalMln)) rows.push({ year: r.year, kind: 'rep', mln: r.totalMln });
  (nd.plan || []).forEach((p) => {
    if (ok(p.bln))
      rows.push({
        year: p.year,
        kind: p.kind === 'limit' ? 'limit' : 'plan',
        mln: Math.round(p.bln * 1000),
      });
  });
  if (!rows.length) return null;
  const u = chartUnit(M.ctx, { pct: false, max: maxAbs(rows.map((x) => x.mln)) });
  const groups = [
    { g: 'rep', color: '--data' }, // series-1 is the same near-black as --data, so plans and limits use series 5
    { g: 'limit', color: 5 },
    { g: 'plan', color: 'other' },
  ].filter((x) => rows.some((y) => y.kind === x.g));
  const v = rows.map((x) => u.conv(x.mln, null));
  const kl = nd.kindLabels || {};
  return {
    id: 's17-newdebt',
    type: 'bar',
    stack: true,
    title: 'Нов държавен дълг по години',
    sub: `${u.unit}, поет през годината.${personNote(u, M)}`,
    categories: catsWithValue(
      rows.map((x) => x.year),
      rows.map((x) => NEW_WORD[x.kind]),
      v,
      u,
    ),
    categoryLabel: 'Година',
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    height: 300,
    option: {
      ...u.option(),
      ...VALUE_AXIS,
      tooltip: { formatter: tipOf((i) => `${yr(rows[i].year)} · ${NEW_NAME[rows[i].kind]}`, u) },
    },
    series: groups.map((x) => ({
      name: NEW_NAME[x.g],
      color: x.color,
      data: v.map((y, i) => (rows[i].kind === x.g ? y : null)),
    })),
    desc: endDot(
      `Новият държавен дълг: ${rows.map((x) => `${money(x.mln)} през ${yr(x.year)}${x.kind === 'limit' ? ' (горна граница по закона)' : x.kind === 'plan' ? ' (план)' : ''}`).join(', ')}`,
    ),
    table: {
      columns: [
        { key: 'y', label: 'Година' },
        { key: 'k', label: 'Вид' },
        { key: 'v', label: 'Нов дълг', unit: u.unit, d: u.d, num: true },
      ],
      rows: rows.map((x, i) => ({
        y: String(x.year),
        k: x.kind === 'rep' ? 'Отчет' : kl[x.kind] || NEW_NAME[x.kind],
        v: v[i],
        _status: x.kind === 'rep' ? 'real' : 'forecast',
      })),
    },
  };
}

function newDebtParts(M) {
  const nd = M.d.newDebt,
    r = lastRep(nd);
  if (!r || !Array.isArray(r.parts)) return '';
  const mc = moneyCol(M.ctx, { d: 1 });
  const rows = r.parts.map((p) => ({ name: p.label, v: mc.raw(p.mln), mln: p.mln }));
  const col = {
    key: 'v',
    label: `Поет през ${yr(r.year)}`,
    num: true,
    unit: mc.unit,
    d: mc.d,
    fmt: (_v, x) => moneyCell(mc, x.mln),
  };
  const repay = ok(r.repaymentsBln)
    ? html`<p class="s17-note">През ${yr(r.year)} погашенията към външни и вътрешни кредитори са ${money(Math.round(r.repaymentsBln * 1000))}.</p>`
    : '';
  return html`<h3 class="s17-minor">От какво се състои новият дълг през ${yr(r.year)}</h3>
    ${dataTable({ id: 's17-t-newdebt', caption: `Нов държавен дълг през ${yr(r.year)}, по видове`, columns: [{ key: 'name', label: 'Вид' }, col], rows, total: { label: `Общо нов дълг през ${yr(r.year)}`, values: { name: '', v: mc.raw(r.totalMln), mln: r.totalMln } }, dense: true })}${repay}`;
}

function newDebtUses(M) {
  const nd = M.d.newDebt,
    lim = (nd.plan || []).find((p) => p.kind === 'limit');
  const uses = Array.isArray(nd.uses) && nd.uses.length ? nd.uses : DEBT_USES;
  if (!lim) return '';
  return html`<h3 class="s17-minor">За какво са парите от новия дълг през ${yr(lim.year)}</h3>
    <p>Според мотивите към законопроекта средствата от новия дълг ще бъдат насочени за:</p>
    <ul class="s17-list">${uses.map((t) => html`<li>${t}</li>`)}</ul>`;
}

function refinanceNote(M) {
  const nd = M.d.newDebt;
  const fut = (nd.plan || []).filter((p) => ok(p.refinancedBln));
  const issued = nd.issued2026;
  const parts = [];
  // a year always ends with its own period („г.“): no second one after it
  if (fut.length)
    parts.push(
      `Дългът в обращение, който ще бъде рефинансиран, е ${fut.map((p) => `${money(Math.round(p.refinancedBln * 1000))} през ${yr(p.year)}`).join(' и ')}`,
    );
  const ms =
    issued && Array.isArray(issued.months) ? issued.months.filter((m) => m && m.month) : [];
  if (issued && ok(issued.totalMln) && ms.length) {
    const span =
      ms.length > 1 ? `От ${ms[0].month} до ${ms[ms.length - 1].month}` : `През ${ms[0].month}`;
    parts.push(
      `${span} ${yr(2026)} са издадени държавни ценни книжа (ДЦК) за ${money(issued.totalMln)} с цел рефинансиране на дълг от предходни години.`,
    );
  }
  return parts.length ? html`<p class="s17-note">${parts.join(' ')}</p>` : '';
}

function newDebtBlock(M) {
  const nd = M.d.newDebt;
  const spec = nd ? newDebtSpec(M) : null;
  if (!spec)
    return block({
      id: 's17-b-newdebt',
      level: 2,
      title: 'Колко нов дълг се поема',
      scope: ZDD,
      source: ['asbp'],
      status: false,
      share: false,
      body: EMPTY_CHART(),
    });
  return block({
    id: 's17-b-newdebt',
    level: 2,
    title: 'Колко нов дълг се поема',
    sub: 'Новият дълг е парите, които държавата заема през годината. Част от тях може да са за връщане на стар дълг.',
    scope: ZDD,
    source: nd.source || ['asbp'],
    asOf: nd.asOf,
    status: 'partial',
    statusLabel: 'Отчет и прогноза',
    share: { embed: spec.id, text: spec.desc },
    body: html`${chart(spec)}${note(nd.note)}${newDebtParts(M)}${newDebtUses(M)}${refinanceNote(M)}${issuedDisclosure(M)}`,
  });
}

/* ---- „Не бъркай с…“: the deficit, the new debt and the debt are three different numbers */
function confuseBlock(M) {
  const z = M.z,
    o = M.ctx.data.outlook,
    nd = M.d.newDebt;
  const yrs = z.years || [];
  const Yc = yrs.includes(M.Y) ? M.Y : null;
  if (Yc == null) return '';
  const zi = yrs.indexOf(Yc),
    kind = (z.vintage || [])[zi] || 'actual';
  const oi = o && Array.isArray(o.years) ? o.years.indexOf(Yc) : -1;
  const bal = oi >= 0 && o.kfp && o.kfp.balance ? pick(o.kfp.balance.mln, oi) : null;
  const oKind = oi >= 0 && o.vintage ? o.vintage[oi] : kind;
  const rep = nd ? nd[`y${Yc}`] : null;
  const plan = nd ? (nd.plan || []).find((p) => p.year === Yc) : null;
  const newMln =
    rep && ok(rep.totalMln)
      ? rep.totalMln
      : plan && ok(plan.bln)
        ? Math.round(plan.bln * 1000)
        : null;
  const newKind = rep ? 'rep' : plan ? plan.kind : null;
  const newNote = rep
    ? 'Отчет'
    : plan
      ? (nd.kindLabels || {})[plan.kind]
      : 'В мотивите към законопроекта няма такъв ред за тази година.';
  const fc = (k) => (k === 'plan' || k === 'forecast' ? 'forecast' : undefined);
  const tile = (label, mln, o2) => {
    const mp = ok(mln) ? moneyParts(mln) : null;
    return kpi({ label, value: mp ? mp.v : 'Няма данни', unit: mp ? mp.u : '', ...o2 });
  };
  const def = ok(bal) ? -bal : null;
  const items = [
    tile(`Дефицит през ${yr(Yc)}`, def, {
      gl: 'byudzheten-defitsit',
      status: fc(oKind),
      sub: 'За периода: колко повече е похарчено, отколкото е събрано през годината.',
    }),
    tile(`Нов дълг през ${yr(Yc)}`, newMln, {
      gl: 'nov-dalg-novo-zaemane',
      status: newKind === 'plan' ? 'forecast' : undefined,
      sub: newNote,
    }),
    tile(`Държавен дълг към края на ${yr(Yc)}`, pick(z.totalMln, zi), {
      gl: 'darzhaven-dalg',
      status: fc(kind),
      sub: 'Към дата: всичко, което държавата дължи в края на годината.',
    }),
  ];
  const text = `През ${yr(Yc)} дефицитът е ${ok(def) ? money(def) : DASH}, новият дълг е ${ok(newMln) ? money(newMln) : DASH}, а държавният дълг към края на годината е ${ok(pick(z.totalMln, zi)) ? money(pick(z.totalMln, zi)) : DASH}.`;
  return block({
    id: 's17-b-confuse',
    level: 2,
    title: 'Не бъркай дефицит, нов дълг и дълг',
    sub: 'Три различни числа за една и съща година. Не се събират и не се изваждат.',
    scope: ZDD,
    source: ['asbp'],
    asOf: z.asOf,
    ...mixed([kind]),
    share: { text },
    body: html`${kpiGrid(items, { label: 'Дефицит, нов дълг и държавен дълг за една година' })}
      <dl class="s17-defs">
        <div><dt>${gl('byudzheten-defitsit', 'Дефицит')}</dt><dd>Разходите са повече от приходите през годината. Дефицитът е за период.</dd></div>
        <div><dt>${gl('nov-dalg-novo-zaemane', 'Нов дълг')}</dt><dd>Парите, които държавата заема през годината. Част от тях може да са за ${gl('refinansirane', 'рефинансиране')}: връщане на стар дълг с нов.</dd></div>
        <div><dt>${gl('darzhaven-dalg', 'Държавен дълг')}</dt><dd>Всичко, което държавата дължи към определена дата. Дългът е към дата.</dd></div>
      </dl>
      <p>Дефицитът е за период, а дългът е към дата. Новият дълг не е равен на дефицита: част от него може да замества стар дълг.</p>
      ${note('Показан е държавният дълг (таблица VI-1 в мотивите към законопроекта), защото новият дълг се отнася за него. Сумите са в евро и не следват избора „% от БВП“.')}`,
  });
}

/* ------------------------------------------------------------------ longer notes: tables inside blocks and disclosures */
const KIND_SUFFIX = { actual: '', prelim: ' (предв.)', plan: ' (план)', forecast: ' (прогноза)' };
const yearHead = (M, y) => {
  const i = (M.z.years || []).indexOf(y);
  const k = i >= 0 && M.z.vintage ? M.z.vintage[i] : 'actual';
  return `${y}${KIND_SUFFIX[k] || ''}`;
};
/** a money column that follows the page preferences (euro / на човек / and in leva); `f` names the key that holds the million euro value */
const mcol = (mc, key, label, f) => ({
  key,
  label,
  num: true,
  unit: mc.unit,
  d: mc.d,
  fmt: (_v, r) => (ok(r[f]) ? moneyCell(mc, r[f]) : DASH),
});
const srcOf = (...lists) => [...new Set(lists.flat().filter(Boolean))];

/** the government securities issued in the year, month by month (motives, part VI) */
function issuedDisclosure(M) {
  const nd = M.d.newDebt;
  const key = nd ? Object.keys(nd).find((k) => /^issued\d{4}$/.test(k)) : null;
  const is = key ? nd[key] : null;
  if (!is || !Array.isArray(is.months) || !is.months.length) return '';
  const y = Number(key.slice(6));
  const mc = moneyCol(M.ctx, { d: 1 });
  const rows = is.months.map((x) => ({ m: capFirst(x.month), v: mc.raw(x.mln), mln: x.mln }));
  return disclosure({
    id: 's17-issued',
    title: `Издадени ДЦК през ${yr(y)}, месец по месец`,
    body: html`<p>Това са държавни ценни книжа (ДЦК) на вътрешния пазар, деноминирани в евро. Издадени са с цел рефинансиране на дълг от предходни години.</p>
      ${dataTable({
        id: 's17-t-issued',
        caption: `Издадени държавни ценни книжа през ${yr(y)}, по месеци`,
        dense: true,
        columns: [{ key: 'm', label: 'Месец' }, mcol(mc, 'v', 'Издадени ДЦК', 'mln')],
        rows,
        total: { label: 'Общо', values: { m: '', v: mc.raw(is.totalMln), mln: is.totalMln } },
      })}`,
  });
}

/** the interest on the state debt itself (table of the motives); the chart above shows the КФП line, which has a different scope */
function interestDisclosure(M) {
  const it = M.d.interest;
  if (!it || !Array.isArray(it.years) || !it.years.length) return '';
  const mc = moneyCol(M.ctx, { d: 1 });
  const rows = it.years.map((y, i) => {
    const t = pick(it.totalMln, i),
      e = pick(it.externalMln, i),
      d = pick(it.domesticMln, i);
    return { y: String(y), t: mc.raw(t), e: mc.raw(e), d: mc.raw(d), tm: t, em: e, dm: d };
  });
  return disclosure({
    id: 's17-interest-split',
    title: 'Лихвите по държавния дълг: външни и вътрешни',
    body: html`${note(it.note)}${dataTable({
      id: 's17-t-interest',
      caption: 'Лихви по държавния дълг, външни и вътрешни',
      dense: true,
      columns: [
        { key: 'y', label: 'Година' },
        mcol(mc, 't', 'Общо', 'tm'),
        mcol(mc, 'e', 'Външни', 'em'),
        mcol(mc, 'd', 'Вътрешни', 'dm'),
      ],
      rows,
    })}`,
  });
}

/* ---- of what the debt consists (table VI-2) */
function structureBlock(M) {
  const st = M.d.structure;
  if (!st || !Array.isArray(st.groups) || !st.groups.length) return '';
  const all = [...new Set(st.groups.flatMap((g) => g.rows.flatMap((r) => r.years || [])))].sort(
    (a, b) => a - b,
  );
  const am = st.avgMaturity;
  const avg =
    am && Array.isArray(am.years) && Array.isArray(am.printed) && am.years.length
      ? html`<div class="s17-avg">${dataTable({
          id: 's17-t-avg',
          caption: am.label,
          dense: true,
          columns: [
            { key: 'y', label: 'Година' },
            { key: 'v', label: 'Колко средно трае дългът', align: 'end' },
          ],
          rows: am.years.map((y, i) => ({ y: yearHead(M, y), v: am.printed[i] || null })),
        })}</div>`
      : '';
  const groups = st.groups.map((g) => {
    const years = all.filter((y) => g.rows.some((r) => (r.years || []).includes(y)));
    const rows = g.rows.map((r) =>
      Object.fromEntries([
        ['name', r.label],
        ...years.map((y) => {
          const k = (r.years || []).indexOf(y);
          return [`y${y}`, k >= 0 ? pick(r.values, k) : null];
        }),
      ]),
    );
    return disclosure({
      id: `s17-st-${g.id}`,
      title: g.label,
      body: dataTable({
        id: `s17-t-st-${g.id}`,
        caption: `${g.label}, ${st.unit}`,
        dense: true,
        columns: [
          { key: 'name', label: 'Вид' },
          ...years.map((y) => ({ key: `y${y}`, label: yearHead(M, y), num: true, d: 1 })),
        ],
        rows,
      }),
    });
  });
  return block({
    id: 's17-b-structure',
    level: 2,
    title: 'Из какво се състои държавният дълг',
    scope: ZDD,
    source: st.source || ['asbp'],
    asOf: st.asOf,
    ...mixed(M.z.vintage || []),
    sub: `Таблица ${st.table} в мотивите към законопроекта. Числата са дял от държавния дълг, в проценти.`,
    share: {
      text:
        am && Array.isArray(am.printed)
          ? endDot(
              `${am.label}: ${am.printed[0]} през ${yr(am.years[0])} и ${am.printed[am.printed.length - 1]} през ${yr(am.years[am.years.length - 1])}`,
            )
          : undefined,
    },
    body: html`${avg}<div class="s17-groups">${groups}</div>${note(st.note)}`,
  });
}

/* ---- guarantees */
function guaranteesBlock(M) {
  const g = M.d.guaranteed;
  if (!g || !Array.isArray(g.years) || !g.years.length) return '';
  const mc = moneyCol(M.ctx, { d: 1 });
  const rows = g.years.map((y, i) => {
    const t = pick(g.totalMln, i),
      e = pick(g.externalMln, i),
      d = pick(g.domesticMln, i),
      pg = pick(g.pctGdpPrinted, i);
    return { y: String(y), t: mc.raw(t), e: mc.raw(e), d: mc.raw(d), tm: t, em: e, dm: d, pg };
  });
  const n = g.years.length - 1;
  const last = pick(g.totalMln, n),
    lastPg = pick(g.pctGdpPrinted, n);
  const lead = ok(last)
    ? `Към края на ${yr(g.years[n])} държавногарантираният дълг е ${money(last)}${ok(lastPg) ? ` (${pct(lastPg, 1)} от БВП)` : ''}.${ok(g.newGuarantees2025Mln) ? ` През ${yr(2025)} са издадени нови гаранции за ${money(g.newGuarantees2025Mln)}.` : ''}`
    : '';
  const sectors =
    Array.isArray(g.sectors) && g.sectors.length
      ? disclosure({
          id: 's17-guar-sectors',
          title: 'Гаранциите по сектори',
          body: dataTable({
            id: 's17-t-guar-sectors',
            caption: 'Държавногарантиран дълг по сектори, дял в проценти',
            dense: true,
            columns: [
              { key: 'name', label: 'Сектор' },
              ...g.years.map((y, i) => ({ key: `y${i}`, label: String(y), num: true, d: 1 })),
            ],
            rows: g.sectors.map((s) =>
              Object.fromEntries([
                ['name', s.label],
                ...g.years.map((_, i) => [`y${i}`, pick(s.values, i)]),
              ]),
            ),
          }),
        })
      : '';
  return block({
    id: 's17-b-guar',
    level: 2,
    title: 'Държавни гаранции',
    scope: ZDD,
    source: g.source || ['asbp'],
    asOf: g.asOf,
    sub: g.note,
    share: { text: lead || g.note },
    body: html`${lead ? html`<p>${lead} ${gl('darzhavna-garantsiya', 'Какво е държавна гаранция?')}</p>` : ''}${dataTable(
      {
        id: 's17-t-guar',
        caption: 'Държавногарантиран дълг по години',
        dense: true,
        columns: [
          { key: 'y', label: 'Година' },
          mcol(mc, 't', 'Общо', 'tm'),
          mcol(mc, 'e', 'Външни', 'em'),
          mcol(mc, 'd', 'Вътрешни', 'dm'),
          { key: 'pg', label: 'Дял от БВП (%)', num: true, d: 1 },
        ],
        rows,
      },
    )}${sectors}`,
  });
}

/* ---- the limits of the 2026 law */
function limitsBlock(M) {
  const l = M.d.limits;
  if (!l || !Array.isArray(l.items) || !l.items.length) return '';
  const mc = moneyCol(M.ctx, { d: 1 });
  const art = (it) => `чл. ${it.art}${it.para ? `, ал. ${it.para}` : ''}`;
  const rows = l.items.map((it) => ({
    name: it.label,
    art: art(it),
    v: mc.raw(it.mln),
    mln: it.mln,
    inc: it.includes ? { text: it.includes, mln: it.includesMln } : null,
  }));
  const nameCol = {
    key: 'name',
    label: 'Граница',
    fmt: (v, r) =>
      html`${v}${r.inc ? html`<span class="s17-sub">Включва: ${r.inc.text}${ok(r.inc.mln) ? html` (${money(r.inc.mln)})` : ''}.</span>` : ''}`,
  };
  const debtCap = l.items.find((x) => x.id === 'debtCap'),
    newDebt = l.items.find((x) => x.id === 'newDebt');
  const text =
    debtCap && newDebt
      ? `Законът за бюджета за ${yr(l.year)} позволява най-много ${money(newDebt.mln)} нов държавен дълг и най-много ${money(debtCap.mln)} държавен дълг към края на годината.`
      : l.note || '';
  return block({
    id: 's17-b-limits',
    level: 2,
    title: `Какви граници слага законът за ${yr(l.year)}`,
    scope: ZDD,
    source: l.source || ['zdb'],
    asOf: l.asOf,
    share: { text },
    sub: 'Това са горни и долни граници по закона. Не са прогноза за това какво ще се случи.',
    body: html`${dataTable({
      id: 's17-t-limits',
      caption: `Граници по закона за държавния бюджет за ${yr(l.year)}`,
      dense: true,
      columns: [
        nameCol,
        { key: 'art', label: 'Член', align: 'start' },
        mcol(mc, 'v', 'Размер', 'mln'),
      ],
      rows,
    })}${note(l.note)}`,
  });
}

/* ---- why the three rows differ */
function compareBlock(M) {
  const c = M.d.compare;
  if (!c || !Array.isArray(c.rows) || !Array.isArray(c.years) || !c.rows.length) return '';
  const mc = moneyCol(M.ctx, { d: 1 });
  const rows = c.rows.map((r) =>
    Object.fromEntries([
      ['name', r.label],
      ...c.years.map((_, i) => [`y${i}`, mc.raw(pick(r.mln, i))]),
      ...c.years.map((_, i) => [`m${i}`, pick(r.mln, i)]),
    ]),
  );
  const other =
    M.scope === MAA
      ? { q: {}, label: 'Виж държавния дълг по години, 2024–2028' }
      : { q: { obhvat: MAA }, label: 'Виж дълга по Маастрихт: България и Европейският съюз' };
  const href = M.ctx.href('S17', {}, other.q);
  return block({
    id: 's17-b-compare',
    level: 2,
    title: 'Защо числата за дълга се различават',
    source: srcOf(...c.rows.map((r) => r.source)),
    asOf: M.d.meta && M.d.meta.asOf,
    sub: `Три реда от различни институции за ${c.years.map(yr).join(' и ')}`,
    body: html`${dataTable({
      id: 's17-t-compare',
      caption: `Дългът по три различни реда, ${mc.unit}`,
      dense: true,
      columns: [
        { key: 'name', label: 'Ред' },
        ...c.years.map((y, i) => mcol(mc, `y${i}`, String(y), `m${i}`)),
      ],
      rows,
    })}<p class="s17-switch"><a href="${href}">${other.label}</a></p>`,
  });
}

/* ---- how the numbers are made */
function methodDisclosure(M) {
  const pop = M.persons && M.popDate;
  return disclosure({
    id: 's17-method',
    title: 'Как се смятат числата',
    body: html`<ul class="s17-method">
      <li><b>${SCOPE_NAME[ZDD]}.</b> ${scopeNote(M, ZDD) || ''}</li>
      <li><b>${SCOPE_NAME[MAA]}.</b> ${scopeNote(M, MAA) || ''}</li>
      <li>${gl('dyal-ot-bvp', 'Дялът от БВП')} е такъв, какъвто го дава източникът.${pop ? ` „На човек“ е сумата, разделена на населението към ${dateG(M.popDate)}, еднакво за всички години.` : ''}</li>
      <li>Финансирането на дефицита е от месечните отчети за изпълнение на ${gl('kfp', 'консолидираната фискална програма')}. В тях сумите са натрупани от началото на годината, а месечните стойности са разликата между два последователни месеца.</li>
      <li>Лихвите и дефицитът по години са от средносрочната прогноза: ${yr(2026)} е проектът към законопроекта за бюджета, а ${yr(2027)}–${yr(2028)} са прогноза на Министерството на финансите, не отчет.</li>
      <li>Сумите са в евро. Лихвите и дефицитът в консолидираната фискална програма не са същото като лихвите и дълга по таблиците за държавния дълг: обхватът им е различен.</li>
    </ul>`,
  });
}

/* ------------------------------------------------------------------ the page */
export const needs = (ctx) =>
  isFramework(ctx) ? ['core', 'budget2027?'] : ['core', 'debt', 'execution?', 'outlook?'];
export const styles = ['s17-dalg'];

export function lede(ctx) {
  if (isFramework(ctx)) return undefined;
  try {
    if (!ctx.data || !ctx.data.debt) return undefined;
    return ledeText(model(ctx)) || undefined;
  } catch (e) {
    return undefined;
  }
}

const embedOf = (fn, pickSrc) => (ctx) => {
  if (!ctx.data || !ctx.data.debt) return null;
  const M = model(ctx);
  const spec = fn(M);
  if (!hasData(spec)) return null;
  const s = pickSrc(M, spec);
  return { chart: spec, source: s.source, asOf: s.asOf, status: s.status || 'real' };
};
const outlookSrc = (M) => {
  const o = M.ctx.data.outlook;
  return {
    source: (o && o.meta && o.meta.source) || ['asbp'],
    asOf: o && o.meta && o.meta.asOf,
    status: 'partial',
  };
};

const historicalEmbeds = {
  's17-zdd': embedOf(zddSpec, (M) => ({
    source: M.z.source || ['asbp'],
    asOf: M.z.asOf,
    status: 'partial',
  })),
  's17-maastricht': embedOf(maastrichtSpec, (M) => ({
    source: M.m.source || ['eurostat'],
    asOf: M.m.asOf,
  })),
  's17-eu': embedOf(euSpec, (M) => ({ source: M.m.source || ['eurostat'], asOf: M.m.asOf })),
  's17-quarterly': embedOf(quarterSpec, (M) => ({
    source: ['bnb', 'eurostat'],
    asOf: M.d.quarterly && M.d.quarterly.bnbGg && M.d.quarterly.bnbGg.asOf,
  })),
  's17-interest': embedOf(interestSpec, outlookSrc),
  's17-balance': embedOf(balanceSpec, outlookSrc),
  's17-finance': (ctx) => {
    if (!ctx.data || !ctx.data.debt || !ctx.data.execution) return null;
    const M = model(ctx),
      F = finModel(M);
    const spec = F && financeSpec(M, F);
    return hasData(spec) ? { chart: spec, source: F.src, asOf: F.asOf, status: 'real' } : null;
  },
  's17-newdebt': embedOf(newDebtSpec, (M) => ({
    source: (M.d.newDebt && M.d.newDebt.source) || ['asbp'],
    asOf: M.d.newDebt && M.d.newDebt.asOf,
    status: 'partial',
  })),
};

export function render(ctx) {
  if (isFramework(ctx)) return debtView(ctx);
  const M = model(ctx);
  const F = finModel(M);
  const top =
    M.scope === MAA
      ? [maastrichtBlock(M), euBlock(M), quarterBlock(M), compareBlock(M)]
      : [zddBlock(M), compareBlock(M)];
  return html`${controls(M)}${kpisBlock(M)}${top}${confuseBlock(M)}${financeBlock(M, F)}${financeTableBlock(M, F)}${newDebtBlock(M)}<div class="s17-pair">${interestBlock(M)}${balanceBlock(M)}</div>${structureBlock(M)}${guaranteesBlock(M)}${limitsBlock(M)}${methodDisclosure(M)}`;
}

let lastScope = null;
export function mount(root, ctx) {
  if (isFramework(ctx)) return mountBillSearch(root, ctx);
  const off = bindUnitSwitch(root, ctx, 's17-unit');
  if (ctx.data && ctx.data.debt) {
    const M = model(ctx);
    // the shell announces its own switches (period, unit, per person); a change of the count is this page's own
    if (ctx.kind === 'rerender' && lastScope && lastScope !== M.scope) {
      const t = ledeText(M);
      if (t) ctx.announce(t);
    }
    lastScope = M.scope;
  }
  return off;
}

export const embeds = Object.fromEntries(
  Object.entries(historicalEmbeds).map(([id, fn]) => [
    id,
    (ctx) =>
      isFramework(ctx)
        ? id === 's17-zdd'
          ? {
              chart: debtChart2027(ctx),
              source: ['budget2027'],
              asOf: ctx.data.budget2027?.publication,
              status: 'forecast',
            }
          : null
        : fn(ctx),
  ]),
);
