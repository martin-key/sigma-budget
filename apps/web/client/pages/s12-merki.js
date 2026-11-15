import { isFramework } from '../budget-2027.js';
import { measuresView } from './measures-2027-view.js';
// S12 · Мерки в бюджета 2026 · #/merki[/<мярка>] · next S10 · periods 2026.draft, 2026.law (both set on the route)
// Data: source-checked excerpts in measures.json.
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { dataTable } from '../ui/table.js';
import { tabs } from '../ui/tabs.js';
import { disclosure } from '../ui/disclosure.js';
import { callout, ext, facts, linkCard } from '../ui/cards.js';
import { gl } from '../ui/gl.js';
import { num, date, plural, EUR_RATE, DASH, NBSP } from '../format.js';

export const needs = (ctx) => (isFramework(ctx) ? ['core', 'budget2027?'] : ['measures']);
export const styles = ['s12-merki'];

const TABS = ['short', 'discretionary', 'laws'];
const YEARS = ['2026', '2027', '2028'];
const SOURCE = ['asbp', 'bill'];
const REAL_LABEL = 'Официални данни, по законопроекта';
const KIND = { revenue: 'Приходна мярка', expenditure: 'Разходна мярка', law: 'Промяна в закон' };
const NO_SUM = 'Без посочена сума';
const MLN = `${NBSP}млн.${NBSP}€`;

// plain titles for the four groups of the short list (the document's own captions are long or missing)
const GROUPS = {
  'short-revenue': {
    title: 'Приходни мерки с посочена сума',
    sub: 'Мерки, които носят на държавата повече приходи през 2026 г.',
  },
  'short-expenditure': {
    title: 'Разходни мерки с посочена сума',
    sub: 'Мерки, които намаляват разходите през 2026 г.',
  },
  'short-revenue-noestimate': {
    title: 'Приходни мерки без посочена сума',
    sub: 'Промени в данъчното законодателство и в хазарта, взети предвид при прогнозата за данъците. Сума за тях не е посочена.',
  },
  'short-expenditure-noestimate': {
    title: 'Разходни мерки без посочена сума',
    sub: 'Разходни мерки, за които в мотивите няма посочена сума.',
  },
};

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const yr = (y) => `${y}${NBSP}г.`;

