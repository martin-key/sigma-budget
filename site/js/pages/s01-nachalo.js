// S01 · Държавният бюджет на достъпен език · #/ · step 1 of 8 · next S06 · periods all
// The front door: what the site is, four things to do, a search, the six headline numbers of the 2026 budget with the questions under them, and a way into every other screen.
// A lean composition of existing components. Every number comes from core.json (kpis); none is typed in.
//   four actions        → S33 (#/deystvie?tab=otkrij|prosledi|sravni|proveri), one work area each
//   search              → S28 (#/tarsene?q=)         „Кой си ти?“ → store.userType, which orders the blocks below (citizen / journalist / expert)
//   no `periods` export: the six numbers are always the 2026 budget; a note says so when another period is selected
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { seg } from '../ui/seg.js';
import { chips } from '../ui/chips.js';
import { field, textInput } from '../ui/forms.js';
import { linkCard, facts } from '../ui/cards.js';
import { ranklist } from '../ui/ranklist.js';
import { dataTable } from '../ui/table.js';
import { progress } from '../ui/progress.js';
import { pendingState } from '../ui/states.js';
import { icon } from '../icons.js';
import { employmentCalc, receiptByFunction, apportion } from '../calc.js';
import { num, pct, eur, date, delta, DASH, NBSP } from '../format.js';
import { change, moneyCol } from '../view.js';
import { MAX_QUERY } from '../searchlib.js';

export const needs = ['core', 'revenue?', 'expenditure?', 'execution?', 'feed?', 'rates?', 'measures?', 'mock/measure-labels?'];
export const styles = ['s01-nachalo'];

const ok = v => typeof v === 'number' && Number.isFinite(v);
const KFP = { key: 'kfp', gl: null };                              // the scope chip without its glossary link (only the first mention of a term is linked)
const mlrd = (mln, d = 2) => (ok(mln) ? `${num(mln / 1000, d)}${NBSP}млрд.${NBSP}€` : DASH);
const ratio = (a, b) => (ok(a) && ok(b) && b !== 0 ? (a / b) * 100 : null);
const QUICK = ['ДДС', 'МВР', 'Пловдив', 'пенсии', 'дълг'];
/** the way into every other screen, as the question a visitor would ask: [route, icon, question, one line] */
const ASK = [
  ['S06', 'trendingUp', 'Откъде идват парите?', 'Данъци, осигуровки и други приходи.'],
  ['S07', 'pieChart', 'За какво се харчат?', 'Разходите по функции и по пера.'],
  ['S15', 'gauge', 'Изпълнява ли се планът?', 'Приходи и разходи месец по месец.'],
  ['S18', 'user', 'Колко плащам аз?', 'Калкулатор за заплата и данъци.'],
  ['S10', 'landmark', 'Кой харчи парите?', 'Бюджетите на министерствата и агенциите.'],
  ['S17', 'banknote', 'Колко е държавният дълг?', 'Дългът, лихвите и новото финансиране.'],
  ['S12', 'scale', 'Какво се променя?', 'Мерките в бюджета и техният ефект.'],
  ['S13', 'forecast', 'Накъде върви бюджетът?', 'Прогнозата за 2027 и 2028 г.'],
  ['S04', 'clock', 'Накратко, за 5 минути', 'Бюджетът в няколко стъпки.'],
  ['S16', 'newspaper', 'Какво ново?', 'Последните отчети и събития.'],
  ['S19', 'list', 'Кои са най-големите?', 'Класации и сравнения между години.'],
  ['S24', 'database', 'Откъде са данните?', 'Източници, методика и изтегляне.']
];

/** the four things a visitor comes to do: [tab of S33, icon, the verb, the one-line promise]. S33 holds the same four (a page module does not import another one) */
const DO = [
  ['otkrij', 'search', 'Открий', 'Намери конкретна тема, данък, институция или програма.'],
  ['prosledi', 'transfer', 'Проследи', 'Покажи ми откъде идват и къде отиват парите.'],
  ['sravni', 'scale', 'Сравни', 'Постави числото в контекст.'],
  ['proveri', 'database', 'Провери', 'Покажи ми оригиналните данни и методологията.']
];

