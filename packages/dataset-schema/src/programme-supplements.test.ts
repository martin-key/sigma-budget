import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  programmeSupplementGuard,
  programmeReferences,
  supplementaryProgrammeCodes,
  programmeProjection,
  programmeAccounting,
  programmeNotes,
  programmeColumns,
  programmeYearLabels,
  programmeVintage,
  programmeEqual,
  programmeSupplementCounts,
} from './programme-supplements.js';
import { isPublishedDataset } from './index.js';
const agency = JSON.parse(
  readFileSync(new URL('../../../data/release/ministries.json', import.meta.url), 'utf8'),
);
const template = JSON.parse(
  readFileSync(new URL('../../../data/release/ministries/0200.json', import.meta.url), 'utf8'),
);
function example(code: string): any {
  const source = programmeReferences[code]!,
    item = agency.items.find((x: any) => x.id === code),
    pages = [...new Set(source.rows.map((r) => r.page))],
    accounting = programmeAccounting(source);
  return {
    ...structuredClone(template),
    id: code,
    art: item.art,
    name: item.name,
    short: item.short,
    policiesKind: item.policiesKind,
    tier: 'source-verified',
    yearLabels: programmeYearLabels(code),
    vintage: programmeVintage(code),
    cols: programmeColumns,
    ...programmeProjection(source),
    yearsComplete: [2026],
    skipped: [],
    skippedTotal: 0,
    check: {
      prbTotal2026: source.rows[0]!.values[1],
      zdbExp: item.expKhil,
      matchesLaw: item.expKhil === source.rows[0]!.values[1],
      sourceDifferences: Object.keys(accounting.differences).length,
      unavailableChecks: accounting.unavailable.length,
    },
    doc: { ...template.doc, file: source.file, pages, pagesByYear: { '2026': pages } },
    sourceContract: 'programme-supplement/1',
    sourceAudit: { sourceSha256: source.sourceSha256, rows: structuredClone(source.rows) },
    accounting,
    notes: programmeNotes(source),
  };
}
for (const code of supplementaryProgrammeCodes) {
  it('accepts independently decoded supplement ' + code, () => {
    expect(programmeSupplementGuard(example(code))).toBe(true);
    expect(isPublishedDataset(`ministries/${code}.json`, example(code))).toBe(true);
  });
  it('rejects every changed published source cell ' + code, () => {
    const source = programmeReferences[code]!;
    for (let r = 0; r < source.rows.length; r++)
      for (let c = 0; c < 9; c++) {
        const d = example(code),
          v = d.sourceAudit.rows[r].values[c];
        d.sourceAudit.rows[r].values[c] = v === null ? 0 : Math.round(v * 10 + 1) / 10;
        expect(programmeSupplementGuard(d), `${r}/${c}`).toBe(false);
      }
    for (const p of example(code).policies)
      for (const n of [p, ...(p.programs ?? [])])
        for (let c = 0; c < 9; c++) {
          const d = example(code),
            nodes = d.policies.flatMap((p: any) => [p, ...(p.programs ?? [])]),
            target = nodes.find((x: any) => x.code === n.code),
            v = target.values['2026'][c];
          target.values['2026'][c] = v === null ? 0 : Math.round(v * 10 + 1) / 10;
          expect(programmeSupplementGuard(d), `${n.code}/${c}`).toBe(false);
        }
  });
}
const fields = [
  'meta',
  'id',
  'sourceContract',
  'art',
  'name',
  'short',
  'policiesKind',
  'tier',
  'sourceAudit',
  'total',
  'policies',
  'accounting',
  'notes',
  'years',
  'yearLabels',
  'vintage',
  'cols',
  'yearsComplete',
  'skipped',
  'skippedTotal',
  'doc',
  'check',
];
for (const field of fields)
  it('rejects missing field ' + field, () => {
    const d = example('1800');
    delete d[field];
    expect(programmeSupplementGuard(d)).toBe(false);
  });