/** everything the builders need, derived once per render */
function model(ctx) {
  const D = ctx.data.measures || {};
  const items = arr(D.items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const rel = new Map(items.map((i) => [i.id, new Set()])); // „related“ read both ways
  for (const i of items)
    for (const r of arr(i.related))
      if (byId.has(r)) {
        rel.get(i.id).add(r);
        rel.get(r).add(i.id);
      }
  const lists = Object.fromEntries(TABS.map((t) => [t, items.filter((i) => i.tab === t)]));
  return { D, items, byId, rel, lists };
}

/** an amount in млн. €, optionally signed; with „и в лева“ on the same amount follows in лева */
function amt(ctx, v, o = {}) {
  if (!ok(v)) return DASH;
  const d = o.d ?? 1,
    s = o.sign ? { sign: true } : {};
  const eur = `${num(v, d, s)}${MLN}`;
  return ctx.store.get('leva')
    ? `${eur} (≈${NBSP}${num(v * EUR_RATE, d, s)}${NBSP}млн.${NBSP}лв.)`
    : eur;
}
const pageText = (p) =>
  p && ok(p.docx) ? `стр.${NBSP}${p.docx}${ok(p.to) && p.to !== p.docx ? `–${p.to}` : ''}` : '';
const stageText = (M, it) => M.D.stageLabels?.[it.stage] || '';
const listLabel = (M, tab) => M.D.tabLabels?.[tab] || tab;

function effectWords(it, v) {
  if (!ok(v) || v === 0) return '';
  if (it.kind === 'revenue') return v > 0 ? 'повече приходи' : 'по-малко приходи';
  if (it.kind !== 'expenditure') return '';
  if (it.estimateKind === 'avoided') return 'избегнати разходи';
  return v > 0 ? 'повече разходи' : 'по-малко разходи';
}
const balanceWords = (v) =>
  !ok(v) || v === 0 ? '' : v > 0 ? 'подобрява салдото' : 'влошава салдото';

/** the 2026 effect of a short-list measure, or „Без посочена сума“ */
function effectHtml(ctx, M, it) {
  const v = it.effectMln && it.effectMln['2026'];
  if (!ok(v)) return html`<span class="muted">${NO_SUM}</span>`;
  const words = effectWords(it, v);
  const kind =
    it.estimateKind && it.estimateKind !== 'stated' ? M.D.estimateKinds?.[it.estimateKind] : ''; // „Посочена сума“ is the normal case: no label
  return html`<span class="s12-eff num">${amt(ctx, v, { sign: true })}</span>${words ? html` <span class="s12-eff-words">· ${words}</span>` : ''}${kind ? html`<span class="s12-eff-kind">${kind}</span>` : ''}`;
}

/** 2026 / 2027 / 2028 of a discretionary measure: change against the previous year; a year without an estimate is a dash */
function yearsHtml(ctx, it) {
  const e = it.effectMln || {},
    lev = !!ctx.store.get('leva');
  return html`<div class="s12-years-box">
    <p class="s12-years-h">Изменение спрямо предходната година, млн. €</p>
    <dl class="s12-years">${YEARS.map(
      (y) =>
        html`<div><dt>${yr(y)}</dt><dd>${
          ok(e[y])
            ? html`<span class="num">${num(e[y], 1, { sign: true })}</span>${lev ? html`<span class="s12-lev">≈${NBSP}${num(e[y] * EUR_RATE, 1, { sign: true })}${NBSP}лв.</span>` : ''}`
            : html`<span class="muted" title="Няма оценка за тази година">${DASH}<span class="sr-only"> няма оценка</span></span>`
        }</dd></div>`,
    )}</dl></div>`;
}

/** „От кога“: the date of the data, else the date or the phrase of the text (source excerpts), else „не е посочено“ */
function fromHtml(M, it) {
  const lab = it;
  const iso = it.from || (lab && lab.since);
  if (iso) return html`${date(iso, true)}`;
  if (lab && lab.sinceText)
    return html`<span class="s12-phrase">„${lab.sinceText}“</span> <span class="muted small">(по текста)</span>`;
  return html`<span class="muted">Не е посочено в мотивите</span>`;
}

function quoteHtml(it) {
  const pg = pageText(it.page);
  return html`<details class="s12-quote" id="q-${it.id}">
    <summary>Откъс от мотивите${pg ? html` · ${pg}` : ''}</summary>
    <blockquote class="s12-quote-text" data-gl-skip>${it.quote}</blockquote>
  </details>`;
}

/** one measure as a card (list pages) */
function card(ctx, M, it) {
  const lab = it;
  const dk = it.tab === 'discretionary';
  const rows = [
    dk ? null : { k: 'Ефект през 2026 г.', v: effectHtml(ctx, M, it) },
    lab && lab.legal ? { k: 'Правно основание', v: lab.legal } : null,
    { k: 'От кога', v: fromHtml(M, it) },
    { k: 'Статус', v: stageText(M, it) },
  ].filter(Boolean);
  return html`<article class="s12-card" id="m-${it.id}" data-kind="${it.kind}" aria-labelledby="m-${it.id}-h">
    <p class="s12-kind">${KIND[it.kind] || 'Мярка'}${it.table ? ` · Табл. ${it.table}` : ''}</p>
    <h3 class="s12-name" id="m-${it.id}-h"><a href="${ctx.href('merki', { id: it.id })}">${it.name}</a></h3>
    <p class="s12-text">${it.text}</p>
    ${dk ? yearsHtml(ctx, it) : ''}
    ${facts(rows, { cls: 's12-facts' })}
    ${quoteHtml(it)}
  </article>`;
}
const cardsGrid = (ctx, M, list) =>
  html`<div class="s12-cards">${list.map((it) => card(ctx, M, it))}</div>`;

// ------------------------------------------------------------------ table twins (CSV, expert view) — always the whole real list
const kindText = (M, it) =>
  ok(it.effectMln && it.effectMln['2026']) ? M.D.estimateKinds?.[it.estimateKind] || '' : NO_SUM;
const sgn = (v) => (ok(v) ? num(v, 1, { sign: true }) : DASH);

function twin(ctx, id, caption, columns, rows, o = {}) {
  return disclosure({
    id: `${id}-d`,
    title: 'Покажи като таблица',
    meta: `всички ${plural(rows.length, 'ред', 'реда')}`,
    open: ctx.store.get('userType') === 'expert',
    body: dataTable({
      id,
      caption,
      columns,
      rows,
      sortable: true,
      dense: true,
      total: o.total,
      note: o.note,
    }),
  });
}
function shortRows(ctx, M, list) {
  return list.map((it) => ({
    name: it.name,
    eff: ok(it.effectMln && it.effectMln['2026']) ? it.effectMln['2026'] : null,
    kind: kindText(M, it),
    from: it.from || it.since || it.sinceText || null,
    legal: it.legal || null,
    page: it.page?.docx ?? null,
    _href: ctx.href('merki', { id: it.id }),
  }));
}
const SHORT_COLS = [
  { key: 'name', label: 'Мярка' },
  { key: 'eff', label: 'Ефект през 2026', unit: 'млн. €', fmt: sgn },
  { key: 'kind', label: 'Вид на сумата', sort: true },
  { key: 'legal', label: 'Правно основание' },
  {
    key: 'from',
    label: 'От кога',
    fmt: (v) => (v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? date(v) : v) : DASH),
  },
  { key: 'page', label: 'Страница', fmt: (v) => (ok(v) ? String(v) : DASH) },
];
function discRows(ctx, M, list) {
  return list.map((it) => ({
    name: it.name,
    y2026: it.effectMln?.['2026'] ?? null,
    y2027: it.effectMln?.['2027'] ?? null,
    y2028: it.effectMln?.['2028'] ?? null,
    page: it.page?.docx ?? null,
    _href: ctx.href('merki', { id: it.id }),
  }));
}
const DISC_COLS = [
  { key: 'name', label: 'Мярка' },
  { key: 'y2026', label: '2026', unit: 'млн. €', fmt: sgn },
  { key: 'y2027', label: '2027', unit: 'млн. €', fmt: sgn },
  { key: 'y2028', label: '2028', unit: 'млн. €', fmt: sgn },
  { key: 'page', label: 'Страница', fmt: (v) => (ok(v) ? String(v) : DASH) },
];

