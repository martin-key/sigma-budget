// S18 Колко плащам аз? (G3). Calculator: gross salary -> net pay, contributions, tax, and a "receipt" by function.
// Privacy: the salary is never written to the URL and never leaves the browser (no query / data-query on the controls).
// Pure maths lives in ../calc.js (checked against v3.6 to the cent); this module only parses, reconciles, formats and draws.
import { html, raw } from '../html.js';
import { num, pct, eur, leva, date, perPerson, EUR_RATE } from '../format.js';
import { block } from '../ui/block.js';
import { seg } from '../ui/seg.js';
import { field, textInput, selectInput, toggle } from '../ui/forms.js';
import { disclosure } from '../ui/disclosure.js';
import { dataTable } from '../ui/table.js';
import { chart } from '../ui/chart.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { emptyState, pendingState, mockNote, mockHidden, mockBadge } from '../ui/states.js';
import { linkCard, callout } from '../ui/cards.js';
import { gl } from '../ui/gl.js';
import { srcTag } from '../ui/source.js';
import { employmentCalc, ruleSets, receiptByFunction, indirectTaxes, apportion } from '../calc.js';

const MAX_GROSS = 10000000;
const SLIDER_MAX = 6000;
const SLIDER_STEP = 50;
const IMPLEMENTED = new Set(['employment']);
const SCENARIOS = [
  ['employment', 'Трудов договор'],
  ['self-employed', 'Самоосигуряващ се'],
  ['management-contract', 'Договор за управление'],
  ['pensioner', 'Пенсионер'],
];
const ERR_POSITIVE = 'Въведи сума над 0';
const ERR_NONNEG = 'Въведи сума от 0 нагоре';
const DEFAULTS = { scenario: 'employment', gross: '1500', rules: 'from', tzpb: null, ind: false, purchases: '800', fuel: '', tobacco: '', split: 'function' };

// Input memory across 'rerender' only (period / unit / leva / only-real switches). A documented exception to the
// "no module state" rule: it is written only by input handlers and reset on every other navigation.
let mem = { ...DEFAULTS };
export const resetMem = () => { mem = { ...DEFAULTS }; return mem; };
export const getMem = () => mem;

/* ------------------------------------------------------------------ small helpers */
export function round2(v) {
  if (!Number.isFinite(v)) return v;
  const a = Math.abs(v);
  if (String(a).includes('e')) return Math.round(v * 100) / 100;
  return Math.sign(v) * Number(`${Math.round(Number(`${a}e2`))}e-2`);
}
const pctTrim = (v, d = 2) => num(v, d).replace(/(,\d*?)0+$/, '$1').replace(/,$/, '');
const e2 = v => eur(v, 2);
const e0 = v => eur(v, 0);

/** "1500", "1 500,50", "1.500,50", "1,500.50", "1500 €" -> {value} | {blank:true} | {error:true} */
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[\s  €]/g, '');
  if (s === '') return { blank: true };
  s = s.replace(/[.,]$/, '');
  if (s === '') return { error: true };
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (commas) {
    if (commas > 1) { if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); } else s = s.replace(',', '.');
  } else if (dots && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: true };
  const value = Number(s);
  return Number.isFinite(value) ? { value } : { error: true };
}

/* ------------------------------------------------------------------ environment (data) */
export function getEnv(ctx) {
  const rates = ctx.data.rates || null;
  const scenarios = Array.isArray(rates?.scenarios) ? rates.scenarios : [];
  const emp = scenarios.find(s => s && s.id === 'employment') || null;
  let sets = [];
  try {
    if (emp && emp.status !== 'pending' && employmentCalc(1000, emp) !== null) sets = ruleSets(emp);
  } catch { sets = []; }
  const core = ctx.core || ctx.data.core || {};
  const last = sets[sets.length - 1];
  const yr = Number(String(last?.to || last?.from || '').slice(0, 4));
  return {
    rates, scenarios, emp, sets, ready: sets.length > 0,
    assum: ctx.data['mock/tax-assumptions'] || null,
    fns: Array.isArray(core.functions) ? core.functions : [],
    persons: core.population?.persons ?? null,
    onlyReal: !!ctx.store.get('onlyReal'),
    leva: !!ctx.store.get('leva'),
    year: Number.isFinite(yr) && yr > 2000 ? yr : (ctx.period?.year || 2026),
  };
}

