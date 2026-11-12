// S18 Моите данъци (V5). Gross monthly salary on an employment contract -> net pay, the employee's contributions, income tax and the
// employer's contributions, shown separately; details by fund, the step-by-step sum, sources and periods, a conditional illustration of the
// budget functions and an optional indirect-tax estimate sit in disclosures under the result.
// Privacy: the salary is never written to the URL and never leaves the browser (no query / data-query on the controls; the screen has no
// „Сподели“ menu, only the local picture button of the result block).
// Pure maths lives in ../calc.js (rates come from data/rates.json); this module only parses, reconciles, formats and draws.
import { html, raw } from '../html.js';
import { num, pct, eur, leva, date, perPerson, EUR_RATE } from '../format.js';
import { block } from '../ui/block.js';
import { seg } from '../ui/seg.js';
import { field, textInput, selectInput, toggle } from '../ui/forms.js';
import { disclosure } from '../ui/disclosure.js';
import { dataTable } from '../ui/table.js';
import { emptyState, pendingState, mockNote, mockHidden, mockBadge } from '../ui/states.js';
import { linkCard, callout } from '../ui/cards.js';
import { gl } from '../ui/gl.js';
import { srcTag } from '../ui/source.js';
import { employmentCalc, ruleSets, receiptByFunction, indirectTaxes, apportion } from '../calc.js';

const MAX_GROSS = 10000000;
const SLIDER_MAX = 6000;
const SLIDER_STEP = 50;
const ERR_POSITIVE = 'Въведи сума над 0';
const ERR_NONNEG = 'Въведи сума от 0 нагоре';
const DEFAULTS = {
  gross: '1500',
  rules: 'from',
  tzpb: null,
  ind: false,
  purchases: '',
  reduced: '',
  exempt: '',
  fuel: '',
  tobacco: '',
  fuelType: 'petrol',
  fuelPrice: null,
  tobaccoPrice: null,
  fuelPriceEdited: false,
  tobaccoPriceEdited: false,
  sticks: '',
  date: '2026-11-08',
};

// Input memory across 'rerender' only (period / unit / leva / only-real switches). A documented exception to the
// "no module state" rule: it is written only by input handlers and reset on every other navigation.
let mem = { ...DEFAULTS };
export const resetMem = () => {
  mem = { ...DEFAULTS };
  return mem;
};
export const getMem = () => mem;

/* ------------------------------------------------------------------ small helpers */
export function round2(v) {
  if (!Number.isFinite(v)) return v;
  const a = Math.abs(v);
  if (String(a).includes('e')) return Math.round(v * 100) / 100;
  return Math.sign(v) * Number(`${Math.round(Number(`${a}e2`))}e-2`);
}
const pctTrim = (v, d = 2) =>
  num(v, d)
    .replace(/(,\d*?)0+$/, '$1')
    .replace(/,$/, '');
const e2 = (v) => eur(v, 2);
const dm = (iso) =>
  typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
    : '';

/** "1500", "1 500,50", "1.500,50", "1,500.50", "1500 €" -> {value} | {blank:true} | {error:true} */
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[\s  €]/g, '');
  if (s === '') return { blank: true };
  s = s.replace(/[.,]$/, '');
  if (s === '') return { error: true };
  const dots = (s.match(/\./g) || []).length,
    commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    s = s
      .split(dec === '.' ? ',' : '.')
      .join('')
      .replace(dec, '.');
  } else if (commas) {
    if (commas > 1) {
      if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    } else s = s.replace(',', '.');
  } else if (dots && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: true };
  const value = Number(s);
  return Number.isFinite(value) ? { value } : { error: true };
}

const INDIRECT_FIELDS = [
  'purchases',
  'reduced',
  'exempt',
  'fuel',
  'tobacco',
  'fuelPrice',
  'tobaccoPrice',
  'sticks',
  'date',
  'fuelType',
];
const PRICE_DIGITS = { fuelPrice: 3, tobaccoPrice: 2 };
const priceReference = (key, st, A) =>
  key === 'fuelPrice' ? A?.fuels?.[st.fuelType]?.pricePerLitre : A?.references?.pack?.priceEur;
const priceDisplay = (key, value) => (Number.isFinite(value) ? num(value, PRICE_DIGITS[key]) : '');

export function applyReferencePrices(st, A) {
  for (const key of Object.keys(PRICE_DIGITS)) {
    if (st[key] === null || st[`${key}Edited`] === false) {
      st[key] = priceDisplay(key, priceReference(key, st, A));
      st[`${key}Edited`] = false;
    }
  }
}

function validDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/* ------------------------------------------------------------------ environment (data) */
export function getEnv(ctx) {
  const rates = ctx.data.rates || null;
  const scenarios = Array.isArray(rates?.scenarios) ? rates.scenarios : [];
  const emp = scenarios.find((s) => s && s.id === 'employment') || null;
  let sets = [];
  try {
    if (emp && emp.status !== 'pending' && employmentCalc(1000, emp) !== null) sets = ruleSets(emp);
  } catch {
    sets = [];
  }
  const core = ctx.core || ctx.data.core || {};
  const last = sets[sets.length - 1];
  const yr = Number(String(last?.to || last?.from || '').slice(0, 4));
  return {
    rates,
    scenarios,
    emp,
    sets,
    ready: sets.length > 0,
    assum: ctx.data['indirect-tax-parameters'] || null,
    fns: Array.isArray(core.functions) ? core.functions : [],
    persons: core.population?.persons ?? null,
    onlyReal: !!ctx.store.get('onlyReal'),
    leva: !!ctx.store.get('leva'),
    year: Number.isFinite(yr) && yr > 2000 ? yr : ctx.period?.year || 2026,
  };
}