/** „Какво искаш да направиш?“: four small tiles above the search, each a link to its work area: the verb with its icon, then the promise in plain words. */
function actions(ctx) {
  return html`<section class="s01-actions" aria-labelledby="s01-act-h">
    <h2 class="s01-act-h" id="s01-act-h">Какво искаш да направиш?</h2>
    <ul class="s01-act-list">${DO.map(([tab, ic, verb, promise]) => html`<li><a class="s01-act" href="${ctx.href('S33', {}, { tab })}"><span class="s01-act-head">${icon(ic, { size: 20 })}<span class="s01-act-verb">${verb}</span><span class="s01-act-go" aria-hidden="true">→</span></span><span class="s01-act-text">${promise}</span></a></li>`)}</ul></section>`;
}

/** the entrance: a slim row for the guide, then the search with its quick chips. The reading order stays guide → search. */
function intro(ctx) {
  return html`<section class="s01-intro" aria-label="Начало">
    <p class="s01-guide"><a class="s01-guide-link" href="${ctx.href('S02')}">${icon('compass', { size: 20 })}<span class="s01-guide-text"><strong>Нов си тук?</strong> Започни с пътеводителя</span><span class="s01-guide-go" aria-hidden="true">→</span></a></p>
    <form class="s01-find" role="search" aria-label="Търсене в бюджета">
      <label class="field-label" for="s01-q">Търси в бюджета</label>
      <div class="s01-find-main">
        <div class="s01-bar">
          <input class="input s01-q" id="s01-q" name="q" type="search" maxlength="${MAX_QUERY}" placeholder="Търси: ДДС, МВР, Пловдив…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
          <button type="submit" class="btn btn-primary s01-go"><span class="s01-go-ic" aria-hidden="true">${icon('search', { size: 20 })}</span><span class="s01-go-t">Търси</span></button>
        </div>
        ${chips({ label: 'Често търсено', items: QUICK.map(t => ({ label: t, href: ctx.href('S28', {}, { q: t }) })) })}
      </div>
    </form></section>`;
}

/** „Бюджет 2026 в шест числа“: plan and execution from core.kpis. Each tile has a plain name with the plain question the number answers,
 *  scope, status, source and a link to its screen. The tense follows the numbers: the plan is „ще събере“, what is done so far stays in the line under the number. */
function six(ctx, core) {
  const k = core.kpis || {}, gdp = k.gdp?.mln, rev = k.revenue || {}, exp = k.expenditure || {}, bal = k.balance || {}, cap = k.capex || {}, debt = k.debt || {};
  const inPct = ctx.store.get('unit') === 'pct';                       // „Показвай в: % от БВП“ makes the big number a share, so the line under it gives the euros
  const dd = n => (ctx.store.get('perPerson') ? 0 : n);                // „на човек“ is printed without decimals
  const dp = n => (inPct ? n : dd(n));                                 // …but a share of БВП keeps its decimals even when „на човек“ is on
  const dm = date(k.asOf).slice(0, 5);
  // the label: the plain name, then the question it answers (the hidden colon keeps the link text readable aloud)
  const lab = (name, ask) => html`<span class="s01-k-text"><span class="s01-k-name">${name}</span><span class="sr-only">: </span><span class="s01-k-ask">${ask}</span></span>`;
  const real = { scope: KFP, status: 'real', source: ['zdb', 'kfp'], asOf: k.asOf };       // the first tile keeps the glossary link of „КФП“
  const other = ctx.period?.year !== 2026 ? ' Числата са за бюджета за 2026 г., независимо от избрания период.' : '';
  const defMln = ok(bal.planMln) ? Math.abs(bal.planMln) : null, defNow = ok(bal.execMln) ? ` Към ${dm} ${bal.execMln < 0 ? 'дефицитът' : 'излишъкът'} е ${mlrd(Math.abs(bal.execMln))}.` : '';
  return block({
    id: 's01-six', title: 'Бюджет 2026 в шест числа', status: false, share: false,
    sub: `Планът за 2026 г. на консолидираната фискална програма (КФП) и колко от него е изпълнено към ${date(k.asOf)}.${other}`,
    body: kpiGrid([
      kpi({ id: 's01-k-gdp', label: lab('БВП', 'Колко стойност създава икономиката за година?'), mln: gdp, d: dd(1), status: 'forecast', source: ['asbp'],
        sub: 'Прогноза за 2026 г. Не е сумата в държавната каса.', href: ctx.href('S31') }),
      kpi({ ...real, scope: 'kfp', id: 's01-k-rev', label: lab('Приходи', 'Колко ще събере държавата?'), mln: rev.planMln, pctGdp: ratio(rev.planMln, gdp), d: dp(1),
        sub: `Събрани към ${dm}: ${mlrd(rev.execMln, 1)} (${pct(rev.execPct, 1)} от плана)`, href: ctx.href('S06') }),
      kpi({ ...real, id: 's01-k-exp', label: lab('Разходи', 'Колко ще похарчи държавата?'), mln: exp.planMln, pctGdp: ratio(exp.planMln, gdp), d: dp(1),
        sub: `Изразходвани към ${dm}: ${mlrd(exp.execMln, 1)} (${pct(exp.execPct, 1)} от плана)`, href: ctx.href('S07') }),
      kpi({ ...real, id: 's01-k-bal', label: lab('Дефицит', 'Колко повече ще похарчи държавата, отколкото ще събере?'), mln: defMln, pctGdp: ratio(defMln, gdp), d: dp(1),
        sub: `${inPct ? `${mlrd(defMln)} по плана.` : `${pct(ratio(defMln, gdp), 1)} от БВП по плана.`}${defNow}`, href: ctx.href('S17') }),
      kpi({ ...real, id: 's01-k-cap', label: lab('Капиталови разходи', 'Колко ще похарчи държавата за сгради, пътища и друго, което трае дълго?'), mln: cap.planMln, pctGdp: cap.pctGdp, d: dp(2),
        sub: `Към ${dm}: ${mlrd(cap.execMln)} (${pct(cap.execPct, 1)} от плана)`, href: ctx.href('S15') }),
      kpi({ id: 's01-k-debt', label: lab('Държавен дълг', 'Колко дължи държавата?'), mln: debt.zddMln, pctGdp: debt.pctGdp, d: dp(1), scope: 'zdd', status: 'forecast', source: ['asbp'],
        sub: `В края на 2026 г. (прогноза), вътрешен и външен дълг заедно: ${inPct ? mlrd(debt.zddMln) : `${pct(debt.pctGdp, 1)} от БВП`}.`, href: ctx.href('S17') })
    ], { label: 'Бюджет 2026 в шест числа' })
  });
}

