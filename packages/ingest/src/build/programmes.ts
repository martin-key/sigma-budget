import { artEbk } from './law-definitions.js';
import { isNumber, roundNumber } from '../io/data.js';
import type {
  LawArticleEvidence,
  LawAmount,
  LawHeadlineKey,
  ParsedLawEvidence,
  LawDiffEvidence,
} from './law-types.js';

export const SRC_YEARS = [
  'Отчет 2023',
  'Отчет 2024',
  'Закон 2025',
  'Проект 2026',
  'Прогноза 2027',
  'Прогноза 2028',
];
export const YEARS = [2023, 2024, 2025, 2026, 2027, 2028];
export const VINTAGE = ['actual', 'actual', 'plan', 'plan', 'forecast', 'forecast'];
export const COLS = [
  'cons_total',
  'cons_prb',
  'cons_other',
  'dept_total',
  'dept_prb',
  'dept_other',
  'adm_total',
  'adm_prb',
  'adm_other',
];
export const COLS_OUT = [
  'consTotal',
  'consPrb',
  'consOther',
  'deptTotal',
  'deptPrb',
  'deptOther',
  'admTotal',
  'admPrb',
  'admOther',
];
const Y26 = SRC_YEARS[3]!,
  Y25 = SRC_YEARS[2]!;
