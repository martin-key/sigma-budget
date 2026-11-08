import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadAnnex, checkAnnexSums, type AnnexTables } from '../build/annex.js';
import { BuildContext, executionNumbers, pythonFloat } from '../build/context.js';
import { parseYaml, registries, registryInputs } from '../io/registry.js';
import {
  clean,
  jsonStringify,
  writeJson,
  sha256File,
  readPinned,
  jsonstatCells,
  jsonstatSeries,
  parseJsonStat,
  readJsonStat,
} from '../io/data.js';
import {
  formatNumber,
  formatPercent,
  formatMoney,
  formatThousands,
  formatEuro,
  formatDate,
  monthName,
} from './format.js';
import { sources, pendingDefinitions, pendingForExecution, pendingBlock } from './sources.js';
import { metadata, span } from './metadata.js';
import { compare, type Difference } from '../parity/compare.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixtures = join(root, 'packages/ingest/test/fixtures/common');
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const fixture = (p: string) => load(join(fixtures, p));
// The inputs the oracle was generated from, frozen so data changes do not move the expectations.
const inputs = join(fixtures, 'inputs');
const execution = () => load(join(inputs, 'execution.json'));
const diffs: Difference[] = [];
const checked = new Set<string>();
const expectedComparisons = [
  'annex.json',
  'registries.json',
  'source-map.json',
  'metadata.json',
  'execution-numbers.json',
  'source-definitions.json',
  'format.json',
  'context-annex.json',
  'context-execution.json',
  'jsonstat.json',
  'context-loaders.json',
  'yaml-scalars.json',
  'money-cases.json',
  'sparse-jsonstat.json',
  'annex-cases.json',
];
function parity(name: string, expected: unknown, actual: unknown) {
  const result = compare(expected, actual, { dataset: 'common', file: name });
  checked.add(name);
  diffs.push(...result);
  expect(result).toEqual([]);
}

