import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AnnualLineage, type BillExtraction, type Extraction } from '../build/annual-lineage.js';
import { buildAnnualPeriods } from '../build/fiscal-annual.js';
import { buildBudget2027 } from '../build/budget-2027.js';
import { parsePythonJson } from '../common/numbers.js';
import { budget2027 } from './budget-2027.js';
import { Context } from './context.js';
import { runGroups } from './runner.js';

const fixtures = resolve(import.meta.dirname, '../../test/fixtures');
const root = mkdtempSync(join(tmpdir(), 'sigma-15b-'));
const published = ['outlook', 'revenue', 'expenditure', 'budget2027', 'budget2027-provenance'];
function copy(source: string, target: string): void {
  const dest = join(root, target);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(fixtures, source), dest);
}
beforeAll(() => {
  for (const name of published) copy(`wave13a/published/${name}.json`, `data/release/${name}.json`);
  for (const name of ['budget_forecast_2027.json', 'budget_bill_2027.json'])
    copy(`fiscal/inputs/data/inputs/${name}`, `data/inputs/${name}`);
  copy(
    'fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip',
    'data/originals/budget_2027/ZDBRB-2027.zip',
  );
  copy(
    'validate15b/donor/budget_pipeline/validate/fixtures/budget_2027_cells.json',
    'pipeline/budget_pipeline/validate/fixtures/budget_2027_cells.json',
  );
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const cases = JSON.parse(readFileSync(join(fixtures, 'validate15b/oracle.json'), 'utf8')) as {
  mutation: {
    name: string;
    file?: string;
    path?: string[];
    value?: unknown;
    delete?: boolean;
    source?: boolean | 'project' | 'project-count';
  };
  result: unknown;
}[];
// Source mutations rebuild annual lineage before validation: measured 5.24–5.33s
// with V8 coverage on the shared audit host; scoped 15s integration budget.
it.each(cases)(
  'matches the unchanged donor: $mutation.name',
  ({ mutation, result }) => {
    if (mutation.file) {
      const path = join(root, 'data/release', mutation.file);
      const doc = JSON.parse(readFileSync(path, 'utf8'));
      let current = doc;
      for (const key of mutation.path!.slice(0, -1)) current = current[key];
      const key = mutation.path!.at(-1)!;
      if (mutation.delete) delete current[key];
      else current[key] = mutation.value;
      writeFileSync(path, JSON.stringify(doc));
    }
    if (mutation.source) {
      const forecastPath = join(root, 'data/inputs/budget_forecast_2027.json');
      const forecast = parsePythonJson<Extraction>(readFileSync(forecastPath, 'utf8'));
      const billPath = join(root, 'data/inputs/budget_bill_2027.json');
      let billText = readFileSync(billPath, 'utf8');
      if (mutation.source === 'project') {
        const original = parsePythonJson<BillExtraction>(billText);
        const first = original.projects.rows[0]!.id;
        const second = original.projects.rows[1]!.id;
        const previous = JSON.stringify(second);
        expect(billText.split(previous)).toHaveLength(3);
        billText = billText.replaceAll(previous, JSON.stringify(first));
        writeFileSync(billPath, billText);
      } else if (mutation.source === 'project-count') {
        const original = parsePythonJson<BillExtraction>(billText);
        const last = original.projects.rows.at(-1)!.id;
        const id = billText.indexOf(`"id": ${JSON.stringify(last)}`);
        const start = billText.lastIndexOf('},\n      {', id) + 1;
        const end = billText.indexOf('\n      }\n    ]', id) + 8;
        expect(id).toBeGreaterThan(0);
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        billText = billText.slice(0, start) + billText.slice(end);
        expect(parsePythonJson<BillExtraction>(billText).projects.rows).toHaveLength(225);
        writeFileSync(billPath, billText);
      } else {
        forecast.tables.annex1_execution2026!.rows[0]!.values[0] = 49615.4;
        forecast.tables.annex1_execution2026!.rows[0]!.printed![0] = '49 615,4';
        writeFileSync(forecastPath, JSON.stringify(forecast));
      }
      const bill = parsePythonJson<BillExtraction>(billText);
      const zip = readFileSync(join(root, 'data/originals/budget_2027/ZDBRB-2027.zip'));
      const lineage = new AnnualLineage(forecast, bill, { forecast: zip, bill: zip });
      const annual = buildAnnualPeriods(forecast, lineage);
      const built = buildBudget2027(lineage, '2026-11-08');
      for (const [name, records] of Object.entries(annual)) {
        const path = join(root, `data/release/${name}.json`);
        const doc = JSON.parse(readFileSync(path, 'utf8'));
        doc.byPeriod = records;
        writeFileSync(path, JSON.stringify(doc));
      }
      writeFileSync(join(root, 'data/release/budget2027.json'), JSON.stringify(built.budget));
      writeFileSync(
        join(root, 'data/release/budget2027-provenance.json'),
        JSON.stringify(built.provenance),
      );
    }
    try {
      const run = runGroups(
        [{ name: 'BUDGET2027', description: '', run: budget2027 }],
        new Context(root),
        ['BUDGET2027'],
      );
      expect(run.groups[0]).toEqual(result);
    } finally {
      if (mutation.file)
        copy(`wave13a/published/${mutation.file}`, `data/release/${mutation.file}`);
      if (mutation.source) {
        copy(
          'fiscal/inputs/data/inputs/budget_forecast_2027.json',
          'data/inputs/budget_forecast_2027.json',
        );
        copy(
          'fiscal/inputs/data/inputs/budget_bill_2027.json',
          'data/inputs/budget_bill_2027.json',
        );
        for (const name of published)
          copy(`wave13a/published/${name}.json`, `data/release/${name}.json`);
      }
    }
  },
  15_000,
);

// Multiple real CLI validations and crash recovery measured 5.94s with coverage.
it('confines candidate reports and protects inputs even after a crashed validation', async () => {
  const { main } = await import('./budget-2027-cli.js');
  const { linkSync, symlinkSync, existsSync } = await import('node:fs');
  const { vi } = await import('vitest');
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const report = 'tmp/ts-migration/candidate15b/report.json';
  try {
    expect(main(['--root', root, '--report', report])).toBe(0);
    const output = JSON.parse(readFileSync(join(root, report), 'utf8'));
    expect(output).toMatchObject({ scope: 'wave15b', completeValidation: false, status: 'PASS' });
    expect(
      main(['--root', root, '--only', 'KFP', '--report', 'tmp/ts-migration/invalid/out.json']),
    ).toBe(2);
    expect(existsSync(join(root, 'tmp/ts-migration/invalid'))).toBe(false);
    expect(main(['--root', root, '--report', 'tmp/ts-migration/../escape.json'])).toBe(2);
    const linked = join(root, 'tmp/ts-migration/candidate15b/linked.json');
    linkSync(join(root, 'data/inputs/budget_forecast_2027.json'), linked);
    expect(main(['--root', root, '--report', 'tmp/ts-migration/candidate15b/linked.json'])).toBe(2);
    symlinkSync(join(root, 'data/inputs'), join(root, 'tmp/ts-migration/candidate15b/symlink'));
    expect(
      main(['--root', root, '--report', 'tmp/ts-migration/candidate15b/symlink/out.json']),
    ).toBe(2);
    const forecastPath = join(root, 'data/inputs/budget_forecast_2027.json');
    const forecast = JSON.parse(readFileSync(forecastPath, 'utf8'));
    forecast.source.archive = 'tmp/ts-migration/candidate15b/archive.json';
    writeFileSync(forecastPath, JSON.stringify(forecast));
    const archive = join(root, forecast.source.archive);
    writeFileSync(archive, 'bad archive');
    expect(main(['--root', root, '--report', forecast.source.archive])).toBe(2);
    expect(readFileSync(archive, 'utf8')).toBe('bad archive');
    const billPath = join(root, 'data/inputs/budget_bill_2027.json');
    const bill = JSON.parse(readFileSync(billPath, 'utf8'));
    bill.source.archive = 'tmp/ts-migration/candidate15b/later.json';
    writeFileSync(billPath, JSON.stringify(bill));
    const later = join(root, bill.source.archive);
    writeFileSync(later, 'later declared input');
    expect(main(['--root', root, '--report', bill.source.archive])).toBe(2);
    expect(readFileSync(later, 'utf8')).toBe('later declared input');
    const rootAlias = join(root, 'tmp/ts-migration/candidate15b/root-alias');
    symlinkSync(root, rootAlias);
    expect(main(['--root', rootAlias, '--report', bill.source.archive])).toBe(2);
    expect(readFileSync(later, 'utf8')).toBe('later declared input');
    forecast.source.archive = 'tmp/ts-migration/candidate15b/../unsafe.json';
    writeFileSync(forecastPath, JSON.stringify(forecast));
    expect(main(['--root', root, '--report', 'tmp/ts-migration/unsafe.json'])).toBe(2);
    expect(existsSync(join(root, 'tmp/ts-migration/unsafe.json'))).toBe(false);
  } finally {
    copy(
      'fiscal/inputs/data/inputs/budget_forecast_2027.json',
      'data/inputs/budget_forecast_2027.json',
    );
    copy('fiscal/inputs/data/inputs/budget_bill_2027.json', 'data/inputs/budget_bill_2027.json');
    rmSync(join(root, 'tmp'), { recursive: true, force: true });
    cwd.mockRestore();
    stdout.mockRestore();
    stderr.mockRestore();
  }
}, 15_000);

it.each([
  ['float-encoded year', 'outlook.json', '"year":2026', '"year":2026.0'],
  ['null page', 'budget2027-provenance.json', '"page":174', '"page":null'],
  ['array page', 'budget2027-provenance.json', '"page":174', '"page":[]'],
])('rejects %s without numeric coercion', (_name, file, before, after) => {
  const path = join(root, 'data/release', file);
  const original = readFileSync(path, 'utf8');
  expect(original).toContain(before);
  writeFileSync(path, original.replace(before, after));
  try {
    const result = runGroups(
      [{ name: 'BUDGET2027', description: '', run: budget2027 }],
      new Context(root),
      ['BUDGET2027'],
    );
    expect(result.groups[0]!.problems).toEqual([
      expect.stringMatching(/^group crashed: ValueError: Invalid integer metadata:/),
    ]);
  } finally {
    copy(`wave13a/published/${file}`, `data/release/${file}`);
  }
});

const helpers = JSON.parse(readFileSync(join(fixtures, 'validate15b/helpers.json'), 'utf8')) as {
  oracles: { name: string; docs: Record<string, unknown>; oracles: unknown[]; result: unknown }[];
  laws: { name: string; docs: Record<string, unknown>; result: unknown }[];
  archives: { name: string; problem: string }[];
  sourceCases: { name: string; path: (string | number)[]; value: unknown; problem: string }[];
  identities: {
    name: string;
    kind: string;
    path: (string | number)[];
    value: unknown;
    result: unknown;
  }[];
};
it.each(helpers.oracles)(
  'matches donor PDF oracle helper: $name',
  async ({ docs, oracles, result }) => {
    const { checkOutputOracles } = await import('./budget-2027.js');
    const { Check } = await import('./checks.js');
    const ctx = { get: (name: string) => docs[name] } as Context;
    const output = runGroups(
      [
        {
          name: 'BUDGET2027',
          description: '',
          run: () => {
            const check = new Check('BUDGET2027');
            checkOutputOracles(check, ctx, oracles);
            return check;
          },
        },
      ],
      ctx,
      ['BUDGET2027'],
    );
    expect(output.groups[0]).toEqual(result);
  },
);
it.each(helpers.laws)('matches donor decimal boundary: $name', async ({ docs, result }) => {
  const { checkLawIdentities } = await import('./budget-2027.js');
  const { Check } = await import('./checks.js');
  const ctx = { get: (name: string) => docs[name] } as Context;
  const check = new Check('BUDGET2027');
  checkLawIdentities(check, ctx);
  expect(check).toEqual(result);
});

it.each(helpers.archives)(
  'matches donor on $name checksum failure, including stale bytes at the same path',
  ({ name, problem }) => {
    const zipPath = join(root, 'data/originals/budget_2027/ZDBRB-2027.zip');
    const inputPath = join(root, 'data/inputs/budget_forecast_2027.json');
    if (name === 'archive' || name === 'archive-before-metadata') {
      if (name === 'archive-before-metadata') {
        const input = JSON.parse(readFileSync(inputPath, 'utf8'));
        input.tables.annex1_execution2026.rows[0].page = null;
        writeFileSync(inputPath, JSON.stringify(input));
      }
      const bytes = readFileSync(zipPath);
      bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      writeFileSync(zipPath, bytes);
    } else {
      const input = JSON.parse(readFileSync(inputPath, 'utf8'));
      input.source.pdf_sha256 = '0'.repeat(64);
      writeFileSync(inputPath, JSON.stringify(input));
    }
    try {
      const result = runGroups(
        [{ name: 'BUDGET2027', description: '', run: budget2027 }],
        new Context(root),
        ['BUDGET2027'],
      );
      expect(result.groups[0]!.problems).toEqual([problem]);
    } finally {
      copy(
        'fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip',
        'data/originals/budget_2027/ZDBRB-2027.zip',
      );
      copy(
        'fiscal/inputs/data/inputs/budget_forecast_2027.json',
        'data/inputs/budget_forecast_2027.json',
      );
    }
  },
);

it.each(helpers.identities)(
  'matches donor independent source identity: $name',
  async ({ name, kind, path, value, result }) => {
    const { forecastIdentities, billIdentities, municipalIdentities } =
      await import('./budget-2027.js');
    const { Check } = await import('./checks.js');
    const doc = JSON.parse(
      readFileSync(join(fixtures, `fiscal/inputs/data/inputs/budget_${kind}_2027.json`), 'utf8'),
    );
    let target = doc;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)!] = value;
    const check = new Check('BUDGET2027');
    if (kind === 'forecast') forecastIdentities(check, doc.tables);
    else if (name.startsWith('municipal')) municipalIdentities(check, doc);
    else billIdentities(check, doc);
    expect(check).toEqual(result);
  },
);

