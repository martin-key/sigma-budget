import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Context } from './context.js';
import { runGroups } from './runner.js';
import {
  independentRuleGroups,
  INDEPENDENT_RULE_NAMES,
  NAP_ORIGINAL_PATH,
  type NapRowsReader,
} from './independent-rules.js';
import {
  indirect,
  INDIRECT_EVIDENCE_PATH,
  INDIRECT_SOURCE_PATHS,
  sha256,
  type IndirectEvidence,
  type IndirectEvidenceReader,
} from './indirect-rules.js';
import { rates } from './components-rules.js';
import { executionIntegrity, type ExecutionLawTable } from './execution-integrity.js';

const repo = new URL('../../../../', import.meta.url).pathname;
const fixture = new URL('../../test/fixtures/independent-rules/', import.meta.url).pathname;
const load = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));
const manifest = load(join(fixture, 'manifest.json')),
  oracle = load(join(fixture, 'oracle.json')),
  cases = load(join(fixture, 'cases.json'));
const root = mkdtempSync(join(tmpdir(), 'sigma-independent-rules-'));
for (const rel of Object.keys(manifest.requiredInputs)) {
  const dest = join(root, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(repo, rel), dest);
}
const data = join(root, 'data/release');
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  cpSync(join(fixture, 'data'), data, { recursive: true });
  // Each source-boundary test may mutate only these owned copies.
  cpSync(join(repo, 'data/originals.sha256'), join(root, 'data/originals.sha256'));
  cpSync(join(repo, INDIRECT_EVIDENCE_PATH), join(root, INDIRECT_EVIDENCE_PATH));
  cpSync(
    join(repo, 'data/inputs/budget_forecast_2027.json'),
    join(root, 'data/inputs/budget_forecast_2027.json'),
  );
  for (const rel of [NAP_ORIGINAL_PATH, ...Object.values(INDIRECT_SOURCE_PATHS)])
    rmSync(join(root, rel), { force: true });
});
const context = () => new Context(root, manifest.buildDate);
function update(file: string, op: (d: any) => void) {
  const path = join(data, file),
    d = load(path);
  op(d);
  writeFileSync(path, JSON.stringify(d));
}
function normal(s: string): string {
  return s.replace(/(-?\d+)\.0(?!\d)/g, '$1').replaceAll('null', 'None');
}
describe('Python 3.12 pinned donor baseline and finite independent mutations', () => {
  it('authenticates frozen donor/data bytes and pinned original dependencies', () => {
    for (const [rel, digest] of Object.entries(manifest.frozen))
      expect(sha256(readFileSync(join(fixture, rel))), rel).toBe(digest);
    for (const [rel, digest] of Object.entries(manifest.requiredInputs))
      expect(sha256(readFileSync(join(repo, rel))), rel).toBe(digest);
    expect(manifest.repositoryBaseline).toBe('3424bc998c726d6d511d4284295c54c50c42d099');
    expect(manifest.buildDate).toBe('2026-11-10');
  });
  for (const scenario of cases)
    it(scenario.name, () => {
      for (const op of scenario.ops)
        update(op.file, (d) => {
          let t = d;
          for (const p of op.path.slice(0, -1)) t = t[p];
          if (op.op === 'delete') delete t[op.path.at(-1)];
          else t[op.path.at(-1)] = structuredClone(op.value);
        });
      const result = runGroups(independentRuleGroups(), context(), scenario.groups);
      for (const c of result.groups) {
        const expected = oracle[scenario.name][c.name];
        expect(
          c.problems.some((p) => p.startsWith('group crashed:')),
          c.problems.join('\n'),
        ).toBe(false);
        if (c.name !== 'CONTRACT') {
          expect(c.n).toBe(expected.n);
          expect(c.problems.map(normal)).toEqual(expected.problems.map(normal));
          expect(c.warnings).toEqual(expected.warnings);
          expect(c.facts).toEqual(expect.arrayContaining(expected.facts));
        } else {
          // Integrity coverage adds checks to the unchanged donor contract rules.
          expect(c.n).toBeGreaterThanOrEqual(expected.n);
          for (const problem of expected.problems)
            expect(c.problems.map(normal)).toContain(normal(problem));
          if (expected.problems.length === 0) expect(c.problems).toEqual([]);
          expect(c.facts).toEqual(expect.arrayContaining(expected.facts));
        }
      }
    });
});