/* ------------------------------------------------------------------ the calculation (state -> numbers) */
export function compute(st, env) {
  const errors = { gross: null, purchases: null, fuel: null, tobacco: null };
  if (!env.ready) return { kind: 'pending', errors };
  if (!IMPLEMENTED.has(st.scenario)) return { kind: 'scenario', errors };
  const g = parseAmount(st.gross);
  if (g.blank) return { kind: 'empty', errors };
  if (g.error || !(g.value > 0)) { errors.gross = ERR_POSITIVE; return { kind: 'empty', errors }; }
  if (g.value > MAX_GROSS) { errors.gross = `Въведи сума до ${num(MAX_GROSS)} €`; return { kind: 'empty', errors }; }
  const gross = round2(g.value);

  const tzNum = Number(st.tzpb);
  const opts = { rules: env.sets.length > 1 && ['until', 'from', 'year'].includes(st.rules) ? st.rules : 'from' };
  if (st.tzpb != null && st.tzpb !== '' && Number.isFinite(tzNum)) opts.tzpb = tzNum;
  const r = employmentCalc(gross, env.emp, opts);
  if (!r) return { kind: 'empty', errors };

  // every line is the rounding of its own formula (as on a payslip); net and totals are sums of the displayed lines
  const emp = round2(r.employeeContrib), tax = round2(r.incomeTax), er = round2(r.employerContrib);
  const net = round2(gross - emp - tax);
  const total = round2(emp + tax + er);
  // yearly figures: 12 x the rounded months; in whole-year mode the months are averages, so round the exact yearly sums
  let yEmp = round2(emp * 12), yTax = round2(tax * 12), yEr = round2(er * 12);
  if (opts.rules === 'year') { yEmp = round2(r.employeeContrib * 12); yTax = round2(r.incomeTax * 12); yEr = round2(r.employerContrib * 12); }
  const yTotal = round2(yEmp + yTax + yEr);
  const yGross = round2(gross * 12);
  const yNet = round2(yGross - yEmp - yTax);
  const labour = gross + er;
  const statePct = labour > 0 ? (total / labour) * 100 : null;
  const shares = apportion([net, emp, tax, er], 100, 1) || [net, emp, tax, er].map(v => round2((v / labour) * 100));

  // optional indirect taxes (model data: only when asked for and not hidden by "only real data")
  let ind = null;
  if (st.ind && !env.onlyReal && env.assum) {
    const inp = {};
    for (const [k, key] of [['purchases', 'purchasesEur'], ['fuel', 'fuelEur'], ['tobacco', 'tobaccoEur']]) {
      const a = parseAmount(st[k]);
      if (a.blank) continue;
      if (a.error) { errors[k] = ERR_NONNEG; continue; }
      if (a.value > 0) inp[key] = a.value;
    }
    ind = { any: Object.keys(inp).length > 0, inp, unavailable: false, rows: [], total: 0, yTotal: 0 };
    if (ind.any) {
      const t = indirectTaxes(inp, env.assum);
      const rows = [];
      if (t && t.vat != null) rows.push({ id: 'vat', label: 'ДДС', month: round2(t.vat) });
      if (t && inp.fuelEur && t.fuelExcise != null) rows.push({ id: 'fuel', label: 'Акциз върху горивата', month: round2(t.fuelExcise) });
      if (t && inp.tobaccoEur && t.tobaccoExcise != null) rows.push({ id: 'tobacco', label: 'Акциз върху тютюневите изделия', month: round2(t.tobaccoExcise) });
      const wanted = 1 + (inp.fuelEur ? 1 : 0) + (inp.tobaccoEur ? 1 : 0);
      if (!t || t.total == null || rows.length < wanted) ind.unavailable = true;
      else {
        ind.rows = rows.map(x => ({ ...x, year: round2(x.month * 12) }));
        ind.total = round2(rows.reduce((s, x) => s + x.month, 0));
        ind.yTotal = round2(ind.rows.reduce((s, x) => s + x.year, 0));
      }
    }
  }
  return { kind: 'ok', errors, gross, r, rules: opts.rules, emp, tax, er, net, total, yEmp, yTax, yEr, yTotal, yGross, yNet, statePct, shares, ind };
}

/* ------------------------------------------------------------------ inputs block (static; repainted only on a full render) */
const moneyControl = (id, value, error) => html`<span class="s18-money">${textInput({ id, name: id, value, type: 'text', inputmode: 'decimal', autocomplete: 'off', hint: true, error })}<span class="s18-cur" aria-hidden="true">€</span></span>`;
const moneyField = (id, label, hint, value, error) => field({ id, label, hint, error, control: moneyControl(id, value, error) });

export function sliderState(text) {
  const p = parseAmount(text);
  const ok = p.value != null && p.value > 0;
  const v = ok ? Math.min(SLIDER_MAX, p.value) : 0;
  const shown = ok ? num(round2(p.value), Number.isInteger(round2(p.value)) ? 0 : 2) : '—';
  return { v, fill: (v / SLIDER_MAX) * 100, shown, valuetext: ok ? `${shown} евро` : 'Няма въведена сума' };
}

