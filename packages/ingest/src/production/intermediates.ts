/** Finite physical-source generators. No captured outputs or fixture defaults. */
import type { GazetteBlock } from '../build/law-types.js';
import { pythonRound } from '../common/format.js';
export const PRODUCTION_GENERATED_INPUTS = [
  'data/originals/asbp/asbp_tables.json',
  'data/originals/dv/dv_laws_2026.json',
  'data/originals/program_budgets/*',
  'data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
  'data/cache/research/dbp-2027/dbp2027_figures.json',
  'data/cache/law_bill.json',
  'data/inputs/program_budgets_2026.json',
  'data/inputs/kfp_functions_2026.json',
  'data/inputs/budget_forecast_2027.json',
  'data/inputs/budget_bill_2027.json',
  'data/inputs/indirect_tax_evidence.json',
] as const;
const numeric = (s: string) => /^-?\d{1,3}(?: \d{3})*(?:,\d+)?$/.test(s);
const number = (s: string) => Number(s.replaceAll(' ', '').replace(',', '.'));
const ordinal = (s: string) => /^[IVXІ]+\.$|^\d+(\.\d+)*\.?$/.test(s);
const latin = Object.fromEntries(
  [...'ABCEHKMOPTXaceopxy'].map((s, i) => [s, [...'АВСЕНКМОРТХасеорху'][i]]),
);
const fold = (s: string) => [...s].map((c) => latin[c] ?? c).join('');
/** Port of extract/dv_laws.py's selection over the existing ordered HTML reader. */
export function physicalLawSummary(
  blocks: Record<'zdb' | 'zbdoo' | 'zbnzok', GazetteBlock[]>,
): any {
  const docs = {
    zdb: [
      'zdb2026_dv69_idMat245041.html',
      'Закон за държавния бюджет на Република България за 2026 г.',
      'ДВ, бр. 69 от 31.07.2026 г.',
      '245041',
    ],
    zbdoo: [
      'zbdoo2026_dv68_idMat244982.html',
      'Закон за бюджета на държавното обществено осигуряване за 2026 г.',
      'ДВ, бр. 68 от 28.07.2026 г.',
      '244982',
    ],
    zbnzok: [
      'zbnzok2026_dv68_idMat244981.html',
      'Закон за бюджета на Националната здравноосигурителна каса за 2026 г.',
      'ДВ, бр. 68 от 28.07.2026 г.',
      '244981',
    ],
  };
  const result: any = {},
    items: Record<string, any[]> = {};
  for (const key of ['zdb', 'zbdoo', 'zbnzok'] as const) {
    const [name, title, dv, id] = docs[key];
    result[key] = {
      title,
      dv,
      url: 'https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=' + id,
      file: 'data/raw/dv/' + name,
      unit_tables: 'хил. €',
    };
    let art: string | null = null,
      para: string | null = null;
    items[key] = blocks[key].map(([kind, value]) => {
      if (kind === 'p') {
        const text = value as string,
          m = /^Чл\. (\d+[а-я]?)\./u.exec(text);
        if (m) {
          art = m[1]!;
          para = null;
        }
        const p = /^(?:Чл\. \d+[а-я]?\. )?\((\d+)\)/u.exec(text);
        if (p) para = p[1]!;
        if (text.startsWith('Приложение №')) {
          art = text;
          para = null;
        }
        return { kind, art, para, text };
      }
      return { kind: 'table', art, para, rows: value };
    });
    const tables = items[key]!.filter((i) => i.kind === 'table' && i.art === '1');
    result[key].art1 = Object.fromEntries(
      tables.map((t) => [
        'para' + t.para,
        t.rows.flatMap((r: string[]) => {
          const vals = r.filter(numeric),
            label = r.find((c) => c && !numeric(c) && !ordinal(c));
          return vals.length && label
            ? [{ no: r.find(ordinal) ?? '', label, value: number(vals.at(-1)!) }]
            : [];
        }),
      ]),
    );
    result[key].art1_quote =
      items[key]!.find((i) => i.kind === 'p' && i.art === '1' && i.text.startsWith('Чл. 1.'))
        ?.text ?? null;
  }
  const quote = (key: string, art: string) =>
    items[key]!.find(
      (i) => i.kind === 'p' && i.art === art && i.text.startsWith('Чл. ' + art + '.'),
    )?.text ?? null;
  const article = (key: string, art: string) =>
    items[key]!.filter((i) => i.kind === 'p' && i.art === art)
      .map((i) => i.text)
      .join(' ');
  const columns = {
    total: '1. Основни бюджетни взаимоотношения (к. 2 = 3+4+5+6)',
    delegated: 'Обща субсидия за делегираните от държавата дейности (к. 3)',
    equalizing: 'Обща изравнителна субсидия (к. 4)',
    winter_roads: 'За зимно поддържане и снегопочистване на общински пътища (к. 5)',
    capital: 'Целева субсидия за капиталови разходи (к. 6)',
    other_targeted: '2. Трансфери за други целеви разходи за местни дейности (к. 7)',
  };
  let region: string | null = null;
  const all: any[] = [];
  for (const t of items.zdb!.filter((i) => i.kind === 'table' && i.art === '51'))
    for (const r of t.rows as string[][]) {
      if (
        r.length === 1 ||
        (r[0] && r[0].toUpperCase().startsWith('ОБЛАСТ') && !r.slice(1).some(numeric))
      ) {
        if (r[0]?.toUpperCase().startsWith('ОБЛАСТ')) region = r[0].trim();
        continue;
      }
      if (r.length !== 7 || !r[0] || numeric(r[0]) || !r.slice(1).some(numeric)) continue;
      let name = fold(r[0]),
        reg = region;
      if (name === name.toUpperCase() && name.includes('ОБЩИНА') && !name.startsWith('ВСИЧКО')) {
        name = name[0]! + name.slice(1).toLowerCase();
        reg = null;
      }
      all.push({
        region: reg,
        name,
        name_in_dv: r[0],
        ...Object.fromEntries(
          Object.keys(columns).map((k, i) => [k, numeric(r[i + 1]!) ? number(r[i + 1]!) : null]),
        ),
      });
    }
  const total = (r: any) => /^(ОБЩО|ВСИЧКО)/.test(r.name.toUpperCase()),
    municipalities = all.filter((r) => !total(r));
  result.zdb.art51 = {
    quote: quote('zdb', '51'),
    columns,
    count: municipalities.length,
    sums: Object.fromEntries(
      Object.keys(columns).map((k) => [
        k,
        pythonRound(
          municipalities.reduce((sum, r) => sum + (r[k] ?? 0), 0),
          1,
        ),
      ]),
    ),
    total_rows_in_law: all.filter(total),
    'rows_failing_3+4+5+6=2': municipalities
      .filter(
        (r) =>
          Math.abs(
            (r.delegated ?? 0) +
              (r.equalizing ?? 0) +
              (r.winter_roads ?? 0) +
              (r.capital ?? 0) -
              (r.total ?? 0),
          ) > 0.15,
      )
      .map((r) => r.name),
    municipalities,
  };
  for (const art of ['9', '14', '15']) result.zbdoo['art' + art] = article('zbdoo', art);
  const rates = items
    .zbdoo!.filter((i) => i.kind === 'table' && i.art?.startsWith('Приложение № 2А'))
    .flatMap((t) =>
      (t.rows as string[][])
        .filter((r) => r.length >= 3 && /^\d{2}$/.test(r[0]!) && /^\d+[.,]\d+$/.test(r.at(-1)!))
        .map((r) => ({
          kid2025: r[0],
          activity: r[1],
          rate_pct: Number(r.at(-1)!.replace(',', '.')),
        })),
    );
  result.zbdoo.annex2A_tzpb = {
    title:
      'Приложение № 2А към чл. 14, т. 2 — диференцирани осигурителни вноски за фонд „Трудова злополука и професионална болест“ от 1 август до 31 декември 2026 г.',
    count: rates.length,
    min_pct: rates.length ? Math.min(...rates.map((r) => r.rate_pct)) : null,
    max_pct: rates.length ? Math.max(...rates.map((r) => r.rate_pct)) : null,
    rows: rates,
  };
  result.zbnzok.art2 = article('zbnzok', '2');
  return result;
}