it.each(helpers.sourceCases)(
  'matches donor on independent source mutation: $name',
  ({ path, value, problem }) => {
    const filename = join(root, 'data/inputs/budget_forecast_2027.json');
    const forecast = JSON.parse(readFileSync(filename, 'utf8'));
    let parent = forecast;
    for (const key of path.slice(0, -1)) parent = parent[key];
    parent[path.at(-1)!] = value;
    writeFileSync(filename, JSON.stringify(forecast));
    try {
      const result = runGroups(
        [{ name: 'BUDGET2027', description: '', run: budget2027 }],
        new Context(root),
        ['BUDGET2027'],
      );
      expect(result.groups[0]!.problems).toEqual([problem]);
    } finally {
      copy(
        'fiscal/inputs/data/inputs/budget_forecast_2027.json',
        'data/inputs/budget_forecast_2027.json',
      );
    }
  },
);

it.each([[], '1.0', null])(
  'rejects a nonnumeric project count %j before it can disappear from the output',
  (count) => {
    const file = join(root, 'data/inputs/budget_bill_2027.json');
    const bill = JSON.parse(readFileSync(file, 'utf8'));
    bill.projects.rows[0].n = count;
    writeFileSync(file, JSON.stringify(bill));
    try {
      const result = runGroups(
        [{ name: 'BUDGET2027', description: '', run: budget2027 }],
        new Context(root),
        ['BUDGET2027'],
      );
      expect(result.groups[0]!.problems).toEqual([
        'group crashed: ValueError: Invalid integer metadata: n',
      ]);
    } finally {
      copy('fiscal/inputs/data/inputs/budget_bill_2027.json', 'data/inputs/budget_bill_2027.json');
    }
  },
);

