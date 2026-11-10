/** validate/indirect_taxes.py: source evidence is independent of the D26 producer. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Check, pyTruth } from './checks.js';
import { Context, safePath, strictJson } from './context.js';
import type { Group } from './runner.js';
import { equal, keys, sameSet, type Doc } from './rule-support.js';

export const INDIRECT_EVIDENCE_PATH = 'data/inputs/indirect_tax_evidence.json';
export const INDIRECT_SOURCE_PATHS = {
  prices: 'data/originals/ec-oil/weekly-prices-2026-11-02.xlsx',
  duties: 'data/originals/ec-oil/duties-and-taxes-2026-11-07.xlsx',
  gazette: 'data/originals/excise-law/dv-69-2026-budget.html',
  customs: 'data/originals/excise-law/excise-law-dv54-2025.pdf',
  nsi: 'data/originals/nsi-pack/statistical-yearbook-2025.pdf',
  bill: 'data/originals/parliament/52-602-01-19.docx',
} as const;
export interface OriginalBytes {
  path: string;
  sha256: string;
  bytes: Uint8Array;
}
export interface IndirectEvidence {
  schema: 'indirect-tax-evidence/1';
  sources: Record<keyof typeof INDIRECT_SOURCE_PATHS, { path: string; sha256: string }>;
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
/** Must decode the supplied originals, using a strategy independent of the producer.
 * A saved producer output or a shared expected-result builder is not a binding. */
export type IndirectEvidenceReader = (
  sources: Readonly<Record<keyof typeof INDIRECT_SOURCE_PATHS, OriginalBytes>>,
) => IndirectEvidence;
export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
export function originalPins(ctx: Context): Map<string, string> {
  return new Map(
    readFileSync(safePath(ctx.root, 'data/originals.sha256'), 'utf8')
      .split(/\r?\n/)
      .filter((x) => x.trim())
      .map((line) => {
        const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
        if (!m) throw new Error('invalid original pin record');
        return [m[2]!, m[1]!];
      }),
  );
}
function expectedValues(ctx: Context, c: Check, reader?: IndirectEvidenceReader): IndirectEvidence {
  const bytes = readFileSync(safePath(ctx.root, INDIRECT_EVIDENCE_PATH)),
    frozen = strictJson(bytes.toString('utf8')) as IndirectEvidence,
    pins = originalPins(ctx);
  c.ok(frozen.schema === 'indirect-tax-evidence/1', 'independent evidence contract');
  c.ok(sha256(bytes) === pins.get(INDIRECT_EVIDENCE_PATH), 'independent evidence pin');
  c.ok(
    sameSet(keys(frozen.sources), keys(INDIRECT_SOURCE_PATHS)),
    'independent evidence source inventory',
  );
  const actual: Partial<Record<keyof typeof INDIRECT_SOURCE_PATHS, OriginalBytes>> = {},
    missing: string[] = [];
  for (const [name, path] of Object.entries(INDIRECT_SOURCE_PATHS) as [
    keyof typeof INDIRECT_SOURCE_PATHS,
    string,
  ][]) {
    const record = frozen.sources[name];
    c.ok(
      record?.path === path && record.sha256 === pins.get(path),
      'independent evidence source pin: ' + name,
    );
    const absolute = safePath(ctx.root, path);
    if (existsSync(absolute)) {
      const raw = readFileSync(absolute),
        digest = sha256(raw);
      c.ok(digest === record?.sha256, 'raw evidence pin: ' + name);
      actual[name] = { path, sha256: digest, bytes: raw };
    } else missing.push(path);
  }
  if (!missing.length) {
    if (!reader)
      throw new Error(
        'all six originals are present but the independent indirect-tax reader is not bound',
      );
    const decoded = reader(actual as Record<keyof typeof INDIRECT_SOURCE_PATHS, OriginalBytes>);
    c.ok(equal(decoded, frozen), 'independent re-extraction differs from frozen evidence');
    c.fact('independent indirect-tax reader ran on six supplied pinned originals');
    return decoded;
  }
  c.fact('raw evidence unavailable: comparing against the pinned independent extraction');
  c.fact('missing indirect-tax originals: ' + missing.join(', '));
  return frozen;
}