/** „Кой си ти?“: the three readers; the choice is the shell's „Изглед за“ (store.userType) and re-orders the blocks below */
function who(ctx) {
  return block({
    id: 's01-who', title: 'Кой си ти?', status: false, share: false, report: false,
    sub: 'Избери и екранът се подрежда за теб.',
    // the shell's own „Изглед за“ markup (visible native radios): a seg's radios are see-through overlays, which the keyboard-focus check reads as hidden
    body: html`<fieldset class="opt-list"><legend class="sr-only">Кой си ти?</legend>${ctx.store.USER_TYPES.map(t => html`<label class="opt"><input type="radio" name="s01-who" id="s01-who-${t.id}" value="${t.id}"${t.id === ctx.store.get('userType') ? html` checked` : ''}><span class="opt-main"><span class="opt-label">${t.label}</span><span class="opt-desc">${t.hint}</span></span></label>`)}</fieldset>`
  });
}

/* ── citizen: „Колко плащам аз?“ ── a mini version of the S18 calculator: gross wage in, what the budget gets from it out */
const mem = { gross: '1500' };                                  // what was typed survives the re-render of a preference change
const GROSS_HINT = 'Например 1 500. Нищо не се записва.';
const employment = ctx => (ctx.data?.rates?.scenarios || []).find(s => s && s.id === 'employment') || null;

