import { annualSource } from '../ui/annual-source.js';
import { periodIndex, previousPeriodIndex } from '../annual.js';
import { selectPeriod } from '../periods.js';
import { annualGap } from '../ui/annual.js';
// S06 · Откъде идват парите? · #/prihodi/:source? · step 2 of 8 · next S07 · periods all
// Revenue of the КФП by source: the eight groups of Annex 3 (D05 revenue.json), and a thin
// editorial layer (who pays, what the visitor can do about it). Every number is computed from the data files, none is typed in.
//   views (tabs, ?izgled=)  grafika · tablica · godini        units: млн. € / % от БВП through the unit switch; „на човек“ and „и в лева“ through view.js
//   #/prihodi/<id>          opens that source's disclosure and scrolls to it (deferred: the router scrolls and focuses after mount)
//   embeds                  s06-by-source = the bar chart of the Графика view in the default state of the host period
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { tabs } from '../ui/tabs.js';
import { disclosure } from '../ui/disclosure.js';
import { chart } from '../ui/chart.js';
import { dataTable } from '../ui/table.js';
import { ranklist } from '../ui/ranklist.js';
import { explorer } from '../ui/explorer.js';
import { callout, facts } from '../ui/cards.js';
import { pendingState } from '../ui/states.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';
import { apportion } from '../calc.js';
import { yIndex, change, chartUnit, moneyCol, amount, periodStatus } from '../view.js';
import { num, pct, money, delta, date, DASH, NBSP } from '../format.js';

export const needs = ['budget2027-provenance?', 'core', 'outlook', 'revenue', 'glossary?'];
export const styles = ['s06-prihodi'];

const yr = (y) => `${y}${NBSP}г.`;
const WORD = {
  law: 'закон',
  expected: 'очаквано',
  draft: 'проект',
  actual: 'отчет',
  prelim: 'предв.\nотчет',
  plan: 'план',
  forecast: 'прогноза',
};
const FLAT = {
  law: 'закон',
  expected: 'очаквано',
  draft: 'проект',
  actual: 'отчет',
  prelim: 'предв. отчет',
  plan: 'план',
  forecast: 'прогноза',
};
const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Editorial layer per source (the numbers come from the data). c = colour slot, grp = the execution group it belongs to. */
const ED = {
  dds: {
    short: 'ДДС',
    c: 1,
    grp: 'tax',
    cta: true,
    who: 'Всеки, който купува стоки и услуги: данъкът е включен в цената. Фирмите го начисляват и го внасят в бюджета.',
    me: 'ДДС е в цената на почти всичко, което купуваш. Калкулаторът оценява колко ДДС се съдържа в разходите ти за година.',
  },
  osiguritelni: {
    short: 'Осигуровки',
    c: 2,
    grp: 'tax',
    cta: true,
    who: 'Работещите и работодателите им, като процент от възнаграждението. Самоосигуряващите се плащат сами.',
    me: 'Зависи от заплатата ти. Калкулаторът показва колко осигуровки внасяш ти и колко внася работодателят ти.',
  },
  nedanachni: {
    short: 'Неданъчни приходи',
    c: 3,
    grp: 'nontax',
    who: 'Платците са различни: такси за държавни услуги плащат ползвателите им, глобите плащат нарушителите, а доходите от собственост и концесиите идват от държавното имущество.',
    me: 'Няма единна сметка: зависи от държавните услуги, които ползваш.',
  },
  pomoshti: {
    short: 'Помощи и дарения',
    c: 4,
    grp: 'grants',
    who: 'Не ги плащат гражданите или фирмите. Това са средства, получени за определена цел, основно от Европейския съюз.',
    me: 'Не плащаш директно: това не са твои данъци.',
  },
  ddfl: {
    short: 'Данък върху доходите',
    c: 5,
    grp: 'tax',
    cta: true,
    who: 'Хората с доходи: най-често заетите по трудов договор, но и самонаетите и получателите на други облагаеми доходи. Работодателят го удържа от заплатата и го внася.',
    me: 'Зависи от дохода ти. Калкулаторът показва колко данък върху доходите се удържа от брутната ти заплата.',
  },
  akcizi: {
    short: 'Акцизи',
    c: 7,
    grp: 'tax',
    cta: true,
    who: 'Производителите и вносителите на горива, тютюн и алкохол. Акцизът е в цената, така че го плащат и купувачите.',
    me: 'Акцизът е в цената на горивата, цигарите и алкохола. Калкулаторът оценява колко акциз за горива и цигари се съдържа в разходите ти.',
  },
  korporativen: {
    short: 'Корпоративен данък',
    c: 8,
    grp: 'tax',
    who: 'Фирмите: върху облагаемата им печалба. Физическите лица не го плащат пряко.',
    me: 'Не го плащаш пряко. Плащат го фирмите.',
  },
  drugi: {
    short: 'Други данъци и мита',
    c: 'other',
    grp: 'tax',
    who: 'Различни платци: застрахователни компании, вносители, собственици на имущество и други.',
    me: 'Няма единна сметка: зависи от това какво притежаваш и купуваш.',
  },
};
const GLOSS_FALLBACK = { short: '', c: 'other', grp: 'tax', who: '', me: '' };