it('returns exactly four typed groups and rejects an omitted required group', () => {
  expect(independentRuleGroups().map((g) => g.name)).toEqual(INDEPENDENT_RULE_NAMES);
  expect(() =>
    runGroups(
      independentRuleGroups().filter((g) => g.name !== 'CONTRACT'),
      context(),
      [...INDEPENDENT_RULE_NAMES],
    ),
  ).toThrow('unknown or unported group: CONTRACT');
  const result = runGroups(independentRuleGroups(), context(), [...INDEPENDENT_RULE_NAMES]);
  expect(result.problems).toBe(0);
  expect(result.groups.map((c) => [c.name, c.n])).toEqual([
    ['COMPONENTS', 270],
    ['RATES', 891],
    ['INDIRECT', 124],
    ['CONTRACT', 4016],
  ]);
  expect(result).not.toHaveProperty('completeValidation');
});

it('reads raw decimal strings even after the Context numeric projection is cached', () => {
  const ctx = context();
  expect(typeof ctx.get('execution.json').data['2026'].kfp.rev[0]).toBe('number');
  update('execution.json', (d) => {
    d.data['2026'].kfp.rev[0] = 123.456;
  });
  expect(executionIntegrity(ctx).problems).toEqual(
    expect.arrayContaining([expect.stringContaining('data.2026.kfp.rev[0]')]),
  );
});