it('rejects an array in source row metadata', () => {
  const file = join(root, 'data/inputs/budget_forecast_2027.json');
  const forecast = JSON.parse(readFileSync(file, 'utf8'));
  forecast.tables.annex1_execution2026.rows[0].label = [];
  writeFileSync(file, JSON.stringify(forecast));
  try {
    const result = runGroups(
      [{ name: 'BUDGET2027', description: '', run: budget2027 }],
      new Context(root),
      ['BUDGET2027'],
    );
    expect(result.groups[0]!.problems).toEqual([
      'group crashed: ValueError: Invalid forecast row metadata',
    ]);
  } finally {
    copy(
      'fiscal/inputs/data/inputs/budget_forecast_2027.json',
      'data/inputs/budget_forecast_2027.json',
    );
  }
});

it('rejects a float-encoded project count', () => {
  const file = join(root, 'data/inputs/budget_bill_2027.json');
  const original = readFileSync(file, 'utf8');
  const start = original.indexOf('"projects": {');
  expect(start).toBeGreaterThan(0);
  const prefix = original.slice(0, start);
  const rest = original.slice(start);
  expect(rest).toContain('"n": 1,');
  writeFileSync(file, prefix + rest.replace('"n": 1,', '"n": 1.0,'));
  try {
    const result = runGroups(
      [{ name: 'BUDGET2027', description: '', run: budget2027 }],
      new Context(root),
      ['BUDGET2027'],
    );
    expect(result.groups[0]!.problems).toEqual([
      'group crashed: ValueError: Invalid integer metadata: n',
    ]);
  } finally {
    copy('fiscal/inputs/data/inputs/budget_bill_2027.json', 'data/inputs/budget_bill_2027.json');
  }
});