/** the data of the screen for the selected period, or null while revenue.json is missing/empty (lede, crumbs and embeds guard on it) */
function model(ctx) {
  const rev = ctx.data?.revenue;
  if (
    !rev ||
    !Array.isArray(rev.years) ||
    !Array.isArray(rev.groups) ||
    !rev.groups.length ||
    !rev.total?.mln
  )
    return null;
  const years = rev.years,
    kinds = rev.vintage || [];
  const sel = periodIndex(rev, ctx);
  if (sel < 0) return null;
  const prev = previousPeriodIndex(rev, ctx);

  const rows = new Map((rev.rows || []).map((r) => [r.id, r]));
  const kids = new Map();
  for (const r of rev.rows || [])
    if (r.parent) {
      if (!kids.has(r.parent)) kids.set(r.parent, []);
      kids.get(r.parent).push(r);
    }
  const leavesOf = (id) => {
    const k = kids.get(id);
    return k?.length ? k.flatMap((x) => leavesOf(x.id)) : rows.has(id) ? [rows.get(id)] : [];
  };
  const gloss = new Map((ctx.data?.glossary?.terms || []).map((t) => [t.slug, t]));

  const groups = rev.groups.map((g) => {
    const ed = ED[g.id] ?? { ...GLOSS_FALLBACK, short: g.name };
    const mln = g.mln || [],
      pg = g.pctGdp || [];
    const val = mln[sel] ?? null,
      before = prev >= 0 ? (mln[prev] ?? null) : null;
    return {
      g,
      id: g.id,
      name: g.name,
      ed,
      short: ed.short,
      mln,
      pg,
      val,
      pgSel: pg[sel] ?? null,
      before,
      yoy: change(val, before),
      leaves: (g.rowIds || []).flatMap(leavesOf),
      term: gloss.get(g.glossary) ?? null,
    };
  });
  const shares = apportion(
    groups.map((x) => x.val),
    100,
    1,
  );
  const sum = groups.reduce((a, x) => a + (ok(x.val) ? x.val : 0), 0);
  groups.forEach((x, i) => {
    x.share = ok(x.val) ? (shares[i] ?? null) : null;
    x.rawShare = sum > 0 && ok(x.val) ? (x.val / sum) * 100 : null;
  });
  const ranked = groups.slice().sort((a, b) => (ok(b.val) ? b.val : -1) - (ok(a.val) ? a.val : -1));
  const rest = ranked.findIndex((x) => x.id === 'drugi');
  if (rest >= 0) ranked.push(...ranked.splice(rest, 1));

  const rowAt = (id) => {
    const r = rows.get(id);
    return r
      ? {
          row: r,
          mln: r.mln?.[sel] ?? null,
          pg: r.pctGdp?.[sel] ?? null,
          before: prev >= 0 ? (r.mln?.[prev] ?? null) : null,
        }
      : null;
  };
  const total = rev.total.mln[sel] ?? null;
  const allIn = groups.every((x) => ok(x.val));
  return {
    rev,
    years,
    kinds,
    sel,
    prev,
    kind: kinds[sel] ?? 'plan',
    year: years[sel],
    prevYear: prev >= 0 ? years[prev] : null,
    groups,
    ranked,
    byId: new Map(groups.map((x) => [x.id, x])),
    total,
    totalPg: rev.total.pctGdp?.[sel] ?? null,
    totalBefore: prev >= 0 ? (rev.total.mln[prev] ?? null) : null,
    groupSum: allIn ? sum : null,
    tax: rowAt('r.tax'),
    nontax: rowAt('r.nontax'),
    grants: rowAt('r.grants'),
    firstForecast: kinds.indexOf('forecast'),
    fcNote:
      kinds.indexOf('forecast') > 0
        ? `Годините след ${years[kinds.indexOf('forecast') - 1]} са прогноза.`
        : '',
    cats: years.map((y, i) => (WORD[kinds[i]] ? `${y}\n${WORD[kinds[i]]}` : String(y))),
    // the same labels on one line: table headers and the CSV export (a line break inside a CSV cell does not survive Excel)
    flat: years.map((y, i) => (FLAT[kinds[i]] ? `${y} (${FLAT[kinds[i]]})` : String(y))),
  };
}

