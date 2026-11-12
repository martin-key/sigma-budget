// calc.js: pure calculator logic for S18 "Колко плащам аз?" and the S01 mini-calculator (owner: G3).
// No DOM, no fetch, no imports. Every rate is an ARGUMENT (data/rates.json scenario 'employment', mock/tax-assumptions.json); nothing is hard-coded here.
// Money is EUR, per month unless a name says "yearly". Results are NOT rounded: round only when printing (format.eur), or use apportion() for tables that must add up.
//
// employmentCalc(gross, scenario, opts)         monthly gross wage -> contributions, income tax, net pay, employer contributions, monthly/yearly direct total; null if gross is not a number above 0
// ruleSets(scenario)                            the scenario's rule sets (until 31.07 / from 01.08) with the maximum insurable income, for toggle labels
// receiptByFunction(yearlyEur, functions, opts) splits a yearly amount by the plan's expenditure by function: [{ id, name, short, yearEur, dayEur, sharePct }], rows add up to the total
// indirectTaxes(input, assumptions)             VAT and excise inside everyday purchases { vat, fuelExcise, tobaccoExcise, total, vatParts, approx }: always an estimate ("ориентировъчно")
// apportion(values, total, decimals)            rounds proportional shares so the rounded parts add up to the rounded total (largest remainder)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sumOf = (o) =>
  o && typeof o === 'object' && Object.values(o).length && Object.values(o).every(isNum)
    ? Object.values(o).reduce((a, b) => a + b, 0)
    : NaN;
const monthIndex = (s) => {
  const m = /^(\d{4})-(\d{2})/.exec(typeof s === 'string' ? s : '');
  return m ? +m[1] * 12 + (+m[2] - 1) : NaN;
};

/**
 * The rule sets of a scenario, oldest first: id 'until' (first, e.g. until 31.07.2026) and 'from' (last, e.g. from 01.08.2026).
 * Read from scenario.maxInsurableIncomeEur: [{ from, to, eur }] (or a plain number = one open set).
 * Returns [{ id, from, to, months, maxInsurableEur }]; months = calendar months the set covers in its year (NaN if the dates are missing).
 */
export function ruleSets(scenario) {
  const raw = scenario && scenario.maxInsurableIncomeEur;
  if (isNum(raw)) return [{ id: 'from', from: null, to: null, months: 12, maxInsurableEur: raw }];
  const list = (Array.isArray(raw) ? raw : [])
    .filter((e) => e && isNum(e.eur))
    .slice()
    .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  return list.map((e, i) => {
    const start = monthIndex(e.from);
    let end = monthIndex(e.to);
    if (!isNum(end))
      end =
        i + 1 < list.length && isNum(monthIndex(list[i + 1].from))
          ? monthIndex(list[i + 1].from) - 1
          : isNum(start)
            ? Math.floor(start / 12) * 12 + 11
            : NaN;
    const months = isNum(start) && isNum(end) ? Math.max(0, end - start + 1) : NaN;
    return {
      id: i === 0 ? 'until' : i === list.length - 1 ? 'from' : 'mid' + i,
      from: e.from ?? null,
      to: e.to ?? null,
      months,
      maxInsurableEur: e.eur,
    };
  });
}