// ------------------------------------------------------------------ the three lists
function groupBlock(ctx, M, g) {
  const all = arr(g.items)
    .map((id) => M.byId.get(id))
    .filter(Boolean);
  const shown = all;
  if (!shown.length) return '';
  const P = GROUPS[g.id] || { title: g.title || 'Мерки', sub: '' };
  const count = `${plural(all.length, 'мярка', 'мерки')}.`;
  const rows = shortRows(ctx, M, all);
  const total = ok(g.totalMln)
    ? {
        label: g.id === 'short-expenditure' ? 'Общо (с индикативните)' : 'Общо',
        values: { eff: g.totalMln },
      }
    : null;
  return block({
    id: `s12-${g.id}`,
    title: P.title,
    status: 'real',
    statusLabel: REAL_LABEL,
    source: SOURCE,
    asOf: M.D.meta?.asOf,
    sub: html`${P.sub} <span class="s12-count">${count}</span>`,
    foot: g.page ? `Страница в мотивите: ${g.page}.` : '',
    share: {
      text: `${P.title} в бюджета за 2026 г.: ${plural(all.length, 'мярка', 'мерки')} (по законопроекта).`,
    },
    body: html`${cardsGrid(ctx, M, shown)}${twin(ctx, `s12-t-${g.id}`, `${P.title}: ефект през 2026 г.`, SHORT_COLS, rows, { total })}`,
  });
}