// ── small pieces ───────────────────────────────────────────────────────────────────────────────────────
const shareOf = (a, b) => (ok(a) && ok(b) && b > 0 ? (a / b) * 100 : null);
const srcHref = (ctx, id) =>
  ctx.href('S06', ctx.params?.source ? { source: ctx.params.source } : {}, { to: `s06-src-${id}` });
/** a money cell: the number in the table's unit, the leva addendum (when „и в лева“ is on) on a second line */
const moneyCell = (mc, mln) =>
  html`${mc.text(mln)}${mc.lev(mln) ? html`<span class="s06-lev">${mc.lev(mln)}</span>` : ''}`;
const leafLabel = (r, x) => {
  const s = String(r.label || '').trim();
  return /^от /.test(s) ? `${x.short} ${s}` : upper(s);
};
const roundingNote = (m) => {
  if (!ok(m.groupSum) || !ok(m.total)) return '';
  const d = Math.abs(m.groupSum - m.total);
  return d > 0.005
    ? `Сборът на осемте групи (${num(m.groupSum, 1)} млн. €) се различава от общия ред (${num(m.total, 1)} млн. €) с ${num(d, 1)} млн. € заради закръгляването в източника.`
    : '';
};

// ── the strip „от всеки 100 €“ ─────────────────────────────────────────────────────────────────────────────
function stripBlock(ctx, m) {
  const items = m.ranked.filter((x) => ok(x.share));
  const body = items.length
    ? html`<div class="s06-strip" aria-hidden="true">${items.map((x) => html`<span class="s06-seg" data-c="${x.ed.c}" style="flex-grow:${x.share}"></span>`)}</div>
      <ul class="s06-legend">${items.map((x) => html`<li><span class="s06-sw" data-c="${x.ed.c}" aria-hidden="true"></span><a class="s06-leg-name" href="${srcHref(ctx, x.id)}">${x.short}</a><span class="s06-leg-v num">${num(x.share, 1)}${NBSP}€<span class="sr-only"> от всеки 100 евро</span></span></li>`)}</ul>`
    : pendingState({ title: 'Приходи по видове' });
  return block({
    id: 's06-strip',
    title: `От всеки 100${NBSP}€ приходи през ${yr(m.year)}`,
    scope: 'kfp',
    status: periodStatus(ctx),
    sub: 'Колко от всеки 100 евро приходи идват от всеки източник. Натисни име, за да прочетеш повече за източника.',
    source: m?.rev.meta?.source || [],
    asOf: m.rev.meta?.asOf,
    body,
  });
}

