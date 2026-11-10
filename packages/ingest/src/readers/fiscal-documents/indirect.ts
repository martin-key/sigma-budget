import { parseLegalDocx, type DocxDocument } from '../documents/index.js';
import { parseDocument } from 'htmlparser2';
import { parseXml, descendants } from '../documents/xml.js';
import { utf8 } from '../snapshots/pinned.js';
import {
  readPdf,
  words,
  search,
  assert,
  ws,
  midX,
  type PdfDocument,
  type Box,
} from '../pdf/index.js';
import {
  parseNsiPack,
  statutoryFuelRates,
  type IndirectTaxReaderEvidence,
} from '../../build/indirect-taxes.js';
import { authenticate, FISCAL_DOCUMENT_PATHS as paths, type FiscalOriginal } from './source.js';
import { readEcTaxSheet } from './ec-workbook.js';
import { readFiscalZipMember } from './emf.js';

export type IndirectOriginals = Readonly<
  Record<'prices' | 'duties' | 'gazette' | 'customs' | 'nsi' | 'bill', FiscalOriginal>
>;
export interface PhysicalNsiPack {
  page: number;
  printedPage: 200;
  table: 'VIII.8';
  unit: 'BGN/pack';
  product: string;
  productBoxes: Box[];
  yearHeaders: number[];
  cells: { year: number; printed: string; value: number; bbox: Box; headerBox: Box }[];
}
export interface IndirectDocumentEvidence extends Pick<
  IndirectTaxReaderEvidence,
  'nsiPages' | 'customsPages' | 'docxTables'
