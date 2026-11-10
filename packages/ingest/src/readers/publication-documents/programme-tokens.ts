import { type PdfPage, type Box, union } from '../pdf/index.js';
import { pythonRound } from '../../common/format.js';
export const YEAR_LABEL: Record<number, string> = {
  2023: 'Отчет 2023',
  2024: 'Отчет 2024',
  2025: 'Закон 2025',
  2026: 'Проект 2026',
  2027: 'Прогноза 2027',
  2028: 'Прогноза 2028',
};
export interface Token {
  kind: 'code' | 'num' | 'w';
  value: any;
  box: Box;
  block: number;
  line: number;
  raw: string;
}
const NUM = /^-?\d+(?:[.,]\d+)?$/u,
  G1 = /^-?\d{1,3}$/u,
  G3 = /^\d{3}(?:[.,]\d+)?$/u;
const DASHES = new Set(['-', '–', '—', '−']);
const numeric = (s: string) => Number(s.replaceAll(' ', '').replace(',', '.'));
export function programmeTokens(page: PdfPage): Token[] {
  let ww: Token[] = [];
  for (const [b, block] of page.blocks.entries())
    for (const [l, line] of block.lines.entries()) {
      const chars = line.spans.flatMap((s) => s.chars),
        text = chars.map((c) => c.text).join('');
      for (const m of text.matchAll(/\S+/gu))
        ww.push({
          kind: 'w',
          value: m[0],
          raw: m[0],
          box: union(chars.slice(m.index, m.index + m[0].length).map((c) => c.bbox)),
          block: b,
          line: l,
        });
    }
  const joined: Token[] = [];
  for (let i = 0; i < ww.length; i++) {
    const w = ww[i]!,
      nx = ww[i + 1];
    if (
      nx &&
      /^\d{1,3}[.,]$/u.test(w.raw) &&
      /^\d{1,2}$/u.test(nx.raw) &&
      Math.abs(nx.box[1] - w.box[1]) < 3 &&
      nx.box[0] - w.box[2] >= 0 &&
      nx.box[0] - w.box[2] < 4
    ) {
      const raw = w.raw + nx.raw;
      joined.push({ ...w, raw, value: raw, box: union([w.box, nx.box]) });
      i++;
    } else joined.push(w);
  }
  ww = joined;
  const out: Token[] = [];
  for (let i = 0; i < ww.length; i++) {
    const w = ww[i]!,
      nx = ww[i + 1],
      t = w.raw;
    let m = /^(\d{4})\.(\d{2})\.(\d{2})\*?$/u.exec(t);
    if (m) {
      out.push({ ...w, kind: 'code', value: m.slice(1).join('.') });
      continue;
    }
    if (/^\d{4}\.$/u.test(t) && nx && (m = /^(\d{2})\.(\d{2})\*?$/u.exec(nx.raw))) {
      out.push({
        ...w,
        kind: 'code',
        value: t.slice(0, 4) + '.' + m[1] + '.' + m[2],
        box: union([w.box, nx.box]),
      });
      i++;
      continue;
    }
    m = /^(\d{4})\.(\d{2})\.(\d)\*?$/u.exec(t);
    if (m) {
      if (
        nx &&
        /^\d\*?$/u.test(nx.raw) &&
        nx.box[1] - w.box[1] >= 0 &&
        nx.box[1] - w.box[1] < 25 &&
        Math.abs(nx.box[0] - w.box[0]) < 40
      ) {
        out.push({
          ...w,
          kind: 'code',
          value: m[1] + '.' + m[2] + '.' + m[3] + nx.raw[0],
          box: union([w.box, nx.box]),
        });
        i++;
        continue;
      }
      if (m[2] === '00' && m[3] === '0') {
        out.push({ ...w, kind: 'code', value: m[1] + '.00.00' });
        continue;
      }
    }
    if (NUM.test(t)) {
      let raw = t,
        end = w.box[2],
        j = i;
      if (G1.test(t))
        while (j + 1 < ww.length) {
          const n = ww[j + 1]!;
          if (
            G3.test(n.raw) &&
            Math.abs(n.box[1] - ww[j]!.box[1]) < 3 &&
            n.box[0] - end >= 0 &&
            n.box[0] - end < 4.6
          ) {
            raw += ' ' + n.raw;
            end = n.box[2];
            j++;
            if (/[.,]\d/u.test(n.raw)) break;
          } else break;
        }
      out.push({
        ...w,
        kind: 'num',
        value: numeric(raw),
        raw,
        box: [w.box[0], w.box[1], end, w.box[3]],
      });
      i = j;
      continue;
    }
    if (DASHES.has(t)) {
      if (
        nx &&
        NUM.test(nx.raw) &&
        Math.abs(nx.box[1] - w.box[1]) < 3 &&
        nx.box[0] - w.box[2] >= 0 &&
        nx.box[0] - w.box[2] < 3.5
      ) {
        const raw = '-' + nx.raw;
        out.push({ ...w, kind: 'num', value: numeric(raw), raw, box: union([w.box, nx.box]) });
        i++;
      } else out.push({ ...w, kind: 'num', value: 0 });
      continue;
    }
    out.push(w);
  }
  return out;
}
export function yearHeadings(t: Token[]): [number, string][] {
  const byLine = new Map<string, Token[]>();
  for (const w of t) {
    const k = w.block + ',' + w.line;
    const list = byLine.get(k) ?? [];
    list.push(w);
    byLine.set(k, list);
  }
  const out: [number, string][] = [];
  for (let k = 0; k < t.length; k++) {
    const w = t[k]!;
    if (w.kind !== 'w' || !/^\(?(Отчет|Закон|Проект|Прогноза)а?$/iu.test(w.value)) continue;
    let j = k + 1;
    if (t[j]?.kind === 'w' && t[j]!.value.toLowerCase() === 'за') j++;
    const n = t[j];
    if (!n || !['w', 'num'].includes(n.kind)) continue;
    const ym = /^\(?(20\d\d)/u.exec(n.raw);
    if (!ym || !YEAR_LABEL[Number(ym[1])]) continue;
    const line = byLine.get(w.block + ',' + w.line)!,
      count =
        line.length +
        (n.line !== w.line ? (byLine.get(w.block + ',' + (w.line + 1))?.length ?? 0) : 0);
    if (
      count <= 6 ||
      line
        .map((t) => t.value)
        .join(' ')
        .includes('хил')
    )
      out.push([w.box[1], YEAR_LABEL[Number(ym[1])]!]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
export function groupHeaders(t: Token[]): [number, number[]][] {
  const groups = ['Консолидирани', 'Ведомствени', 'Администрирани'],
    found: [number, number][][] = [[], [], []],
    out: [number, number[]][] = [];
  for (let k = 0; k < t.length; k++) {
    const w = t[k]!,
      g = groups.indexOf(w.value);
    if (w.kind === 'w' && g >= 0) {
      const nx = t[k + 1],
        end =
          nx?.kind === 'w' && nx.value.startsWith('разходи') && Math.abs(nx.box[1] - w.box[1]) < 3
            ? nx.box[2]
            : w.box[2];
      found[g]!.push([w.box[1], (w.box[0] + end) / 2]);
    }
  }
  for (let i = 0; i < Math.min(...found.map((x) => x.length)); i++) {
    const entries = found.map((x) => x[i]!);
    if (Math.max(...entries.map((e) => e[0])) - Math.min(...entries.map((e) => e[0])) < 12)
      out.push([Math.min(...entries.map((e) => e[0])), entries.map((e) => e[1])]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
const totalMarker = (t: Token[], k: number) =>
  t[k]?.kind === 'w' &&
  t[k]!.value === 'Общо' &&
  t[k + 1]?.kind === 'w' &&
  ((t[k + 1]!.value.startsWith('разходи') && t[k + 2]?.kind === 'num') ||
    (t[k + 1]!.value === 'по' && t[k + 2]?.kind === 'w' && t[k + 2]!.value === 'бюджета'));
const firstGroup = (s: string) => /^-?\d{1,3}(?: \d{3})*$/u.test(s),
  lastGroup = (s: string) => /^\d{3}[.,]\d+$/u.test(s);
function wrapped(a: Token, b: Token): Token | undefined {
  if (
    firstGroup(a.raw) &&
    lastGroup(b.raw) &&
    Math.abs(a.box[2] - b.box[2]) <= 1 &&
    b.box[1] - a.box[1] >= 3 &&
    b.box[1] - a.box[1] <= 16
  ) {
    const raw = a.raw + ' ' + b.raw;
    return { ...a, value: numeric(raw), raw, box: union([a.box, b.box]) };
  }
  return;
}
export interface ProgrammeRow {
  label: string | null;
  code: string;
  page: number;
  tokens: number[];
  x1: number[];
  x0: number[];
  hdr: number[] | null;
  hdr_own: boolean;
}
export function pageRows(t: Token[]) {
  const out: { code: string; y: number; ny: number; nums: Token[] }[] = [];
  for (let k = 0; k < t.length; k++) {
    const w = t[k]!,
      isCode = w.kind === 'code';
    if (!isCode && !totalMarker(t, k)) continue;
    let j = k + 1,
      total = !isCode;
    let nums: Token[] = [];
    while (j < t.length && t[j]!.kind !== 'code') {
      const n = t[j]!;
      if (n.kind === 'num') {
        if (DASHES.has(n.raw) && t[j + 1]?.kind === 'w') {
          j++;
          continue;
        }
        const v = nums.length ? wrapped(nums.at(-1)!, n) : undefined;
        if (v) nums[nums.length - 1] = v;
        else nums.push(n);
        if (nums.length >= 9) break;
      } else if (n.kind === 'w' && nums.length) break;
      else if (totalMarker(t, j)) {
        if (nums.length) break;
        total = true;
      }
      j++;
    }
    if (nums.length) {
      if (firstGroup(nums[0]!.raw))
        for (const n of t.slice(j, j + 8)) {
          if (n.kind === 'code') break;
          const v = n.kind === 'num' ? wrapped(nums[0]!, n) : undefined;
          if (v) {
            nums[0] = v;
            break;
          }
        }
      out.push({ code: total ? 'total' : w.value, y: w.box[1], ny: nums[0]!.box[1], nums });
    }
  }
  return out;
}
export function readProgrammeRows(pages: PdfPage[]): { rows: ProgrammeRow[]; pages: number[] } {
  const rows: ProgrammeRow[] = [],
    used: number[] = [];
  let carry: string | null = null,
    started = false,
    hcarry: number[] | null = null;
  for (const page of pages) {
    const hasCode =
      /\d{4}\.(?:\s?\d{2}\.\d{2})/u.test(page.text) || page.text.includes('Общо разходи');
    if (!started && !hasCode) {
      const heads = /(Отчет|Закон|Проект|Прогноза)/u.test(page.text)
        ? yearHeadings(programmeTokens(page))
        : [];
      carry = heads.at(-1)?.[1] ?? null;
      continue;
    }
    const t = programmeTokens(page),
      heads = yearHeadings(t),
      ghs = groupHeaders(t),
      all = pageRows(t),
      prow = all.filter((r) => r.nums.length >= 4);
    let strong = all.filter((r) => r.nums.length >= 5);
    if (!strong.length && prow.length >= 3 && ghs.length) strong = prow;
    if (!strong.length && !(started && prow.length >= 2)) {
      if (started) break;
      carry = heads.at(-1)?.[1] ?? null;
      continue;
    }
    started = true;
    used.push(page.number);
    for (const r of prow) {
      let label: string | null = null,
        hdr = hcarry,
        own = false;
      for (const [y, l] of heads) if (y <= Math.min(r.y, r.ny) + 2) label = l;
      label ??= carry;
      carry = label;
      for (const [y, h] of ghs)
        if (y <= Math.min(r.y, r.ny) + 2) {
          hdr = h;
          own = true;
        }
      rows.push({
        label,
        code: r.code,
        page: page.number,
        tokens: r.nums.map((n) => n.value),
        x1: r.nums.map((n) => n.box[2]),
        x0: r.nums.map((n) => n.box[0]),
        hdr,
        hdr_own: own,
      });
    }
    if (heads.length) carry = heads.at(-1)![1];
    if (ghs.length) hcarry = ghs.at(-1)![1];
  }
  return { rows, pages: used };
}
const QCH = '„“”"«»',
  stripQuotes = (s: string) => s.replace(/^[„“”"«»]+|[„“”"«»]+$/gu, '');
export function programmeNames(pages: PdfPage[], policyLabels = false): Record<string, string[]> {
  const seen = new Map<string, Map<string, { count: number; name: string }>>();
  for (const page of pages) {
    const t = programmeTokens(page);
    for (let k = 0; k < t.length; k++) {
      const w = t[k]!;
      if (
        w.kind !== 'code' ||
        w.value.endsWith('.00.00') ||
        (policyLabels && !w.value.endsWith('.00'))
      )
        continue;
      let ww: string[] = [];
      if (policyLabels) {
        for (const u of t.slice(k + 1, k + 61)) {
          if (u.kind !== 'w' || /^[.…]{3,}$/u.test(u.value)) break;
          ww.push(stripQuotes(u.value));
        }
      } else {
        if (
          t[k + 1]?.kind !== 'w' ||
          t[k + 2]?.kind !== 'w' ||
          !/^(Бюджетна|БЮДЖЕТНА)$/u.test(t[k + 1]!.value) ||
          !/^(програма|ПРОГРАМА)[„“”"«»]?$/u.test(t[k + 2]!.value)
        )
          continue;
        let opened = false;
        const reversed = QCH.includes(t[k + 2]!.value.slice(-1));
        for (const u of t.slice(k + 3, k + 63)) {
          if (u.kind !== 'w' || /^[.…]{3,}$/u.test(u.value)) break;
          const v = String(u.value);
          if (QCH.includes(v[0]!)) opened = true;
          ww.push(v);
          if (
            opened &&
            !reversed &&
            QCH.includes(v.slice(-1)) &&
            v.length > 1 + Number(QCH.includes(v[0]!))
          )
            break;
          if (opened && !reversed && ['“', '”', '"'].includes(v)) break;
        }
        while (ww.length && /^\d{1,2}\.$/u.test(ww[0]!)) ww.shift();
        ww = ww.map(stripQuotes);
      }
      const name = ww
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/\s+([,.;:])/gu, '$1');
      if (name.length < 3 || /^\d+$/u.test(name)) continue;
      const key = name
          .replace(/[\s„“”"«»]+/gu, ' ')
          .trim()
          .toLowerCase(),
        dict = seen.get(w.value) ?? new Map(),
        entry = dict.get(key) ?? { count: 0, name };
      entry.count++;
      dict.set(key, entry);
      seen.set(w.value, dict);
    }
  }
  const upper = (s: string) => s.toUpperCase() === s && s.toLowerCase() !== s;
  return Object.fromEntries(
    [...seen].map(([code, d]) => [
      code,
      [...d.values()]
        .sort(
          (a, b) =>
            b.count - a.count ||
            Number(upper(a.name)) - Number(upper(b.name)) ||
            b.name.length - a.name.length,
        )
        .map((x) => x.name),
    ]),
  );
}