/* ------------------------------------------------------------------ the calculation (state -> numbers) */
const FUNDS = [
  ['doo', 'Държавно обществено осигуряване (ДОО)'],
  ['upf', 'Универсален пенсионен фонд (УПФ)'],
  ['health', 'Здравно осигуряване (НЗОК)'],
  ['tzpb', 'Трудова злополука и професионална болест (ТЗПБ)'],
];
// the contributions by fund for one month; every column adds up to its rounded total (largest-remainder rounding). null if the data has no split.
function fundSplit(r, emp, er) {
  const ep = r.employeeParts,
    rp = r.employerParts;
  if (!ep || !rp) return null;
  const you = apportion(
    FUNDS.map(([k]) => Number(ep[k]) || 0),
    emp,
    2,
  );
  const boss = apportion(
    FUNDS.map(([k]) => Number(rp[k]) || 0),
    er,
    2,
  );
  if (you.some((v) => v == null) || boss.some((v) => v == null)) return null;
  return FUNDS.map(([k, label], i) => ({
    id: k,
    label,
    you: Number(ep[k]) > 0 ? you[i] : null,
    boss: Number(rp[k]) > 0 ? boss[i] : null,
  })).filter((x) => x.you != null || x.boss != null);
}

export function compute(st, env) {
  const errors = Object.fromEntries(['gross', ...INDIRECT_FIELDS].map((key) => [key, null]));
  if (!env.ready) return { kind: 'pending', errors };
  const g = parseAmount(st.gross);
  if (g.blank) return { kind: 'empty', errors };
  if (g.error || !(g.value > 0)) {
    errors.gross = ERR_POSITIVE;
    return { kind: 'empty', errors };
  }
  if (g.value > MAX_GROSS) {
    errors.gross = `Въведи сума до ${num(MAX_GROSS)} €`;
    return { kind: 'empty', errors };
  }
  const gross = round2(g.value);

  const tzNum = Number(st.tzpb);
  const opts = {
    rules: env.sets.length > 1 && ['until', 'from', 'year'].includes(st.rules) ? st.rules : 'from',
  };
  if (st.tzpb != null && st.tzpb !== '' && Number.isFinite(tzNum)) opts.tzpb = tzNum;
  const r = employmentCalc(gross, env.emp, opts);
  if (!r) return { kind: 'empty', errors };

  // Every month is rounded as on a payslip (each line is the rounding of its own formula). One rule set = 12 identical months;
  // "the whole year" = the months under the first rule set and the months under the second, each with its own identical payslip.
  const periods =
    opts.rules === 'year' && Array.isArray(r.byPeriod) && r.byPeriod.length
      ? r.byPeriod.map((p) => {
          const emp = round2(p.employeeContrib),
            tax = round2(p.incomeTax),
            er = round2(p.employerContrib);
          return {
            id: p.rules,
            months: Math.round(p.months),
            max: p.maxInsurable,
            emp,
            tax,
            er,
            net: round2(gross - emp - tax),
            capped: p.capped,
          };
        })
      : [
          {
            id: opts.rules,
            months: 12,
            max: r.maxInsurable,
            emp: round2(r.employeeContrib),
            tax: round2(r.incomeTax),
            er: round2(r.employerContrib),
            net: round2(gross - round2(r.employeeContrib) - round2(r.incomeTax)),
            capped: r.capped,
          },
        ];
  const yEmp = round2(periods.reduce((s, p) => s + p.emp * p.months, 0));
  const yTax = round2(periods.reduce((s, p) => s + p.tax * p.months, 0));
  const yEr = round2(periods.reduce((s, p) => s + p.er * p.months, 0));
  const year = opts.rules === 'year';
  // the monthly figures: the payslip itself, or the average month of the whole year
  const emp = year ? round2(yEmp / 12) : periods[0].emp;
  const tax = year ? round2(yTax / 12) : periods[0].tax;
  const er = year ? round2(yEr / 12) : periods[0].er;
  const net = round2(gross - emp - tax);
  const total = round2(emp + tax + er);
  const yTotal = round2(yEmp + yTax + yEr);
  const yGross = round2(gross * 12);
  const yNet = round2(yGross - yEmp - yTax);
  const labour = round2(gross + er);
  const statePct = labour > 0 ? (total / labour) * 100 : null;
  const shares =
    apportion([net, emp, tax, er], 100, 1) ||
    [net, emp, tax, er].map((v) => round2((v / labour) * 100));
  const funds = fundSplit(r, emp, er);

  let ind = null;
  if (st.ind && env.assum) {
    const value = (key, positive = false, integer = false) => {
      const text = String(st[key] ?? '').replace(/[\s€]/g, '');
      const parsed =
        Object.hasOwn(PRICE_DIGITS, key) && /^\d+\.\d+$/.test(text)
          ? Number.isFinite(Number(text))
            ? { value: Number(text) }
            : { error: true }
          : parseAmount(st[key]);
      if (parsed.blank) return null;
      if (
        parsed.error ||
        (positive && parsed.value <= 0) ||
        (integer && !Number.isInteger(parsed.value))
      ) {
        errors[key] = integer
          ? 'Въведи цял брой късове над 0'
          : positive
            ? ERR_POSITIVE
            : ERR_NONNEG;
        return null;
      }
      const reference = priceReference(key, st, env.assum);
      return Object.hasOwn(PRICE_DIGITS, key) &&
        st[`${key}Edited`] === false &&
        st[key] === priceDisplay(key, reference)
        ? reference
        : parsed.value;
    };
    const inp = {
      vat20Eur: value('purchases'),
      vat9Eur: value('reduced'),
      vat0Eur: value('exempt'),
      fuelLitres: value('fuel'),
      tobaccoPacks: value('tobacco'),
      fuelPrice: value('fuelPrice', true),
      tobaccoPrice: value('tobaccoPrice', true),
      sticksPerPack: value('sticks', true, true),
      fuelType: st.fuelType,
      date: st.date,
    };
    const missing = [];
    for (const [key, input] of [
      ['purchases', 'vat20Eur'],
      ['reduced', 'vat9Eur'],
      ['exempt', 'vat0Eur'],
      ['fuel', 'fuelLitres'],
      ['tobacco', 'tobaccoPacks'],
    ]) {
      if (inp[input] === null && !errors[key]) missing.push(key);
    }
    for (const [key, input, needed] of [
      ['fuelPrice', 'fuelPrice', inp.fuelLitres > 0],
      ['tobaccoPrice', 'tobaccoPrice', inp.tobaccoPacks > 0],
      ['sticks', 'sticksPerPack', inp.tobaccoPacks > 0],
    ]) {
      if (needed && inp[input] === null && !errors[key]) missing.push(key);
    }
    if (!st.date) missing.push('date');
    else if (!validDate(st.date)) errors.date = 'Въведи валидна дата';
    if (!st.fuelType && inp.fuelLitres > 0) missing.push('fuelType');
    else if (st.fuelType && !env.assum.fuels?.[st.fuelType])
      errors.fuelType = 'Избери бензин 95 или дизел';
    const invalid = Object.values(errors).some(Boolean);
    let unsupported = false;
    if (!invalid && st.date) {
      const fuel = env.assum.fuels?.[st.fuelType];
      const cigarette = env.assum.cigarettes?.find(
        (row) => st.date >= row.validFrom && (!row.validTo || st.date <= row.validTo),
      );
      if (
        (inp.fuelLitres > 0 &&
          fuel &&
          (st.date < fuel.validFrom || (fuel.validTo && st.date > fuel.validTo))) ||
        (inp.tobaccoPacks > 0 && !cigarette) ||
        (inp.vat20Eur > 0 && st.date < env.assum.vat.standardSince)
      ) {
        unsupported = true;
        errors.date = 'За тази дата липсват проверени ставки за избраните покупки';
      }
    }
    const t = indirectTaxes(inp, env.assum);
    const status = invalid
      ? 'invalid'
      : unsupported
        ? 'unsupported'
        : missing.length
          ? 'missing'
          : t.total == null
            ? 'unsupported'
            : 'ok';
    ind = {
      any: true,
      status,
      missing,
      inp,
      unavailable: status !== 'ok',
      rows: [
        { label: 'ДДС', month: t.vat },
        { label: 'Акциз върху горивата', month: t.fuelExcise },
        { label: 'Акциз върху цигарите', month: t.tobaccoExcise },
      ].map((x) => ({
        ...x,
        month: x.month == null ? null : round2(x.month),
        year: x.month == null ? null : round2(x.month * 12),
      })),
      total: status === 'ok' ? round2(t.total) : null,
      yTotal: status === 'ok' ? round2(t.total * 12) : null,
    };
  }
  return {
    kind: 'ok',
    errors,
    gross,
    r,
    rules: opts.rules,
    year,
    periods,
    emp,
    tax,
    er,
    net,
    total,
    yEmp,
    yTax,
    yEr,
    yTotal,
    yGross,
    yNet,
    labour,
    statePct,
    shares,
    funds,
    ind,
  };
}