> {
  nsi: PhysicalNsiPack;
  customs: Record<
    'petrol' | 'diesel',
    { amount: string; quote: string; pages: number[]; productBoxes: { page: number; bbox: Box }[] }
  >;
  docx: DocxDocument;
  sources: Pick<IndirectTaxReaderEvidence['sources'], 'nsi' | 'customs' | 'bill'>;
}
export interface IndependentIndirectEvidence {
  schema: 'indirect-tax-evidence/1';
  sources: Record<keyof IndirectOriginals, { path: string; sha256: string }>;
  vat: { standardPct: number; reducedPct: number; standardSince: string; unit: string };
  fuels: Record<
    string,
    {
      excisePerLitre: number;
      originalExcise: number;
      pricePerLitre: number;
      originalPrice: number;
      priceDate: string;
      validFrom: string;
      originalBgnPer1000: number;
      conversionRate: number;
    }
  >;
  cigarettes: {
    validFrom: string;
    validTo?: string;
    specificPer1000: number;
    adValoremPct: number;
    minimumPer1000: number;
  }[];
  pack: {
    period: string;
    originalValue: number;
    priceEur: number;
    conversionRate: number;
    yearHeaders: number[];
  };
}
const EUR = 1.95583;
export function nsiPackFromPdf(pdf: PdfDocument, year = 2025): PhysicalNsiPack {
  const phrase = ['Цигари', 'с', 'филтър', '-', 'кутия'];
  const candidates = pdf.pages.flatMap((page) => {
    const ww = words(page),
      hits = ww.flatMap((_, i) => (phrase.every((t, j) => ww[i + j]?.text === t) ? [i] : []));
    return hits.map((at) => ({ page, ww, at }));
  });
  assert(candidates.length === 1, 'NSI missing/ambiguous physical product row');
  const { page, ww, at } = candidates[0]!,
    rowY = ww[at]!.bbox[1];
  assert(page.text.includes('(BGN)') && page.text.includes('(Левове)'), 'NSI currency must be BGN');
  assert(
    phrase.every((_, i) => Math.abs(ww[at + i]!.bbox[1] - rowY) < 2),
    'NSI product label crosses physical rows',
  );
  const groups = new Map<number, typeof ww>();
  for (const w of ww)
    if (/^20\d{2}$/u.test(w.text) && w.bbox[1] < rowY) {
      const k = Math.round(w.bbox[1]),
        g = groups.get(k) ?? [];
      g.push(w);
      groups.set(k, g);
    }
  const headers = [...groups.values()].filter(
    (g) => g.length > 1 && g.some((w) => w.text === String(year)),
  );
  assert(headers.length === 1, 'NSI missing/ambiguous physical year header');
  const hh = headers[0]!.sort((a, b) => a.bbox[0] - b.bbox[0]),
    years = hh.map((h) => Number(h.text));
  assert(
    new Set(years).size === years.length && years.every((v, i) => !i || v > years[i - 1]!),
    'NSI duplicate/unordered years',
  );
  const cells = hh.map((h) => {
    const hits = ww.filter(
      (w) =>
        Math.abs(w.bbox[1] - rowY) < 2 &&
        /^\d+[.,]\d{2}$/u.test(w.text) &&
        Math.abs(midX(w.bbox) - midX(h.bbox)) < 12,
    );
    assert(hits.length === 1, `NSI missing/ambiguous physical price column ${h.text}`);
    const w = hits[0]!;
    return {
      year: Number(h.text),
      printed: w.text,
      value: Number(w.text.replace(',', '.')),
      bbox: w.bbox,
      headerBox: h.bbox,
    };
  });
  return {
    page: page.number,
    printedPage: 200,
    table: 'VIII.8',
    unit: 'BGN/pack',
    product: phrase.join(' '),
    productBoxes: ww.slice(at, at + phrase.length).map((w) => w.bbox),
    yearHeaders: years,
    cells,
  };
}
export function customsFromPdf(pdf: PdfDocument): IndirectDocumentEvidence['customs'] {
  // Independent legal-evidence donor deliberately uses physical PDF pages 41–42.
  const pages = pdf.pages.slice(40, 42);
  assert(pages.length === 2, 'Customs article pages missing');
  const text = ws(pages.map((p) => p.text).join(' '));
  assert(text.includes('Чл. 32.') && text.includes('Акцизните'), 'Missing Customs art.32');
  const result = {} as IndirectDocumentEvidence['customs'];
  for (const [name, product] of [
    ['petrol', 'безоловен бензин'],
    ['diesel', 'газьол'],
  ] as const) {
    const hits = [
      ...text.matchAll(
        new RegExp(
          product + '(?:(?!;|за безоловен бензин|за газьол).)*?([0-9]+) лв\\. за 1000 литра',
          'gu',
        ),
      ),
    ];
    assert(hits.length === 1, `Customs ambiguous/missing rate ${name}`);
    const productBoxes = pages.flatMap((p) =>
      search(p, product).map((bbox) => ({ page: p.number, bbox })),
    );
    assert(productBoxes.length === 1, `Customs physical product ${name}`);
    result[name] = {
      amount: hits[0]![1]!,
      quote: hits[0]![0],
      pages: pages.map((p) => p.number),
      productBoxes,
    };
  }
  return result;
}
/** Expand only declared OOXML gridSpan/vMerge. No guessed blank values. */
export function expandedDocxTables(doc: DocxDocument, verbatim?: string[][][]): string[][][] {
  return doc.tables.map((table, ti) => {
    const previous = new Map<number, string>();
    return table.rows.map((row, ri) => {
      const result: string[] = [];
      let col = 0;
      for (const [ci, cell] of row.entries()) {
        let text = verbatim?.[ti]?.[ri]?.[ci] ?? cell.text;
        if (cell.verticalMerge === 'continue') {
          assert(previous.has(col), 'Unresolved DOCX vertical merge');
          text = previous.get(col)!;
        }
        for (let i = 0; i < cell.gridSpan; i++) {
          previous.set(col + i, text);
          result.push(text);
        }
        col += cell.gridSpan;
      }
      return result;
    });
  });
}
/** python-docx cell.text spelling, including leading spaces and paragraph breaks.
 * Physical ownership/grid properties still come from prerequisite 44. */
