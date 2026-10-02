// S32 · Моят бюджет · #/moyat-byudzhet · next S06, S07 · periods none
// A small what-if toy over the real 2026 plan: the visitor plays finance minister. Five revenue lines and six expenditure functions can be moved by
// −20…+20 % of their plan amount (a model parameter, not a proposal), and the largest measures with a stated effect can be switched on or off.
// The result is plain addition and subtraction: NOT a forecast and NOT an official estimate, and every place it appears says so.
// Data: core.json (plan totals, revenue groups, expenditure functions, БВП), outlook.json (financing, as-of date), measures.json (stated effects).
// Nothing is typed from memory; the only constants are the slider range and the size rule that decides which measures get a switch.
// Arithmetic runs in integer TENTHS of млн. € (the data has one decimal), so the default view equals the plan EXACTLY, with no float noise.
// Two fixed lines („Други приходи“, „Други разходи“) hold whatever the shown lines do not, so the sums reconcile; they cannot be moved.
// On purpose there are no verdicts, no scoring and no recommended path. The screen ignores the leva and per-person switches (always млн. €).
// State: `sim` lives at module level and survives the shell's own re-render of the screen (S18 does the same); every other visit starts from the plan.
import { html, raw, esc } from '../html.js';
import { block } from '../ui/block.js';
import { callout, facts } from '../ui/cards.js';
import { toggle } from '../ui/forms.js';
import { chart, chartSpec } from '../ui/chart.js';
import { dataTable } from '../ui/table.js';
import { pendingState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import * as saved from '../ui/saved.js';
import { download, sourceLine } from '../share.js';
import { buildOption } from '../charts.js';
import { num, pct, money, date, NBSP } from '../format.js';

export const needs = ['core', 'outlook', 'measures'];
export const styles = ['s32-moyat-byudzhet'];

/* ---------------------------------------------------------------- constants and small helpers */
/** the lines the visitor can move, by id in core.json (the rest of the plan goes to the fixed „Други“ line) */
const REV = ['dds', 'osiguritelni', 'ddfl', 'akcizi', 'korporativen'];
const EXP = ['sotsialni', 'ikonomika', 'zdraveopazvane', 'otbrana-sigurnost', 'obrazovanie', 'obshti-sluzhbi'];
const RANGE = 20;            // slider limit in % of the plan amount: a parameter of the model
const MIN_EFFECT = 100;      // a measure gets a switch when its stated effect is at least this many млн. €: a selection rule, not data
const SLOT = 'moyat-byudzhet';

let sim = null;              // { rev:{id:%}, exp:{id:%}, on:{measureId:boolean} }

const ok = v => typeof v === 'number' && Number.isFinite(v);
const T = v => Math.round(v * 10);                                        // млн. € -> tenths
/** p % of an amount, both in tenths, rounded half away from zero, so a step up and a step down are the same size */
const part = (t, p) => (Math.sign(t * p) * Math.floor((Math.abs(t * p) + 50) / 100)) || 0;
const mn = t => money(t / 10, { scale: 'mln', d: 1 });                    // 12 803,8 млн. €
const smn = t => `${num(t / 10, 1, { sign: true })}${NBSP}млн.${NBSP}€`;  // +640,2 млн. €  /  −100,0 млн. €
const spct = p => `${num(p, 0, { sign: true })}%`;                        // +5%  /  −5%  /  0%
/** a data name inside a sentence: „Образование“ -> „образование“, but „ДДС“ and „ЕС“ stay as they are */
const low = s => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
/** „2026 г.“ with a no-break space; the year is the one of the plan in core.json */
const yr = f => `${f.year}${NBSP}г.`;

/* ---------------------------------------------------------------- the model */
/** everything the screen needs from the data, or null when something is missing or does not add up */
function frame(ctx) {
  const d = ctx.data || {};
  const core = d.core, out = d.outlook, ms = d.measures, k = core?.kpis;
  if (!k || !out || !ms) return null;
  const revT = T(k.revenue?.planMln), expT = T(k.expenditure?.planMln), balT = T(k.balance?.planMln);
  const gdp = k.gdp?.mlnPrecise ?? k.gdp?.mln;
  if (!ok(revT) || !ok(expT) || !ok(balT) || !ok(gdp) || gdp <= 0 || revT - expT !== balT) return null;
  const groups = Array.isArray(core.revenueGroups) ? core.revenueGroups : [];
  const funcs = Array.isArray(core.functions) ? core.functions : [];
  const take = (src, ids, nameOf) => ids.map(id => { const x = src.find(s => s.id === id); return x && ok(x.mln) ? { id, name: nameOf(x), t: T(x.mln) } : null; });
  const rev = take(groups, REV, g => g.name), exp = take(funcs, EXP, g => g.short || g.name);
  if (rev.includes(null) || exp.includes(null)) return null;
  rev.sort((a, b) => b.t - a.t);
  exp.sort((a, b) => b.t - a.t);
  const otherRevT = revT - rev.reduce((s, l) => s + l.t, 0), otherExpT = expT - exp.reduce((s, l) => s + l.t, 0);
  if (otherRevT < 0 || otherExpT < 0) return null;
  const year = String(k.gdp?.year ?? '');
  const meas = (Array.isArray(ms.items) ? ms.items : [])
    .filter(m => m.hasEstimate === true && m.estimateKind === 'stated' && (m.kind === 'revenue' || m.kind === 'expenditure') && ok(m.effectMln?.[year]) && Math.abs(m.effectMln[year]) >= MIN_EFFECT)
    .map(m => ({ id: m.id, kind: m.kind, name: m.name, effT: T(m.effectMln[year]) }))
    .sort((a, b) => Math.abs(b.effT) - Math.abs(a.effT));
  const plan = Array.isArray(out.vintage) ? out.vintage.indexOf('plan') : -1;
  const fin = out.kfp?.financing?.mln?.[plan];
  return {
    rev, exp, meas, otherRevT, otherExpT, revT, expT, balT, gdp, year,
    restR: groups.filter(g => !REV.includes(g.id)).map(g => g.name),
    restE: funcs.filter(g => !EXP.includes(g.id)).map(g => g.short || g.name),
    finOk: ok(fin) && T(fin) === -balT,                 // the data says financing = the deficit, with the opposite sign
    kAsOf: k.asOf, mAsOf: ms.meta?.asOf, mSrc: Array.isArray(ms.meta?.source) && ms.meta.source.length ? ms.meta.source : ['bill'],
    stage: ms.notes?.find(n => n.id === 'stage')?.text || ''
  };
}

const blank = f => ({
  rev: Object.fromEntries(f.rev.map(l => [l.id, 0])),
  exp: Object.fromEntries(f.exp.map(l => [l.id, 0])),
  on: Object.fromEntries(f.meas.map(m => [m.id, true]))
});

/** a saved record turned into a state; whatever does not fit the current data is dropped, and a record with nothing usable gives null */
function clean(f, data) {
  if (!data || typeof data !== 'object') return null;
  const s = blank(f);
  let used = 0;
  for (const [key, lines] of [['rev', f.rev], ['exp', f.exp]]) {
    for (const l of lines) {
      const v = data[key]?.[l.id];
      if (Number.isInteger(v) && Math.abs(v) <= RANGE) { s[key][l.id] = v; used++; }
    }
  }
  for (const m of f.meas) if (typeof data.on?.[m.id] === 'boolean') { s.on[m.id] = data.on[m.id]; used++; }
  return used ? s : null;
}

/** totals for a state, and the list of what the visitor changed (largest effect on the balance first) */
function compute(f, s) {
  let revT = f.otherRevT, expT = f.otherExpT;
  const changes = [];
  for (const l of f.rev) {
    const p = s.rev[l.id] || 0, dT = part(l.t, p);
    revT += l.t + dT;
    if (p) changes.push({ what: `Приходи: ${l.name}`, change: spct(p), balT: dT });
  }
  for (const l of f.exp) {
    const p = s.exp[l.id] || 0, dT = part(l.t, p);
    expT += l.t + dT;
    if (p) changes.push({ what: `Разходи: ${l.name}`, change: spct(p), balT: -dT });
  }
  for (const m of f.meas) {
    if (s.on[m.id] !== false) continue;               // a measure that is on is already inside the plan; switching it off takes its effect out
    if (m.kind === 'revenue') revT -= m.effT; else expT -= m.effT;
    changes.push({ what: `Мярка: ${m.name}`, change: 'Изключена', balT: m.kind === 'revenue' ? -m.effT : m.effT, measure: true });
  }
  changes.sort((a, b) => Math.abs(b.balT) - Math.abs(a.balT));
  return { revT, expT, balT: revT - expT, changes };
}

/** the numbers and short phrases that the result, the slim bar, the live sentence and the picture all share */
function sums(f, r) {
  const g = t => (t / 10 / f.gdp) * 100;
  const kind = r.balT < 0 ? 'deficit' : r.balT > 0 ? 'surplus' : 'zero';
  const planKind = f.balT < 0 ? 'deficit' : f.balT > 0 ? 'surplus' : 'zero';
  const mag = Math.abs(r.balT), planMag = Math.abs(f.balT);
  const diffOf = d => (d === 0 ? 'както в плана' : `${smn(d)} спрямо плана`);
  return {
    kind, mag,
    label: kind === 'deficit' ? 'Дефицит' : kind === 'surplus' ? 'Излишък' : 'Салдо',
    pRev: g(r.revT), pExp: g(r.expT), pBal: g(mag),
    dRev: diffOf(r.revT - f.revT), dExp: diffOf(r.expT - f.expT),
    dBal: kind === planKind ? diffOf(mag - planMag) : `в плана: ${planKind === 'deficit' ? 'дефицит' : planKind === 'surplus' ? 'излишък' : 'нулево салдо'} ${mn(planMag)}`
  };
}

function balanceSentence(f, r) {
  const d = r.balT - f.balT;
  if (d === 0) return 'Салдото е същото като в плана.';
  const a = mn(Math.abs(d)), more = d > 0 ? 'повече' : 'по-малко';
  if (r.balT < 0 && f.balT < 0) return `Дефицитът е с ${a} ${d > 0 ? 'по-малък' : 'по-голям'} от плана.`;
  if (r.balT > 0) return `Приходите са повече от разходите${f.balT < 0 ? ': вместо дефицит има излишък' : ''}. Салдото е с ${a} ${more}, отколкото в плана.`;
  if (r.balT === 0) return `Приходите са равни на разходите: няма нито дефицит, нито излишък. Салдото е с ${a} ${more}, отколкото в плана.`;
  return `Салдото е с ${a} ${more}, отколкото в плана.`;
}
function financingSentence(f, r) {
  if (r.balT >= 0) return 'Няма дефицит, който да се покрива с финансиране.';
  return `Дефицитът трябва да се покрие с финансиране, например с нов заем.${f.finOk ? ' В плана финансирането е със същата стойност като дефицита.' : ''}`;
}
const liveText = (f, r) => { const s = sums(f, r); return `Приходи ${mn(r.revT)}, разходи ${mn(r.expT)}, ${s.label.toLowerCase()} ${mn(s.mag)}, ${pct(s.pBal)} от БВП. ${balanceSentence(f, r)}`; };

/* ---------------------------------------------------------------- small pieces of markup */
const MODEL = 'Опростен модел за разглеждане. Не е прогноза и не е официален разчет.';
/** nothing differs from the plan */
const isBlank = s => !s || (Object.values(s.rev).every(v => !v) && Object.values(s.exp).every(v => !v) && Object.values(s.on).every(v => v !== false));
/** „05.10.2026 г., 14:30“: the time of a save, in the visitor's own clock */
function stamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}${NBSP}г., ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const linesOf = (f, k) => (k === 'rev' ? f.rev : f.exp);
const ctlId = (k, id) => `s32-${k === 'rev' ? 'r' : 'e'}-${id}`;
const newT = (l, p) => l.t + part(l.t, p);
/** next to a slider: „+5% · +640,2 млн. €“, or „0% · както в плана“ at rest */
const valText = (l, p) => (p ? `${spct(p)} · ${smn(part(l.t, p))}` : '0% · както в плана');
const speak = (l, p) => (p ? `${spct(p)} спрямо плана, ${smn(part(l.t, p))}` : 'както в плана');