// ── the figures at a glance ────────────────────────────────────────────────────────────────────────────
function kpiBlock(ctx, m) {
  const st = periodStatus(ctx) === 'forecast' ? 'forecast' : undefined;
  const vs = m.prevYear ? `спрямо ${yr(m.prevYear)}` : '';
  const dl = (cur, before) => {
    const v = change(cur, before);
    return v == null ? null : { value: v, d: 1, unit: '%', label: vs };
  };
  const of = (v) => {
    const s = shareOf(v, m.total);
    return s == null ? '' : `${pct(s, 1)} от приходите`;
  };
  const tiles = [
    kpi({
      label: 'Приходи, помощи и дарения',
      mln: m.total,
      pctGdp: m.totalPg,
      delta: dl(m.total, m.totalBefore),
      sub: 'Всички приходи на консолидираната фискална програма',
      status: st,
    }),
    kpi({
      label: 'Данъци и осигуровки',
      mln: m.tax?.mln,
      pctGdp: m.tax?.pg,
      delta: dl(m.tax?.mln, m.tax?.before),
      sub: of(m.tax?.mln),
      status: st,
    }),
    kpi({
      label: 'Неданъчни приходи',
      mln: m.nontax?.mln,
      pctGdp: m.nontax?.pg,
      delta: dl(m.nontax?.mln, m.nontax?.before),
      sub: of(m.nontax?.mln),
      status: st,
    }),
    kpi({
      label: 'Помощи и дарения',
      mln: m.grants?.mln,
      pctGdp: m.grants?.pg,
      delta: dl(m.grants?.mln, m.grants?.before),
      sub: [of(m.grants?.mln), 'основно европейски средства'].filter(Boolean).join(' · '),
      status: st,
    }),
  ];
  return block({
    id: 's06-kpis',
    title: 'Приходите накратко',
    scope: 'kfp',
    status: periodStatus(ctx),
    source: m?.rev.meta?.source || [],
    asOf: m.rev.meta?.asOf,
    body: kpiGrid(tiles, { label: 'Приходите накратко' }),
  });
}

// ── the views: Графика / Таблица / По години ───────────────────────────────────────────────────────────
/** the table twin of a chart whose axis labels wrap onto several lines: the same rows, labelled on one line (feeds the screen twin and the CSV) */
function oneLine(spec, labels) {
  const columns = [
    { key: 'c', label: spec.categoryLabel || 'Категория' },
    ...spec.series.map((x, i) => ({
      key: `s${i}`,
      label: x.name,
      unit: spec.unit,
      d: spec.d,
      num: true,
      fmt: (v) => (ok(v) ? spec.fmt(v) : DASH),
    })),
  ];
  const rows = labels.map((c, j) =>
    Object.fromEntries([['c', c], ...spec.series.map((x, i) => [`s${i}`, x.data[j] ?? null])]),
  );
  return { columns, rows };
}

function sourcesChartSpec(ctx, m) {
  const items = m.ranked.filter((x) => ok(x.val));
  const u = chartUnit(ctx, { pct: true, max: Math.max(0, ...items.map((x) => x.val)) });
  return {
    id: 's06-by-source',
    type: 'barh',
    title: `Приходи по видове, ${yr(m.year)}`,
    sub: `В ${u.unit}, от най-големия към най-малкия източник.`,
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    option: u.option(true),
    categories: items.map((x) => x.short),
    categoryLabel: 'Източник',
    series: [
      {
        name: `Приходи, ${yr(m.year)}`,
        data: items.map((x) => u.conv(x.val, x.pgSel)),
        color: '--rev',
      },
    ],
    labels: true,
    legend: false,
    labelWidth: 'auto',
    labelOverflow: 'break',
    height: Math.max(328, items.length * 44 + 40),
    views: ['bars', 'pie', 'table'],
    partColors: items.map((x) => x.ed.c),
    pieHeight: 340, // the shares of one whole: the kinds of revenue add up to all revenue
    desc: `Хоризонтални ленти за ${yr(m.year)}: ${items.map((x) => `${x.short} ${u.fmt(u.conv(x.val, x.pgSel))} ${u.unit}`).join('; ')}.`,
  };
}