function shortPanel(ctx, M) {
  const T = M.D.totals || {},
    C = M.D.counts?.short || {},
    lev = ctx.store.get('leva');
  const levTxt = (v) =>
    lev && ok(v) ? ` ≈${NBSP}${num(v * EUR_RATE, 1, { sign: true })}${NBSP}млн.${NBSP}лв.` : '';
  const sums = block({
    id: 's12-short-sums',
    title: 'Сборове по краткосрочните мерки',
    status: 'real',
    statusLabel: REAL_LABEL,
    source: SOURCE,
    asOf: M.D.meta?.asOf,
    share: {
      text: `Краткосрочни мерки в бюджета за 2026 г. (по законопроекта): приходни ${amt(ctx, T.revenueMln, { sign: true })}, разходни ${amt(ctx, T.expenditureMln, { sign: true })}.`,
    },
    body: kpiGrid(
      [
        kpi({
          label: 'Приходни мерки',
          value: sgn(T.revenueMln),
          unit: 'млн. €',
          sub: `Ефект върху приходите през 2026 г. ${plural(C.revenue, 'мярка', 'мерки')} с посочена сума.${levTxt(T.revenueMln)}`,
        }),
        kpi({
          label: 'Разходни мерки',
          value: sgn(T.expenditureMln),
          unit: 'млн. €',
          sub: `Ефект върху разходите през 2026 г. ${plural(C.expenditure, 'мярка', 'мерки')} с посочена сума. Без двете индикативни: ${amt(ctx, T.expenditureMlnWithoutIndicative, { sign: true })}.`,
        }),
        kpi({
          label: 'Мерки без посочена сума',
          value: String(C.noEstimate ?? DASH),
          unit: C.noEstimate === 1 ? 'мярка' : 'мерки',
          sub: 'За тях в мотивите няма оценка в пари.',
        }),
      ],
      { label: 'Сборове по краткосрочните мерки' },
    ),
  });
  const groups = arr(M.D.groups)
    .filter((g) => g.tab === 'short')
    .map((g) => groupBlock(ctx, M, g))
    .filter(Boolean);
  const intro = html`<p class="s12-intro" data-gl-scan>Това е краткият списък от увода на мотивите. ${gl('prihodna-myarka', 'Приходните мерки')} носят на държавата повече приходи, а ${gl('razhodna-myarka', 'разходните')} намаляват разходите. Всички суми са за 2026 г.</p>`;
  return html`<div class="stack-lg">${intro}${sums}${groups}</div>`;
}

function discPanel(ctx, M) {
  const T = M.D.totals || {},
    dy = T.discretionary || {},
    per = T.discretionaryPeriod || {},
    g = T.gdpShare2026 || {};
  const t8 = dy['II-8'] || {},
    t9 = dy['II-9'] || {};
  const pctGdp = (v) => (ok(v) ? `${num(v, 2)}% от БВП през 2026 г.` : '');
  const sumRows = [
    {
      name: 'Приходни мерки (Табл. II-8)',
      y2026: t8['2026'],
      y2027: t8['2027'],
      y2028: t8['2028'],
      sum: per['II-8'],
    },
    {
      name: 'Разходни мерки (Табл. II-9)',
      y2026: t9['2026'],
      y2027: t9['2027'],
      y2028: t9['2028'],
      sum: per['II-9'],
    },
  ];
  const sums = block({
    id: 's12-disc-sums',
    title: 'Сборове по дискреционните мерки',
    status: 'real',
    statusLabel: REAL_LABEL,
    source: SOURCE,
    asOf: M.D.meta?.asOf,
    foot: html`<span>Основа: ${gl('nachislena-osnova', 'начислена основа')}, сектор „Държавно управление“. Сумите са изменение спрямо предходната година.</span><span>Годишните сборове са общите редове на таблиците, а „Общо 2026–2028“ е от текста на мотивите. Възможна е разлика от 0,1 млн. € заради закръгляване.</span>`,
    share: {
      text: `Дискреционни мерки в бюджета за 2026 г. (по законопроекта): приходни ${amt(ctx, t8['2026'], { sign: true })}, разходни ${amt(ctx, t9['2026'], { sign: true })} през 2026 г.`,
    },
    body: html`<div class="stack">${kpiGrid(
      [
        kpi({
          label: 'Приходни мерки през 2026 г.',
          value: sgn(t8['2026']),
          unit: 'млн. €',
          sub: `Повече приходи. ${pctGdp(g.revenue)}`,
        }),
        kpi({
          label: 'Разходни мерки през 2026 г.',
          value: sgn(t9['2026']),
          unit: 'млн. €',
          sub: `Повече разходи. ${pctGdp(g.expenditure)}`,
        }),
      ],
      { label: 'Сборове за 2026 г.' },
    )}
    ${dataTable({
      id: 's12-t-disc-sums',
      caption: 'Дискреционни мерки: сборове по години',
      dense: true,
      columns: [
        { key: 'name', label: 'Таблица' },
        { key: 'y2026', label: '2026', unit: 'млн. €', fmt: sgn },
        { key: 'y2027', label: '2027', unit: 'млн. €', fmt: sgn },
        { key: 'y2028', label: '2028', unit: 'млн. €', fmt: sgn },
        { key: 'sum', label: 'Общо 2026–2028', unit: 'млн. €', fmt: sgn },
      ],
      rows: sumRows,
    })}</div>`,
  });
  const part = (table, id, title, sub) => {
    const all = M.lists.discretionary.filter((i) => i.table === table);
    const shown = all;
    if (!shown.length) return '';
    const count = `${plural(all.length, 'мярка', 'мерки')}.`;
    return block({
      id,
      title,
      status: 'real',
      statusLabel: REAL_LABEL,
      source: SOURCE,
      asOf: M.D.meta?.asOf,
      sub: html`${sub} <span class="s12-count">${count}</span>`,
      foot: all[0]?.tablePage ? `Таблицата е на страница ${all[0].tablePage} от мотивите.` : '',
      share: {
        text: `${title} в бюджета за 2026 г.: ${plural(all.length, 'мярка', 'мерки')} (по законопроекта).`,
      },
      body: html`${cardsGrid(ctx, M, shown)}${twin(ctx, `s12-t-${table.toLowerCase()}`, `${title}: изменение спрямо предходната година`, DISC_COLS, discRows(ctx, M, all))}`,
    });
  };
  const blocks = [
    part(
      'II-8',
      's12-disc-rev',
      'Приходни дискреционни мерки (Табл. II-8)',
      'Мерки, които променят приходите през 2026, 2027 и 2028 г.',
    ),
    part(
      'II-9',
      's12-disc-exp',
      'Разходни дискреционни мерки (Табл. II-9)',
      'Мерки, които променят разходите през 2026, 2027 и 2028 г.',
    ),
  ].filter(Boolean);
  const intro = html`<p class="s12-intro" data-gl-scan>Две по-подробни таблици показват мерките за 2026, 2027 и 2028 г.: II-8 за приходите и II-9 за разходите. Сумите са изменение спрямо предходната година, на ${gl('nachislena-osnova', 'начислена основа')}.</p>`;
  return html`<div class="stack-lg">${intro}${sums}${blocks}</div>`;
}