function sliderRow(k, l, p) {
  const id = ctlId(k, l.id);
  return html`<div class="s32-ctl" data-changed="${p ? 'true' : 'false'}">
    <div class="s32-head"><label class="s32-label" for="${id}">${l.name}</label><span class="s32-val" id="${id}-v">${valText(l, p)}</span></div>
    <input class="s32-range" type="range" id="${id}" min="${-RANGE}" max="${RANGE}" step="1" value="${p}" data-k="${k}" data-l="${l.id}" aria-valuetext="${speak(l, p)}" aria-describedby="${id}-b">
    <div class="s32-base" id="${id}-b"><span>В плана: ${mn(l.t)}</span><span id="${id}-n">Така: ${mn(newT(l, p))}</span></div>
  </div>`;
}

function measureRow(m, on) {
  const what = m.kind === 'revenue'
    ? (m.effT >= 0 ? `носи ${mn(m.effT)} приходи` : `намалява приходите с ${mn(-m.effT)}`)
    : (m.effT <= 0 ? `спестява ${mn(-m.effT)} разходи` : `увеличава разходите с ${mn(m.effT)}`);
  return toggle({ id: `s32-m-${m.id}`, label: m.name, checked: on, attrs: raw(` data-m="${esc(m.id)}"`), hint: `По оценката на правителството ${what}.` });
}

