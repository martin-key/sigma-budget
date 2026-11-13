import historicalDifferences from './kfp-source-differences.json' with { type: 'json' };
import { isDeepStrictEqual } from 'node:util';
import { pythonFloat } from '../build/context.js';
import { parsePythonJson } from '../common/numbers.js';
import { Check, fmt, isnum, pyRepr, pyTruth } from './checks.js';
import { readKfpCapture, unicodeDecimal, type KfpCapture } from './kfp-capture.js';
import type { Context } from './context.js';
import { validateKfpLaw } from './kfp-law.js';
import {
  executionGet,
  executionInteger,
  executionItems,
  executionKeys,
  executionRequired,
  executionValues,
} from './execution-python.js';

const COLS = ['kfp', 'nat', 'eu'] as const;
const SUMS: Record<string, string[]> = {
  rev: ['rev.tax', 'rev.nontax', 'rev.grants'],
  exp: [
    'exp.personnel',
    'exp.maint',
    'exp.interest',
    'exp.social',
    'exp.subsidies',
    'exp.abroad',
    'exp.capex',
    'exp.reserve',
  ],
  'exp.interest': ['exp.interest.ext', 'exp.interest.dom'],
  transfers: ['transfers.cb', 'transfers.other', 'transfers.revshare'],
  'fin.ext': ['fin.ext.markets', 'fin.ext.repay', 'fin.ext.securities', 'fin.ext.deposits'],
  fin: ['fin.ext', 'fin.dom', 'fin.priv'],
};
const TOL = 0.0006;
const HEADLINES: [string, number, number[]][] = [
  ['2026', 7, [26347.4, 28548.8, -2201.4]],
  ['2026', 8, [30117.8, 33193.2, -3075.5]],
  ['2026', 9, [33898.5, 37567.6, -3669.2]],
];