function rulesBlock(st, env) {
  const sets = env.sets;
  if (sets.length < 2) return '';
  const first = sets[0], last = sets[sets.length - 1];
  const options = [
    { value: 'until', label: first.to ? `До ${date(first.to)}` : 'По старите правила' },
    { value: 'from', label: `От ${date(last.from)}` },
    { value: 'year', label: `Цялата ${env.year} г.` },
  ];
  const ceil = sets.map(s => `${e2(s.maxInsurableEur)} ${s === last ? `от ${date(s.from)}` : `до ${date(s.to)}`}`).join(' и ');
  const small = Math.min(...sets.map(s => s.maxInsurableEur));
  const months = sets.map(s => s.months).join(' + ');
  return html`<div class="s18-group">
    <p class="field-label" aria-hidden="true">По кои правила да смятаме?</p>
    ${seg({ name: 's18-rules', label: 'По кои правила да смятаме?', value: st.rules, options, cls: 's18-seg' })}
    <p class="field-hint">Максималният осигурителен доход е ${ceil}. Разликата личи само при заплата над ${e2(small)}. „Цялата година“ смята ${months} месеца по двата набора правила.</p>
  </div>`;
}

function tzpbBlock(st, env) {
  const t = env.emp?.tzpbPct;
  if (!t || !Number.isFinite(t.min) || !Number.isFinite(t.max) || !(t.max > t.min)) return '';
  const options = [];
  for (let k = Math.round(t.min * 10); k <= Math.round(t.max * 10); k++) options.push({ value: String(k / 10), label: `${pctTrim(k / 10, 1)}%` });
  const cur = st.tzpb != null && st.tzpb !== '' ? String(Number(st.tzpb)) : String(t.used ?? t.min);
  return field({
    id: 's18-tzpb', label: 'Вноска ТЗПБ на работодателя, %',
    hint: `ТЗПБ е вноската за трудова злополука и професионална болест. Размерът ѝ зависи от дейността на работодателя: от ${pctTrim(t.min, 1)}% до ${pctTrim(t.max, 1)}%. Ако не знаеш, остави предварително избраната стойност.`,
    control: selectInput({ id: 's18-tzpb', name: 's18-tzpb', options, value: cur, hint: true }),
  });
}

function indirectBlock(st, c, env) {
  if (env.onlyReal) return mockHidden('Скрити са косвените данъци: те са с примерни данни.');
  const A = env.assum;
  const on = !!st.ind && !!A;
  const body = html`
    <p>В цените на стоките има вграден ${gl('dds', 'ДДС')} и ${gl('aktsiz', 'акциз')}. Тук можеш да добавиш ориентировъчна оценка. Тя е по примерни допускания, затова е отделена от реалните ставки.</p>
    ${A ? mockNote('Ставките на ДДС и акциза са реални. Цените и дялът на облагаемите покупки са допускания, а не данни, затова оценката е ориентировъчна.') : ''}
    ${toggle({ id: 's18-ind', label: 'Добави косвените данъци към сметката', checked: on, attrs: raw(` aria-controls="s18-ind-fields"${A ? '' : ' disabled'}`) })}
    ${A ? '' : html`<p class="field-hint">Допусканията за косвените данъци още не са заредени.</p>`}
    <div id="s18-ind-fields" class="s18-ind-fields"${on ? '' : raw(' hidden')}>
      ${moneyField('s18-purchases', 'Покупки на месец, €', 'Стоки и услуги с ДДС, без гориво и тютюн.', st.purchases, c.errors.purchases)}
      ${moneyField('s18-fuel', 'Гориво на месец, €', 'Остави празно, ако не купуваш.', st.fuel, c.errors.fuel)}
      ${moneyField('s18-tobacco', 'Тютюневи изделия на месец, €', 'Остави празно, ако не купуваш.', st.tobacco, c.errors.tobacco)}
    </div>`;
  return disclosure({ id: 's18-indirect', title: 'Косвени данъци (по желание)', meta: mockBadge(), open: on, body });
}

/* one visible line beside the inputs (narrow screens only, by CSS): the full result is further down the page */
export function quickMarkup(c) {
  return c.kind === 'ok' ? html`Нето в ръка: <strong>${e2(c.net)}</strong> на месец` : '';
}

function inputsBlock(st, c, env) {
  const sv = sliderState(st.gross);
  const scenarioOptions = SCENARIOS.map(([id, label]) => ({
    value: id,
    label: IMPLEMENTED.has(id) && env.scenarios.some(s => s.id === id && s.status !== 'pending') ? label : `${label} (предстои)`,
  }));
  return block({
    id: 's18-inputs', title: 'Твоите данни', status: false, share: false, report: false,
    body: html`
      <div class="s18-group">
        <p class="field-label" aria-hidden="true">Как работиш?</p>
        ${seg({ name: 's18-scenario', label: 'Как работиш?', value: st.scenario, options: scenarioOptions, cls: 's18-seg' })}
      </div>
      ${moneyField('s18-gross', 'Брутна заплата на месец, €', html`Въведи ${gl('brutna-zaplata', 'брутната заплата')}, преди данъци и осигуровки. Например: 1500 или 1 500,50.`, st.gross, c.errors.gross)}
      <div class="s18-slider-row">
        <label class="s18-slider-label" for="s18-slider">Плъзгач за заплатата</label>
        <input class="s18-slider" id="s18-slider" type="range" min="0" max="${SLIDER_MAX}" step="${SLIDER_STEP}" value="${sv.v}" aria-valuetext="${sv.valuetext}" style="--s18-fill:${sv.fill}%">
        <span class="s18-slider-val" id="s18-slider-val" aria-hidden="true">${sv.shown}${sv.shown === '—' ? '' : raw('&nbsp;€')}</span>
      </div>
      <p id="s18-quick" class="s18-quick">${quickMarkup(c)}</p>
      ${rulesBlock(st, env)}
      ${tzpbBlock(st, env)}
      ${indirectBlock(st, c, env)}`,
  });
}