/* ------------------------------------------------------------------ inputs block (static; repainted only on a full render) */
const moneyControl = (id, value, error) =>
  html`<span class="s18-money">${textInput({ id, name: id, value, type: 'text', inputmode: 'decimal', autocomplete: 'off', hint: true, error })}<span class="s18-cur" aria-hidden="true">€</span></span>`;
const moneyField = (id, label, hint, value, error) =>
  field({ id, label, hint, error, control: moneyControl(id, value, error) });

export function sliderState(text) {
  const p = parseAmount(text);
  const ok = p.value != null && p.value > 0;
  const v = ok ? Math.min(SLIDER_MAX, p.value) : 0;
  const shown = ok ? num(round2(p.value), Number.isInteger(round2(p.value)) ? 0 : 2) : '—';
  return {
    v,
    fill: (v / SLIDER_MAX) * 100,
    shown,
    valuetext: ok ? `${shown} евро` : 'Няма въведена сума',
  };
}

function rulesBlock(st, env) {
  const sets = env.sets;
  if (sets.length < 2) return '';
  const first = sets[0],
    last = sets[sets.length - 1];
  const options = [
    { value: 'until', label: first.to ? `До ${dm(first.to)}` : 'По старите правила' },
    { value: 'from', label: `От ${dm(last.from)}` },
    { value: 'year', label: `Цялата ${env.year}` },
  ];
  const ceil = sets
    .map(
      (s) => `${e2(s.maxInsurableEur)} ${s === last ? `от ${date(s.from)}` : `до ${date(s.to)}`}`,
    )
    .join(' и ');
  const small = Math.min(...sets.map((s) => s.maxInsurableEur));
  const months = sets.map((s) => s.months).join(' + ');
  return html`<div class="s18-group">
    <p class="field-label" aria-hidden="true">За кой период?</p>
    ${seg({ name: 's18-rules', label: 'За кой период?', value: st.rules, options, cls: 's18-seg' })}
    <p class="field-hint">Максималният осигурителен доход е ${ceil}. Разликата личи само при заплата над ${e2(small)}. „Цялата ${env.year}“ смята ${months} месеца с една и съща заплата.</p>
  </div>`;
}

function tzpbBlock(st, env) {
  const t = env.emp?.tzpbPct;
  if (!t || !Number.isFinite(t.min) || !Number.isFinite(t.max) || !(t.max > t.min)) return '';
  const options = [];
  for (let k = Math.round(t.min * 10); k <= Math.round(t.max * 10); k++)
    options.push({ value: String(k / 10), label: `${pctTrim(k / 10, 1)}%` });
  const cur = st.tzpb != null && st.tzpb !== '' ? String(Number(st.tzpb)) : String(t.used ?? t.min);
  return field({
    id: 's18-tzpb',
    label: 'ТЗПБ на работодателя',
    hint: `Вноска за трудова злополука и професионална болест: от ${pctTrim(t.min, 1)}% до ${pctTrim(t.max, 1)}%, според дейността. Допуснато е ${pctTrim(t.used ?? t.min, 1)}%.`,
    control: selectInput({ id: 's18-tzpb', name: 's18-tzpb', options, value: cur, hint: true }),
  });
}