function mainTable(ctx, m) {
  const mc = moneyCol(ctx);
  const rows = m.ranked.map((x) => ({
    name: x.short,
    mln: x.val,
    v: mc.raw(x.val),
    share: x.share,
    pg: x.pgSel,
    yoy: x.yoy,
    _href: ctx.href('S06', { source: x.id }),
  }));
  const columns = [
    { key: 'name', label: 'Източник' },
    { key: 'v', label: 'Приходи', unit: mc.unit, d: mc.d, fmt: (v, row) => moneyCell(mc, row.mln) },
    { key: 'share', label: 'Дял от приходите', unit: '%', d: 1 },
    { key: 'pg', label: '% от БВП', d: 1 },
    ...(m.prevYear
      ? [
          {
            key: 'yoy',
            label: `Спрямо ${yr(m.prevYear)}`,
            fmt: (v) => (ok(v) ? delta(v, 1) : DASH),
          },
        ]
      : []),
  ];
  return dataTable({
    id: 's06-table',
    caption: `Приходи по видове, ${yr(m.year)}`,
    columns,
    rows,
    sortable: true,
    sortBy: ctx.query.sort,
    dir: ctx.query.dir,
    query: true,
    total: {
      label: 'Всички приходи',
      values: {
        mln: m.total,
        v: mc.raw(m.total),
        share: ok(m.groupSum) ? 100 : null,
        pg: m.totalPg,
        yoy: change(m.total, m.totalBefore),
      },
    },
    note: roundingNote(m),
  });
}

function yearsChartSpec(ctx, m) {
  const u = chartUnit(ctx, {
    pct: true,
    max: Math.max(0, ...m.groups.flatMap((x) => x.mln).filter(ok)),
  });
  const span = `${m.years[0]}–${m.years[m.years.length - 1]}`;
  const spec = {
    id: 's06-by-year',
    type: 'line',
    title: `Приходи по видове, ${span}`,
    sub: `В ${u.unit}.`,
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    option: u.option(false),
    categories: m.cats,
    categoryLabel: 'Година',
    views: ['line', 'bars'],
    stackBars: true, // the eight kinds add up to all revenue, so stacked columns are honest
    series: m.ranked.map((x) => ({
      name: x.short,
      color: x.ed.c,
      data: x.mln.map((v, i) => u.conv(v, x.pg[i])),
      ...(m.firstForecast > 0 ? { dashFrom: m.firstForecast } : {}),
    })),
    labels: false,
    height: 340,
    desc: `Линии за осемте източника по години (${span}). Точните числа са в таблицата под графиката.`,
  };
  spec.table = oneLine(spec, m.flat);
  return { spec, u };
}

function yearsTable(ctx, m, u) {
  const mc = moneyCol(ctx),
    asPct = u.kind === 'pct';
  const columns = [
    { key: 'name', label: 'Източник' },
    ...m.years.map((y, i) => ({
      key: `y${i}`,
      label: m.flat[i],
      fmt: (v, row) => (asPct ? (ok(v) ? num(v, 1) : DASH) : moneyCell(mc, row.mlns?.[i])),
    })),
  ];
  const cells = (mln, pg) =>
    Object.fromEntries(
      m.years.map((y, i) => [`y${i}`, asPct ? (pg?.[i] ?? null) : mc.raw(mln?.[i] ?? null)]),
    );
  const rows = m.ranked.map((x) => ({
    name: x.short,
    mlns: x.mln,
    ...cells(x.mln, x.pg),
    _href: ctx.href('S06', { source: x.id }),
  }));
  return dataTable({
    id: 's06-years',
    caption: `Приходи по видове и години, ${asPct ? '% от БВП' : mc.unit}`,
    captionVisible: true,
    columns,
    rows,
    total: {
      label: 'Всички приходи',
      values: { mlns: m.rev.total.mln, ...cells(m.rev.total.mln, m.rev.total.pctGdp) },
    },
    note: m.fcNote,
  });
}

function viewsBlock(ctx, m) {
  const yc = yearsChartSpec(ctx, m);
  return block({
    id: 's06-views',
    title: 'Приходите по видове',
    scope: 'kfp',
    status: periodStatus(ctx),
    source: m?.rev.meta?.source || [],
    asOf: m.rev.meta?.asOf,
    share: { embed: 's06-by-source' },
    body: tabs({
      id: 's06-view',
      label: 'Изглед на приходите по видове',
      active: ctx.query.izgled,
      query: 'izgled',
      tabs: [
        { key: 'grafika', label: 'Графика', body: chart(sourcesChartSpec(ctx, m)) },
        { key: 'tablica', label: 'Таблица', body: mainTable(ctx, m) },
        {
          key: 'godini',
          label: 'По години',
          body: html`${chart(yc.spec)}${yearsTable(ctx, m, yc.u)}`,
        },
      ],
    }),
  });
}