function lawsPanel(ctx, M) {
  const all = M.lists.laws;
  const count = `${plural(all.length, 'промяна', 'промени')}.`;
  const rows = all.map((it) => ({
    name: it.name,
    law: it.legal || null,
    page: it.page?.docx ?? null,
    _href: ctx.href('merki', { id: it.id }),
  }));
  const body = html`${cardsGrid(ctx, M, all)}${twin(
    ctx,
    's12-t-laws',
    'Промени в други закони',
    [
      { key: 'name', label: 'Промяна' },
      { key: 'law', label: 'Правно основание', fmt: (v) => v || DASH },
      { key: 'page', label: 'Страница', fmt: (v) => (ok(v) ? String(v) : DASH) },
    ],
    rows,
  )}`;
  return html`<div class="stack-lg">
    <p class="s12-intro">Част от мерките се въвеждат с промени в други закони. За тях в мотивите няма посочена сума.</p>
    ${block({
      id: 's12-laws',
      title: listLabel(M, 'laws'),
      status: 'real',
      statusLabel: REAL_LABEL,
      source: SOURCE,
      asOf: M.D.meta?.asOf,
      sub: html`${M.D.tabNotes?.laws || ''} <span class="s12-count">${count}</span>`,
      share: {
        text: `Промени в други закони, свързани с бюджета за 2026 г.: ${plural(all.length, 'промяна', 'промени')} (по законопроекта).`,
      },
      body,
    })}
  </div>`;
}

// ------------------------------------------------------------------ list page
function howTo(M) {
  const n = arr(M.D.notes).reduce((o, x) => ({ ...o, [x.id]: x.text }), {});
  const tn = M.D.tabNotes || {};
  const li = [
    n.sign,
    'В таблиците II-8 и II-9 всяка сума е изменение спрямо предходната година: плюс значи повече приходи или повече разходи, минус значи по-малко.',
    tn.short,
    n.indicative,
    n.basis,
  ].filter(Boolean);
  return disclosure({
    id: 's12-howto',
    title: 'Как да четеш числата',
    body: html`<ul class="s12-howto" data-gl-scan>${li.map((t) => html`<li>${t}</li>`)}</ul>`,
  });
}

