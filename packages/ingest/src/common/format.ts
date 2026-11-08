import { isNumber } from '../io/data.js';
const NBSP = '\u00a0',
  NNBSP = '\u202f',
  MINUS = '\u2212';
const months = [
  'януари',
  'февруари',
  'март',
  'април',
  'май',
  'юни',
  'юли',
  'август',
  'септември',
  'октомври',
  'ноември',
  'декември',
];
// Python's fixed-point formatting rounds the exact binary float to even at ties.
function fixed(value: number, places: number): string {
  if (!Number.isInteger(places) || places < 0 || places > 100) throw new Error('Invalid precision');
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0),
    exponent = Number((bits >> 52n) & 0x7ffn);
  let numerator = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const power = exponent ? exponent - 1075 : -1074;
  numerator *= 10n ** BigInt(places);
  let rounded: bigint;
  if (power >= 0) rounded = numerator << BigInt(power);
  else {
    const denominator = 1n << BigInt(-power),
      q = numerator / denominator,
      r = numerator % denominator;
    rounded = q + (r * 2n > denominator || (r * 2n === denominator && q % 2n !== 0n) ? 1n : 0n);
  }
  const digits = rounded.toString().padStart(places + 1, '0');
  return places ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits;
}
export function formatNumber(value: unknown, places = 0, sign = false): string {
  if (!isNumber(value)) return '—';
  const formatted = fixed(Math.abs(value), places),
    [integer, fraction] = formatted.split('.');
  const prefix =
    value < 0 && Number(formatted) !== 0 ? MINUS : sign && Number(formatted) !== 0 ? '+' : '';
  return (
    prefix + integer!.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP) + (fraction ? ',' + fraction : '')
  );
}
export const formatPercent = (v: unknown, places = 1, sign = false) =>
  isNumber(v) ? formatNumber(v, places, sign) + '%' : '—';
export function formatMoney(v: unknown, places?: number): string {
  if (!isNumber(v)) return '—';
  const a = Math.abs(v);
  return a >= 1000
    ? formatNumber(v / 1000, places ?? 2) + NBSP + 'млрд.' + NBSP + '€'
    : formatNumber(v, places ?? (a >= 100 ? 1 : 2)) + NBSP + 'млн.' + NBSP + '€';
}
export const formatThousands = (v: unknown, places = 1) =>
  isNumber(v) ? formatNumber(v, places) + NBSP + 'хил.' + NBSP + '€' : '—';
export const formatEuro = (v: unknown, places = 0) =>
  isNumber(v) ? formatNumber(v, places) + NBSP + '€' : '—';
export function formatDate(iso: string | null, long = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '—';
  if (!long) return `${m[3]}.${m[2]}.${m[1]}`;
  const month = months[Number(m[2]) - 1];
  if (!month) throw new Error('Invalid month');
  return `${Number(m[3])}${NBSP}${month}${NBSP}${m[1]}`;
}
export function monthName(month: number): string {
  const result = months[month - 1];
  if (!result) throw new Error('Invalid month');
  return result;
}