// ── the eight sources, one disclosure each ─────────────────────────────────────────────────────────────
/** params that keep the screen's own route, so a ?to= link on the same screen scrolls instead of re-rendering */
const hereParams = (ctx) => (ctx.params?.source ? { source: ctx.params.source } : {});

function miniChart(ctx, m, x) {
  const vals = x.mln.filter(ok);
  const u = chartUnit(ctx, { pct: true, max: Math.max(0, ...vals) });
  const i0 = x.mln.findIndex(ok),
    i1 = x.mln.length - 1 - [...x.mln].reverse().findIndex(ok);
  const range =
    vals.length > 1
      ? `От ${amount(ctx, { mln: x.mln[i0], pctGdp: x.pg[i0] })} през ${yr(m.years[i0])} до ${amount(ctx, { mln: x.mln[i1], pctGdp: x.pg[i1] })} през ${yr(m.years[i1])}`
      : '';
  const spec = {
    id: `s06-mini-${x.id}`,
    type: 'bar',
    title: `${x.short} по години`,
    sub: [range, m.fcNote].filter(Boolean).join(' '),
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    option: u.option(false),
    categories: m.cats,
    categoryLabel: 'Година',
    series: [{ name: x.short, color: x.ed.c, data: x.mln.map((v, i) => u.conv(v, x.pg[i])) }],
    labels: false,
    legend: false,
    height: 220,
    desc: `Колони по години (${m.years[0]}–${m.years[m.years.length - 1]}) за „${x.short}“. Точните числа са в таблицата под графиката.`,
  };
  spec.table = oneLine(spec, m.flat);
  return chart(spec);
}

function compList(ctx, m, x) {
  const items = x.leaves
    .map((r) => ({
      label: leafLabel(r, x),
      value: r.mln?.[m.sel] ?? null,
      pctGdp: r.pctGdp?.[m.sel] ?? null,
    }))
    .filter((it) => ok(it.value));
  if (x.leaves.length < 2 || items.length < 2) return '';
  const skipped = x.leaves.length - items.length;
  return html`${ranklist({ id: `s06-comp-${x.id}`, caption: `От какво се състои, ${yr(m.year)}`, label: `Състав на „${x.short}“`, unit: 'mln', shares: true, sort: 'desc', categoryLabel: 'Ред от приложението', items })}${skipped ? html`<p class="small muted">За ${skipped === 1 ? 'един ред' : `${skipped} реда`} няма данни за ${yr(m.year)}.</p>` : ''}`;
}

function sourceBody(ctx, m, x) {
  const what = x.term?.def
    ? html`<span data-gl-skip>${x.term.def}</span> <a href="${ctx.href('S03', { term: x.term.slug })}">В речника<span class="sr-only">: ${x.short}</span></a>`
    : html`<span data-gl-skip>${x.name}</span>`;
  return html`<div data-gl-scan>${facts([
    { k: 'Какво е', v: what },
    { k: 'Кой плаща', v: x.ed.who },
  ])}</div>
    ${miniChart(ctx, m, x)}
    ${compList(ctx, m, x)}
    <p class="s06-me"><strong>Колко плащам аз?</strong> ${x.ed.me}${x.ed.cta ? html` <a href="${ctx.href('S18')}">Към калкулатора</a>` : ''}</p>`;
}

