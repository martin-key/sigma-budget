import { readPdf, pdfTables, words, ws, assert, midX, type PdfDocument } from '../pdf/index.js';
import { pythonRound } from '../../common/format.js';
import { dbpSpecifications, dbpEditorial, dbpCalculations } from './dbp-specifications.js';
import type { PlanInput, PlanFigure, PlanDerived } from '../../build/dbp-gva.js';
import { createHash } from 'node:crypto';

export const DBP_SHA256 = '8c91cdf4778f2864e1eeb167f14b08d1f68a076ea4ad27a8a4305175a73f1182';
export const DBP_PATH =
  'data/originals/budget_2027/Draft_Budgetary_Plan_of_the_Republic_of_Bulgaria_for_2027.pdf';
export interface ReportedPlanFigure extends PlanFigure {
  label_bg: string;
  unit: string;
  year: number;
  currency: string | null;
  quote: string;
  kind: 'reported';
  note?: string;
}
export interface DerivedPlanFigure extends PlanDerived {
  label_bg: string;
  basis: 'DERIVED';
  kind: 'derived';
  note?: string;
}
export interface DbpExtraction extends PlanInput {
  meta: typeof dbpEditorial.meta;
  document: typeof dbpEditorial.document;
  figures: ReportedPlanFigure[];
  derived: DerivedPlanFigure[];
  checks: { check: string; ok: boolean; detail: string }[];
  basis_differences_vs_mock: Record<string, unknown>;
  caveats: string[];
  not_in_document: string[];
}
const numberCell = (s: string) => /^-?\d{1,3}(?: \d{3})+(?:,\d+)?$|^-?\d+(?:,\d+)?$/u.test(s);
const parse = (s: string) =>
  Number(
    s
      .replace(/[\s\u00a0]/gu, '')
      .replaceAll('−', '-')
      .replace(',', '.'),
  );
