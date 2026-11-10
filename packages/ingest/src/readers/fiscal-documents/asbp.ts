import { readPdf, spans, assert, type PdfDocument, type PdfPage, type Box } from '../pdf/index.js';
import { pythonRound } from '../../common/format.js';
import type { CleanPage, FiscalEvidence, FiscalVersion } from '../../build/fiscal.js';
import { loadAnnex } from '../../build/annex.js';
import {
  authenticate,
  FISCAL_DOCUMENT_PATHS as paths,
  sha256,
  type FiscalOriginal,
} from './source.js';
import { readFiscalZipMember, readEmfTexts, type EmfText } from './emf.js';

export const ASBP_NUMBER = /^[−-]?\d{1,3}(?: \d{3})*,\d+%?$/u;
const numeric = (s: string) =>
  Number(s.replaceAll('−', '-').replaceAll('%', '').replaceAll(' ', '').replace(',', '.'));
const round1 = (n: number) => pythonRound(n, 1);
interface Fragment {
  text: string;
  x0: number;
  x1: number;
  y: number;
}
export interface AsbpCell {
  column: number;
  header: string;
  printed: string;
  unit?: string;
  value: number;
  bbox: Box;
}
export interface AsbpRow {
  page: number;
  y: number;
  label: string;
  x0: number | null;
  values: (number | null)[];
  cells: AsbpCell[];
  unit?: string;
  /** Physical label fragments before multiline assembly. */
  labelParts: { text: string; x0: number; x1: number; y: number }[];
}
export interface AsbpTable {
  title: string;
  pdf_pages: string;
  docx_page: string;
  unit: string;
  columns: string[];
  rows: AsbpRow[];
  rows_differing_in_docx?: string[];
  note?: string;
}
export interface AsbpCrossCheck {
  pdf_numeric_rows: number;
  docx_numeric_rows: number;
  identical_rows: number;
  differing_rows: FiscalVersion[];
  docx_rows_without_pair: number[][];
  matches: {
    table: string;
    page: number;
    label: string;
    member: string;
    emfY: number;
    records: EmfText[];
    identical: boolean;
  }[];
}
export interface AsbpExtraction {
  source: { file: string; sha256: string; engine: string; method: string; docxSha256: string };
  tables: Record<string, AsbpTable>;
  municipalText: {
    pdf_pages: '128';
    docx_page: '334';
    quote: string | null;
    quote_local: string | null;
    quote_delegated: string | null;
  };
  pages: CleanPage[];
  docx_check: AsbpCrossCheck;
  evidenceNotes: string[];
}