describe('common Python parity', () => {
  it('uses the pinned annex evidence and reproduces tree, values and checks', () => {
    const provenance = fixture('provenance.json');
    expect(
      createHash('sha256')
        .update(readFileSync(join(fixtures, 'asbp-tables.json')))
        .digest('hex'),
    ).toBe(provenance.fixtureSha256);
    const annex = loadAnnex(fixture('asbp-tables.json').tables);
    parity('annex.json', fixture('annex.json'), { annex, problems: checkAnnexSums(annex) });
    const changed = structuredClone(annex);
    changed.mln['r.total']![0]! += 10;
    expect(checkAnnexSums(changed)).toContainEqual(expect.stringContaining('r.total 2024'));
    const invalid: AnnexTables = structuredClone(fixture('asbp-tables.json').tables);
    invalid.annex3_mln.rows[0]!.label = 'changed';
    expect(() => loadAnnex(invalid)).toThrow('label mismatch');
    invalid.annex3_mln.rows[0]!.label = fixture('asbp-tables.json').tables.annex3_mln.rows[0].label;
    invalid.annex3_pct_gdp.rows = invalid.annex3_pct_gdp.rows.filter(
      (row) => row.label.replaceAll(' ', '') !== 'БВП',
    );
    expect(() => loadAnnex(invalid)).toThrow('layout changed');
  });
  it('rejects missing identity operands and short series like Python while allowing null children', () => {
    const base = fixture('annex.json').annex;
    const results = fixture('annex-cases.json').map((test: any) => {
      const mutated = structuredClone(base);
      mutated.mln[test.id] = test.values;
      try {
        return { name: test.name, ok: true, value: checkAnnexSums(mutated) };
      } catch {
        return { name: test.name, ok: false };
      }
    });
    const expected = fixture('annex-cases.json').map((test: any) => ({
      name: test.name,
      ok: test.expected.ok,
      ...(test.expected.ok ? { value: test.expected.value } : {}),
    }));
    parity('annex-cases.json', expected, results);
  });
  it('resolves YAML scalars against PyYAML 1.1', () => {
    const cases = fixture('yaml-scalars.json');
    parity(
      'yaml-scalars.json',
      cases.map((c: any) => c.expected),
      cases.map((c: any) => (parseYaml('x: ' + c.text) as any).x),
    );
    expect(() => parseYaml('x: 1e3\nx: 2')).toThrow('Duplicate YAML key');
  });
  it('converts money exactly like the Python numeric adapter', () => {
    const cases = fixture('money-cases.json');
    const document = execution();
    const rowKey = Object.keys(document.data['2026'].kfp)[0]!;
    const convert = (value: unknown): number | null => {
      const input = structuredClone(document);
      input.data['2026'].kfp[rowKey][0] = value;
      return executionNumbers(input).data['2026'].kfp[rowKey][0];
    };
    const result = (fn: () => number | null) => {
      try {
        const v = fn();
        return {
          ok: true,
          value:
            typeof v === 'number' && !Number.isFinite(v)
              ? Number.isNaN(v)
                ? 'nan'
                : v < 0
                  ? '-inf'
                  : 'inf'
              : v,
        };
      } catch {
        return { ok: false };
      }
    };
    const expected = cases.map((c: any) => (c.expected.ok ? c.expected : { ok: false }));
    parity(
      'money-cases.json',
      expected,
      cases.map((c: any) => result(() => convert(c.input))),
    );
    expect(cases.map((c: any) => result(() => pythonFloat(c.input)))).toEqual(expected);
  });
  it('reads both registries with Python scalar semantics', () => {
    const parsed = ['sources', 'datasets'].map((n) =>
      parseYaml(readFileSync(join(inputs, `${n}.yaml`), 'utf8')),
    );
    parity('registries.json', fixture('registries.json'), parsed);
    const [s, d] = registries(parsed[0]!, parsed[1]!);
    expect(s.sources.length).toBeGreaterThan(0);
    expect(d.datasets.length).toBeGreaterThan(0);
  });
  it('maps files, shared inputs, skipped and missing sources like Python', () => {
    const base = join(fixtures, 'source-map');
    const [s, d] = registries(
      parseYaml(readFileSync(join(base, 'data-sources.yaml'), 'utf8')),
      parseYaml(readFileSync(join(base, 'data-datasets.yaml'), 'utf8')),
    );
    parity('source-map.json', fixture('source-map.json'), registryInputs(s, d, base));
  });
  it('reproduces metadata and the execution/2 numeric adapter', () => {
    parity('metadata.json', fixture('metadata.json'), [
      metadata('id', 'Заглавие', '2026-11-08'),
      metadata('x', 'title', '2026-11-08', {
        status: 'mock',
        source: ['asbp'],
        sourceNote: 'note',
        asOf: '2026-01-02',
        unit: '€',
        extra: { custom: 3 },
      }),
    ]);
    const input = execution();
    parity('execution-numbers.json', fixture('execution-numbers.json'), executionNumbers(input));
    expect((Object.values(input.data['2026'].kfp)[0] as unknown[])[0]).toEqual(expect.any(String));
    const old = { contract: { schema: 1 } };
    expect(executionNumbers(old)).toBe(old);
  });
  it('preserves source and pending maps against Python', () => {
    const pending = structuredClone(pendingDefinitions);
    pendingForExecution(pending, execution());
    parity('source-definitions.json', fixture('source-definitions.json'), {
      sources,
      pending,
      block: pendingBlock(pending, 'P04', { note: 'test' }),
    });
    expect(() => pendingBlock(pending, 'missing')).toThrow();
  });
  it('formats shared display values against Python', () => {
    parity('format.json', fixture('format.json'), {
      number: [1234.56, -0.001, -42.5, null].map((v) => formatNumber(v, 2, true)),
      ties: [2.5, 3.5, -2.5].map((v) => formatNumber(v)),
      percent: formatPercent(12.3),
      money: [1234.5, 100, 12.3, null].map((v) => formatMoney(v)),
      thousands: formatThousands(4567),
      euro: formatEuro(4567),
      dates: [formatDate('2026-11-08'), formatDate('2026-11-08', true), formatDate(null)],
      month: monthName(8),
    });
  });
  it('reads isolated roots lazily and memoizes inputs and build outputs', () => {
    const temp = mkdtempSync(join(tmpdir(), 'budget-common-'));
    try {
      for (const dir of [
        'inputs',
        'originals/asbp',
        'cache/research/mf-umtbf-2026-2028/extracts',
        'release',
      ])
        mkdirSync(join(temp, dir), { recursive: true });
      const inputs = fixture('context-inputs.json');
      const files: Record<string, unknown> = {
        'inputs/example.json': inputs.src,
        'originals/raw.json': inputs.raw,
        'cache/cache.json': inputs.cache,
        'cache/law_bill.json': inputs.law,
        'cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json': inputs.pages,
        'originals/asbp/asbp_tables.json': fixture('asbp-tables.json'),
        'release/execution.json': execution(),
      };
      for (const [file, value] of Object.entries(files))
        writeFileSync(join(temp, file), JSON.stringify(value));
      const ctx = new BuildContext({
        inputs: join(temp, 'inputs'),
        originals: join(temp, 'originals'),
        cache: join(temp, 'cache'),
        release: join(temp, 'release'),
      });
      const loaded = {
        src: ctx.src('example'),
        raw: ctx.raw('raw.json'),
        cache: ctx.cache('cache.json'),
        law: ctx.law,
        pdfPages: ctx.pdfPages,
        docxCheck: ctx.docxCheck,
        gdp: ctx.gdp,
        gdpTies: undefined as unknown,
      };
      const tieTables = structuredClone(fixture('asbp-tables.json'));
      const gdpRow = tieTables.tables.annex3_pct_gdp.rows.find(
        (r: any) => r.label.replaceAll(' ', '') === 'БВП',
      );
      gdpRow.values = [-2.5, -1.5, 0.5, 1.5, 2.5];
      writeFileSync(join(temp, 'originals/asbp/asbp_tables.json'), JSON.stringify(tieTables));
      const tieCtx = new BuildContext(ctx.paths);
      loaded.gdpTies = tieCtx.gdp;
      writeFileSync(
        join(temp, 'originals/asbp/asbp_tables.json'),
        JSON.stringify(files['originals/asbp/asbp_tables.json']),
      );
      parity('context-loaders.json', fixture('context-loaders.json'), loaded);
      for (const [file, getter, original] of [
        ['originals/raw.json', () => ctx.raw('raw.json'), loaded.raw],
        ['cache/cache.json', () => ctx.cache('cache.json'), loaded.cache],
        ['cache/law_bill.json', () => ctx.law, loaded.law],
        [
          'cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
          () => ctx.pdfPages,
          loaded.pdfPages,
        ],
        ['originals/asbp/asbp_tables.json', () => ctx.docxCheck, loaded.docxCheck],
      ] as [string, () => unknown, unknown][]) {
        writeFileSync(join(temp, file), '{"changed":true}');
        expect(getter()).toBe(original);
        rmSync(join(temp, file));
        expect(() => {
          const fresh = new BuildContext(ctx.paths);
          if (file === 'originals/raw.json') fresh.raw('raw.json');
          else if (file === 'cache/cache.json') fresh.cache('cache.json');
          else if (file === 'cache/law_bill.json') fresh.law;
          else if (file.startsWith('cache/research')) fresh.pdfPages;
          else fresh.docxCheck;
        }).toThrow();
        writeFileSync(join(temp, file), JSON.stringify(files[file]));
      }
      const first = ctx.src('example');
      writeFileSync(join(temp, 'inputs/example.json'), '{"value":2}');
      expect(ctx.src('example')).toBe(first);
      parity('context-annex.json', fixture('annex.json').annex, ctx.annex);
      parity('context-execution.json', fixture('execution-numbers.json'), ctx.execution);
      expect(ctx.gdp.mlnPrecise).toEqual(ctx.annex.gdp);
      const missing = new BuildContext({
        inputs: join(temp, 'missing-inputs'),
        originals: join(temp, 'missing-originals'),
        cache: join(temp, 'missing-cache'),
        release: join(temp, 'missing-release'),
      });
      for (const read of [
        () => missing.src('absent'),
        () => missing.raw('absent'),
        () => missing.cache('absent'),
        () => missing.law,
        () => missing.pdfPages,
        () => missing.docxCheck,
        () => missing.tables,
        () => missing.annex,
        () => missing.execution,
      ])
        expect(read).toThrow();
      expect(ctx.cacheExists('absent')).toBe(false);
      expect(() => ctx.cache('absent')).toThrow();
      expect(ctx.put('x.json', { a: 1 })).toEqual({ a: 1 });
      expect(ctx.get('x.json')).toEqual({ a: 1 });
      expect(ctx.get('missing')).toBeNull();
      expect(ctx.putText('feed.xml', 'text')).toBe('text');
      expect(ctx.texts['feed.xml']).toBe('text');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it('rejects duplicate keys, ambiguous scalars, invalid registries and malformed series', () => {
    for (const input of [
      'x: 1\nx: 2',
      'x: .nan',
      'x: .inf',
      'x: 99999999999999999999999',
      '1: value',
      'x: 2026-11-08',
      'x: &a [1]\ny: *a',
      'x: !unknown scalar',
    ])
      expect(() => parseYaml(input)).toThrow();
    expect(() =>
      registries(
        parseYaml('schema: 1\nsources: [{id: x, acquisition: auto}, {id: x, acquisition: auto}]'),
        parseYaml('schema: 1\ndatasets: []'),
      ),
    ).toThrow();
    expect(span([null, 1, 2, null])).toEqual([1, [1, 2]]);
    expect(span([null, null])).toEqual([0, []]);
    expect(() => span([1, null, 2])).toThrow();
  });
  it('handles strict JSON, deterministic writes and JSON-stat dimensions', async () => {
    expect(clean({ x: -0 })).toEqual({ x: 0 });
    expect(() => jsonStringify({ a: [Infinity] })).toThrow('$.a[0]');
    const temp = mkdtempSync(join(tmpdir(), 'budget-io-'));
    try {
      const path = join(temp, 'nested/test.json');
      expect(await writeJson(path, { text: 'Бюджет' })).toEqual({
        bytes: Buffer.byteLength('{"text":"Бюджет"}\n'),
        changed: true,
      });
      const mtime = statSync(path).mtimeMs;
      expect((await writeJson(path, { text: 'Бюджет' })).changed).toBe(false);
      expect(statSync(path).mtimeMs).toBe(mtime);
      expect(await readPinned(path, await sha256File(path))).toEqual(readFileSync(path));
      await expect(readPinned(path, '0'.repeat(64))).rejects.toThrow('hash mismatch');
      expect(await sha256File(path)).toBe(
        createHash('sha256').update(readFileSync(path)).digest('hex'),
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
    const js = {
      id: ['geo', 'time'],
      size: [2, 2],
      dimension: {
        geo: { category: { index: { BG: 0, EU: 1 } } },
        time: { category: { index: ['2024', '2025'] } },
      },
      value: [1, null, 3, 4],
      status: { '2': 'p' },
    };
    parity('jsonstat.json', fixture('jsonstat.json'), {
      cells: jsonstatCells(js),
      series: jsonstatSeries(js, 'time', { geo: 'EU' }),
    });
  });
  it('preserves sparse JSON-stat source order', async () => {
    const f = fixture('sparse-jsonstat.json');
    const parsed = parseJsonStat(f.text);
    parity(
      'sparse-jsonstat.json',
      { cells: f.cells, series: f.series },
      { cells: jsonstatCells(parsed), series: jsonstatSeries(parsed) },
    );
    expect(() => jsonstatCells(JSON.parse(f.text))).toThrow('preserve source order');
    const temp = mkdtempSync(join(tmpdir(), 'budget-jsonstat-'));
    try {
      const file = join(temp, 'sparse.json');
      writeFileSync(file, f.text);
      expect(jsonstatCells(await readJsonStat(file))).toEqual(f.cells);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  afterAll(() => {
    const report = process.env.COMMON_PARITY_REPORT;
    if (!report) return;
    const unverified = expectedComparisons.filter((name) => !checked.has(name));
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(
      report,
      JSON.stringify(
        {
          outcome: diffs.length ? 'fail' : unverified.length ? 'unverified' : 'pass',
          differences: diffs,
          unverified,
        },
        null,
        2,
      ) + '\n',
    );
  });
});
