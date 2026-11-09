import { metadata } from '../common/metadata.js';
import { pythonRound } from '../common/format.js';

type Cells = Record<string, string>;
export interface IndirectTaxReaderEvidence {
  prices: Cells;
  duties: Cells;
  vat: Cells;
  sheets: { prices: string; duties: string; vat: string };
  priceFilename: string;
  gazetteParts: string[];
  nsiPages: string[];
  customsPages: string[];
  docxTables: string[][][];
  sources: Record<string, { path: string; sha256: string }>;
}

const EUR = 1.95583;
function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function decimal(text: string | undefined): number {
  requireValue(text !== undefined && /^[+-]?\d+(?:\.\d+)?$/.test(text), 'invalid decimal');
  const result = Number(text);
  requireValue(Number.isFinite(result), 'invalid decimal');
  return result;
}
function decimalParts(text: string): [bigint, bigint] {
  decimal(text);
  const [whole, fraction = ''] = text.split('.');
  return [BigInt(whole! + fraction), 10n ** BigInt(fraction.length)];
}
function euroCents(bgn: string): bigint {
  const [n, d] = decimalParts(bgn);
  requireValue(n >= 0n, 'negative statutory rate');
  const numerator = n * 100000n * 100n;
  const denominator = d * 195583n;
  return (numerator * 2n + denominator) / (denominator * 2n);
}
function matchesCents(amount: string, cents: bigint): boolean {
  const [n, d] = decimalParts(amount);
  return n * 100n === cents * d;
}
function perThousand(text: string): number {
  decimal(text);
  return Number(`${text}e-3`);
}
export function excelTaxDate(value: string | undefined): string {
  requireValue(value !== undefined && /^\d+$/.test(value), 'invalid Excel date');
  const days = Number(value);
  requireValue(Number.isSafeInteger(days) && days <= 2958465, 'invalid Excel date');
  return new Date(Date.UTC(1899, 11, 30) + days * 86400000).toISOString().slice(0, 10);
}
export function checkEcTaxTables(
  prices: Cells,
  duty: Cells,
  vat: Cells,
  buildDate: string,
  priceFilename: string,
): void {
  const normal = (value: string | undefined) => (value ?? '').trim().replace(/\s+/gu, ' ');
  const petrol = 'Euro-super 95 (I)',
    diesel = 'Gas oil automobile Automotive gas oil Dieselkraftstoff (I)';
  requireValue(normal(prices.A1) === 'in EUR', 'fuel price currency must be EUR');
  requireValue(
    prices.A5 === 'Bulgaria' && duty.A7 === 'BG_' && vat.A7 === 'BG_',
    'wrong country in EC tables',
  );
  requireValue(
    normal(prices.B1) === petrol && normal(prices.C1) === diesel,
    'wrong price product columns',
  );
  for (const table of [duty, vat]) {
    requireValue(
      normal(table.C3) === petrol && normal(table.D3) === diesel,
      'wrong tax product columns',
    );
    requireValue(table.C4 === '1000 l' && table.D4 === '1000 l', 'wrong EC tax units');
  }
  requireValue(prices.B2 === '1000 l' && prices.C2 === '1000 l', 'wrong EC price units');
  requireValue(
    duty.C1 === 'Excises - in national currency per unit (L or t)',
    'wrong excise table or currency basis',
  );
  requireValue(vat.C1 === 'VAT (Value added tax), %', 'wrong VAT table');
  const observed = excelTaxDate(prices.A2);
  const match = /^weekly-prices-(\d{4}-\d{2}-\d{2})\.xlsx$/u.exec(priceFilename);
  requireValue(
    match && observed === match[1] && observed <= buildDate,
    'wrong fuel observation date',
  );
  requireValue(
    excelTaxDate(duty.B7) <= observed,
    'excise snapshot is newer than the price observation',
  );
  requireValue(decimal(vat.C7) === decimal(vat.D7), 'inconsistent petrol/diesel VAT');
}

