export const calculatorResults = async (
  cases: { gross: string; rules: string; tzpb?: number }[],
) => {
  const m = await import(new URL('./js/pages/s18-danaci.js', location.href).href);
  const rates = await (await fetch('./data/rates.json')).json();
  const core = await (await fetch('./data/core.json')).json();
  const assum = await (await fetch('./data/indirect-tax-parameters.json')).json();
  const ctx = {
    data: { rates, core, 'indirect-tax-parameters': assum },
    core,
    store: { get: () => false },
    period: {},
  };
  const env = m.getEnv(ctx);
  return cases.map((c) => {
    const r = m.compute(
      {
        gross: String(c.gross),
        rules: c.rules,
        tzpb: c.tzpb ?? null,
        ind: false,
        purchases: '',
        fuel: '',
        tobacco: '',
      },
      env,
    );
    const o = { kind: r.kind, err: r.errors.gross, text: '' } as ComputeResult;
    if (r.kind === 'ok') {
      Object.assign(o, {
        emp: r.emp,
        tax: r.tax,
        er: r.er,
        net: r.net,
        yEmp: r.yEmp,
        yTax: r.yTax,
        yEr: r.yEr,
        total: r.total,
        yTotal: r.yTotal,
        funds: r.funds,
        capped: r.r.capped,
        year: r.year,
        periods: r.periods.map(
          (p: { months: number; emp: number; tax: number; er: number; net: number }) => ({
            months: p.months,
            emp: p.emp,
            tax: p.tax,
            er: p.er,
            net: p.net,
          }),
        ),
        text: String(m.resultMarkup(r, {}, env))
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' '),
      });
    } else
      o.text = String(m.resultMarkup(r, {}, env))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
    return o;
  });
};
export const indirectTaxResults = async () => {
  const { indirectTaxes } = await import(new URL('./js/calc.js', location.href).href);
  const { getEnv, compute, resetMem, applyReferencePrices } = await import(
    new URL('./js/pages/s18-danaci.js', location.href).href
  );
  const a = await (await fetch('./data/indirect-tax-parameters.json')).json();
  const base = {
    vat20Eur: 120,
    vat9Eur: 109,
    vat0Eur: 50,
    fuelType: 'petrol',
    fuelLitres: 10,
    fuelPrice: 2,
    tobaccoPacks: 1,
    tobaccoPrice: 3,
    sticksPerPack: 20,
    date: '2027-02-28',
  };
  const cases = [
    {},
    { fuelType: 'diesel' },
    { tobaccoPrice: 10 },
    { date: '2027-03-01' },
    { date: '2027-03-01', tobaccoPrice: 10 },
    { fuelPrice: null },
    { fuelLitres: null },
    { tobaccoPrice: null },
    { tobaccoPacks: null },
    { vat20Eur: 0, vat9Eur: 0, vat0Eur: 0, fuelLitres: 0, tobaccoPacks: 0 },
  ];
  const rows = cases.map((c) => indirectTaxes({ ...base, ...c }, a));
  const rates = await (await fetch('./data/rates.json')).json();
  const core = await (await fetch('./data/core.json')).json();
  const state = {
    gross: '1500',
    ind: true,
    purchases: '120',
    reduced: '109',
    exempt: '50',
    fuel: '10',
    fuelPrice: '2',
    tobacco: '1',
    tobaccoPrice: '3',
    sticks: '20',
    date: '2027-02-28',
    fuelType: 'petrol',
  };
  const views = [false, true].map(
    (real) =>
      compute(
        state,
        getEnv({
          data: { rates, core, 'indirect-tax-parameters': a },
          core,
          store: { get: (k: string) => k === 'onlyReal' && real },
          period: {},
        }),
      ).ind,
  );
  const env = getEnv({
    data: { rates, core, 'indirect-tax-parameters': a },
    core,
    store: { get: () => false },
    period: {},
  });
  const decimalPrices = compute({ ...state, fuelPrice: '1.605', tobaccoPrice: '3.512' }, env).ind
    .inp;
  const reference = resetMem();
  applyReferencePrices(reference, a);
  Object.assign(reference, {
    ...state,
    fuelPrice: reference.fuelPrice,
    tobaccoPrice: reference.tobaccoPrice,
  });
  const before = compute(reference, env).ind.inp;
  const shown = [reference.fuelPrice, reference.tobaccoPrice];
  const edited = compute({ ...reference, fuelPriceEdited: true, tobaccoPriceEdited: true }, env).ind
    .inp;
  reference.fuelType = 'diesel';
  applyReferencePrices(reference, a);
  const diesel = compute(reference, env).ind.inp;
  return {
    rows,
    views,
    decimalPrices,
    references: {
      before,
      edited,
      shown,
      diesel,
      expected: [
        a.fuels.petrol.pricePerLitre,
        a.references.pack.priceEur,
        a.fuels.diesel.pricePerLitre,
      ],
    },
  };
};
export type ComputeResult = {
  kind: string;
  err: string | null;
  text: string;
  emp: number;
  tax: number;
  er: number;
  net: number;
  yEmp: number;
  yTax: number;
  yEr: number;
  total: number;
  yTotal: number;
  funds: { you: number | null; boss: number | null; id: string }[];
  year: boolean;
  periods: { months: number }[];
  capped: boolean;
};
export type IndirectResult = {
  rows: {
    fuelExcise: number | null;
    vat: number | null;
    tobaccoExcise: number | null;
    total: number | null;
  }[];
  views: ({ unavailable: boolean } | null)[];
  decimalPrices: { fuelPrice: number; tobaccoPrice: number };
  references: {
    before: { fuelPrice: number; tobaccoPrice: number };
    edited: { fuelPrice: number; tobaccoPrice: number };
    shown: string[];
    diesel: { fuelPrice: number };
    expected: number[];
  };
};