// One month under one rule set. Returns null when an essential rate is missing (never guesses a rate).
function monthlyRecord(gross, sc, maxInsurable, tzpbOpt) {
  const split = sc.split || {};
  const tz = isNum(sc.tzpbPct) ? { used: sc.tzpbPct } : sc.tzpbPct || {};
  const employeePct = isNum(sc.employeePct) ? sc.employeePct : sumOf(split.employee);
  // employer rate without ТЗПБ: explicit, or employerPct minus the ТЗПБ it was published with, or the sum of its split
  const employerBase = isNum(sc.employerPctWithoutTzpb)
    ? sc.employerPctWithoutTzpb
    : isNum(sc.employerPct) && isNum(tz.used)
      ? sc.employerPct - tz.used
      : sumOf(split.employer);
  let tzpb = isNum(tz.used) ? tz.used : NaN;
  if (isNum(tzpbOpt)) {
    tzpb = tzpbOpt;
    if (isNum(tz.min)) tzpb = Math.max(tz.min, tzpb);
    if (isNum(tz.max)) tzpb = Math.min(tz.max, tzpb);
  }
  const employerPct = isNum(employerBase)
    ? employerBase + (isNum(tzpb) ? tzpb : 0)
    : sc.employerPct;
  const incomeTaxPct = sc.incomeTaxPct;
  if (![employeePct, employerPct, incomeTaxPct, maxInsurable].every(isNum)) return null;

  const insurable = Math.min(gross, maxInsurable);
  const employeeContrib = (insurable * employeePct) / 100;
  const taxBase = Math.max(0, gross - employeeContrib);
  const incomeTax = (taxBase * incomeTaxPct) / 100;
  const employerContrib = (insurable * employerPct) / 100;
  const part = (pct) => (insurable * pct) / 100;
  const employeeParts =
    split.employee && sumOf(split.employee) >= 0
      ? {
          doo: part(split.employee.doo),
          upf: part(split.employee.upf),
          health: part(split.employee.health),
        }
      : null;
  const employerParts =
    split.employer && sumOf(split.employer) >= 0 && isNum(tzpb)
      ? {
          doo: part(split.employer.doo),
          upf: part(split.employer.upf),
          health: part(split.employer.health),
          tzpb: part(tzpb),
        }
      : null;
  return {
    insurable,
    capped: gross > maxInsurable,
    taxBase,
    employeePct,
    employerPct,
    incomeTaxPct,
    tzpbPct: isNum(tzpb) ? tzpb : null,
    employeeContrib,
    incomeTax,
    employerContrib,
    net: gross - employeeContrib - incomeTax,
    monthlyDirect: employeeContrib + incomeTax + employerContrib,
    employeeParts,
    employerParts,
  };
}

const MIXED = [
  'insurable',
  'taxBase',
  'employeeContrib',
  'incomeTax',
  'employerContrib',
  'net',
  'monthlyDirect',
];
// Month-weighted average of several monthly records (w sums to 1).
function mixRecords(recs, w) {
  const out = {};
  for (const k of MIXED) out[k] = recs.reduce((a, r, i) => a + r[k] * w[i], 0);
  for (const g of ['employeeParts', 'employerParts']) {
    out[g] = recs.every((r) => r[g])
      ? Object.fromEntries(
          Object.keys(recs[0][g]).map((k) => [k, recs.reduce((a, r, i) => a + r[g][k] * w[i], 0)]),
        )
      : null;
  }
  out.capped = recs.some((r) => r.capped);
  return out;
}

/**
 * Employment contract, monthly. gross: gross wage in EUR; scenario: rates.json scenarios[] entry 'employment'
 * (employeePct, employerPct incl. ТЗПБ, incomeTaxPct, split{employee,employer}, tzpbPct{min,max,used}, maxInsurableIncomeEur[{from,to,eur}]).
 * opts.rules: 'from' (default, rules from 01.08) | 'until' (until 31.07) | 'year' (the whole of 2026 as 7 + 5 months; monthly fields are the 12-month average, yearlyDirect is the exact sum).
 * opts.tzpb: employer ТЗПБ in % (clamped to the scenario's min..max; default scenario.tzpbPct.used).
 * employeeContrib = insurable x employeePct (insurable = min(gross, max insurable income)); incomeTax = (gross - employeeContrib) x incomeTaxPct;
 * employerContrib = insurable x employerPct; net = gross - employeeContrib - incomeTax; monthlyDirect = the three charges together; yearlyDirect = 12 x monthlyDirect.
 * employeeParts { doo, upf, health } and employerParts { doo, upf, health, tzpb } split the contributions by fund (null if the split is not in the data).
 * Returns null for a missing/pending scenario, a missing rate, or a gross that is not a number above 0.
 */