function verbatimDocxCells(bytes: Uint8Array): string[][][] {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    root = parseXml(utf8(readFiscalZipMember(bytes, 'word/document.xml')));
  const tables = [...descendants(root)].filter((n) => n.uri === W && n.local === 'tbl');
  return tables.map((t) =>
    t.children
      .filter((n) => n.uri === W && n.local === 'tr')
      .map((r) =>
        r.children
          .filter((n) => n.uri === W && n.local === 'tc')
          .map((c) =>
            c.children
              .filter((n) => n.uri === W && n.local === 'p')
              .map((p) =>
                [...descendants(p)]
                  .map((n) =>
                    n.uri !== W
                      ? ''
                      : n.local === 't'
                        ? n.content.filter((v) => typeof v === 'string').join('')
                        : n.local === 'tab'
                          ? '\t'
                          : ['br', 'cr'].includes(n.local)
                            ? '\n'
                            : '',
                  )
                  .join(''),
              )
              .join('\n'),
          ),
      ),
  );
}
export function extractIndirectDocuments(
  originals: Pick<IndirectOriginals, 'nsi' | 'customs' | 'bill'>,
): IndirectDocumentEvidence {
  const nsiPdf = readPdf(authenticate(originals.nsi, paths.nsi), {
      maxPages: 1000,
      maxChars: 8_000_000,
    }),
    customsPdf = readPdf(authenticate(originals.customs, paths.customs)),
    docx = parseLegalDocx(authenticate(originals.bill, paths.bill));
  const sources = Object.fromEntries(
    (['nsi', 'customs', 'bill'] as const).map((k) => [
      k,
      { path: originals[k].path, sha256: originals[k].sha256 },
    ]),
  ) as IndirectDocumentEvidence['sources'];
  return {
    nsiPages: nsiPdf.pages.map((p) => p.text),
    customsPages: customsPdf.pages.map((p) => p.text),
    docxTables: expandedDocxTables(docx, verbatimDocxCells(originals.bill.bytes)),
    docx,
    nsi: nsiPackFromPdf(nsiPdf),
    customs: customsFromPdf(customsPdf),
    sources,
  };
}
/** Transport text parts as HTMLParser.handle_data would, including real inline text.
 * No regex stripping of tags or synthetic schedule fragments. */
export function indirectHtmlParts(bytes: Uint8Array): string[] {
  const doc = parseDocument(utf8(bytes), { decodeEntities: true }),
    out: string[] = [];
  function visit(n: (typeof doc)['children'][number]): void {
    if (n.type === 'text') out.push(n.data);
    if ('children' in n) for (const child of n.children) visit(child);
  }
  for (const n of doc.children) visit(n);
  return out;
}
function sourceRecords(originals: IndirectOriginals): IndependentIndirectEvidence['sources'] {
  const out = {} as IndependentIndirectEvidence['sources'];
  for (const key of ['prices', 'duties', 'gazette', 'customs', 'nsi', 'bill'] as const) {
    authenticate(originals[key], paths[key]);
    out[key] = { path: originals[key].path, sha256: originals[key].sha256 };
  }
  return out;
}
/** Actual-source builder input. PDF evidence is also bound to physical headers
 * independently below; worksheet semantics remain checked by the existing builder. */
