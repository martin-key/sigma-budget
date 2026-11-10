/** Final law/bill cache, from ordered physical HTML/DOCX blocks. Amounts are
 * printed thousand EUR; blanks/dashes stay null, identifiers stay strings. */
import type { GazetteBlock, LawHeadlineKey, LawPolicy } from '../../build/law-types.js';
import { parseLegalHtml } from '../documents/html.js';
import { parseLegalDocx } from '../documents/docx.js';
import { utf8 } from '../snapshots/pinned.js';
import { assert, ws } from '../pdf/index.js';
import { pythonFloatSum } from '../../common/numbers.js';
import { pythonRound } from '../../common/format.js';

const latin = Object.fromEntries(
  [...'ABCEHKMOPTXaceopxyk'].map((c, i) => [c, [...'АВСЕНКМОРТХасеорхуk'.replace('k', 'к')][i]]),
);
export const fold = (s: string) =>
  ws(s)
    .split(' ')
    .map((t) => (/[Ѐ-ӿ]/u.test(t) ? [...t].map((c) => latin[c] ?? c).join('') : t))
    .join(' ');
export const squash = (s: string) =>
  fold(s)
    .toUpperCase()
    .replaceAll('І', 'I')
    .replaceAll('Ѝ', 'И')
    .replace(/[\s\-–—−.(),:;"„“”«»'’/+]+/gu, '');
const roman = (s: string) => {
  const v = ws(s).toUpperCase().replaceAll('І', 'I').replaceAll('Х', 'X').replace(/\.+$/u, '');
  return /^[IVX]+$/u.test(v) ? v : '';
};
export function bgNumber(s: string): number | null {
  const v = ws(s).replaceAll(' ', '').replace(/[−–—]/gu, '-');
  if (!v || v === '-') return null;
  assert(/^-?\d+(,\d+)?$/u.test(v), 'Invalid BG monetary cell: ' + s);
  return Number(v.replace(',', '.'));
}
interface Line {
  sec: string;
  no: string;
  text: string;
  value: number | null;
  raw: string;
}
interface RecordData {
  name: string | null;
  headline: Partial<Record<LawHeadlineKey, number | null>>;
  policiesKind: string | null;
  policies: LawPolicy[];
  policyTotal: number | null;
  bodies: { name: string; khil: number | null }[];
  bodiesTotal: number | null;
  commitments: { entered: number | null; new: number | null } | null;
  _rows: Line[];
}
const keys: [LawHeadlineKey, string][] = [
  ['rev', 'ПРИХОДИПОМОЩИИДАРЕНИЯ'],
  ['exp', 'РАЗХОДИ'],
  ['transfers', 'БЮДЖЕТНИВЗАИМООТНОШЕНИЯ'],
  ['eucontrib', 'ВНОСКАВОБЩИЯБЮДЖЕТНАЕВРОПЕЙСКИЯСЪЮЗ'],
  ['balance', 'БЮДЖЕТНОСАЛДО'],
  ['financing', 'ОПЕРАЦИИВЧАСТТАНАФИНАНСИРАНЕТО'],
];
function parseRows(rows: string[][]): Line[] {
  const out: Line[] = [];
  let section = '';
  for (let r of rows) {
    if (r.length < 3) r = [...r, '', '', ''].slice(0, 3);
    if (
      !r.some(Boolean) ||
      ['№', 'N'].includes(r[0]!) ||
      (!r[0] && ['1', '2', ''].includes(r[1]!) && ['2', '3', '(хил. евро)', ''].includes(r[2]!))
    )
      continue;
    const no = ws(r[0]),
      text = fold(r[1]!);
    if (roman(no)) section = roman(no);
    let value: number | null = null;
    try {
      value = bgNumber(r.at(-1)!);
    } catch {
      /* Non-monetary printed table header. */
    }
    out.push({ sec: section, no, text, value, raw: r.at(-1)! });
  }
  return out;
}
function record(name: string | null, items: GazetteBlock[]): RecordData {
  const r: RecordData = {
    name,
    headline: {},
    policiesKind: null,
    policies: [],
    policyTotal: null,
    bodies: [],
    bodiesTotal: null,
    commitments: null,
    _rows: [],
  };
  let mode = 'main';
  for (const [k, val] of items) {
    if (k === 'p') {
      const m =
        /^\(\d+\)\s*Утвърждава\s+(?:разпределение\s+на\s+)?разходите\s+(?:на\s+[^,]+?\s+)?по\s+ал\.\s*1\s+(по\s+[^,:]+)/u.exec(
          val,
        );
      if (m) {
        mode = 'policies';
        r.policiesKind = m[1]!.includes('политики') ? 'policies' : 'areas';
      } else if (/^\(\d+\)\s*Определя\s+бюджетните\s+разходи\s+на\s+органите/u.test(val))
        mode = 'bodies';
      else if (/^\(\d+\)\s*Утвърждава\s+максималните\s+размери\s+на\s+ангажиментите/u.test(val))
        mode = 'commit';
      continue;
    }
    const rows = parseRows(val);
    if (mode === 'main') r._rows.push(...rows);
    else if (mode === 'policies' && !r.policies.length) {
      for (const line of rows) {
        if (squash(line.text).startsWith('ВСИЧКО')) {
          r.policyTotal = line.value;
          continue;
        }
        const n = line.no.replace(/\.+$/u, ''),
          item = { n, name: line.text, khil: line.value };
        if (r.policies.length && !/^\d+$/u.test(n)) (r.policies.at(-1)!.parts ??= []).push(item);
        else r.policies.push(item);
      }
      mode = 'after';
    } else if (mode === 'bodies' && !r.bodies.length) {
      for (const line of rows)
        if (squash(line.text).startsWith('ВСИЧКО')) r.bodiesTotal = line.value;
        else if (line.value !== null) r.bodies.push({ name: line.text, khil: line.value });
      mode = 'after';
    } else if (mode === 'commit' && !r.commitments) {
      if (rows.length >= 2) r.commitments = { entered: rows[0]!.value, new: rows[1]!.value };
      mode = 'after';
    }
  }
  for (const line of r._rows)
    if (roman(line.no))
      for (const [key, label] of keys)
        if (squash(line.text).startsWith(label) && !Object.hasOwn(r.headline, key))
          r.headline[key] = line.value;
  return r;
}
function articles(blocks: GazetteBlock[]) {
  const out: Record<string, RecordData[]> = {};
  let current: { art: string; name: string | null; items: GazetteBlock[] } | undefined;
  const flush = () => {
    if (current) (out[current.art] ??= []).push(record(current.name, current.items));
    current = undefined;
  };
  for (const block of blocks) {
    if (block[0] === 'p') {
      const m =
        /^Чл\.\s*(\d+)\.\s*\(1\)\s*Приема\s+(?:бюджета\s+на\s+(.+?)\s+за\s+2026\s*г\.|държавния\s+бюджет)/u.exec(
          block[1],
        );
      if (m) {
        flush();
        current = { art: m[1]!, name: m[2] ? fold(m[2]) : null, items: [] };
        continue;
      }
      if (/^Чл\.\s*\d+\./u.test(block[1])) {
        flush();
        continue;
      }
    }
    current?.items.push(block);
  }
  flush();
  return out;
}
const lineKey = (r: Line) => JSON.stringify([r.sec, r.no.replace(/\.+$/u, ''), squash(r.text)]);
const changed = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a !== b : Math.abs(a - b) > 1e-9;
/** Python SequenceMatcher(autojunk=False): longest contiguous match, then recurse.
 * Stable first-i/first-j tie breaking preserves donor add/delete ordering. */
function matches(a: string[], b: string[]): [number, number, number][] {
  const found: [number, number, number][] = [];
  const walk = (alo: number, ahi: number, blo: number, bhi: number) => {
    let bi = alo,
      bj = blo,
      best = 0,
      prev = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (let j = blo; j < bhi; j++)
        if (a[i] === b[j]) {
          const n = (prev.get(j - 1) ?? 0) + 1;
          next.set(j, n);
          if (n > best) {
            best = n;
            bi = i - n + 1;
            bj = j - n + 1;
          }
        }
      prev = next;
    }
    if (!best) return;
    if (alo < bi && blo < bj) walk(alo, bi, blo, bj);
    found.push([bi, bj, best]);
    if (bi + best < ahi && bj + best < bhi) walk(bi + best, ahi, bj + best, bhi);
  };
  walk(0, a.length, 0, b.length);
  const merged: [number, number, number][] = [];
  for (const m of found) {
    const last = merged.at(-1);
    if (last && last[0] + last[2] === m[0] && last[1] + last[2] === m[1]) last[2] += m[2];
    else merged.push([...m]);
  }
  merged.push([a.length, b.length, 0]);
  return merged;
}
function diffRows(bl: Line[], ll: Line[]) {
  const a = bl.filter((r) => r.value !== null),
    b = ll.filter((r) => r.value !== null),
    out: any[] = [];
  const row = (r: Line) => ({ sec: r.sec, no: r.no.replace(/\.+$/u, ''), text: r.text });
  let i = 0,
    j = 0;
  for (const [ai, bj, n] of matches(a.map(lineKey), b.map(lineKey))) {
    for (const x of a.slice(i, ai)) out.push({ op: 'del', ...row(x), bill: x.value });
    for (const y of b.slice(j, bj)) out.push({ op: 'add', ...row(y), law: y.value });
    for (let k = 0; k < n; k++)
      if (changed(a[ai + k]!.value, b[bj + k]!.value))
        out.push({ op: 'chg', ...row(a[ai + k]!), bill: a[ai + k]!.value, law: b[bj + k]!.value });
    i = ai + n;
    j = bj + n;
  }
  return out;
}
function diffRecord(b: RecordData, l: RecordData) {
  const d: any = {},
    hl: any = {};
  for (const k of [
    ...new Set([...Object.keys(b.headline), ...Object.keys(l.headline)]),
  ].sort() as LawHeadlineKey[])
    if (changed(b.headline[k], l.headline[k]))
      hl[k] = { bill: b.headline[k] ?? null, law: l.headline[k] ?? null };
  if (Object.keys(hl).length) d.headline = hl;
  const named = (items: any[]): Line[] =>
    items
      .flatMap((i) => [i, ...(i.parts ?? [])])
      .map((i) => ({ sec: '', no: i.n ?? '', text: i.name, value: i.khil, raw: '' }));
  for (const [k, a, c] of [
    ['lines', b._rows, l._rows],
    ['policies', named(b.policies), named(l.policies)],
    ['bodies', named(b.bodies), named(l.bodies)],
  ] as [string, Line[], Line[]][]) {
    const v = diffRows(a, c);
    if (v.length) d[k] = v;
  }
  const cm: any = {};
  for (const k of ['entered', 'new'] as const)
    if (changed(b.commitments?.[k], l.commitments?.[k]))
      cm[k] = { bill: b.commitments?.[k] ?? null, law: l.commitments?.[k] ?? null };
  if (Object.keys(cm).length) d.commitments = cm;
  if (b.policyTotal !== l.policyTotal) d.policyTotal = { bill: b.policyTotal, law: l.policyTotal };
  return d;
}
interface MunicipalTable {
  rows: { region: string; name: string; values: (number | null)[] }[];
  total: (number | null)[] | null;
}
function municipal(blocks: GazetteBlock[]): MunicipalTable[] {
  const out: MunicipalTable[] = [];
  for (const [kind, rows] of blocks) {
    if (
      kind !== 't' ||
      rows.filter((r) => r[0] && ws(r[0]).toUpperCase().startsWith('ОБЛАСТ')).length < 20
    )
      continue;
    const t: MunicipalTable = { rows: [], total: null };
    let region: string | null = null;
    for (const row of rows) {
      const name = fold(row[0] ?? '');
      if (name.toUpperCase().startsWith('ОБЛАСТ')) {
        region = name;
        continue;
      }
      if (!name) continue;
      let cells = row.slice(1).map(ws);
      if (row.length === 8 && !cells[0]) cells = cells.slice(1);
      if (squash(name).startsWith('ВСИЧКО')) {
        t.total = cells.map(bgNumber);
        continue;
      }
      let values: (number | null)[];
      try {
        values = cells.map(bgNumber);
      } catch {
        continue;
      }
      if (region && values.some((v) => v !== null))
        t.rows.push({
          region: squash(name) === 'СТОЛИЧНАОБЩИНА' ? 'ОБЛАСТ СОФИЯ (СТОЛИЦА)' : region,
          name,
          values,
        });
    }
    if (t.rows.length) out.push(t);
  }
  assert(out.length === 2, 'Expected both municipal physical tables');
  return out;
}
export function extractLawBillBlocks(lawBlocks: GazetteBlock[], billBlocks: GazetteBlock[]) {
  const la = articles(lawBlocks),
    ba = articles(billBlocks),
    nums = Array.from({ length: 47 }, (_, i) => String(i + 1));
  assert(
    Object.keys(la).join() === nums.join() && Object.keys(ba).join() === nums.join(),
    'Expected budget articles 1..47',
  );
  const law: Record<string, RecordData> = {},
    bill: Record<string, RecordData> = {},
    billMc: Record<string, RecordData> = {},
    diff: Record<string, any> = {};
  for (const a of nums) {
    assert(
      la[a]!.length === 1 && ba[a]!.length === (['1', '2'].includes(a) ? 2 : 1),
      'Unexpected article occurrences: ' + a,
    );
    law[a] = la[a]![0]!;
    bill[a] = ba[a]![0]!;
    if (['1', '2'].includes(a)) billMc[a] = ba[a]![1]!;
    const d = diffRecord(bill[a]!, law[a]!);
    if (Object.keys(d).length) diff[a] = d;
    if (Number(a) >= 2) {
      const r = law[a]!;
      assert(
        r.name && r.policies.length && r.policiesKind && r.commitments,
        'Incomplete law budget ' + a,
      );
      assert(
        r.policyTotal !== null &&
          r.headline.exp != null &&
          Math.abs(r.policyTotal - r.headline.exp) < 0.051,
        'Law distribution total ' + a,
      );
      assert(
        Math.abs(pythonFloatSum(r.policies.map((p) => p.khil ?? 0)) - r.policyTotal) < 0.3,
        'Law policy sum ' + a,
      );
      assert(squash(bill[a]!.name ?? '') === squash(r.name), 'Bill name mismatch ' + a);
    }
  }
  const exp = pythonFloatSum(nums.slice(1).map((a) => law[a]!.headline.exp ?? 0)),
    rev = pythonFloatSum(nums.slice(1).map((a) => law[a]!.headline.rev ?? 0));
  assert(
    Math.abs(exp - 13326470.3) < 0.051 && Math.abs(rev - 2284302.7) < 0.051,
    'Law headline totals',
  );
  assert(
    !Object.keys(diffRecord(billMc['2']!, law['2']!)).length,
    'Council of Ministers judiciary occurrence differs',
  );
  const mc1 = diffRecord(billMc['1']!, law['1']!);
  assert(!mc1.headline, 'Council of Ministers article 1 headline differs');
  assert(
    JSON.stringify((mc1.lines ?? []).map((l: any) => [l.no, l.bill, l.law]).sort()) ===
      JSON.stringify([
        ['1.2', 1127159, 1127210.1],
        ['1.2.2', 112699, 112750.1],
      ]),
    'Council of Ministers article 1 line differences',
  );
  for (const a of nums.slice(1)) {
    const r = law[a]!,
      h = r.headline;
    assert(
      r.policies.every((p) => typeof p.khil === 'number' && Number.isFinite(p.khil)),
      'Non-monetary law policy cell ' + a,
    );
    if (h.exp != null && h.balance != null && h.transfers != null) {
      const balance = (h.rev ?? 0) - h.exp + h.transfers - (h.eucontrib ?? 0);
      assert(Math.abs(balance - h.balance) < 0.3, 'Law budget balance ' + a);
    }
  }
  const ml = municipal(lawBlocks),
    mb = municipal(billBlocks),
    muni: any = {};
  const columns = [
    ['total', 'delegated', 'equalizing', 'winterRoads', 'capital', 'otherTargeted'],
    [
      'delegated',
      'admin',
      'mayors',
      'adminStaff',
      'defence',
      'education',
      'health',
      'social',
      'culture',
      'economy',
    ],
  ];
  for (let k = 0; k < 2; k++) {
    const l = ml[k]!,
      b = mb[k]!,
      cols = columns[k]!,
      changes: any[] = [];
    assert(l.rows.length === 265 && b.rows.length === 265, 'Municipality count');
    assert(l.total?.length === cols.length, 'Municipal total width');
    for (let j = 0; j < cols.length; j++)
      assert(
        l.total![j] != null &&
          Math.abs(pythonFloatSum(l.rows.map((r) => r.values[j] ?? 0)) - l.total![j]!) < 0.5,
        'Municipal sum ' + cols[j],
      );
    for (let i = 0; i < 265; i++) {
      const x = b.rows[i]!,
        y = l.rows[i]!;
      assert(
        x.region === y.region &&
          squash(x.name) === squash(y.name) &&
          x.values.length === cols.length &&
          y.values.length === cols.length,
        'Municipal row order/width',
      );
      for (let j = 0; j < cols.length; j++)
        if (changed(x.values[j], y.values[j]))
          changes.push({
            region: y.region,
            name: y.name,
            col: cols[j],
            bill: x.values[j],
            law: y.values[j],
          });
    }
    muni['art' + (51 + k)] = { cols, law: l, billVsLaw: changes };
  }
  const totals = [4887464, 4351706, 255658, 25100, 255000, 40500];
  assert(
    ml[0]!.total?.every((v, i) => v !== null && Math.abs(v - totals[i]!) < 0.051),
    'Law article 51 printed totals',
  );
  const output = (r: RecordData, lines: boolean) => {
    const { _rows, ...rest } = r;
    return {
      ...rest,
      ...(lines
        ? { lines: _rows.map((x) => [x.sec, x.no.replace(/\.+$/u, ''), x.text, x.value]) }
        : {}),
    };
  };
  return {
    sources: {
      law: 'ЗДБ 2026, ДВ бр. 69 от 31.07.2026 (zdb2026_dv69_idMat245041.html)',
      bill: 'законопроект 52-602-01-19 (52-602-01-19.docx)',
    },
    law: Object.fromEntries(nums.map((a) => [a, output(law[a]!, true)])),
    bill: Object.fromEntries(nums.map((a) => [a, output(bill[a]!, Object.hasOwn(diff, a))])),
    billMc: Object.fromEntries(['1', '2'].map((a) => [a, output(billMc[a]!, false)])),
    diff,
    sums: { expKhil: pythonRound(exp, 1), revKhil: pythonRound(rev, 1), budgets: 46 },
    municipal: muni,
  };
}
export function extractLawBill(html: Uint8Array, docx: Uint8Array) {
  return extractLawBillBlocks(parseLegalHtml(utf8(html)), parseLegalDocx(docx).blocks);
}
export type LawBillCache = ReturnType<typeof extractLawBill>;