/** the three result rows: a big number, its share of БВП and the difference to the plan */
function rowsHtml(f, r) {
  const s = sums(f, r);
  const row = (name, big, share, diff) => html`<div class="s32-row"><dt>${name}</dt><dd><span class="s32-big">${big}</span><span class="s32-sub"><span>${share} от БВП</span><span>${diff}</span></span></dd></div>`;
  return html`${row('Приходи', mn(r.revT), pct(s.pRev, 1), s.dRev)}${row('Разходи', mn(r.expT), pct(s.pExp, 1), s.dExp)}${row(s.label, mn(s.mag), pct(s.pBal, 1), s.dBal)}`;
}
const saysText = (f, r) => `${balanceSentence(f, r)} ${financingSentence(f, r)}`;

/** the slim copy of the result that sticks under the top bar on small screens */
function miniInner(f, r) {
  const s = sums(f, r);
  return html`<span class="s32-mini-k">${s.label}</span> <span class="s32-mini-v">${mn(s.mag)}</span> <span class="s32-mini-s">${pct(s.pBal, 1)} от БВП · ${s.dBal}</span>`;
}

/* ---------------------------------------------------------------- the chart: plan against your budget */
function cmpDesc(f, r) {
  const s = sums(f, r);
  const planKind = f.balT < 0 ? 'дефицит' : f.balT > 0 ? 'излишък' : 'салдо';
  return `Твоят бюджет: приходи ${mn(r.revT)}, разходи ${mn(r.expT)}, ${s.label.toLowerCase()} ${mn(s.mag)}. В плана: приходи ${mn(f.revT)}, разходи ${mn(f.expT)}, ${planKind} ${mn(Math.abs(f.balT))}.`;
}
function cmpSpec(f, r) {
  const rows = [['Приходи', f.revT, r.revT], ['Разходи', f.expT, r.expT], ['Салдо', f.balT, r.balT]];
  const signed = x => (ok(x) ? num(x, 1, { sign: true }) : null);
  return {
    id: 's32-cmp', type: 'bar', title: 'Планът и твоят бюджет', sub: 'млн. €',
    categories: rows.map(x => x[0]), categoryLabel: 'Показател', interval: 0, unit: 'млн. €', height: 300,
    fmt: v => num(v, Number.isInteger(v) ? 0 : 1),
    series: [
      { name: 'План', color: 'other', data: rows.map(x => x[1] / 10) },
      { name: 'Твоят бюджет', color: '--data', data: rows.map(x => x[2] / 10) }
    ],
    desc: cmpDesc(f, r),
    table: {
      columns: [
        { key: 'c', label: 'Показател' },
        { key: 'p', label: 'План', unit: 'млн. €', d: 1, num: true },
        { key: 'y', label: 'Твоят бюджет', unit: 'млн. €', d: 1, num: true },
        { key: 'd', label: 'Разлика', unit: 'млн. €', d: 1, num: true, fmt: signed }
      ],
      rows: rows.map(x => ({ c: x[0], p: x[1] / 10, y: x[2] / 10, d: (x[2] - x[1]) / 10 }))
    }
  };
}

