import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { programmeReferences, programmeSupplementGuard } from '@sigma-budget/dataset-schema';
import { readPdf, type Box } from '../readers/pdf/index.js';
import { parseProgrammeSupplement, readProgrammeSupplement } from './programme-reader.js';
import {
  supplementBudgetFiles,
  verifyProgrammeSource,
  verifyPublishedProgrammes,
  withProductionProgrammes,
  readProductionProgrammes,
} from './programmes.js';
import { budgets, programs } from '../validate/budgets.js';
import { Context } from '../validate/context.js';
const root = resolve(import.meta.dirname, '../../../..'),
  fixture = join(root, 'packages/ingest/test/fixtures/wave13b/oracle');
const base: any = Object.fromEntries(
  [
    'ministries.json',
    'programs.json',
    ...readdirSync(join(fixture, 'ministries')).map((f) => 'ministries/' + f),
  ].map((f) => [f, JSON.parse(readFileSync(join(fixture, f), 'utf8'))]),
);
const sources = Object.values(programmeReferences);
const result = supplementBudgetFiles(base, sources);
// The 190-page transport PDF measured 5.76s without coverage; allow its real decode, not a global timeout change.
const inside = (b: Box, x: number, y: number) => b[0] <= x && x < b[2] && b[1] <= y && y < b[3];
for (const source of sources) {
  const bytes = readFileSync(join(root, 'data/originals/program_budgets', source.file)),
    pdf = readPdf(bytes);
  it(
    'reads and independently verifies every source row ' + source.code,
    () => {
      const { positions: _, ...decoded } = readProgrammeSupplement(bytes, source.code as any);
      expect({ ...decoded, file: source.file }).toEqual(source);
      expect(() => verifyProgrammeSource(source, bytes)).not.toThrow();
      const doc = result[`ministries/${source.code}.json`];
      expect(programmeSupplementGuard(doc)).toBe(true);
      expect(() =>
        verifyPublishedProgrammes(doc, join(root, 'data/originals/program_budgets', source.file)),
      ).not.toThrow();
    },
    20000,
  );
  it('rejects a changed decoded numeric PDF cell ' + source.code, () => {
    const parsed = parseProgrammeSupplement(pdf, source.code as any),
      d = structuredClone(pdf),
      box = parsed.positions[0].cells[0] as Box;
    let changed = false;
    for (const b of d.pages[parsed.rows[0]!.page - 1]!.blocks)
      for (const l of b.lines)
        for (const s of l.spans)
          for (const c of s.chars) {
            if (
              !changed &&
              inside(box, (c.bbox[0] + c.bbox[2]) / 2, (c.bbox[1] + c.bbox[3]) / 2) &&
              /\d/u.test(c.text)
            ) {
              c.text = String((Number(c.text) + 1) % 10);
              changed = true;
            }
          }
    expect(changed).toBe(true);
    expect(() => parseProgrammeSupplement(d, source.code as any)).toThrow();
    expect(() =>
      parseProgrammeSupplement({ ...pdf, sha256: '0'.repeat(64) }, source.code as any),
    ).toThrow();
  });
  it('preserves every existing law field ' + source.code, () => {
    const before = base['ministries.json'].items.find((i: any) => i.id === source.code),
      after = result['ministries.json'].items.find((i: any) => i.id === source.code);
    const { programs: _, ...old } = before,
      { programs: __, ...current } = after;
    expect(current).toEqual(old);
  });
  it('rejects each independently validated published cell ' + source.code, () => {
    const doc = result[`ministries/${source.code}.json`];
    for (let r = 0; r < source.rows.length; r++)
      for (let c = 0; c < 9; c++) {
        const d = structuredClone(doc),
          old = d.sourceAudit.rows[r].values[c];
        d.sourceAudit.rows[r].values[c] = old === null ? 0 : old + 1;
        expect(() =>
          verifyPublishedProgrammes(d, join(root, 'data/originals/program_budgets', source.file)),
        ).toThrow();
      }
  });
}
it('preserves every other agency file, summary and index row', () => {
  expect(result['ministries.json'].totals).toEqual(base['ministries.json'].totals);
  for (const item of base['ministries.json'].items)
    if (!programmeReferences[item.id])
      expect(result['ministries.json'].items.find((i: any) => i.id === item.id)).toEqual(item);
  for (const [file, value] of Object.entries(base))
    if (file.startsWith('ministries/')) expect(result[file]).toEqual(value);
  expect(result['programs.json'].items.slice(0, base['programs.json'].items.length)).toEqual(
    base['programs.json'].items,
  );
  expect(result['ministries.json'].programTotals).toEqual({
    budgets: 46,
    policies: 92,
    programs: 220,
    pending: 0,
    differ: 5,
  });
});
it('rejects incomplete, duplicate, changed or already-published supplements', () => {
  for (const rows of [sources.slice(1), [...sources, sources[0]!]])
    expect(() => supplementBudgetFiles(base, rows)).toThrow();
  const changed = structuredClone(sources);
  changed[0]!.rows[0]!.values[0]!++;
  expect(() => supplementBudgetFiles(base, changed)).toThrow();
  expect(() => supplementBudgetFiles(result, sources)).toThrow();
  const bytes = readFileSync(join(root, 'data/originals/program_budgets', sources[0]!.file));
  expect(() => verifyProgrammeSource({ ...sources[0]!, sourceSha256: 'bad' }, bytes)).toThrow();
  const temp = join(mkdtempSync(join(tmpdir(), 'p03-pin-')), 'source.pdf');
  writeFileSync(temp, bytes.subarray(1));
  expect(() =>
    verifyPublishedProgrammes(result[`ministries/${sources[0]!.code}.json`], temp),
  ).toThrow();
  expect(() => readProductionProgrammes({ inputs: [] } as any)).toThrow();
});
it('extends only the budget stage before its consumers', () => {
  const stages = withProductionProgrammes(
    [
      { id: 'budgets', requires: [], run: () => base },
      { id: 'consumer', requires: ['budgets'], run: (read) => read('budgets') },
    ],
    sources,
  );
  expect(stages[0]!.run(() => null)).toEqual(result);
  expect(stages[1]!.run(() => 42)).toBe(42);
});
function supplementedContext(change?: (documents: any) => void) {
  const ctx = new Context(root),
    originalGet = ctx.get.bind(ctx),
    documents = structuredClone(result);
  documents['ministries.json'].meta.pending = [];
  documents['programs.json'].meta.pending = [];
  documents['core.json'] = structuredClone(originalGet('core.json'));
  delete documents['core.json'].pending.P03;
  change?.(documents);
  ctx.get = (file: string) => documents[file] ?? originalGet(file);
  const exists = ctx.exists.bind(ctx);
  ctx.exists = (file: string) => file in documents || exists(file);
  ctx.dataDirectory = () =>
    Object.keys(documents)
      .filter((f) => f.startsWith('ministries/'))
      .map((f) => f.slice('ministries/'.length))
      .sort();
  return ctx;
}
it('strict shared validators accept the complete source supplements', () => {
  const ctx = supplementedContext();
  expect(budgets(ctx).problems).toEqual([]);
  expect(programs(ctx).problems).toEqual([]);
});
it('strict shared validators reject a single changed source or index cell', () => {
  const code = sources[0]!.code;
  expect(
    programs(
      supplementedContext(
        (d) => (d['programs.json'].items.find((r: any) => r[0] === code)[5] += 0.01),
      ),
    ).problems.some((p) => p.includes('exact independently verified')),
  ).toBe(true);
  const ctx = supplementedContext(
    (d) => (d[`ministries/${code}.json`].policies[0].values['2026'][0] += 0.1),
  );
  expect(budgets(ctx).problems.length).toBeGreaterThan(0);
  expect(programs(ctx).problems.length).toBeGreaterThan(0);
});

it('registers the exact production producer without accepting arbitrary TS modules', async () => {
  const { script } = await import('../validate/registry.js');
  expect(script('packages/ingest/src/production/programmes.ts')).toBe(
    'packages/ingest/src/production/programmes.ts',
  );
  expect(() => script('packages/ingest/src/production/unregistered.ts')).toThrow();
});