function fragments(page: PdfPage): Fragment[] {
  const result = spans(page).map((s) => ({ text: s.text, x0: s.x0, x1: 2 * s.x - s.x0, y: s.y }));
  // The shared span view omits page-number spans. The legacy raw-table contract
  // retains those physical rows; loadAnnex deliberately filters them itself.
  for (const line of page.blocks.flatMap((b) => b.lines))
    for (const s of line.spans) {
      if (s.text.trim() !== String(page.number)) continue;
      const chars = s.chars.filter((c) => c.text.trim());
      if (chars.length)
        result.push({
          text: s.text.trim(),
          x0: Math.min(...chars.map((c) => c.bbox[0])),
          x1: Math.max(...chars.map((c) => c.bbox[2])),
          y: (s.bbox[1] + s.bbox[3]) / 2,
        });
    }
  return result;
}
function requiredPage(pdf: PdfDocument, n: number) {
  const p = pdf.pages[n - 1];
  assert(p?.number === n, `Missing ASBP page ${n}`);
  return p;
}
function findY(pdf: PdfDocument, n: number, text: string) {
  const hit = fragments(requiredPage(pdf, n)).find((s) => s.text.includes(text));
  assert(hit, `ASBP page ${n}: missing ${text}`);
  return hit.y;
}
function centers(
  pdf: PdfDocument,
  n: number,
  labels: string[],
  lo: number,
  hi: number,
): [string, number][] {
  const sp = fragments(requiredPage(pdf, n)).filter((s) => s.y >= lo && s.y <= hi);
  return labels.map((label) => {
    const hits = sp.filter((s) => s.text === label);
    assert(hits.length === 1, `ASBP page ${n}: ambiguous/missing column ${label}`);
    return [label, (hits[0]!.x0 + hits[0]!.x1) / 2];
  });
}
export function asbpTableRows(
  pdf: PdfDocument,
  pages: [number, [number, number]][],
  columns: [string, number][],
  labelMaxX: number,
): AsbpRow[] {
  const rows: AsbpRow[] = [];
  for (const [n, [lo, hi]] of pages) {
    const sp = fragments(requiredPage(pdf, n))
      .filter((s) => s.y >= lo && s.y <= hi)
      .sort((a, b) => a.y - b.y || a.x0 - b.x0);
    const groups: Fragment[][] = [];
    for (const s of sp) {
      const last = groups.at(-1);
      if (last && Math.abs(last[0]!.y - s.y) <= 2.2) last.push(s);
      else groups.push([s]);
    }
    for (const group of groups) {
      const left = group.filter((s) => s.x1 <= labelMaxX),
        parts = left.filter((s) => !ASBP_NUMBER.test(s.text));
      const values: (number | null)[] = columns.map(() => null),
        cells: AsbpCell[] = [];
      for (const s of group.filter((s) => ASBP_NUMBER.test(s.text) && s.x1 > labelMaxX)) {
        const cx = (s.x0 + s.x1) / 2;
        const column = columns.reduce(
          (best, c, i) => (Math.abs(c[1] - cx) < Math.abs(columns[best]![1] - cx) ? i : best),
          0,
        );
        assert(values[column] === null, `ASBP page ${n}: duplicate numeric column ${column}`);
        values[column] = numeric(s.text);
        // The source PDF glyph extents are retained independently of table policy.
        const physical = requiredPage(pdf, n)
          .blocks.flatMap((b) => b.lines)
          .flatMap((l) => l.spans)
          .flatMap((s) => s.chars)
          .filter(
            (c) =>
              c.bbox[0] >= s.x0 - 0.01 &&
              c.bbox[2] <= s.x1 + 0.01 &&
              Math.abs((c.bbox[1] + c.bbox[3]) / 2 - s.y) < 2.2,
          );
        const y0 = physical.length ? Math.min(...physical.map((c) => c.bbox[1])) : s.y,
          y1 = physical.length ? Math.max(...physical.map((c) => c.bbox[3])) : s.y;
        cells.push({
          column,
          header: columns[column]![0],
          printed: s.text,
          value: values[column]!,
          bbox: [s.x0, y0, s.x1, y1],
        });
      }
      if (parts.length || values.some((v) => v !== null))
        rows.push({
          page: n,
          y: round1(group[0]!.y),
          label: parts.map((s) => s.text).join(' '),
          x0: left.length ? round1(Math.min(...left.map((s) => s.x0))) : null,
          values,
          cells,
          labelParts: left,
        });
    }
  }
  const has = (r: AsbpRow) => r.values.some((v) => v !== null),
    used = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.label || !has(r)) continue;
    const parts: AsbpRow[] = [];
    let j = i - 1,
      y = r.y;
    while (
      j >= 0 &&
      parts.length < 2 &&
      rows[j]!.page === r.page &&
      !has(rows[j]!) &&
      rows[j]!.label &&
      y - rows[j]!.y <= 13 &&
      !used.has(j)
    ) {
      parts.unshift(rows[j]!);
      used.add(j);
      y = rows[j]!.y;
      j--;
    }
    const next = rows[i + 1];
    if (next && next.page === r.page && !has(next) && next.label && next.y - r.y <= 8) {
      parts.push(next);
      used.add(i + 1);
    }
    r.label = parts.map((p) => p.label).join(' ');
    r.labelParts = parts.flatMap((p) => p.labelParts);
    // Preserve the donor's legacy x0 carry-over after multiline grouping.
    // labelParts still records each actual physical fragment independently.
    const owned = [...used].filter((k) => k >= Math.max(0, i - 2) && k < i + 2);
    r.x0 = parts.length ? rows[owned.length ? Math.min(...owned) : i]!.x0 : null;
  }
  return rows.filter((_, i) => !used.has(i));
}

/** Engine-derived lines; remove only numeric raised footnotes and the first
 * physical line equal to this page number. Retain printed whitespace. */