/** what the visitor changed, as a table (or one plain sentence when nothing is changed yet) */
function chgBody(f, r) {
  if (!r.changes.length) return html`<p class="s32-note muted">Още не си променял нищо. Твоят бюджет е равен на плана.</p>`;
  return html`<div class="stack">
    ${dataTable({
      id: 's32-chg-t', caption: 'Какво си променил и какъв е ефектът върху салдото', dense: true,
      columns: [
        { key: 'what', label: 'Какво' },
        { key: 'change', label: 'Промяна', align: 'end' },
        { key: 'bal', label: 'Ефект', unit: 'млн. €', d: 1, num: true, fmt: v => (ok(v) ? num(v, 1, { sign: true }) : null) }   // short on purpose: the header never wraps, and three columns must fit at 400 px
      ],
      rows: r.changes.map(c => ({ what: c.what, change: c.change, bal: c.balT / 10 })),
      total: { label: 'Общо', values: { bal: (r.balT - f.balT) / 10 } }
    })}
    <p class="s32-note small muted">Ефектът е върху ${gl('byudzhetno-saldo', 'салдото')}: плюсът го увеличава (при дефицит: по-малък дефицит), минусът го намалява. Редовете са подредени по размер на ефекта.</p>
  </div>`;
}

/* ---------------------------------------------------------------- blocks */
function planBlock(f) {
  return block({
    id: 's32-plan', title: `Планът за ${yr(f)}`, scope: 'kfp', status: 'real', source: ['zdb', 'kfp'], asOf: f.kAsOf, share: false,
    sub: 'От тези числа тръгва моделът.',
    body: html`<div class="stack">
      ${facts([
        { k: 'Приходи', v: mn(f.revT) },
        { k: 'Разходи', v: mn(f.expT) },
        { k: f.balT < 0 ? 'Дефицит' : f.balT > 0 ? 'Излишък' : 'Салдо', v: mn(Math.abs(f.balT)) },
        { k: 'БВП, с който се смята', v: mn(Math.round(f.gdp * 10)) }
      ])}
      <p class="s32-note small muted">${gl('bvp', 'БВП')} е размерът на икономиката за годината. В модела той не се променя.</p>
    </div>`
  });
}