/** the result under the field: always a sentence or a table, never a made-up number */
function calcOut(ctx, core, text) {
  const s = String(text ?? '').trim(), n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (!s) return html`<p class="muted">Въведи брутна заплата и ще видиш сметката.</p>`;
  if (!Number.isFinite(n) || n <= 0) return html`<p class="field-error">Въведи число, по-голямо от нула, например 1 500.</p>`;
  if (n > 100000) return html`<p class="field-error">Въведи сума до 100 000 € на месец.</p>`;
  const r = employmentCalc(n, employment(ctx), { rules: 'from' });
  if (!r) return html`<p class="muted">Сметката за тази сума не може да се направи.</p>`;
  const list = receiptByFunction(r.yearlyDirect, core.functions, { decimals: 0 }).sort((a, b) => b.yearEur - a.yearEur).slice(0, 3).map(f => `${f.short} (${eur(f.yearEur)})`);
  return html`${facts([
    { k: 'Нетна заплата на месец', v: eur(r.net) },
    { k: 'Удържано от заплатата (осигуровки и данък)', v: eur(r.employeeContrib + r.incomeTax) },
    { k: 'Внася работодателят', v: eur(r.employerContrib) },
    { k: 'Общо към бюджета и фондовете', v: html`<strong>${eur(r.monthlyDirect)}</strong> на месец, ${eur(r.yearlyDirect)} на година` }
  ])}
    ${list.length ? html`<p>Ако делим тези пари като разходите на държавата, най-много отиват за ${list.length > 1 ? `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}` : list[0]} на година.</p>` : ''}
    <p class="muted small">Приходите не са целеви: делим ги пропорционално на разходите по функции в плана за 2026 г. Това е илюстрация, не отчет. <a href="${ctx.href('S18')}">Пълният калкулатор</a> смята и други доходи.</p>`;
}
function calc(ctx, core) {
  const emp = employment(ctx), meta = ctx.data?.rates?.meta || {};
  const ready = emp && emp.status !== 'pending' && employmentCalc(1000, emp) !== null;
  return block({
    id: 's01-calc', title: 'Колко плащам аз?', status: false, share: false, report: false, source: ready ? meta.source || ['nap'] : null, asOf: ready ? meta.asOf : null,
    sub: 'Въведи брутната си месечна заплата по трудов договор. Сметката е по ставките от 1 август 2026 г.',
    body: !ready ? pendingState({ title: 'Калкулаторът предстои', text: 'Ставките за 2026 г. не се заредиха.' }) : html`<div class="s01-calc">
      ${field({ id: 's01-gross', label: 'Брутна заплата на месец, €', hint: GROSS_HINT, control: textInput({ id: 's01-gross', name: 'gross', value: mem.gross, inputmode: 'decimal', autocomplete: 'off', hint: GROSS_HINT }) })}
      <div id="s01-calc-out" aria-live="polite">${calcOut(ctx, core, mem.gross)}</div></div>`
  });
}

/* ── citizen: „от всеки 100 €“ and the biggest expenses ── */
const SLOT = { dds: 1, osiguritelni: 2, nedanachni: 3, pomoshti: 4, ddfl: 5, akcizi: 7, korporativen: 8, drugi: 'other' };      // series colour per revenue group
const SHORT = { dds: 'ДДС', osiguritelni: 'Осигуровки', nedanachni: 'Неданъчни приходи', pomoshti: 'Помощи и дарения', ddfl: 'Данък върху доходите', akcizi: 'Акцизи', korporativen: 'Корпоративен данък', drugi: 'Други данъци и мита' };

function strip(ctx, core) {
  const g = (core.revenueGroups || []).filter(x => ok(x.mln)).sort((a, b) => (a.id === 'drugi') - (b.id === 'drugi') || b.mln - a.mln);
  if (!g.length) return '';
  const sh = apportion(g.map(x => x.mln), 100, 1), c = x => SLOT[x.id] ?? 'other';
  return block({
    id: 's01-strip', title: 'От всеки 100 € приходи', scope: KFP, status: 'real', source: ctx.data?.revenue?.meta?.source || ['zdb'], asOf: ctx.data?.revenue?.meta?.asOf, share: false,
    sub: 'Така се разпределят приходите на държавата по плана за 2026 г.',
    body: html`<div class="s01-strip" aria-hidden="true">${g.map((x, i) => html`<span class="s01-seg" data-c="${c(x)}" style="flex-grow:${sh[i]}"></span>`)}</div>
      <ul class="s01-legend">${g.map((x, i) => html`<li><span class="s01-sw" data-c="${c(x)}" aria-hidden="true"></span><span class="s01-leg-name">${SHORT[x.id] || x.name}</span><span class="s01-leg-v num">${num(sh[i], 1)}${NBSP}€<span class="sr-only"> от всеки 100 евро</span></span></li>`)}</ul>
      <p class="s01-more"><a href="${ctx.href('S06')}">Подробно за приходите</a></p>`
  });
}

function top5(ctx, core) {
  const f = (core.functions || []).filter(x => ok(x.mln)).sort((a, b) => b.mln - a.mln).slice(0, 5);
  if (!f.length) return '';
  return block({
    id: 's01-top5', title: 'За какво отиват най-много пари', scope: KFP, status: 'real', source: ['zdb'], asOf: core.kpis.asOf, share: false,
    sub: 'Петте най-големи групи разходи по плана за 2026 г.',
    body: html`${ranklist({ id: 's01-top5-rank', label: 'Пет най-големи групи разходи', ordered: true, unit: 'mln', items: f.map(x => ({ label: x.short, value: x.mln, pctGdp: x.pctGdp, share: x.share, href: ctx.href('S08', { fn: x.id }) })) })}
      <p class="s01-more"><a href="${ctx.href('S07')}">Всички разходи</a></p>`
  });
}