function listPage(ctx, M) {
  const D = M.D,
    c = Object.fromEntries(TABS.map((t) => [t, M.lists[t].length]));
  const ignored = ctx.store.get('perPerson') || ctx.store.get('unit') === 'pct';
  const active = TABS.includes(ctx.query.spisak) ? ctx.query.spisak : 'short';
  const body = html`<div class="stack-lg s12-list">
    ${callout({
      kind: 'info',
      id: 's12-stage',
      title: 'Числата са по законопроекта, не по приетия закон',
      body: html`<p>${D.document?.adopted || 'Приетият закон може да се различава от законопроекта.'} Какво е променено при приемането, е в „<a href="${ctx.href('S14')}">Пътят на бюджета</a>“.</p>`,
    })}
    ${ignored ? html`<p class="s12-ignored small muted">Тук сумите са в милиони евро. „На човек“ и „% от БВП“ не се прилагат към отделните мерки.</p>` : ''}
    ${howTo(M)}
    ${tabs({
      id: 's12-lists',
      label: 'Списъци с мерки',
      query: 'spisak',
      active,
      tabs: [
        { key: 'short', label: listLabel(M, 'short'), count: c.short, body: shortPanel(ctx, M) },
        {
          key: 'discretionary',
          label: listLabel(M, 'discretionary'),
          count: c.discretionary,
          body: discPanel(ctx, M),
        },
        { key: 'laws', label: listLabel(M, 'laws'), count: c.laws, body: lawsPanel(ctx, M) },
      ],
    })}
  </div>`;
  const lede =
    'Мерките са промени в данъците, осигуровките и разходите, записани в мотивите към бюджета за 2026 г. За всяка пише какво се променя, колко пари е ефектът, от кога важи и къде е записано.';
  return {
    lede,
    context: D.meta?.asOf ? html`Мерките са по законопроекта, внесен на ${date(D.meta.asOf)}.` : '',
    body,
  };
}

// ------------------------------------------------------------------ measure page
function balanceHtml(ctx, it) {
  const e = it.balanceEffectMln;
  const ys = YEARS.filter((y) => e && ok(e[y]));
  if (!ys.length) return '';
  return html`<ul class="s12-balance">${ys.map((y) => html`<li><span class="muted">${yr(y)}:</span> <span class="num">${amt(ctx, e[y], { sign: true })}</span> · ${balanceWords(e[y])}</li>`)}</ul>`;
}

function whatBlock(ctx, M, it) {
  const lab = it;
  const dk = it.tab === 'discretionary';
  const bal = balanceHtml(ctx, it);
  const pg = pageText(it.page);
  const rows = [
    {
      k: 'Вид',
      v: `${KIND[it.kind] || 'Мярка'} · ${listLabel(M, it.tab)}${it.table ? ` · Табл. ${it.table}` : ''}`,
    },
    dk
      ? { k: 'Изменение спрямо предходната година', v: yearsHtml(ctx, it) }
      : { k: 'Ефект през 2026 г.', v: effectHtml(ctx, M, it) },
    bal ? { k: html`Ефект върху ${gl('byudzhetno-saldo', 'бюджетното салдо')}`, v: bal } : null,
    it.basis === 'accrual'
      ? {
          k: 'Основа',
          v: html`${gl('nachislena-osnova', 'Начислена основа')}, сектор „Държавно управление“`,
        }
      : null,
    { k: 'От кога', v: fromHtml(M, it) },
    lab && lab.legal ? { k: 'Правно основание', v: lab.legal } : null,
    { k: 'Статус', v: stageText(M, it) },
    pg
      ? {
          k: 'Къде в мотивите',
          v: `${pg}${it.tablePage ? `; таблицата е на стр.${NBSP}${it.tablePage}` : ''}`,
        }
      : null,
  ].filter(Boolean);
  const v26 = it.effectMln && it.effectMln['2026'];
  return block({
    id: 's12-m-what',
    title: 'Какво се променя',
    status: 'real',
    statusLabel: REAL_LABEL,
    source: SOURCE,
    asOf: M.D.meta?.asOf,
    share: {
      text: `${it.name}: ${ok(v26) ? amt(ctx, v26, { sign: true }) + ' през 2026 г.' : NO_SUM.toLowerCase()} (мярка в бюджета за 2026 г., по законопроекта).`,
    },
    body: facts(rows, { cls: 's12-facts-wide' }),
  });
}

