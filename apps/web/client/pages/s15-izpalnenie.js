// S15 Изпълнение (V5). The monthly reports of the КФП, comparison first: two permanent year columns («2025» and «2026»), the same period,
// the same scope, the same mode («Натрупано» or «За месеца»). Every number comes from execution.json (D06/D16/D26) through js/exec.js.
// Routes: #/izpalnenie (the comparison), #/izpalnenie/byudzheti (the plan of every budget and the national budget against the EU funds).
// Address: ?mesec= ?obhvat= ?rez=natrupano|mesec ?g1= (the earlier year) ?g2= ?pera=rev,exp (open groups) ?pokazatel=<row> (one item in full).
// Arrival (working-group feedback, 2026-10-10): with no ?mesec the page opens on the LATEST reported month of the newest year (js/exec.js `defMonth`, read from execution.json: nothing here names a month),
//   one line under the heading says which report it is (`reportLine`), and the four controls are folded into one closed disclosure «Избери месец и сравнение» whose summary says what is shown now.
//   A control param in the address (?mesec ?rez ?g1 ?g2 ?obhvat) keeps the disclosure open; a month other than the latest gets a link back («Последен отчет»).
// Under the comparison: «Изпълнение на плана» (working-group feedback, 2026-10-09): three bars (приходи, разходи, капиталови разходи) = the latest report against the annual plan,
//   КФП only, independent of the controls; neutral colours, no „lagging“ verdict (UX V2 §7: % от плана е вторичен блок с точния документ и знаменател).
// The old links #/izpalnenie/pera and #/izpalnenie/sravnenie are redirected by js/redirects.js.
import { html } from '../html.js';
import { num, pct, delta, date, monthName, EUR_RATE, NBSP, DASH } from '../format.js';
import { block } from '../ui/block.js';
import { seg } from '../ui/seg.js';
import { field, selectInput } from '../ui/forms.js';
import { dataTable } from '../ui/table.js';
import { chart } from '../ui/chart.js';
import { emptyState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { disclosure } from '../ui/disclosure.js';
import { planBlock } from '../ui/plan.js';
import { icon } from '../icons.js';
import { siteUrl } from '../seo.js';
import { dataHref } from '../data.js';
import { store } from '../store.js';
import * as share from '../share.js';
import { amount, moneyCol } from '../view.js';
import {
  execModel,
  SCOPES,
  SCOPE_NAME,
  SCOPE_IN,
  MODES,
  REV_ROWS,
  EXP_ROWS,
  fin,
  pctChange,
  mlrd,
  balanceWord,
} from '../exec.js';

const QUERY_KEYS = ['mesec', 'obhvat', 'rez', 'g1', 'g2', 'pera'];
const CONTROL_KEYS = ['mesec', 'obhvat', 'rez', 'g1', 'g2']; // the choices of the «Избери месец и сравнение» disclosure (?pera and ?pokazatel are not)
const hasControlParams = (q) =>
  !!q && CONTROL_KEYS.some((k) => q[k] != null && String(q[k]) !== '');
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const joinBg = (xs) =>
  xs.length > 1
    ? `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`
    : String(xs.length ? xs[0] : '');
const yearWord = (y) => (typeof y === 'number' ? `${y} г.` : `„${y}“`);
const MONTH_CATS = Array.from({ length: 12 }, (_, i) => monthName(i + 1, true));
const TOTALS = {
  rev: 'Приходи',
  'exp.total': 'Разходи с вноската в ЕС',
  balance: 'Салдо',
  transfers: 'Трансфери между бюджетите, нето',
};
const GROUPS = [
  { id: 'rev', total: 'rev', items: REV_ROWS },
  { id: 'exp', total: 'exp.total', items: [...EXP_ROWS, 'eucontrib'] },
];
const ALL_ROWS = [
  ...REV_ROWS,
  'rev',
  ...EXP_ROWS,
  'eucontrib',
  'exp.total',
  'transfers',
  'balance',
];

/** the visitor's own keys of the query, for links that must keep the controls */
export function keepQuery(ctx, over = {}) {
  const out = {};
  for (const k of QUERY_KEYS) if (ctx.query && ctx.query[k]) out[k] = ctx.query[k];
  return { ...out, ...over };
}

export function model(ctx) {
  const E = execModel(ctx.data.execution, ctx.query || {});
  const sub = ctx.params && ctx.params.sub;
  const open = new Set(
    String((ctx.query && ctx.query.pera) || '')
      .split(',')
      .filter(Boolean),
  );
  const item = ctx.query && ALL_ROWS.includes(ctx.query.pokazatel) ? ctx.query.pokazatel : null;
  const page = sub === 'byudzheti' ? 'byudzheti' : item ? 'item' : 'main';
  return { ...E, ctx, page, item, open };
}

/* ------------------------------------------------------------------ numbers as they are printed: млрд. €, two decimals, from the unrounded млн. € */
const B = (v) => (fin(v) ? num(v / 1000, 2) : DASH);
const BS = (v) => (fin(v) ? num(v / 1000, 2, { sign: true }) : DASH);
const levOf = (v) =>
  store.get('leva') && fin(v) ? `≈${NBSP}${num((v / 1000) * EUR_RATE, 2)}${NBSP}млрд. лв.` : '';
const nameOf = (C, id) => TOTALS[id] || C.rowName(id);
const monthsLabel = (C) => (C.month === 1 ? 'януари' : `януари${DASH}${monthName(C.month)}`);
const dayOf = (iso) => {
  const d = iso ? new Date(`${iso}T00:00:00Z`) : null;
  return d ? `${d.getUTCDate()} ${monthName(d.getUTCMonth() + 1)}` : '';
};
/** what the year heading says under the year: the date of the report, or the month alone */
const periodTag = (C, y) =>
  C.mode === 'mesec'
    ? monthName(C.month)
    : C.has(y) && C.month <= (y === C.g1 ? C.n1 : C.n2)
      ? `към ${dayOf(C.asOfOf(y))}`
      : 'няма отчет';
const modeWord = (C) =>
  C.mode === 'mesec' ? 'само за месеца' : 'натрупано от началото на годината';

/* ------------------------------------------------------------------ words */
function cmpWords(C, a, b, where) {
  const p = pctChange(a, b);
  if (!fin(p)) return `при ${B(a)}${NBSP}млрд.${NBSP}€ ${where} ${C.g1} г.`;
  if (Math.abs(p) < 0.05) return `колкото ${where} ${C.g1} г.`;
  return `с ${pct(Math.abs(p), 1)} ${p > 0 ? 'повече' : 'по-малко'}, отколкото ${where} ${C.g1} г.`;
}

export function summaryText(C) {
  if (C.problem) return '';
  const mon = monthName(C.month);
  const r1 = C.val(C.g1, 'rev'),
    r2 = C.val(C.g2, 'rev'),
    e1 = C.val(C.g1, 'exp.total'),
    e2 = C.val(C.g2, 'exp.total'),
    b2 = C.val(C.g2, 'balance');
  const miss = [
    [C.g1, r1],
    [C.g2, r2],
  ]
    .filter((x) => !fin(x[1]))
    .map((x) => x[0]);
  if (miss.length) return `За ${joinBg(miss)} г. още няма отчет за ${mon}.`;
  const natr = C.mode !== 'mesec';
  const where = natr ? `към края на ${mon}` : `през ${mon}`;
  const head = natr ? `Към края на ${mon} ${C.g2} г.` : `През ${mon} ${C.g2} г.`;
  const s1 = `${head} ${SCOPE_IN[C.scope]} са събрани ${B(r2)}${NBSP}млрд.${NBSP}€, ${cmpWords(C, r1, r2, where)}`;
  const s2 =
    fin(e1) && fin(e2)
      ? ` Похарчени са ${B(e2)}${NBSP}млрд.${NBSP}€, ${cmpWords(C, e1, e2, where)}`
      : '';
  const s3 =
    C.scope === 'kfp' && fin(b2)
      ? ` ${cap1(balanceWord(b2))}: ${B(Math.abs(b2))}${NBSP}млрд.${NBSP}€.`
      : '';
  return s1 + s2 + s3;
}

/* ------------------------------------------------------------------ controls */
const ctl = (label, id, inner, cls = '') =>
  html`<div class="field s15-ctl ${cls}"><span class="field-label" id="${id}">${label}</span>${inner}</div>`;

function monthOptions(C) {
  const out = [];
  const short = C.n1 && C.n2 && C.n1 !== C.n2 ? (C.n1 < C.n2 ? C.g1 : C.g2) : null; // the year with fewer reports
  for (let m = 1; m <= C.maxM; m++)
    out.push({
      value: String(m),
      label: `${cap1(monthName(m))}${short != null && m > C.common ? ` (няма отчет за ${short} г.)` : ''}`,
    });
  const later = new Set(C.pendingMonths.filter((m) => m > C.maxM));
  [...later]
    .sort((a, b) => a - b)
    .forEach((m) => out.push({ value: String(m), label: `${cap1(monthName(m))} (няма отчет)` }));
  if (C.month > C.maxM && !later.has(C.month))
    out.push({ value: String(C.month), label: `${cap1(monthName(C.month))} (няма отчет)` });
  return out;
}

export function controls(C) {
  const prevYears = C.years.filter((y) => y < (typeof C.g2 === 'number' ? C.g2 : Infinity));
  const prevOpts = [...prevYears].reverse().map((y) => ({ value: String(y), label: String(y) }));
  if (!C.has(C.g1)) prevOpts.unshift({ value: String(C.g1), label: String(C.g1) });
  const primary = [
    field({
      id: 's15-mesec',
      label: 'Месец',
      control: selectInput({
        id: 's15-mesec',
        name: 'mesec',
        value: String(C.month),
        options: monthOptions(C),
        query: 'mesec',
      }),
    }),
    ctl(
      'Показвай',
      's15-rez-l',
      seg({
        name: 's15-rez',
        label: 'Показвай',
        value: C.mode,
        query: 'rez',
        cls: 's15-seg',
        options: MODES,
      }),
      's15-ctl-mode',
    ),
  ];
  const second = [
    prevOpts.length > 1
      ? ctl(
          'Предходна година',
          's15-g1-l',
          seg({
            name: 's15-g1',
            label: 'Предходна година',
            value: String(C.g1),
            query: 'g1',
            cls: 's15-seg',
            options: prevOpts,
          }),
        )
      : '',
    field({
      id: 's15-obhvat',
      label: 'Обхват',
      control: selectInput({
        id: 's15-obhvat',
        name: 'obhvat',
        value: C.scope,
        options: SCOPES.map(([value, label]) => ({ value, label })),
        query: 'obhvat',
      }),
    }),
  ];
  return html`<div class="s15-controls" role="group" aria-label="Какво да сравним"><div class="s15-controls-main">${primary}</div><div class="s15-controls-more">${second}</div></div>`;
}

/** what is shown now, in plain words: the period, cumulative or the month alone, the earlier year, the scope */
export function selectionText(C) {
  if (C.problem) return '';
  const mon = monthName(C.month),
    mesec = C.mode === 'mesec';
  return [
    `${mesec ? 'През' : 'Към края на'} ${mon} ${C.g2}`,
    mesec ? 'за месеца' : 'натрупано',
    `спрямо ${C.g1}`,
    SCOPE_NAME[C.scope],
  ].join(' · ');
}

/** the four controls folded into one disclosure under the heading; open when the address carries a choice (a shared link never hides the choice that made it) or the choice is unusable */
export function controlsDisclosure(C) {
  const ctx = C.ctx;
  const back =
    !C.problem && C.month !== C.defMonth
      ? html`<p class="s15-latest"><a href="${ctx.href('S15', {}, keepQuery(ctx, { mesec: null }))}">Последен отчет (${monthName(C.defMonth)} ${C.g2})</a></p>`
      : '';
  return disclosure({
    id: 's15-controls',
    cls: 's15-chooser',
    title: 'Избери месец и сравнение',
    meta: selectionText(C),
    open: !!C.problem || hasControlParams(ctx.query),
    body: html`${back}${controls(C)}`,
  });
}

/** g1 = g2, or a year the file does not have: say so and offer the default comparison */
function problemFrame(C) {
  const ctx = C.ctx;
  const href = ctx.href('S15', {}, keepQuery(ctx, { g1: null, g2: null, mesec: null }));
  const action = { href, label: 'Към сравнението по подразбиране' };
  if (C.problem === 'same')
    return emptyState({
      title: 'Избрана е една и съща година',
      text: `И двете години са ${C.g1} г. Избери две различни години, за да видиш разликите.`,
      action,
    });
  return emptyState({
    title: `Няма данни за ${joinBg(C.bad.map(yearWord))}`,
    text: `Има месечни отчети за ${joinBg(C.years)} г. Избери година от тях.`,
    action,
  });
}

/** what every shared picture and link of this screen says: both years, the period, the mode, the scope (and the item) — written out, so the link opens the same result tomorrow */
const linkOf = (C, item) => ({
  mesec: C.month,
  g1: C.g1,
  g2: C.g2,
  obhvat: C.scope,
  rez: C.mode,
  pokazatel: item || null,
});
const periodOf = (C) => `${monthsLabel(C)} · ${C.g1} и ${C.g2} г.`;

/* ------------------------------------------------------------------ the comparison grid */
function levLine(v) {
  const l = levOf(v);
  return l ? html`<span class="s15-lev">${l}</span>` : '';
}

function valueCell(C, y, id, v) {
  if (fin(v))
    return html`<span class="s15-n">${B(v)}</span>${levLine(v)}${id === 'balance' ? html`<span class="s15-sub">${balanceWord(v)}</span>` : ''}`;
  const n = y === C.g1 ? C.n1 : C.n2;
  return html`<span class="muted" aria-hidden="true">${DASH}</span><span class="s15-sub">${C.month > n ? 'няма отчет' : 'няма данни'}</span><span class="sr-only">${C.month > n ? 'няма отчет за този месец' : 'няма данни'}</span>`;
}

function balanceNote(a, b) {
  if (!fin(a) || !fin(b)) return '';
  if (a < 0 && b < 0)
    return b < a ? 'дефицитът е по-голям' : b > a ? 'дефицитът е по-малък' : 'същият дефицит';
  if (a >= 0 && b >= 0)
    return b > a ? 'излишъкът е по-голям' : b < a ? 'излишъкът е по-малък' : 'същият излишък';
  return b < 0 ? 'от излишък към дефицит' : 'от дефицит към излишък';
}

/** the second line of a difference: the percent change on a positive base, or what happened to a balance in words */
const chg = (id, a, b) =>
  id === 'balance' ? balanceNote(a, b) : fin(pctChange(a, b)) ? delta(pctChange(a, b), 1) : '';

function diffCell(id, a, b) {
  if (!fin(a) || !fin(b)) return html`<span class="muted">${DASH}</span>`;
  const sub = chg(id, a, b);
  return html`<span class="s15-n">${BS(b - a)}</span>${sub ? html`<span class="s15-sub">${sub}</span>` : ''}`;
}

function rowHtml(C, id, o = {}) {
  const a = C.val(C.g1, id),
    b = C.val(C.g2, id);
  const href = C.ctx.href('S15', {}, keepQuery(C.ctx, { pokazatel: id }));
  const cls = ['s15-row', o.kind ? `s15-row-${o.kind}` : '', id === 'balance' ? 's15-row-bal' : '']
    .filter(Boolean)
    .join(' ');
  const rid = `s15-r-${id.replace(/\./g, '-')}`;
  const dm =
    fin(a) && fin(b)
      ? html`<span class="s15-dm">Разлика: ${BS(b - a)}${NBSP}млрд.${NBSP}€${chg(id, a, b) ? html`, ${chg(id, a, b)}` : ''}</span>`
      : '';
  const name =
    o.kind === 'group'
      ? html`<span class="s15-name"><a class="s15-lnk" href="${href}">${nameOf(C, id)}</a></span>${dm}<button type="button" class="s15-more" data-s15-open="${o.group}" aria-expanded="${o.isOpen ? 'true' : 'false'}" aria-controls="${o.ctrl}"><span class="s15-more-t">По пера</span><span class="s15-chev" aria-hidden="true">${icon('chevronDown', { size: 16 })}</span></button>`
      : html`<span class="s15-name"><a class="s15-lnk" href="${href}">${nameOf(C, id)}</a></span>${dm}`;
  return html`<tr id="${rid}" class="${cls}"${o.hidden ? html` hidden` : ''}${o.group && o.kind !== 'group' ? html` data-s15-g="${o.group}"` : ''}><th scope="row">${name}</th><td>${valueCell(C, C.g1, id, a)}</td><td>${valueCell(C, C.g2, id, b)}</td><td class="s15-d">${diffCell(id, a, b)}</td></tr>`;
}

function gridTable(C) {
  const groups = GROUPS.map((g) => {
    const isOpen = C.open.has(g.id);
    const ids = g.items.map((id) => `s15-r-${id.replace(/\./g, '-')}`).join(' ');
    return html`<tbody class="s15-g" id="s15-g-${g.id}">${rowHtml(C, g.total, { kind: 'group', group: g.id, isOpen, ctrl: ids })}${g.items.map((id) => rowHtml(C, id, { kind: 'item', group: g.id, hidden: !isOpen }))}</tbody>`;
  });
  const tail = html`<tbody class="s15-g">${C.scope !== 'kfp' ? rowHtml(C, 'transfers', { kind: 'total' }) : ''}${rowHtml(C, 'balance', { kind: 'total' })}</tbody>`;
  const th = (y, extra = '') =>
    html`<th scope="col" class="s15-yh"${extra}><span class="s15-y">${y}</span><span class="s15-ysub">${periodTag(C, y)}</span></th>`;
  return html`<div class="s15-grid-wrap table-wrap" id="s15-t-grid-wrap" role="region" aria-labelledby="s15-t-grid-cap" tabindex="0">
    <table class="data s15-grid" id="s15-t-grid"><caption id="s15-t-grid-cap" class="sr-only">Приходи, разходи и салдо: ${C.g1} и ${C.g2} г., ${monthsLabel(C)}, ${modeWord(C)}, ${SCOPE_NAME[C.scope]}, млрд. евро</caption>
      <thead><tr><th scope="col" class="s15-h0">Показател</th>${th(C.g1)}${th(C.g2)}<th scope="col" class="s15-yh s15-dh"><span class="s15-y">Разлика</span><span class="s15-ysub">${C.g2} спрямо ${C.g1}</span></th></tr></thead>
      ${groups}${tail}
    </table></div>`;
}

function csvTable(C) {
  const rows = [];
  for (const id of ALL_ROWS) {
    if (C.scope === 'kfp' && id === 'transfers') continue;
    const a = C.val(C.g1, id),
      b = C.val(C.g2, id);
    const r = (n) => (fin(n) ? Math.round((n / 1000) * 1000) / 1000 : null);
    rows.push([
      nameOf(C, id),
      r(a),
      r(b),
      fin(a) && fin(b) ? r(b - a) : null,
      ((v) => (fin(v) ? Math.round(v * 100) / 100 : null))(pctChange(a, b)),
    ]);
  }
  return {
    columns: [
      'Показател',
      `${C.g1} г., млрд. €`,
      `${C.g2} г., млрд. €`,
      'Разлика, млрд. €',
      'Промяна, %',
    ],
    rows,
  };
}

export function compareBlock(C) {
  const mon = monthName(C.month);
  const asOf = [C.asOfOf(C.g1), C.asOfOf(C.g2)].filter(Boolean).sort().pop();
  const note = [
    C.mode === 'mesec'
      ? `„За месеца“ е изчислено от месечните отчети: разлика между отчета към края на ${mon} и този за предходния месец (за януари – първият отчет).`
      : '',
    C.scope !== 'kfp'
      ? 'Салдото е приходи минус разходи плюс нетните трансфери между националния бюджет и средствата от ЕС.'
      : '',
    'Вноската в ЕС е отделен ред и не се брои два пъти. Без процент, когато основата е нула или под нулата.',
  ]
    .filter(Boolean)
    .join(' ');
  share.attach('s15-b-grid', { table: () => csvTable(C) });
  return block({
    id: 's15-b-grid',
    level: 2,
    cls: 's15-cmp',
    scope: C.scope,
    source: ['kfp'],
    asOf,
    title: `Приходи и разходи: ${C.g1} и ${C.g2} г.`,
    sub: `${cap1(monthsLabel(C))}, ${modeWord(C)}, ${SCOPE_NAME[C.scope]}, млрд. €.`,
    share: {
      text: summaryText(C),
      table: () => csvTable(C),
      link: linkOf(C),
      period: `${periodOf(C)} · млрд. €`,
    },
    body: html`${gridTable(C)}${summaryText(C) ? html`<p class="s15-words"><strong>Накратко.</strong> ${summaryText(C)}</p>` : ''}<p class="table-note small muted">${note}</p>`,
  });
}

/* ------------------------------------------------------------------ the plan: three bars (приходи, разходи, капиталови разходи), the latest report against the annual plan
   The block itself (model, rows, text) lives in js/ui/plan.js: the start page (S01) shows the very same block (working-group feedback, 2026-10-10). */
/** open decision (the working group asks for the plan block first on arrival; UX V2 §7 says „% от плана е вторичен блок, не води основното сравнение“): false = under the comparison */
const PLAN_FIRST = false;

/* ------------------------------------------------------------------ charts: both years, direct labels, a legend; also the embeds */
function seriesData(C, row) {
  const ks = Array.from({ length: C.month }, (_, k) => k);
  return {
    A: ks.map((k) => mlrd(C.val(C.g1, row, k))),
    B: ks.map((k) => mlrd(C.val(C.g2, row, k))),
  };
}

export function monthsSpec(C, row, o = {}) {
  const { A, B: Bv } = seriesData(C, row);
  const natr = C.mode !== 'mesec';
  const label = o.label || nameOf(C, row);
  const bar = o.bar || !natr;
  const nonneg = [...A, ...Bv].filter(fin).every((v) => v >= 0);
  const k = (() => {
    for (let j = C.month - 1; j >= 0; j--) if (fin(A[j]) && fin(Bv[j])) return j;
    return -1;
  })();
  const when = natr ? 'към края на' : 'през';
  const shown = (v) => `${num(v, 2)}${NBSP}млрд.${NBSP}€`;
  const desc =
    k < 0
      ? `${label} по месеци за ${C.g1} и ${C.g2} г.`
      : `${cap1(when)} ${monthName(k + 1)} ${C.g2} г.: ${shown(Bv[k])}, при ${shown(A[k])} ${when} ${monthName(k + 1)} ${C.g1} г.`;
  const colour =
    o.color ||
    (row === 'rev' || row.startsWith('rev.')
      ? '--rev'
      : row === 'balance'
        ? '--series-3'
        : '--exp');
  return {
    id: o.id || `s15-m-${row.replace(/\./g, '-')}`,
    type: bar ? 'bar' : 'line',
    title: o.title || `${label}: ${C.g1} и ${C.g2} г.`,
    categoryLabel: 'Месец',
    categories: MONTH_CATS.slice(0, C.month),
    sub: `млрд. €, ${natr ? 'натрупано от началото на годината' : 'само за месеца'}, ${SCOPE_NAME[C.scope]}`,
    unit: 'млрд. €',
    d: 2,
    min: nonneg && !bar ? 0 : undefined,
    endLabels: !bar,
    desc,
    series: [
      { name: String(C.g1), data: A, color: 'other', dashed: true },
      { name: String(C.g2), data: Bv, color: colour },
    ],
    table: {
      columns: [
        { key: 'm', label: 'Месец' },
        { key: 'a', label: `${C.g1} г.`, unit: 'млрд. €', d: 2, num: true },
        { key: 'b', label: `${C.g2} г.`, unit: 'млрд. €', d: 2, num: true },
        { key: 'd', label: 'Разлика', unit: 'млрд. €', d: 2, num: true },
      ],
      rows: MONTH_CATS.slice(0, C.month).map((_, j) => ({
        m: cap1(monthName(j + 1)),
        a: A[j],
        b: Bv[j],
        d: fin(A[j]) && fin(Bv[j]) ? Math.round((Bv[j] - A[j]) * 1000) / 1000 : null,
      })),
    },
  };
}

function chartBlock(C, spec, o) {
  const has = spec.series.some((s) => (s.data || []).some(fin));
  return block({
    id: o.id,
    level: 2,
    title: o.title,
    sub: o.sub,
    scope: C.scope,
    source: ['kfp'],
    asOf: [C.asOfOf(C.g1), C.asOfOf(C.g2)].filter(Boolean).sort().pop(),
    cls: 's15-chart',
    share: has ? { embed: spec.id, text: spec.desc, link: linkOf(C), period: periodOf(C) } : false,
    body: has
      ? chart(spec)
      : emptyState({
          title: 'Няма данни за графиката',
          text: 'За избрания обхват и месец отчетът няма стойности за тази графика.',
        }),
  });
}

export function chartsView(C) {
  const natr = C.mode !== 'mesec';
  const how = natr
    ? 'Натрупано от началото на годината.'
    : 'Всеки стълб е един месец, не е натрупан.';
  return html`<div class="s15-pair">${[
    chartBlock(C, monthsSpec(C, 'rev', { id: 's15-ch-rev' }), {
      id: 's15-b-ch-rev',
      title: 'Приходи по месеци',
      sub: how,
    }),
    chartBlock(C, monthsSpec(C, 'exp.total', { id: 's15-ch-exp' }), {
      id: 's15-b-ch-exp',
      title: 'Разходи по месеци',
      sub: how,
    }),
  ]}</div>
  ${chartBlock(C, monthsSpec(C, 'balance', { id: 's15-ch-bal', bar: true, title: 'Салдо по месеци' }), { id: 's15-b-ch-bal', title: 'Салдо по месеци', sub: 'Под нулата е дефицит.' })}`;
}

/* ------------------------------------------------------------------ one item in full (a row of the grid) */
function itemView(C) {
  const id = C.item;
  const ctx = C.ctx;
  const back = ctx.href(
    'S15',
    {},
    keepQuery(ctx, { pokazatel: null, to: `s15-r-${id.replace(/\./g, '-')}` }),
  );
  const spec = monthsSpec(C, id, {
    id: `s15-i-${id.replace(/\./g, '-')}`,
    title: `${nameOf(C, id)}: ${C.g1} и ${C.g2} г.`,
  });
  const a = C.val(C.g1, id),
    b = C.val(C.g2, id);
  return html`<p class="s15-back"><a class="back-link" href="${back}">${icon('arrowLeft', { size: 16 })}<span>Към сравнението</span></a></p>
    ${block({
      id: 's15-b-item',
      level: 2,
      title: nameOf(C, id),
      scope: C.scope,
      source: ['kfp'],
      asOf: C.asOfOf(C.g2),
      cls: 's15-chart',
      sub: `${cap1(monthsLabel(C))}, ${modeWord(C)}, ${SCOPE_NAME[C.scope]}.`,
      share: {
        embed: spec.id,
        text: `${nameOf(C, id)}: ${C.g1} г. ${B(a)} млрд. €, ${C.g2} г. ${B(b)} млрд. €.`,
        link: linkOf(C, id),
        period: periodOf(C),
      },
      body: chart(spec),
    })}`;
}

/* ------------------------------------------------------------------ for experts: every row in млн. € (cumulative and for the month) */
function expertBlock(C) {
  const mc = moneyCol(C.ctx, { d: 1 });
  const rows = ALL_ROWS.filter((id) => !(C.scope === 'kfp' && id === 'transfers')).map((id) => {
    const g = (k) => ({ cum: C.cum(k, id), mon: C.mon(k, id) });
    const A = g(C.g1),
      Bv = g(C.g2);
    const r = (v) => (fin(v) ? Math.round(v * 10) / 10 : null);
    return {
      name: nameOf(C, id),
      a_cum: r(A.cum),
      b_cum: r(Bv.cum),
      a_mon: r(A.mon),
      b_mon: r(Bv.mon),
      d_cum: fin(A.cum) && fin(Bv.cum) ? r(Bv.cum - A.cum) : null,
      d_mon: fin(A.mon) && fin(Bv.mon) ? r(Bv.mon - A.mon) : null,
    };
  });
  const col = (key, label) => ({
    key,
    label,
    num: true,
    unit: mc.unit === '€ на човек' ? 'млн. €' : 'млн. €',
    d: 1,
  });
  return disclosure({
    id: 's15-expert',
    title: 'Таблица за експерти (млн. €)',
    body: html`<p class="small muted">Натрупаните стойности са самите месечни отчети; „за месеца“ е разликата между два последователни отчета. Сортира се по колона.</p>${dataTable(
      {
        id: 's15-t-expert',
        caption: `Месечни отчети на КФП: ${C.g1} и ${C.g2} г., към края на ${monthName(C.month)}, ${SCOPE_NAME[C.scope]}`,
        dense: true,
        sortable: true,
        columns: [
          { key: 'name', label: 'Ред на отчета', sort: false },
          col('a_cum', `${C.g1}, натрупано`),
          col('b_cum', `${C.g2}, натрупано`),
          col('d_cum', 'Разлика, натрупано'),
          col('a_mon', `${C.g1}, за месеца`),
          col('b_mon', `${C.g2}, за месеца`),
          col('d_mon', 'Разлика, за месеца'),
        ],
        rows,
      },
    )}`,
  });
}

/* ------------------------------------------------------------------ how the numbers are made */
export function methodDisclosure(C) {
  const conv = C.years.filter((y) => C.ex.data[String(y)] && C.ex.data[String(y)].converted);
  const dec = C.ex.reconcile && C.ex.reconcile.dec2024VsAnnex3;
  return disclosure({
    id: 's15-method',
    title: 'Как се смятат числата',
    body: html`<ul class="s15-method">
      <li>Източник са месечните отчети на Министерството на финансите за консолидираната фискална програма (КФП). Те са на ${gl('kasova-osnova', 'касова основа')}: отчита се кога парите са влезли или излезли.</li>
      <li>„Натрупано“ е от началото на годината до края на избрания месец. „За месеца“ е разликата между два последователни натрупани отчета.</li>
      <li>Разходите включват вноската в бюджета на ЕС. Тя е отделен ред и не се брои два пъти.</li>
      <li>Салдото е дефицит (под нулата) или излишък. За националния бюджет и средствата от ЕС към приходите и разходите се добавят нетните трансфери между тях; в КФП те се нулират.</li>
      ${conv.length ? html`<li>Отчетите за ${joinBg(conv)} г. са били в лева. Превърнали сме ги в евро по фиксирания курс ${num(EUR_RATE, 5)} лв. за 1 €.</li>` : ''}
      ${dec ? html`<li>Декемврийският месечен отчет за 2024 г. се различава малко от Приложение 3 към Закона за 2026 г. (например приходите с 8,2 млн. €); показваме отчета.</li>` : ''}
      <li>Процентите се смятат от точните числа, не от закръглените. Процент не се смята, когато числото за по-ранната година е нула или под нулата.</li>
      <li>Сравняваме със същия период на предходната година.</li>
    </ul>`,
  });
}

/* ------------------------------------------------------------------ where the numbers come from (execution-provenance.json) and which release */
// docs/approach-specification.md, sections 6.2 and 7.3: every number on the screen leads to the cell of the original report it was read from,
// and the screen names the release it shows. The two reports of the comparison, their files and SHA-256, the column of the scope and the
// cells of the three headline rows; the release ID from data/releases/current.json, with the manifest and the command that reproduces it.
const PROOF_ROWS = [
  ['rev', 'приходите'],
  ['exp.total', 'разходите с вноската в ЕС'],
  ['balance', 'салдото'],
];
export function proofDisclosure(ctx, C) {
  const p = ctx.data['execution-provenance'];
  const col = p && p.columns && p.columns[C.scope];
  if (!p || !p.originals || !col) return '';
  const cell = (rid) =>
    p.rows[rid]
      ? col + p.rows[rid]
      : (p.computed?.[rid]?.from || []).map((r) => col + p.rows[r]).join(' + ');
  const mm = String(C.month).padStart(2, '0');
  const reports = [...new Set([C.g1, C.g2])]
    .map((y) => ({ y, o: p.originals[`${y}-${mm}`] }))
    .filter((r) => r.o);
  if (!reports.length) return '';
  const rel = ctx.data['releases/current'];
  const rid = rel && /^[0-9a-f]{64}$/.test(rel.release_id || '') ? rel.release_id : '';
  return disclosure({
    id: 's15-proof',
    title: 'Откъде са числата',
    body: html`<p>Всяко число тук е клетка от месечния отчет на МФ, лист „${p.sheet}“, колона ${col} (${SCOPE_NAME[C.scope] || C.scope}). Например ${PROOF_ROWS.map(([rid, label], i) => html`${i ? (i === PROOF_ROWS.length - 1 ? ' и ' : ', ') : ''}${label}: ${cell(rid)}`)}. „За месеца“ е разликата с отчета за предходния месец.</p>
      <ul class="s15-proof">${reports.map((r) => html`<li>${r.y}: отчетът към ${date(r.o.asOf, true)}${NBSP}г., файл <code>${r.o.file}</code>${r.o.unit === 'BGN' ? ' (в лева, превърнат в евро)' : ''}, SHA-256 <code class="s15-sha">${r.o.sha256}</code></li>`)}</ul>
      ${rid ? html`<p>Издание на данните <code>${rid.slice(0, 12)}</code>: <a href="data/${rel.manifest.split('data/').pop()}">манифест</a> (оригинали, код, среда и SHA-256 на всеки файл) и <a href="${dataHref('execution-provenance')}">произход на всяко число</a> (JSON). Всеки може да го сглоби отново от оригиналите: <code class="s15-cmd">./budget reproduce --current ${siteUrl('/').replace(/\/$/, '')}</code>. Всичко за изданието: <a href="${ctx.href('proverka')}">„Данни и проверка“</a>.</p>` : ''}`,
  });
}

/* ------------------------------------------------------------------ Бюджети: the plan of every budget (D07), the national budget and the EU funds */
const khilToMln = (v) => (fin(v) ? v / 1000 : null);
const moneyCell = (mc, mln) => {
  const lev = mc.lev(mln);
  return html`${mc.text(mln)}${lev ? html`<span class="s15-lev">${lev}</span>` : ''}`;
};
const componentsOf = (ctx) => {
  const c = ctx.data.components;
  return c && typeof c === 'object' && c.budgets && typeof c.budgets === 'object' ? c : null;
};
const srcOf = (c) =>
  c && c.meta && Array.isArray(c.meta.source) && c.meta.source.length
    ? c.meta.source
    : ['zdb', 'asbp'];

function budgetRows(ctx, c) {
  const b = c.budgets,
    k = khilToMln;
  const a = (v) => amount(ctx, { mln: v });
  const line = (list, id) =>
    Array.isArray(list) ? (list.find((x) => x && x.id === id) || {}).khil : null;
  const rows = [];
  const s = b.state;
  if (s && fin(s.revKhil)) {
    const out =
      fin(s.expKhil) && fin(s.transfersNetKhil) && fin(s.euContributionKhil)
        ? s.expKhil + s.transfersNetKhil + s.euContributionKhil
        : null;
    const parts = fin(out)
      ? `Разходите са сбор от ${a(k(s.expKhil))} собствени разходи, ${a(k(s.transfersNetKhil))} нетни трансфери към другите бюджети и ${a(k(s.euContributionKhil))} вноска в бюджета на ЕС.`
      : '';
    const fin2 = fin(s.financingKhil)
      ? ` За покриване на дефицита е предвидено финансиране ${a(k(s.financingKhil))}.`
      : '';
    rows.push({
      id: 'state',
      name: s.name || 'Държавен бюджет',
      what: `${parts}${fin2}`.trim(),
      rev: k(s.revKhil),
      exp: k(out),
      bal: k(s.balanceKhil),
    });
  }
  const d = b.doo;
  if (d && fin(d.revAndTransfersKhil)) {
    const pen = line(d.exp, 'pensions'),
      gap = line(d.rev, 'transfersShortage');
    const what = [
      fin(d.ownRevKhil) && fin(d.transfersFromCentralKhil)
        ? `Собствени приходи ${a(k(d.ownRevKhil))} и трансфери от държавния бюджет ${a(k(d.transfersFromCentralKhil))}.`
        : '',
      fin(pen) ? `Най-голям разход са пенсиите: ${a(k(pen))}.` : '',
      fin(gap)
        ? `Салдото е нула: недостигът се покрива с допълнителен трансфер от държавния бюджет (${a(k(gap))}).`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    rows.push({
      id: 'doo',
      name: d.name || 'ДОО',
      what,
      rev: k(d.revAndTransfersKhil),
      exp: k(d.expAndTransfersKhil),
      bal: k(d.balanceKhil),
    });
  }
  const n = b.nzok;
  if (n && fin(n.revAndTransfersKhil)) {
    const pay = line(n.exp, 'payments');
    const what = [
      fin(n.ownRevKhil) && fin(n.transfersFromStateKhil)
        ? `Собствени приходи ${a(k(n.ownRevKhil))} и трансфери от държавния бюджет ${a(k(n.transfersFromStateKhil))}.`
        : '',
      fin(pay) ? `Най-голям разход са здравноосигурителните плащания: ${a(k(pay))}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    rows.push({
      id: 'nzok',
      name: n.name || 'НЗОК',
      what,
      rev: k(n.revAndTransfersKhil),
      exp: k(n.expAndTransfersKhil),
      bal: k(n.balanceKhil),
    });
  }
  const m = b.municipalities;
  if (m && fin(m.expMln)) {
    const main =
      m.transfers && Array.isArray(m.transfers.mainKhil) ? m.transfers.mainKhil[0] : null;
    const what = [
      fin(m.count) ? `Разходите на ${m.count} общини.` : '',
      fin(main) ? `${a(k(main))} от тях идват като основни трансфери от държавния бюджет.` : '',
      'Собствените приходи на общините (местни данъци и такси) не са показани тук.',
    ]
      .filter(Boolean)
      .join(' ');
    rows.push({
      id: 'municipalities',
      name: m.name || 'Общини',
      what,
      rev: null,
      exp: m.expMln,
      bal: null,
    });
  }
  const e = b.euAccounts;
  if (e && fin(e.revMln)) {
    const what = fin(e.transferFromStateMln)
      ? `Нетният трансфер от държавния бюджет е ${a(e.transferFromStateMln)}. Числата са по мотивите към законопроекта.`
      : 'Числата са по мотивите към законопроекта.';
    rows.push({
      id: 'eu',
      name: e.name || 'Сметки за средства от ЕС',
      what,
      rev: e.revMln,
      exp: e.expMln,
      bal: e.balanceMln,
    });
  }
  return rows;
}

function budgetsBlock(ctx) {
  const c = componentsOf(ctx);
  if (!c) return '';
  const rows0 = budgetRows(ctx, c);
  if (!rows0.length) return '';
  const mc = moneyCol(ctx, { d: 1 });
  const rows = rows0.map((r) => ({
    ...r,
    mr: r.rev,
    me: r.exp,
    mb: r.bal,
    rev: mc.raw(r.rev),
    exp: mc.raw(r.exp),
    bal: mc.raw(r.bal),
  }));
  const col = (key, label, f) => ({
    key,
    label,
    num: true,
    unit: mc.unit,
    d: mc.d,
    fmt: (_v, r) => moneyCell(mc, r[f]),
  });
  const withWhat = rows.filter((r) => r.what);
  return block({
    id: 's15-b-budgets',
    level: 2,
    title: 'Планът за всеки от бюджетите',
    sub: 'Планът за 2026 г. (проект).',
    scope: 'kfp',
    source: srcOf(c),
    asOf: c.meta && c.meta.asOf,
    share: { text: 'Планът за 2026 г. по бюджети: приходи, разходи и салдо.' },
    body: html`${dataTable({
      id: 's15-t-budgets',
      caption: 'План за 2026 г. по съставни бюджети: приходи, разходи и салдо',
      columns: [
        { key: 'name', label: 'Бюджет' },
        col('rev', 'Приходи и получени трансфери', 'mr'),
        col('exp', 'Разходи и дадени трансфери', 'me'),
        col('bal', 'Салдо', 'mb'),
      ],
      rows,
      dense: true,
      note: 'Не събирайте числата по редовете: бюджетите си предават пари един на друг (трансфери). Консолидираната програма (КФП) изважда тези трансфери, за да не се броят два пъти.',
    })}
    ${withWhat.length ? html`<h3 class="s15-minor">Какво влиза в числата</h3><dl class="s15-defs">${withWhat.map((r) => html`<dt>${r.name}</dt><dd>${r.what}</dd>`)}</dl>` : ''}`,
  });
}

function otherDisclosure(ctx, c) {
  const o = c.budgets.other;
  if (!o || !Array.isArray(o.items) || !o.items.length) return '';
  const years = Array.isArray(o.years) ? o.years : [2026, 2027, 2028];
  const mc = moneyCol(ctx, { d: 1 });
  const yearLabel = (y, i) => `${y} г.${i === 0 ? ' (проект)' : ' (прогноза)'}`;
  const at = (arr, i) => (Array.isArray(arr) ? khilToMln(arr[i]) : null);
  const rows = o.items.map((it) => ({
    name: it.label,
    ...Object.fromEntries(years.map((_y, i) => [`y${i}`, mc.raw(at(it.khil, i))])),
    ...Object.fromEntries(years.map((_y, i) => [`m${i}`, at(it.khil, i)])),
  }));
  const totals = Object.fromEntries(
    years.flatMap((_y, i) => [
      [`y${i}`, mc.raw(at(o.sumKhil, i))],
      [`m${i}`, at(o.sumKhil, i)],
    ]),
  );
  const cols = years.map((y, i) => ({
    key: `y${i}`,
    label: yearLabel(y, i),
    num: true,
    unit: mc.unit,
    d: mc.d,
    fmt: (_v, r) => mc.text(r[`m${i}`]),
  }));
  return disclosure({
    id: 's15-other',
    title: 'Бюджети на БНТ, БНР, БТА, БАН и държавните университети',
    body: html`<p class="s15-lead">Приложение № 6 към мотивите към законопроекта изброява трансфери към тези бюджети. Член 1 от закона не ги назовава, затова не твърдим, че те са цялата сума в „Други получатели“.</p>
      ${dataTable({ id: 's15-t-other', caption: 'Трансфери към други бюджети по приложение № 6 към мотивите', columns: [{ key: 'name', label: 'Бюджет' }, ...cols], rows, total: { label: 'Общо', values: totals }, dense: true, note: o.sourceNote ? `Източник на числата: ${o.sourceNote}.` : undefined })}`,
  });
}

function notesDisclosure(c) {
  const notes = Array.isArray(c.notes)
    ? c.notes.filter((x) => typeof x === 'string' && x.trim())
    : [];
  const b = c.budgets;
  const srcs = ['state', 'doo', 'nzok', 'municipalities', 'euAccounts', 'other']
    .map((k) => b[k])
    .filter((x) => x && x.sourceNote)
    .map((x) => `${x.name}: ${x.sourceNote}`);
  if (!notes.length && !srcs.length) return '';
  return disclosure({
    id: 's15-notes',
    title: 'Бележки към числата и откъде са те',
    body: html`${notes.length ? html`<ul class="s15-method">${notes.map((t) => html`<li>${t}</li>`)}</ul>` : ''}
      ${srcs.length ? html`<h3 class="s15-minor">Откъде са числата за всеки бюджет</h3><ul class="s15-method">${srcs.map((t) => html`<li>${t}</li>`)}</ul>` : ''}`,
  });
}

/** the national budget and the EU funds side by side with the КФП, at the chosen month: the three sources of the balance I − II + III − IV */
function natEuBlock(C) {
  const mc = moneyCol(C.ctx, { d: 1 });
  const lines = [
    ['rev', 'Приходи'],
    ['exp.total', 'Разходи с вноската в ЕС'],
    ['transfers', 'Трансфери между бюджетите, нето'],
    ['balance', 'Бюджетно салдо'],
  ];
  const i = C.month - 1;
  const rows = lines.map(([id, name]) => {
    const r = { name };
    for (const [sc] of SCOPES) {
      const c = C.cum(C.g2, id, i, sc);
      r[`m_${sc}`] = c;
      r[sc] = mc.raw(c);
    }
    return r;
  });
  const col = (sc, label) => ({
    key: sc,
    label,
    num: true,
    unit: mc.unit,
    d: mc.d,
    fmt: (_v, r) => moneyCell(mc, r[`m_${sc}`]),
  });
  const has = rows.some((r) => fin(r.m_nat) || fin(r.m_eu));
  const asOf = C.asOfOf(C.g2, i);
  return block({
    id: 's15-b-nateu',
    level: 2,
    title: 'Национален бюджет и средства от ЕС',
    source: ['kfp'],
    asOf,
    sub: `Натрупано към ${date(asOf)} г. Салдото е приходи минус разходи плюс нетните трансфери.`,
    share: has ? { text: `Национален бюджет и средства от ЕС към ${date(asOf)} г.` } : false,
    body: has
      ? dataTable({
          id: 's15-t-nateu',
          caption: `Национален бюджет, средства от ЕС и КФП към ${date(asOf)} г.`,
          columns: [
            { key: 'name', label: 'Показател' },
            col('nat', 'Национален бюджет'),
            col('eu', 'Средства от ЕС'),
            col('kfp', 'КФП (общо)'),
          ],
          rows,
          dense: true,
          note: 'Трансферите между националния бюджет и средствата от ЕС са равни по размер и с противоположен знак, затова в КФП се нулират. Приходите, разходите и салдото на КФП са сборът от двата обхвата.',
        })
      : emptyState({ title: 'Няма данни', text: 'Отчетът няма стойности за избрания месец.' }),
  });
}

export function byudzhetiView(C) {
  const c = componentsOf(C.ctx);
  const back = C.ctx.href('S15', {}, keepQuery(C.ctx));
  const intro = html`<div class="s15-lead"><p>В ${gl('kfp', 'консолидираната фискална програма (КФП)')} се събират няколко отделни бюджета: държавният бюджет, държавното обществено осигуряване (ДОО), здравната каса (НЗОК), общините и средствата от ЕС. Тук е планът за 2026 г. (проект) и изпълнението по националния бюджет и средствата от ЕС.</p></div>`;
  return html`<p class="s15-back"><a class="back-link" href="${back}">${icon('arrowLeft', { size: 16 })}<span>Към месечните отчети</span></a></p>${[
    intro,
    budgetsBlock(C.ctx),
    c ? otherDisclosure(C.ctx, c) : '',
    natEuBlock(C),
    c ? notesDisclosure(c) : '',
  ]}`;
}

/* ------------------------------------------------------------------ the page */
export const needs = [
  'core',
  'execution',
  'components?',
  'execution-provenance?',
  'releases/current?',
];
export const styles = ['s15-izpalnenie'];

/** for search and answer engines (js/seo.js): the plan question of the start page and the „Накратко“ sentence under the comparison */
export function question(ctx) {
  return ctx.data?.execution && model(ctx).page === 'main'
    ? 'Изпълнява ли се бюджетът за 2026 г.?'
    : '';
}
export function answer(ctx) {
  if (!ctx.data?.execution) return '';
  const C = model(ctx);
  return C.page === 'main' ? summaryText(C) || '' : '';
}
export function docTitle(ctx) {
  return ctx.data?.execution && model(ctx).page === 'byudzheti'
    ? 'Месечни отчети по бюджети'
    : null;
}

export function lede(ctx) {
  try {
    if (!ctx.data || !ctx.data.execution) return undefined;
    const C = model(ctx);
    if (C.page === 'byudzheti')
      return 'Планът за 2026 г. по бюджети и изпълнението на националния бюджет и средствата от ЕС.';
    if (C.page === 'item') return undefined;
    return reportLine(C); // the comparison follows at once; the sentence in words sits under the grid
  } catch (e) {
    return undefined;
  }
}

/** the one line under the heading: which report the numbers are from (the date is the file's own as-of date); «Последен» only while the page shows the newest report */
export function reportLine(C) {
  if (C.problem || C.missing.includes(C.g2)) return '';
  const iso = C.asOfOf(C.g2);
  if (!iso) return '';
  return `${C.g2 === C.lastY && C.month === C.n2 ? 'Последен отчет' : 'Отчет'}: към ${date(iso, true)}${NBSP}г.`;
}

const embedOf = (row, o) => (ctx) => {
  if (!ctx.data || !ctx.data.execution) return null;
  const C = model(ctx);
  if (C.problem) return null;
  const spec = monthsSpec(C, row, o);
  return spec.series.some((s) => (s.data || []).some(fin))
    ? {
        chart: spec,
        source: ['kfp'],
        asOf: [C.asOfOf(C.g1), C.asOfOf(C.g2)].filter(Boolean).sort().pop(),
        status: 'real',
      }
    : null;
};

export const embeds = {
  's15-ch-rev': embedOf('rev', { id: 's15-ch-rev' }),
  's15-ch-exp': embedOf('exp.total', { id: 's15-ch-exp' }),
  's15-ch-bal': embedOf('balance', { id: 's15-ch-bal', bar: true, title: 'Салдо по месеци' }),
};

/** one line that says what the numbers are: a report, which years, which scope, which mode, in which unit */
export function contextLine(C) {
  if (C.page === 'byudzheti')
    return html`<span class="ctx-period"><strong>План 2026 (проект)</strong> <span class="muted">· по бюджети · млн. €</span></span>`;
  const when = C.problem ? '' : C.mode === 'mesec' ? `${cap1(monthName(C.month))}` : monthsLabel(C);
  return html`<span class="ctx-period"><strong>Отчет ${when ? `· ${when}` : ''}</strong> <span class="muted">· ${C.g1} и ${C.g2} · ${C.scope === 'kfp' ? 'КФП' : SCOPE_NAME[C.scope]} · ${C.mode === 'mesec' ? 'за месеца' : 'натрупано'} · млрд. €</span></span>`;
}

export function render(ctx) {
  const C = model(ctx);
  let body;
  if (C.page === 'byudzheti') body = byudzhetiView(C);
  else if (C.problem) body = html`${controlsDisclosure(C)}${problemFrame(C)}`;
  else if (C.page === 'item') body = html`${itemView(C)}${methodDisclosure(C)}`;
  else {
    const links = html`<p class="s15-links small"><a href="${ctx.href('S15', { sub: 'byudzheti' }, keepQuery(ctx))}">Планът по бюджети и средствата от ЕС</a></p>`;
    const plan = planBlock(C, { link: linkOf(C) });
    body = html`${controlsDisclosure(C)}${PLAN_FIRST ? plan : ''}${compareBlock(C)}${PLAN_FIRST ? '' : plan}${chartsView(C)}${links}${expertBlock(C)}${methodDisclosure(C)}${proofDisclosure(ctx, C)}`;
  }
  return { body, context: C.page === 'main' && !C.problem ? '' : contextLine(C), ownContext: true }; // the main screen says it in the line under the heading and in the «Избери месец и сравнение» row
}

export function mount(root, ctx) {
  // the „По пера“ buttons open and close the item rows of a group in place; the open groups are kept in the address (?pera=rev,exp)
  const onClick = (e) => {
    const b = e.target.closest('[data-s15-open]');
    if (!b || !root.contains(b)) return;
    const g = b.dataset.s15Open;
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    root.querySelectorAll(`tr[data-s15-g="${g}"]`).forEach((tr) => {
      tr.hidden = !open;
    });
    const now = [...root.querySelectorAll('[data-s15-open][aria-expanded="true"]')].map(
      (x) => x.dataset.s15Open,
    );
    try {
      ctx.setQuery({ pera: now.join(',') || null }, { rerender: false });
    } catch {
      /* the address is a convenience */
    }
    ctx.announce &&
      ctx.announce(open ? 'Показани са редовете по пера.' : 'Редовете по пера са скрити.');
  };
  root.addEventListener('click', onClick);
  // arriving by a link / the back button with a choice in the address: the disclosure shows it, even if the visitor closed it earlier in this visit
  if (ctx.kind !== 'rerender' && hasControlParams(ctx.query)) {
    const d = root.querySelector('#s15-controls');
    if (d && !d.open) d.open = true;
  }
  if (ctx.kind === 'rerender' && ctx.data && ctx.data.execution) {
    const C = model(ctx);
    const t = C.page === 'main' ? summaryText(C) : '';
    if (t) ctx.announce(t);
  }
  return () => root.removeEventListener('click', onClick);
}