/* ------------------------------------------------------------------ result view (repainted on every change) */
function basisText(c, env) {
  const r = c.r, sets = env.sets;
  const tz = r.tzpbPct != null ? ` Вноска ТЗПБ на работодателя: ${pctTrim(r.tzpbPct, 1)}%.` : '';
  if (c.rules === 'year' && Array.isArray(r.byPeriod) && r.byPeriod.length) {
    const bits = r.byPeriod.map(p => `${p.months} мес. с максимален осигурителен доход ${e2(p.maxInsurable)}`).join(', ');
    return `Цялата ${env.year} г.: ${bits}. Месечните суми са средни за годината.${tz}`;
  }
  const one = sets.length > 1 ? (c.rules === 'until' ? `Правила до ${date(sets[0].to)}` : `Правила от ${date(sets[sets.length - 1].from)}`) : 'Действащи правила';
  return `${one}. Максимален осигурителен доход: ${e2(r.maxInsurable)} на месец.${tz}`;
}

function payslip(c) {
  const r = c.r;
  const strong = (v, row) => (row.strong ? html`<strong>${v}</strong>` : v);
  const cols = [
    { key: 'label', label: 'Ред', fmt: strong },
    { key: 'month', label: 'На месец', unit: '€', d: 2, fmt: (v, row) => (row.strong ? html`<strong>${num(v, 2)}</strong>` : num(v, 2)) },
    { key: 'year', label: 'На година', unit: '€', d: 2, fmt: (v, row) => (row.strong ? html`<strong>${num(v, 2)}</strong>` : num(v, 2)) },
  ];
  const rows = [
    { label: 'Брутна заплата', month: c.gross, year: c.yGross },
    { label: `Твои осигуровки (${pctTrim(r.employeePct)}%)`, month: -c.emp, year: -c.yEmp },
    { label: `Данък върху дохода (${pctTrim(r.incomeTaxPct)}%)`, month: -c.tax, year: -c.yTax },
    { label: 'Нето в ръка', month: c.net, year: c.yNet, strong: true },
    { label: `Осигуровки на работодателя (${pctTrim(r.employerPct)}%), не се виждат във фиша ти`, month: c.er, year: c.yEr },
  ];
  return dataTable({
    id: 's18-payslip', caption: 'Месечен и годишен разчет на заплатата', columns: cols, rows,
    total: { label: 'Данъци и осигуровки общо', values: { month: c.total, year: c.yTotal } },
  });
}

function indirectView(c, env) {
  const ind = c.ind;
  if (!ind) return '';
  const head = html`<h3 class="s18-h3">Косвени данъци, ориентировъчно</h3>`;
  if (!ind.any) return html`${head}<p class="field-hint">Въведи сума за покупки, гориво или тютюн, за да видиш ориентировъчна оценка.</p>`;
  if (ind.unavailable) return html`${head}${mockNote('Оценка не може да се направи: липсват допускания за част от стоките.')}`;
  return html`${head}
    ${mockNote('Тези суми са ориентировъчни. Смятани са по примерни допускания за цени и дял на облагаемите стоки, а не по твоите разходи.')}
    ${dataTable({
      id: 's18-indirect-table', caption: 'Ориентировъчни косвени данъци, които плащаш чрез цените', status: 'mock',
      columns: [{ key: 'label', label: 'Данък' }, { key: 'month', label: 'На месец', unit: '€', d: 2 }, { key: 'year', label: 'На година', unit: '€', d: 2 }],
      rows: ind.rows.map(x => ({ ...x, _mock: true })),
      total: { label: 'Общо косвени данъци', values: { month: ind.total, year: ind.yTotal } },
    })}`;
}