export function cleanAsbpPages(pdf: PdfDocument): CleanPage[] {
  return pdf.pages.map((page) => {
    const lines = page.blocks
      .flatMap((b) => b.lines)
      .map((l) => {
        const baseline = l.spans[0]?.chars[0]?.origin[1] ?? 0;
        return l.spans
          .filter(
            (s) =>
              !(
                (s.chars[0]?.origin[1] ?? baseline) < baseline - s.size * 0.1 &&
                /^\d+$/u.test(s.text.trim())
              ),
          )
          .map((s) => s.text)
          .join('');
      })
      .filter((t) => t.trim());
    const i = lines.findIndex((t) => t.trim() === String(page.number));
    if (i >= 0) lines.splice(i, 1);
    return { page: page.number, body: lines.map((t) => t + '\n').join('') };
  });
}
export function crossCheckAnnex3(
  tables: Record<string, AsbpTable>,
  docx: Uint8Array,
): AsbpCrossCheck {
  const pool: { member: string; y: number; values: number[]; records: EmfText[] }[] = [];
  for (const n of [19, 20, 21, 22]) {
    const member = `word/media/image${n}.emf`,
      texts = readEmfTexts(readFiscalZipMember(docx, member)),
      rows = new Map<number, EmfText[]>();
    for (const t of texts)
      if (ASBP_NUMBER.test(t.text.trim())) {
        const row = rows.get(t.y) ?? [];
        row.push(t);
        rows.set(t.y, row);
      }
    for (const [y, records] of [...rows].sort((a, b) => a[0] - b[0])) {
      records.sort((a, b) => a.x - b.x);
      pool.push({ member, y, records, values: records.map((t) => numeric(t.text.trim())) });
    }
  }
  const pdfRows = ['annex3_mln', 'annex3_pct_gdp'].flatMap((table) =>
    tables[table]!.rows.filter((r) => r.values.some((v) => v !== null)).map((row) => ({
      table,
      row,
      values: row.values.filter((v): v is number => v !== null),
    })),
  );
  const differing: FiscalVersion[] = [],
    matches: AsbpCrossCheck['matches'] = [],
    count = pool.length;
  for (const { table, row, values } of pdfRows) {
    let i = pool.findIndex((p) => JSON.stringify(p.values) === JSON.stringify(values));
    const identical = i >= 0;
    if (!identical)
      i = pool.findIndex(
        (p) =>
          p.values.length === values.length &&
          p.values[0] === values[0] &&
          p.values[1] === values[1],
      );
    assert(i >= 0, `Unpaired ASBP Annex3 DOCX row: ${table}: ${row.label}`);
    const [paired] = pool.splice(i, 1);
    if (!identical) differing.push({ table, label: row.label, pdf: values, docx: paired!.values });
    matches.push({
      table,
      page: row.page,
      label: row.label,
      member: paired!.member,
      emfY: paired!.y,
      records: paired!.records,
      identical,
    });
  }
  tables.annex3_mln!.rows_differing_in_docx = differing
    .filter((d) => d.table === 'annex3_mln')
    .map((d) => d.label);
  return {
    pdf_numeric_rows: pdfRows.length,
    docx_numeric_rows: count,
    identical_rows: pdfRows.length - differing.length,
    differing_rows: differing,
    docx_rows_without_pair: pool.map((p) => p.values),
    matches,
  };
}
export function extractAsbp(source: FiscalOriginal, bill: FiscalOriginal): AsbpExtraction {
  const bytes = authenticate(source, paths.asbp),
    docx = authenticate(bill, paths.bill),
    pdf = readPdf(bytes);
  assert(pdf.pages.length === 201, 'ASBP page count changed');
  const tables: Record<string, AsbpTable> = {},
    years = ['2024', '2025', '2026', '2027', '2028'],
    colnames = ['2024 Отчет', '2025 Предв. отчет', '2026 Проект', '2027 Прогноза', '2028 Прогноза'];
  for (const [key, ns, unit, dp] of [
    ['annex3_mln', [191, 192], 'млн. €', '397–398'],
    ['annex3_pct_gdp', [193, 194], '% от БВП', '399–400'],
  ] as const) {
    const rows = ns
      .flatMap((n) => {
        const hy = findY(pdf, n, 'Показатели'),
          cols = centers(pdf, n, years, hy - 12, hy + 12).map((c, i): [string, number] => [
            colnames[i]!,
            c[1],
          ]);
        return asbpTableRows(pdf, [[n, [hy + 20, 9999]]], cols, 450);
      })
      .filter((r) => r.label);
    tables[key] = {
      title: 'Приложение № 3: Консолидирана фискална програма за периода 2023–2028 г.',
      pdf_pages: `${ns[0]}–${ns[1]}`,
      docx_page: dp + ' (картинки в docx-а; в съдържанието: с. 397)',
      unit,
      columns: colnames,
      rows,
    };
  }
  let p = 142,
    hy = findY(pdf, p, 'Отчет');
  tables.VI_1 = {
    title: 'Табл. VI-1: Държавен дълг – вътрешен и външен и съотношение спрямо БВП',
    pdf_pages: '142',
    docx_page: '348',
    unit: 'row label: млн. евро or %',
    columns: ['2024 Отчет', '2025 Отчет', ...colnames.slice(2)],
    rows: asbpTableRows(
      pdf,
      [[p, [findY(pdf, p, 'Държавен дълг, млн. евро') - 3, findY(pdf, p, 'БВП, млн. евро') + 3]]],
      centers(pdf, p, years, hy - 20, hy + 2).map((c, i) => [colnames[i]!, c[1]]),
      215,
    ),
  };
  for (const [key, n, dp, title] of [
    ['II_3', 31, '235', 'Табл. II-3: КФП – Национален бюджет (2026-2028 г.)'],
    ['II_4', 32, '236', 'Табл. II-4: КФП – Сметки за средства от ЕС (2026-2028 г.)'],
  ] as const) {
    const ys = findY(pdf, n, `Табл. II-${key === 'II_3' ? 3 : 4}`),
      sp = fragments(requiredPage(pdf, n));
    hy = Math.min(...sp.filter((s) => s.y > ys - 2 && years.includes(s.text)).map((s) => s.y));
    const ye = Math.max(
      ...sp.filter((s) => s.text.startsWith('ФИНАНСИРАНЕ (+/-)') && s.y > ys).map((s) => s.y),
    );
    assert(Number.isFinite(hy) && Number.isFinite(ye), 'ASBP II table boundaries');
    tables[key] = {
      title,
      pdf_pages: String(n),
      docx_page: dp,
      unit: 'млн. €',
      columns: colnames,
      rows: asbpTableRows(
        pdf,
        [[n, [hy + 8, ye + 12]]],
        centers(pdf, n, years, hy - 2, hy + 2).map((c, i) => [colnames[i]!, c[1]]),
        305,
      ),
    };
  }
  p = 128;
  const yh = findY(pdf, p, 'местни'),
    sp = fragments(requiredPage(pdf, p));
  const cx = (t: string) => {
    const c = sp
      .filter((s) => s.text === t)
      .sort((a, b) => Math.abs(a.y - yh) - Math.abs(b.y - yh))[0];
    assert(c, `ASBP IV column ${t}`);
    return (c.x0 + c.x1) / 2;
  };
  const cols4: [string, number][] = [
    ['2026 Проект', cx('2026')],
    ['2026 от тях местни', cx('местни')],
    ['2026 от тях делегирани', cx('делегирани')],
    ['2027 Прогноза', cx('2027')],
    ['2028 Прогноза', cx('2028')],
  ];
  tables.IV_1 = {
    title:
      'Табл. IV-1: Основни бюджетни взаимоотношения на общините с централния бюджет за периода 2026-2028 г.',
    pdf_pages: '128',
    docx_page: '334',
    unit: 'хил. €',
    columns: cols4.map((c) => c[0]),
    rows: asbpTableRows(
      pdf,
      [
        [
          p,
          [findY(pdf, p, 'Общо:') - 3, findY(pdf, p, 'Целева субсидия за капиталови разходи') + 3],
        ],
      ],
      cols4,
      cols4[0]![1] - 35,
    ),
  };
  for (const [key, n, dp] of [
    ['annex6', 197, '403'],
    ['annex9', 200, '406'],
  ] as const) {
    const ys = findY(pdf, n, `ПРИЛОЖЕНИЕ № ${key === 'annex6' ? 6 : 9}`),
      sp = fragments(requiredPage(pdf, n)).filter((s) => s.y > ys);
    hy = Math.min(...sp.filter((s) => s.text === '2026 г.').map((s) => s.y));
    const cols = centers(pdf, n, ['2026 г.', '2027 г.', '2028 г.'], hy - 2.99, hy + 2.99);
    tables[key] = {
      title:
        key === 'annex6'
          ? 'Приложение № 6: Размери на бюджетните взаимоотношения (трансферите) на държавния бюджет с бюджетите на БНТ, БНР, БТА, БАН, държавните висши училища и държавните висши военни училища за периода 2026-2028 г.'
          : 'Приложение № 9: Размери на основните бюджетни взаимоотношения между централния бюджет и бюджетите на общините за периода 2026-2028 г.',
      pdf_pages: String(n),
      docx_page: dp,
      unit: 'хил. €',
      columns: cols.map((c) => c[0]),
      rows: asbpTableRows(pdf, [[n, [hy + 6, 9999]]], cols, cols[0]![1] - 40),
    };
  }
  const text = requiredPage(pdf, 128).text.replace(/\s+/gu, ' ');
  const municipalText: AsbpExtraction['municipalText'] = {
    pdf_pages: '128',
    docx_page: '334',
    quote:
      /Предвидени са разходи за общините за 2026 г\. в размер на ([\d ,]+) млн\. евро.*?– 12,4%\./u.exec(
        text,
      )?.[0] ?? null,
    quote_local:
      /Разходите за местни дейности през 2026 г\. са в размер на [\d ,]+ млн\. евро и представляват [\d,]+% от общите разходи на общините\./u.exec(
        text,
      )?.[0] ?? null,
    quote_delegated:
      /Предвидените за 2026 г\. разходи за делегираните от държавата дейности са в размер на [\d ,]+ млн\. евро/u.exec(
        text,
      )?.[0] ?? null,
  };
  tables.VI_1!.note =
    'Забележка под таблицата: „Поради закръгления някои от сумарните позиции е възможно да не се изчерпват от съставните им числа. Източник: МФ“';
  for (const [key, table] of Object.entries(tables))
    for (const row of table.rows) {
      row.unit =
        key === 'VI_1'
          ? row.label.includes('%')
            ? '% от БВП'
            : 'млн. €'
          : row.label === '% от БВП'
            ? '% от БВП'
            : table.unit;
      for (const cell of row.cells) {
        cell.unit = row.unit;
        cell.header = table.columns[cell.column]!;
      }
    }
  loadAnnex({ annex3_mln: tables.annex3_mln!, annex3_pct_gdp: tables.annex3_pct_gdp! });
  const check = crossCheckAnnex3(tables, docx);
  return {
    source: {
      file: 'UMTBF-2026-2028-motivi.pdf',
      sha256: pdf.sha256,
      engine: pdf.engine,
      method: pdf.method,
      docxSha256: sha256(docx),
    },
    tables,
    municipalText,
    pages: cleanAsbpPages(pdf),
    docx_check: check,
    evidenceNotes: [
      'II-3/II-4 printed 2024 GDP shares use an older smaller GDP vintage. Annex3 GDP and printed shares are retained separately; no tolerance is relaxed.',
      'III-1 2025 Програма is distinct from Annex3 2025 preliminary actual; original amounts and shares are retained.',
      'Retained July component summary has no supplied raw source; it is not synthesized by this reader.',
      'Coordinates/font metrics are MuPDF 1.26.4 evidence, not PyMuPDF 1.26.5 rawdict coordinates.',
    ],
  };
}
/** This is precisely the ASBP-owned portion of FiscalGraphInput.fiscal. */
export function asbpFiscalEvidence(extraction: AsbpExtraction): FiscalEvidence {
  return {
    annex: loadAnnex({
      annex3_mln: extraction.tables.annex3_mln!,
      annex3_pct_gdp: extraction.tables.annex3_pct_gdp!,
    }),
    tables: extraction.tables,
    pages: extraction.pages,
    differingRows: extraction.docx_check.differing_rows,
  };
}