const reasons: Record<string, string> = {
  format:
    'Таблиците на документа са в нестандартен формат (липсват кодове на програмите или кодовете и числата са пренесени на нов ред) и още не са разчетени.',
  year: 'Таблицата с програмите в документа няма разпознаваема година и затова не можа да се разчете.',
  sums: 'Числата в таблиците на документа не дават очакваните сборове при разчитането им и затова не се показват.',
  'source-sums':
    'Сборовете в таблицата на самия документ не излизат (вероятна грешка в документа) и затова програмите не се показват, докато не бъдат проверени.',
  'no-total':
    'Разчитането на таблицата за бюджетната година не даде общ ред, който да се сверти със закона.',
  'missing-policies':
    'Таблицата за бюджетната година е разчетена непълно: част от политиките липсват и сборът им не дава общата сума на бюджета.',
  'missing-programs':
    'Таблицата за бюджетната година е разчетена непълно: част от програмите липсват и сборът им не дава сумата на политиката.',
  'no-rows': 'В документа не бяха намерени политики и програми за бюджетната година.',
};
// The reader's resolved cells and names are independent evidence, not builder output.
type Cell = Record<string, number | null>;
type Row = { name: string; by_year: Record<string, Cell | null> };
type EvidenceCell = { values: number[] | null; method: string; cands: number[][]; pages: number[] };
type PdfEvidence = {
  cells: [[string, string], EvidenceCell][];
  conflicts: [string, string][];
  programNames: Record<string, string[]>;
  rowLabels: Record<string, string[]>;
};
// Data is produced by Python's pinned source parsers. Runtime checks at the boundaries
// still reject missing budgets, cells and duplicate source keys.
export interface ProgrammeLawArticle extends LawArticleEvidence {
  policiesKind?: string | null;
  policyTotal?: LawAmount;
}
export interface ProgrammeLawDiff extends LawDiffEvidence {
  headline?: Partial<Record<LawHeadlineKey, { bill: LawAmount; law: LawAmount }>>;
}
export interface ProgrammeLawEvidence extends Omit<ParsedLawEvidence, 'law' | 'diff'> {
  law: Record<string, ProgrammeLawArticle>;
  diff: Record<string, ProgrammeLawDiff>;
}
export interface ProgrammeNode {
  code: string;
  name: string;
  values: Record<string, number[]>;
}
export interface ProgrammePolicy extends ProgrammeNode {
  kind: 'policy' | 'program';
  programs?: ProgrammeNode[];
}
export interface ProgrammeBudgetDifference {
  prbKhil: number;
  lawKhil: number | null;
  diffKhil: number | null;
  billKhil?: number;
  matchesBill?: boolean;
}
interface ProgrammeRecordBase {
  code: string;
  art: number;
  lawExpKhil: number | null;
  file: string;
  yearsComplete: number[];
  skipped: string[];
  exp2025Khil?: number;
  pagesByYear?: Record<string, number[]>;
  pages?: number[];
  readMethods?: Record<string, number>;
}
export interface PendingProgrammeRecord extends ProgrammeRecordBase {
  tier: 'pending';
  reasonKey: string;
  reason: string;
}
export interface PublishedProgrammeRecord extends ProgrammeRecordBase {
  tier: 'validated' | 'program-budget-differs';
  pagesByYear: Record<string, number[]>;
  pages: number[];
  total: Record<string, number[]>;
  policies: ProgrammePolicy[];
  policyCount: number;
  programCount: number;
  check: {
    prbTotal2026: number;
    lawExp: number | null;
    matchesLaw: boolean;
    policiesSumToTotal: true;
    programsSumToPolicies: true;
  };
  programBudgetVsLaw?: ProgrammeBudgetDifference;
}
export type ProgrammeRecord = PendingProgrammeRecord | PublishedProgrammeRecord;
export interface ProgrammeEvidence {
  source: {
    budgets: Record<string, { file: string; programs: Record<string, Row> }>;
    not_parsed: Record<string, string>;
  };
  law: ProgrammeLawEvidence;
  pdfs: Record<string, PdfEvidence>;
}
type Entry = [string, string, Row];
type Structure = {
  total?: Row;
  top: Entry[];
  kids: Record<string, [string, Row][]>;
  foreign: string[];
};
const round = (x: number) => roundNumber(x, 1)!;
function quotes(s: string): string {
  let out = '',
    depth = 0;
  for (const c of s) {
    if (c === '„') {
      out += '„';
      depth++;
    } else if ('"“”«»'.includes(c)) {
      if (depth > 0) {
        out += '“';
        depth--;
      } else if ('"“«'.includes(c)) {
        out += '„';
        depth++;
      }
    } else if (!"'`‘’".includes(c)) out += c;
  }
  return out + (depth > 0 ? '“' : '');
}
function outer(s: string): string {
  return s.length > 2 && s.startsWith('„') && s.endsWith('“') && !/[„“]/u.test(s.slice(1, -1))
    ? s.slice(1, -1)
    : s;
}
export function cleanName(raw: string): string {
  let s = (raw || '').replace(/\s+/gu, ' ').trim();
  const cut =
    /\s(?:\d{4}\.\d{2}\.\d{2}(?![\p{L}\p{N}_])|Код\s*\*|Консолидирани разходи|ОБЛАСТИ НА(?![\p{L}\p{N}_])|\d{1,3}(?: \d{3})*,\d(?:\s|$)|0, 0(?![\p{L}\p{N}_]))/u.exec(
      s,
    );
  if (cut) s = s.slice(0, cut.index);
  const next =
    /\s(?=(?:Бюджетна програма|Политика в областта|Област на политика|Функционална област)(?![\p{L}\p{N}_]))/gu;
  next.lastIndex = 12;
  const match = next.exec(s);
  if (match) s = s.slice(0, match.index);
  s = s
    .replace(
      /^(?:Код\s*\*?\s*\d{4}\.\d{2}\.\d{2}[^\p{L}\p{N}_]*)?(?:Бюджетна програма|Област на политика\s*\/\s*функционална област|Функционална област|Област на политика|Област)\s*/iu,
      '',
    )
    .trim();
  s = quotes(s)
    .replace(/„\s*“/gu, '')
    .replace(/^[\s.,;:–-]+|[\s.,;:–-]+$/gu, '')
    .replace(/\s+\d{1,3}(?:[ ,]\d{1,3})*$/u, '');
  const dup = /^(.{6,}?)\s+\1$/iu.exec(s);
  if (dup) s = dup[1]!;
  s = outer(s).replace(/^[\s.,;:–-]+|[\s.,;:–-]+$/gu, '');
  const letters = [...s].filter((c) => /\p{L}/u.test(c));
  const caps = (s.match(/\p{L}+/gu) ?? []).some((t) => t.length >= 7 && t === t.toUpperCase());
  if (
    letters.length > 8 &&
    caps &&
    letters.filter((c) => c === c.toUpperCase()).length / letters.length > 0.85
  )
    s = s.toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
export function lawPolicyName(raw: string): string {
  let s = (raw || '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\s*\(общо\),?\s*в т\.ч\.:?$/u, '')
    .replace(/^(?:Функционална област|Област на политика|Област|Бюджетна програма)\s+/u, '');
  return outer(quotes(s)).replace(/^[ .,;:]+|[ .,;:]+$/gu, '');
}
function suspect(name: string): boolean {
  const toks = name.match(/\p{L}+/gu) ?? [];
  return (
    toks.some((t) => t.length === 1 && !'вси'.includes(t.toLowerCase())) ||
    /\d/u.test(name) ||
    (/[A-Za-z]/u.test(name) && /[а-яА-Я]/u.test(name)) ||
    name.length > 230 ||
    name.length < 6
  );
}
function classify(key: string, name: string): string {
  return key === 'total' || key.endsWith('.00.00')
    ? 'total'
    : key.endsWith('.00') && !/^бюджетна програма/iu.test(name.trim())
      ? 'policy'
      : 'program';
}
function cell(row: Row | undefined, label: string): Cell | undefined {
  const c = row?.by_year?.[label];
  if (!c || !COLS.every((k) => isNumber(c[k]))) return undefined;
  if (
    Math.abs(c.cons_total! - c.cons_prb! - c.cons_other!) > 0.15 ||
    Math.abs(c.dept_total! - c.dept_prb! - c.dept_other!) > 0.15 ||
    Math.abs(c.adm_total! - c.adm_prb! - c.adm_other!) > 0.15 ||
    Math.abs(c.cons_total! - c.dept_total! - c.adm_total!) > 0.15
  )
    return undefined;
  return c;
}
function structure(code: string, rows: Record<string, Row>): Structure {
  const top: Entry[] = [],
    kids: Record<string, [string, Row][]> = {},
    foreign: string[] = [];
  for (const key of Object.keys(rows).sort()) {
    if (key === 'total') continue;
    if (!key.startsWith(code + '.')) {
      foreign.push(key);
      continue;
    }
    const r = rows[key]!,
      kind = classify(key, r.name || '');
    if (kind === 'total') continue;
    const nn = key.split('.')[1]!;
    if (key.endsWith('.00')) top.push([key, kind, r]);
    else (kids[nn] ??= []).push([key, r]);
  }
  return { total: rows[code + '.00.00'] || rows.total, top, kids, foreign };
}
function sums(parent: Row | undefined, children: Row[], label: string, cols = COLS): boolean {
  const p = cell(parent, label),
    cs = children.map((r) => cell(r, label));
  return (
    !!p &&
    cs.every(Boolean) &&
    cols.every(
      (k) => Math.abs(cs.reduce((n, c) => n + c![k]!, 0) - p[k]!) <= 0.06 * (children.length + 1),
    )
  );
}
function yearStruct(s: Structure, label: string) {
  const top = s.top.filter(([, , r]) => !!r.by_year[label]);
  const kids = Object.fromEntries(
    Object.entries(s.kids)
      .map(([k, v]) => [k, v.filter(([, r]) => !!r.by_year[label])])
      .filter(([, v]) => (v as unknown[]).length),
  ) as Record<string, [string, Row][]>;
  const have = new Set(top.map(([k]) => k.split('.')[1]));
  const orphans = Object.keys(kids)
    .filter((k) => !have.has(k))
    .sort();
  return { top, kids, orphans };
}
function yearComplete(s: Structure, label: string): boolean {
  const { top, kids, orphans } = yearStruct(s, label);
  if (
    !s.total ||
    !top.length ||
    orphans.length ||
    !sums(
      s.total,
      top.map((x) => x[2]),
      label,
    )
  )
    return false;
  for (const [key, kind, row] of top) {
    const nn = key.split('.')[1]!,
      ch = kids[nn] || [];
    if (
      kind === 'policy' &&
      ch.length &&
      !sums(
        row,
        ch.map((x) => x[1]),
        label,
      )
    )
      return false;
    const c = cell(row, label);
    if (
      kind === 'policy' &&
      !ch.length &&
      s.kids[nn]?.length &&
      !(c && COLS.every((k) => Math.abs(c[k]!) < 0.05))
    )
      return false;
    if (kind === 'program' && ch.length) return false;
  }
  return true;
}
function values(row: Row | undefined): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  SRC_YEARS.forEach((label, i) => {
    const c = cell(row, label);
    if (c) out[String(YEARS[i])] = COLS.map((k) => round(c[k]!));
  });
  return out;
}
function verifiedView(
  code: string,
  b: ProgrammeEvidence['source']['budgets'][string] | undefined,
  pdf: PdfEvidence,
) {
  const progs: Record<string, Row> = {},
    byLabel: Record<string, Set<number>> = {},
    unresolved: [string, string][] = [],
    methods: Record<string, number> = {},
    badLabels = new Set<string>(),
    nameFills = new Set<string>(),
    seen = new Set<string>();
  const cells = [...pdf.cells].sort((a, b) => {
    const ai = SRC_YEARS.indexOf(a[0][0]),
      bi = SRC_YEARS.indexOf(b[0][0]);
    return (
      (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) ||
      (a[0][1] < b[0][1] ? -1 : a[0][1] > b[0][1] ? 1 : 0)
    );
  });
  for (const [[label, key], c] of cells) {
    const identity = JSON.stringify([label, key]);
    if (seen.has(identity)) throw new Error(`duplicate programme id ${key} for ${label}`);
    seen.add(identity);
    let vec = c.values,
      method = c.method;
    const jr =
      key === 'total' ? b?.programs.total || b?.programs[code + '.00.00'] : b?.programs[key];
    if (vec === null && method === 'ambiguous' && jr) {
      const candidates = new Set(c.cands.map((v) => JSON.stringify(v.map(round))));
      const hits = new Set(
        Object.values(jr.by_year || {})
          .filter((v): v is Cell => !!v && COLS.every((k) => isNumber(v[k])))
          .map((v) => JSON.stringify(COLS.map((k) => round(v[k]!))))
          .filter((v) => candidates.has(v)),
      );
      if (hits.size === 1) {
        vec = JSON.parse([...hits][0]!);
        method = 'prototype';
      }
    }
    methods[method] = (methods[method] || 0) + 1;
    if (vec === null) {
      unresolved.push([label, key]);
      if (method === 'bad') badLabels.add(label);
      continue;
    }
    let raw = jr?.name || '';
    if (key !== 'total' && !key.endsWith('.00') && (!cleanName(raw) || suspect(cleanName(raw)))) {
      const alt = (pdf.programNames[key] || []).find((n) => cleanName(n) && !suspect(cleanName(n)));
      if (alt) {
        raw = alt;
        nameFills.add(key);
      }
    }
    const row = (progs[key] ??= {
      name: raw || (key === 'total' ? 'Общо разходи' : ''),
      by_year: {},
    });
    row.by_year[label] = Object.fromEntries(COLS.map((k, i) => [k, round(vec![i]!)]));
    const pages = (byLabel[label] ??= new Set());
    for (const p of c.pages) pages.add(p);
  }
  unresolved.push(...pdf.conflicts);
  const pagesByYear: Record<string, number[]> = {};
  SRC_YEARS.forEach((lbl, i) => {
    if (byLabel[lbl]?.size)
      pagesByYear[String(YEARS[i])] = [...byLabel[lbl]!].sort((a, b) => a - b);
  });
  return { progs, pagesByYear, unresolved, methods, badLabels, nameFills: [...nameFills].sort() };
}
function notParsed(msg: string): string {
  return msg.startsWith('няма таблици')
    ? 'format'
    : msg.includes('без разпозната година')
      ? 'year'
      : 'sums';
}
function diagnose(s: Structure): string {
  const { top, orphans } = yearStruct(s, Y26);
  if (!cell(s.total, Y26)) return 'no-total';
  return !top.length ||
    orphans.length ||
    !sums(
      s.total,
      top.map((x) => x[2]),
      Y26,
      ['cons_prb'],
    )
    ? 'missing-policies'
    : 'missing-programs';
}
export function loadProgrammes(e: ProgrammeEvidence): Record<string, ProgrammeRecord> {
  const records: Record<string, any> = {};
  const byCode = Object.fromEntries(
    Object.entries(artEbk).map(([art, code]) => [code, Number(art)]),
  );
  const notParsedByCode = Object.fromEntries(
    Object.entries(e.source.not_parsed).map(([fn, msg]) => [fn.slice(0, 4), [fn, msg]]),
  );
  for (const code of Object.keys(byCode).sort()) {
    const art = byCode[code]!,
      L = e.law.law[String(art)];
    if (!L) throw new Error(`missing law ministry ${code}`);
    const lawExp = L.headline.exp ?? null,
      b = e.source.budgets[code],
      pair = b ? [b.file, null] : notParsedByCode[code];
    if (!pair) throw new Error(`missing ministry code ${code}`);
    const [fn, msg] = pair as [string, string | null],
      pdf = e.pdfs[fn];
    if (!pdf) throw new Error(`missing PDF evidence ${fn}`);
    const v = verifiedView(code, b, pdf),
      rec: any = { code, art, lawExpKhil: lawExp, yearsComplete: [], skipped: [], file: fn };
    if (!Object.keys(v.progs).length) {
      const rk = msg ? notParsed(msg) : 'no-rows';
      Object.assign(rec, { tier: 'pending', reasonKey: rk, reason: reasons[rk] });
      records[code] = rec;
      continue;
    }
    rec.pagesByYear = v.pagesByYear;
    rec.pages = [...new Set(Object.values(v.pagesByYear).flat())].sort((a, b) => a - b);
    rec.readMethods = v.methods;
    rec.skipped = v.unresolved.map(
      ([label, k]) =>
        `Ред „${k === 'total' ? 'общо' : k}“ за ${label.split(' ').at(-1)} не можа да се разчете със сигурност и не се показва.`,
    );
    const s = structure(code, v.progs);
    if (s.foreign.length)
      rec.skipped.push(
        `Редове с чужди кодове в таблицата (${s.foreign.join(', ')}) са пропуснати.`,
      );
    rec.yearsComplete = YEARS.filter((_, i) => yearComplete(s, SRC_YEARS[i]!));
    if (rec.yearsComplete.includes(2025)) rec.exp2025Khil = round(cell(s.total, Y25)!.cons_prb!);
    if (!rec.yearsComplete.includes(2026)) {
      const rk = v.badLabels.has(Y26) ? 'source-sums' : msg ? notParsed(msg) : diagnose(s);
      Object.assign(rec, { tier: 'pending', reasonKey: rk, reason: reasons[rk], skipped: [] });
      records[code] = rec;
      continue;
    }
    const t26 = cell(s.total, Y26)!,
      diff = lawExp == null ? null : round(lawExp - t26.cons_prb!),
      matches = diff !== null && Math.abs(diff) <= 0.11;
    rec.tier = matches ? 'validated' : 'program-budget-differs';
    rec.check = {
      prbTotal2026: round(t26.cons_prb!),
      lawExp,
      matchesLaw: matches,
      policiesSumToTotal: true,
      programsSumToPolicies: true,
    };
    if (!matches) {
      const bill = e.law.bill?.[String(art)]?.headline?.exp;
      rec.programBudgetVsLaw = { prbKhil: round(t26.cons_prb!), lawKhil: lawExp, diffKhil: diff };
      if (isNumber(bill))
        Object.assign(rec.programBudgetVsLaw, {
          billKhil: bill,
          matchesBill: Math.abs(bill - t26.cons_prb!) <= 0.11,
        });
    }
    const names: Record<number, string> = {},
      isProg: Record<number, boolean> = {},
      parts: Record<string, [string, number]> = {},
      khils: Record<number, number> = {};
    for (const q of L.policies || []) {
      if (!/^\d+$/u.test(String(q.n))) continue;
      const n = Number(q.n);
      names[n] = lawPolicyName(q.name);
      isProg[n] = /^бюджетна програма/iu.test(q.name.trim());
      if (isNumber(q.khil)) khils[n] = q.khil;
      for (const p of q.parts || []) {
        const m = /^(\d+)\.(\d+)$/u.exec(String(p.n || ''));
        if (m && Number(m[1]) === n && isNumber(p.khil))
          parts[`${n}.${Number(m[2])}`] = [lawPolicyName(p.name), p.khil];
      }
    }
    rec.total = values(s.total);
    const amounts: Record<string, number> = {};
    for (const [k, , r] of s.top) {
      const c = cell(r, Y26);
      if (c) amounts[k] = c.cons_prb!;
    }
    function progName(k: string, r: Row): string {
      const [, pn, mn] = k.split('.');
      const lp = parts[`${Number(pn)}.${Number(mn)}`],
        c = cell(r, Y26);
      return lp && c && Math.abs(lp[1] - c.cons_prb!) <= 0.06 ? lp[0] : cleanName(r.name);
    }
    function policyName(k: string, r: Row): string {
      const n = Number(k.split('.')[1]),
        own = cleanName(r.name),
        c = cell(r, Y26),
        ln = names[n],
        lk = khils[n];
      if (ln && c && isNumber(lk) && Math.abs(lk - c.cons_prb!) <= 0.15) return ln;
      if (own && !suspect(own)) return own;
      if (
        ln &&
        isNumber(lk) &&
        Object.entries(amounts).some(([other, a]) => other !== k && Math.abs(lk - a) <= 0.15)
      ) {
        for (const candidate of pdf!.rowLabels[k] || []) {
          const cleaned = cleanName(candidate);
          if (cleaned && !suspect(cleaned)) return cleaned;
        }
      }
      return ln || own;
    }
    rec.policies = s.top.map(([key, originalKind, row]) => {
      const nn = key.split('.')[1]!,
        children = s.kids[nn] || [];
      const kind =
        originalKind === 'policy' && !children.length && isProg[Number(nn)]
          ? 'program'
          : originalKind;
      const p: any = { code: key, name: policyName(key, row), kind, values: values(row) };
      if (kind === 'policy' && children.length)
        p.programs = children.map(([k, r]) => ({
          code: k,
          name: progName(k, r),
          values: values(r),
        }));
      return p;
    });
    rec.policyCount = rec.policies.filter((p: any) => p.kind === 'policy').length;
    rec.programCount = rec.policies.reduce(
      (n: number, p: any) => n + (p.programs?.length || 0) + (p.kind === 'program' ? 1 : 0),
      0,
    );
    records[code] = rec;
  }
  return records;
}