export function employmentCalc(gross, scenario, opts = {}) {
  if (
    !isNum(gross) ||
    !(gross > 0) ||
    !scenario ||
    typeof scenario !== 'object' ||
    scenario.status === 'pending'
  )
    return null;
  const sets = ruleSets(scenario);
  if (!sets.length) return null;
  const rules = opts.rules === 'until' || opts.rules === 'year' ? opts.rules : 'from';
  if (rules !== 'year') {
    const set = sets.find((s) => s.id === rules) || sets[sets.length - 1];
    const r = monthlyRecord(gross, scenario, set.maxInsurableEur, opts.tzpb);
    return (
      r && {
        gross,
        rules,
        ...r,
        maxInsurable: set.maxInsurableEur,
        yearlyDirect: r.monthlyDirect * 12,
      }
    );
  }
  const per = sets.map((s) => ({
    set: s,
    rec: monthlyRecord(gross, scenario, s.maxInsurableEur, opts.tzpb),
  }));
  if (per.some((p) => !p.rec)) return null;
  const total = per.reduce((a, p) => a + p.set.months, 0);
  const w = total > 0 ? per.map((p) => p.set.months / total) : per.map(() => 1 / per.length);
  return {
    gross,
    rules,
    ...per[0].rec,
    ...mixRecords(
      per.map((p) => p.rec),
      w,
    ),
    maxInsurable: null,
    yearlyDirect: per.reduce((a, p, i) => a + p.rec.monthlyDirect * w[i] * 12, 0),
    byPeriod: per.map((p, i) => ({
      rules: p.set.id,
      months: w[i] * 12,
      maxInsurable: p.set.maxInsurableEur,
      ...p.rec,
    })),
  };
}

/**
 * Largest-remainder rounding. values: non-negative weights; total: the amount to split; decimals: places kept (default 2).
 * Returns numbers rounded to `decimals` that sum exactly to round(total, decimals); null entries if the input is not usable.
 */