export function parseNsiPack(
  text: string,
  year = 2025,
): { original: number; quote: string; years: number[] } {
  const label = 'Цигари с филтър - кутия';
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = lines.flatMap((line, i) => (line === label ? [i] : []));
  requireValue(rows.length === 1, 'missing or ambiguous NSI cigarette row');
  const row = rows[0]!;
  requireValue(
    lines.slice(0, row).includes('(BGN)') && lines.slice(0, row).includes('(Левове)'),
    'wrong NSI currency',
  );
  const groups: number[][] = [];
  let current: number[] = [];
  for (const line of [...lines.slice(0, row), 'END']) {
    if (/^(?:20\d{2})(?:\s+20\d{2})*$/u.test(line)) current.push(...line.split(/\s+/u).map(Number));
    else if (current.length) {
      groups.push(current);
      current = [];
    }
  }
  const headers = groups.filter((values) => values.includes(year) && values.length > 1);
  requireValue(headers.length === 1, 'missing or ambiguous NSI year headers');
  const years = headers[0]!;
  requireValue(
    new Set(years).size === years.length && years.every((v, i) => !i || v > years[i - 1]!),
    'invalid NSI year columns',
  );
  const cells: string[] = [];
  for (const line of lines.slice(row + 1)) {
    const tokens = line.split(/\s+/u),
      numeric: string[] = [];
    for (const token of tokens) {
      if (!/^(?:\d+[.,]\d{2}|\.)$/u.test(token)) break;
      numeric.push(token);
    }
    if (!numeric.length) break;
    cells.push(...numeric);
    if (numeric.length < tokens.length) break;
  }
  requireValue(cells.length === years.length, 'NSI row width differs from year header width');
  const value = cells[years.indexOf(year)]!;
  requireValue(value !== '.', 'missing NSI observation for target year');
  return {
    original: decimal(value.replace(',', '.')),
    quote: `${label}\n${cells.join('\n')}`,
    years,
  };
}

export function statutoryFuelRates(
  text: string,
): Record<'petrol' | 'diesel', { amount: string; quote: string }> {
  const section = /Чл\.\s*32\..*?\(1\)(.*?)(?=\(2\))/u.exec(text.replace(/\s+/gu, ' '));
  requireValue(section, 'missing ЗАДС art.32(1)');
  const result = {} as Record<'petrol' | 'diesel', { amount: string; quote: string }>;
  for (const [name, product] of [
    ['petrol', 'безоловен бензин'],
    ['diesel', 'газьол'],
  ] as const) {
    const hits = [
      ...section[1]!.matchAll(
        new RegExp(`${product}.{0,350}?([0-9]+(?:[.,][0-9]+)?) лв\\. за 1000 литра`, 'gu'),
      ),
    ];
    requireValue(hits.length === 1, `missing or ambiguous statutory fuel rate: ${name}`);
    result[name] = { amount: hits[0]![1]!.replace(',', '.'), quote: hits[0]![0] };
  }
  return result;
}