for (const [name, mutate] of Object.entries({
  metaId: (d: any): unknown => (d.meta.id = 'D00'),
  unit: (d: any): unknown => (d.meta.unit = 'BGN'),
  status: (d: any): unknown => (d.meta.status = 'pending'),
  mock: (d: any): unknown => (d.meta.mock = true),
  source: (d: any): unknown => (d.meta.source = ['zdb']),
  sourcePin: (d: any): unknown => (d.sourceAudit.sourceSha256 = '0'.repeat(64)),
  extra: (d: any): unknown => (d.extra = 1),
  law: (d: any): unknown => (d.check.matchesLaw = !d.check.matchesLaw),
  lawType: (d: any): unknown => (d.check.zdbExp = 'bad'),
  total: (d: any): unknown => d.total['2026'][1]++,
  registryDifference: (d: any): unknown => (d.accounting.differences.extra = 1),
  docFile: (d: any): unknown => (d.doc.file = 'wrong.pdf'),
  docPages: (d: any): unknown => (d.doc.pages = []),
  docYears: (d: any): unknown => (d.doc.pagesByYear = {}),
  docUrl: (d: any): unknown => (d.doc.archiveUrl = 'wrong'),
  docExtra: (d: any): unknown => (d.doc.extra = 1),
  docArchive: (d: any): unknown => (d.doc.archive = 1),
  rowName: (d: any): unknown => (d.sourceAudit.rows[1].name += 'X'),
  rowCode: (d: any): unknown => (d.sourceAudit.rows[1].printedCode += 'X'),
  rowKind: (d: any): unknown => (d.sourceAudit.rows[1].kind = 'program'),
  rowPage: (d: any): unknown => d.sourceAudit.rows[1].page++,
  duplicate: (d: any): unknown => d.sourceAudit.rows.push(d.sourceAudit.rows[1]),
}))
  it('rejects ' + name, () => {
    const d = example('7400');
    mutate(d);
    expect(programmeSupplementGuard(d)).toBe(false);
  });
for (const value of [null, undefined, [], false, 1, 'bad', {}])
  it('rejects non-document ' + JSON.stringify(value), () =>
    expect(programmeSupplementGuard(value)).toBe(false),
  );
it('counts only strictly verified documents', () => {
  expect(programmeSupplementCounts(supplementaryProgrammeCodes.map(example))).toEqual({
    budgets: 4,
    differ: 2,
    policies: 10,
    programs: 30,
  });
  expect(programmeSupplementCounts([null, {}])).toEqual({
    budgets: 0,
    differ: 0,
    policies: 0,
    programs: 0,
  });
});
it('compares structures, types, keys and scalar cells exactly', () => {
  for (const [a, b] of [
    [[], {}],
    [{}, []],
    [null, {}],
    [false, {}],
    [1, '1'],
    [{}, { a: 1 }],
    [{ a: 1 }, { b: 1 }],
    [{ a: 1 }, { a: 2 }],
  ])
    expect(programmeEqual(a, b)).toBe(false);
  expect(programmeEqual({ a: [1, null] }, { a: [1, null] })).toBe(true);
});

for (const field of fields)
  it('rejects malformed field ' + field, () => {
    const d = example('1800');
    d[field] = ['name', 'short', 'policiesKind'].includes(field) ? 1 : 'invalid';
    expect(programmeSupplementGuard(d)).toBe(false);
  });

it('describes exact grand-total source differences without changing any cell', () => {
  const s = structuredClone(programmeReferences['7400']!);
  s.rows[0]!.values[0]!++;
  expect(programmeNotes(s).some((n) => n.includes('сбор на политиките'))).toBe(true);
});

it('binds each supplemental contract to its own published filename', () => {
  for (const code of supplementaryProgrammeCodes)
    for (const other of supplementaryProgrammeCodes)
      expect(isPublishedDataset(`ministries/${code}.json`, example(other))).toBe(code === other);
});