/* one visible line beside the inputs (narrow screens only, by CSS): the full result is just below */
export function quickMarkup(c) {
  return c.kind === 'ok'
    ? html`${c.year ? 'Нето в ръка, средно на месец' : 'Нето в ръка'}: <strong>${e2(c.net)}</strong>`
    : '';
}

function inputsBlock(st, c, env) {
  const sv = sliderState(st.gross);
  const labelOf = () => env.emp?.label || 'Трудов договор';
  return block({
    id: 's18-inputs',
    title: 'Твоите данни',
    status: 'text',
    share: false,
    report: false,
    body: html`
      <div class="s18-group">
        <p class="field-label" id="s18-type-l">Вид доход</p>
        <p class="s18-type" aria-labelledby="s18-type-l"><strong>${labelOf()}</strong></p>
        <p class="field-hint">Не са включени облекчения, други доходи, доброволни осигуровки, самоосигуряващи се, договор за управление и пенсионери. За тях няма пълен резултат.</p>
      </div>
      ${moneyField('s18-gross', 'Брутна заплата на месец, €', html`Въведи ${gl('brutna-zaplata', 'брутната заплата')}, преди данъци и осигуровки. Например: 1500 или 1 500,50.`, st.gross, c.errors.gross)}
      <div class="s18-slider-row">
        <label class="s18-slider-label" for="s18-slider">Плъзгач за заплатата</label>
        <input class="s18-slider" id="s18-slider" type="range" min="0" max="${SLIDER_MAX}" step="${SLIDER_STEP}" value="${sv.v}" aria-valuetext="${sv.valuetext}" style="--s18-fill:${sv.fill}%">
        <span class="s18-slider-val" id="s18-slider-val" aria-hidden="true">${sv.shown}${sv.shown === '—' ? '' : raw('&nbsp;€')}</span>
      </div>
      ${rulesBlock(st, env)}
      ${tzpbBlock(st, env)}
      <p id="s18-quick" class="s18-quick" aria-hidden="true">${quickMarkup(c)}</p>`,
  });
}

/* ------------------------------------------------------------------ result view (repainted on every change) */
function basisText(c, env) {
  const r = c.r,
    sets = env.sets;
  const tz = r.tzpbPct != null ? ` ТЗПБ на работодателя: ${pctTrim(r.tzpbPct, 1)}%.` : '';
  if (c.year) {
    const bits = c.periods
      .map((p) => `${p.months} мес. с максимален осигурителен доход ${e2(p.max)}`)
      .join(', ');
    return `Трудов договор, цялата ${env.year}: ${bits}. Сумите на месец са средни за годината.${tz}`;
  }
  const one =
    sets.length > 1
      ? c.rules === 'until'
        ? `правила до ${date(sets[0].to)}`
        : `правила от ${date(sets[sets.length - 1].from)}`
      : 'действащи правила';
  return `Трудов договор, ${one}. Максимален осигурителен доход: ${e2(r.maxInsurable)} на месец.${tz}`;
}

export function resultMarkup(c, st, env) {
  if (c.kind === 'pending')
    return pendingState({
      title: 'Калкулаторът не е достъпен',
      text: 'Няма данни за ставките за 2026 г.',
      source: ['nap'],
    });
  if (c.kind === 'empty')
    return emptyState({
      title: 'Въведи брутна заплата',
      text: 'Сума над 0 €, например 1500. Резултатът се появява тук.',
      icon: 'banknote',
    });
  const r = c.r;
  const seriesOf = (i) => `var(--series-${i + 1})`;
  const rows = [
    {
      name: 'Нето в ръка',
      sub: `От ${e2(c.gross)} брутна заплата.`,
      v: c.net,
      y: c.yNet,
      p: c.shares[0],
    },
    {
      name: 'Твои осигуровки',
      sub: `${pctTrim(r.employeePct)}% от осигурителния доход.`,
      v: c.emp,
      y: c.yEmp,
      p: c.shares[1],
    },
    {
      name: 'Данък върху дохода',
      sub: `${pctTrim(r.incomeTaxPct)}% върху заплатата след осигуровките.`,
      v: c.tax,
      y: c.yTax,
      p: c.shares[2],
    },
    {
      name: 'Осигуровки на работодателя',
      sub: `${pctTrim(r.employerPct)}%${r.tzpbPct != null ? ` (с ТЗПБ ${pctTrim(r.tzpbPct, 1)}%)` : ''}. Не се виждат във фиша ти.`,
      v: c.er,
      y: c.yEr,
      p: c.shares[3],
    },
  ];
  const per = c.year ? 'средно на месец' : 'на месец';
  const lv = env.leva
    ? html` <span class="s18-muted">(около ${leva(c.net * EUR_RATE, 2)})</span>`
    : '';
  const capped = r.capped
    ? callout({
        kind: 'info',
        title: 'Над максималния осигурителен доход',
        body: c.year
          ? html`<p>Брутната заплата е над максималния осигурителен доход поне за част от годината. Осигуровките се смятат само върху него. Данъкът се смята върху цялата заплата, след осигуровките.</p>`
          : html`<p>Брутната заплата е над максималния осигурителен доход (${e2(r.maxInsurable)}). Осигуровките се смятат само върху него. Данъкът се смята върху цялата заплата, след осигуровките.</p>`,
      })
    : '';
  const yLabel = c.year ? `За цялата ${env.year}` : 'За година (12 месеца)';
  return html`
    <p class="s18-basis">${basisText(c, env)}</p>
    <p class="s18-net"><span class="s18-net-k">Нето в ръка</span> <strong class="s18-net-v">${e2(c.net)}</strong> <span class="s18-net-u">${per}</span>${lv}</p>
    <p class="s18-lead">Ти внасяш <strong>${e2(round2(c.emp + c.tax))}</strong> (осигуровки и данък). Работодателят внася още <strong>${e2(c.er)}</strong>.</p>
    <div class="s18-bar" aria-hidden="true">${rows.map((x, i) => html`<span class="s18-bar-seg" style="width:${x.p}%;background:${seriesOf(i)}"></span>`)}</div>
    <ul class="s18-rows s18-stat">${rows.map(
      (
        x,
        i,
      ) => html`<li class="s18-row"><span class="s18-sw" style="background:${seriesOf(i)}" aria-hidden="true"></span>
      <span class="s18-row-name"><strong>${x.name}</strong><span class="s18-row-sub">${x.sub}</span></span>
      <span class="s18-row-val"><strong>${e2(x.v)}</strong><span class="s18-muted">${pct(x.p, 1)}</span></span></li>`,
    )}</ul>
    <p class="s18-note">Процентите са дял от цената на труда: ${e2(c.labour)} ${per}, брутната заплата плюс осигуровките на работодателя.</p>
    <p class="s18-year"><strong>${yLabel}:</strong> нето ${e2(c.yNet)}, ти внасяш ${e2(round2(c.yEmp + c.yTax))}, работодателят внася ${e2(c.yEr)}.</p>
    ${capped}`;
}