export function resultMarkup(c, st, env) {
  if (c.kind === 'pending') return pendingState({ title: 'Калкулаторът предстои', text: 'Ставките за 2026 г. още не са заредени, затова не показваме числа.', source: ['nap'] });
  if (c.kind === 'scenario') {
    const label = (SCENARIOS.find(([id]) => id === st.scenario) || [])[1] || 'Този вариант';
    return pendingState({ title: `${label}: ставките предстоят`, text: 'Ставките за този вариант още не са извлечени от официалните документи, затова не показваме числа. Засега можеш да изчислиш сметката за трудов договор.' });
  }
  if (c.kind === 'empty') return emptyState({ title: 'Въведи брутна заплата', text: 'Сума над 0 €, например 1500. Резултатът се появява тук.', icon: 'banknote' });
  const r = c.r, labour = round2(c.gross + c.er);
  const netSub = `От ${e2(c.gross)} брутна заплата.${env.leva ? ` Около ${leva(c.net * EUR_RATE, 2)}.` : ''}`;
  const tiles = kpiGrid([
    kpi({ label: 'Нето в ръка', value: num(c.net, 2), unit: '€ на месец', sub: netSub }),
    kpi({ label: 'Данъци и осигуровки общо', value: num(c.yTotal, 0), unit: '€ на година', sub: `${e2(c.total)} на месец, заедно с осигуровките на работодателя.` }),
    kpi({ label: 'Дял за данъци и осигуровки', value: num(c.statePct, 1), unit: '% от цената на труда', sub: `Цената на труда е ${e2(labour)} на месец: брутната заплата плюс осигуровките на работодателя.` }),
  ], { label: 'Резултат' });
  const capped = r.capped ? callout({
    kind: 'info', title: 'Над максималния осигурителен доход',
    body: c.rules === 'year'
      ? html`<p>Брутната заплата е над максималния осигурителен доход поне за част от годината. Осигуровките се смятат само върху него. Данъкът се смята върху цялата заплата, след осигуровките.</p>`
      : html`<p>Брутната заплата е над максималния осигурителен доход (${e2(r.maxInsurable)}). Осигуровките се смятат само върху него. Данъкът се смята върху цялата заплата, след осигуровките.</p>`,
  }) : '';
  const segs = [
    { label: 'Нето в ръка', v: c.net, p: c.shares[0] }, { label: 'Твои осигуровки', v: c.emp, p: c.shares[1] },
    { label: 'Данък върху дохода', v: c.tax, p: c.shares[2] }, { label: 'Осигуровки на работодателя', v: c.er, p: c.shares[3] },
  ];
  return html`
    <p class="s18-basis">${basisText(c, env)}</p>
    ${tiles}
    ${capped}
    <h3 class="s18-h3">Как се разпределя цената на труда за един месец</h3>
    <div class="s18-bar" aria-hidden="true">${segs.map((s, i) => html`<span class="s18-bar-seg" style="width:${s.p}%;background:var(--series-${i + 1})"></span>`)}</div>
    <ul class="s18-legend">${segs.map((s, i) => html`<li><span class="s18-sw" style="background:var(--series-${i + 1})" aria-hidden="true"></span><span class="s18-lg-name">${s.label}</span><span class="s18-lg-val"><strong>${e2(s.v)}</strong> <span class="s18-muted">(${pct(s.p, 1)})</span></span></li>`)}</ul>
    <h3 class="s18-h3">Фиш за заплата</h3>
    ${payslip(c)}
    ${indirectView(c, env)}`;
}

export function liveText(c) {
  if (c.kind === 'ok') return `Нето в ръка: ${num(c.net, 2)} евро на месец. Данъци и осигуровки общо: ${num(c.yTotal, 0)} евро на година.`;
  if (c.kind === 'scenario') return 'Ставките за този вариант предстоят.';
  return '';
}

/* ------------------------------------------------------------------ receipt by function (repainted on every change) */
function functionTable(id, caption, pot, env, ctx) {
  const decimals = pot >= 1000 ? 0 : 2;
  const rec = receiptByFunction(pot, env.fns, { decimals });
  if (!rec.length) return pendingState({ title: 'Разходите по функции предстоят', source: ['asbp'] });
  rec.sort((a, b) => b.yearEur - a.yearEur);
  const sh = apportion(rec.map(x => x.sharePct), 100, 1) || rec.map(x => round2(x.sharePct));
  const byId = new Map(env.fns.map(f => [f.id, f]));
  const rows = rec.map((x, i) => ({ name: byId.get(x.id)?.short || x.name, year: x.yearEur, day: x.dayEur, share: sh[i], _href: ctx.href('S08', { fn: x.id }) }));
  return dataTable({
    id, caption, dense: true,
    columns: [
      { key: 'name', label: 'Функция' },
      { key: 'year', label: 'На година', unit: '€', d: decimals },
      { key: 'day', label: 'На ден', unit: '€', d: 2 },
      { key: 'share', label: 'Дял', unit: '%', d: 1 },
    ],
    rows,
    total: { label: 'Общо', values: { year: round2(rec.reduce((s, x) => s + x.yearEur, 0)), day: round2(rec.reduce((s, x) => s + x.dayEur, 0)), share: 100 } },
  });
}