/* ── citizen: „Мерки, които те засягат“ ── the measures are real (D12); who they touch is an editorial label (M06, mock) */
mem.persona = 'Работещ';
const personas = ctx => ctx.data?.['mock/measure-labels']?.meta?.personas || [];

/** the measures that touch one group, the biggest 2026 effect first (a measure without an estimate goes last) */
function merkiList(ctx, persona) {
  const ms = ctx.data?.measures?.items || [], lb = new Map((ctx.data?.['mock/measure-labels']?.items || []).map(x => [x.id, x]));
  const size = m => Math.abs(m.effectMln?.['2026'] ?? 0);
  const list = ms.filter(m => (lb.get(m.id)?.affects || []).includes(persona)).sort((a, b) => size(b) - size(a)).slice(0, 4);
  const hint = personas(ctx).find(p => p.label === persona)?.hint;
  return html`${hint ? html`<p class="muted small">${persona}: ${hint}.</p>` : ''}
    ${list.length
    ? html`<ul class="s01-meas">${list.map(m => html`<li><a href="${ctx.href('S12', { id: m.id })}">${m.name}</a><span>${m.text}</span></li>`)}</ul>`
    : html`<p class="muted">В мерките към бюджета няма такава, която засяга тази група пряко.</p>`}
    <p class="s01-more"><a href="${ctx.href('S12')}">Всички ${num(ms.length, 0)} мерки</a></p>`;
}
function merki(ctx) {
  const lb = ctx.data?.['mock/measure-labels'], ps = personas(ctx);
  if (!Array.isArray(ctx.data?.measures?.items) || !Array.isArray(lb?.items) || !ps.length) return '';
  const cur = ps.some(p => p.label === mem.persona) ? mem.persona : ps[0].label;
  return block({
    id: 's01-merki', title: 'Мерки, които те засягат', mock: true, why: lb.items.find(x => x.why)?.why, source: ['bill', 'mockgen'], asOf: lb.meta?.asOf, share: false,
    sub: 'Мерките са от мотивите към бюджета. Кого засяга всяка, е редакционна преценка.',
    body: html`${seg({ name: 's01-persona', label: 'Мерките са за', value: cur, options: ps.map(p => ({ value: p.label, label: p.label })) })}
      <div id="s01-merki-list" aria-live="polite">${merkiList(ctx, cur)}</div>`
  });
}

/* ── citizen: „Как върви изпълнението“ ── three bars from the headline numbers (plan done so far), against the share of the year that has passed */
function izp(ctx, core) {
  const k = core.kpis, gone = ratio(k.month, 12);
  const bar = (id, label, e) => progress({ id, label, value: e.execPct, text: `${pct(e.execPct, 1)} от плана (${mlrd(e.execMln, 1)} от ${mlrd(e.planMln, 1)})` });
  return block({
    id: 's01-izp', title: 'Как върви изпълнението', scope: KFP, status: 'real', source: ['kfp'], asOf: k.asOf, share: false,
    sub: `Към ${date(k.asOf)} е изминала ${pct(gone, 1)} от годината (${num(k.month, 0)} от 12 месеца). Толкова е времето; разходите и приходите не са равномерни през годината.`,
    body: html`<div class="s01-prog">${bar('s01-p-rev', 'Приходи', k.revenue)}${bar('s01-p-exp', 'Разходи', k.expenditure)}${bar('s01-p-cap', 'Капиталови разходи', k.capex)}</div>
      <p class="s01-more"><a href="${ctx.href('S15')}">Изпълнението месец по месец</a></p>`
  });
}

/* ── journalist: „2026 спрямо 2025“ ── the КФП plan against the preliminary report for 2025 (Annex 3 of the bill); also feeds the expert table „По пера“ */
const ECO = [['Персонал', ['x.personnel']], ['Издръжка', ['x.maint']], ['Социални плащания', ['x.social', 'x.scholarships']], ['Субсидии', ['x.subsidies']],
  ['Капиталови разходи', ['x.capex']], ['Лихви', ['x.interest']], ['Вноска в ЕС', ['x.eucontrib']], ['Резерв и други', ['x.contingency', 'x.reserve', 'x.abroad']]];