export function liveText(c) {
  if (c.kind === 'ok')
    return `Нето в ръка: ${num(c.net, 2)} евро ${c.year ? 'средно на месец' : 'на месец'}. Ти внасяш ${num(round2(c.emp + c.tax), 2)} евро, работодателят ${num(c.er, 2)} евро.`;
  return '';
}

/* ------------------------------------------------------------------ details by fund */
export function fundsMarkup(c) {
  if (c.kind !== 'ok')
    return emptyState({
      title: 'Въведи брутна заплата',
      text: 'Разпределението по фондове се появява след сума над 0 €.',
      icon: 'list',
    });
  const per = c.year ? 'средно на месец' : 'на месец';
  const lead = html`<p>Осигуровките отиват в отделни фондове, а данъкът върху дохода влиза директно в приходите на бюджета. Суми ${per}.</p>`;
  if (!c.funds) {
    return html`${lead}${dataTable({
      id: 's18-funds-table',
      caption: `Осигуровки ${per}`,
      columns: [
        { key: 'label', label: 'Вноска' },
        { key: 'you', label: 'Ти', unit: '€', d: 2 },
        { key: 'boss', label: 'Работодател', unit: '€', d: 2 },
      ],
      rows: [{ label: 'Осигуровки (общо)', you: c.emp, boss: c.er }],
      total: { label: 'Общо осигуровки', values: { you: c.emp, boss: c.er } },
    })}`;
  }
  return html`${lead}${dataTable({
    id: 's18-funds-table',
    caption: `Осигуровки по фондове ${per}: твои и на работодателя`,
    columns: [
      { key: 'label', label: 'Фонд' },
      { key: 'you', label: 'Ти', unit: '€', d: 2 },
      { key: 'boss', label: 'Работодател', unit: '€', d: 2 },
      { key: 'sum', label: 'Общо', unit: '€', d: 2 },
    ],
    rows: c.funds.map((x) => ({ ...x, sum: round2((x.you || 0) + (x.boss || 0)) })),
    total: {
      label: 'Общо осигуровки',
      values: { you: c.emp, boss: c.er, sum: round2(c.emp + c.er) },
    },
  })}
  <p class="field-hint">Данък върху дохода (${pctTrim(c.r.incomeTaxPct)}%): ${e2(c.tax)} ${per}. Той не е във фондовете.</p>`;
}

/* ------------------------------------------------------------------ how it is calculated */
function stepRow(name, calc, value) {
  return html`<li class="s18-step"><span class="s18-step-name">${name}<span class="s18-step-calc">${calc}</span></span><span class="s18-step-val">${value}</span></li>`;
}

export function howMarkup(c, env) {
  if (c.kind !== 'ok')
    return emptyState({
      title: 'Въведи брутна заплата',
      text: 'Сметката се появява след сума над 0 €.',
      icon: 'list',
    });
  const r = c.r;
  const strong = (v, row) => (row.strong ? html`<strong>${v}</strong>` : v);
  let steps;
  if (c.year) {
    steps = dataTable({
      id: 's18-periods-table',
      caption: `Цялата ${env.year}: месеци по двата набора правила, суми на месец`,
      columns: [
        { key: 'label', label: 'Период' },
        { key: 'months', label: 'Месеци', d: 0 },
        { key: 'max', label: 'Макс. осиг. доход', unit: '€', d: 2 },
        { key: 'emp', label: 'Твои осигуровки', unit: '€', d: 2 },
        { key: 'tax', label: 'Данък', unit: '€', d: 2 },
        { key: 'net', label: 'Нето', unit: '€', d: 2 },
        { key: 'er', label: 'Работодател', unit: '€', d: 2 },
      ],
      rows: c.periods.map((p, i) => {
        const s = env.sets[i];
        return {
          ...p,
          label: s ? (i === 0 ? `До ${dm(s.to)}` : `От ${dm(s.from)}`) : `Период ${i + 1}`,
        };
      }),
      note: 'Във всеки период заплатата е една и съща. Сумите са закръглени за месец, както във фиш.',
    });
  } else {
    const ins = Math.min(c.gross, c.periods[0].max);
    const capNote = r.capped ? ` (границата ${e2(c.periods[0].max)} е достигната)` : '';
    steps = html`<ol class="s18-steps">
      ${stepRow('Брутна заплата', 'въведената сума', e2(c.gross))}
      ${stepRow('Осигурителен доход', `по-малкото от брутната заплата и ${e2(c.periods[0].max)}${capNote}`, e2(ins))}
      ${stepRow('Твои осигуровки', `${e2(ins)} × ${pctTrim(r.employeePct)}%`, e2(c.emp))}
      ${stepRow('Данък върху дохода', `(${e2(c.gross)} − ${e2(c.emp)}) × ${pctTrim(r.incomeTaxPct)}%`, e2(c.tax))}
      ${stepRow('Нето в ръка', `${e2(c.gross)} − ${e2(c.emp)} − ${e2(c.tax)}`, e2(c.net))}
      ${stepRow('Осигуровки на работодателя', `${e2(ins)} × ${pctTrim(r.employerPct)}%`, e2(c.er))}
      ${stepRow('Цена на труда', `${e2(c.gross)} + ${e2(c.er)}`, e2(c.labour))}
    </ol>`;
  }
  const per = c.year ? 'Средно на месец' : 'На месец';
  const slip = dataTable({
    id: 's18-payslip',
    caption: 'Месечен и годишен разчет на заплатата',
    columns: [
      { key: 'label', label: 'Ред', fmt: strong },
      {
        key: 'month',
        label: per,
        unit: '€',
        d: 2,
        fmt: (v, row) => (row.strong ? html`<strong>${num(v, 2)}</strong>` : num(v, 2)),
      },
      {
        key: 'year',
        label: c.year ? `За ${env.year}` : 'На година',
        unit: '€',
        d: 2,
        fmt: (v, row) => (row.strong ? html`<strong>${num(v, 2)}</strong>` : num(v, 2)),
      },
    ],
    rows: [
      { label: 'Брутна заплата', month: c.gross, year: c.yGross },
      { label: `Твои осигуровки (${pctTrim(r.employeePct)}%)`, month: -c.emp, year: -c.yEmp },
      { label: `Данък върху дохода (${pctTrim(r.incomeTaxPct)}%)`, month: -c.tax, year: -c.yTax },
      { label: 'Нето в ръка', month: c.net, year: c.yNet, strong: true },
      {
        label: `Осигуровки на работодателя (${pctTrim(r.employerPct)}%)`,
        month: c.er,
        year: c.yEr,
      },
    ],
    total: { label: 'Данъци и осигуровки общо', values: { month: c.total, year: c.yTotal } },
    note: c.year ? '' : 'Годишните суми са 12 месеца с една и съща заплата.',
  });
  return html`${steps}${slip}`;
}