function fundRows(c) {
  const ep = c.r.employeeParts, rp = c.r.employerParts;
  const yC = round2(c.yEmp + c.yEr);
  const one = [{ label: 'Осигуровки (общо)', year: yC }];
  if (!ep || !rp) return one;
  const defs = [['doo', 'Държавно обществено осигуряване (ДОО)'], ['upf', 'Универсален пенсионен фонд (УПФ)'], ['health', 'Здравно осигуряване (НЗОК)'], ['tzpb', 'Трудова злополука и професионална болест (ТЗПБ)']];
  const w = defs.map(([k]) => (Number(ep[k]) || 0) + (Number(rp[k]) || 0));
  const y = apportion(w, yC, 2);
  if (!y || y.some(v => v == null)) return one;
  return defs.map(([, label], i) => ({ label, year: y[i] })).filter((x, i) => w[i] > 0);
}

export function receiptMarkup(c, st, env, ctx) {
  if (c.kind !== 'ok') return emptyState({ title: 'Разписката ще се покаже тук', text: 'Въведи брутна заплата над 0 €, за да видиш къде биха отишли данъците и осигуровките ти.', icon: 'list' });
  if (!env.fns.length) return pendingState({ title: 'Разходите по функции предстоят', source: ['asbp'] });
  const indOn = !!(c.ind && c.ind.yTotal > 0 && !c.ind.unavailable);
  const indWords = indOn ? ', включително ориентировъчните косвени данъци' : '';
  if (st.split === 'separate') {
    const funds = fundRows(c);
    const taxPot = round2(c.yTax + (indOn ? c.ind.yTotal : 0));
    return html`
      <p>Осигуровките отиват в отделни фондове. Затова ги показваме отделно, а само данъците разпределяме по функции на разходите.</p>
      <h3 class="s18-h3">Осигуровки по фондове</h3>
      ${dataTable({
        id: 's18-funds-table', caption: 'Осигуровки по фондове, твои и на работодателя',
        columns: [{ key: 'label', label: 'Фонд' }, { key: 'year', label: 'На година', unit: '€', d: 2 }],
        rows: funds, total: { label: 'Общо осигуровки', values: { year: round2(funds.reduce((s, x) => s + x.year, 0)) } },
      })}
      <h3 class="s18-h3">Данъци по функции на разходите</h3>
      <p>Данъкът върху дохода за година е ${e2(c.yTax)}${indWords}. Така би се разпределил:</p>
      ${functionTable('s18-tax-table', 'Къде биха отишли данъците ти по функции на разходите', taxPot, env, ctx)}`;
  }
  const pot = round2(c.yTotal + (indOn ? c.ind.yTotal : 0));
  return html`
    <p>Данъците и осигуровките ти за година са ${eur(pot, pot >= 1000 ? 0 : 2)}${indWords}, или около ${e2(round2(pot / 365))} на ден. Ако се разпределят като разходите в плана за ${env.year} г., това са сумите по функции.</p>
    ${functionTable('s18-receipt-table', 'Къде биха отишли данъците и осигуровките ти по функции на разходите', pot, env, ctx)}`;
}

function receiptBlock(st, c, env, ctx) {
  const totalMln = env.fns.reduce((s, f) => s + (Number(f.mln) || 0), 0);
  const perHead = env.persons && totalMln > 0 ? html` За сравнение: планираните разходи са около ${perPerson(totalMln, env.persons)} на жител на година.` : '';
  const foot = html`<p>Разпределението е по плана „2026 Проект“ и не се променя с избора на период. То е илюстрация: държавата не проследява всеки евро до конкретен разход.${perHead}</p>`;
  return block({
    id: 's18-receipt', title: 'Къде отиват парите ти', status: 'real', source: ['asbp'], share: false, report: false,
    sub: 'Колко от твоите данъци и осигуровки би отишло за всяка функция на държавата.',
    foot,
    body: html`
      <div class="s18-split">
        <p class="field-label" aria-hidden="true">Осигуровките:</p>
        ${seg({ name: 's18-split', label: 'Осигуровките', value: st.split, options: [{ value: 'function', label: 'По функции' }, { value: 'separate', label: 'Отделно' }], cls: 's18-seg' })}
      </div>
      <div id="s18-receipt-view">${receiptMarkup(c, st, env, ctx)}</div>`,
  });
}

/* ------------------------------------------------------------------ share card (plan shares only, never the salary) */
function shareSpec(env) {
  const fns = env.fns.filter(f => Number.isFinite(Number(f.share))).sort((a, b) => b.share - a.share);
  if (!fns.length) return null;
  const top = fns.slice(0, 3).map(f => `„${f.name}“ (${pct(f.share, 1)})`);
  return {
    id: 's18-share-chart', type: 'barh', title: `Как се разпределят разходите по функции, ${env.year} г.`, unit: '%', d: 1, fmt: v => pct(v, 1), labels: true,
    categories: fns.map(f => f.short || f.name), categoryLabel: 'Функция',
    series: [{ name: 'Дял от разходите', data: fns.map(f => Number(f.share)) }],
    desc: `Най-голям е делът на ${top[0]}, следван от ${top.slice(1).join(' и ')}.`,
    height: Math.max(180, 36 * fns.length + 40),
    min: 0, max: Math.ceil((Number(fns[0].share) * 1.25) / 5) * 5, // headroom, so the value label of the longest bar is not clipped on phones
  };
}

