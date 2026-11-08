// S14 · Пътят на бюджета (was «Как се прие бюджетът?», working-group feedback 2026-10-09) · #/zakon · next S15 (route default) · periods come from routes.js
// Order of the blocks, easy to hard, for a visitor who has never seen the procedure: Накратко → Хронология (the path) → Комисии (who read it) → Трите закона →
//   чл. 1 (the main numbers changed) → отделните бюджети → 46-те бюджета → Документи → Следващият бюджет. No new content; the blocks are the same.
// Data, only through `needs`:
//   law          D10+D11 REAL  the bill (01.07.2026) read line by line against the adopted law (ДВ бр. 69 от 31.07.2026 г.): art. 1, the changes by article,
//                              the 46 budgets, the legislative timeline, the counts and the document links of the 69 proposals (their content is pending: P07)
//   ministries?  D08+D09 REAL  optional: the budgets whose programme budget differs from the law, and those whose programmes are still pending (P03)
//   core                       the planned GDP (for „% от БВП“ in the headline numbers)
// One screen, no sub-routes: both versions (bill and law) are always shown side by side, so the period switch changes nothing here.
// Facts and dates only: no names of deputies, no political judgement.
import { html } from '../html.js';
import { num, date, plural, DASH, NBSP } from '../format.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { dataTable } from '../ui/table.js';
import { disclosure } from '../ui/disclosure.js';
import { ext } from '../ui/cards.js';
import { pendingState } from '../ui/states.js';
import { timeline } from '../ui/timeline.js';
import { gl } from '../ui/gl.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';

export const needs = ['core', 'law', 'ministries?'];
export const styles = ['s14-zakon'];