const numbers = (s: string) =>
  [
    ...ws(s)
      .replaceAll('−', '-')
      .matchAll(/-?\d{1,3}(?: \d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/gu),
  ].map((m) => parse(m[0]));
const fixed = (v: number, n: number) => pythonRound(v, n).toFixed(n);
const pystr = (v: any): string =>
  typeof v === 'number' && Number.isInteger(v) ? v.toFixed(1) : String(v);

/** The fixed October publication is deliberately hash scoped. Later publication
 * years/vintages need their own declarations, not reinterpretation of this PDF. */
export function extractDbpDocument(doc: PdfDocument, outlook?: unknown): DbpExtraction {
  assert(doc.sha256 === DBP_SHA256, 'DBP October PDF SHA-256 differs');
  assert(doc.pages.length === 55, 'DBP October page count differs');
  const figures: ReportedPlanFigure[] = [],
    derived: DerivedPlanFigure[] = [],
    checks: DbpExtraction['checks'] = [];
  const texts = doc.pages.map((p) => ws(p.text));
  const add = (
    id: string,
    label: string,
    value: number,
    u: string,
    year: number,
    basis: string,
    page: number,
    quote: string,
    options: any = {},
  ) => {
    assert(Object.hasOwn(dbpEditorial.meta.legend_basis, basis), 'Unknown DBP accounting basis');
    assert(!figures.some((f) => f.id === id), 'Duplicate DBP figure: ' + id);
    figures.push({
      id,
      label_bg: label,
      value,
      unit: u,
      year,
      basis,
      currency: u.includes('EUR') || u.includes('евро') ? 'EUR' : null,
      page,
      quote,
      kind: 'reported',
      ...(options.table ? { table: options.table } : {}),
      ...(options.note ? { note: options.note } : {}),
    });
  };
  for (const spec of dbpSpecifications as readonly {
    kind: string;
    args: readonly any[];
    options: any;
  }[]) {
    if (spec.kind === 'quote') {
      const [id, label, value, u, year, basis, pn, quote] = spec.args,
        qn = ws(quote);
      assert(texts[pn - 1]?.includes(qn), `DBP quote absent: ${id}, page ${pn}`);
      if (spec.options.check_value !== false && value !== null)
        assert(
          numbers(qn).some((v) => Math.abs(v) === Math.abs(value)),
          `DBP value absent in quote: ${id}`,
        );
      if (id === 'd.SAFE_ADVANCE')
        assert(numbers(qn).includes(value * 1_000_000), 'SAFE EUR/million EUR conversion');
      add(id, label, value, u, year, basis, pn, qn, spec.options);
    } else {
      const [prefix, label, pn, rowid, columns, _unit, basis, table] = spec.args;
      const page = doc.pages[pn - 1];
      assert(page, 'Missing DBP page');
      const candidates = pdfTables(page)
        .flatMap((t) => t.rawCells.map((r) => r.map(ws).filter(Boolean)))
        .filter((r) => r[0] === rowid);
      assert(candidates.length === 1, `DBP row not unique: ${prefix}, ${pn}/${rowid}`);
      const row = candidates[0]!,
        values = row.slice(1).filter(numberCell);
      assert(
        values.length === columns.length,
        `DBP wrong column count: ${prefix}, ${values.length}/${columns.length}`,
      );
      for (let i = 0; i < columns.length; i++) {
        const [year, suffix, u] = columns[i];
        add(
          `${prefix}.${suffix}.${year}`,
          label,
          parse(values[i]!),
          u,
          year,
          basis,
          pn,
          row.join(' | '),
          { ...spec.options, table: `${table}, ред ${rowid}` },
        );
      }
    }
  }
  const page = doc.pages[35]!,
    ww = words(page),
    years = new Map<string, number>();
  for (const w of ww)
    if (/^20(2[0-6])$/u.test(w.text) && w.bbox[1] < 200) years.set(w.text, midX(w.bbox));
  assert(years.size === 7, 'DBP Table 7 year columns');
  const bands = new Map<number, typeof ww>();
  for (const w of ww)
    if (/^-?\d,\d$/u.test(w.text) && w.bbox[1] < 400) {
      const k = pythonRound(w.bbox[1] / 4);
      const a = bands.get(k) ?? [];
      a.push(w);
      bands.set(k, a);
    }
  const t7: Record<string, Record<string, string>> = {};
  for (const [i, y] of [...bands.keys()]
    .sort((a, b) => a - b)
    .slice(0, 2)
    .entries()) {
    const lab = ['rev_accrual', 'cash_received'][i]!,
      vals: Record<string, string> = {};
    for (const w of bands.get(y)!) {
      const yr = [...years].reduce((a, b) =>
        Math.abs(b[1] - midX(w.bbox)) < Math.abs(a[1] - midX(w.bbox)) ? b : a,
      )[0];
      assert(!Object.hasOwn(vals, yr), 'DBP Table 7 duplicate column');
      vals[yr] = w.text;
    }
    t7[lab] = vals;
    for (const [yr, v] of Object.entries(vals))
      add(
        `rrf.T7.${lab}.${yr}`,
        lab === 'rev_accrual'
          ? 'МВУ грантове в прогнозите за приходите (начислени)'
          : 'Касови плащания от МВУ грантове от ЕС',
        parse(v),
        '% от БВП',
        Number(yr),
        'ESA_GG',
        36,
        `Табл. 7, стойност ${v} в колона ${yr}`,
        {
          note: 'Колоната е определена по x-координата на думата в PDF; в таблицата част от клетките са празни',
        },
      );
  }
  assert(Object.keys(t7).length === 2, 'DBP Table 7 missing rows');
  const V = Object.fromEntries(figures.map((f) => [f.id, f.value])) as Record<string, number>;
  const calc = dbpCalculations(
    V,
    t7,
    (id, label, value, u, year, formula, note) =>
      derived.push({
        id,
        label_bg: label,
        value: pythonRound(value, 3),
        unit: u,
        year,
        basis: 'DERIVED',
        kind: 'derived',
        formula,
        ...(note ? { note } : {}),
      }),
    (check, ok, detail) => {
      checks.push({ check, ok, detail });
      assert(ok, 'DBP consistency: ' + check);
    },
    fixed,
    pystr,
  );
  const mock: Record<string, unknown> = {};
  if (outlook !== undefined) {
    const ol = outlook as any;
    for (const y of [2025, 2026, 2027]) {
      const i = ol.years?.indexOf(y);
      assert(i >= 0, 'Outlook comparison year missing');
      mock[String(y)] = {
        kfp_revenue_mln: ol.kfp.revenue.mln[i],
        kfp_expenditure_mln: ol.kfp.expenditure.mln[i],
        kfp_balance_mln: ol.kfp.balance.mln[i],
        kfp_balance_pct_gdp: ol.kfp.balance.pctGdp[i],
        gdp_mln_used_by_mock: ol.gdp.mln[i],
      };
    }
    mock._source = 'data/release/outlook.json (КФП, касова основа; АСБП 2026–2028, Приложение 3)';
  } else mock._error = 'outlook.json не е прочетен: comparison input not supplied';
  const template = structuredClone(dbpEditorial);
  return {
    ...template,
    document: { ...template.document, sha256: doc.sha256 },
    figures,
    derived,
    checks,
    basis_differences_vs_mock: {
      ...template.basis_differences_vs_mock,
      mock_vs_dbp: mock,
      denominator: `Знаменателят (БВП) е различен: mock-ът ползва 125 247 млн. EUR за 2026 (АСБП 2026–2028); новият документ предполага ≈${fixed(calc.gdp26, 1)} млрд. за 2026 и ≈${fixed(calc.gdp27, 1)} млрд. за 2027 (изведено). Затова „% от БВП“ не може да се смесва.`,
    },
  };
}
export function extractDbp(bytes: Uint8Array, outlook?: unknown) {
  assert(
    createHash('sha256').update(bytes).digest('hex') === DBP_SHA256,
    'DBP October PDF SHA-256 differs',
  );
  return extractDbpDocument(readPdf(bytes), outlook);
}
