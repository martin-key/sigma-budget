import { COLS, SRC_YEARS, type ProgrammeEvidence } from '../../build/programmes.js';
import { artEbk } from '../../build/law-definitions.js';
import {
  readPdf,
  pdfTables,
  words,
  textInBox,
  ws,
  union,
  midX,
  midY,
  type PdfDocument,
  type PdfPage,
  type Box,
} from '../pdf/index.js';
import type { PdfTable } from '../pdf/tables.js';
import { programmeTokens, programmeNames, readProgrammeRows } from './programme-tokens.js';
import { programmeCells, resolveProgrammeStructure, consistent } from './programme-cells.js';
import { pythonRound } from '../../common/format.js';
import { pythonFloatSum } from '../../common/numbers.js';
import type { LawBillCache } from './legal.js';
const NUMBER = /^-?\d{1,3}(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$|^-$/u;
const CODE = /^(\d{4})\.\s*(\d{2})\.\s*(\d{2})\*?$/u;
const YEAR = /(Отчет|Закон|Проект|Прогноза)\s*(?:за\s*)?(20\d\d)/u;
const num = (s: string) =>
  s === '-' || s === '' ? 0 : Number(s.replace(/[ \u00a0\u202f]/gu, '').replace(',', '.'));
type Header = { indices: number[]; row: number; ranges: [number, number][] | null };
function header(t: PdfTable): Header | null {
  for (let i = 0; i < Math.min(t.rawCells.length, 12); i++) {
    const r = t.rawCells[i]!.map(ws),
      indices = r.flatMap((c, j) => (/^(Общо|По бюджет|По други)/u.test(c) ? [j] : []));
    if (indices.length === 9 && indices.filter((j) => r[j]!.startsWith('Общо')).length === 3) {
      const boxes = indices.map((j) => t.rows[i]![j]);
      return {
        indices,
        row: i,
        ranges: boxes.every(Boolean) ? boxes.map((c) => [c![0], c![2]]) : null,
      };
    }
  }
  return null;
}
function positional(
  page: PdfPage,
  t: PdfTable,
  i: number,
  ranges: [number, number][],
): number[] | null {
  const rb = union(t.rows[i]!.filter((b): b is Box => b !== null));
  const ww = words(page)
    .filter(
      (w) =>
        midX(w.bbox) >= rb[0] &&
        midX(w.bbox) < rb[2] &&
        midY(w.bbox) >= rb[1] &&
        midY(w.bbox) < rb[3] &&
        /^-?[\d.,]+$/u.test(w.text),
    )
    .sort((a, b) => pythonRound(a.bbox[1]) - pythonRound(b.bbox[1]) || a.bbox[0] - b.bbox[0]);
  const nums: { box: Box; text: string }[] = [];
  for (const w of ww) {
    const prev = nums.at(-1);
    if (
      prev &&
      Math.abs(w.bbox[1] - prev.box[1]) < 3 &&
      w.bbox[0] - prev.box[2] >= 0 &&
      w.bbox[0] - prev.box[2] < 4.5 &&
      /^\d{3}([.,]\d+)?$/u.test(w.text) &&
      !/[.,]\d+$/u.test(prev.text)
    ) {
      prev.text += ' ' + w.text;
      prev.box = union([prev.box, w.bbox]);
    } else nums.push({ box: w.bbox, text: w.text });
  }
  const vals = Array<number>(9).fill(0),
    seen = new Set<number>();
  for (const w of nums) {
    if (!NUMBER.test(w.text)) continue;
    const cx = midX(w.box),
      k = ranges.findIndex(([a, b]) => cx >= a - 1 && cx <= b + 1);
    if (k < 0 || seen.has(k)) return null;
    seen.add(k);
    vals[k] = num(w.text);
  }
  return seen.size ? vals : null;
}
interface ExtractedItem {
  code: string;
  name: string;
  values: number[];
  ok: boolean;
}
export function extractProgrammeTables(doc: PdfDocument) {
  const tables: { page: number; label: string | null; items: ExtractedItem[] }[] = [];
  let last: { label: string; page: number; hm: Header | null } | undefined;
  for (const page of doc.pages) {
    if (!/\d{4}\.\s*\d{2}\.\s*\d{2}/u.test(page.text) || !/хил\.?\s*евро/u.test(page.text))
      continue;
    let bottom = 0;
    for (const t of pdfTables(page)) {
      const rows = t.rawCells.map((r) => r.map(ws));
      if (!rows.some((r) => r.slice(0, 4).some((c) => CODE.test(c)))) {
        bottom = t.bbox[3];
        continue;
      }
      const head = rows
          .slice(0, 10)
          .map((r) => r.join(' '))
          .join(' '),
        above = textInBox(page, [0, Math.max(bottom, t.bbox[1] - 140), page.width, t.bbox[1]]);
      const m = YEAR.exec(head) ?? [...above.matchAll(new RegExp(YEAR.source, 'gu'))].at(-1),
        carry = last && (last.page === page.number - 1 || last.page === page.number),
        label = m ? m[1] + ' ' + m[2] : carry ? last!.label : null;
      const hm = header(t) ?? (carry ? last!.hm : null),
        items: ExtractedItem[] = [];
      let current: ExtractedItem | undefined;
      for (const [i, r] of rows.entries()) {
        const code = r
            .slice(0, 4)
            .map((c) => CODE.exec(c))
            .find(Boolean),
          text = r.filter((c) => c && !NUMBER.test(c) && !CODE.test(c)).join(' ');
        if (code || /^общо разходи/iu.test(text)) {
          const candidates: number[][] = [];
          if (hm && Math.max(...hm.indices) < r.length) {
            const cells = hm.indices.map((j) => r[j]!);
            if (cells.every((c) => NUMBER.test(c) || c === '') && cells.some(Boolean))
              candidates.push(cells.map(num));
          }
          const nums = r.filter((c) => NUMBER.test(c)).map(num);
          if (nums.length === 9) candidates.push(nums);
          if (hm?.ranges) {
            const v = positional(page, t, i, hm.ranges);
            if (v) candidates.push(v);
          }
          const value = candidates.find((v) => consistent(v, 0.25));
          current = {
            code: code ? code.slice(1).join('.') : 'total',
            name: text,
            values: value ?? candidates[0] ?? nums,
            ok: !!value,
          };
          items.push(current);
        } else if (
          current &&
          text &&
          !r.some((c) => NUMBER.test(c)) &&
          !YEAR.test(text) &&
          !text.includes('хил')
        )
          current.name = (current.name + ' ' + text).trim();
      }
      tables.push({ page: page.number, label, items });
      if (label) last = { label, page: page.number, hm };
      bottom = t.bbox[3];
    }
  }
  return tables;
}
export function extractProgrammePdf(bytes: Uint8Array) {
  const doc = readPdf(bytes),
    read = readProgrammeRows(doc.pages),
    { cells, conflicts } = programmeCells(read.rows);
  resolveProgrammeStructure(cells);
  return {
    sha256: doc.sha256,
    tables: extractProgrammeTables(doc),
    pdf: {
      cells: [...cells.values()].map(({ key, cell }) => [key, cell] as const),
      conflicts,
      programNames: programmeNames(doc.pages),
      rowLabels: programmeNames(doc.pages, true),
    },
    rows: read.rows,
    pages: read.pages,
  };
}
export type ProgrammePdf = ReturnType<typeof extractProgrammePdf>;
export interface ProgrammePdfInput {
  file: string;
  bytes: Uint8Array;
}
export interface ProgrammeZdb {
  art: number;
  name: string;
  exp: number | null;
  items: { n: string; k: number }[];
}
export function extractProgrammes(
  inputs: ProgrammePdfInput[],
  law: LawBillCache,
  zdb?: ProgrammeZdb[],
) {
  const budgets: Record<string, any> = {},
    not_parsed: Record<string, string> = {},
    pdfs: Record<string, ProgrammePdf['pdf']> = {},
    receipts: { file: string; sha256: string }[] = [];
  const arts = Object.fromEntries(
    Object.entries(artEbk).map(([a, c]) => [c.slice(0, 4), Number(a)]),
  );
  // Printed PRB identifiers differ from EBK identifiers for the three constitutional bodies.
  Object.assign(arts, { '0100': 3, '0200': 5, '0300': 6, '0400': 7, '0500': 4, '0600': 2 });
  const codes = inputs.map((i) => i.file.slice(0, 4));
  if (
    inputs.length !== 46 ||
    new Set(codes).size !== 46 ||
    codes.some((c) => !Object.hasOwn(arts, c))
  )
    throw new Error('Incomplete/duplicate programme PDF inventory');
  if (zdb && (!Array.isArray(zdb) || new Set(zdb.map((l) => l.art)).size !== zdb.length))
    throw new Error('Invalid programme ZDB intermediate');
  const lawInput = new Map(
    (
      zdb ??
      Object.entries(law.law)
        .filter(([a]) => Number(a) >= 2 && a !== '28')
        .map(([a, l]) => ({
          art: Number(a),
          name: l.name!,
          exp: l.headline.exp ?? null,
          items:
            l.policiesKind === 'policies'
              ? l.policies
                  .flatMap((p) => [p, ...(p.parts ?? [])])
                  .map((p) => ({ n: p.n, k: p.khil! }))
              : [],
        }))
    ).map((l) => [l.art, l]),
  );
  if (zdb)
    for (const l of zdb) {
      const actual = law.law[String(l.art)];
      if (!actual || l.exp !== actual.headline.exp)
        throw new Error('Programme ZDB/law disagreement: ' + l.art);
    }
  for (const { file, bytes } of inputs
    .slice()
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    const prb = file.slice(0, 4);
    if (Object.hasOwn(pdfs, file)) throw new Error('Duplicate programme PDF ' + file);
    const extracted = extractProgrammePdf(bytes);
    receipts.push({ file, sha256: extracted.sha256 });
    pdfs[file] = extracted.pdf;
    const programs: Record<
        string,
        { name: string; by_year: Record<string, Record<string, number>> }
      > = {},
      problems: string[] = [],
      pages: Record<string, number[]> = {};
    for (const t of extracted.tables) {
      if (t.label && SRC_YEARS.includes(t.label) && t.items.length) {
        const p = (pages[t.label] ??= []);
        if (!p.includes(t.page)) p.push(t.page);
      }
      if (!t.label || !SRC_YEARS.includes(t.label)) {
        if (t.items.length)
          problems.push(`с. ${t.page}: таблица без разпозната година (${t.label ?? 'None'})`);
        continue;
      }
      for (const it of t.items) {
        if (!it.ok) {
          const printed =
            '[' +
            it.values.map((v) => (Number.isInteger(v) ? v.toFixed(1) : String(v))).join(', ') +
            ']';
          problems.push(
            `с. ${t.page} ${t.label} ${it.code}: числата не дават сборовете на таблицата (${printed})`,
          );
          continue;
        }
        const p = (programs[it.code] ??= { name: it.name, by_year: {} });
        if (it.name.length > p.name.length) p.name = it.name;
        p.by_year[t.label] = Object.fromEntries(COLS.map((c, i) => [c, it.values[i]!]));
      }
    }
    if (!Object.keys(programs).length) {
      not_parsed[file] =
        problems.slice(0, 5).join('; ') ||
        'няма таблици с код на програма в текстовия слой (сканиран документ или друг формат)';
      continue;
    }
    const art = arts[prb],
      l = art ? lawInput.get(art) : undefined,
      check: any = {};
    if (l) {
      const tot = Object.entries(programs).find(([c]) =>
        ['total', prb + '.00.00'].includes(c),
      )?.[1];
      if (tot?.by_year['Проект 2026']) {
        check.total_prb_2026 = tot.by_year['Проект 2026'].cons_prb;
        check.zdb_exp = l.exp;
        check.total_matches_law = Math.abs(check.total_prb_2026 - check.zdb_exp) < 0.15;
      }
      const pol = Object.entries(programs)
          .filter(([c]) => c.endsWith('.00') && !['total', prb + '.00.00'].includes(c))
          .map(([, p]) => p),
        items = l.items.filter((i) => !i.n.includes('.')),
        got = pol.map((p) => pythonRound(p.by_year['Проект 2026']?.cons_prb ?? -1, 1));
      check.policies_in_law = items.length;
      check.policy_amounts_found_in_law = items.filter((i) =>
        got.includes(pythonRound(i.k, 1)),
      ).length;
    }
    const v = (c: string) => programs[c]!.by_year['Проект 2026']?.cons_prb,
      tot = Object.keys(programs).find((c) => ['total', prb + '.00.00'].includes(c)),
      pol = Object.keys(programs).filter(
        (c) => c.endsWith('.00') && c !== tot && c !== prb + '.00.00',
      );
    if (tot && v(tot) !== undefined && pol.length && pol.every((c) => v(c) !== undefined)) {
      check.policies_sum_to_total_2026 =
        Math.abs(pythonFloatSum(pol.map((c) => v(c)!)) - v(tot)!) < 0.5;
      const bad = pol.filter((pc) => {
        const kids = Object.keys(programs).filter(
          (c) => c.slice(0, 7) === pc.slice(0, 7) && !c.endsWith('.00'),
        );
        return (
          kids.length &&
          kids.every((c) => v(c) !== undefined) &&
          Math.abs(pythonFloatSum(kids.map((c) => v(c)!)) - v(pc)!) >= 0.5
        );
      });
      check.programs_sum_to_policy_2026 = !bad.length;
      if (bad.length) check.policies_with_program_mismatch = bad;
    }
    check.consistent = !!(
      check.total_matches_law &&
      check.policies_sum_to_total_2026 &&
      check.programs_sum_to_policy_2026
    );
    budgets[prb] = {
      file,
      zdb_art: art ?? null,
      zdb_name: l?.name ?? null,
      pages,
      years_complete: SRC_YEARS.filter((y) => Object.values(programs).every((p) => p.by_year[y])),
      programs,
      check,
      problems,
    };
  }
  const source = {
    ...programmeEditorial,
    budgets,
    not_parsed,
    validated: inputs
      .map((i) => i.file)
      .sort()
      .map((f) => f.slice(0, 4))
      .filter((k) => budgets[k]?.check.consistent),
  };
  return { source, pdfs, receipts, law } as {
    source: typeof source;
    pdfs: typeof pdfs;
    receipts: typeof receipts;
    law: LawBillCache;
  };
}
// The absent 2027 programme archive is publication state, never an allocation.
export const programme2027Unavailable = {
  status: 'unavailable' as const,
  reason: 'No registered 2027 programme archive is available; no programme allocations generated.',
};
import { programmeEditorial } from './programme-editorial.js';
/** Shape-only bridge: uses the existing builders without changing their policy. */
export const asProgrammeEvidence = (e: ReturnType<typeof extractProgrammes>): ProgrammeEvidence =>
  e as unknown as ProgrammeEvidence;