it.each([
  [
    'missing data row',
    (d: any) => {
      delete d.data['2026'].kfp.rev;
    },
  ],
  [
    'missing monthly cell',
    (d: any) => {
      d.monthly['2026'].kfp.rev.pop();
    },
  ],
  [
    'missing data year',
    (d: any) => {
      delete d.data['2026'];
    },
  ],
  [
    'missing report file',
    (d: any) => {
      d.data['2026'].files.pop();
    },
  ],
  [
    'money with extra whitespace',
    (d: any) => {
      d.data['2026'].kfp.rev[0] = '1.000\n';
    },
  ],
  [
    'coordinated wrong money unit',
    (d: any) => {
      d.meta.unit = d.contract.money.unit = 'BGN';
    },
  ],
  [
    'percentage as string',
    (d: any) => {
      d.latest.kfp.rev.pctPlan = '1.0';
    },
  ],
])('fails CONTRACT for %s', (_, mutate) => {
  update('execution.json', mutate);
  const c = executionIntegrity(context());
  expect(c.problems.length).toBeGreaterThan(0);
});
it.each([
  [
    'valid integer wrong cell',
    (d: any) => {
      d.rows.rev = 12;
    },
  ],
  [
    'empty computed rule',
    (d: any) => {
      d.computed['exp.total'].rule = '';
    },
  ],
  [
    'wrong computed rule',
    (d: any) => {
      d.computed['exp.total'].rule = 'exp - eucontrib';
    },
  ],
  [
    'changed derived rule',
    (d: any) => {
      d.rules.monthly = 'data(m) + data(m - 1)';
    },
  ],
  [
    'wrong column',
    (d: any) => {
      d.columns.kfp = 'C';
    },
  ],
  [
    'missing derived rule',
    (d: any) => {
      delete d.rules.monthly;
    },
  ],
  [
    'coordinated original hash',
    (d: any) => {
      d.originals['2026-01'].sha256 = '0'.repeat(64);
    },
  ],
])('fails provenance for %s', (_, mutate) => {
  update('execution-provenance.json', mutate);
  if (_ === 'coordinated original hash')
    update('execution.json', (d) => {
      d.data['2026'].files[0].sha256 = '0'.repeat(64);
    });
  expect(executionIntegrity(context()).problems.length).toBeGreaterThan(0);
});
it('fails a changed original XLS byte and a missing pinned plan extraction', () => {
  const rel = 'data/originals/kfp_2026/2026-EU_funds_0926_BG_WEB.xls',
    original = readFileSync(join(root, rel));
  try {
    writeFileSync(join(root, rel), Buffer.concat([original, Buffer.from('mutation')]));
    expect(executionIntegrity(context()).problems).toEqual(
      expect.arrayContaining([expect.stringContaining('original bytes agree with pinned hash')]),
    );
  } finally {
    writeFileSync(join(root, rel), original);
  }
  rmSync(join(root, 'data/inputs/budget_forecast_2027.json'));
  expect(executionIntegrity(context()).problems).toEqual(
    expect.arrayContaining([
      expect.stringContaining('cannot independently verify plan provenance'),
    ]),
  );
});
it('accepts the independent law table boundary and rejects changed printed evidence', () => {
  const table = load(join(root, 'data/inputs/budget_forecast_2027.json')).tables
    .annex1_execution2026 as ExecutionLawTable;
  let calls = 0;
  const good = executionIntegrity(context(), (pdf) => {
    calls++;
    expect(sha256(pdf.bytes)).toBe(pdf.sha256);
    return structuredClone(table);
  });
  expect(calls).toBe(1);
  expect(good.problems).toEqual([]);
  const bad = executionIntegrity(context(), () => {
    const t = structuredClone(table);
    t.rows[0]!.printed[0] = '1,0';
    return t;
  });
  expect(bad.problems).toEqual(
    expect.arrayContaining([expect.stringContaining('independent Annex 1 law table differs')]),
  );
});
it('fails missing or repinned independent indirect-tax evidence', () => {
  const path = join(root, INDIRECT_EVIDENCE_PATH),
    original = readFileSync(path);
  rmSync(path);
  expect(indirect(context()).problems).toEqual(
    expect.arrayContaining([
      expect.stringContaining('cannot verify official indirect-tax evidence'),
    ]),
  );
  writeFileSync(path, original.toString().replace('20.0', '21.0'));
  expect(indirect(context()).problems).toContain('independent evidence pin');
});
it('reports the frozen evidence boundary explicitly without claiming decoder execution', () => {
  const c = indirect(context());
  expect(c.problems).toEqual([]);
  expect(c.facts).toContain(
    'raw evidence unavailable: comparing against the pinned independent extraction',
  );
  expect(c.facts).toEqual(
    expect.arrayContaining([expect.stringContaining('missing indirect-tax originals:')]),
  );
  expect(c.facts.join('\n')).not.toContain('reader ran');
  const r = rates(context());
  expect(r.facts.join('\n')).toContain('NAP original unavailable');
});

function installNap(): Record<string, any> {
  const dest = join(root, NAP_ORIGINAL_PATH);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(fixture, 'source-captures/nap.pdf'), dest);
  return load(join(fixture, 'source-captures/nap-rows.json'));
}
it('requires the NAP binding when a pinned original is available', () => {
  installNap();
  const c = rates(context());
  expect(c.problems).toContain(
    'NAP original is present but the independent NAP reader is not bound',
  );
});
it('recomputes NAP funds and effects through a captured-reader test double', () => {
  const capture = installNap();
  let calls = 0;
  const reader: NapRowsReader = (pdf) => {
    calls++;
    expect(sha256(pdf.bytes)).toBe(manifest.sourceCapture.originalSha256);
    return structuredClone(capture);
  };
  const good = rates(context(), reader);
  expect(calls).toBe(1);
  expect(good.problems).toEqual([]);
  // A coordinated change preserves the donor's civil-servant total and deltas.
  update('rates.json', (r) => {
    for (const id of ['civil-servant-employee-share', 'civil-servant-employer-share']) {
      const x = r.changes.find((x: any) => x.id === id),
        shift = id.includes('employee') ? 1 : -1;
      x.until += shift;
      x.from += shift;
      x.delta = x.from - x.until;
      if ('deltaPct' in x) x.deltaPct = (100 * (x.from - x.until)) / x.until;
    }
  });
  expect(rates(context(), reader).problems).toEqual(
    expect.arrayContaining([expect.stringContaining('NAP civil-servant employee: until')]),
  );
});
it('rejects corrupt NAP bytes before invoking a decoder', () => {
  installNap();
  writeFileSync(join(root, NAP_ORIGINAL_PATH), 'bad PDF');
  let calls = 0;
  const c = rates(context(), () => {
    calls++;
    return {};
  });
  expect(c.problems).toContain('NAP original pin');
  expect(calls).toBe(0);
});
it('rejects missing NAP rows and changed source cells despite stored true verdicts', () => {
  const capture = installNap();
  expect(
    rates(context(), () => {
      const x = structuredClone(capture);
      delete x['1.2.'];
      return x;
    }).problems.join('\n'),
  ).toContain('missing NAP source row 1.2.');
  const c = rates(context(), () => {
    const x = structuredClone(capture);
    x['1.2.'].cells[8] = '0';
    return x;
  });
  expect(c.problems.join('\n')).toContain('NAP 1.2.:');
});