/** the eight kinds of expenditure with their 2025 (preliminary) and 2026 (plan) amounts in млн. €, and the totals; null when the data did not load */
function eco(ctx) {
  const X = ctx.data?.expenditure?.economic;
  if (!Array.isArray(X?.rows) || !Array.isArray(X?.years)) return null;
  const rows = new Map(X.rows.map(r => [r.id, r])), i5 = X.years.indexOf(2025), i6 = X.years.indexOf(2026);
  const sum = (ids, i) => { const v = ids.map(id => rows.get(id)?.mln?.[i]); return i >= 0 && v.every(ok) ? v.reduce((s, x) => s + x, 0) : null; };
  const kinds = ECO.map(([label, ids]) => ({ label, a: sum(ids, i5), b: sum(ids, i6) })).filter(x => ok(x.a) && ok(x.b));
  const total = { label: 'Общо разходи', a: sum(['x.total'], i5), b: sum(['x.total'], i6) };
  return kinds.length && ok(total.a) && ok(total.b) ? { kinds, total, asOf: ctx.data.expenditure.meta?.asOf } : null;
}

function vs(ctx) {
  const e = eco(ctx), R = ctx.data?.revenue, r5 = R?.total?.mln?.[R?.years?.indexOf(2025)], r6 = R?.total?.mln?.[R?.years?.indexOf(2026)];
  if (!e || !ok(r5) || !ok(r6)) return '';
  const d5 = e.total.a - r5, d6 = e.total.b - r6;                  // the deficits, as positive numbers
  return block({
    id: 's01-vs', title: '2026 спрямо 2025', scope: KFP, status: 'real', source: ['asbp'], asOf: e.asOf, share: false,
    sub: 'Планът за 2026 г. спрямо предварителния отчет за 2025 г.',
    body: html`<p class="s01-lead">Приходите по плана са ${mlrd(r6, 1)} (${delta(change(r6, r5), 1)}), разходите са ${mlrd(e.total.b, 1)} (${delta(change(e.total.b, e.total.a), 1)}), а дефицитът ${d6 >= d5 ? 'нараства' : 'намалява'} от ${mlrd(d5)} на ${mlrd(d6)}.</p>
      <p class="s01-more"><a href="${ctx.href('S06')}">Приходите</a> · <a href="${ctx.href('S07')}">Разходите</a> · <a href="${ctx.href('S13')}">Прогнозата</a></p>`
  });
}

function growth(ctx) {
  const e = eco(ctx);
  if (!e) return '';
  const top = e.kinds.map(x => ({ ...x, up: x.b - x.a })).sort((x, y) => y.up - x.up).slice(0, 5);
  return block({
    id: 's01-growth', title: 'Какво расте най-много', scope: KFP, status: 'real', source: ['asbp'], asOf: e.asOf, share: false,
    sub: 'Петте вида разходи с най-голямо увеличение в евро: планът за 2026 г. спрямо предварителния отчет за 2025 г.',
    body: html`${ranklist({ id: 's01-growth-rank', label: 'Пет вида разходи с най-голямо увеличение', ordered: true, unit: 'mln',
      items: top.map(x => ({ label: x.label, sub: `${mlrd(x.a)} → ${mlrd(x.b)} (${delta(change(x.b, x.a), 1)})`, value: x.up })) })}
      <p class="s01-more"><a href="${ctx.href('S07')}">Всички разходи по функции и по пера</a></p>`
  });
}

/* ── journalist: „Какво ново“ ── the three latest events of the feed, and the report that is still to come (P04) */
function novo(ctx, core) {
  const F = ctx.data?.feed;
  if (!Array.isArray(F?.events)) return '';
  const kind = id => (F.kinds || []).find(k => k.id === id)?.label || '';
  const list = [...F.events].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3);
  return block({
    id: 's01-novo', title: 'Какво ново', source: F.meta?.source, asOf: F.meta?.asOf, share: false,
    sub: 'Трите последни събития по данните за бюджета.',
    body: html`<ul class="s01-news">${list.map(e => html`<li><span class="muted small"><time datetime="${e.date}">${date(e.date)}</time> · ${kind(e.kind)}</span>${e.href ? html`<a href="${e.href}">${e.title}</a>` : html`<strong>${e.title}</strong>`}</li>`)}</ul>
      ${pendingState({ id: 'P04', title: 'Отчетът към 31.08 предстои', text: `Следващият месечен отчет на КФП още не е в данните на сайта. Най-новият е към ${date(core.kpis.asOf)}.` })}
      <p class="s01-more"><a href="${ctx.href('S16')}">Всички новини и какво предстои</a></p>`
  });
}