function sourcesBlock(ctx, m, sel) {
  const items = m.ranked.map((x) =>
    disclosure({
      id: `s06-src-${x.id}`,
      open: x.id === sel,
      title: x.short,
      meta: ok(x.val)
        ? html`${ok(x.share) ? html`${pct(x.share, 1)} · ` : ''}${amount(ctx, { mln: x.val, pctGdp: x.pgSel })}`
        : '',
      body: sourceBody(ctx, m, x),
    }),
  );
  return block({
    id: 's06-sources',
    title: 'Осемте източника поотделно',
    scope: 'kfp',
    status: periodStatus(ctx),
    source: m?.rev.meta?.source || [],
    asOf: m.rev.meta?.asOf,
    sub: 'Отвори източник, за да видиш какво е, кой го плаща, как се променя и от какво се състои.',
    share: {
      table: () => ({
        columns: ['Източник', ...m.flat.map((l) => `${l}, млн. €`)],
        rows: m.ranked.map((x) => [x.short, ...x.mln.map((v) => (ok(v) ? v : null))]),
      }),
    },
    body: html`<div class="s06-sources">${items}</div>`,
  });
}

// ── the monthly execution is not shown here: this screen is the ANNUAL budget, the reports live on «Изпълнение» ──────
const execPointer = (ctx) =>
  html`<p class="s06-exec-go small muted">Колко от годината е събрано до последния месечен отчет: <a href="${ctx.href('S15')}">Месечни отчети</a>.</p>`;

// ── how to read the numbers ────────────────────────────────────────────────────────────────────────────
function notesBlock(ctx, m) {
  const items = [];
  const groupsNote =
    (Array.isArray(m.rev.notes)
      ? m.rev.notes.find((n) => n.id === 'groups')?.text
      : m.rev.notes?.groups) ?? '';
  if (groupsNote) items.push(groupsNote);
  const r = roundingNote(m);
  if (r) items.push(r);
  if (m.firstForecast > 0)
    items.push(
      `${m.years.slice(m.firstForecast).join(' и ')} са прогноза на Министерството на финансите, не приет план.`,
    );
  items.push(annualSource(ctx, m.rev));
  return block({
    id: 's06-notes',
    title: 'Как да четеш числата',
    status: 'real',
    pill: false,
    report: false,
    source: m?.rev.meta?.source || [],
    share: false,
    body: html`<ul class="s06-notes" data-gl-scan>${items.map((t) => html`<li>${t}</li>`)}</ul>`,
  });
}

// ── page contract ──────────────────────────────────────────────────────────────────────────────────────
/** grammatical forms for the one-sentence conclusion: [after „идва от“, with the article] */
const FORMS = {
  dds: ['ДДС', 'ДДС'],
  osiguritelni: ['осигуровки', 'осигуровките'],
  nedanachni: ['неданъчни приходи', 'неданъчните приходи'],
  pomoshti: ['помощи и дарения', 'помощите и даренията'],
  ddfl: ['данък върху доходите', 'данъкът върху доходите'],
  akcizi: ['акцизи', 'акцизите'],
  korporativen: ['корпоративен данък', 'корпоративният данък'],
  drugi: ['други данъци и мита', 'другите данъци и митата'],
};

export const lede = (ctx) => {
  const m = model(ctx);
  if (!m || !ok(m.total)) return null;
  const x = m.byId.get(String(ctx.params?.source || '').toLowerCase());
  if (x && ok(x.val))
    return `${x.short}: ${money(x.val, { d: 1 })} през ${yr(m.year)}, или ${pct(x.rawShare, 1)} от всички приходи.`;
  const v = money(m.total, { d: 1 });
  const first =
    {
      actual: `През ${yr(m.year)} приходите на държавата са ${v}.`,
      prelim: `Според предварителния отчет приходите през ${yr(m.year)} са ${v}.`,
      plan: `Държавата планира да събере ${v} приходи през ${yr(m.year)}`,
      forecast: `Според прогнозата приходите през ${yr(m.year)} ще бъдат ${v}.`,
    }[m.kind] ?? `Приходите през ${yr(m.year)} са ${v}.`;
  const [a, b] = m.ranked;
  if (!a || !ok(a.rawShare)) return first;
  const p = a.rawShare,
    f = FORMS[a.id];
  const second =
    p >= 23.5 && p < 26.5 && f
      ? `Всяко четвърто евро идва от ${f[0]}.`
      : `Най-голям е делът на „${a.short}“: ${pct(p, 1)} от приходите.`;
  const p2 = b && ok(b.rawShare) ? p + b.rawShare : null;
  const w2 =
    p2 == null
      ? ''
      : p2 >= 46 && p2 < 50
        ? 'почти половината'
        : p2 >= 50 && p2 < 54
          ? 'около половината'
          : '';
  const third =
    w2 && FORMS[a.id] && FORMS[b.id]
      ? ` ${upper(FORMS[a.id][1])} и ${FORMS[b.id][1]} заедно дават ${w2} от приходите.`
      : '';
  return `${first} ${second}${third}`;
};