function shareBlock(env) {
  const spec = shareSpec(env);
  if (!spec) return block({ id: 's18-share', title: 'Карта за споделяне', status: 'pending', body: pendingState({ title: 'Разходите по функции предстоят', source: ['asbp'] }) });
  const top = env.fns.filter(f => Number.isFinite(Number(f.share))).sort((a, b) => b.share - a.share).slice(0, 3);
  const text = `Така държавата планира да разпредели разходите си за ${env.year} г.: ${top.map(f => `${f.name} ${pct(f.share, 1)}`).join(', ')}.`;
  return block({
    id: 's18-share', title: 'Карта за споделяне', status: 'real', source: ['asbp'], share: { text },
    sub: 'Само дялове от разходите, без твоята заплата. Можеш да я споделиш или да свалиш картинка.',
    body: html`${chart(spec)}<p class="field-hint">Картата не съдържа твои суми и не зависи от въведеното по-горе.</p>`,
  });
}

/* ------------------------------------------------------------------ methodology (numbers come from the rates data) */
function methodology(env) {
  const emp = env.emp;
  const ref = emp ? employmentCalc(1000, emp) : null;
  const applies = emp?.appliesTo || emp?.applies_to;
  const gvrs = Number(emp?.gvrsPct ?? emp?.gvrs_pct);
  const sets = env.sets;
  const months = sets.map(s => s.months).join(' + ');
  const body = html`
    ${applies ? html`<p><strong>За кого важи.</strong> ${applies}</p>` : ''}
    ${ref ? html`<p><strong>Формули.</strong> Осигурителният доход е брутната заплата, но не повече от максималния осигурителен доход.</p>
    <ul>
      <li>Твои осигуровки = осигурителен доход × ${pctTrim(ref.employeePct)}%.</li>
      <li>Данък върху дохода = (брутна заплата − твои осигуровки) × ${pctTrim(ref.incomeTaxPct)}%.</li>
      <li>Нето в ръка = брутна заплата − твои осигуровки − данък.</li>
      <li>Осигуровки на работодателя = осигурителен доход × ${pctTrim(ref.employerPct)}%. Те включват вноската ТЗПБ от ${pctTrim(ref.tzpbPct, 1)}%, която зависи от дейността.</li>
    </ul>` : ''}
    ${sets.length > 1 ? html`<p><strong>Правила през годината.</strong> Максималният осигурителен доход се променя в средата на годината. „Цялата година“ смята ${months} месеца по двата набора правила и показва средни месечни суми.</p>` : ''}
    ${Number.isFinite(gvrs) ? html`<p>Вноската за фонд „Гарантирани вземания на работниците и служителите“ е ${pctTrim(gvrs)}% през ${env.year} г.</p>` : ''}
    <p><strong>Какво не е включено.</strong> Не се отчитат данъчни облекчения (например за деца или за хора с увреждания), други доходи и доброволни осигуровки.</p>
    <p><strong>Накъде отиват парите.</strong> ${gl('osiguritelen-dohod', 'Осигурителният доход')} определя вноските. Те отиват в отделни фондове, а ${gl('danak-varhu-dohodite', 'данъкът върху дохода')} влиза в приходите на бюджета. Разписката разпределя твоята сума по дяловете на функциите в плана. Това е изчисление по пропорция, а не проследяване на всеки евро.</p>
    <p><strong>Източници.</strong> Ставки: ${srcTag(['nap', 'zbdoo', 'zbnzok'])}. Разходи по функции: ${srcTag(['asbp'])}. Ставките са от официалните документи и предстои да бъдат потвърдени от експерт по публични финанси.</p>`;
  return disclosure({ id: 's18-method', title: 'Как се смята', body });
}

/* ------------------------------------------------------------------ page */
export const needs = ['core', 'rates?', 'mock/tax-assumptions?'];
export const styles = ['s18-danaci'];
export const lede = () => 'Въведи брутната си заплата. Ще видиш колко остава в ръката ти, колко отива за данъци и осигуровки и за какво се харчат. Всичко се смята в браузъра ти. Нищо не се записва и не се изпраща.';
export const embeds = {
  's18-share-chart': ctx => {
    const spec = shareSpec(getEnv(ctx));
    return spec ? { chart: spec, source: ['asbp'], status: 'real' } : null;
  },
};