const ok = v => typeof v === 'number' && Number.isFinite(v);
const arr = v => (Array.isArray(v) ? v : []);
/** an amount in thousand euro; zero prints as „0“ (a difference of nothing), a missing value as a dash */
const K = v => (!ok(v) ? DASH : v === 0 ? '0' : num(v, 1));
const SGN = v => (!ok(v) ? DASH : v === 0 ? '0' : num(v, 1, { sign: true }));
const amt = (key, label) => ({ key, label, unit: 'хил. €', num: true, fmt: v => K(v) });
const dif = (key = 'diff', label = 'Разлика') => ({ key, label, unit: 'хил. €', num: true, fmt: v => SGN(v) });
const dl = iso => `${date(iso, true)}${NBSP}г.`;                       // 24 юли 2026 г.
const joinBg = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} и ${a[a.length - 1]}`);
const labelOf = m => (m.name.length > 80 && m.short && m.short !== m.name ? m.short : m.name);
const moved = x => !!x && ok(x.diff) && Math.abs(x.diff) >= 0.05;
const hasLink = h => typeof h === 'string' && /^https?:\/\//.test(h);

const SCOPE1 = { key: 'zdb', label: 'Държавен бюджет', note: 'чл. 1 от закона', gl: 'darzhaven-byudzhet' };
const SCOPE2 = { key: 'zdb-46', label: 'Бюджети по чл. 2–47', note: 'не е целият държавен бюджет' };
const OP = { chg: 'променен', add: 'добавен', del: 'премахнат' };
const LINK = { submitted: 'Законопроектът в Народното събрание', gazette: 'Обнародването в „Държавен вестник“' };
const HEAD = [
  ['rev', 'I. Приходи, помощи и дарения'], ['exp', 'II. Разходи'], ['transfers', 'III. Бюджетни взаимоотношения (трансфери), нето'],
  ['eucontrib', 'IV. Вноска в общия бюджет на Европейския съюз'], ['balance', 'V. Бюджетно салдо'], ['financing', 'VI. Операции в частта на финансирането, нето']
];

const changedCell = (v, changed) => html`${v}${changed ? html` <span class="s14-chg">променен</span>` : ''}`;
const noCell = (v, r) => html`${r.no ? html`<span class="s14-no">${r.no}</span> ` : ''}${v}`;
const lineCell = (v, r) => html`<span class="s14-l s14-l${Math.min(r.level ?? 0, 3)}">${noCell(r.header ? html`<em>${v}</em>` : v, r)}${r.changed ? html` <span class="s14-chg">променен</span>` : ''}</span>`;

/** a headline amount goes through the standard KPI path (it honours „% от БВП“, „на човек“ and „и в лева“) */
const kpiK = (G, o) => {
  const { k, ...rest } = o;
  return ok(k) ? kpi({ ...rest, mln: k / 1000, pctGdp: G.gdpMln ? (k / 1000 / G.gdpMln) * 100 : null }) : kpi({ ...rest, mln: null });
};
const sub = (d, more, less) => (!ok(d) ? 'Няма сравнение с проекта.' : Math.abs(d) < 0.05 ? 'Без промяна спрямо проекта.'
  : `Спрямо проекта: с ${num(Math.abs(d), 1)}${NBSP}хил.${NBSP}€ ${d > 0 ? more : less}.`);
const balSub = b => {
  if (!b || !ok(b.diff)) return 'Няма сравнение с проекта.';
  if (Math.abs(b.diff) < 0.05) return 'Без промяна спрямо проекта.';
  const deficit = ok(b.law) && b.law < 0;
  const word = b.diff > 0 ? (deficit ? 'по-малък дефицит' : 'по-голям излишък') : (deficit ? 'по-голям дефицит' : 'по-малък излишък');
  return `Спрямо проекта: с ${num(Math.abs(b.diff), 1)}${NBSP}хил.${NBSP}€ ${word}.`;
};

function modelOf(ctx) {
  const gdp = ctx.core?.kpis?.gdp;
  return { ctx, L: ctx.data.law, M: ctx.data.ministries ?? null, gdpMln: [gdp?.mlnPrecise, gdp?.mln].find(x => ok(x) && x > 0) ?? null };
}

function head(G) {
  const v = G.L.versions || {}, bill = v.bill || {}, law = v.law || {};
  return {
    lede: `Бюджетът за 2026 г. е внесен в Народното събрание на ${dl(bill.date)} и е приет на ${dl(law.date)} По-долу е пътят му: първо накратко и по дати, после кой го е разглеждал и най-накрая числата, които са се променили между проекта и закона.`,
    context: `Сравнението е между законопроекта от ${dl(bill.date)} (№ ${bill.ref}) и закона, обнародван в „Държавен вестник“ (${law.ref}). И двете версии са показани заедно.`
  };
}

function summary(G) {
  const { L } = G;
  const h = L.art1?.headline || {}, v = L.versions || {}, bill = v.bill || {}, law = v.law || {};
  const kpis = [
    kpiK(G, { label: 'Приходи по закона', k: h.rev?.law, sub: sub(h.rev?.diff, 'повече', 'по-малко'), gl: 'byudzhetni-prihodi' }),
    kpiK(G, { label: 'Разходи по закона', k: h.exp?.law, sub: sub(h.exp?.diff, 'повече', 'по-малко'), gl: 'byudzhetni-razhodi' }),
    kpiK(G, { label: 'Бюджетно салдо по закона', k: h.balance?.law, sub: balSub(h.balance), gl: 'byudzhetno-saldo' }),
    kpi({ label: 'Приет на', value: law.date ? date(law.date) : null, sub: law.ref ? `Обнародван в ${law.ref}` : '' })
  ];
  return block({
    id: 's14-nakratko', title: 'Накратко', status: 'real', source: ['zdb', 'bill'], asOf: L.meta?.asOf, scope: SCOPE1,
    body: html`${kpiGrid(kpis, { label: 'Основни числа на държавния бюджет по закона' })}
      <p class="s14-text">${gl('proektobyudzhet', 'Проектът')} е текстът, внесен в Народното събрание на ${dl(bill.date)} ${gl('priet-byudzhet', 'Законът')} е текстът, приет на ${dl(law.date)} Двата са сравнени ред по ред: по-долу е пътят на бюджета и какво точно е променено.</p>`
  });
}

function whenBlock(G) {
  const { L } = G;
  const all = arr(L.timeline);
  const step = it => {
    const link = hasLink(it.href);
    const bits = [it.detail || '', it.ref ? html`<span class="s14-ref">${it.ref}</span>` : '', link ? html`<span class="s14-links">${ext(it.href, LINK[it.kind] || 'Документ')}</span>` : ''];
    return { date: it.dateText, title: it.title, text: bits.some(Boolean) ? html`${bits}` : '', href: !link && it.href ? it.href : null, kind: 'event' };
  };
  const pre = all.filter(it => it.phase === 'prehistory').map(step);
  const main = all.filter(it => it.phase !== 'prehistory').map(step);
  const meta = `${plural(pre.length, 'събитие', 'събития')}${all.some(it => it.kind === 'extension-law') ? ', сред тях удължителният закон' : ''}`;
  return block({
    id: 's14-hronologiya', title: 'Хронология на бюджета', status: 'real', source: ['parliament', 'asbp', 'zdb'], asOf: L.meta?.asOf,
    body: html`<div class="s14-stack">
      ${pre.length ? disclosure({ id: 's14-predistoriya', title: 'Преди внасянето на законопроекта', meta, body: timeline({ label: 'Преди внасянето на законопроекта', items: pre }) }) : ''}
      ${timeline({ label: 'От внасянето до обнародването и изпълнението', items: main })}
    </div>`
  });
}

function art1Block(G) {
  const { L } = G;
  const a = L.art1 || {}, h = a.headline || {};
  const top = HEAD.filter(([k]) => h[k]).map(([k, what]) => ({ what, bill: h[k].bill, law: h[k].law, diff: h[k].diff, changed: moved(h[k]) }));
  const lines = arr(a.lines).map(l => ({ text: l.text, no: l.no, level: l.level, header: !!l.header, changed: !!l.changed, bill: l.bill ?? null, law: l.law ?? null, diff: l.diff ?? null }));
  const notes = arr(arr(L.changes).find(c => c.art === 1)?.notes);
  return block({
    id: 's14-chl1', title: 'Проект и закон: държавният бюджет (чл. 1)', status: 'real', source: ['zdb', 'bill'], asOf: L.meta?.asOf, scope: { ...SCOPE1, gl: undefined },
    body: html`<p class="s14-text">Член 1 е самият държавен бюджет: колко приходи се очакват, колко се харчат и колко се предават на други бюджети (${gl('byudzheten-transfer', 'трансфери')} към общините, държавното обществено осигуряване и здравната каса). Салдото е приходите минус разходите, трансферите и вноската в бюджета на Европейския съюз.</p>
      ${top.length ? dataTable({
        id: 's14-t-chl1', caption: 'Член 1: проект и закон, основни редове, хил. €',
        columns: [{ key: 'what', label: 'Показател', fmt: (v, r) => changedCell(v, r.changed) }, amt('bill', 'Проект'), amt('law', 'Закон'), dif()], rows: top
      }) : ''}
      ${notes.map(n => html`<p class="s14-text">${n}</p>`)}
      <div class="s14-stack">${lines.length ? disclosure({
        id: 's14-chl1-redove', title: 'Всички редове на чл. 1', meta: `${plural(lines.length, 'ред', 'реда')}, ${num(lines.filter(l => l.changed).length, 0)} променени`,
        body: dataTable({
          id: 's14-t-chl1-redove', caption: 'Всички редове на чл. 1, хил. €',
          columns: [{ key: 'text', label: 'Ред от закона', fmt: lineCell }, amt('bill', 'Проект'), amt('law', 'Закон'), dif()], rows: lines, dense: true
        })
      }) : ''}</div>`
  });
}

const metaOf = c => {
  const h = c.headline || {};
  const parts = [['приходи', h.rev], ['разходи', h.exp]].filter(([, x]) => moved(x)).map(([k, x]) => `${k} ${SGN(x.diff)}${NBSP}хил.${NBSP}€`);
  return parts.length ? parts.join(', ') : 'общите суми не се променят';
};

function changeBody(G, c) {
  const { ctx } = G;
  const lines = arr(c.lines).map(l => ({ text: l.text, no: l.no, op: OP[l.op] || '', bill: l.bill ?? null, law: l.law ?? null, diff: l.diff ?? null }));
  const rows = x => arr(x).map(r => ({ name: r.n ? `${r.n}. ${r.name}` : r.name ?? r.label, bill: r.bill ?? null, law: r.law ?? null, diff: r.diff ?? null }));
  const cmp = (key, caption, first, list, note) => (list.length ? dataTable({
    id: `s14-t-chl${c.art}-${key}`, caption, columns: [{ key: 'name', label: first }, amt('bill', 'Проект'), amt('law', 'Закон'), dif()], rows: list, dense: true, note
  }) : '');
  return html`${arr(c.notes).map(n => html`<p class="s14-text">${n}</p>`)}
    ${lines.length ? dataTable({
      id: `s14-t-chl${c.art}`, caption: `Променени редове в чл. ${c.art}, хил. €`,
      columns: [{ key: 'text', label: 'Ред от закона', fmt: noCell }, { key: 'op', label: 'Промяна' }, amt('bill', 'Проект'), amt('law', 'Закон'), dif()], rows: lines, dense: true
    }) : ''}
    ${cmp('oblasti', `Разпределение по области и политики в чл. ${c.art}, хил. €`, 'Област или политика', rows(c.areas), c.areasNote)}
    ${cmp('organi', `Органи в чл. ${c.art}, хил. €`, 'Орган', rows(c.bodies))}
    ${cmp('angazhimenti', `Ангажименти и нови задължения в чл. ${c.art}, хил. €`, 'Показател', rows(c.commitments))}
    ${/^\d{4}$/.test(String(c.id)) ? html`<p class="s14-note"><a href="${ctx.href('vedomstvo', { code: c.id })}">Бюджетът на ведомството и програмите му</a></p>` : ''}`;
}

function changesBlock(G) {
  const { L } = G;
  const list = arr(L.changes).filter(c => c.art !== 1);
  const rec = L.reconciliation || {};
  const recRows = arr(rec.rows);
  const nBud = arr(L.budgets).filter(b => b.changed).length;
  const flat = list.filter(c => !recRows.some(r => r.art === c.art));
  const arts = joinBg(recRows.map(r => r.art));
  const table = [
    ...recRows.map(r => ({ name: `Чл. ${r.art}: ${r.name}`, rev: r.rev, exp: r.exp, bal: ok(r.rev) && ok(r.exp) ? r.rev - r.exp : null })),
    rec.sum ? { name: `Общо за чл. ${arts}`, rev: rec.sum.rev, exp: rec.sum.exp, bal: rec.sum.balance } : null,
    rec.art1 ? { name: 'Промяна в чл. 1: държавен бюджет', rev: rec.art1.rev, exp: rec.art1.exp, bal: rec.art1.balance } : null
  ].filter(Boolean);
  return block({
    id: 's14-promeni', title: 'Какво е променено в отделните бюджети', status: 'real', source: ['zdb', 'bill'], asOf: L.meta?.asOf, scope: SCOPE2,
    body: html`<p class="s14-text">Между проекта и закона се различават ${num(nBud, 0)} от ${num(L.totals?.count, 0)} бюджета по чл. 2–47: чл. ${joinBg(list.map(c => c.art))}. Отвори ред, за да видиш кои редове са променени.</p>
      <div class="s14-stack">${list.map(c => disclosure({ id: `s14-chl${c.art}`, title: `Чл. ${c.art}: ${c.name}`, meta: metaOf(c), body: changeBody(G, c) }))}</div>
      ${table.length ? dataTable({
        id: 's14-t-sverka', caption: 'Как промените в отделните бюджети дават промяната в чл. 1, хил. €',
        columns: [{ key: 'name', label: 'Промяна по' }, dif('rev', 'Приходи'), dif('exp', 'Разходи'), dif('bal', 'Салдо')], rows: table, dense: true
      }) : ''}
      ${rec.ok ? html`<p class="s14-text">Сборът от промените по чл. ${arts} е равен на промяната в чл. 1.</p>` : ''}
      ${flat.length ? html`<p class="s14-text">Чл. ${joinBg(flat.map(c => c.art))} ${flat.length === 1 ? 'променя' : 'променят'} отделни редове, но не и общите суми, затова ${flat.length === 1 ? 'не участва' : 'не участват'} в тази сметка.</p>` : ''}`
  });
}

function budgetsBlock(G) {
  const { ctx, L, M } = G;
  const t = L.totals || {};
  const rows = arr(L.budgets).map(b => ({ name: labelOf(b), art: b.art, bill: b.bill?.exp ?? null, law: b.law?.exp ?? null, diff: b.diff?.exp ?? null, changed: !!b.changed, _href: ctx.href('vedomstvo', { code: b.id }) }));
  const changed = arr(L.budgets).filter(b => b.changed);
  const pbl = arr(M?.items).filter(m => m.programBudgetVsLaw && ok(m.programBudgetVsLaw.diffKhil) && Math.abs(m.programBudgetVsLaw.diffKhil) >= 0.05);
  const pend = arr(M?.items).filter(m => m.programs?.status === 'pending');
  const prog = pbl.length || pend.length ? disclosure({
    id: 's14-programni', title: 'Програмни бюджети и закон', meta: pbl.length ? plural(pbl.length, 'различие', 'различия') : '',
    body: html`<p class="s14-text">Програмният бюджет на всяко ведомство е отделен документ към законопроекта.${pbl.length ? ` При ${plural(pbl.length, 'ведомство', 'ведомства')} сумата в него се различава от тази в закона.` : ''}</p>
      ${pbl.length ? dataTable({
        id: 's14-t-programni', caption: 'Ведомства, при които програмният бюджет се различава от закона, хил. €',
        columns: [{ key: 'name', label: 'Ведомство' }, amt('prb', 'Програмен бюджет'), amt('law', 'Закон'), dif()],
        rows: pbl.map(m => ({ name: labelOf(m), prb: m.programBudgetVsLaw.prbKhil, law: m.programBudgetVsLaw.lawKhil, diff: m.programBudgetVsLaw.diffKhil, _href: ctx.href('vedomstvo', { code: m.id }) })), dense: true
      }) : ''}
      ${pend.length ? html`<p class="s14-text">За ${plural(pend.length, 'ведомство', 'ведомства')} програмите още не са добавени в тази версия: ${joinBg(pend.map(m => m.name))}.</p>` : ''}`
  }) : '';
  return block({
    id: 's14-bjudzheti', title: `${num(t.count, 0)} бюджета по чл. 2–47`, status: 'real', source: ['zdb', 'bill'], asOf: L.meta?.asOf, scope: SCOPE2,
    body: html`<p class="s14-text">Всеки ред е бюджетът на едно ведомство по закона, сравнен с проекта.${changed.length ? ` Променени са ${num(changed.length, 0)}: чл. ${joinBg(changed.map(b => b.art))}.` : ''} Натисни име, за да видиш ведомството.</p>
      ${rows.length ? dataTable({
        id: 's14-t-bjudzheti', caption: 'Разходи по бюджетите на ведомствата: проект и закон, хил. €',
        columns: [{ key: 'name', label: 'Бюджет', fmt: (v, r) => changedCell(v, r.changed) }, { key: 'art', label: 'Член', num: true, fmt: v => `чл. ${v}` }, amt('bill', 'Разходи по проекта'), amt('law', 'Разходи по закона'), dif()],
        rows, sortable: true, sortBy: 'art', dense: true,
        total: { label: `Общо за ${num(t.count, 0)} бюджета`, values: { bill: t.bill?.exp, law: t.law?.exp, diff: t.diff?.exp } }
      }) : ''}
      <div class="s14-stack">${prog}</div>`
  });
}

function committeesBlock(G) {
  const { L } = G;
  const c = L.counts || {}, P = L.proposals || {}, cm = c.committees || {};
  const split = Object.entries(c.proposalDates || {}).sort(([a], [b]) => a.localeCompare(b)).map(([d, n]) => `${num(n, 0)} на ${date(d, true).replace(/\s\d{4}$/u, '')}`);
  const kpis = [
    kpi({ label: 'Комисии с доклад', value: ok(cm.reported) && ok(cm.total) ? `${num(cm.reported, 0)} от ${num(cm.total, 0)}` : null, sub: cm.leading ? `Водеща: ${cm.leading}.` : '' }),
    kpi({ label: 'Становища', value: ok(c.opinions) ? num(c.opinions, 0) : null, sub: c.opinionsNote || '' }),
    kpi({ label: 'Предложения на народни представители', value: ok(c.proposals) ? num(c.proposals, 0) : null, sub: split.length ? `Между първо и второ четене: ${joinBg(split)}.` : '' })
  ];
  const items = arr(P.items).map(x => ({ no: x.no, date: x.date, url: String(P.urlPattern || '').replace('{file}', x.file) }));
  return block({
    id: 's14-komisii', title: 'Комисии, становища и предложения', status: 'partial', source: ['parliament'], asOf: L.meta?.asOf,
    body: html`${kpiGrid(kpis, { label: 'Доклади, становища и предложения към законопроекта' })}
      <div class="s14-stack">${items.length ? disclosure({
        id: 's14-predlozheniya', title: 'Документите с предложенията', meta: plural(items.length, 'предложение', 'предложения'),
        body: dataTable({
          id: 's14-t-predlozheniya', caption: 'Документи с предложенията между първо и второ четене',
          columns: [{ key: 'no', label: 'Документ', fmt: (v, r) => (hasLink(r.url) ? ext(r.url, v) : v) }, { key: 'date', label: 'Подадено на', fmt: v => date(v) }], rows: items, dense: true
        })
      }) : ''}</div>
      ${pendingState({ id: 'P07', text: 'Показваме колко са предложенията и връзките към самите документи в Народното събрание.', source: ['parliament'] })}`
  });
}

function lawsBlock(G) {
  const { L } = G;
  const bills = arr(L.bills);
  const same = bills.length && bills.every(b => b.inForce?.from === bills[0].inForce?.from) ? bills[0].inForce.from : null;
  const rows = bills.map(b => ({
    name: b.lawTitle, sign: b.sign, submitted: b.submitted, first: b.firstReading, second: arr(b.secondReading).map(d => date(d)).join(' – '),
    gazette: b.gazette ? `ДВ бр. ${b.gazette.issue} от ${date(b.gazette.date)}` : null
  }));
  const counts = bills.map(b => ({ name: b.lawTitle, reports: b.counts?.committeeReports ?? null, opinions: b.counts?.opinions ?? null, proposals: b.counts?.proposals ?? null }));
  const exc = arr(bills.filter(b => arr(b.inForce?.exceptions).length)).map(b => disclosure({
    id: `s14-vlizane-${b.id}`, title: `Кога влиза в сила: ${b.lawTitle}`, meta: plural(b.inForce.exceptions.length, 'изключение', 'изключения'),
    body: dataTable({
      id: `s14-t-vlizane-${b.id}`, caption: `Изключения от началната дата на действие: ${b.lawTitle}`,
      columns: [{ key: 'when', label: 'Кога' }, { key: 'scope', label: 'Кои разпоредби' }], rows: b.inForce.exceptions.map(e => ({ when: e.when, scope: e.scope })), dense: true
    })
  }));
  return block({
    id: 's14-zakoni', title: 'Трите закона: приемане и влизане в сила', status: 'real', source: ['zdb', 'zbdoo', 'zbnzok', 'parliament'], asOf: L.meta?.asOf,
    body: html`<p class="s14-text">Заедно със закона за държавния бюджет са приети и законите за бюджета на държавното обществено осигуряване и на здравната каса.${same ? ` И трите действат от ${dl(same)}; за отделни разпоредби са посочени други дати.` : ''}</p>
      ${rows.length ? dataTable({
        id: 's14-t-zakoni', caption: 'Трите закона: внасяне, гласуване и обнародване',
        columns: [{ key: 'name', label: 'Закон', fmt: (v, r) => html`${v}<small class="s14-cell-sub">№ ${r.sign}</small>` }, { key: 'submitted', label: 'Внесен', fmt: v => date(v) }, { key: 'first', label: 'Първо гласуване', fmt: v => date(v) }, { key: 'second', label: 'Второ гласуване' }, { key: 'gazette', label: 'Обнародван' }], rows
      }) : ''}
      ${counts.length ? dataTable({
        id: 's14-t-broi', caption: 'Доклади, становища и предложения по трите закона',
        columns: [{ key: 'name', label: 'Закон' }, { key: 'reports', label: 'Доклади', num: true }, { key: 'opinions', label: 'Становища', num: true }, { key: 'proposals', label: 'Предложения', num: true }], rows: counts, dense: true
      }) : ''}
      <div class="s14-stack">${exc}</div>`
  });
}

function docsBlock(G) {
  const { L } = G;
  const docs = arr(L.documents).filter(d => d && hasLink(d.url) && d.title);
  if (!docs.length) return '';
  return block({
    id: 's14-dokumenti', title: 'Документи и връзки', status: 'real', source: ['parliament', 'zdb', 'bill'], asOf: L.meta?.asOf,
    body: html`<ul class="s14-links">${docs.map(d => html`<li>${ext(d.url, d.title)}</li>`)}</ul>`
  });
}

function nextBlock(G) {
  const n = G.L.next;
  if (!n) return '';
  return block({ id: 's14-2027', title: n.title || 'Следващият бюджет', status: 'pending', body: pendingState({ title: n.title, text: n.note, expected: n.expected }) });
}

export const question = 'Кога и как беше приет бюджетът за 2026 г.?';   // js/seo.js: the lede answers it with the dates

export function render(ctx) {
  const G = modelOf(ctx);
  return {
    ...head(G),
    body: html`${unitSwitch(ctx, { name: 's14-unit', note: '„% от БВП“ е спрямо планирания БВП за 2026 г.' })}
      ${summary(G)}${whenBlock(G)}${committeesBlock(G)}${lawsBlock(G)}${art1Block(G)}${changesBlock(G)}${budgetsBlock(G)}${docsBlock(G)}${nextBlock(G)}`
  };
}

export function mount(root, ctx) {
  const offs = [bindUnitSwitch(root, ctx, 's14-unit')];
  return () => offs.forEach(f => { try { f?.(); } catch { /* a cleanup must never throw */ } });
}