function revBlock(f, s) {
  return block({
    id: 's32-rev', title: 'Приходите', status: 'partial', statusLabel: 'Опростен модел', share: false,
    sub: 'Премести плъзгача, за да смениш колко събира всяка група. Промяната е в % от сумата в плана. Това е параметър на модела, не предложение.',
    body: html`<div class="stack">
      <p class="s32-note small muted">По-големите приходи могат да дойдат от ставките или от по-добра събираемост.</p>
      <div class="s32-list">${f.rev.map(l => sliderRow('rev', l, s.rev[l.id] || 0))}</div>
      <p class="s32-fixed small muted"><b>Други приходи: ${mn(f.otherRevT)}.</b> Не се променят. Това са ${f.restR.map(low).join('; ')}.</p>
    </div>`
  });
}

function expBlock(f, s) {
  return block({
    id: 's32-exp', title: 'Разходите', status: 'partial', statusLabel: 'Опростен модел', share: false,
    sub: html`Премести плъзгача, за да смениш колко се харчи по всяка ${gl('byudzhetna-funktsiya', 'функция')}. Промяната е в % от сумата в плана.`,
    body: html`<div class="stack">
      <div class="s32-list">${f.exp.map(l => sliderRow('exp', l, s.exp[l.id] || 0))}</div>
      <p class="s32-fixed small muted"><b>Други разходи: ${mn(f.otherExpT)}.</b> Не се променят. Това са ${[...f.restE.map(low), 'вноската в общия бюджет на ЕС'].join('; ')}.</p>
    </div>`
  });
}

function measBlock(f, s) {
  if (!f.meas.length) return '';
  return block({
    id: 's32-meas', title: 'Мерките в бюджета', status: 'real', source: f.mSrc, asOf: f.mAsOf, share: false,
    sub: 'Включената мярка вече е в плана. Ако я изключиш, нейният ефект се маха от сметката. Ефектите са по оценката на правителството.',
    body: html`<div class="stack">
      <div class="toggle-list">${f.meas.map(m => measureRow(m, s.on[m.id] !== false))}</div>
      ${f.stage ? html`<p class="s32-note small muted">${f.stage}</p>` : ''}
      <p class="s32-note small muted">Показани са мерките с оценен ефект от поне ${mn(MIN_EFFECT * 10)}. По-малките не са включени.</p>
    </div>`
  });
}

function resultBlock(f, r) {
  return block({
    id: 's32-result', title: 'Твоят бюджет', status: 'partial', statusLabel: 'Изчисление', share: false,
    sub: MODEL,
    body: html`<div class="stack">
      <dl class="s32-rows" id="s32-rows">${rowsHtml(f, r)}</dl>
      <p class="s32-says" id="s32-says">${saysText(f, r)}</p>
      <div class="s32-actions">
        <button type="button" class="btn btn-primary" id="s32-save">Запази в браузъра</button>
        <button type="button" class="btn" id="s32-png">Свали като картинка (PNG)</button>
        <button type="button" class="btn btn-quiet" id="s32-reset">Върни към плана</button>
      </div>
      <p class="s32-msg" id="s32-msg"></p>
      <p class="s32-note small muted">Процентите са от същия БВП като в плана. Повече за ${gl('nov-dalg-novo-zaemane', 'новото заемане')} има в речника.</p>
    </div>`
  });
}

function cmpBlock(f, r) {
  return block({
    id: 's32-cmp-b', title: 'Сравнение с плана', status: 'partial', statusLabel: 'Изчисление', share: false,
    body: html`<div class="stack">${chart(cmpSpec(f, r))}<p class="s32-note small muted">Салдото е приходите минус разходите. Под нулата е дефицит.</p></div>`
  });
}

function chgBlock(f, r) {
  return block({
    id: 's32-chg', title: 'Какво промени', status: 'partial', statusLabel: 'Изчисление', share: false,
    body: html`<div id="s32-chg-body">${chgBody(f, r)}</div>`
  });
}

function limitsCallout() {
  return callout({
    kind: 'info', title: 'Какво не е в модела',
    body: html`<ul class="s32-limits">
      <li>Няма последствия от втори ред. Ако промениш един данък, моделът не отчита как ще се промени икономиката.</li>
      <li>Хората и фирмите не реагират. Моделът не смята, че ще работят, пазаруват или плащат по различен начин.</li>
      <li>Само планът за годината. Няма други години.</li>
      <li>Оценките на мерките са на ${gl('nachislena-osnova', 'начислена основа')}, а числата на КФП са на ${gl('kasova-osnova', 'касова основа')}. Затова сборът е приблизителен.</li>
      <li>Мерките са по законопроекта. Приетият закон може да се различава.</li>
      <li>Страницата не оценява и не препоръчва. Показва само сметката.</li>
    </ul>`
  });
}