/** Finite transport doubles test the full-original binding contract. These tiny
 * inputs are explicitly synthetic; the published baseline above uses real pins. */
function installIndirectBoundary(): IndirectEvidence {
  const ev = load(join(root, INDIRECT_EVIDENCE_PATH)) as IndirectEvidence;
  const pins = readFileSync(join(root, 'data/originals.sha256'), 'utf8').trim().split('\n');
  const replacePin = (rel: string, digest: string) => {
    const i = pins.findIndex((l) => l.endsWith('  ' + rel));
    expect(i).toBeGreaterThanOrEqual(0);
    pins[i] = digest + '  ' + rel;
  };
  for (const [name, rel] of Object.entries(INDIRECT_SOURCE_PATHS)) {
    const dest = join(root, rel),
      bytes = Buffer.from('synthetic decoder transport: ' + name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    ev.sources[name as keyof typeof INDIRECT_SOURCE_PATHS].sha256 = sha256(bytes);
    replacePin(rel, sha256(bytes));
  }
  const bytes = Buffer.from(JSON.stringify(ev));
  writeFileSync(join(root, INDIRECT_EVIDENCE_PATH), bytes);
  replacePin(INDIRECT_EVIDENCE_PATH, sha256(bytes));
  writeFileSync(join(root, 'data/originals.sha256'), pins.join('\n') + '\n');
  return ev;
}
it('fails when all six source bytes exist but no independent reader is bound', () => {
  installIndirectBoundary();
  const c = indirect(context());
  expect(c.problems.join('\n')).toContain(
    'all six originals are present but the independent indirect-tax reader is not bound',
  );
  expect(c.facts.join('\n')).not.toContain('raw evidence unavailable');
});
it('requires exact independently decoded evidence and propagates decoder failure', () => {
  const ev = installIndirectBoundary();
  let calls = 0;
  const reader: IndirectEvidenceReader = (sources) => {
    calls++;
    for (const src of Object.values(sources)) expect(sha256(src.bytes)).toBe(src.sha256);
    return structuredClone(ev);
  };
  expect(indirect(context(), reader).problems).toEqual([]);
  expect(calls).toBe(1);
  expect(
    indirect(context(), () => {
      const x = structuredClone(ev);
      x.vat.standardPct = 21;
      return x;
    }).problems,
  ).toContain('independent re-extraction differs from frozen evidence');
  expect(
    indirect(context(), () => {
      throw new Error('decoder failed');
    }).problems.join('\n'),
  ).toContain('decoder failed');
});
it('rejects corrupt indirect source bytes even if a test reader returns the frozen extraction', () => {
  const ev = installIndirectBoundary();
  writeFileSync(join(root, INDIRECT_SOURCE_PATHS.prices), 'corruption');
  expect(indirect(context(), () => ev).problems).toContain('raw evidence pin: prices');
});
