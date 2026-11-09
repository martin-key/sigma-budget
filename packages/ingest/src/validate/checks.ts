import { gzip } from 'pako';

function pyTruth(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === '')
    return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}
function pyString(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number' && !Number.isFinite(value))
    return Number.isNaN(value) ? 'nan' : value < 0 ? '-inf' : 'inf';
  return String(value);
}

/** Python-style repr for diagnostic values. */
export function pyRepr(value: unknown): string {
  if (typeof value === 'string') {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    let result = quote;
    for (const ch of value) {
      const code = ch.codePointAt(0)!;
      if (ch === quote || ch === '\\') result += '\\' + ch;
      else if (ch === '\n') result += '\\n';
      else if (ch === '\r') result += '\\r';
      else if (ch === '\t') result += '\\t';
      else if (code < 32 || code === 127) result += `\\x${code.toString(16).padStart(2, '0')}`;
      else result += ch;
    }
    return result + quote;
  }
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`)
      .join(', ')}}`;
  return pyString(value);
}

/** Individual validation group results, retaining counts and diagnostics separately. */
export class Check {
  readonly problems: string[] = [];
  readonly warnings: string[] = [];
  readonly facts: string[] = [];
  n = 0;
  constructor(readonly name: string) {}
  ok(condition: unknown, message: string): boolean {
    this.n++;
    const good = pyTruth(condition);
    if (!good) this.problems.push(message);
    return good;
  }
  fail(message: string): void {
    this.n++;
    this.problems.push(message);
  }
  warn(message: string): void {
    this.warnings.push(message);
  }
  fact(message: string): void {
    this.facts.push(message);
  }
  near(a: unknown, b: unknown, tolerance: number, message: string): boolean {
    return this.ok(
      isnum(a) && isnum(b) && Math.abs(a - b) <= tolerance + 1e-9,
      `${message}: ${pyString(a)} vs ${pyString(b)} (tolerance ${pyString(tolerance)})`,
    );
  }
}
export function isnum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
export function* walk(value: unknown, path = '$'): Generator<[string, unknown]> {
  yield [path, value];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* walk(value[i], `${path}[${i}]`);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) yield* walk(child, `${path}.${key}`);
  }
}
export function pattern(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}
export function numbersIn(value: unknown): number {
  let count = 0;
  for (const [, item] of walk(value)) if (isnum(item)) count++;
  return count;
}
export function total(values: unknown[]): number {
  return values.reduce<number>((sum, value) => sum + (isnum(value) ? value : 0), 0);
}

export function byId(rows: unknown[], key = 'id'): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const row of rows)
    if (row && typeof row === 'object' && !Array.isArray(row) && key in row)
      out[String((row as Record<string, unknown>)[key])] = row;
  return out;
}
/** Python's fixed-point formatting rounds the binary float to nearest, ties to even. */
function fixed(value: number, digits: number): string {
  if (!Number.isSafeInteger(digits) || digits < 0 || digits > 100)
    throw new RangeError('Invalid precision');
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0),
    exponent = Number((bits >> 52n) & 0x7ffn),
    fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponent === 0 ? fraction : fraction + (1n << 52n),
    shift = (exponent === 0 ? -1022 : exponent - 1023) - 52;
  let numerator = mantissa * 10n ** BigInt(digits),
    denominator = 1n;
  if (shift >= 0) numerator <<= BigInt(shift);
  else denominator <<= BigInt(-shift);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && rounded % 2n === 1n))
    rounded++;
  const s = rounded.toString().padStart(digits + 1, '0'),
    sign = value < 0 || Object.is(value, -0) ? '-' : '';
  return sign + (digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s);
}
export function fmt(value: unknown, digits = 1): string {
  if (!isnum(value))
    return value === null
      ? 'None'
      : typeof value === 'boolean'
        ? value
          ? 'True'
          : 'False'
        : String(value);
  const [integer, decimal] = fixed(value, digits).split('.');
  const sign = integer!.startsWith('-') ? '-' : '',
    unsigned = sign ? integer!.slice(1) : integer!;
  return (
    sign +
    unsigned.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') +
    (decimal === undefined ? '' : ',' + decimal)
  );
}

/** Python's gzip size contract uses standard zlib, independent of Node's zlib-ng. */
export function gzipSize(raw: Uint8Array): number {
  return gzip(raw, { level: 9 }).length;
}