/* ------------------------------------------------------------------ sources and periods (static) */
function sourcesBody(env) {
  const emp = env.emp;
  const applies = emp?.appliesTo || emp?.applies_to;
  const sets = env.sets;
  const gvrs = Number(emp?.gvrsPct ?? emp?.gvrs_pct);
  const t = emp?.tzpbPct;
  return html`
    <ul class="s18-plain">
      <li><strong>Ставки.</strong> Осигуровки ${pctTrim(emp?.employeePct)}% за служителя и ${pctTrim(emp?.employerPctWithoutTzpb ?? emp?.employerPct)}% за работодателя, плюс ТЗПБ${t ? ` от ${pctTrim(t.min, 1)}% до ${pctTrim(t.max, 1)}%` : ''}; данък върху дохода ${pctTrim(emp?.incomeTaxPct)}%. Източници: писмо на НАП от 12.08.2026 г., Закон за бюджета на ДОО за 2026 г., Закон за бюджета на НЗОК за 2026 г. ${srcTag(['nap', 'zbdoo', 'zbnzok'])}</li>
      ${sets.length ? html`<li><strong>Периоди.</strong> ${sets.map((s) => `Максимален осигурителен доход ${e2(s.maxInsurableEur)} ${s === sets[sets.length - 1] ? `от ${date(s.from)}` : `до ${date(s.to)}`}`).join('; ')}.</li>` : ''}
      ${Number.isFinite(gvrs) ? html`<li>Вноската за фонд „Гарантирани вземания на работниците и служителите“ е ${pctTrim(gvrs)}% през ${env.year}.</li>` : ''}
      ${applies ? html`<li><strong>За кого важи.</strong> ${applies}</li>` : ''}
      <li><strong>Какво не е включено.</strong> Данъчни облекчения (например за деца или за хора с увреждания), други доходи, доброволни осигуровки, самоосигуряващи се, договор за управление и пенсионери.</li>
      <li><strong>Закръгляване.</strong> Всеки ред е закръглен до цент, както във фиш за заплата. Нетото и сборовете са от показаните редове.</li>
      <li>${gl('osiguritelen-dohod', 'Осигурителният доход')} определя вноските, а ${gl('danak-varhu-dohodite', 'данъкът върху дохода')} е приход на бюджета.</li>
    </ul>`;
}

/* ------------------------------------------------------------------ conditional illustration by function (repainted on every change) */
function functionTable(id, caption, pot, env, ctx) {
  const decimals = pot >= 1000 ? 0 : 2;
  const rec = receiptByFunction(pot, env.fns, { decimals });
  if (!rec.length)
    return pendingState({ title: 'Няма данни за разходите по функции', source: ['asbp'] });
  rec.sort((a, b) => b.yearEur - a.yearEur);
  const sh =
    apportion(
      rec.map((x) => x.sharePct),
      100,
      1,
    ) || rec.map((x) => round2(x.sharePct));
  const byId = new Map(env.fns.map((f) => [f.id, f]));
  const rows = rec.map((x, i) => ({
    name: byId.get(x.id)?.short || x.name,
    year: x.yearEur,
    day: x.dayEur,
    share: sh[i],
    _href: ctx.href('S08', { fn: x.id }),
  }));
  return dataTable({
    id,
    caption,
    dense: true,
    columns: [
      { key: 'name', label: 'Функция' },
      { key: 'year', label: 'На година', unit: '€', d: decimals },
      { key: 'day', label: 'На ден', unit: '€', d: 2 },
      { key: 'share', label: 'Дял', unit: '%', d: 1 },
    ],
    rows,
    total: {
      label: 'Общо',
      values: {
        year: round2(rec.reduce((s, x) => s + x.yearEur, 0)),
        day: round2(rec.reduce((s, x) => s + x.dayEur, 0)),
        share: 100,
      },
    },
  });
}

