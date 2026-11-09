/** Full xlrd sheet captures are independent evidence, not extractor output. */
export interface KfpCell {
  type: number;
  value: string | number | boolean | null;
}
export interface KfpCapture {
  filename: string;
  rawSha256: string;
  readFailure?: unknown;
  sheet: string;
  dims: [number, number];
  cells: KfpCell[][];
}
export interface KfpReport {
  dims: [number, number];
  unit: 'BGN' | 'EUR' | null;
  cells: Record<string, Record<'kfp' | 'nat' | 'eu', KfpCell['value']>>;
  a: Record<string, KfpCell['value']>;
  asOf: string | null;
  year: number | null;
  month: number | null;
}

export const unicodeDecimal = (s: string): number =>
  Number(
    [...s]
      .map((ch) => {
        let start = ch.codePointAt(0)!;
        while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
        return (ch.codePointAt(0)! - start) % 10;
      })
      .join(''),
  );

/** Re-evaluate the donor's row selection against a frozen grid, including changed row maps. */
export function readKfpCapture(
  capture: KfpCapture,
  rows: Record<string, number>,
  floatRows: ReadonlySet<string> = new Set(),
): KfpReport {
  if (capture.readFailure != null) throw new Error('capture records a read failure');
  if (capture.sheet !== 'стартова') throw new Error('missing sheet: стартова');
  const [height, width] = capture.dims;
  if (
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(width) ||
    height < 0 ||
    width < 0 ||
    capture.cells.length !== height ||
    capture.cells.some((row) => row.length !== width)
  )
    throw new Error('invalid capture dimensions');
  const cell = (r: number, c: number): KfpCell => {
    if (!Number.isSafeInteger(r) || !Number.isSafeInteger(c))
      throw new TypeError('list indices must be integers or slices, not float');
    if (r < 0) r += height;
    if (c < 0) c += width;
    if (r < 0 || r >= height || c < 0 || c >= width) {
      const error = new Error('list index out of range');
      error.name = 'IndexError';
      throw error;
    }
    const result = capture.cells[r]![c];
    if (!result || !Number.isSafeInteger(result.type) || !('value' in result))
      throw new Error('invalid captured cell');
    return result;
  };
  const pyText = (c: KfpCell): string => {
    const v = c.value;
    if (v === null) return 'None';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'number' && [2, 3].includes(c.type) && Number.isInteger(v))
      return `${Object.is(v, -0) ? '-0' : v}.0`;
    return String(v);
  };
  const whitespace =
    '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const date = pyText(cell(2, 0)).match(
    new RegExp(
      `КЪМ${whitespace}+(\\p{Nd}{2})\\.(\\p{Nd}{2})\\.(\\p{Nd}{4})${whitespace}+ГОДИНА`,
      'u',
    ),
  );
  const unit = pyText(cell(3, 3))
    .replace(new RegExp(`${whitespace}+`, 'gu'), ' ')
    .replace(/^ +| +$/g, '')
    .toLowerCase();
  const result: KfpReport = {
    dims: [height, width],
    unit: unit.includes('млн.лв') ? 'BGN' : unit.includes('млн.евро') ? 'EUR' : null,
    cells: Object.create(null),
    a: Object.create(null),
    asOf: null,
    year: null,
    month: null,
  };
  if (date) {
    result.year = unicodeDecimal(date[3]!);
    result.month = unicodeDecimal(date[2]!);
    result.asOf = `${date[3]}-${date[2]}-${date[1]}`;
  }
  for (const [id, row] of Object.entries(rows)) {
    if (floatRows.has(id))
      throw new TypeError('list indices must be integers or slices, not float');
    if (typeof row !== 'number' && typeof row !== 'boolean') {
      const typ =
        row === null
          ? 'NoneType'
          : typeof row === 'string'
            ? 'str'
            : Array.isArray(row)
              ? 'list'
              : 'dict';
      throw new TypeError(`unsupported operand type(s) for -: '${typ}' and 'int'`);
    }
    result.a[id] = cell(Number(row) - 1, 0).value;
    result.cells[id] = {
      kfp: cell(Number(row) - 1, 1).value,
      nat: cell(Number(row) - 1, 2).value,
      eu: cell(Number(row) - 1, 3).value,
    };
  }
  return result;
}