export function indirect(ctx: Context, reader?: IndirectEvidenceReader): Check {
  const c = new Check('INDIRECT'),
    d = ctx.get('indirect-tax-parameters.json');
  let expected: IndirectEvidence;
  try {
    expected = expectedValues(ctx, c, reader);
  } catch (error) {
    c.fail(
      'cannot verify official indirect-tax evidence: ' +
        (error instanceof Error ? error.message : String(error)),
    );
    return c;
  }
  c.ok(
    sameSet(keys(d), ['meta', 'vat', 'fuels', 'cigarettes', 'references']),
    'D26 top-level contract',
  );
  c.ok(
    d.meta.status === 'real' &&
      sameSet(d.meta.source, ['ec-oil', 'excise-law', 'customs-excise-law', 'nsi-pack', 'bill']),
    'D26 provenance',
  );
  const vat = d.vat ?? {};
  for (const field of ['standardPct', 'reducedPct'] as const)
    c.near(vat[field], expected.vat[field], 1e-10, 'VAT source value: ' + field);
  const untaxed = vat.untaxed ?? {};
  c.ok(
    !('zeroPct' in vat) &&
      untaxed.kind === 'definition' &&
      untaxed.label === 'без ДДС / 0 %' &&
      String(untaxed.basis ?? '').startsWith('ЗДДС') &&
      pyTruth(untaxed.note),
    'untaxed bucket is a definition with a legal basis, not an extracted rate',
  );
  c.fact(
    'VAT: standard and reduced rates independently verified; без ДДС / 0 % is a calculation category by definition',
  );
  c.ok(
    vat.unit === expected.vat.unit && vat.standardSince === expected.vat.standardSince,
    'VAT unit and validity',
  );
  c.ok(
    equal(vat.source, ['ec-oil', 'bill']) && pyTruth(vat.reducedQuote),
    'VAT sources and reduced-rate evidence',
  );
  c.ok(sameSet(keys(d.fuels ?? {}), keys(expected.fuels)), 'fuel coverage excludes LPG');
  for (const [name, source] of Object.entries(expected.fuels)) {
    const f = d.fuels?.[name] ?? {};
    c.ok(f.unit === 'EUR/l' && f.originalUnit === 'EUR/1000 l', name + ': units');
    for (const field of [
      'excisePerLitre',
      'originalExcise',
      'pricePerLitre',
      'originalPrice',
    ] as const)
      c.near(f[field], source[field], 1e-10, name + ': independently extracted ' + field);
    c.ok(
      f.priceDate === source.priceDate && f.validFrom === source.validFrom,
      name + ': dates from source',
    );
    c.ok(f.source === 'ec-oil' && f.priceSource === 'ec-oil', name + ': EC sources');
    const legal = f.legalEvidence ?? {};
    c.ok(
      legal.source === 'customs-excise-law' && pyTruth(legal.quote),
      name + ': statutory source',
    );
    c.near(
      legal.originalBgnPer1000,
      source.originalBgnPer1000,
      0,
      name + ': statutory BGN coefficient',
    );
    c.near(legal.conversionRate, source.conversionRate, 0, name + ': fixed conversion rate');
  }
  const schedule = d.cigarettes,
    official = expected.cigarettes;
  c.ok(
    Array.isArray(schedule) && schedule.length === official.length,
    'cigarette schedule must cover every promulgated period',
  );
  if (Array.isArray(schedule))
    official.forEach((source, i) => {
      const row =
        schedule[i] && typeof schedule[i] === 'object' && !Array.isArray(schedule[i])
          ? schedule[i]
          : {};
      c.ok(row.validFrom === source.validFrom, 'cigarette period start and order ' + i);
      c.ok(
        (row.validTo ?? null) === (source.validTo ?? null) &&
          'validTo' in row === 'validTo' in source,
        'cigarette contiguous period end ' + i,
      );
      c.ok(
        row.source === 'excise-law' && row.unit === 'EUR/1000 sticks',
        'cigarette statutory source and units ' + i,
      );
      for (const field of ['specificPer1000', 'adValoremPct', 'minimumPer1000'] as const)
        c.near(row[field], source[field], 1e-10, `cigarette source coefficient ${i}: ${field}`);
    });
  const pack = d.references?.pack ?? {};
  c.ok(
    pack.source === 'nsi-pack' &&
      pack.period === expected.pack.period &&
      pack.originalUnit === 'BGN/pack' &&
      pack.unit === 'EUR/pack',
    'historical pack source, year and units',
  );
  for (const field of ['originalValue', 'priceEur', 'conversionRate'] as const)
    c.near(pack[field], expected.pack[field], 1e-10, 'independent NSI reference: ' + field);
  c.ok(equal(pack.yearHeaders, expected.pack.yearHeaders), 'NSI year column evidence');
  for (const name of ['measure-labels', 'tax-assumptions'])
    c.ok(!ctx.exists(`mock/${name}.json`), 'retired file ' + name);
  const measures: Doc[] = ctx.get('measures.json').items,
    counts = [measures.length, 0, 0];
  for (const it of measures) {
    if (pyTruth(it.since) || pyTruth(it.sinceText)) counts[1]!++;
    if (pyTruth(it.legal)) counts[2]!++;
    for (const f of ['since', 'sinceText', 'legal']) {
      if (!(f in it)) continue;
      const ev = it.excerptEvidence?.[f] ?? {},
        candidates = [
          [it.quote ?? '', it.page],
          [it.context?.quote ?? '', it.context?.page],
        ];
      c.ok(
        ev.source === 'bill' &&
          pyTruth(ev.quote) &&
          candidates.some(([q, p]) => q.includes(ev.quote ?? '') && equal(ev.page, p)),
        `${it.id}: ${f} source evidence`,
      );
      c.ok(it[f] === (f === 'since' ? it.from : ev.quote), `${it.id}: ${f} value`);
    }
  }
  c.ok(
    equal(counts, [52, 16, 14]),
    'M06 reconciliation: ' + JSON.stringify(counts).replaceAll(',', ', '),
  );
  c.fact(
    'M06: 52 ids, 16 date/phrase records, 14 legal records; D26: 2 fuels, 3 cigarette periods',
  );
  return c;
}
export function indirectGroup(reader?: IndirectEvidenceReader): Group<Context> {
  return {
    name: 'INDIRECT',
    description: 'Independent indirect-tax evidence and source-exact measure excerpts',
    run: (ctx) => indirect(ctx, reader),
  };
}