export function receiptMarkup(c, st, env, ctx) {
  if (c.kind !== 'ok')
    return emptyState({
      title: 'Илюстрацията ще се покаже тук',
      text: 'Въведи брутна заплата над 0 €, за да видиш условно разпределение.',
      icon: 'list',
    });
  if (!env.fns.length)
    return pendingState({ title: 'Няма данни за разходите по функции', source: ['asbp'] });
  const pot = round2(c.yEmp + c.yTax);
  const totalMln = env.fns.reduce((s, f) => s + (Number(f.mln) || 0), 0);
  const perHead =
    env.persons && totalMln > 0
      ? html` За сравнение: планираните разходи са около ${perPerson(totalMln, env.persons)} на жител на година.`
      : '';
  return html`
    <p>Твоите осигуровки и данък за ${c.year ? `цялата ${env.year}` : 'година'} са ${eur(pot, pot >= 1000 ? 0 : 2)}, или около ${e2(round2(pot / 365))} на ден. Осигуровките на работодателя не са в тази сума. Ако сумата се разпредели като разходите по функции в плана „${env.year} Проект“, ще изглежда така:</p>
    ${functionTable('s18-receipt-table', 'Условно разпределение на твоите осигуровки и данък по функции на разходите', pot, env, ctx)}
    <p class="field-hint">Това е илюстрация по пропорция. Държавата не проследява всеки евро до конкретен разход, а разпределението не се променя с избора на период.${perHead}</p>`;
}

/* ------------------------------------------------------------------ indirect taxes: an explicit optional estimate */
function assumptionsText(A) {
  return A
    ? `ЕК: горива към ${date(A.fuels.petrol.priceDate)}. НСИ: цена на кутия за ${A.references.pack.period} г. Справочните цени могат да се променят.`
    : '';
}

export function indirectView(c, env) {
  const ind = c.ind;
  if (!ind) return '';
  if (!ind.any)
    return html`<p class="field-hint">Въведи сума за покупки, гориво или тютюн, за да видиш ориентировъчна оценка.</p>`;
  if (ind.status === 'invalid') return html`<p class="field-hint">Поправи отбелязаните полета.</p>`;
  if (ind.status === 'unsupported')
    return html`<p class="field-hint">За избраната дата няма достатъчно проверени ставки.</p>`;
  if (ind.unavailable)
    return html`<p class="field-hint">Липсва дата, количество, цена, брой късове или разход по ставка. За липса на покупки се въвежда 0.</p>`;
  return html`${dataTable({
    id: 's18-indirect-table',
    caption: 'Ориентировъчни косвени данъци, които плащаш чрез цените',
    columns: [
      { key: 'label', label: 'Данък' },
      { key: 'month', label: 'На месец', unit: '€', d: 2 },
      { key: 'year', label: 'Годишен сценарий', unit: '€', d: 2 },
    ],
    rows: ind.rows,
    total: { label: 'Общо косвени данъци', values: { month: ind.total, year: ind.yTotal } },
  })}
  <p class="field-hint">Ориентировъчно по въведените разходи. Годишният сценарий е 12 еднакви месеца с избраните ставки и цени.</p>`;
}

function indirectBlock(st, c, env) {
  const A = env.assum;
  const on = !!st.ind && !!A;
  const body = html`
    <p>В цените на стоките има вграден ${gl('dds', 'ДДС')} и ${gl('aktsiz', 'акциз')}. Оценката е по желание и отделно от сметката по-горе.</p>
    ${A ? html`<p class="field-hint">ДДС се изчислява отделно за всяка ставка. Разходите за покупки не включват гориво и цигари. Цигарите се смятат за една цена и един размер на кутия.</p>` : ''}
    ${A ? html`<p class="s18-assume"><strong>Справочни цени:</strong> ${assumptionsText(A)}.</p>` : ''}
    ${toggle({ id: 's18-ind', label: 'Добави оценка на косвените данъци', checked: on, attrs: raw(` aria-controls="s18-ind-fields"${A ? '' : ' disabled'}`) })}
    ${A ? '' : html`<p class="field-hint">Няма данни за параметрите за косвените данъци.</p>`}
    <div id="s18-ind-fields" class="s18-ind-fields"${on ? '' : raw(' hidden')}>
      ${moneyField('s18-purchases', 'Покупки с ДДС 20%, €', 'Без гориво и цигари.', st.purchases, c.errors.purchases)}
      ${moneyField('s18-reduced', 'Покупки с ДДС 9%, €', 'Месечна сума.', st.reduced, c.errors.reduced)}
      ${moneyField('s18-exempt', 'Покупки без ДДС / 0 %, €', 'Категория по определение: без начислен ДДС (ЗДДС).', st.exempt, c.errors.exempt)}
      ${field({ id: 's18-date', label: 'Дата на ставките', error: c.errors.date, control: textInput({ id: 's18-date', type: 'date', value: st.date, error: c.errors.date }) })}
      ${field({
        id: 's18-fuelType',
        label: 'Гориво',
        error: c.errors.fuelType,
        control: selectInput({
          id: 's18-fuelType',
          value: st.fuelType,
          error: c.errors.fuelType,
          options: [
            { value: 'petrol', label: 'Бензин 95' },
            { value: 'diesel', label: 'Дизел' },
          ],
        }),
      })}
      ${field({ id: 's18-fuel', label: 'Литри на месец', error: c.errors.fuel, control: textInput({ id: 's18-fuel', value: st.fuel, error: c.errors.fuel, inputmode: 'decimal' }) })}
      ${moneyField('s18-fuelPrice', 'Цена на литър, €', 'Справка от ЕК; може да се промени.', st.fuelPrice, c.errors.fuelPrice)}
      ${field({ id: 's18-tobacco', label: 'Кутии цигари на месец', error: c.errors.tobacco, control: textInput({ id: 's18-tobacco', value: st.tobacco, error: c.errors.tobacco, inputmode: 'decimal' }) })}
      ${moneyField('s18-tobaccoPrice', 'Цена на кутия, €', 'Справка на НСИ за 2025 г.; може да се промени.', st.tobaccoPrice, c.errors.tobaccoPrice)}
      ${field({ id: 's18-sticks', label: 'Късове в кутия', error: c.errors.sticks, control: textInput({ id: 's18-sticks', value: st.sticks, error: c.errors.sticks, inputmode: 'numeric' }) })}
    </div>
    <div id="s18-ind-view" class="s18-ind-view">${on ? indirectView(c, env) : ''}</div>`;
  return disclosure({
    id: 's18-indirect',
    title: 'Косвени данъци: оценка по избор',
    meta: 'Ориентировъчно',
    open: on,
    body,
  });
}