/** /prihodi/dds: the heading stays the question of the screen, the document title names the source (one title per address, js/seo.js) */
export const docTitle = (ctx) => {
  const x = ctx.params?.source
    ? model(ctx)?.byId.get(String(ctx.params.source).toLowerCase())
    : null;
  return x ? `${x.short}: приходи през ${yr(model(ctx).year)}` : null;
};

export const crumbs = (ctx) => {
  const id = String(ctx.params?.source || '').toLowerCase();
  const x = id ? model(ctx)?.byId.get(id) : null;
  return x ? [{ label: 'Откъде идват парите?', href: ctx.href('S06') }, { label: x.short }] : null;
};

export const embeds = {
  's06-by-source': (ctx) => {
    const m = model(ctx);
    const empty = {
      id: 's06-by-source',
      type: 'barh',
      title: 'Приходи по видове',
      categories: [],
      series: [],
      emptyTitle: 'Приходите по видове не са налични',
      emptyText: 'Данните не се заредиха.',
    };
    return {
      chart: m ? sourcesChartSpec(ctx, m) : empty,
      source: m?.rev.meta?.source || [],
      asOf: m?.rev.meta?.asOf,
      status: m ? periodStatus(ctx) : 'pending',
    };
  },
};

export function render(ctx) {
  if (ctx.params?.source && !ctx.data.revenue.groups.some((item) => item.id === ctx.params.source))
    ctx.notFound();
  if (selectPeriod(ctx.annualRaw?.revenue, ctx.period.key).gaps?.groups)
    return annualGap(ctx, ctx.annualRaw.revenue, ['groups']);
  const m = model(ctx);
  if (!m)
    return pendingState({
      title: 'Приходи по видове',
      text: 'Данните за приходите не са налични в момента.',
    });
  const asked = ctx.params?.source;
  let sel = null;
  if (asked) {
    sel = m.byId.get(String(asked).toLowerCase())?.id ?? null;
    if (!sel) ctx.notFound();
  }
  return {
    context: 'Консолидирана фискална програма (КФП): приходи, помощи и дарения',
    body: html`${explorer(ctx, 'prihodi')}${stripBlock(ctx, m)}
      ${unitSwitch(ctx, { name: 's06-unit', note: 'Важи за числата и графиките.' })}
      ${kpiBlock(ctx, m)}${viewsBlock(ctx, m)}${sourcesBlock(ctx, m, sel)}${execPointer(ctx)}${notesBlock(ctx, m)}`,
  };
}

export function mount(root, ctx) {
  const off = [bindUnitSwitch(root, ctx, 's06-unit')];
  const id = String(ctx.params?.source || '').toLowerCase();
  let timer = 0;
  // a deep link /prihodi/<id>: the router has scrolled to the top and focused the heading by now; bring the source into view afterwards
  if (id && ctx.kind !== 'rerender' && ctx.kind !== 'pop' && !ctx.query.to) {
    // on a direct load (a shared link) the router scrolls to the top once more when the screen is ready: wait for that mark, then scroll
    const art = root.closest('article.page');
    let n = 0;
    const bring = () => {
      const el = root.querySelector(`#s06-src-${CSS.escape(id)}`);
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      el.classList.add('hl');
      setTimeout(() => el.classList.remove('hl'), 2600);
    };
    timer = setInterval(() => {
      if ((art && art.dataset.ready === '1') || ++n > 40) {
        clearInterval(timer);
        timer = setTimeout(bring, 40);
      }
    }, 60);
  }
  return () => {
    clearTimeout(timer);
    clearInterval(timer);
    off.forEach((f) => f && f());
  };
}
