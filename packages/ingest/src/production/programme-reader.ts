import { programmeReferences, programmeEqual } from '@sigma-budget/dataset-schema';
import {
  readPdf,
  pdfTables,
  textInBox,
  union,
  ws,
  type PdfDocument,
  type Box,
} from '../readers/pdf/index.js';
export const programmeLayouts = {
  '0100': [{ page: 15, table: 0, start: 8, columns: [1, 2, 3, 5, 6, 7, 8, 9, 11], header: 8 }],
  '1800': [
    { page: 18, table: 1, start: 2, columns: [3, 5, 8, 11, 14, 17, 19, 21, 24], header: 1 },
    { page: 19, table: 0, start: 0, columns: [3, 4, 5, 6, 7, 8, 9, 10, 11], header: 0 },
  ],
  '2300': [
    { page: 31, table: 1, start: 14, columns: [4, 5, 6, 7, 8, 9, 10, 11, 12], header: 14 },
    { page: 32, table: 0, start: 0, columns: [4, 5, 6, 7, 8, 9, 10, 11, 12], header: 0 },
  ],
  '7400': [{ page: 24, table: 0, start: 3, columns: [2, 3, 4, 5, 6, 7, 8, 9, 10], header: 3 }],
};
export function programmeName(s: string) {
  return ws(s)
    .replace(/["„“”]/gu, '')
    .replace(/-\s+/gu, '-')
    .replace(/([а-яА-Я]) ([а-яА-Я])\b/gu, (all, a, b) =>
      'вси'.includes(b.toLowerCase()) ? all : a + b,
    )
    .trim();
}
export function parseProgrammeSupplement(doc: PdfDocument, code: keyof typeof programmeLayouts) {
  const positions: any[] = [];
  const rows: {
    page: number;
    printedCode: string;
    kind: 'total' | 'policy' | 'program';
    name: string;
    values: (number | null)[];
  }[] = [];
  for (const spec of programmeLayouts[code]) {
    const p = doc.pages[spec.page - 1]!,
      t = pdfTables(p)[spec.table];
    if (!t) throw new Error('Programme table absent');
    const ranges = spec.columns.map((i) => t.rows[spec.header]![i]!);
    if (ranges.some((r) => !r)) throw new Error('Programme columns absent');
    for (let i = spec.start; i < t.rows.length; i++) {
      const raw = t.rawCells[i]!,
        prefix = raw.slice(0, code === '0100' ? 1 : code === '7400' ? 2 : 3).join(' ');
      const label = programmeName(prefix);
      const m = /\d{4}\.\s*\d{2}\.\s*\d{2}/u.exec(prefix.replace(/\s/g, ''));
      if (
        !m &&
        !/^(Общо по бюджета|Функционална област|Програма \d)/u.test(label) &&
        !(code === '7400' && /^Общо разходи/u.test(label))
      )
        continue;
      let printedCode = m
        ? m[0]
        : /^Общо/u.test(label)
          ? 'total'
          : /^Функционална/u.test(label)
            ? label.split(' ').slice(0, 3).join(' ')
            : /^Програма (\d+)/u.exec(label)![0];
      const box = union(t.rows[i]!.filter((v): v is Box => !!v));
      const ci = raw.findIndex((v) => /^\d{4}\.\d{2}\.\d{2}\.?$/u.test(v.replace(/\s/g, '')));
      const codeBox = ci >= 0 ? t.rows[i]![ci]! : null;
      const labelBox: Box = [codeBox ? codeBox[2] : box[0], box[1], ranges[0]![0], box[3]];
      const name = programmeName(textInBox(p, labelBox));
      if (!/[А-Яа-я]/u.test(name)) continue;
      const kind = /^Общо/u.test(name)
        ? 'total'
        : /^(Бюджетна програма|Програма )/u.test(name)
          ? 'program'
          : 'policy';
      const values = ranges.map((r) => {
        const s = textInBox(p, [r[0], box[1], r[2], box[3]]).replace(/\s/gu, '');
        if (!s) return null;
        if (!/^-?\d+[.,]\d$/u.test(s))
          throw new Error('Non-numeric programme cell ' + code + '/' + spec.page + '/' + i);
        return Number(s.replace(',', '.'));
      });
      const old = rows.at(-1),
        last = positions.at(-1);
      if (
        old?.printedCode === printedCode &&
        old.page === spec.page &&
        last &&
        box[1] >= last.labelBox[1] &&
        box[3] <= last.labelBox[3]
      )
        continue;
      if (old?.printedCode === printedCode && old.kind === kind)
        throw new Error('Duplicate programme row');
      positions.push({
        page: spec.page,
        labelBox,
        codeBox,
        cells: ranges.map((r) => [r[0], box[1], r[2], box[3]]),
      });
      rows.push({ page: spec.page, printedCode, kind, name, values });
    }
  }
  if (!rows.length) throw new Error('No programme rows');
  if (
    doc.sha256 !== programmeReferences[code]!.sourceSha256 ||
    !programmeEqual(rows, programmeReferences[code]!.rows)
  )
    throw new Error('Programme cells differ from independent PDFMiner source transcription');
  return { code, sourceSha256: doc.sha256, rows, positions };
}
export const readProgrammeSupplement = (bytes: Uint8Array, code: keyof typeof programmeLayouts) =>
  parseProgrammeSupplement(readPdf(bytes), code);