/** The presence flag describes the original tree; an unreadable capture is never absence. */
export interface KfpEvidence {
  rawPresent: boolean;
  reports: Record<string, KfpCapture>;
  filesByYear: Record<string, string[]>;
}
const date = (year: string, month: number) => {
  if (!Number.isInteger(month)) throw new TypeError('month must be an integer');
  if (month < 1 || month > 12) {
    const error = new Error(`bad month number ${month}; must be 1-12`);
    error.name = 'IllegalMonthError';
    throw error;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(Number(year), month, 0)).getUTCDate()).padStart(2, '0')}`;
};
const round = (value: number, digits: number) =>
  Number(fmt(value, digits).replaceAll(' ', '').replace(',', '.'));
const wantCur = (year: string) => (Number(year) <= 2025 ? 'BGN' : 'EUR');
const norm = (value: unknown) =>
  pyStr(value)
    .replace(
      /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu,
      ' ',
    )
    .replace(/^ +| +$/g, '')
    .toLowerCase();
const pyFloat = (v: unknown): string => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return pyStr(v);
  const magnitude = Math.abs(v);
  if (magnitude !== 0 && (magnitude >= 1e16 || magnitude < 1e-4)) {
    return v
      .toExponential()
      .replace(/e([+-])(\d+)$/, (_all, sign, exponent) => `e${sign}${exponent.padStart(2, '0')}`);
  }
  return Number.isInteger(v) ? `${Object.is(v, -0) ? '-0' : v}.0` : String(v);
};
const pyStr = (v: unknown): string =>
  typeof v === 'number' && !Number.isFinite(v)
    ? Number.isNaN(v)
      ? 'nan'
      : v < 0
        ? '-inf'
        : 'inf'
    : v === null || v === undefined
      ? 'None'
      : typeof v === 'boolean'
        ? v
          ? 'True'
          : 'False'
        : String(v);
const n = (v: unknown): number => {
  if (typeof v === 'boolean') return Number(v);
  if (typeof v !== 'number') throw new TypeError(`expected number: ${pyRepr(v)}`);
  return v;
};
const val = (a: any, key: string | number): any => {
  if (a === null || a === undefined) throw new TypeError(`'NoneType' object is not subscriptable`);
  if (Array.isArray(a) && typeof key === 'number' && key < 0) key += a.length;
  if (!Object.prototype.hasOwnProperty.call(a, key)) {
    if (Array.isArray(a)) {
      const e = new Error('list index out of range');
      e.name = 'IndexError';
      throw e;
    }
    const e = new Error(pyRepr(key));
    e.name = 'KeyError';
    throw e;
  }
  return a[key];
};
const sum = (values: number[]) => values.reduce((a, b) => a + n(b), 0);
const divide = (a: number, b: number) => {
  if (b === 0) {
    const error = new Error('float division by zero');
    error.name = 'ZeroDivisionError';
    throw error;
  }
  return a / b;
};
const has = (o: any, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const tuple = (values: unknown[]) =>
  `(${values.map(pyStr).join(', ')}${values.length === 1 ? ',' : ''})`;
const tupleFloat = (values: number[]) => `(${values.map(pyFloat).join(', ')})`;
const f6 = (x: number) => fmt(x, 6).replaceAll(' ', '').replace(',', '.');
const sign1 = (x: number) =>
  `${x >= 0 ? '+' : ''}${fmt(x, 1).replaceAll(' ', '').replace(',', '.')}`;
const pyList = (x: string[]) => `[${x.map(pyRepr).join(', ')}]`;

/** Preserve the donor's float-conversion failure when the shared adapter rejects a money scalar. */
function* projectionMoney(doc: any): Generator<unknown> {
  for (const blockName of ['data', 'monthly'])
    for (const block of executionValues(executionRequired(doc, blockName)))
      for (const col of COLS)
        for (const [, arr] of executionItems(executionRequired(block, col))) yield* arr;
  for (const col of COLS) {
    for (const [, value] of executionItems(
      executionRequired(executionRequired(doc, 'plan2026'), col),
    ))
      yield value;
    for (const [, item] of executionItems(executionRequired(executionRequired(doc, 'latest'), col)))
      for (const key of ['cum', 'plan', 'prevYearCum']) if (has(item, key)) yield item[key];
  }
  for (const [key, rec] of executionItems(executionRequired(doc, 'reconcile')))
    if (rec && typeof rec === 'object' && !Array.isArray(rec) && key.startsWith('dec'))
      for (const [, item] of executionItems(rec))
        for (const field of ['kfp', 'annex3', 'diff']) yield val(item, field);
}
function executionInput(ctx: Context): any {
  try {
    return ctx.get('execution.json');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Invalid execution money') throw error;
    const doc = JSON.parse(ctx.text('execution.json'));
    if (doc?.contract?.schema !== 2) throw error;
    for (const value of projectionMoney(doc)) {
      try {
        pythonFloat(value);
      } catch (cause) {
        if (!(cause instanceof Error) || cause.message !== 'Invalid execution money') throw cause;
        const e =
          typeof value === 'string'
            ? new Error(`could not convert string to float: ${pyRepr(value)}`)
            : new Error(
                `float() argument must be a string or a real number, not '${Array.isArray(value) ? 'list' : 'dict'}'`,
              );
        e.name = typeof value === 'string' ? 'ValueError' : 'TypeError';
        throw e;
      }
    }
    throw error;
  }
}

/** Port of the independent Python validator; no extractor or builder results are used as expectations. */
export function kfp(ctx: Context, evidence: KfpEvidence): Check {
  const c = new Check('KFP');
  const near = (a: unknown, b: unknown, tol: number, message: string, textA?: string) =>
    c.ok(
      isnum(a) && isnum(b) && Math.abs(a - b) <= tol + 1e-9,
      `${message}: ${textA ?? pyFloat(a)} vs ${pyFloat(b)} (tolerance ${tol})`,
    );
  const ex = executionInput(ctx),
    outlook = ctx.get('outlook.json'),
    revenue = ctx.get('revenue.json'),
    expenditure = ctx.get('expenditure.json');
  const rawNumbers = parsePythonJson<any>(ctx.text('execution.json'));
  const rows: any[] = ex.rows,
    ids: string[] = rows.map((r) => r.id),
    rowNo: Record<string, number> = Object.create(null);
  c.ok(ids.length === new Set(ids).size, 'rows: duplicate ids');
  c.ok(
    rows.length === 33 && ids.includes('exp.total'),
    `rows: expected 32 sheet rows + the computed exp.total, got ${rows.length}`,
  );
  const rawRows = JSON.parse(ctx.text('execution.json'), ((
    key: string,
    value: unknown,
    meta: { source?: string },
  ) =>
    key === 'row' && typeof value === 'number'
      ? { value, source: meta.source }
      : value) as any).rows;
  const floatRows = new Set<string>();
  for (const [i, r] of rows.entries())
    if (has(r, 'row')) {
      rowNo[r.id] = r.row;
      floatRows.delete(r.id);
      const raw = rawRows[i]?.row;
      if (
        typeof r.row === 'number' &&
        raw?.value === r.row &&
        typeof raw.source === 'string' &&
        /[.eE]/.test(raw.source)
      )
        floatRows.add(r.id);
    }
  c.ok(
    Object.keys(rowNo).length === 32 && !has(rowNo, 'exp.total'),
    'rows: 32 rows must carry a sheet row number, exp.total none',
  );
  c.ok(
    [...Object.keys(SUMS), ...Object.values(SUMS).flat()].every((id) => ids.includes(id)),
    'rows: an accounting-identity id is missing',
  );
  c.ok(
    isDeepStrictEqual(
      ex.cols.map((x: any) => x.id),
      COLS,
    ) &&
      isDeepStrictEqual(
        ex.cols.map((x: any) => x.kfpCol),
        ['к.2', 'к.3', 'к.4'],
      ),
    'cols must be kfp/nat/eu = к.2/к.3/к.4',
  );
  const data = ex.data,
    years = executionKeys(data).sort();
  c.ok(
    isDeepStrictEqual(
      years,
      years.map((_, i) => String((years[0] === '2022' ? 2022 : 2024) + i)),
    ),
    `data years ${pyList(years)}, not consecutive from 2024`,
  );
  const maxDev: Record<string, number> = {},
    knownSeen = new Set<string>();
  let compared = 0,
    filesN = 0;
  const maximum = (key: string, dev: number) => {
    maxDev[key] = Math.max(maxDev[key] ?? 0, dev);
  };
  for (const y of years) {
    const blk = executionRequired(data, y),
      count = executionRequired(blk, 'months');
    if (y !== years.at(-1))
      c.ok(
        count === 12,
        `${y}: months ${pyStr(count)}, expected 12 (only the last year may be incomplete)`,
      );
    else c.ok(n(count) >= 1 && n(count) <= 12, `${y}: months ${pyStr(count)}, expected 1..12`);
    c.ok(
      blk.currency === wantCur(y),
      `${y}: currency ${pyStr(blk.currency)}, expected ${wantCur(y)}`,
    );
    c.ok(
      blk.asOf.length === count && blk.files.length === count,
      `${y}: asOf/files length differs from months`,
    );
    if (wantCur(y) === 'BGN')
      c.ok(blk.converted === '÷1.95583', `${y}: converted note ${pyRepr(blk.converted ?? null)}`);
    for (const col of COLS) {
      c.ok(
        isDeepStrictEqual(executionKeys(blk[col]).sort(), [...new Set(ids)].sort()),
        `${y}/${col}: row ids differ from rows[]`,
      );
      for (const [rid, arr] of executionItems(blk[col]) as [string, any[]][])
        c.ok(
          arr.length === count && arr.every(isnum),
          `${y}/${col}/${rid}: ${arr.length} values, expected ${count} numbers`,
        );
    }
    for (const [i, file] of blk.files.entries()) {
      const month = i + 1,
        ym = `${y}-${String(month).padStart(2, '0')}`;
      c.ok(file.month === month, `${y}: files[${i}].month ${pyStr(file.month)}`);
      const capture = evidence.reports[`${y}/${file.file}`];
      if (!capture) {
        if ((evidence.filesByYear[y] ?? []).includes(file.file))
          throw new Error(`missing capture for available raw report: ${y}/${file.file}`);
        if (evidence.rawPresent) c.fail(`${ym}: raw report ${file.file} missing`);
        continue;
      }
      filesN++;
      c.ok(
        capture.rawSha256 === file.sha256,
        `${ym}: sha256 of ${file.file} differs from the published one`,
      );
      const m = /EU[ _]funds_(\p{Nd}{2})(\p{Nd}{2})_/u.exec(file.file);
      c.ok(
        !!m && unicodeDecimal(m[1]!) === month && 2000 + unicodeDecimal(m[2]!) === Number(y),
        `${y}: file name ${file.file} vs month ${month}`,
      );
      const rep = readKfpCapture(capture, rowNo, floatRows);
      c.ok(
        rep.dims[0] === 54 && rep.dims[1] === 4,
        `${ym}: sheet size ${tuple(rep.dims)}, expected 54x4`,
      );
      c.ok(
        rep.year === Number(y) && rep.month === month,
        `${ym}: the sheet says ${pyStr(rep.year)}-${pyStr(rep.month)}`,
      );
      c.ok(
        rep.asOf === val(blk.asOf, i),
        `${ym}: asOf ${pyStr(val(blk.asOf, i))} vs sheet ${pyStr(rep.asOf)}`,
      );
      c.ok(
        rep.asOf === date(y, month),
        `${ym}: asOf ${pyStr(rep.asOf)} is not the last day of the month`,
      );
      c.ok(
        rep.unit === blk.currency,
        `${ym}: unit ${pyStr(rep.unit)} vs published ${pyStr(blk.currency)}`,
      );
      const raw: any = {
        kfp: Object.create(null),
        nat: Object.create(null),
        eu: Object.create(null),
      };
      let bad = false;
      for (const rid of Object.keys(rowNo)) {
        if (rid !== 'fin.priv') {
          const label = rows.find((r) => r.id === rid).label;
          const rawLabel = rep.a[rid],
            labelCell = capture.cells[(rowNo[rid]! - 1 + capture.dims[0]) % capture.dims[0]]![0]!;
          const labelIsFloat = typeof rawLabel === 'number' && [2, 3].includes(labelCell.type);
          const labelText = labelIsFloat ? pyFloat(rawLabel) : pyStr(rawLabel);
          if (!norm(labelText).includes(norm(label)))
            c.fail(
              `${ym} row ${rid}: label ${pyRepr(label)} not in the sheet cell ${labelIsFloat ? pyFloat(rawLabel) : pyRepr(rawLabel)}`,
            );
        }
        for (const [ci, col] of COLS.entries()) {
          const v = rep.cells[rid]![col],
            cell = capture.cells[(rowNo[rid]! - 1 + capture.dims[0]) % capture.dims[0]]![ci + 1]!;
          if (typeof v !== 'number' || ![2, 3].includes(cell.type)) {
            c.fail(`${ym} ${rid}/${col}: not a number: ${pyRepr(v)}`);
            bad = true;
          }
          raw[col][rid] = v;
        }
      }
      if (bad) continue;
      for (const col of COLS) {
        const rw = raw[col];
        rw['exp.total'] = n(rw.exp) + n(rw.eucontrib);
        for (const [rid, v] of Object.entries(rw)) {
          const exp = round(n(v) / (blk.currency === 'BGN' ? 1.95583 : 1), 3),
            pub = val(val(blk[col], rid), i);
          compared++;
          if (pub === null || typeof pub === 'string')
            throw new TypeError(
              `unsupported operand type(s) for -: '${pub === null ? 'NoneType' : 'str'}' and 'float'`,
            );
          if (Math.abs(n(pub) - exp) > TOL)
            c.fail(
              `${ym} ${col}/${rid}: published ${pyFloat(pub)} vs raw ${pyFloat(v)} -> ${pyFloat(exp)}`,
            );
        }
        for (const [parent, kids] of Object.entries(SUMS)) {
          const dev = Math.abs(n(rw[parent]) - sum(kids.map((k) => rw[k])));
          maximum(parent, dev);
          c.ok(
            dev <= (kids.length + 1) * 0.5e-6 + 1e-6,
            `${ym} ${col}: ${parent} differs from the sum of its parts by ${f6(dev)}`,
          );
        }
        let dev = Math.abs(
          n(rw.rev) - n(rw.exp) + n(rw.transfers) - n(rw.eucontrib) - n(rw.balance),
        );
        maximum('balance', dev);
        c.ok(
          dev <= 5 * 0.5e-6 + 1e-6,
          `${ym} ${col}: balance != rev - exp + transfers - eucontrib (${f6(dev)})`,
        );
        dev = Math.abs(n(rw.fin) + n(rw.balance));
        const historical = (
          historicalDifferences as Record<string, { differences: Record<string, number> }>
        )[file.sha256]?.differences[`fin=-balance/${['B', 'C', 'D'][COLS.indexOf(col)]}`];
        if (historical !== undefined) {
          c.ok(
            Math.abs(n(rw.fin) + n(rw.balance) - historical) <= 1e-6,
            `${ym} ${col}: registered source difference`,
          );
          knownSeen.add(`${ym} ${col} ${f6(dev)}`);
        } else if (y === '2024' && month === 5 && dev > 0.005) {
          c.ok(
            dev <= 0.0101,
            `${ym} ${col}: financing != -balance (${f6(dev)}) beyond the known source difference`,
          );
          knownSeen.add(`${ym} ${col} ${f6(dev)}`);
        } else {
          maximum('fin=-balance', dev);
          c.ok(dev <= 0.005, `${ym} ${col}: financing != -balance (${f6(dev)})`);
        }
      }
      for (const rid of Object.keys(rowNo)) {
        const dev = Math.abs(n(raw.kfp[rid]) - n(raw.nat[rid]) - n(raw.eu[rid]));
        maximum('к.2=к.3+к.4', dev);
        c.ok(dev <= 2 * 0.5e-6 + 1e-6, `${ym} ${rid}: к.2 != к.3 + к.4 (${f6(dev)})`);
      }
    }
  }
  for (const y of years) {
    const count = executionInteger(data[y].months, 'range', rawNumbers.data[y], 'months');
    for (const col of COLS) {
      const s = data[y][col];
      for (let i = 0; i < count; i++) {
        for (const [parent, kids] of Object.entries(SUMS))
          c.ok(
            Math.abs(n(val(s[parent], i)) - sum(kids.map((k) => val(s[k], i)))) <=
              (kids.length + 1) * 0.0005 + 0.00001 * kids.length + 1e-9,
            `${y} ${col} month ${i + 1}: converted ${parent} differs from its parts`,
          );
        c.ok(
          Math.abs(
            n(val(s.rev, i)) -
              n(val(s.exp, i)) +
              n(val(s.transfers, i)) -
              n(val(s.eucontrib, i)) -
              n(val(s.balance, i)),
          ) <= 0.0026,
          `${y} ${col} month ${i + 1}: converted balance identity`,
        );
        c.ok(
          Math.abs(
            n(val(s.fin, i)) +
              n(val(s.balance, i)) -
              ((historicalDifferences as Record<string, { differences: Record<string, number> }>)[
                data[y].files[i].sha256
              ]?.differences[`fin=-balance/${['B', 'C', 'D'][COLS.indexOf(col)]}`] ?? 0) /
                (data[y].currency === 'BGN' ? 1.95583 : 1),
          ) <=
            ((historicalDifferences as Record<string, unknown>)[data[y].files[i].sha256]
              ? 0.0011
              : 0.0061),
          `${y} ${col} month ${i + 1}: converted financing != -balance`,
        );
        c.ok(
          Math.abs(n(val(s['exp.total'], i)) - n(val(s.exp, i)) - n(val(s.eucontrib, i))) <= 0.0011,
          `${y} ${col} month ${i + 1}: exp.total != exp + eucontrib`,
        );
      }
    }
    for (const rid of ids)
      for (let i = 0; i < count; i++)
        c.ok(
          Math.abs(
            n(val(data[y].kfp[rid], i)) - n(val(data[y].nat[rid], i)) - n(val(data[y].eu[rid], i)),
          ) <= 0.0016,
          `${y} month ${i + 1} ${rid}: converted к.2 != к.3 + к.4`,
        );
  }
  for (const y of years)
    for (const rid of ['rev', 'exp', 'exp.total']) {
      const arr = data[y].kfp[rid];
      c.ok(
        arr.every((v: unknown, i: number) => i === 0 || n(v) > n(arr[i - 1])),
        `${y} kfp/${rid}: the cumulative series does not grow every month`,
      );
    }
  if (!years.length) {
    const error = new Error('max() iterable argument is empty');
    error.name = 'ValueError';
    throw error;
  }
  const lastY = years.at(-1)!,
    prevY = String(Number(lastY) - 1),
    lastN = n(data[lastY].months),
    kf = data[lastY].kfp;
  const head = ['rev', 'exp.total', 'balance'].map((r) => val(kf[r], lastN - 1));
  for (const [y, month, want] of HEADLINES) {
    const got = ['rev', 'exp.total', 'balance'].map((r) =>
      round(n(val(data[y].kfp[r], month - 1)), 1),
    );
    c.ok(
      isDeepStrictEqual(got, want),
      `${y}-${String(month).padStart(2, '0')} headline ${tupleFloat(got)}, expected ${tupleFloat(want)}`,
    );
  }
  c.ok(
    lastY === '2026' && lastN === 9,
    `the last report ${lastY}-${String(lastN).padStart(2, '0')} has no headline reference`,
  );
  const rawExecution = JSON.parse(ctx.text('execution.json'), ((
    key: string,
    value: unknown,
    meta: { source?: string },
  ) =>
    (key === 'yoyPct' || key === 'pctPlan') && typeof value === 'number'
      ? { value, source: meta.source }
      : value) as any);
  const scalarText = (value: unknown, raw: any) =>
    typeof value === 'number' && raw?.value === value && typeof raw.source === 'string'
      ? /[.eE]/.test(raw.source)
        ? pyFloat(value)
        : pyStr(value)
      : typeof value === 'number'
        ? pyFloat(value)
        : pyStr(value);
  const latest = ex.latest,
    plan = ex.plan2026;
  c.ok(
    latest.month === lastN && latest.asOf === data[lastY].asOf.at(-1),
    'latest: month/asOf do not point at the last report',
  );
  for (const col of COLS)
    for (const [rid, item] of executionItems(latest[col]) as [string, any][]) {
      const cum = n(val(data[lastY][col][rid], lastN - 1)),
        prev = n(val(data[prevY][col][rid], lastN - 1)),
        pv = executionGet(plan[col], rid);
      near(val(item, 'cum'), round(cum, 1), 0.0001, `latest ${col}/${rid} cum`);
      near(val(item, 'prevYearCum'), round(prev, 1), 0.0001, `latest ${col}/${rid} prevYearCum`);
      c.ok(
        has(item, 'plan') === (pv !== null),
        `latest ${col}/${rid}: plan present only where plan2026 has the row`,
      );
      if (has(item, 'plan')) near(item.plan, pv, 0.0001, `latest ${col}/${rid} plan`);
      c.ok(
        has(item, 'pctPlan') ===
          (pv !== null && n(pv) > 0 && !['balance', 'fin', 'transfers'].includes(rid)),
        `latest ${col}/${rid}: pctPlan present exactly for plan rows other than balance`,
      );
      if (has(item, 'pctPlan'))
        near(
          item.pctPlan,
          divide(100 * cum, n(pv)),
          0.0051,
          `latest ${col}/${rid} pctPlan`,
          scalarText(item.pctPlan, rawExecution.latest?.[col]?.[rid]?.pctPlan),
        );
      c.ok(
        has(item, 'yoyPct') === (prev >= 50 && cum >= 0),
        `latest ${col}/${rid}: yoyPct only on a base of 50+ млн. €`,
      );
      if (has(item, 'yoyPct'))
        near(
          item.yoyPct,
          100 * (divide(cum, prev) - 1),
          0.0501,
          `latest ${col}/${rid} yoyPct`,
          scalarText(item.yoyPct, rawExecution.latest?.[col]?.[rid]?.yoyPct),
        );
    }
  const r0 = latest.kfp.rev;
  const pct = scalarText(val(r0, 'pctPlan'), rawExecution.latest.kfp.rev.pctPlan);
  const yoyText = scalarText(val(r0, 'yoyPct'), rawExecution.latest.kfp.rev.yoyPct);
  c.fact(
    `${lastY}-${String(lastN).padStart(2, '0')} cumulative: revenue ${fmt(head[0])} · expenditure ${fmt(head[1])} · balance ${fmt(head[2])} млн. € (${pyStr(pct).replace('.', ',')} of the year's plan, +${yoyText.replace('.', ',')}% on ${prevY})`,
  );
  for (const [y, py] of executionItems(ex.pace) as [string, any][]) {
    const s = data[y].kfp;
    c.ok(data[y].months === 12, `pace: ${y} is not a complete year`);
    for (const [rid, arr] of executionItems(py) as [string, any[]][]) {
      c.ok(arr.length === 12 && arr.at(-1) === 100, `pace ${y}/${rid}: 12 values ending at 100`);
      for (let i = 0; i < 12; i++)
        near(
          val(arr, i),
          divide(100 * n(val(s[rid], i)), n(val(s[rid], 11))),
          0.0051,
          `pace ${y}/${rid} month ${i + 1}`,
        );
    }
  }
  for (const [y, my] of executionItems(ex.monthly) as [string, any][])
    for (const [col, mc] of executionItems(my) as [string, any][])
      for (const [rid, arr] of executionItems(mc) as [string, any[]][]) {
        const cum = data[y][col][rid];
        for (let i = 0; i < cum.length; i++)
          near(
            val(arr, i),
            n(cum[i]) - (i ? n(cum[i - 1]) : 0),
            TOL,
            `monthly ${y}/${col}/${rid} month ${i + 1}`,
          );
      }
  validateKfpLaw(c, ex, outlook, ctx, rawNumbers);
  const rr = Object.fromEntries(revenue.rows.map((r: any) => [r.id, r])),
    ec = Object.fromEntries(expenditure.economic.rows.map((r: any) => [r.id, r]));
  const rowval = (source: any, rid: string, i: number) => {
    const row = val(source, rid),
      j = i - (row.y0 ?? 0);
    return j >= 0 && j < row.mln.length ? row.mln[j] : null;
  };
  const bigs: Record<string, number> = {};
  for (const [key, y, ai] of [
    ['dec2024VsAnnex3', '2024', 0],
    ['dec2025VsAnnex3', '2025', 1],
  ] as const) {
    const rec = ex.reconcile[key];
    if (
      !c.ok(
        rec && typeof rec === 'object' && !Array.isArray(rec) && pyTruth(rec),
        `reconcile.${key} missing`,
      )
    )
      continue;
    for (const [rid, d] of Object.entries(rec) as [string, any][]) {
      near(val(d, 'kfp'), val(data[y].kfp[rid], 11), 0.0006, `reconcile ${y} ${rid} kfp`);
      near(
        val(d, 'diff'),
        round(n(val(d, 'kfp')) - n(val(d, 'annex3')), 1),
        0.0501,
        `reconcile ${y} ${rid} diff`,
      );
    }
    for (const [rid, srcId, source] of [
      ['rev', 'r.total', rr],
      ['exp', 'x.exp', ec],
      ['exp.total', 'x.total', ec],
      ['eucontrib', 'x.eucontrib', ec],
      ['exp.personnel', 'x.personnel', ec],
      ['exp.capex', 'x.capex', ec],
      ['rev.tax', 'r.tax', rr],
    ] as [string, string, any][])
      near(
        val(val(rec, rid), 'annex3'),
        rowval(source, srcId, ai),
        0.0001,
        `reconcile ${y} ${rid} annex3 vs the dataset row`,
      );
    near(
      val(rec.balance, 'annex3'),
      val(outlook.kfp.balance.mln, ai),
      0.0001,
      `reconcile ${y} balance annex3 vs outlook`,
    );
    bigs[y] = Math.max(...Object.values(rec).map((d: any) => Math.abs(n(val(d, 'diff')))));
  }
  const comp = ctx.get('components.json');
  if (comp !== null && comp.nationalVsEu.years[0] === 2024) {
    const nve = comp.nationalVsEu,
      d24 = data['2024'],
      parts: string[] = [];
    for (const [col, name] of [
      ['kfp', 'kfp'],
      ['nat', 'national'],
      ['eu', 'eu'],
    ]) {
      const t = nve[name!],
        diffs = [
          n(d24[col!].rev[11]) - n(t.revMln[0]),
          n(d24[col!]['exp.total'][11]) - n(t.expMln[0]),
          n(d24[col!].balance[11]) - n(t.balanceMln[0]),
        ];
      parts.push(
        `${col} rev ${sign1(diffs[0]!)} exp ${sign1(diffs[1]!)} balance ${sign1(diffs[2]!)}`,
      );
      c.ok(
        diffs.every((x) => Math.abs(x) < 100),
        `December 2024 ${col} differs from Tables II-3/II-4 by 100+ млн. € (${tupleFloat(diffs)})`,
      );
    }
    c.fact(
      'December 2024 report minus Annex 3 / Tables II-3, II-4 (2024 Отчет), млн. €: ' +
        parts.join('; '),
    );
  }
  c.fact(
    `${filesN} raw reports re-read (${compared} values compared, 3 columns); December report vs Annex 3 differs by at most ${Object.keys(
      bigs,
    )
      .sort()
      .map((y) => `${fmt(bigs[y])} млн. € (${y})`)
      .join(', ')}`,
  );
  if (knownSeen.size)
    c.fact(
      'known source differences (млн. лв., not corrected): financing vs −balance ' +
        [...knownSeen].sort().join('; '),
    );
  c.fact(
    'max deviation on the raw numbers (млн.): ' +
      Object.keys(maxDev)
        .sort()
        .map((k) => `${k} ${f6(maxDev[k]!)}`)
        .join(', '),
  );
  const pm = ex.pendingMonths;
  c.ok(
    pm.length === 1 &&
      pm[0].month === (lastN % 12) + 1 &&
      pm[0].status === 'pending' &&
      pm[0].id === 'P04',
    'pendingMonths: the next month must be the single P04 block',
  );
  if (pm.length && lastN < 12)
    c.ok(
      pm[0].asOf === date(lastY, lastN + 1),
      `pendingMonths: asOf ${pyStr(pm[0].asOf)} is not the last day of the next month`,
    );
  if (evidence.rawPresent) {
    const want = sum(years.map((y) => data[y].months));
    c.ok(filesN === want, `${filesN} of ${want} raw reports found`);
    for (const y of years) {
      const onDisk = (evidence.filesByYear[y] ?? []).filter((f) => f.endsWith('.xls')).length;
      c.ok(
        onDisk <= data[y].months,
        `${y}: ${onDisk} raw reports on disk, execution.json has ${data[y].months} (kfp_full.py not run?)`,
      );
    }
  } else if (!filesN)
    c.warn(
      'the raw monthly reports are not in the repository (data/originals, see docs/data-sources.md): the independent re-read was skipped',
    );
  return c;
}