/* ---------------------------------------------------------------- the screen */
export function render(ctx) {
  const f = frame(ctx);
  if (!f) {
    return {
      lede: 'Промени приходите и разходите от плана и виж какво става с дефицита.',
      body: pendingState({ title: 'Моделът не може да се покаже', text: 'Липсват числата на плана. Опитай пак по-късно.', source: ['kfp'] })
    };
  }
  // a new visit starts from the plan; a re-render of the same visit (unit switch, back/forward) keeps what the visitor set
  sim = (sim && ctx.kind !== 'load' && ctx.kind !== 'link' && clean(f, sim)) || blank(f);
  const r = compute(f, sim);
  const rec = isBlank(sim) ? saved.get(SLOT) : null;
  const rs = rec && clean(f, rec.data);
  const offer = rs && !isBlank(rs)
    ? callout({
      kind: 'info', id: 's32-offer', title: `Запазен бюджет от ${stamp(rec.at)}`,
      body: html`<p>Запазил си свои настройки в този браузър. Искаш ли да ги върнеш?</p>
        <div class="s32-offer-btns"><button type="button" class="btn btn-primary btn-sm" id="s32-restore">Върни го</button><button type="button" class="btn btn-quiet btn-sm" id="s32-forget">Забрави го</button></div>`
    })
    : '';
  return {
    lede: `Поеми кормилото на държавните пари. Започваш от плана за ${yr(f)}, местиш приходи и разходи и гледаш какво става с дефицита.`,
    context: `Изходните числа са по плана за ${yr(f)}, към ${date(f.kAsOf)}${NBSP}г.`,
    body: html`<div class="s32-layout">
      <div class="s32-mini" id="s32-mini" aria-hidden="true"><div class="s32-mini-in" id="s32-mini-in">${miniInner(f, r)}</div></div>
      <div class="s32-main" id="s32-main">
        ${offer}
        ${callout({
          kind: 'info', title: MODEL,
          body: html`<p>Как работи: започваш от плана, местиш плъзгачите и включваш или изключваш мерки. Страницата само събира и изважда и показва кога има ${gl('byudzheten-defitsit', 'дефицит')} и кога — излишък.</p>`
        })}
        ${planBlock(f)}
        ${revBlock(f, sim)}
        ${expBlock(f, sim)}
        ${measBlock(f, sim)}
      </div>
      <div class="s32-side">${resultBlock(f, r)}</div>
      <div class="s32-after">${cmpBlock(f, r)}${chgBlock(f, r)}${limitsCallout()}</div>
    </div>`
  };
}

