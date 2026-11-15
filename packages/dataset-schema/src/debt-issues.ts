import { record, metaGuard, array, string, number, shape } from './guards.js';
export function validDebtIsin(s: string): boolean {
  if (!/^(BG|XS)[A-Z0-9]{9}\d$/.test(s)) return false;
  const ds = [...s].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
  return (
    [...ds].reverse().reduce((n, c, i) => {
      const v = Number(c) * (i % 2 ? 2 : 1);
      return n + Math.floor(v / 10) + (v % 10);
    }, 0) %
      10 ===
    0
  );
}
const positive = (v: unknown): v is number => number(v) && Number.isSafeInteger(v) && v > 0;
const iso = (v: unknown): v is string =>
  string(v) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const currency = (v: unknown): v is string => v === 'EUR' || v === 'USD';
const issue = shape({ currency, maturity: iso, issueDate: iso, nominal: positive });
const domestic = shape({
  isin: string,
  originalMaturity: string,
  coupon: number,
  price: number,
  coverage: number,
  yield: number,
  offered: positive,
  bids: positive,
});
const auction = shape({
  isin: string,
  date: iso,
  settlement: iso,
  issueDate: iso,
  maturity: iso,
  coupon: number,
  price: number,
  yield: number,
  coverage: number,
  offered: positive,
  bids: positive,
  approved: positive,
});
export function debtIssuesGuard(v: unknown): v is Record<string, import('./guards.js').Json> {
  if (
    !record(v) ||
    !metaGuard(v.meta) ||
    v.meta.id !== 'D38' ||
    v.meta.asOf !== '2026-09-30' ||
    v.meta.status !== 'real' ||
    v.meta.mock !== false ||
    v.schema !== 'debt-issues/1' ||
    !string(v.sourceSha256) ||
    !/^[a-f0-9]{64}$/.test(v.sourceSha256) ||
    v.sourceUrl !== 'https://www.minfin.bg/upload/65462/Bulletin_GovDebt_09-2026_bg.pdf'
  )
    return false;
  if (
    !array(v.domestic) ||
    v.domestic.length !== 13 ||
    !v.domestic.every(
      (r) => issue(r) && domestic(r) && r.currency === 'EUR' && r.maturity > r.issueDate,
    )
  )
    return false;
  if (
    !array(v.external) ||
    v.external.length !== 17 ||
    !v.external.every(
      (r) =>
        issue(r) &&
        r.maturity > r.issueDate &&
        array(r.isins) &&
        r.isins.length > 0 &&
        r.isins.every(string),
    )
  )
    return false;
  if (
    !array(v.auctions) ||
    v.auctions.length !== 12 ||
    !v.auctions.every(
      (r) =>
        auction(r) && validDebtIsin(r.isin) && r.maturity > r.issueDate && r.approved <= r.offered,
    )
  )
    return false;
  const ids = [
    ...v.domestic.flatMap((r) => (record(r) ? [r.isin as string] : [])),
    ...v.external.flatMap((r) => (record(r) ? (r.isins as string[]) : [])),
  ];
  if (!ids.every(validDebtIsin) || new Set(ids).size !== 31 || ids.length !== 31) return false;
  if (new Set(v.auctions.map((r) => (record(r) ? r.date + '/' + r.isin : ''))).size !== 12)
    return false;
  if (
    !array(v.maturity) ||
    v.maturity.length !== 4 ||
    !v.maturity.every(
      (r, i) =>
        shape({ label: string, residualTenths: positive })(r) &&
        r.residualTenths <= 1000 &&
        (i === 0
          ? !Object.hasOwn(r, 'originalTenths')
          : positive(r.originalTenths) && r.originalTenths <= 1000),
    )
  )
    return false;
  return (
    shape({ domestic: positive, external: positive })(v.stock) &&
    record(v.differences) &&
    Object.values(v.differences).every(number) &&
    array(v.limitations) &&
    v.limitations.every(string) &&
    array(v.validation) &&
    v.validation.length === 2 &&
    v.validation.every(
      shape({
        check: string,
        outcome: (x: unknown): x is string => x === 'неизпълнимо',
        reason: string,
      }),
    )
  );
}