/* ------------------------------------------------------------------ page */
export const needs = ['core', 'rates?', 'indirect-tax-parameters?'];
export const styles = ['s18-danaci'];
export const lede = () =>
  'Въведи брутната си заплата. Ще видиш колко остава в ръката ти, колко внасяш ти и колко внася работодателят. Всичко се смята в браузъра ти. Нищо не се записва и не се изпраща.';

export function render(ctx) {
  if (ctx.kind !== 'rerender') resetMem();
  const env = getEnv(ctx);
  const st = mem;
  if (env.assum) applyReferencePrices(st, env.assum);
  const c = compute(st, env);
  const calc = env.ready
    ? html`<div class="s18-layout">
        <div class="s18-in">${inputsBlock(st, c, env)}</div>
        <div class="s18-out">
          ${block({
            id: 's18-result',
            title: 'Твоята сметка',
            status: 'real',
            statusLabel: 'Официални ставки',
            source: ['nap', 'zbdoo', 'zbnzok'],
            asOf: env.rates?.meta?.asOf,
            share: false,
            report: false,
            body: html`<p id="s18-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
              <div id="s18-view">${resultMarkup(c, st, env)}</div>
              <div class="s18-more">
                ${disclosure({ id: 's18-funds', title: 'По фондове', body: html`<div id="s18-funds-view">${fundsMarkup(c)}</div>` })}
                ${disclosure({ id: 's18-how', title: 'Как е сметнато?', body: html`<div id="s18-how-view">${howMarkup(c, env)}</div>` })}
                ${disclosure({ id: 's18-sources', title: 'Източници и периоди', body: sourcesBody(env) })}
                ${disclosure({ id: 's18-receipt', title: 'Условна бюджетна илюстрация', meta: html`<span class="s18-tag">илюстрация</span>`, body: html`<div id="s18-receipt-view">${receiptMarkup(c, st, env, ctx)}</div>` })}
                ${indirectBlock(st, c, env)}
              </div>`,
          })}
        </div>
      </div>`
    : block({
        id: 's18-pending',
        title: 'Калкулатор',
        status: 'pending',
        body: pendingState({ title: 'Калкулаторът не е достъпен', source: ['nap'] }),
      });
  return html`
    ${calc}
    ${linkCard({ href: ctx.href('S12'), title: 'Мерки в бюджета 2026', text: 'Виж какво се променя по приходите и разходите.', kicker: 'Още по темата', icon: 'fileText' })}`;
}

/* ------------------------------------------------------------------ behaviour */
export function mount(root, ctx) {
  const view = root.querySelector('#s18-view');
  if (!view) return undefined;
  const env = getEnv(ctx);
  const live = root.querySelector('#s18-live');
  const q = (id) => root.querySelector(`#${id}`);
  let liveTimer = 0,
    lastLive = '';

  // field error: created / removed in place so the input keeps focus; role="alert" announces it once
  const setErr = (id, msg) => {
    const input = q(id),
      wrap = input && input.closest('.field');
    if (!input || !wrap) return;
    let p = q(`${id}-err`);
    const ids = new Set(
      (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
    );
    if (msg) {
      if (!p) {
        p = document.createElement('p');
        p.className = 'field-error';
        p.id = `${id}-err`;
        p.setAttribute('role', 'alert');
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
    if (ids.size) input.setAttribute('aria-describedby', [...ids].join(' '));
    else input.removeAttribute('aria-describedby');
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
  const queueLive = (c) => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (!live) return;
      const t = liveText(c);
      if (t === lastLive) return;
      lastLive = t;
      live.textContent = t;
    }, 800);
  };

  // the disclosures stay in place (their open state and listeners survive); only the views inside them are repainted
  const paint = (id, markup) => {
    const el = q(id);
    if (el) el.innerHTML = String(markup);
  };
  const refresh = () => {
    const c = compute(mem, env);
    view.innerHTML = String(resultMarkup(c, mem, env));
    paint('s18-funds-view', fundsMarkup(c));
    paint('s18-how-view', howMarkup(c, env));
    paint('s18-receipt-view', receiptMarkup(c, mem, env, ctx));
    paint('s18-ind-view', mem.ind ? indirectView(c, env) : '');
    const quick = q('s18-quick');
    if (quick) quick.innerHTML = String(quickMarkup(c));
    setErr('s18-gross', c.errors.gross);
    for (const k of INDIRECT_FIELDS) setErr(`s18-${k}`, c.errors[k]);
    syncSlider();
    queueLive(c);
  };

  const FIELD = {
    's18-gross': 'gross',
    's18-purchases': 'purchases',
    's18-fuel': 'fuel',
    's18-tobacco': 'tobacco',
    ...Object.fromEntries(
      ['reduced', 'exempt', 'fuelPrice', 'tobaccoPrice', 'sticks', 'date'].map((k) => [
        `s18-${k}`,
        k,
      ]),
    ),
  };
  const onInput = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (FIELD[t.id]) {
      const key = FIELD[t.id];
      mem[key] = t.value;
      if (Object.hasOwn(PRICE_DIGITS, key)) mem[`${key}Edited`] = true;
      refresh();
    } else if (t.id === 's18-slider') {
      mem.gross = String(t.value);
      const g = q('s18-gross');
      if (g) g.value = mem.gross;
      refresh();
    }
  };
  const onChange = (e) => {
    if (e.target.id === 's18-fuelType') {
      mem.fuelType = e.target.value;
      const reference = env.assum.fuels[mem.fuelType]?.pricePerLitre;
      mem.fuelPrice = priceDisplay('fuelPrice', reference);
      mem.fuelPriceEdited = false;
      q('s18-fuelPrice').value = mem.fuelPrice;
      refresh();
      return;
    }
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
    if (t.name === 's18-rules' && t.checked) {
      mem.rules = t.value;
      refresh();
    } else if (t.id === 's18-tzpb') {
      mem.tzpb = t.value;
      refresh();
    } else if (t.id === 's18-ind') {
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