export function render(ctx) {
  if (ctx.kind !== 'rerender') resetMem();
  const env = getEnv(ctx);
  const st = mem;
  const c = compute(st, env);
  const calc = env.ready
    ? html`<div class="s18-layout">
        <div class="s18-in">${inputsBlock(st, c, env)}</div>
        <div class="s18-out">
          ${block({
            id: 's18-result', title: 'Твоята сметка', status: 'real', statusLabel: 'Реални ставки', source: ['nap', 'zbdoo', 'zbnzok'], asOf: env.rates?.meta?.asOf, share: false, report: false,
            body: html`<p id="s18-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p><div id="s18-view">${resultMarkup(c, st, env)}</div>`,
          })}
          ${receiptBlock(st, c, env, ctx)}
        </div>
      </div>`
    : block({ id: 's18-pending', title: 'Калкулатор', status: 'pending', body: pendingState({ title: 'Калкулаторът предстои', source: ['nap'] }) });
  return html`
    ${calc}
    ${shareBlock(env)}
    ${methodology(env)}
    ${linkCard({ href: ctx.href('S12'), title: 'Мерки, които засягат работещите', text: 'Виж мерките от бюджета и кого засягат.', kicker: 'Още по темата', icon: 'fileText' })}`;
}

/* ------------------------------------------------------------------ behaviour */
export function mount(root, ctx) {
  const view = root.querySelector('#s18-view');
  if (!view) return undefined;
  const env = getEnv(ctx);
  const recView = root.querySelector('#s18-receipt-view');
  const live = root.querySelector('#s18-live');
  const q = id => root.querySelector(`#${id}`);
  let liveTimer = 0, lastLive = '';

  // field error: created / removed in place so the input keeps focus; role="alert" announces it once
  const setErr = (id, msg) => {
    const input = q(id), wrap = input && input.closest('.field');
    if (!input || !wrap) return;
    let p = q(`${id}-err`);
    const ids = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    if (msg) {
      if (!p) {
        p = document.createElement('p');
        p.className = 'field-error'; p.id = `${id}-err`; p.setAttribute('role', 'alert');
        wrap.appendChild(p);
      }
      if (p.textContent !== msg) p.textContent = msg;
      wrap.classList.add('field-bad');
      input.setAttribute('aria-invalid', 'true');
      ids.add(`${id}-err`);
    } else {
      if (p) p.remove();
      wrap.classList.remove('field-bad');
      input.removeAttribute('aria-invalid');
      ids.delete(`${id}-err`);
    }
    if (ids.size) input.setAttribute('aria-describedby', [...ids].join(' ')); else input.removeAttribute('aria-describedby');
  };

  const syncSlider = () => {
    const sl = q('s18-slider');
    if (!sl) return;
    const s = sliderState(mem.gross);
    sl.value = String(s.v);
    sl.style.setProperty('--s18-fill', `${s.fill}%`);
    sl.setAttribute('aria-valuetext', s.valuetext);
    const out = q('s18-slider-val');
    if (out) out.textContent = s.shown === '—' ? s.shown : `${s.shown} €`;
  };

  // one polite sentence, after the typing pauses (not on every keystroke)
  const queueLive = c => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (!live) return;
      const t = liveText(c);
      if (t === lastLive) return;
      lastLive = t;
      live.textContent = t;
    }, 800);
  };

  const refresh = () => {
    const c = compute(mem, env);
    view.innerHTML = String(resultMarkup(c, mem, env));
    if (recView) recView.innerHTML = String(receiptMarkup(c, mem, env, ctx));
    const quick = q('s18-quick');
    if (quick) quick.innerHTML = String(quickMarkup(c));
    setErr('s18-gross', c.errors.gross);
    for (const k of ['purchases', 'fuel', 'tobacco']) setErr(`s18-${k}`, c.errors[k]);
    syncSlider();
    queueLive(c);
  };

  const FIELD = { 's18-gross': 'gross', 's18-purchases': 'purchases', 's18-fuel': 'fuel', 's18-tobacco': 'tobacco' };
  const onInput = e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (FIELD[t.id]) { mem[FIELD[t.id]] = t.value; refresh(); }
    else if (t.id === 's18-slider') {
      mem.gross = String(t.value);
      const g = q('s18-gross');
      if (g) g.value = mem.gross;
      refresh();
    }
  };
  const onChange = e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
    if (t.name === 's18-scenario' && t.checked) { mem.scenario = t.value; refresh(); }
    else if (t.name === 's18-rules' && t.checked) { mem.rules = t.value; refresh(); }
    else if (t.name === 's18-split' && t.checked) { mem.split = t.value; refresh(); }
    else if (t.id === 's18-tzpb') { mem.tzpb = t.value; refresh(); }
    else if (t.id === 's18-ind') {
      mem.ind = !!t.checked;
      const f = q('s18-ind-fields');
      if (f) f.hidden = !mem.ind;
      refresh();
    }
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  return () => {
    clearTimeout(liveTimer);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
  };
}