export function apportion(values, total, decimals = 2) {
  const list = Array.isArray(values) ? values : [];
  const weights = list.map((v) => (isNum(v) && v > 0 ? v : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !isNum(total) || total < 0) return list.map(() => null);
  const f = 10 ** decimals;
  const target = Math.round(total * f);
  const exact = weights.map((v) => (v / sum) * target);
  const base = exact.map(Math.floor);
  let left = target - base.reduce((a, b) => a + b, 0);
  exact
    .map((x, i) => [x - base[i], i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .forEach(([, i]) => {
      if (left > 0) {
        base[i] += 1;
        left -= 1;
      }
    });
  return base.map((v) => v / f);
}

/** shares of a pie whose tail past `cut` is folded into one slice („Други“): the kept shares, then the sum of the tail's (to `decimals`) */
export function foldShares(shares, cut, decimals = 1) {
  const list = Array.isArray(shares) ? shares : [];
  if (list.length <= cut) return list;
  const tail = list.slice(cut).filter(isNum);
  const f = 10 ** decimals;
  return [
    ...list.slice(0, cut),
    tail.length ? Math.round(tail.reduce((a, v) => a + v, 0) * f) / f : null,
  ];
}

/**
 * Splits a yearly amount (EUR) by the budget's expenditure by function. functions: [{ id, name, short?, mln }] where mln is the plan figure
 * as a number (core.json functions) or an array by year (expenditure.json functions.items; opts.index = the year column, default 1 = 2026).
 * opts.decimals: places kept for yearEur (default 2; use 0 for a table in whole euro), opts.days: days in a year (default 365).
 * Returns [{ id, name, short, yearEur, dayEur, sharePct }] in the input order; yearEur adds up to the rounded total, dayEur (2 places) to the rounded daily total;
 * sharePct is exact (0-100). Functions without a positive figure are skipped; an empty list means there is nothing to split by.
 */
export function receiptByFunction(yearlyEur, functions, opts = {}) {
  if (!isNum(yearlyEur) || yearlyEur < 0 || !Array.isArray(functions)) return [];
  const idx = Number.isInteger(opts.index) ? opts.index : 1;
  const days = isNum(opts.days) && opts.days > 0 ? opts.days : 365;
  const items = [];
  for (const f of functions) {
    const w = f && (Array.isArray(f.mln) ? f.mln[idx] : f.mln);
    if (isNum(w) && w > 0) items.push({ f, w });
  }
  const sum = items.reduce((a, x) => a + x.w, 0);
  if (!(sum > 0)) return [];
  const year = apportion(
    items.map((x) => x.w),
    yearlyEur,
    Number.isInteger(opts.decimals) ? opts.decimals : 2,
  );
  const day = apportion(
    items.map((x) => x.w),
    yearlyEur / days,
    2,
  );
  return items.map((x, i) => ({
    id: x.f.id,
    name: x.f.name,
    short: x.f.short || x.f.name,
    yearEur: year[i],
    dayEur: day[i],
    sharePct: (x.w / sum) * 100,
  }));
}

// first finite number among dotted paths ("vat.ratePct") of an object, NaN if none
const pick = (o, ...paths) => {
  for (const p of paths) {
    let v = o;
    for (const k of p.split('.')) v = v == null ? undefined : v[k];
    if (isNum(v)) return v;
  }
  return NaN;
};
/** Monthly indirect-tax scenario. Unknown inputs remain null. Prices include VAT and excise.
 * Separate VAT buckets exclude fuel and cigarettes; cigarettes use a single registered pack price.
 */
export function indirectTaxes(input, parameters) {
  const i = input || {},
    a = parameters || {};
  const positive = (v) => isNum(v) && v > 0;
  const nonnegative = (v) => isNum(v) && v >= 0;
  const sum = (values) => (values.every(isNum) ? values.reduce((s, v) => s + v, 0) : null);
  const inside = (spend, rate) =>
    nonnegative(spend) && isNum(rate) ? (spend * rate) / (100 + rate) : null;
  const f = a.fuels?.[i.fuelType];
  const fuelSpend =
    i.fuelLitres === 0
      ? 0
      : nonnegative(i.fuelLitres) && positive(i.fuelPrice)
        ? i.fuelLitres * i.fuelPrice
        : null;
  const packSpend =
    i.tobaccoPacks === 0
      ? 0
      : nonnegative(i.tobaccoPacks) && positive(i.tobaccoPrice)
        ? i.tobaccoPacks * i.tobaccoPrice
        : null;
  const schedule = a.cigarettes?.find(
    (r) => i.date >= r.validFrom && (!r.validTo || i.date <= r.validTo),
  );
  const vatParts = {
    purchases: sum([
      inside(i.vat20Eur, a.vat?.standardPct),
      inside(i.vat9Eur, a.vat?.reducedPct),
      inside(i.vat0Eur, a.vat?.untaxed?.kind === 'definition' ? 0 : null),
    ]),
    fuel: inside(fuelSpend, a.vat?.standardPct),
    tobacco: inside(packSpend, a.vat?.standardPct),
  };
  const fuelExcise =
    i.fuelLitres === 0
      ? 0
      : f && i.date >= f.validFrom && nonnegative(i.fuelLitres)
        ? i.fuelLitres * f.excisePerLitre
        : null;
  const tobaccoExcise =
    i.tobaccoPacks === 0
      ? 0
      : schedule &&
          nonnegative(i.tobaccoPacks) &&
          positive(i.tobaccoPrice) &&
          positive(i.sticksPerPack)
        ? i.tobaccoPacks *
          Math.max(
            (schedule.specificPer1000 * i.sticksPerPack) / 1000 +
              (schedule.adValoremPct * i.tobaccoPrice) / 100,
            (schedule.minimumPer1000 * i.sticksPerPack) / 1000,
          )
        : null;
  const vat = sum(Object.values(vatParts));
  return {
    vat,
    fuelExcise,
    tobaccoExcise,
    total: sum([vat, fuelExcise, tobaccoExcise]),
    vatParts,
    approx: true,
    provenance: {
      fuel: f?.source || null,
      cigarettes: schedule?.source || null,
      prices: 'user input',
      annualisation: 'scenario',
    },
  };
}