export function readIndirectTaxInput(originals: IndirectOriginals): {
  input: IndirectTaxReaderEvidence;
  documents: IndirectDocumentEvidence;
} {
  const sources = sourceRecords(originals),
    documents = extractIndirectDocuments(originals);
  // Bind the exact text form consumed by the existing builder to separately
  // located physical columns/clauses, rather than trusting page inclusion.
  const pack = parseNsiPack(documents.nsiPages[documents.nsi.page - 1]!);
  assert(
    JSON.stringify(pack.years) === JSON.stringify(documents.nsi.yearHeaders) &&
      pack.original === documents.nsi.cells.find((c) => c.year === 2025)?.value,
    'NSI builder text disagrees with physical year columns',
  );
  const legal = statutoryFuelRates(documents.customsPages.join(' '));
  for (const fuel of ['petrol', 'diesel'] as const)
    assert(
      legal[fuel].amount === documents.customs[fuel].amount,
      'Customs builder text disagrees with physical article evidence',
    );
  const reduced = documents.docxTables.flatMap((t) =>
    t.filter((r) => r.some((c) => c.includes('настаняване, предоставяно'))),
  );
  assert(
    reduced.length === 1 &&
      reduced[0]![2] === '%' &&
      reduced[0]!.slice(3).length > 0 &&
      reduced[0]!.slice(3).every((v) => v === reduced[0]![3]),
    'Reduced VAT physical unit/year columns disagree',
  );
  return {
    input: {
      prices: readEcTaxSheet(originals.prices.bytes, 'Sheet1'),
      duties: readEcTaxSheet(originals.duties.bytes, 'Excise duties'),
      vat: readEcTaxSheet(originals.duties.bytes, 'VAT'),
      sheets: { prices: 'Sheet1', duties: 'Excise duties', vat: 'VAT' },
      priceFilename: paths.prices.split('/').at(-1)!,
      gazetteParts: indirectHtmlParts(originals.gazette.bytes),
      nsiPages: documents.nsiPages,
      customsPages: documents.customsPages,
      docxTables: documents.docxTables,
      sources,
    },
    documents,
  };
}
const decimal = (s: string | undefined) => {
  assert(s !== undefined && /^\d+(?:\.\d+)?$/u.test(s), 'Invalid independent decimal');
  return Number(s);
};
function converted(bgn: string, places: number): number {
  assert(/^\d+(?:\.\d+)?$/u.test(bgn), 'Invalid BGN amount');
  const [whole, fraction = ''] = bgn.split('.');
  const numerator = BigInt(whole! + fraction) * 100000n * 10n ** BigInt(places),
    denominator = 195583n * 10n ** BigInt(fraction.length);
  return Number((2n * numerator + denominator) / (2n * denominator)) / 10 ** places;
}
const date = (s: string | undefined) => {
  assert(s !== undefined && /^\d+$/u.test(s) && Number(s) <= 2958465, 'Invalid independent date');
  return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10);
};
function cigaretteEvidence(parts: string[]): IndependentIndirectEvidence['cigarettes'] {
  const text = ws(parts.join(' ')),
    start = text.indexOf('Чл. 39. (1) Акцизната ставка за цигарите');
  assert(start >= 0, 'Missing independent cigarette article');
  const article = text.slice(start).split(/§\s*\d+\./u)[0]!;
  const ss = article.split('на специфичния акциз:')[1]?.split('на пропорционалния акциз:')[0],
    pp = article.split('на пропорционалния акциз:')[1]?.split('(2)')[0],
    mm = article.split('(2)')[1];
  const records = (body: string | undefined, unit: string) => {
    assert(body, 'Missing independent cigarette section');
    const out = new Map<string, number>();
    for (const m of body.matchAll(
      new RegExp(
        '(\\d+(?:,\\d+)?) ' + unit + ' от (\\d+) (август|март|януари) (\\d{4}) г\\.',
        'gu',
      ),
    )) {
      const month = ({ август: 8, март: 3, януари: 1 } as Record<string, number>)[m[3]!]!,
        iso = `${m[4]}-${String(month).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
      assert(
        !out.has(iso) && new Date(iso).toISOString().slice(0, 10) === iso,
        'Invalid/duplicate cigarette period',
      );
      out.set(iso, Number(m[1]!.replace(',', '.')));
    }
    assert(out.size > 0, 'Missing independent cigarette rates');
    return out;
  };
  const specific = records(ss, 'евро за 1000 къса'),
    proportion = records(pp, 'на сто от продажната цена'),
    minimum = records(mm, 'евро (?:на|за) 1000 къса'),
    dates = [...specific.keys()].sort();
  assert(
    JSON.stringify(dates) === JSON.stringify([...proportion.keys()].sort()) &&
      JSON.stringify(dates) === JSON.stringify([...minimum.keys()].sort()),
    'Inconsistent independent cigarette periods',
  );
  return dates.map((validFrom, i) => ({
    validFrom,
    ...(dates[i + 1]
      ? { validTo: new Date(Date.parse(dates[i + 1]!) - 86400000).toISOString().slice(0, 10) }
      : {}),
    specificPer1000: specific.get(validFrom)!,
    adValoremPct: proportion.get(validFrom)!,
    minimumPer1000: minimum.get(validFrom)!,
  }));
}
/** Independent-rule binding: derives expected coefficients from physical words,
 * legal clauses and named-sheet headers. Never calls buildIndirectTaxes. */
export function readIndirectEvidence(originals: IndirectOriginals): IndependentIndirectEvidence {
  const sources = sourceRecords(originals),
    docs = extractIndirectDocuments(originals),
    prices = readEcTaxSheet(originals.prices.bytes, 'Sheet1'),
    excises = readEcTaxSheet(originals.duties.bytes, 'Excise duties'),
    vat = readEcTaxSheet(originals.duties.bytes, 'VAT');
  assert(prices.A1 === 'in EUR', 'Wrong independent EC price currency');
  assert(
    excises.C1 === 'Excises - in national currency per unit (L or t)',
    'Wrong independent EC duty currency',
  );
  const productColumn = (cells: Record<string, string>, fuel: string) => {
    const term = fuel === 'petrol' ? 'Euro-super 95' : 'Dieselkraftstoff',
      hits = Object.entries(cells).filter(([, v]) => v.includes(term));
    assert(hits.length === 1, 'Ambiguous independent EC product');
    return hits[0]![0].replace(/\d+$/u, '');
  };
  const countryRow = (cells: Record<string, string>, country: string) => {
    const hits = Object.entries(cells).filter(([, v]) => v === country);
    assert(hits.length === 1, 'Ambiguous independent EC country');
    return /\d+$/u.exec(hits[0]![0])![0];
  };
  const pr = countryRow(prices, 'Bulgaria'),
    er = countryRow(excises, 'BG_'),
    vr = countryRow(vat, 'BG_'),
    observed = date(prices.A2);
  assert(paths.prices.includes(observed), 'Independent EC observation date mismatch');
  const fuels: IndependentIndirectEvidence['fuels'] = {},
    standards = new Set<number>();
  for (const fuel of ['petrol', 'diesel'] as const) {
    const pc = productColumn(prices, fuel),
      ec = productColumn(excises, fuel),
      vc = productColumn(vat, fuel);
    assert(
      prices[pc + '2'] === '1000 l' && excises[ec + '4'] === '1000 l',
      'Wrong independent EC source units',
    );
    const excise = decimal(excises[ec + er]),
      price = decimal(prices[pc + pr]),
      legal = docs.customs[fuel].amount;
    assert(excise === converted(legal, 2), 'EC rate differs from Customs conversion');
    fuels[fuel] = {
      excisePerLitre: Number(excises[ec + er] + 'e-3'),
      originalExcise: excise,
      pricePerLitre: Number(prices[pc + pr] + 'e-3'),
      originalPrice: price,
      priceDate: observed,
      validFrom: date(excises['B' + er]),
      originalBgnPer1000: Number(legal),
      conversionRate: EUR,
    };
    standards.add(decimal(vat[vc + vr]));
  }
  assert(standards.size === 1, 'Inconsistent independent source VAT');
  const reduced = docs.docxTables.flatMap((t) =>
    t.filter((r) => r.some((c) => c.includes('настаняване, предоставяно'))),
  );
  assert(reduced.length === 1, 'Ambiguous independent reduced VAT row');
  const row = reduced[0]!,
    unit = row.indexOf('%');
  assert(unit >= 0 && row.length > unit + 1, 'Missing independent VAT unit');
  const rates = row.slice(unit + 1).map(decimal);
  assert(new Set(rates).size === 1, 'Ambiguous independent reduced VAT periods');
  const target = docs.nsi.cells.find((c) => c.year === 2025)!;
  assert(target, 'Missing NSI 2025 physical cell');
  return {
    schema: 'indirect-tax-evidence/1',
    sources,
    vat: {
      standardPct: [...standards][0]!,
      reducedPct: rates[0]!,
      standardSince: date(vat['B' + vr]),
      unit: '%',
    },
    fuels,
    cigarettes: cigaretteEvidence(indirectHtmlParts(originals.gazette.bytes)),
    pack: {
      originalValue: target.value,
      priceEur: converted(target.printed.replace(',', '.'), 8),
      conversionRate: EUR,
      period: '2025',
      yearHeaders: docs.nsi.yearHeaders,
    },
  };
}
