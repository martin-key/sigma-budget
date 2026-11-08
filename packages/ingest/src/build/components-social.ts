import type { LawBlock } from './rates.js';
import { socialSpecs } from './components-spec.js';
import { roundForPython } from '../common/format.js';
export interface SocialRow {
  id: string;
  no: string;
  label: string;
  khil: number;
}
export interface PensionFund {
  revAndTransfersKhil: number;
  expAndTransfersKhil: number;
  balanceKhil: number;
  sourceNote: string;
}
export interface DooBudget {
  revAndTransfersKhil: number;
  expAndTransfersKhil: number;
  balanceKhil: number;
  ownRevKhil: number;
  transfersFromCentralKhil: number;
  rev: SocialRow[];
  exp: SocialRow[];
  pensionsSplit: SocialRow[];
  pensionFund: PensionFund;
}
export interface NzokBudget {
  revAndTransfersKhil: number;
  expAndTransfersKhil: number;
  balanceKhil: number;
  ownRevKhil: number;
  transfersFromStateKhil: number;
  contributionRatePct: number;
  rev: SocialRow[];
  exp: SocialRow[];
  paymentsSplit: SocialRow[];
}
type Table = Record<string, [string, number]>;
const ws = (s: string) => (s ?? '').replace(/\s+/gu, ' ').trim();
const fold = (s: string) =>
  ws(s)
    .split(' ')
    .map((t) =>
      /[Ѐ-ӿ]/u.test(t)
        ? t.replace(
            /[ABCEHKMOPTXaceopxyk]/gu,
            (c) =>
              (
                ({
                  A: 'А',
                  B: 'В',
                  C: 'С',
                  E: 'Е',
                  H: 'Н',
                  K: 'К',
                  M: 'М',
                  O: 'О',
                  P: 'Р',
                  T: 'Т',
                  X: 'Х',
                  a: 'а',
                  c: 'с',
                  e: 'е',
                  k: 'к',
                  o: 'о',
                  p: 'р',
                  x: 'х',
                  y: 'у',
                }) as Record<string, string>
              )[c] ?? c,
          )
        : t,
    )
    .join(' ');
function bgnum(s: string): number | null {
  const t = ws(s).replace(/ /gu, '').replace(/[−–—]/gu, '-');
  return /^-?\d+(?:,\d+)?$/u.test(t) ? Number(t.replace(',', '.')) : null;
}
function article(blocks: LawBlock[], n: number): Table[] {
  const articleNo = (b: LawBlock) =>
    b[0] === 'p' ? Number(/^Чл\.\s*(\d+)\./u.exec(b[1])?.[1]) : NaN;
  const start = blocks.findIndex((b) => articleNo(b) === n),
    end = blocks.findIndex((b, i) => i > start && articleNo(b) === n + 1);
  if (start < 0 || end < 0) throw new Error(`components: art. ${n} not found`);
  return blocks.slice(start, end).flatMap((b) => {
    if (b[0] !== 't') return [];
    const t: Table = {};
    for (const row of b[1]) {
      const cells = row.map(ws),
        val = bgnum(cells.at(-1) ?? '');
      if (val === null) continue;
      if (cells.length >= 3) t[cells[0]!.replace(/\.+$/u, '')] = [cells[1]!, val];
      else if (cells.length === 2) t['#'] = [cells[0]!, val];
    }
    return Object.keys(t).length ? [t] : [];
  });
}
function rows(
  t: Table,
  specs: readonly (readonly [string, string, string, string])[],
): SocialRow[] {
  return specs.map(([id, no, must, label]) => {
    const row = t[no];
    if (!row || !fold(row[0]).toLowerCase().includes(fold(must).toLowerCase()))
      throw new Error(`components: missing or unexpected law row ${no}`);
    return { id, no, label, khil: row[1] };
  });
}
function val(t: Table, no: string): number {
  const v = t[no];
  if (!v) throw new Error(`components: missing law row ${no}`);
  return v[1];
}
function same(label: string, a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 0.051)
    throw new Error(`components: ${label} differs`);
}
const sum = (r: SocialRow[]) => r.reduce((a, b) => a + b.khil, 0);
const rnd = (v: number) => roundForPython(v, 1);
export function transformDoo(blocks: LawBlock[]): DooBudget {
  const tables = article(blocks, 1);
  if (tables.length !== 3)
    throw new Error('components: expected exactly three ДОО tables in article 1');
  const [rev, exp, bal] = tables,
    [pr, pe, pb] = article(blocks, 2);
  if (!rev || !exp || !bal || !pr || !pe || !pb) throw new Error('components: missing ДОО tables');
  const r = rows(rev, socialSpecs.doo_r),
    e = rows(exp, socialSpecs.doo_e),
    pens = rows(exp, socialSpecs.doo_pens),
    total = val(rev, 'I');
  same('ДОО revenue and expenditure', total, val(exp, 'I'));
  same('ДОО revenue rows', sum(r), total);
  same('ДОО expenditure 1 + 2', val(exp, '1') + val(exp, '2'), total);
  same('ДОО expenditure rows', sum(e.slice(0, 4)), val(exp, '1'));
  same('ДОО pensions', sum(pens), val(exp, '1.1'));
  same('ДОО deficit', val(bal, '#'), 0);
  const pensionFund = {
    revAndTransfersKhil: val(pr, 'I'),
    expAndTransfersKhil: val(pe, 'I'),
    balanceKhil: val(pb, '#'),
    sourceNote: 'ЗБДОО 2026, чл. 2 (бюджетът на фонд „Пенсии“)',
  };
  same(
    'pension fund balance',
    pensionFund.revAndTransfersKhil - pensionFund.expAndTransfersKhil,
    pensionFund.balanceKhil,
  );
  const central = r[3]!.khil + r[4]!.khil;
  return {
    revAndTransfersKhil: total,
    expAndTransfersKhil: val(exp, 'I'),
    balanceKhil: val(bal, '#'),
    ownRevKhil: rnd(total - central),
    transfersFromCentralKhil: rnd(central),
    rev: r,
    exp: e,
    pensionsSplit: pens,
    pensionFund,
  };
}
export function transformNzok(blocks: LawBlock[]): NzokBudget {
  const [rev, exp] = article(blocks, 1);
  if (!rev || !exp) throw new Error('components: missing НЗОК tables');
  const r = rows(rev, socialSpecs.nzok_r),
    e = rows(exp, socialSpecs.nzok_e),
    pay = rows(exp, socialSpecs.nzok_pay),
    total = val(rev, rev.I ? 'I' : 'II');
  same('НЗОК revenue and expenditure', total, val(exp, 'II'));
  same('НЗОК revenue rows', sum(r), total);
  same('НЗОК expenditure 1', val(exp, '1.1') + val(exp, '1.2') + val(exp, '1.3'), val(exp, '1'));
  same('НЗОК expenditure total', val(exp, '1'), val(exp, 'II'));
  same('НЗОК current expenditure', sum(e.slice(0, 4)), val(exp, '1.1'));
  same('НЗОК payments', sum(pay), val(exp, '1.1.3'));
  const state = r[1]!.khil + r[3]!.khil;
  return {
    revAndTransfersKhil: total,
    expAndTransfersKhil: val(exp, 'II'),
    balanceKhil: rnd(total - val(exp, 'II')),
    ownRevKhil: rnd(total - state),
    transfersFromStateKhil: rnd(state),
    contributionRatePct: 8,
    rev: r,
    exp: e,
    paymentsSplit: pay,
  };
}