/* ── journalist: the execution so far against the same months of the year before ── */
const EXEC = [['rev', 'Приходи'], ['exp.total', 'Разходи (с вноската в ЕС)'], ['balance', 'Дефицит'], ['exp.capex', 'Капиталови разходи'], ['fin.ext.markets', 'Нови заеми от международните пазари']];
function izpvs(ctx) {
  const L = ctx.data?.execution?.latest, K = L?.kfp;
  if (!K || !L.asOf) return '';
  const mc = moneyCol(ctx, { d: 1 }), prev = `${Number(L.asOf.slice(0, 4)) - 1}${L.asOf.slice(4)}`;
  const rows = EXEC.map(([id, name]) => {
    const r = K[id];
    if (!r || !ok(r.cum) || !ok(r.prevYearCum)) return null;
    const flip = id === 'balance' ? -1 : 1;                        // a deficit is shown as a positive number
    return { name, a: mc.raw(flip * r.prevYearCum), b: mc.raw(flip * r.cum), ch: change(flip * r.cum, flip * r.prevYearCum) };
  }).filter(Boolean);
  if (!rows.length) return '';
  return block({
    id: 's01-izpvs', title: 'Изпълнение спрямо 2025', scope: KFP, status: 'real', source: ['kfp'], asOf: L.asOf, share: false,
    sub: `Натрупано от началото на годината до ${date(L.asOf)} и до същия ден година по-рано.`,
    body: html`${dataTable({
      id: 's01-izpvs-table', caption: `Изпълнение на КФП към ${date(L.asOf)} спрямо същия ден на предходната година`, dense: true, rows,
      columns: [
        { key: 'name', label: 'Показател' },
        { key: 'a', label: `Към ${date(prev)}`, unit: mc.unit, d: mc.d },
        { key: 'b', label: `Към ${date(L.asOf)}`, unit: mc.unit, d: mc.d },
        { key: 'ch', label: 'Промяна', fmt: v => (ok(v) ? delta(v, 1) : DASH) }
      ]
    })}
      <p class="s01-more"><a href="${ctx.href('S15')}">Изпълнението месец по месец</a></p>`
  });
}

/* ── expert: the two tables in short, and the way to the data ── */
function pera(ctx) {
  const e = eco(ctx);
  if (!e) return '';
  const mc = moneyCol(ctx, { d: 1 }), row = x => ({ name: x.label, a: mc.raw(x.a), b: mc.raw(x.b), ch: change(x.b, x.a) });
  return block({
    id: 's01-pera', title: 'Разходите по пера', scope: KFP, status: 'real', source: ['asbp'], asOf: e.asOf, share: false,
    sub: 'Осемте вида разходи на КФП: планът за 2026 г. спрямо предварителния отчет за 2025 г.',
    body: html`${dataTable({
      id: 's01-pera-table', caption: 'Разходите на КФП по пера: 2025 (предварителен отчет) и 2026 (план)', dense: true, rows: e.kinds.map(row), total: { label: e.total.label, values: row(e.total) },
      columns: [
        { key: 'name', label: 'Перо' },
        { key: 'a', label: '2025, предв. отчет', unit: mc.unit, d: mc.d },
        { key: 'b', label: '2026, план', unit: mc.unit, d: mc.d },
        { key: 'ch', label: 'Промяна', fmt: v => (ok(v) ? delta(v, 1) : DASH) }
      ]
    })}
      <p class="s01-more"><a href="${ctx.href('S07')}">Всички пера, подробно</a></p>`
  });
}

function fns(ctx, core) {
  const f = (core.functions || []).filter(x => ok(x.mln));
  if (!f.length) return '';
  const mc = moneyCol(ctx, { d: 1 });
  return block({
    id: 's01-fns', title: 'Разходите по функции', scope: KFP, status: 'real', source: ['zdb'], asOf: core.kpis.asOf, share: false,
    sub: 'Функциите на КФП по плана за 2026 г. Промяната е спрямо програмата за 2025 г., не спрямо отчета.',
    body: html`${dataTable({
      id: 's01-fns-table', caption: 'Разходите на КФП по функции, 2026 (план)', dense: true, sortable: true,
      rows: f.map(x => ({ name: x.short, v: mc.raw(x.mln), share: x.share, yoy: x.yoyPct, _href: ctx.href('S08', { fn: x.id }) })),
      total: { label: 'Общо, без вноската в ЕС', values: { v: mc.raw(f.reduce((s, x) => s + x.mln, 0)), share: 100, yoy: null } },
      columns: [
        { key: 'name', label: 'Функция' },
        { key: 'v', label: '2026, план', unit: mc.unit, d: mc.d },
        { key: 'share', label: 'Дял', unit: '%', d: 1 },
        { key: 'yoy', label: 'Промяна спрямо 2025', fmt: v => (ok(v) ? delta(v, 1) : DASH) }
      ]
    })}
      <p class="s01-more"><a href="${ctx.href('S07')}">Разходите подробно</a></p>`
  });
}