/* ---------------------------------------------------------------- the picture (PNG) */
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** the vendored Sofia Sans must be loaded before the canvas can use it; if it fails the system font stands in */
async function loadFonts() {
  try {
    await Promise.all([document.fonts.load('700 22px "Sofia Sans Condensed"'), document.fonts.load('400 13px "Sofia Sans"'), document.fonts.load('700 13px "Sofia Sans"')]);
  } catch { /* system font */ }
}
/** `text` cut with an ellipsis so that it fits `maxW` in the font that is set on the context */
function fitText(x, text, maxW) {
  let t = String(text);
  if (x.measureText(t).width <= maxW) return t;
  while (t.length > 1 && x.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** the card: 1200 x 800 logical pixels, drawn at the device ratio (1..2); resolves to a PNG Blob (or null) */
async function card(f, r) {
  await loadFonts();
  const W = 1200, H = 800, M = 56;
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const x = cv.getContext('2d');
  if (!x) return null;
  x.scale(dpr, dpr);
  x.textBaseline = 'top';
  const ink = cssv('--ink') || '#111111', muted = cssv('--muted') || '#555555', rule = cssv('--line-strong') || '#999999', accent = cssv('--data') || '#1a6b4a';
  const fB = '"Sofia Sans",system-ui,sans-serif', fD = '"Sofia Sans Condensed","Sofia Sans",system-ui,sans-serif';
  const say = (text, px, y, o = {}) => {
    x.font = `${o.w || 400} ${px}px ${o.d ? fD : fB}`;
    x.fillStyle = o.c || ink;
    x.textAlign = o.a || 'left';
    x.fillText(o.max ? fitText(x, text, o.max) : text, o.x ?? M, y);
  };
  const s = sums(f, r);
  x.fillStyle = cssv('--surface') || '#ffffff';
  x.fillRect(0, 0, W, H);
  x.fillStyle = accent;
  x.fillRect(0, 0, W, 12);

  say(`Моят бюджет ${f.year}`, 64, 40, { w: 700, d: true });
  say(MODEL, 24, 116, { c: muted, max: W - 2 * M });

  // the three results side by side
  const colW = (W - 2 * M) / 3;
  [['Приходи', mn(r.revT), pct(s.pRev, 1), s.dRev], ['Разходи', mn(r.expT), pct(s.pExp, 1), s.dExp], [s.label, mn(s.mag), pct(s.pBal, 1), s.dBal]].forEach((c, i) => {
    const cx = M + i * colW;
    say(c[0], 24, 172, { w: 700, c: muted, x: cx });
    say(c[1], 46, 204, { w: 700, d: true, x: cx, max: colW - 24 });
    say(`${c[2]} от БВП`, 24, 266, { x: cx });
    say(c[3], 21, 300, { c: muted, x: cx, max: colW - 24 });
  });

  // the footer decides how much room the list of changes has
  const off = r.changes.some(c => c.measure);
  const foot = [
    'Бюджет на светло · опростен модел, не е официален разчет',
    sourceLine({ source: ['zdb', 'kfp'], asOf: f.kAsOf }),
    ...(off ? [sourceLine({ source: f.mSrc, asOf: f.mAsOf })] : [])
  ];
  const footTop = H - 34 - foot.length * 26;
  const head = 358, top = head + 46, rowH = 32;
  x.fillStyle = rule;
  x.fillRect(M, head - 16, W - 2 * M, 2);
  say('Какво промених', 28, head, { w: 700 });
  say('Ефект върху салдото', 20, head + 6, { c: muted, a: 'right', x: W - M });
  say('Промяна', 20, head + 6, { c: muted, a: 'right', x: W - M - 250 });
  const room = Math.max(1, Math.min(8, Math.floor((footTop - 12 - top) / rowH)));
  if (!r.changes.length) {
    say('Още не съм променял нищо: бюджетът е равен на плана.', 24, top, { c: muted });
  } else {
    const shown = r.changes.length > room ? room - 1 : r.changes.length;
    r.changes.slice(0, shown).forEach((c, i) => {
      const y = top + i * rowH;
      say(c.what, 22, y, { max: 690 });
      say(c.change, 22, y, { a: 'right', x: W - M - 250 });
      say(smn(c.balT), 22, y, { a: 'right', x: W - M, w: 700 });
    });
    const more = r.changes.length - shown;
    if (more > 0) say(`… и още ${more} ${more === 1 ? 'промяна' : 'промени'}`, 22, top + shown * rowH, { c: muted });
  }
  foot.forEach((t, i) => say(t, i ? 18 : 20, footTop + i * 26, { w: i ? 400 : 700, c: i ? muted : ink, max: W - 2 * M }));
  return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
}

/* ---------------------------------------------------------------- behaviour */
export function mount(root, ctx) {
  const f = frame(ctx);
  if (!f || !sim) return undefined;
  const $ = sel => root.querySelector(sel);
  let raf = 0, scrollRaf = 0, annTimer = 0, dead = false, busy = false;

  /** one short message: visible under the buttons and read out through the shell's polite live region */
  const say = text => {
    const el = $('#s32-msg');
    if (el) el.textContent = text;
    ctx.announce?.(text);
  };

  /** the texts around one slider, from the state */
  const paintCtl = (el, line, p) => {
    el.closest('.s32-ctl')?.setAttribute('data-changed', p ? 'true' : 'false');
    const v = $(`#${el.id}-v`), n = $(`#${el.id}-n`);
    if (v) v.textContent = valText(line, p);
    if (n) n.textContent = `Така: ${mn(newT(line, p))}`;
    el.setAttribute('aria-valuetext', speak(line, p));
  };
  /** every control from the state: after „Върни към плана“ and after a restore */
  const syncControls = () => {
    root.querySelectorAll('input.s32-range').forEach(el => {
      const line = linesOf(f, el.dataset.k).find(l => l.id === el.dataset.l);
      if (!line) return;
      const p = sim[el.dataset.k][line.id] || 0;
      el.value = String(p);
      paintCtl(el, line, p);
    });
    root.querySelectorAll('input[data-m]').forEach(el => { el.checked = sim.on[el.dataset.m] !== false; });
  };

  /** the chart, its description and its table twin are updated in place: the figure is never built twice */
  const updateChart = r => {
    const spec = chartSpec('s32-cmp'), fig = $('#s32-cmp-fig');
    if (!spec || !fig) return;
    const fresh = cmpSpec(f, r), old = spec.desc;
    spec.series.forEach((s, i) => { s.data = fresh.series[i].data; });
    spec.desc = fresh.desc;
    spec.table.rows.length = 0;
    spec.table.rows.push(...fresh.table.rows);
    const box = fig.querySelector('.chart');
    if (!box) return;
    if (old) box.setAttribute('aria-label', (box.getAttribute('aria-label') || '').replace(old, () => spec.desc));
    const twin = fig.querySelector('#s32-cmp-tbl .disc-body');
    if (twin) twin.innerHTML = dataTable({ id: 's32-cmp-t', caption: `Данни за графиката: ${spec.title}`, columns: spec.table.columns, rows: spec.table.rows, dense: true }).s;
    if (box.dataset.ready === '1' && window.echarts) window.echarts.getInstanceByDom(box)?.setOption(buildOption(spec, { width: box.clientWidth }), false);
  };

  /** everything that shows the result, once per frame */
  const flush = () => {
    raf = 0;
    if (dead) return;
    const r = compute(f, sim);
    const rows = $('#s32-rows'), says = $('#s32-says'), mini = $('#s32-mini-in'), chg = $('#s32-chg-body');
    if (rows) rows.innerHTML = rowsHtml(f, r).s;
    if (says) says.textContent = saysText(f, r);
    if (mini) mini.innerHTML = miniInner(f, r).s;
    if (chg) chg.innerHTML = chgBody(f, r).s;
    updateChart(r);
  };
  const flushNow = () => { if (raf) cancelAnimationFrame(raf); flush(); };
  /** redraw soon, and read the result out once the visitor has stopped moving things for a moment (not on every key press) */
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(flush);
    clearTimeout(annTimer);
    annTimer = setTimeout(() => { if (!dead) ctx.announce?.(liveText(f, compute(f, sim))); }, 700);
  };

  const onInput = e => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.classList.contains('s32-range')) return;
    const line = linesOf(f, el.dataset.k).find(l => l.id === el.dataset.l);
    if (!line) return;
    const p = Math.max(-RANGE, Math.min(RANGE, Math.round(Number(el.value)) || 0));
    sim[el.dataset.k][line.id] = p;
    paintCtl(el, line, p);
    queue();
  };
  const onChange = e => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || !el.dataset.m) return;
    sim.on[el.dataset.m] = el.checked;
    queue();
  };

  const dropOffer = () => $('#s32-offer')?.remove();
  const firstSlider = () => $('input.s32-range');
  const reset = () => {
    sim = blank(f);
    syncControls();
    flushNow();
    say('Върнато към плана.');
  };
  const save = () => {
    if (isBlank(sim)) { say('Няма какво да запазя: бюджетът е равен на плана.'); return; }
    if (!saved.set(SLOT, { rev: { ...sim.rev }, exp: { ...sim.exp }, on: { ...sim.on } })) { say('Не мога да запазя в този браузър — свали картинката'); return; }
    dropOffer();
    say(`Запазено в този браузър на ${stamp(saved.get(SLOT)?.at || new Date().toISOString())}.`);
  };
  const restore = () => {
    const rec = saved.get(SLOT), s = rec && clean(f, rec.data);
    dropOffer();
    if (!s) { say('Няма запазен бюджет, който да върна.'); return; }
    sim = s;
    syncControls();
    flushNow();
    firstSlider()?.focus();
    say(`Върнах запазения бюджет от ${stamp(rec.at)}.`);
  };
  const forget = () => {
    saved.remove(SLOT);
    dropOffer();
    firstSlider()?.focus();
    say('Запазеният бюджет е изтрит от този браузър.');
  };
  const png = async () => {
    if (busy) return;
    busy = true;
    say('Правя картинката…');
    try {
      const blob = await card(f, compute(f, sim));
      if (!blob) throw new Error('no picture');
      download(blob, 'bns-moyat-byudzhet.png');
      if (!dead) say('Картинката е свалена.');
    } catch {
      if (!dead) say('Не успях да направя картинката. Опитай пак.');
    } finally { busy = false; }
  };
  const onClick = e => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (!b || !root.contains(b)) return;
    ({ 's32-save': save, 's32-reset': reset, 's32-png': png, 's32-restore': restore, 's32-forget': forget })[b.id]?.();
  };

  /* the slim result under the top bar (small screens only): shown while some control is on screen and the full result is not.
     Not shown at page load (the controls start far below the first screen) and not once the controls have scrolled away. */
  const mini = $('#s32-mini');
  const updateMini = () => {
    scrollRaf = 0;
    if (dead || !mini || getComputedStyle(mini).display === 'none') return;
    const th = document.querySelector('.topbar')?.getBoundingClientRect().height || 56;
    const first = $('.s32-ctl'), main = $('#s32-main'), res = $('#s32-result');
    if (!first || !main || !res) return;
    const on = first.getBoundingClientRect().top < window.innerHeight - 40 && main.getBoundingClientRect().bottom > th + 96 && res.getBoundingClientRect().top > window.innerHeight - 24;
    mini.classList.toggle('is-on', on);
  };
  const onScroll = () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(updateMini); };

  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  updateMini();
  return () => {
    dead = true;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(scrollRaf);
    clearTimeout(annTimer);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
}