function textBlock(ctx, M, it) {
  const doc = M.D.document || {};
  const pg = pageText(it.page);
  return block({
    id: 's12-m-text',
    title: 'Какво пише в мотивите',
    status: 'real',
    statusLabel: REAL_LABEL,
    source: SOURCE,
    asOf: M.D.meta?.asOf,
    body: html`<div class="stack"><blockquote class="s12-quote-full" data-gl-skip>${it.quote}</blockquote>
      <p class="small muted">${pg ? html`${pg[0].toUpperCase()}${pg.slice(1)}. ` : ''}${doc.pagesNote || ''}</p>
      <p class="cluster">${doc.url ? ext(doc.url, 'Отвори мотивите (файл .docx)') : ''}${doc.billPage ? ext(doc.billPage, 'Законопроектът в сайта на Народното събрание') : ''}</p></div>`,
  });
}

function neighbours(M, it) {
  const list = M.lists[it.tab] || [],
    i = list.findIndex((x) => x.id === it.id);
  return {
    prev: i > 0 ? list[i - 1] : null,
    next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
  };
}

function relatedBlock(ctx, M, it) {
  const ids = [...(M.rel.get(it.id) || [])];
  const rel = ids.map((id) => M.byId.get(id)).filter(Boolean);
  const { prev, next } = neighbours(M, it);
  const lc = (x) =>
    linkCard({
      href: ctx.href('merki', { id: x.id }),
      kicker: `${KIND[x.kind] || 'Мярка'} · ${listLabel(M, x.tab)}${x.table ? ` · Табл. ${x.table}` : ''}`,
      title: x.name,
      text: x.text,
    });
  const nav = [
    prev && { x: prev, k: 'Предишна в списъка' },
    next && { x: next, k: 'Следваща в списъка' },
  ].filter(Boolean);
  if (!rel.length && !nav.length) return '';
  return block({
    id: 's12-m-related',
    title: 'Свързани мерки',
    status: 'real',
    source: 'bill',
    share: false,
    report: false,
    body: html`<div class="stack">
      ${rel.length ? html`<div class="grid grid-2">${rel.map(lc)}</div>` : html`<p class="muted">В мотивите тази мярка не е свързана изрично с друга.</p>`}
      ${nav.length ? html`<div class="grid grid-2 s12-pager">${nav.map((n) => linkCard({ href: ctx.href('merki', { id: n.x.id }), kicker: n.k, title: n.x.name }))}</div>` : ''}</div>`,
  });
}

function measurePage(ctx, M, it) {
  return {
    title: it.name,
    lede: it.text,
    context: M.D.meta?.asOf
      ? html`Мярката е по законопроекта, внесен на ${date(M.D.meta.asOf)}.`
      : '',
    body: html`<div class="stack-lg s12-measure">
      ${callout({ kind: 'info', id: 's12-stage', title: 'Числата са по законопроекта, не по приетия закон', body: html`<p>${M.D.document?.adopted || 'Приетият закон може да се различава от законопроекта.'}</p>` })}
      ${whatBlock(ctx, M, it)}${textBlock(ctx, M, it)}${relatedBlock(ctx, M, it)}
    </div>`,
  };
}

// ------------------------------------------------------------------ router hooks
const found = (ctx) => {
  const id = ctx.params && ctx.params.id;
  return id
    ? arr(ctx.data.measures && ctx.data.measures.items).find((i) => i.id === id) || null
    : null;
};

/** the same measure can stand in two lists (short-term and discretionary): the document title names the list (js/seo.js) */
export function docTitle(ctx) {
  if (isFramework(ctx)) return undefined;
  const it = found(ctx),
    lbl = it && ctx.data.measures?.tabLabels?.[it.tab];
  return it ? `${it.name}${lbl ? ` · ${lbl}` : ''}` : null;
}

export function crumbs(ctx) {
  if (isFramework(ctx)) return undefined;
  const it = found(ctx);
  return it
    ? [{ label: 'Мерки в бюджета 2026', href: ctx.href('merki') }, { label: it.name }]
    : null;
}

export function next(ctx) {
  if (isFramework(ctx)) return ['S10'];
  const it = found(ctx);
  if (!it) return ['S10'];
  return [
    {
      kicker: 'Мерки',
      title: 'Всички мерки в бюджета',
      text: 'Върни се към списъците с мерки.',
      href: ctx.href('merki', {}, { spisak: it.tab, to: `m-${it.id}` }),
    },
    'S10',
  ];
}

export function render(ctx) {
  if (isFramework(ctx)) return measuresView(ctx);
  const M = model(ctx);
  if (ctx.params && ctx.params.id) {
    const it = M.byId.get(ctx.params.id);
    if (!it) ctx.notFound();
    return measurePage(ctx, M, it);
  }
  return listPage(ctx, M);
}