export function buildIndirectTaxes(input: IndirectTaxReaderEvidence, buildDate: string) {
  const { prices, duties, vat } = input;
  requireValue(
    input.sheets.prices === 'Sheet1' &&
      input.sheets.duties === 'Excise duties' &&
      input.sheets.vat === 'VAT',
    'wrong named worksheet',
  );
  checkEcTaxTables(prices, duties, vat, buildDate, input.priceFilename);
  const law = input.gazetteParts.join(' ').replace(/\s+/gu, ' ');
  const start = law.indexOf('77 евро за 1000 къса');
  requireValue(start >= 0, 'missing cigarette schedule');
  const quote = law.slice(start, start + 1100),
    floorStart = quote.indexOf('(2)');
  requireValue(floorStart >= 0, 'missing cigarette minimum');
  const dates = [
    ['2026-08-01', '1 август 2026'],
    ['2027-03-01', '1 март 2027'],
    ['2028-01-01', '1 януари 2028'],
  ] as const;
  const cigarettes = dates.map(([validFrom, words], i) => {
    const specific = new RegExp(`(\\d+) евро за 1000 къса от ${words}`, 'u').exec(quote);
    const proportion = new RegExp(
      `(\\d+(?:,\\d+)?) на сто от продажната цена от ${words}`,
      'u',
    ).exec(quote);
    const floor = new RegExp(`(\\d+) евро (?:на|за) 1000 къса от ${words}`, 'u').exec(
      quote.slice(floorStart),
    );
    requireValue(specific && proportion && floor, 'missing cigarette schedule rate');
    const next = dates[i + 1]?.[0];
    return {
      validFrom,
      ...(next
        ? { validTo: new Date(Date.parse(next) - 86400000).toISOString().slice(0, 10) }
        : {}),
      specificPer1000: decimal(specific[1]),
      adValoremPct: decimal(proportion[1]!.replace(',', '.')),
      minimumPer1000: decimal(floor[1]),
      unit: 'EUR/1000 sticks',
      source: 'excise-law',
      basis: 'ЗАДС, чл. 39; ДВ 69/31.07.2026, §31',
      quote,
    };
  });
  const pages = input.nsiPages.flatMap((text, i) =>
    text.includes('Цигари с филтър - кутия') ? [{ text, page: i + 1 }] : [],
  );
  requireValue(pages.length === 1, 'missing or ambiguous NSI product page');
  const pack = parseNsiPack(pages[0]!.text);
  const reduced = input.docxTables.flatMap((table) =>
    table.filter((row) => row.some((cell) => cell.includes('настаняване, предоставяно'))),
  );
  requireValue(reduced.length === 1, 'missing or ambiguous reduced VAT row');
  const reducedCells = reduced[0]!,
    reducedPct = decimal(reducedCells[3]);
  const legal = statutoryFuelRates(input.customsPages.join(' '));
  const fuels = Object.fromEntries(
    (
      [
        ['petrol', 'C', 'B'],
        ['diesel', 'D', 'C'],
      ] as const
    ).map(([name, col, priceCol]) => {
      const duty = duties[col + '7']!,
        price = prices[priceCol + '5']!,
        evidence = legal[name];
      requireValue(
        matchesCents(duty, euroCents(evidence.amount)),
        'EC national-currency amount is not the statutory EUR rate',
      );
      return [
        name,
        {
          excisePerLitre: perThousand(duty),
          originalExcise: decimal(duty),
          originalUnit: 'EUR/1000 l',
          unit: 'EUR/l',
          validFrom: excelTaxDate(duties.B7),
          legalEvidence: {
            source: 'customs-excise-law',
            quote: evidence.quote,
            basis: 'ЗАДС, чл. 32, ал. 1; консолидация ДВ 54/2025',
            originalBgnPer1000: decimal(evidence.amount),
            conversionRate: EUR,
            note: 'Историческият текст е в BGN. Коефициентът в EUR е сверен по фиксирания курс и закръгляне до цент за 1000 л.',
          },
          source: 'ec-oil',
          basis: `ЗАДС, чл. 32; ЕК, Excise duties, ${col}7`,
          pricePerLitre: perThousand(price),
          originalPrice: decimal(price),
          priceDate: excelTaxDate(prices.A2),
          priceSource: 'ec-oil',
        },
      ];
    }),
  );
  return {
    meta: metadata('D26', 'Параметри на косвените данъци', buildDate, {
      source: ['ec-oil', 'excise-law', 'customs-excise-law', 'nsi-pack', 'bill'],
      asOf: excelTaxDate(prices.A2),
      sourceNote: 'Официални ставки и датирани справочни цени. Изчисленията са сценарий.',
    }),
    vat: {
      standardPct: decimal(vat.C7),
      standardSince: excelTaxDate(vat.B7),
      reducedPct,
      untaxed: {
        kind: 'definition',
        label: 'без ДДС / 0 %',
        basis: 'ЗДДС — нулева ставка и освободени доставки',
        note: 'Категория за разходи без начислен ДДС в тази сметка; не е извлечена ставка.',
      },
      source: ['ec-oil', 'bill'],
      basis: 'ЗДДС, чл. 66 и 66а; мотиви, Приложение 2',
      reducedQuote: reducedCells.join(' | '),
      unit: '%',
    },
    fuels,
    cigarettes,
    references: {
      pack: {
        originalValue: pack.original,
        originalUnit: 'BGN/pack',
        priceEur: pythonRound(pack.original / EUR, 8),
        conversionRate: EUR,
        period: '2025',
        published: '2026-06-02',
        source: 'nsi-pack',
        page: pages[0]!.page,
        printedPage: 200,
        table: 'VIII.8',
        quote: pack.quote,
        yearHeaders: pack.years,
        unit: 'EUR/pack',
        note: 'Цигари с филтър, кутия; броят късове се въвежда отделно.',
      },
    },
  };
}
