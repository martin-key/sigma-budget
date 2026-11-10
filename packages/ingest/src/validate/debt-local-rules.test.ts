import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context } from './context.js';
import { runGroups } from './runner.js';
import { debtLocalGroups, municipalities, sebra } from './debt-local-rules.js';
import {
  debtLocalSafetyGroups,
  municipalSafety,
  sebraSafety,
  debtSafety,
} from './debt-local-safety.js';
import {
  createDebtLocalSourceGroups,
  debtLocalSourceRequirements,
  type DebtLocalSourceBinding,
} from './debt-local-sources.js';

const fixture = new URL('../../test/fixtures/debt-local-validation/', import.meta.url).pathname;
const repo = new URL('../../../../', import.meta.url).pathname;
const load = (p: string) => JSON.parse(readFileSync(join(fixture, p), 'utf8'));
const provenance = load('provenance.json'),
  oracle = load('oracle.json');
type Op = { file: string; path: string[]; op: 'set' | 'add' | 'delete'; value?: any };
type Case = { name: string; group: string; baseline: string; expected: 'PASS' | 'FAIL'; ops: Op[] };
const cases: Case[] = load('cases.json');
const files = [
  'debt.json',
  'municipalities.json',
  'geo/obshtini.json',
  'sebra.json',
  'outlook.json',
  'execution.json',
];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function prepare(root: string, label: string, ops: Op[] = []): Context {
  const data = Object.fromEntries(files.map((f) => [f, load(`${label}/${f}`)]));
  for (const op of ops) {
    let value = data[op.file];
    for (const key of op.path.slice(0, -1)) value = value[key];
    const key = op.path.at(-1)!;
    if (op.op === 'delete') {
      if (Array.isArray(value)) value.splice(Number(key), 1);
      else delete value[key];
    } else if (op.op === 'add') value[key] += op.value;
    else value[key] = structuredClone(op.value);
  }
  for (const [file, value] of Object.entries(data)) {
    const p = join(root, 'data', file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value));
  }
  return new Context(root, provenance[label].buildDate, 'data');
}
function withContext(label: string, ops: Op[], fn: (c: Context) => void) {
  const root = mkdtempSync(join(tmpdir(), 'sigma-debt-local-rules-'));
  try {
    fn(prepare(root, label, ops));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('independent frozen Python 3.12 DEBT/MUNIC/SEBRA validation', () => {
  it('pins the named baseline, donor functions, cases and available original bytes', () => {
    expect(sha(readFileSync(join(fixture, 'provenance.json')))).toBe(
      '7b536856d288b4da8f8d2a62951d803fa3f8e639fd17cb637406ca6583a5b251',
    );
    for (const [file, hash] of Object.entries(provenance.pins))
      expect(sha(readFileSync(join(fixture, file))), file).toBe(hash);
    for (const pin of provenance.availableOriginals)
      expect(sha(readFileSync(join(repo, pin.path))), pin.path).toBe(pin.sha256);
    expect(debtLocalGroups.map((g) => g.name)).toEqual(['DEBT', 'MUNIC', 'SEBRA']);
  });
  for (const test of cases)
    it(test.name, () =>
      withContext(test.baseline, test.ops, (ctx) => {
        const result = runGroups(debtLocalGroups, ctx, [test.group]),
          actual = result.groups[0]!,
          want = oracle[test.name];
        expect(actual.problems.length ? 'FAIL' : 'PASS').toBe(test.expected);
        if (!want.crash) {
          expect(actual.n).toBe(want.n);
          expect(actual.problems).toHaveLength(want.problems.length);
          expect(actual.warnings).toEqual(want.warnings);
          expect(actual.facts).toEqual(want.facts);
        }
      }),
    );
  it('rejects omission, missing input and crash of a required group', () => {
    withContext('candidate', [], (ctx) => {
      expect(() => runGroups(debtLocalGroups.slice(0, 2), ctx, ['DEBT', 'MUNIC', 'SEBRA'])).toThrow(
        'unknown or unported group: SEBRA',
      );
      rmSync(join(ctx.root, 'data/sebra.json'));
      const result = runGroups(debtLocalGroups, ctx, ['DEBT', 'MUNIC', 'SEBRA']);
      expect(result.problems).toBe(1);
      expect(result.groups[2]!.problems[0]).toContain('group crashed:');
    });
  });
  it.skipIf(!process.env.DEBT_LOCAL_REAL_CANDIDATE)(
    'runs all three donor and additional safety groups over the actual supplied candidate when explicitly provided',
    () => {
      const candidate = process.env.DEBT_LOCAL_REAL_CANDIDATE!;
      expect(existsSync(join(candidate, 'manifest.json'))).toBe(true);
      expect(sha(readFileSync(join(candidate, 'manifest.json')))).toBe(
        provenance.candidate.manifestSha256,
      );
      for (const file of files)
        expect(sha(readFileSync(join(candidate, 'data', file)))).toBe(
          provenance.pins[`candidate/${file}`],
        );
      const ctx = new Context(candidate, provenance.candidate.buildDate, 'data');
      const groups = [...debtLocalGroups, ...debtLocalSafetyGroups];
      const result = runGroups(
        groups,
        ctx,
        groups.map((g) => g.name),
      );
      expect(result.groups).toHaveLength(6);
      expect(result.groups.flatMap((c) => c.problems)).toEqual([]);
    },
  );
});

describe('additional safety is distinct from donor parity', () => {
  for (const label of ['published', 'candidate'])
    it(`${label}: full current geometry and all numeric/calendar checks`, () =>
      withContext(label, [], (ctx) => {
        for (const c of [debtSafety(ctx), municipalSafety(ctx), sebraSafety(ctx)])
          expect(c.problems).toEqual([]);
      }));
  it('rejects null per-capita values that the donor omits', () =>
    withContext(
      'candidate',
      [
        {
          file: 'municipalities.json',
          path: ['items', '0', 'perCapita', 'total'],
          op: 'set',
          value: null,
        },
      ],
      (ctx) => {
        expect(municipalities(ctx).problems).toEqual([]);
        expect(municipalSafety(ctx).problems).toHaveLength(1);
      },
    ));
  it('rejects null quarterly percentage values that the donor only length-checks', () =>
    withContext(
      'candidate',
      [
        {
          file: 'debt.json',
          path: ['quarterly', 'eurostat', 'pctGdp', '0'],
          op: 'set',
          value: null,
        },
      ],
      (ctx) => {
        expect(debtLocalGroups[0]!.run(ctx).problems).toEqual([]);
        expect(debtSafety(ctx).problems).toHaveLength(1);
      },
    ));
  it('rejects impossible Gregorian dates that match the donor regex', () =>
    withContext(
      'candidate',
      [
        {
          file: 'sebra.json',
          path: ['publication', 'sectionPublished'],
          op: 'set',
          value: '2026-02-30',
        },
      ],
      (ctx) => {
        expect(sebra(ctx).problems).toEqual([]);
        expect(sebraSafety(ctx).problems).toHaveLength(1);
      },
    ));
  it('rejects in-country self-crossing topology that passes donor bounding-box checks', () =>
    withContext(
      'candidate',
      [
        {
          file: 'geo/obshtini.json',
          path: ['features', '0', 'geometry'],
          op: 'set',
          value: {
            type: 'Polygon',
            coordinates: [
              [
                [24, 42],
                [25, 43],
                [24, 43],
                [25, 42],
                [24, 42],
              ],
            ],
          },
        },
      ],
      (ctx) => {
        expect(municipalities(ctx).problems).toEqual([]);
        expect(municipalSafety(ctx).problems).toHaveLength(1);
      },
    ));
  it('does not broaden the pinned historical SZR36 exception', () =>
    withContext('candidate', [], (ctx) => {
      const geo = ctx.get('geo/obshtini.json'),
        feature = geo.features.find((f: any) => f.properties.id === 'SZR36');
      const move = (a: any): any =>
        typeof a[0] === 'number' ? [a[0] + 0.000001, a[1]] : a.map(move);
      feature.geometry.coordinates = move(feature.geometry.coordinates);
      expect(municipalities(ctx).problems).toEqual([]);
      expect(municipalSafety(ctx).problems).toHaveLength(1);
    }));
});

describe('original reader injection boundary', () => {
  const pin = {
    source: 'sebra',
    path: 'original.xlsx',
    sha256: sha(Buffer.from('test-only original document')),
  };
  function binding(): DebtLocalSourceBinding {
    return {
      pins: [pin],
      read: () => ({
        level: 'original',
        assertions: debtLocalSourceRequirements.SEBRA.map((scope) => ({
          scope,
          originals: [pin.path],
          file: 'sebra.json',
          pointer: '/ministryCode',
          expected: load('candidate/sebra.json').ministryCode,
        })),
      }),
    };
  }
  function run(make: (b: DebtLocalSourceBinding) => DebtLocalSourceBinding) {
    let result: ReturnType<typeof runGroups>;
    withContext('candidate', [], (ctx) => {
      writeFileSync(join(ctx.root, pin.path), 'test-only original document');
      const groups = createDebtLocalSourceGroups({ SEBRA: make(binding()) });
      result = runGroups(groups, ctx, ['SEBRA_SOURCE']);
    });
    return result!;
  }
  it('fails every unbound group instead of claiming original coverage', () =>
    withContext('candidate', [], (ctx) => {
      const groups = createDebtLocalSourceGroups({});
      expect(
        runGroups(
          groups,
          ctx,
          groups.map((g) => g.name),
        ).problems,
      ).toBe(3);
    }));
  it('accepts a test adapter only with pin and explicit scope assertions', () =>
    expect(run((b) => b).problems).toBe(0));
  it('rejects captured evidence even when document bytes are present', () =>
    expect(
      run((b) => ({ ...b, read: () => ({ level: 'captured', reason: 'old workbook capture' }) }))
        .problems,
    ).toBeGreaterThan(0));
  it('rejects unavailable evidence', () =>
    expect(
      run((b) => ({ ...b, read: () => ({ level: 'unavailable', reason: 'reader pending' }) }))
        .problems,
    ).toBeGreaterThan(0));
  it('rejects empty pins', () =>
    expect(run((b) => ({ ...b, pins: [] })).problems).toBeGreaterThan(0));
  it('rejects a wrong source identity even at the right byte hash', () =>
    expect(run((b) => ({ ...b, pins: [{ ...pin, source: 'bnb' }] })).problems).toBeGreaterThan(0));
  it('rejects changed raw bytes / wrong pin', () =>
    expect(
      run((b) => ({ ...b, pins: [{ ...pin, sha256: '0'.repeat(64) }] })).problems,
    ).toBeGreaterThan(0));
  it('rejects missing source scope', () =>
    expect(
      run((b) => ({ ...b, read: () => ({ level: 'original', assertions: [] }) })).problems,
    ).toBe(3));
  it.each([
    ['/total/eur', 0],
    ['/ministryCode', 'wrong-ministry-identity'],
  ])('rejects independent source mismatch at %s', (pointer, expected) => {
    const result = run((b) => ({
      ...b,
      read: () => ({
        level: 'original',
        assertions: debtLocalSourceRequirements.SEBRA.map((scope) => ({
          scope,
          originals: [pin.path],
          file: 'sebra.json',
          pointer: pointer as string,
          expected,
        })),
      }),
    }));
    expect(result.problems).toBe(3);
  });
  it('retains reader crashes as failures', () =>
    expect(
      run((b) => ({
        ...b,
        read: () => {
          throw new Error('corrupt original');
        },
      })).groups[0]!.problems[0],
    ).toContain('group crashed:'));
});