function dataLinks(ctx) {
  const L = [['S15', 'gauge', 'Изпълнение по месеци', 'Месечните отчети на КФП, по пера и по видове бюджет.'], ['S24', 'database', 'Каталог на данните', 'Всички набори с източник, дата и методика.'],
    ['S25', 'code', 'Отворени данни и API', 'Файловете с данни, схемите и как да ги ползваш.']];
  return block({
    id: 's01-data', title: 'Данни и API', status: false, share: false, report: false, sub: 'Всяко число на сайта идва от файл, който можеш да изтеглиш.',
    body: html`<div class="grid">${L.map(([id, ic, title, text]) => linkCard({ href: ctx.href(id), icon: ic, title, text }))}</div>`
  });
}

/** the blocks after „Кой си ти?“ for each reader, in reading order: each is f(ctx, core) → html.
 *  A block on its own is full width; a list inside the list is one row of columns, each column a stack of blocks (read down the first column, then the next),
 *  so a short card never has to wait for a tall one. The order of the blocks is the same as before. */
const BY_TYPE = {
  citizen: [[[calc, strip], [top5, merki]], izp],
  journalist: [vs, [[growth], [novo]], izpvs],
  expert: [pera, fns, dataLinks]
};
const layout = (ctx, core, part) => Array.isArray(part)
  ? html`<div class="s01-cols">${part.map(col => html`<div class="s01-col">${col.map(f => f(ctx, core))}</div>`)}</div>`
  : part(ctx, core);

/** „Разгледай бюджета“: one question card per screen */
function explore(ctx) {
  return block({
    id: 's01-explore', title: 'Разгледай бюджета', status: false, share: false, sub: 'Избери въпрос и отиди направо към отговора.',
    body: html`<div class="grid">${ASK.map(([id, ic, title, text]) => linkCard({ href: ctx.href(id), icon: ic, title, text }))}</div>`
  });
}

export function render(ctx) {
  const lede = html`<strong>Бюджет на светло</strong> показва държавния бюджет за <span class="nowrap">2026 г.</span> с прости думи: <a href="${ctx.href('S06')}">откъде идват парите</a>, <a href="${ctx.href('S07')}">за какво се харчат</a> и <a href="${ctx.href('S15')}">как се изпълнява планът</a>.`;
  const core = ctx.data?.core;
  if (!core?.kpis) return { lede, body: html`${actions(ctx)}${intro(ctx)}${pendingState({ title: 'Основните числа не са налични', text: 'Файлът с основните числа не се зареди. Опитай да презаредиш страницата.' })}${explore(ctx)}` };
  const parts = (BY_TYPE[ctx.store.get('userType')] || BY_TYPE.citizen).map(part => layout(ctx, core, part));
  return { lede, body: html`${actions(ctx)}${intro(ctx)}${six(ctx, core)}${explore(ctx)}${who(ctx)}<div class="s01-grid">${parts}</div>` };
}

export function mount(root, ctx) {
  const off = [], on = (el, ev, fn) => { if (el) { el.addEventListener(ev, fn); off.push(() => el.removeEventListener(ev, fn)); } };
  on(root.querySelector('.s01-find'), 'submit', e => {
    e.preventDefault();
    const q = (e.currentTarget.elements.q?.value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
    ctx.go(ctx.href('S28', {}, q ? { q } : {}));
  });
  on(root, 'change', e => {
    const t = e.target, list = root.querySelector('#s01-merki-list');
    if (t.name === 's01-who' && t.checked) ctx.store.set('userType', t.value);
    if (t.name === 's01-persona' && t.checked && list) { mem.persona = t.value; list.innerHTML = merkiList(ctx, t.value).s; }
  });
  const gross = root.querySelector('#s01-gross'), out = root.querySelector('#s01-calc-out');
  on(gross, 'input', () => { mem.gross = gross.value; out.innerHTML = calcOut(ctx, ctx.data.core, gross.value).s; });
  return () => off.forEach(f => f());
}
